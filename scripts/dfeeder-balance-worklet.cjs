/* Injected only into the disposable shop worker; no new public DSP endpoint. */
class ShopEmberBalance extends AudioWorkletProcessor {
 constructor(options){super();const p=options.processorOptions;Object.assign(this,p);this.drums=new MygrainLoopBalance.Integrated(sampleRate);this.ember=new MygrainLoopBalance.Integrated(sampleRate);this.finalDrums=new MygrainLoopBalance.Integrated(sampleRate);this.finalEmber=new MygrainLoopBalance.Integrated(sampleRate);this.gain=1;this.decided=false;this.finished=false;this.disposed=false;this.port.onmessage=e=>{if(e.data.dispose)this.disposed=true;};}
 process(inputs,outputs){if(this.disposed)return false;const e=inputs[0],d=inputs[1],o=outputs[0];for(let i=0;i<o[0].length;i++){
  const frame=currentFrame+i,el=e[0]?.[i]||0,er=e[1]?.[i]??el,dl=d[0]?.[i]||0,dr=d[1]?.[i]??dl;
  if(frame>=this.startFrame&&frame<this.decisionFrame){this.drums.process(dl*this.drumScale,dr*this.drumScale);this.ember.process(el*this.emberScale,er*this.emberScale);}
  if(!this.decided&&frame>=this.decisionFrame){this.decided=true;try{this.analysis=MygrainLoopBalance.decide(this.drums.result(),this.ember.result(),this.sourceKey==='d'?MygrainLoopBalance.D_POLICY:undefined);this.gain=this.analysis.gain;this.port.postMessage({applied:this.analysis});}catch(e){this.port.postMessage({error:e.message+' '+JSON.stringify({drums:this.drums.result(),ember:this.ember.result()})});}}
  o[0][i]=el*this.gain;o[1][i]=er*this.gain;
  if(frame>=this.captureFrame&&frame<this.endFrame){this.finalDrums.process(dl*this.drumScale,dr*this.drumScale);this.finalEmber.process(el*this.gain*this.emberScale,er*this.gain*this.emberScale);}
  if(!this.finished&&frame>=this.endFrame){this.finished=true;this.port.postMessage({verified:{drums:this.finalDrums.result(),[this.sourceKey||'ember']:this.finalEmber.result()}});}
 }return true;}
}
registerProcessor('mygrain-shop-ember-balance-v1',ShopEmberBalance);

// One clock/window for all families: measure actual final source routes, decide
// drum makeup first, then compare E/D to that corrected post-FX drum reference.
class ShopPostFxBalance extends AudioWorkletProcessor {
 constructor(options){super();Object.assign(this,options.processorOptions);this.gains={drums:1,ember:1,d:1,restructure:1};this.measures={};this.final={};this.keys=['raw','drums',...(this.hasEmber===false?[]:['ember']),...(this.hasD?['d']:[]),...(this.hasRestructure?['restructure']:[])];this.sums=Object.fromEntries(this.keys.map(key=>[key,new Float64Array(2)]));for(const key of this.keys){this.measures[key]=new MygrainLoopBalance.Integrated(sampleRate);this.final[key]=new MygrainLoopBalance.Integrated(sampleRate);}this.decided=false;this.finished=false;this.disposed=false;this.port.onmessage=e=>{if(e.data.dispose)this.disposed=true;};}
 process(inputs,outputs){if(this.disposed)return false;for(let i=0;i<outputs[0][0].length;i++){
  const frame=currentFrame+i,sums=this.sums;for(const key of this.keys)sums[key].fill(0);
  for(let n=0;n<this.routes.length;n++){const route=this.routes[n],input=inputs[n],l=input[0]?.[i]||0,r=input[1]?.[i]??l;sums[route.family][0]+=l*route.scale;sums[route.family][1]+=r*route.scale;}
  const raw=inputs[this.routes.length],rl=raw[0]?.[i]||0,rr=raw[1]?.[i]??rl;sums.raw[0]=rl*this.rawScale;sums.raw[1]=rr*this.rawScale;
  if(frame>=this.startFrame&&frame<this.decisionFrame)for(const key of this.keys)this.measures[key].process(sums[key][0],sums[key][1]);
  if(!this.decided&&frame>=this.decisionFrame){this.decided=true;try{
   const metric=Object.fromEntries(Object.entries(this.measures).map(([key,m])=>[key,m.result()]));
   const makeup=MygrainLoopBalance.drumMakeup(metric.raw,metric.drums,this.drumEffected);this.gains.drums=makeup.gain;const drums=MygrainLoopBalance.scaleMetric(metric.drums,makeup.gain);
   const ember=this.hasEmber===false?null:MygrainLoopBalance.decide(drums,metric.ember);if(ember)this.gains.ember=ember.gain;
   const d=this.hasD?MygrainLoopBalance.decide(drums,metric.d,MygrainLoopBalance.D_POLICY):null;if(d)this.gains.d=d.gain;
   const restructure=this.hasRestructure?MygrainLoopBalance.decide(drums,metric.restructure,{...MygrainLoopBalance.R_POLICY,startLevel:this.restructureLevel}):null;if(restructure)this.gains.restructure=restructure.gain;
   this.port.postMessage({applied:{ember,d,restructure,drumMakeup:makeup,referenceTap:'post-fx',sourceTap:'post-fx'}});
  }catch(e){this.port.postMessage({error:e.message});}}
  for(let n=0;n<this.routes.length;n++){const input=inputs[n],l=input[0]?.[i]||0,r=input[1]?.[i]??l,gain=this.gains[this.routes[n].family];outputs[n][0][i]=l*gain;outputs[n][1][i]=r*gain;}
  if(frame>=this.captureFrame&&frame<this.endFrame)for(const key of this.keys){const gain=this.gains[key]||1;this.final[key].process(sums[key][0]*gain,sums[key][1]*gain);}
  if(!this.finished&&frame>=this.endFrame){this.finished=true;this.port.postMessage({verified:Object.fromEntries(Object.entries(this.final).map(([key,m])=>[key,m.result()]))});}
 }return true;}
}
registerProcessor('mygrain-shop-postfx-balance-v1',ShopPostFxBalance);
