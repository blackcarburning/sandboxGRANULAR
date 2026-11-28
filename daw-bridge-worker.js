'use strict';
importScripts('daw-project-worker.js?v=20261111-auto-1');
importScripts('cicada-core.js?v=20261128-cicada-clock-1');
let socket=null,port=null,upload=null,uploadTimer=null,latestClock=null,clockPending=false,boundedClocks=false;
let cicadaMidi=null,cicadaOrigin=null;
function stopCicadaMidi(){cicadaMidi=null;cicadaOrigin=null;}
function sendCicadaCancel(){if(socket?.readyState===WebSocket.OPEN)socket.send('midi-cancel:3');}
function tickCicada(info){
    if(!cicadaMidi||info.epoch!==cicadaOrigin.epoch||!info.playing||!info.armed||!info.target||info.prepared||info.offline)return;
    cicadaMidi.tick(info);
}
// Keep at most one unacknowledged clock on the UI queue. Graph preparation can
// block that queue; intermediate native generations are no longer actionable.
function sendClock(){
    if(clockPending||!latestClock)return;
    const clock=latestClock;latestClock=null;clockPending=boundedClocks;postMessage(clock);
}
function cancelUpload(){if(uploadTimer)clearTimeout(uploadTimer);uploadTimer=null;upload=null;}
function sendLoopChunk(){
    uploadTimer=null;if(!upload||socket?.readyState!==WebSocket.OPEN)return;
    if(socket.bufferedAmount>262144){uploadTimer=setTimeout(sendLoopChunk,8);return;}
    const u=upload,n=Math.min(4096,u.frames-u.cursor),packet=new ArrayBuffer(24+n*8),header=new DataView(packet);
    header.setUint32(0,0x324c474d,true);header.setUint32(4,u.id,true);header.setUint32(8,u.rate,true);header.setUint32(12,n,true);header.setFloat64(16,u.cursor,true);
    new Uint8Array(packet,24).set(new Uint8Array(u.buffer,u.cursor*8,n*8));socket.send(packet);u.cursor+=n;
    if(u.cursor<u.frames)uploadTimer=setTimeout(sendLoopChunk,0);else upload=null;
}
function fail(message){cancelUpload();port?.postMessage({type:'stop'});socket?.close();postMessage({type:'failure',message});}
onmessage=({data})=>{
    if(data.type==='clockAck'){clockPending=false;sendClock();return;}
    if(data.type==='cicadaMidi'){
        if(data.action==='stop'){stopCicadaMidi();sendCicadaCancel();return;}
        if(data.action==='start'){
            cicadaOrigin=data.origin;
            cicadaMidi=MygrainCicadaCore.midiScheduler(data.state,cicadaOrigin,event=>{
                if(socket?.readyState!==WebSocket.OPEN)return;
                socket.send(`${event.pitch==null?'expr':'midi'}:${cicadaOrigin.epoch}:3:${event.pitch??event.control}:${event.velocity??event.value}:${event.frame}:${event.end}`);
            },sendCicadaCancel);
        }
        cicadaMidi?.update(data.state,data.suppressed);return;
    }
    if(projectWire.outgoing(data,socket))return;
    if(data.type==='companionStatus'){if(socket?.readyState===WebSocket.OPEN&&typeof data.command==='string'&&/^companion-state:[0-9:]+:[0-9a-f]*$/.test(data.command)&&data.command.length<2300)socket.send(data.command);return;}
    if(data.type==='remoteStatus'){if(socket?.readyState===WebSocket.OPEN&&typeof data.command==='string'&&/^remote-state:[0-9:]+:[0-9a-f]*$/.test(data.command)&&data.command.length<1100)socket.send(data.command);return;}
    if(data.type==='port'){
        port=data.port;
        port.onmessage=({data:event})=>{
            if(event.type==='overflow')return fail('Audio capture fell behind. Stop and reconnect.');
            if(event.type!=='pcm')return;
            if(socket?.readyState===WebSocket.OPEN){
                if(socket.bufferedAmount>524288){port.postMessage({type:'recycle',buffer:event.buffer},[event.buffer]);return fail('Local connection fell behind. Stop and reconnect.');}
                socket.send(event.buffer);
            }
            port.postMessage({type:'recycle',buffer:event.buffer},[event.buffer]);
        };
        port.start();
    }
    if(data.type==='connect'){
        stopCicadaMidi();
        boundedClocks=data.clockAck===true;latestClock=null;clockPending=false;
        if(!Number.isInteger(data.port)||data.port<18731||data.port>18762||!/^[a-f0-9]{32}$/.test(data.token))return fail('Invalid connection code.');
        socket=new WebSocket(`ws://127.0.0.1:${data.port}/stream?token=${data.token}`);
        socket.binaryType='arraybuffer';
        socket.onopen=()=>postMessage({type:'connected'});
        socket.onmessage=({data:body})=>{if(projectWire.incoming(body))return;try{const event=JSON.parse(body);if(event.type==='clock'){tickCicada(event);event.receivedAt=performance.timeOrigin+performance.now();latestClock=event;sendClock();}else if(['loopStored','loopRejected','remoteCommand'].includes(event.type))postMessage(event);}catch{fail('Invalid bridge response.');}};
        socket.onerror=()=>fail('Could not connect. Keep the plugin open and allow Chrome local-network access if prompted. Another browser may already control this plugin; disconnect it first.');
        socket.onclose=()=>{stopCicadaMidi();projectWire.reset();cancelUpload();port?.postMessage({type:'stop'});postMessage({type:'closed'});};
    }
    if(data.type==='prepareLoop'){
        if(socket?.readyState!==WebSocket.OPEN||!Number.isInteger(data.id)||data.id<1||data.id>0xffffffff||!Number.isInteger(data.frames)||data.frames<1||data.frames>4*1024*1024||!(data.buffer instanceof ArrayBuffer)||data.buffer.byteLength!==data.frames*8||!Number.isInteger(data.rate)||data.rate<8000||data.rate>192000||!Number.isFinite(data.beats)||data.beats<1||data.beats>64||!Number.isFinite(data.bpm)||data.bpm<1||data.bpm>300)return fail('Invalid prepared-loop upload.');
        cancelUpload();port?.postMessage({type:'stop'});upload={...data,cursor:0};
        socket.send(`prepare:${data.id}:${data.rate}:${data.frames}:${data.beats}:${data.bpm}`);sendLoopChunk();
    }
    if(data.type==='capture')port?.postMessage({type:'start',epoch:data.epoch,startFrame:data.startFrame});
    if(data.type==='stopCapture')port?.postMessage({type:'stop'});
    if(data.type==='cardMidi'&&socket?.readyState===WebSocket.OPEN){
        if(data.fields.length===1)socket.send(`midi-cancel:${data.fields[0]}`);
        else if(socket.bufferedAmount<524288)socket.send(`${data.expression?'expr':'midi'}:${data.fields.join(':')}`);
    }
    if(data.type==='cicadaLfoCc'&&socket?.readyState===WebSocket.OPEN&&Number.isInteger(data.slot)&&data.slot>=0&&data.slot<4){
        if(data.value===null)socket.send(`cicada-lfo:${data.slot}:0`);
        else if(Number.isInteger(data.value)&&data.value>=0&&data.value<=127&&socket.bufferedAmount<524288)socket.send(`cicada-lfo:${data.slot}:${data.value+1}`);
    }
    if(data.type==='command'&&['arm','start','stop','live','rendered','ready','not-ready','hold'].includes(data.command)&&socket?.readyState===WebSocket.OPEN)socket.send(data.command);
    if(data.type==='disconnect'){stopCicadaMidi();projectWire.reset();cancelUpload();port?.postMessage({type:'stop'});socket?.close();}
};
