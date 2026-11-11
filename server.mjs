import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function createApp(file=':memory:') {
 const db=new DatabaseSync(file);
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS shipments(id INTEGER PRIMARY KEY,cargo TEXT,source TEXT,destination TEXT,min REAL,max REAL,status TEXT,depart TEXT,eta TEXT,confirm INTEGER);
 CREATE TABLE IF NOT EXISTS sensors(shipment INTEGER PRIMARY KEY REFERENCES shipments(id),online INTEGER);
 CREATE TABLE IF NOT EXISTS readings(id INTEGER PRIMARY KEY,shipment INTEGER REFERENCES shipments(id),temp REAL,at TEXT);
 CREATE TABLE IF NOT EXISTS alerts(id INTEGER PRIMARY KEY,shipment INTEGER REFERENCES shipments(id),kind TEXT,severity TEXT,status TEXT,opened TEXT,closed TEXT);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,shipment INTEGER REFERENCES shipments(id),message TEXT,at TEXT);
 CREATE INDEX IF NOT EXISTS readings_shipment ON readings(shipment,id);`);
 const all=(q,...a)=>db.prepare(q).all(...a), get=(q,...a)=>db.prepare(q).get(...a), run=(q,...a)=>db.prepare(q).run(...a);
 const now=()=>new Date().toISOString();
 const event=(id,msg,at=now())=>run('INSERT INTO audit(shipment,message,at) VALUES(?,?,?)',id,msg,at);
 const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
 const tx=fn=>{db.exec('BEGIN');try{const out=fn();db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}};
 function open(id,kind,severity,at) {
  const a=get("SELECT * FROM alerts WHERE shipment=? AND kind=? AND status!='Resolved'",id,kind);
  if(!a){run("INSERT INTO alerts(shipment,kind,severity,status,opened) VALUES(?,?,?,'Open',?)",id,kind,severity,at);event(id,kind+' · '+severity,at);}
  else if(a.severity==='Warning'&&severity==='Critical'){run("UPDATE alerts SET severity='Critical',status='Open' WHERE id=?",a.id);event(id,kind+' escalated to critical',at);}
 }
 function close(id,kind,at){if(run("UPDATE alerts SET status='Resolved',closed=? WHERE shipment=? AND kind=? AND status!='Resolved'",at,id,kind).changes)event(id,kind+' resolved',at);}
 function reading(s,temp,at=now()){
  if(!Number.isFinite(temp)||temp < -100||temp > 100)fail('Temperature must be between −100 and 100 °C.');
  run('INSERT INTO readings(shipment,temp,at) VALUES(?,?,?)',s.id,temp,at);
  run('UPDATE sensors SET online=1 WHERE shipment=?',s.id);
  close(s.id,'Sensor offline',at);
  if(temp>=s.min&&temp<=s.max){close(s.id,'Temperature excursion',at);return;}
  const tail=all('SELECT temp FROM readings WHERE shipment=? ORDER BY id DESC LIMIT ?',s.id,s.confirm);
  open(s.id,'Temperature excursion',tail.length===s.confirm&&tail.every(r=>r.temp<s.min||r.temp>s.max)?'Critical':'Warning',at);
 }
 const cargoRanges={Vaccines:[2,8],Produce:[1,5],Dairy:[1,4],Biologics:[2,8],Frozen:[-25,-18]};
 const statuses=['Scheduled','In transit','Delivered'];
 function create(b,depart=now(),eta=new Date(Date.now()+86400000).toISOString()){
  if(!Object.hasOwn(cargoRanges,b.cargo))fail('Choose a cargo category.');
  const src=String(b.source??'').trim(), dst=String(b.destination??'').trim();
  if(!src||!dst||src.length>70||dst.length>70)fail('Enter an origin and destination (up to 70 characters).');
  const [lo,hi]=cargoRanges[b.cargo], min=b.min??lo,max=b.max??hi,confirm=b.confirm??3;
  limits(min,max,confirm);
  const id=Number(run('INSERT INTO shipments(cargo,source,destination,min,max,status,depart,eta,confirm) VALUES(?,?,?,?,?,?,?,?,?)',b.cargo,src,dst,min,max,b.status??'Scheduled',depart,eta,confirm).lastInsertRowid);
  run('INSERT INTO sensors VALUES(?,1)',id);event(id,'Shipment created',depart);return id;
 }
 function limits(min,max,confirm){if(!Number.isFinite(min)||!Number.isFinite(max)||min< -100||max>100||min>=max||!Number.isInteger(confirm)||confirm<2||confirm>10)fail('Use an increasing range within −100 to 100 °C and 2–10 confirming readings.');}
 function reset(){return tx(()=>{
  db.exec('DELETE FROM audit;DELETE FROM alerts;DELETE FROM readings;DELETE FROM sensors;DELETE FROM shipments;');
  const routes=[['Vaccines','Mumbai','Pune'],['Produce','Nashik','Mumbai'],['Dairy','Anand','Surat'],['Biologics','Hyderabad','Bengaluru'],['Frozen','Kochi','Chennai'],['Vaccines','Delhi','Jaipur'],['Produce','Nagpur','Indore'],['Dairy','Pune','Goa'],['Biologics','Kolkata','Bhubaneswar']];
  const base=Date.now(), time=h=>new Date(base+h*3600000).toISOString();
  routes.forEach(([cargo,source,destination],i)=>{
   const id=create({cargo,source,destination,status:i<7?'In transit':i===7?'Delivered':'Scheduled'},time(i===8?8:-25+i),time(i===7?-1:8+i*2));
   const s=get('SELECT * FROM shipments WHERE id=?',id);
   if(i<8)for(let h=0;h<=24;h++){const v=(s.min+s.max)/2+Math.sin(h*.64+i)*.85;reading(s,+(i===1&&h>=22?s.max+(h-21)*.55:i===5&&h===24?s.max+.3:v).toFixed(1),time(h-24-(i===7?2:0)));}
   if(i===4){run('UPDATE sensors SET online=0 WHERE shipment=?',id);open(id,'Sensor offline','Warning',now());}
  });
 });}
 if(!get('SELECT id FROM shipments LIMIT 1'))reset();
 function state(){
  const shipments=all(`SELECT s.*,n.online,(SELECT temp FROM readings WHERE shipment=s.id ORDER BY id DESC LIMIT 1) AS temp,
   (SELECT count(*) FROM readings WHERE shipment=s.id) AS samples,
   (SELECT count(*) FROM readings WHERE shipment=s.id AND temp BETWEEN s.min AND s.max) AS safe
   FROM shipments s JOIN sensors n ON n.shipment=s.id ORDER BY s.id`);
  return {shipments,alerts:all('SELECT * FROM alerts ORDER BY id DESC'),cargoRanges};
 }
 function detail(id){
  const s=state().shipments.find(x=>x.id===id);if(!s)fail('Shipment not found.',404);
  const readings=all('SELECT temp,at FROM readings WHERE shipment=? ORDER BY id DESC LIMIT 96',id).reverse();
  const stats=get('SELECT min(temp) AS low,max(temp) AS high,avg(temp) AS mean FROM readings WHERE shipment=?',id);
  return {s,readings,stats,alerts:all('SELECT * FROM alerts WHERE shipment=? ORDER BY id DESC',id),audit:all('SELECT * FROM audit WHERE shipment=? ORDER BY id DESC LIMIT 40',id)};
 }
 function csv(){
  const esc=x=>{const raw=String(x??'');return '"'+(typeof x==='string'&&/^[\s]*[=+@-]/.test(raw)?"'"+raw:raw).replaceAll('"','""')+'"';};
  const rows=[['Shipment','Cargo','Origin','Destination','Status','Online','Latest °C','Minimum °C','Maximum °C','Samples','In range %','Warnings recorded','Critical recorded','Offline events','Excursion minutes']];
  for(const s of state().shipments){
   const a=all('SELECT * FROM alerts WHERE shipment=?',s.id);
   const durations=a.filter(x=>x.kind==='Temperature excursion').reduce((t,x)=>t+Math.max(0,Date.parse(x.closed??now())-Date.parse(x.opened))/60000,0);
   rows.push([s.id,s.cargo,s.source,s.destination,s.status,s.online?'Yes':'No',s.temp,s.min,s.max,s.samples,s.samples?+(s.safe/s.samples*100).toFixed(1):'',a.filter(x=>x.severity==='Warning'&&x.kind==='Temperature excursion').length,a.filter(x=>x.severity==='Critical').length,a.filter(x=>x.kind==='Sensor offline').length,+durations.toFixed(1)]);
  }
  return rows.map(r=>r.map(esc).join(',')).join('\r\n')+'\r\n';
 }
 let azure={url:process.env.AZURE_CONTAINER_URL??'',sas:process.env.AZURE_SAS_TOKEN??''};
 function azureConfig(b){
  let u;try{u=new URL(b.url);}catch{fail('Enter an HTTPS Azure Blob container URL.');}
  if(u.protocol!=='https:'||! /^[a-z0-9]{3,24}\.blob\.core\.windows\.net$/.test(u.hostname)||u.port||u.username||u.password||u.search||u.hash||!/^\/[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\/?$/.test(u.pathname))fail('Use a standard Azure Blob container URL without a query string.');
  const sas=String(b.sas??'').trim().replace(/^\?/,'');
  if(!new URLSearchParams(sas).get('sig')||sas.length>4000)fail('Enter a valid Azure SAS token.');
  return {url:u.origin+u.pathname.replace(/\/$/,''),sas};
 }
 async function azureExport(){
  const {url,sas}=azureConfig(azure),name='temptrace-'+now().replace(/[:.]/g,'-')+'.csv';
  let result;
  try{result=await fetch(url+'/'+name+'?'+sas,{method:'PUT',redirect:'error',headers:{'x-ms-blob-type':'BlockBlob','x-ms-version':'2023-11-03','content-type':'text/csv; charset=utf-8'},body:csv(),signal:AbortSignal.timeout(10000)});}
  catch{fail('Azure upload could not connect. Check the container and network.',502);}
  if(!result.ok)fail('Azure rejected the upload (HTTP '+result.status+'). Check SAS permissions and expiry.',502);
  return {name};
 }
 const assets={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
 const server=http.createServer(async(req,res)=>{
  const reply=(data,status=200,type='application/json; charset=utf-8',headers={})=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(type.startsWith('application/json')?JSON.stringify(data):data);};
  try{
   const path=new URL(req.url,'http://localhost').pathname;
   if(req.method==='GET'&&assets[path]){const [f,t]=assets[path];return reply(readFileSync(new URL('./public/'+f,import.meta.url)),200,t,{'Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'"});}
   if(req.method==='GET'){
    if(path==='/api/state')return reply(state());
    if(path==='/api/report.csv')return reply(csv(),200,'text/csv; charset=utf-8',{'Content-Disposition':'attachment; filename="temptrace-compliance.csv"'});
    if(path==='/api/azure')return reply({configured:Boolean(azure.url&&azure.sas)});
    const m=path.match(/^\/api\/shipments\/(\d+)$/);if(m)return reply(detail(+m[1]));
   }
   if(req.method!=='POST')fail('Route not found.',404);
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))fail('Expected JSON.',415);
   if(req.headers.origin&&req.headers.origin!=='http://'+req.headers.host)fail('Cross-origin request denied.',403);
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>16000)fail('Request too large.',413);}
   let b;try{b=JSON.parse(raw);}catch{fail('Invalid JSON.');}
   if(!b||typeof b!=='object'||Array.isArray(b))fail('Expected a JSON object.');
   if(path==='/api/reset'){reset();return reply({ok:true});}
   if(path==='/api/azure'){azure=b.clear?{url:'',sas:''}:azureConfig(b);return reply({configured:!!azure.url});}
   if(path==='/api/azure/export')return reply(await azureExport());
   const out=tx(()=>{
    if(path==='/api/shipments')return {id:create({...b,status:'Scheduled'})};
    const m=path.match(/^\/api\/shipments\/(\d+)(?:\/(telemetry|sensor))?$/);
    if(m){
     const id=+m[1],s=get('SELECT * FROM shipments WHERE id=?',id);if(!s)fail('Shipment not found.',404);
     if(m[2]==='telemetry')reading(s,b.temp);
     else if(m[2]==='sensor'){
      if(typeof b.online!=='boolean')fail('Online must be a boolean.');
      const prior=get('SELECT online FROM sensors WHERE shipment=?',id);
      run('UPDATE sensors SET online=? WHERE shipment=?',+b.online,id);
      if(prior.online!==+b.online)event(id,b.online?'Sensor reconnected':'Sensor disconnected (simulated)');
      if(b.online)close(id,'Sensor offline',now());else open(id,'Sensor offline','Warning',now());
     }else{
      if(b.status!==undefined){
       const i=statuses.indexOf(b.status),current=statuses.indexOf(s.status);
       if(i!==current+1||i<0)fail('Shipment must move from Scheduled to In transit to Delivered.');
       run('UPDATE shipments SET status=? WHERE id=?',b.status,id);event(id,'Status changed to '+b.status);
      }else{limits(b.min,b.max,b.confirm);run('UPDATE shipments SET min=?,max=?,confirm=? WHERE id=?',b.min,b.max,b.confirm,id);event(id,'Temperature limits updated');}
     }
     return {ok:true};
    }
    const a=path.match(/^\/api\/alerts\/(\d+)$/);
    if(a){
     const row=get('SELECT * FROM alerts WHERE id=?',+a[1]);if(!row)fail('Alert not found.',404);
     if(b.status==='Acknowledged'&&row.status==='Open'){run("UPDATE alerts SET status='Acknowledged' WHERE id=?",row.id);event(row.shipment,row.kind+' acknowledged');}
     else if(b.status==='Resolved'&&row.status!=='Resolved'){
      const d=detail(row.shipment).s;
      if(row.kind==='Sensor offline'?!d.online:d.temp===null||d.temp<d.min||d.temp>d.max)fail('Recover the sensor or temperature before resolving.');
      close(row.shipment,row.kind,now());
     }else fail('This alert transition is unavailable.');
     return {ok:true};
    }
    fail('Route not found.',404);
   });
   reply(out);
  }catch(e){if(!e.status)console.error(e.code??'Unexpected request error');reply({error:e.status?e.message:'Unexpected server error.'},e.status??500);}
 });
 server.on('close',()=>db.close());
 return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 mkdirSync(new URL('./data/',import.meta.url),{recursive:true});
 const file=new URL('./data/temptrace.sqlite',import.meta.url);
 createApp(file).listen(Number(process.env.PORT??4173),'127.0.0.1',function(){console.log('TempTrace running at http://127.0.0.1:'+this.address().port);});
}
