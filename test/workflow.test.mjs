
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
const server=createApp();
let base;
before(async()=>{server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;});
after(()=>new Promise(resolve=>server.close(resolve)));
const call=(path,body)=>fetch(base+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const json=async(path,body)=>{const r=await call(path,body);assert.equal(r.status,200);return r.json();};
test('app shell and assets are served',async()=>{
 for(const [p,v] of [['/','TempTrace'],['/style.css','prefers-reduced-motion'],['/app.js','function render']]){
  const r=await call(p);assert.equal(r.status,200);assert.ok((await r.text()).includes(v));
 }
});
test('safe samples, confirmed excursion, deduplication and audited recovery',async()=>{
 const {id}=await json('/api/shipments',{cargo:'Vaccines',source:'A',destination:'B'});
 const p='/api/shipments/'+id;
 await json(p+'/telemetry',{temp:5});
 assert.equal((await json(p)).alerts.length,0);
 await json(p+'/telemetry',{temp:9});
 assert.equal((await json(p)).alerts[0].severity,'Warning');
 for(const temp of [10,11,12])await json(p+'/telemetry',{temp});
 const d=await json(p);
 assert.equal(d.alerts.length,1);assert.equal(d.alerts[0].severity,'Critical');
 await json('/api/alerts/'+d.alerts[0].id,{status:'Acknowledged'});
 await json(p+'/telemetry',{temp:6});
 const after=await json(p);assert.equal(after.alerts[0].status,'Resolved');assert.equal(after.s.safe,2);
 assert.ok(after.audit.some(x=>x.message.includes('acknowledged')));
});
test('offline alert stays separate and resolves when the sensor reconnects',async()=>{
 const p='/api/shipments/1';
 await json(p+'/sensor',{online:false});
 const d=await json(p);assert.equal(d.s.online,0);assert.equal(d.alerts[0].kind,'Sensor offline');
 await json(p+'/sensor',{online:true});assert.equal((await json(p)).alerts[0].status,'Resolved');
});
test('CSV is a real download containing seeded shipments',async()=>{
 const r=await call('/api/report.csv');assert.match(r.headers.get('content-disposition'),/attachment/);
 assert.match(await r.text(),/"Vaccines","Mumbai","Pune"/);
});
test('malformed telemetry is rejected without writing a reading',async()=>{
 const p='/api/shipments/1',d=await json(p);
 assert.equal((await call(p+'/telemetry',{temp:'9'})).status,400);
 assert.equal((await json(p)).s.samples,d.s.samples);
});
test('Azure settings redact the token and upload the real CSV through Put Blob',async(t)=>{
 const original=globalThis.fetch;
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  if(String(url).startsWith(base))return original(url,opts);
  assert.match(url,/^https:\/\/demoaccount\.blob\.core\.windows\.net\/reports\/temptrace-.*\.csv\?sv=2023-11-03&sig=example$/);
  assert.equal(opts.method,'PUT');assert.equal(opts.headers['x-ms-blob-type'],'BlockBlob');
  assert.match(opts.body,/"Vaccines","Mumbai","Pune"/);
  return new Response(null,{status:201});
 });
 assert.equal((await call('/api/azure',{url:'http://localhost/reports',sas:'sig=example'})).status,400);
 assert.deepEqual(await json('/api/azure',{url:'https://demoaccount.blob.core.windows.net/reports',sas:'?sv=2023-11-03&sig=example'}),{configured:true});
 assert.deepEqual(await json('/api/azure'),{configured:true});
 assert.match((await json('/api/azure/export',{})).name,/^temptrace-.*\.csv$/);
 assert.deepEqual(await json('/api/azure',{clear:true}),{configured:false});
});
