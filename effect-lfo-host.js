/* Native filters/gains remain in their original order. Only their controls move. */
(function(root){'use strict';
const D=root.MygrainEffectLfo,modules=new WeakMap(),graphs=new Set();
async function prepare(context){if(!context)return;const ctx=context.__mygrainNativeContext||context;if(!modules.has(ctx)){const p=ctx.audioWorklet.addModule(new URL('effect-lfo-worklet.js?v=20261122-glasshaus-1',document.baseURI));modules.set(ctx,p);p.catch(()=>modules.delete(ctx));}await modules.get(ctx);}
function createGraph(key,context,source,destination,clock={}){
 const ctx=context.__mygrainNativeContext||context;let nodes=[],controller=null,pulse=null,signature='',current=null;
 const unlink=()=>{for(const n of nodes){try{source.disconnect(n);}catch{}try{n.disconnect();}catch{}if(n.port){n.port.postMessage({dispose:true});n.port.onmessage=()=>{try{n.port.close();}catch{}};}}if(pulse){try{pulse.stop();}catch{}pulse=null;}nodes=[];controller=null;signature='';};
 const own=n=>(nodes.push(n),n),gain=()=>own(context.createGain()),filter=()=>own(context.createBiquadFilter());
 const connect=(slot,param)=>{param.value=0;controller.connect(param,slot);};
 function set(value){current=value;const amount=D.canMove(key,value,'amount'),sig=JSON.stringify([value.strain,value.rhythm,value.filter||'auto',!!(value.rhythm||(key==='mutilator'&&(value.freeDepth||D.canMove(key,value,'freeDepth')))),amount,amount?null:value.amount,clock.oversample||'2x',root.mygrainPower?.divisor(ctx)||1]);if(sig===signature&&controller){controller.port.postMessage({settings:value});return;}
  unlink();const history=clock.clocks||root.mygrainWasp?.clockHistory(ctx)||[{origin:clock.origin||0,bpm:clock.bpm||120,at:clock.time||0}];
  controller=own(new AudioWorkletNode(ctx,'mygrain-effect-lfo-control-v1',{numberOfInputs:0,numberOfOutputs:10,outputChannelCount:Array(10).fill(1),processorOptions:{quality:root.mygrainPower?.divisor(ctx)||1,key,settings:value,clocks:history}}));
  const dry=gain(),wet=gain(),pre=filter(),dc=filter(),post=key==='bassFace'?filter():null,trim=gain();source.connect(dry);dry.connect(destination);connect(0,dry.gain);connect(1,wet.gain);connect(9,trim.gain);
  let shaper;
  if(amount){shaper=own(new AudioWorkletNode(ctx,'mygrain-effect-lfo-shaper-v1',{numberOfInputs:2,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit',processorOptions:{key,settings:value,oversample:key==='mutilator'?(clock.oversample||'2x'):'none'}}));controller.connect(shaper,6,1);}
  else{shaper=own(context.createWaveShaper());const n=key==='bassFace'?8193:2049,curve=new Float32Array(n);for(let i=0;i<n;i++)curve[i]=root.MygrainEffectLfoTransfer.shape(key,value.strain,i/(n-1)*2-1,value.amount);shaper.curve=curve;shaper.oversample=key==='bassFace'?'none':clock.oversample||'2x';}
  if(key==='bassFace'){
   const p=root.MygrainBassFace.STRAINS.find(p=>p.id===value.strain),low=filter(),body=gain();low.type='lowpass';low.frequency.value=110;low.Q.value=.707;source.connect(low);low.connect(body);body.connect(clock.wetDestination||destination);connect(2,body.gain);pre.type='lowpass';pre.Q.value=.707;connect(3,pre.frequency);dc.type='highpass';dc.frequency.value=p.lowcut;dc.Q.value=.707;post.type='lowpass';post.Q.value=.707;connect(4,post.frequency);source.connect(pre);pre.connect(shaper);shaper.connect(dc);dc.connect(post);post.connect(wet);
  }else{
   pre.type=value.filter&&value.filter!=='auto'?value.filter:['melt','splinter','shred'].includes(value.strain)?'bandpass':['rupture','hollow','maw'].includes(value.strain)?'highpass':value.strain==='vortex'?'notch':'lowpass';connect(3,pre.frequency);connect(5,pre.Q);dc.type='highpass';dc.frequency.value=25;dc.Q.value=.5;source.connect(pre);pre.connect(shaper);shaper.connect(dc);dc.connect(wet);
  }
  wet.connect(trim);trim.connect(clock.wetDestination||destination);
  const motion=value.rhythm||(key==='mutilator'&&(value.freeDepth||D.canMove(key,value,'freeDepth')));
  if(motion){const depth=gain(),buffer=context.createBuffer(1,16384,8192),data=buffer.getChannelData(0);if(key==='bassFace'){const i=root.MygrainBassFace.STRAINS.findIndex(p=>p.id===value.strain);for(let j=0;j<data.length;j++){const cell=Math.floor(j/1024),phase=j/1024-cell,accent=((cell*(i%5+1)+i)%7)<3?1:.2;data[j]=accent*Math.min(1,phase/.025)*Math.pow(1-phase,1+i%4);}}
   else if(value.rhythm){const strain=value.strain,pattern=root.MygrainMutilator.patterns[strain];for(let j=0;j<data.length;j++){const cell=j/1024,index=Math.floor(cell),phase=cell-index,attack=Math.min(1,phase/.016),release=Math.min(1,(1-phase)/.025),envelope=strain==='melt'?Math.sin(Math.PI*phase):strain==='scab'?Math.floor((1-phase)*4)/4:Math.pow(1-phase,strain==='hollow'?1.15:strain==='venom'?2:3);data[j]=-1+2*pattern[index]*attack*envelope*release;}}
   else for(let j=0;j<data.length;j++)data[j]=Math.sin(2*Math.PI*j/data.length);
   pulse=own(context.createBufferSource());pulse.buffer=buffer;pulse.loop=true;connect(8,pulse.playbackRate);connect(7,depth.gain);pulse.connect(depth);depth.connect((post||pre).detune);const snapshot=clock.snapshot?.()||history.filter(c=>c.at<=ctx.currentTime).at(-1)||history[0],bpm=snapshot.bpm||120,origin=snapshot.origin||0,time=Math.max(ctx.currentTime,Number(clock.time)||0),rate=key==='bassFace'?bpm/120:value.rhythm?bpm/120*4/(value.cycleBeats||4):2*(value.freeRate||1),offset=(((time-origin)*rate)%2+2)%2;pulse.start(time,offset);
  }
  signature=sig;
 }
 const api={set,dispose(){unlink();graphs.delete(api);},syncClock(c){controller?.port.postMessage({clock:c});},get active(){return!!controller},get dryControl(){return controller},get clock(){return current?{...clock.snapshot?.(),lfo:D.normalize(key,current.lfo)}:null}};graphs.add(api);return api;
}
root.mygrainEffectLfo={prepare,createGraph,syncClock(c){for(const g of graphs)g.syncClock(c);},diagnostics:()=>({graphs:graphs.size}),release(){for(const g of [...graphs])g.dispose();}};
root.addEventListener?.('mygrain-account-lock',()=>root.mygrainEffectLfo.release());
root.addEventListener?.('pagehide',()=>root.mygrainEffectLfo.release());
})(globalThis);
