'use strict';
importScripts('daw-project-worker.js?v=20261111-auto-1');
let socket=null,input=null,returned=null,pendingInput=0;
function fail(message){socket?.close();postMessage({type:'failure',message});}
onmessage=({data})=>{
    if(projectWire.outgoing(data,socket))return;
    if(data.type==='companionStatus'){if(socket?.readyState===WebSocket.OPEN&&typeof data.command==='string'&&/^companion-state:[0-9:]+:[0-9a-f]*$/.test(data.command)&&data.command.length<2300)socket.send(data.command);return;}
    if(data.type==='remoteStatus'){if(socket?.readyState===WebSocket.OPEN&&typeof data.command==='string'&&/^remote-state:[0-9:]+:[0-9a-f]*$/.test(data.command)&&data.command.length<1100)socket.send(data.command);return;}
    if(data.type==='ports'){
        input=data.input;returned=data.returned;pendingInput=0;input.onmessage=({data})=>{if(data.type==='accepted')pendingInput=Math.max(0,pendingInput-1);};input.start();
        returned.onmessage=({data:event})=>{
            if(event.type==='overflow')return fail('FX return fell behind. Reconnect to restart the stream.');
            if(event.type!=='return')return;
            if(socket?.readyState===WebSocket.OPEN){if(socket.bufferedAmount>524288)return fail('FX connection fell behind. Using aligned dry audio.');socket.send(event.buffer);}
            returned.postMessage({type:'recycle',buffer:event.buffer},[event.buffer]);
        };returned.start();
    }
    if(data.type==='connect'){
        if(!Number.isInteger(data.port)||data.port<18731||data.port>18762||!/^[a-f0-9]{32}$/.test(data.token))return fail('Invalid connection code.');
        socket=new WebSocket(`ws://127.0.0.1:${data.port}/stream?token=${data.token}`);socket.binaryType='arraybuffer';
        socket.onopen=()=>postMessage({type:'connected'});
        socket.onmessage=({data:body})=>{
            if(projectWire.incoming(body))return;
            if(body instanceof ArrayBuffer){if(body.byteLength>8216)return fail('Invalid input packet.');if(input){if(pendingInput>=32)return fail('Chrome input processing stalled. Using aligned dry audio.');pendingInput++;input.postMessage({type:'input',buffer:body},[body]);}return;}
            try{const event=JSON.parse(body);if(event.type==='remoteCommand'){postMessage(event);return;}if(event.type==='clock'){if(!event.fx)return fail('This is MYGRAIN Bridge. Use its Chrome → DAW card, or load MYGRAIN FX as an effect.');postMessage(event);}}catch{fail('Invalid FX response.');}
        };
        socket.onerror=()=>fail('Could not connect. Keep MYGRAIN FX open and allow Chrome local-network access if requested. Another tab may own this plugin.');
        socket.onclose=()=>{projectWire.reset();input?.postMessage({type:'reset'});returned?.postMessage({type:'reset'});postMessage({type:'closed'});};
    }
    if(data.type==='command'&&/^(arm|start|stop|ready|not-ready|mix:(100|[0-9]{1,2}))$/.test(data.command)&&socket?.readyState===WebSocket.OPEN)socket.send(data.command);
    if(data.type==='latency')returned?.postMessage({type:'latency',frames:data.frames});
    if(data.type==='disconnect'){projectWire.reset();input?.postMessage({type:'dispose'});returned?.postMessage({type:'dispose'});socket?.close();}
};
