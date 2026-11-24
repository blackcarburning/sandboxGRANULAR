'use strict';
// The bridge worker must not replay an unbounded backlog of obsolete clocks
// after UI-thread preparation. Clock backpressure must never backpressure PCM.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const messages=[],sent=[],portMessages=[];let socket,now=10;
class Socket{
 static OPEN=1;
 constructor(){socket=this;this.readyState=1;this.bufferedAmount=0;}
 send(data){sent.push(data);}
 close(){}
}
const context={WebSocket:Socket,performance:{timeOrigin:1000000,now:()=>now},
 importScripts(){},projectWire:{incoming:()=>false,outgoing:()=>false,reset(){}},
 postMessage:message=>messages.push(message),setTimeout,clearTimeout,ArrayBuffer,DataView,Uint8Array};
const file=process.env.MYGRAIN_BRIDGE_WORKER||path.join(__dirname,'../daw-bridge-worker.js');
vm.runInNewContext(fs.readFileSync(file,'utf8'),context,{filename:file});
const send=data=>context.onmessage({data});
send({type:'connect',port:18731,token:'0'.repeat(32),clockAck:true});
const clock=(epoch,seq)=>socket.onmessage({data:JSON.stringify({type:'clock',epoch,seq,clock:seq*128,rate:48000})});
clock(1,0);assert.equal(messages.length,1);assert.equal(messages[0].receivedAt,1000010);
for(let i=1;i<=100;i++){now=i*25;clock(i, i);}
assert.equal(messages.length,1,'Only one clock may wait on a blocked main thread');
socket.onmessage({data:JSON.stringify({type:'loopStored',id:7})});
assert.equal(messages.at(-1).type,'loopStored','Other protocol events must not wait for a clock acknowledgement');
const port={postMessage:message=>portMessages.push(message),start(){}};
send({type:'port',port});const pcm=new ArrayBuffer(32);port.onmessage({data:{type:'pcm',buffer:pcm}});
assert.equal(sent.at(-1),pcm,'PCM must stream even while the UI clock is unacknowledged');
assert.equal(portMessages.at(-1).type,'recycle');
send({type:'clockAck'});assert.equal(messages.length,3);assert.equal(messages.at(-1).epoch,100);
assert.equal(messages.at(-1).receivedAt,1002500,'Retain receipt time, not later dispatch time');
send({type:'clockAck'});assert.equal(messages.length,3,'Do not repeat an acknowledged clock');
now=2700;clock(101,101);assert.equal(messages.length,4);assert.equal(messages.at(-1).receivedAt,1002700);
send({type:'command',command:'stop'});assert.equal(sent.at(-1),'stop');
assert.equal(sent.filter(x=>x==='clockAck').length,0,'Acknowledgements stay inside the browser');
send({type:'connect',port:18731,token:'0'.repeat(32)});const legacyCount=messages.length;for(let i=0;i<5;i++)clock(200,i);assert.equal(messages.length,legacyCount+5,'Old main scripts must still receive clocks without ACK negotiation');
console.log('PASS legacy compatibility, bounded latest-clock delivery, monotonic receipt timestamps, independent PCM, immediate protocol events and Stop');
