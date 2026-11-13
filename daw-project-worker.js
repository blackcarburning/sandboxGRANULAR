/* Shared worker-only project transfer. Never forwards credentials or uses HTTP. */
'use strict';
const projectWire=(()=>{
 const max=128*1024*1024+65552;let upload=null,download=null,timer=null;
 const table=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);return c>>>0;});
 function crc(buffer){let c=0xffffffff;for(const b of new Uint8Array(buffer))c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
 function reset(){if(timer)clearTimeout(timer);timer=null;upload=null;download=null;}
 function error(message){reset();postMessage({type:'projectError',message});}
 function chunk(){timer=null;if(!upload)return;const u=upload;if(u.socket.readyState!==WebSocket.OPEN)return error('Plugin disconnected; previous snapshot retained.');if(u.socket.bufferedAmount>262144){timer=setTimeout(chunk,8);return;}
  const n=Math.min(32752,u.buffer.byteLength-u.cursor),packet=new ArrayBuffer(16+n),v=new DataView(packet);v.setUint32(0,0x3153474d,true);v.setUint32(4,u.id,true);v.setUint32(8,u.cursor,true);v.setUint32(12,n,true);new Uint8Array(packet,16).set(new Uint8Array(u.buffer,u.cursor,n));u.socket.send(packet);u.cursor+=n;u.wire+=packet.byteLength;if(u.cursor===u.buffer.byteLength||performance.now()-(u.progressAt||0)>250){u.progressAt=performance.now();postMessage({type:'projectProgress',id:u.id,sent:u.cursor,bytes:u.buffer.byteLength});}if(u.cursor===u.buffer.byteLength)postMessage({type:'projectTransferStats',id:u.id,bytes:u.wire});if(u.cursor<u.buffer.byteLength)timer=setTimeout(chunk,0);else upload=null;
 }
 function outgoing(data,socket){
  if(!['storeProject','getProject','projectRestored'].includes(data.type))return false;
  if(socket?.readyState!==WebSocket.OPEN){error('Plugin is not connected.');return true;}
  if(data.type==='storeProject'){
   if(!(data.buffer instanceof ArrayBuffer)||data.buffer.byteLength<20||data.buffer.byteLength>max||!Number.isInteger(data.id)||data.id<1)return error('Invalid project snapshot.'),true;
   reset();const hash=Number.isInteger(data.hash)?data.hash:crc(data.buffer);const command=data.delta?`project-delta:${data.id}:${data.buffer.byteLength}:${hash}:${data.rendered?1:0}:${data.revision}`:`project-begin:${data.id}:${data.buffer.byteLength}:${hash}:${data.rendered?1:0}`;upload={...data,cursor:0,socket,wire:new TextEncoder().encode(command).length};socket.send(command);chunk();
  }else if(data.type==='getProject'){
   if(!Number.isInteger(data.id)||data.id<1||!Number.isInteger(data.revision)||data.revision<1)return error('Invalid project revision.'),true;
   reset();download={id:data.id,revision:data.revision,buffer:null,cursor:0};socket.send(`project-get:${data.id}:${data.revision}`);
  }else if(Number.isInteger(data.revision)&&data.revision>0)socket.send('project-restored:'+data.revision);
  return true;
 }
 function incoming(body){
  if(body instanceof ArrayBuffer){
   const v=new DataView(body);if(body.byteLength<4||v.getUint32(0,true)!==0x3153474d)return false;
   const d=download;if(body.byteLength<16||!d?.buffer||v.getUint32(4,true)!==d.id||v.getUint32(8,true)!==d.cursor||v.getUint32(12,true)!==body.byteLength-16||d.cursor+body.byteLength-16>d.buffer.byteLength){error('Incomplete project data.');return true;}
   new Uint8Array(d.buffer,d.cursor).set(new Uint8Array(body,16));d.cursor+=body.byteLength-16;
   if(d.cursor===d.buffer.byteLength){download=null;if(crc(d.buffer)!==d.crc){error('Project checksum did not match.');return true;}postMessage({type:'projectSnapshot',id:d.id,revision:d.revision,buffer:d.buffer},[d.buffer]);}return true;
  }
  let event;try{event=JSON.parse(body);}catch{return false;}
  if(event.type==='projectData'){
   const d=download;if(!d||event.id!==d.id||event.revision!==d.revision||!Number.isInteger(event.bytes)||event.bytes<20||event.bytes>max||!Number.isInteger(event.crc)){error('Invalid project data.');return true;}
   try{d.buffer=new ArrayBuffer(event.bytes);d.crc=event.crc;}catch{error('Not enough memory to restore the project.');}return true;
  }
  if(['projectStored','projectError'].includes(event.type)){postMessage(event);return true;}return false;
 }
 return {outgoing,incoming,reset};
})();
