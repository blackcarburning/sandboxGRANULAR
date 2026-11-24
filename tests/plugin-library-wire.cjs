/* Diagnostic native-wire substitute. Real app/graph/render/codec/server; NOT native PCM. */
module.exports=function(){
 const Native=Worker;
 window.Worker=class extends Native{
  constructor(url,...args){
   if(!/daw-(fx|bridge)-worker\.js/.test(String(url)))return new Native(url,...args);
   const fx=String(url).includes('daw-fx');
   return new class{
    constructor(){this.armed=false;this.ready=false;this.epoch=1;this.revision=0;this.buffer=null;this.loopRevision=0;this.rendered=false;this.frames=0;this.commands=[];window.pluginDiagnosticWire=this;}
    emit(data){this.onmessage?.({data});}
    clock(){this.emit({type:'clock',protocol:2,fx,active:true,armed:this.armed,browserReady:this.ready,running:this.ready&&this.armed,playing:false,offline:false,bypass:false,tempo:120,rate:48000,musical:true,mix:1,clock:48000,epoch:this.epoch,latencyMs:1000,missingBlocks:7,lateReturns:2,inputDrops:0,bufferMs:350,driftPpm:0,projectTransfer:2,projectState:1,projectRevision:this.revision,projectBytes:this.buffer?.byteLength||0,projectRendered:this.rendered,prepared:this.rendered,loopFrames:this.frames,loopRevision:this.loopRevision,stickyArm:true,continuousLive:true,selectRendered:true});}
    postMessage(d){
     if(d.type==='connect'){queueMicrotask(()=>this.emit({type:'connected'}));this.timer=setInterval(()=>this.clock(),50);}
     if(d.type==='command'){this.commands.push(d.command);if(d.command==='arm'||d.command==='start')this.armed=true;if(d.command==='stop')this.armed=false;if(d.command==='live')this.rendered=false;if(d.command==='ready'||d.command==='not-ready'){this.ready=d.command==='ready';this.epoch++;}}
     if(d.type==='prepareLoop'){this.frames=d.frames;this.rendered=true;this.loopRevision++;const pcm=new Float32Array(d.buffer);this.renderPeak=pcm.reduce((n,x)=>Math.max(n,Math.abs(x)),0);setTimeout(()=>{this.clock();this.emit({type:'loopStored',id:d.id});},50);}
     if(d.type==='storeProject')setTimeout(()=>{if(this.fail)return this.emit({type:'projectError',id:d.id,message:'Isolated native rejection'});const v=new DataView(d.buffer);if(v.getUint32(0,true)===0x3150474d)this.buffer=d.buffer;else{const out=new Uint8Array(v.getUint32(8,true));let at=16,pos=0;for(let i=0;i<v.getUint32(12,true);i++){const kind=v.getUint32(at,true),off=v.getUint32(at+4,true),n=v.getUint32(at+8,true);at+=12;out.set(kind?new Uint8Array(this.buffer,off,n):new Uint8Array(d.buffer,at,n),pos);if(!kind)at+=n;pos+=n;}this.buffer=out.buffer;}this.revision++;this.emit({type:'projectStored',id:d.id,revision:this.revision});},10);
     if(d.type==='getProject')setTimeout(()=>this.emit({type:'projectSnapshot',id:d.id,revision:this.revision,buffer:this.buffer.slice(0)}),10);
     if(d.type==='disconnect')this.terminate();
    }
    terminate(){clearInterval(this.timer);}
   };
  }
 };
};
