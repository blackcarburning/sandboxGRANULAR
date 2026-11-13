'use strict';
const assert=require('node:assert/strict'),{spawn}=require('node:child_process'),WebSocket=require(require('node:path').join(require('node:path').dirname(require.resolve('playwright-core')),'lib/utilsBundle.js')).ws,fs=require('node:fs');
const origin='http://127.0.0.1:19109';
(async()=>{
 const proc=spawn('/tmp/mygrain-bridge-fixture',[origin,'20']);let text='';proc.stdout.on('data',c=>text+=c);
 try{
  const code=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('fixture timeout')),4000);proc.stdout.on('data',()=>{const m=text.match(/(187\d{2})\.([a-f0-9]{32})/);if(m){clearTimeout(t);resolve(m);}});});
  const url=`ws://127.0.0.1:${code[1]}/stream?token=${code[2]}`;
  async function denied(address,from){return new Promise((resolve,reject)=>{const s=new WebSocket(address,{origin:from});s.on('unexpected-response',(_,r)=>{assert.equal(r.statusCode,403);r.resume();s.terminate();resolve();});s.on('open',()=>reject(Error('Unexpected authorization')));s.on('error',()=>{});});}
  await denied(url.replace(code[2],'0'.repeat(32)),origin);await denied(url,'https://example.com');await denied(url,origin+'/');
  async function open(){return new Promise((resolve,reject)=>{const s=new WebSocket(url,{origin});s.once('open',()=>resolve(s));s.once('error',reject);});}
  const first=await open();const pong= new Promise(resolve=>first.once('pong',resolve));first.ping('rfc6455');assert.equal((await pong).toString(),'rfc6455');first.close();await new Promise(r=>first.once('close',r));
  async function rejectedPacket(create){const s=await open();const clock=await new Promise(resolve=>{s.on('message',body=>{const data=JSON.parse(body);if(data.target)resolve(data);});s.send('ready');s.send('start');});const closed=new Promise(resolve=>s.once('close',resolve));s.send(create(clock));await closed;}
  await rejectedPacket(c=>{const b=Buffer.alloc(24+8);b.writeUInt32LE(0x3141474d);b.writeUInt32LE(c.epoch,4);b.writeUInt32LE(48000,8);b.writeUInt32LE(1,12);b.writeDoubleLE(1,16);return b;});
  await rejectedPacket(c=>{const b=Buffer.alloc(32);b.writeUInt32LE(0x3141474d);b.writeUInt32LE(c.epoch,4);b.writeUInt32LE(0,8);b.writeUInt32LE(1,12);return b;});
  await rejectedPacket(()=>Buffer.alloc(100000));
  async function rejectedText(text){const s=await open(),closed=new Promise(resolve=>s.once('close',resolve));s.send(text);await closed;}
  await rejectedText('prepare:1:48000:4194305:64:120');
  await rejectedText('prepare:1:48000:100:4:120');
  await rejectedText('prepare:1:48000:96000:NaN:120');
  const preparedSocket=await open(),closedPrepared=new Promise(resolve=>preparedSocket.once('close',resolve));preparedSocket.send('prepare:3:48000:96000:4:120');
  const invalid=Buffer.alloc(32);invalid.writeUInt32LE(0x324c474d);invalid.writeUInt32LE(3,4);invalid.writeUInt32LE(48000,8);invalid.writeUInt32LE(1,12);invalid.writeDoubleLE(1,16);preparedSocket.send(invalid);await closedPrepared;
  const report={preparedMemoryCap:true,preparedDurationValidation:true,preparedNonFiniteMetadataRejected:true,preparedInitialFrameRejected:true,wrongTokenDenied:true,untrustedOriginDenied:true,nonExactOriginDenied:true,pingPong:true,missingInitialFrameRejected:true,invalidRateRejected:true,oversizedPacketRejected:true};
  const out=fs.readFileSync('/tmp/mygrain-vst3-output','utf8').trim()+'/evidence';fs.writeFileSync(out+'/protocol.json',JSON.stringify(report,null,2));console.log('PASS',JSON.stringify(report));
 }finally{proc.kill('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1});
