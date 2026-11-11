
const $=s=>document.querySelector(s), view=$('#view');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=v=>v==null?'—':Number(v).toFixed(1)+' °C', pct=(a,b)=>b?Math.round(a/b*100)+'%':'—';
const time=v=>v?new Date(v).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'—';
const ship=id=>'TT–'+String(id+1000), badge=(s,c='')=>'<span class="badge '+c+'">'+esc(s)+'</span>';
const btn=(text,action,cls='')=>'<button class="'+cls+'" data-do="'+action+'">'+text+'</button>';
const pages={overview:['◫','Overview'],shipments:['▣','Shipments'],monitor:['⌁','Live monitoring'],alerts:['◇','Alerts'],reports:['▤','Compliance'],lab:['▷','Use case lab'],architecture:['⌘','Architecture'],azure:['☁','Azure settings']};
let db,page='overview',id=1,detail,featured,azure=false,arch=0,timer,active=false,step=0,runId=0,inFlight,toastTimer,scenario=-1,simMode='normal',speed=1200,simId=1,lastMode='',search='',status='',cargo='',condition='',severity='';
async function api(url,body){
 const r=await fetch('/api/'+url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 if(!r.ok)throw Error((await r.json()).error||'Request failed.');
 return r.json();
}
function toast(s){$('#toast').textContent=s;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').textContent='',4200);}
function stop(){clearTimeout(timer);active=false;runId++;}
function navigate(p){if(location.hash.slice(1)!==p)location.hash=p;else refresh().catch(error);}
function error(e){toast(e.message);}
function hero(k,t,d,a=''){return '<section class="hero"><div><p class="eyebrow">'+k+'</p><h1>'+t+'</h1><p class="sub">'+d+'</p></div><div class="actions">'+a+'</div></section>';}
function panel(t,body){return '<section class="panel"><h2>'+t+'</h2>'+body+'</section>';}
const report='<a class="btn ghost" href="/api/report.csv">↓ Download CSV</a>';
const risk=s=>s.status==='Scheduled'?'Awaiting sensor':!s.online?'Offline':s.temp==null?'No readings':s.temp<s.min||s.temp>s.max?'Excursion':'In range';
const color=r=>r==='In range'?'green':r==='Excursion'?'red':r==='Offline'?'amber':'';
const options=(values,current)=>values.map(x=>'<option'+(String(x)===String(current)?' selected':'')+'>'+esc(x)+'</option>').join('');
const filter=(key,label,values,v)=>'<label>'+label+'<select data-filter="'+key+'"><option value="">All</option>'+options(values,v)+'</select></label>';
function progress(s){return s.status==='Delivered'?100:s.status==='Scheduled'?0:Math.max(0,Math.min(99,Math.round((Date.now()-Date.parse(s.depart))/(Date.parse(s.eta)-Date.parse(s.depart))*100)));}
function route(s){const p=progress(s);return '<div class="between"><span>'+esc(s.source)+'</span><span class="cyan">'+p+'% estimated</span><span>'+esc(s.destination)+'</span></div><div class="progress space"><b style="width:'+p+'%"></b></div>';}
function table(rows){
 return rows.length?'<div class="tablewrap"><table><thead><tr><th>Shipment</th><th>Cargo</th><th>Route</th><th>Temperature</th><th>Sensor</th><th>Health</th><th>Lifecycle</th></tr></thead><tbody>'+rows.map(s=>'<tr><td>'+btn(ship(s.id),'ship:'+s.id,'link')+'</td><td>'+esc(s.cargo)+'</td><td>'+esc(s.source)+' → '+esc(s.destination)+'</td><td>'+fmt(s.temp)+'</td><td>'+badge(s.online?'Online':'Offline',s.online?'green':'amber')+'</td><td>'+badge(risk(s),color(risk(s)))+'</td><td>'+badge(s.status)+'</td></tr>').join('')+'</tbody></table></div>':'<p class="empty">No shipments match the current filters.</p>';
}
function chart(d){
 if(!d?.readings.length)return '<p class="empty">No readings yet. Start the simulator to populate this chart.</p>';
 const {s,readings:r}=d, lo=Math.min(s.min,...r.map(x=>x.temp))-1, hi=Math.max(s.max,...r.map(x=>x.temp))+1;
 const x=i=>44+i*540/Math.max(1,r.length-1), y=t=>17+(hi-t)/(hi-lo)*153;
 const points=r.map((a,i)=>x(i)+','+y(a.temp)).join(' '), levels=[hi,s.max,s.min,lo].sort((a,b)=>b-a);
 return '<div class="chart"><svg viewBox="0 0 600 203" role="group" aria-label="Temperature telemetry in degrees Celsius"><defs><linearGradient id="fade" x2="0" y2="1"><stop stop-color="#54e6eb" stop-opacity=".23"/><stop offset="100%" stop-color="#54e6eb" stop-opacity="0"/></linearGradient></defs><rect x="44" y="'+y(s.max)+'" width="540" height="'+(y(s.min)-y(s.max))+'" fill="#64e4b319"/>'+levels.map(t=>'<line x1="44" x2="584" y1="'+y(t)+'" y2="'+y(t)+'" stroke="#365069" stroke-dasharray="4 5"/><text x="0" y="'+(y(t)+4)+'">'+Math.round(t)+'°</text>').join('')+'<polygon fill="url(#fade)" points="44,170 '+points+' '+x(r.length-1)+',170"/><polyline class="trace" pathLength="1" fill="none" stroke="#62e6ed" stroke-width="2.8" stroke-linejoin="round" points="'+points+'"/>'+r.map((a,i)=>'<circle class="chartpoint" tabindex="'+(i===r.length-1?'0':'-1')+'" cx="'+x(i)+'" cy="'+y(a.temp)+'" r="'+(a.temp<s.min||a.temp>s.max?'3.2':'2.3')+'" fill="'+(a.temp<s.min||a.temp>s.max?'#ff8290':'#62e6ed')+'"><title>'+fmt(a.temp)+' · '+time(a.at)+'</title></circle>').join('')+'<text x="44" y="193">'+(r.length>1?'Earlier':'Latest')+'</text><text text-anchor="end" x="584" y="193">Latest reading</text></svg><div class="legend"><span class="cyan">● Telemetry</span><span class="green">■ Permitted '+s.min+' to '+s.max+' °C</span><span class="red">● Outside limits</span><span>'+r.length+' samples shown</span></div></div>';
}
function overview(){
 const moving=db.shipments.filter(s=>s.status==='In transit'), healthy=moving.filter(s=>risk(s)==='In range').length, excursion=moving.filter(s=>risk(s)==='Excursion').length, connected=moving.filter(s=>s.online).length;
 const a=db.alerts.filter(x=>x.status!=='Resolved'), sum=k=>db.shipments.reduce((v,s)=>v+s[k],0);
 const metrics=[['▣','ACTIVE SHIPMENTS',moving.length,connected+' sensors connected','cyan'],['✓','IN SAFE RANGE',healthy,'Active shipments','green'],['!','TEMP EXCURSIONS',excursion,a.filter(x=>x.severity==='Critical').length+' confirmed critical','red'],['⌁','READINGS IN RANGE',pct(sum('safe'),sum('samples')),'Across recorded telemetry','cyan']];
 const latest=a.slice(0,3).map(x=>'<div class="entry"><p><strong>'+esc(x.kind)+'</strong><br><span class="muted">'+ship(x.shipment)+'</span></p>'+badge(x.severity,x.severity==='Critical'?'red':'amber')+'</div>').join('');
 return hero('OPERATIONS / COMMAND CENTER','Cold chain overview','Track shipment health, temperature and exceptions across your cold chain.',report+btn('+ New shipment','new','primary'))+
 '<div class="metrics">'+metrics.map(([ic,n,v,h,c])=>'<article class="metric"><div class="between"><small>'+n+'</small><span class="symbol">'+ic+'</span></div><strong class="'+c+'">'+v+'</strong><p>'+h+'</p></article>').join('')+'</div>'+
 '<div class="grid">'+panel('Live temperature telemetry','<div class="between muted">'+ship(featured.s.id)+' · '+esc(featured.s.cargo)+badge('Simulated','cyan')+'</div>'+chart(featured))+
 panel('Shipment risk','<div class="seg" aria-label="Shipment risk distribution">'+[[healthy,'#64e4b3'],[excursion,'#ff8290'],[moving.length-healthy-excursion,'#ffc775']].map(([v,c])=>'<b style="width:'+100*v/Math.max(1,moving.length)+'%;background:'+c+'"></b>').join('')+'</div><div class="legend"><span class="green">'+healthy+' in range</span><span class="red">'+excursion+' excursions</span><span class="amber">'+(moving.length-healthy-excursion)+' other</span></div><div class="feed"><h3>Recent alerts</h3>'+(latest||'<p class="muted">No active alerts.</p>')+btn('View alert queue →','nav:alerts','link')+'</div>')+'</div>'+
 '<div class="grid">'+panel('Active shipments',table(moving))+panel('Featured route','<p class="muted">'+ship(featured.s.id)+' · '+esc(featured.s.status)+'</p>'+route(featured.s)+'<div class="entry space"><span>Estimated arrival</span><strong>'+time(featured.s.eta)+'</strong></div>'+btn('Inspect shipment →','ship:'+featured.s.id,'link'))+'</div>';
}
function shipmentRows(){return db.shipments.filter(s=>(!status||s.status===status)&&(!cargo||s.cargo===cargo)&&(!condition||risk(s)===condition)&&[ship(s.id),s.cargo,s.source,s.destination].join(' ').toLowerCase().includes(search.toLowerCase()));}
const num=(name,label,val,step='0.1')=>'<label>'+label+'<input required name="'+name+'" type="number" step="'+step+'" value="'+val+'"></label>';
function shipments(){
 return hero('LOGISTICS / SHIPMENT REGISTER','Shipments','Search cargo, check route health and review temperature evidence.',btn('+ New shipment','new','primary'))+
 panel('Shipment register','<div class="toolbar"><label>Search<input id="search" type="search" placeholder="Shipment, cargo or route" value="'+esc(search)+'"></label>'+filter('status','Lifecycle',['Scheduled','In transit','Delivered'],status)+filter('cargo','Cargo',Object.keys(db.cargoRanges),cargo)+filter('condition','Temperature / sensor',['In range','Excursion','Offline','No readings','Awaiting sensor'],condition)+'</div><div id="rows">'+table(shipmentRows())+'</div>');
}
function newShipment(){
 return hero('LOGISTICS / SHIPMENT REGISTER','Create shipment','Start with cargo defaults or set a custom temperature band.')+panel('Shipment information','<form class="form space" data-form="create"><div class="fields"><label>Cargo<select name="cargo" id="cargoDefault">'+options(Object.keys(db.cargoRanges),'Vaccines')+'</select></label><label>Origin<input required name="source" maxlength="70"></label><label>Destination<input required name="destination" maxlength="70"></label>'+num('min','Minimum °C',2)+num('max','Maximum °C',8)+num('confirm','Confirm after readings',3,1)+'</div><div class="actions"><button class="primary">Create shipment</button>'+btn('Cancel','nav:shipments')+'</div></form>');
}
const timeline=d=>d.audit.length?d.audit.map(a=>'<div class="entry"><span>'+esc(a.message)+'</span><time class="muted">'+time(a.at)+'</time></div>').join(''):'<p class="empty">No audit entries.</p>';
function alertsList(rows){
 return '<div class="alert">'+(rows.map(a=>'<details><summary>'+ship(a.shipment)+' · '+esc(a.kind)+' '+badge(a.severity,a.severity==='Critical'?'red':'amber')+' '+badge(a.status)+'</summary><div><p class="muted">Opened '+time(a.opened)+(a.closed?' · Resolved '+time(a.closed):'')+'</p><div class="actions">'+btn('Inspect shipment','ship:'+a.shipment)+(a.status==='Open'?btn('Acknowledge','ack:'+a.id):'')+(a.status!=='Resolved'?btn('Resolve','resolve:'+a.id):'')+'</div></div></details>').join('')||'<p class="empty">No matching alerts.</p>')+'</div>';
}
function shipment(){
 const {s,stats}=detail, next={'Scheduled':'In transit','In transit':'Delivered'}[s.status];
 return hero('LOGISTICS / SHIPMENT DETAILS',ship(s.id)+' · '+esc(s.cargo),esc(s.source)+' → '+esc(s.destination)+' · '+s.status,btn('← Shipments','nav:shipments')+btn('Print report','print')+btn('Simulate','sim:'+s.id,'primary'))+
 '<div class="grid">'+panel('Temperature history',chart(detail)+'<p class="muted space">Low '+fmt(stats.low)+' · Average '+fmt(stats.mean)+' · High '+fmt(stats.high)+' · '+pct(s.safe,s.samples)+' within configured limits</p>')+
 panel('Shipment progress','<div class="space">'+route(s)+'</div><div class="entry space"><span>Departure</span><span>'+time(s.depart)+'</span></div><div class="entry"><span>Estimated arrival</span><span>'+time(s.eta)+'</span></div><div class="entry"><span>Sensor</span>'+badge(s.online?'Online':'Offline',s.online?'green':'amber')+'</div>'+(next?btn('Mark '+next.toLowerCase(),'advance:'+next):''))+'</div>'+
 '<div class="grid">'+panel('Alerts and audit history',alertsList(detail.alerts)+'<div class="space">'+timeline(detail)+'</div>')+
 panel('Temperature policy','<form class="form space" data-form="limits"><div class="fields">'+num('min','Minimum °C',s.min)+num('max','Maximum °C',s.max)+num('confirm','Consecutive readings',s.confirm,1)+'</div><button class="primary">Save limits</button></form><p class="muted space">Demonstration compliance record. Limits are configurable and are not a certification standard.</p>')+'</div>';
}
const modes={'normal':'Normal operation','warm':'Gradual warming','breach':'Sudden excursion','recover':'Cooling recovery','offline':'Sensor disconnect','online':'Sensor reconnect'};
const scenarios=[
 ['Vaccine shipment','Normal operation','Operator verifies a stable vaccine shipment within its configured band.',1,['normal','normal','normal']],
 ['Temperature excursion','Confirmed breach','Quality assurance watches the first warning escalate after consecutive breaches.',1,['recover','breach','breach','breach']],
 ['Perishable food','Gradual warming','Operator watches refrigerated produce warm above its configured limit.',2,['recover','warm','warm','warm','warm','warm']],
 ['Sensor failure','Loss of connectivity','Operator simulates missing communication and inspects an independent offline warning.',1,['online','offline']],
 ['Recovery investigation','Audit and reporting','Quality assurance acknowledges an excursion, restores temperature, and reviews the resolved event.',1,['recover','breach','breach','breach','ack','recover']]
];
function monitor(){
 const s=detail.s;
 return hero('TELEMETRY / VIRTUAL IOT','Live monitoring','Send simulated sensor readings through the same ingestion and alert rules as the use cases.',btn('Use case laboratory →','nav:lab'))+
 '<div class="grid">'+panel('Temperature stream',chart(detail))+panel('Sensor simulator','<div class="toolbar"><label>Shipment<select id="simId">'+db.shipments.map(x=>'<option value="'+x.id+'"'+(x.id===simId?' selected':'')+'>'+ship(x.id)+' · '+esc(x.cargo)+'</option>').join('')+'</select></label><label>Mode<select id="simMode">'+Object.entries(modes).map(([k,v])=>'<option value="'+k+'"'+(k===simMode?' selected':'')+'>'+v+'</option>').join('')+'</select></label><label>Interval<select id="speed"><option value="500"'+(speed===500?' selected':'')+'>0.5 s</option><option value="1200"'+(speed===1200?' selected':'')+'>1.2 s</option><option value="2500"'+(speed===2500?' selected':'')+'>2.5 s</option></select></label></div><div class="actions">'+btn(active?'Pause':'Start',active?'pause':'start','primary')+btn('Step','step')+btn('Reset sequence','replay')+'</div><p class="muted space">'+badge(s.online?'Sensor online':'Sensor offline',s.online?'green':'amber')+' · '+step+' steps · '+esc(lastMode||'Ready')+'</p>')+'</div>'+panel('Recent sensor events',timeline(detail));
}
function lab(){
 let live=scenario>=0?'<div class="grid space">'+panel('Scenario telemetry',chart(detail))+panel('Event sequence','<ol class="sequence">'+scenarios[scenario][4].map((m,i)=>'<li class="'+(i<step?'done':i===step?'current':'')+'">'+(modes[m]||'Acknowledge alert')+'</li>').join('')+'</ol><div class="actions">'+btn(active?'Pause':'Replay',active?'pause':'case:'+scenario,'primary')+btn('Inspect shipment','ship:'+simId)+report+'</div>')+'</div>':'';
 return hero('SIMULATION / INTERACTIVE CASES','Use case laboratory','Run deterministic sequences against the real SQLite telemetry and alert workflow.')+
 '<div class="cards">'+scenarios.map(([title,k,d],i)=>'<article class="panel scenario"><p class="eyebrow">0'+(i+1)+' / '+k+'</p><h3>'+title+'</h3><p class="muted">'+d+'</p>'+btn('▷ Run scenario','case:'+i,scenario===i?'primary':'')+'</article>').join('')+'</div>'+live;
}
const modules=[
 ['Virtual IoT sensors','The simulator generates Celsius values and explicit connectivity events. All readings are synthetic.'],
 ['Telemetry API','POST /api/shipments/:id/telemetry accepts a reading; the sensor route accepts connectivity changes.'],
 ['Data validation','The server validates shipment IDs, Celsius bounds, input size and JSON request shape.'],
 ['SQLite storage','One shipment has one sensor, many readings, alerts and audit records. A transaction groups telemetry and rule changes.'],
 ['Temperature rule engine','An out-of-range reading opens a warning. Consecutive breaches escalate to critical. A safe reading closes the excursion.'],
 ['Alert manager','One active alert per shipment and kind. Operators can acknowledge it. Recovery resolves it and preserves history.'],
 ['Monitoring dashboard','The browser refreshes shipment and alert state after each simulated reading; graphs show configured limits.'],
 ['Compliance reporting','SQLite records feed the printable shipment view and CSV. Azure Blob upload is an optional manual export.']
];
function architecture(){
 return hero('ENGINEERING / SYSTEM DESIGN','System architecture','Follow telemetry from virtual sensor through the compliance record.')+panel('Telemetry pipeline','<div class="flow">'+modules.map(([n,d],i)=>'<button data-do="arch:'+i+'" aria-pressed="'+(arch===i)+'" title="'+esc(d)+'"><span class="eyebrow">0'+(i+1)+'</span>'+n+'</button>').join('')+'</div><h3>'+modules[arch][0]+'</h3><p class="muted">'+modules[arch][1]+'</p>')+
 '<div class="cards space">'+[['State transitions','Scheduled → In transit → Delivered. Open alerts can be acknowledged; safe readings or reconnection resolve the respective alerts.'],['Reliability and errors','SQLite transactions keep readings and alerts consistent. The HTTP API returns explicit errors for malformed inputs and invalid transitions.'],['About TempTrace','An academic demonstration for logistics operators, quality teams, administrators and auditors. Readings are simulated and reports do not certify compliance.'],['Future integrations','Hardware ingestion, timed stale detection, identity controls and queued notifications are future work. Azure Blob export is implemented.']].map(([t,d])=>panel(t,'<p class="muted space">'+d+'</p>')).join('')+'</div>';
}
function reports(){
 return hero('QUALITY / AUDIT WORKSPACE','Compliance records','Inspect recorded temperature performance and export evidence for your demo.',report+btn('Azure export →','nav:azure'))+
 panel('Shipment compliance','<p class="muted report-note space">Demonstration records only. In-range percentage measures stored readings against current shipment limits.</p><div class="tablewrap"><table><thead><tr><th>Shipment</th><th>Cargo</th><th>Samples</th><th>In range</th><th>Connectivity</th><th>Excursion events</th><th>Duration</th></tr></thead><tbody>'+db.shipments.map(s=>{
 const a=db.alerts.filter(x=>x.shipment===s.id&&x.kind==='Temperature excursion');
 const mins=a.reduce((v,x)=>v+Math.max(0,Date.parse(x.closed??new Date())-Date.parse(x.opened))/60000,0);
 return '<tr><td>'+btn(ship(s.id),'ship:'+s.id,'link')+'</td><td>'+esc(s.cargo)+'</td><td>'+s.samples+'</td><td>'+pct(s.safe,s.samples)+'</td><td>'+badge(s.online?'Online':'Offline',s.online?'green':'amber')+'</td><td>'+a.length+'</td><td>'+mins.toFixed(1)+' min</td></tr>';
 }).join('')+'</tbody></table></div>')+'<div class="space">'+panel('Demo data','<p class="muted space">Reset replaces all shipments, telemetry and audit records with the sample dataset.</p>'+btn('Reset demo data','reset','danger'))+'</div>';
}
function settings(){
 return hero('INTEGRATIONS / OPTIONAL','Azure Blob Storage','Send a copy of the compliance CSV to an Azure container you control.')+
 panel('Report archive connection','<p class="space">'+badge(azure?'Credentials configured':'Local mode',azure?'green':'cyan')+'</p><p class="muted">Use a short-lived, container-scoped SAS with Create or Write permission. The token is kept in server memory for this run and is never returned by the API.</p><form class="form" data-form="azure" autocomplete="off"><label>Azure Blob container URL<input name="url" required type="url" placeholder="https://account.blob.core.windows.net/container"></label><label>SAS token<input name="sas" required type="password" placeholder="sv=…&amp;sig=…"></label><div class="actions"><button class="primary">Save credentials</button>'+btn('Clear credentials','clearazure')+'</div></form><div class="actions space"><button class="ghost" data-do="upload"'+(azure?'':' disabled')+'>Upload compliance CSV</button>'+report+'</div>');
}
function render(){
 const effective=['ship','new'].includes(page)?'shipments':page;
 $('#nav').innerHTML=Object.entries(pages).map(([k,[icon,name]])=>'<button data-do="nav:'+k+'"'+(effective===k?' aria-current="page"':'')+'><span aria-hidden="true">'+icon+'</span>'+name+'</button>').join('');
 $('#crumb').textContent=pages[effective]?.[1]||'Overview';
 const renders={overview,shipments,ship:shipment,new:newShipment,monitor,alerts:()=>hero('EXCEPTIONS / RESPONSE QUEUE','Alerts','Review warnings, confirm critical excursions and trace recovery.')+panel('Alert history','<div class="toolbar">'+filter('severity','Severity',['Warning','Critical'],severity)+'</div>'+alertsList(db.alerts.filter(a=>!severity||a.severity===severity))),reports,lab,architecture,azure:settings};
 view.innerHTML=renders[page]();
}
let refreshId=0;
async function refresh(){
 const token=++refreshId, target=location.hash.slice(1), [key,number]=target.split('/');
 const next=key==='ship'&&/^\d+$/.test(number)?'ship':key==='new'||Object.hasOwn(pages,key)?key:'overview';
 const fresh=await api('state');if(token!==refreshId)return;
 db=fresh;page=next;if(number&&next==='ship')id=+number;
 if(!db.shipments.some(s=>s.id===simId))simId=db.shipments[0].id;
 if(next==='overview')featured=await api('shipments/'+(db.shipments.find(s=>s.status==='In transit')??db.shipments[0]).id);
 if(next==='ship'||next==='monitor'||(next==='lab'&&scenario>=0))detail=await api('shipments/'+(next==='ship'?id:simId));
 if(next==='azure')azure=(await api('azure')).configured;
 if(token===refreshId)render();
}
async function emit(mode,s,index){
 const path='shipments/'+s.id;
 if(mode==='offline'||mode==='online')return api(path+'/sensor',{online:mode==='online'});
 if(mode==='ack'){
  const row=(await api('state')).alerts.find(a=>a.shipment===s.id&&a.kind==='Temperature excursion'&&a.status==='Open');
  if(row)return api('alerts/'+row.id,{status:'Acknowledged'});
  return;
 }
 const mid=(s.min+s.max)/2, safe=mid+Math.sin(index*.9)*Math.min(.6,(s.max-s.min)/4);
 const t=mode==='warm'?s.max-1+index*.55:mode==='breach'?s.max+3:mode==='recover'?mid:safe;
 return api(path+'/telemetry',{temp:Math.max(-100,Math.min(100,+t.toFixed(3)))});
}
async function tick(r,manual=false){
 if(r!==runId||(!active&&!manual)||inFlight)return;
 const current=page==='lab'&&scenario>=0?scenarios[scenario][4]:null;
 const mode=current?current[step]:simMode;
 if(!mode){stop();await refresh();return;}
 const s=db.shipments.find(x=>x.id===simId);
 try{
  inFlight=emit(mode,s,step);
  await inFlight;
  if(r!==runId)return;
  step++;lastMode=modes[mode]||'Alert acknowledged';
  if(current&&step>=current.length){active=false;toast('Scenario complete. Review the recorded events.');}
  await refresh();
  if(active&&r===runId)timer=setTimeout(()=>tick(r),speed);
 }catch(e){stop();error(e);await refresh().catch(error);}
 finally{inFlight=null;}
}
function actionMap(k,v){
 if(k==='nav'){stop();navigate(v);return;}
 if(k==='ship'){stop();navigate('ship/'+v);return;}
 if(k==='new'){stop();navigate('new');return;}
 if(k==='print'){window.print();return;}
 if(k==='arch'){arch=+v;render();view.querySelector('[data-do="arch:'+v+'"]').focus();return;}
 if(k==='sim'){simId=+v;step=0;lastMode='';stop();navigate('monitor');return;}
 if(k==='pause'){stop();render();return;}
 if(k==='start'||k==='step'){if(inFlight)return;stop();active=k==='start';render();return tick(runId,k==='step');}
 if(k==='case'){if(inFlight)return;stop();scenario=+v;simId=scenarios[scenario][3];step=0;active=true;return refresh().then(()=>tick(runId));}
 if(k==='replay'){stop();step=0;lastMode='';render();return;}
 if(k==='ack'||k==='resolve')return api('alerts/'+v,{status:k==='ack'?'Acknowledged':'Resolved'}).then(()=>{toast('Alert updated.');return refresh();});
 if(k==='advance')return api('shipments/'+id,{status:v}).then(refresh);
 if(k==='reset'){
  if(!confirm('Replace all local shipment data with the seeded demo?'))return;
  stop();return api('reset',{}).then(()=>{scenario=-1;step=0;toast('Demo data reset.');return refresh();});
 }
 if(k==='clearazure')return api('azure',{clear:true}).then(()=>{toast('Azure credentials cleared.');return refresh();});
 if(k==='upload')return api('azure/export',{}).then(r=>toast('Uploaded '+r.name));
}
view.addEventListener('input',e=>{if(e.target.id==='search'){search=e.target.value;$('#rows').innerHTML=table(shipmentRows());}});
document.addEventListener('click',async e=>{
 const b=e.target.closest('button[data-do]');if(!b)return;e.preventDefault();
 const [k,v]=b.dataset.do.split(':');b.disabled=true;
 try{await actionMap(k,v);}catch(e){error(e);}finally{b.disabled=false;}
});
view.addEventListener('change',e=>{
 const el=e.target,v=el.value;
 if(el.id==='cargoDefault'){const [lo,hi]=db.cargoRanges[v];el.form.elements.min.value=lo;el.form.elements.max.value=hi;return;}
 if(el.id==='simId'){stop();simId=+v;step=0;lastMode='';refresh().catch(error);return;}
 if(el.id==='speed'){speed=+v;return;}
 if(el.id==='simMode'){simMode=v;return;}
 switch(el.dataset.filter){case 'status':status=v;break;case 'cargo':cargo=v;break;case 'condition':condition=v;break;case 'severity':severity=v;break;default:return;}
 if(page==='shipments')$('#rows').innerHTML=table(shipmentRows());else{render();view.querySelector('[data-filter="severity"]').focus();}
});
view.addEventListener('submit',async e=>{
 e.preventDefault();const f=e.target,b=Object.fromEntries(new FormData(f)), submit=f.querySelector('button');submit.disabled=true;
 try{
  if(f.dataset.form==='azure'){await api('azure',b);f.reset();toast('Azure credentials saved for this session.');await refresh();return;}
  for(const k of ['min','max','confirm'])b[k]=Number(b[k]);
  if(f.dataset.form==='create'){const s=await api('shipments',b);toast('Shipment created.');navigate('ship/'+s.id);}
  if(f.dataset.form==='limits'){await api('shipments/'+id,b);toast('Temperature limits saved.');await refresh();}
 }catch(e){error(e);}finally{submit.disabled=false;}
});
window.addEventListener('hashchange',()=>{stop();refresh().catch(e=>{view.textContent=e.message;error(e);});});
refresh().catch(e=>{view.textContent=e.message;error(e);});
