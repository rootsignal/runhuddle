import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../scripts/copilot_extension_core.mjs';
const sid = 'f969eaa9-9a38-4d55-ad10-5de07c5b4149';
function fixture(send) { return createHandler({ sessionId: sid, send }); }
const request = { action:'send', sessionID:sid, text:'literal $text\nnext line' };
test('queues exact text and returns receipt', async () => {
 let calls=[]; const h=fixture(async payload => { calls.push(payload); return 'receipt'; });
 assert.equal((await h.handle(request)).outcome,'queued');
 assert.deepEqual(calls,[{prompt:request.text,mode:'enqueue'}]);
});
test('wrong session, approval, and shutdown prevent submission', async () => {
 let calls=0; const h=fixture(async()=>{calls++; return 'receipt';});
 assert.equal((await h.handle({...request,sessionID:'other'})).outcome,'unavailable');
 h.observe({type:'permission.requested',data:{requestId:'p'}});
 assert.equal((await h.handle(request)).outcome,'unavailable');
 h.observe({type:'permission.completed',data:{requestId:'p'}});
 assert.equal((await h.handle({...request,action:'check'})).outcome,'ready');
 h.observe({type:'session.shutdown'});
 assert.equal((await h.handle(request)).outcome,'unavailable'); assert.equal(calls,0);
});
test('ambiguous failure never retries', async () => {
 let calls=0; const h=fixture(async()=>{calls++;throw Error('closed');});
 assert.equal((await h.handle(request)).outcome,'uncertain'); assert.equal(calls,1);
});
test('concurrent and invalid sends are blocked', async () => {
 let resolve; const h=fixture(()=>new Promise(r=>resolve=r));
 assert.equal((await h.handle({...request,text:''})).outcome,'notSent');
 const pending=h.handle(request);
 assert.equal((await h.handle(request)).outcome,'notSent');
 resolve('receipt'); assert.equal((await pending).outcome,'queued');
});
test('socket bridge survives historical shutdown on resume and delivers once', async () => {
 const fs=await import('node:fs/promises'); const os=await import('node:os'); const path=await import('node:path'); const net=await import('node:net');
 const {startBridge}=await import('../scripts/copilot_extension_core.mjs');
 const oldHome=process.env.HOME, home=await fs.mkdtemp('/tmp/rh-copilot-');
 process.env.HOME=home;
 const signals=['SIGTERM','SIGINT']; const before=signals.map(s=>process.listeners(s));
 let observer, calls=0, server;
 try {
  server=await startBridge({sessionId:sid,on(fn){observer=fn;},async getEvents(){return [{type:'session.shutdown'}];},async send(){calls++;return 'socket-receipt';}});
  const response=await new Promise((resolve,reject)=>{
   const client=net.createConnection(server.address());let data='';
   client.on('connect',()=>client.write(JSON.stringify(request)+'\n'));
   client.on('data',part=>data+=part); client.on('error',reject); client.on('end',()=>resolve(JSON.parse(data)));
  });
  assert.equal(response.outcome,'queued');assert.equal(calls,1);
  assert.equal((await fs.stat(server.address())).mode & 0o777,0o600);
 } finally {
  if(server) await new Promise(r=>server.close(r));
  signals.forEach((s,i)=>process.listeners(s).filter(fn=>!before[i].includes(fn)).forEach(fn=>process.removeListener(s,fn)));
  if(oldHome===undefined) delete process.env.HOME; else process.env.HOME=oldHome;
  await fs.rm(home,{recursive:true,force:true});
 }
});
