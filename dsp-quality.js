/* Live-only reduced-rate adapter. Factor 1 delegates without touching PCM.
 * The host alone selects quality; it is never a saved DSP/patch setting.
 * A 17-tap windowed-sinc anti-alias filter precedes 2:1 decimation; linear
 * reconstruction is causal and stereo/sidechain topology stays intact. */
(function(root){'use strict';
const taps=17,kernel=Float64Array.from({length:taps},(_,i)=>{const x=i-8;return(x?Math.sin(2*Math.PI*.2*x)/(Math.PI*x):.4)*(.5-.5*Math.cos(2*Math.PI*i/(taps-1)));});
const total=kernel.reduce((a,b)=>a+b,0);for(let i=0;i<taps;i++)kernel[i]/=total;
class Quality{
 constructor(factory,rate,divisor=1){this.divisor=divisor===2?2:1;this.rate=rate/this.divisor;this.engine=factory(this.rate);this.inputs=[];this.outputs=[];this.history=[];this.last=[];this.engineFrames=0;}
 process(inputs,outputs,frame=0){
  if(this.divisor===1)return this.engine.process(inputs,outputs,frame);
  const frames=outputs[0]?.[0]?.length||128,n=frames/2;
  for(let b=0;b<Math.max(inputs.length,this.inputs.length);b++){
   const input=inputs[b]||[];this.inputs[b]||=[];this.history[b]||=[];
   for(let ch=0;ch<Math.max(input.length,this.inputs[b].length);ch++){
    let data=this.inputs[b][ch];if(!data||data.length!==n)this.inputs[b][ch]=data=new Float32Array(n);
    const h=this.history[b][ch]||=( {data:new Float32Array(taps),at:0} ),source=input[ch];
    for(let j=0;j<n;j++){for(let k=0;k<2;k++){h.data[h.at]=source?.[j*2+k]||0;h.at=(h.at+1)%taps;}let value=0,at=(h.at+taps-1)%taps;for(let k=0;k<taps;k++){value+=kernel[k]*h.data[at];if(--at<0)at=taps-1;}data[j]=value;}
   }
  }
  for(let b=0;b<outputs.length;b++){this.outputs[b]||=[];this.last[b]||=[];for(let ch=0;ch<outputs[b].length;ch++){let a=this.outputs[b][ch];if(!a||a.length!==n)this.outputs[b][ch]=a=new Float32Array(n);else a.fill(0);}}
  const alive=this.engine.process(this.inputs,this.outputs,Math.floor(frame/2));this.engineFrames+=n;
  for(let b=0;b<outputs.length;b++)for(let ch=0;ch<outputs[b].length;ch++){const target=outputs[b][ch],source=this.outputs[b][ch];let previous=this.last[b][ch]||0;for(let j=0;j<n;j++){const next=source[j];target[2*j]=(previous+next)*.5;target[2*j+1]=next;previous=next;}this.last[b][ch]=previous;}
  return alive;
 }
 clear(){this.engine.clear?.();for(const bus of this.history)for(const h of bus){h.data.fill(0);h.at=0;}for(const a of this.last)a.fill(0);}
 dispose(){this.engine.dispose();this.inputs=[];this.outputs=[];this.history=[];this.last=[];}
}
root.MygrainDspQuality=Quality;if(typeof module==='object'&&module.exports)module.exports=Quality;
})(globalThis);
