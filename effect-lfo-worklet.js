import './dsp-quality.js?v=20261115-low-power-1';
/*
 * Copyright (C) 2013 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */


import './effect-inputs.js?v=20261122-glasshaus-1';
import './heavy-lifter-dsp.js?v=20261114-heavy-lfo-3';
import './effect-lfo.js?v=20261114-liquidizer-1';
import './character-fx.js?v=20261114-insert-routing-1';
import './mutilator-dsp.js?v=20261114-insert-routing-1';
import './effect-lfo-transfer.js?v=20261114-liquidizer-1';
class ControlEngine{
 constructor(rate,o){this.rate=rate;this.key=o.key;this.control=new MygrainEffectLfo.Control(o.key,rate,o.settings);for(const c of o.clocks||[])this.control.syncClock(c);this.alive=true;this.configure(o.settings);}
 configure(s){this.strain=MygrainBassFace.STRAINS.find(p=>p.id===s.strain);}
 process(inputs,outputs,frame){if(!this.alive)return false;const c=this.control,key=this.key,p=this.strain,n=outputs[0][0].length;for(let i=0;i<n;i++){const t=(frame+i)/this.rate;c.update(t);const s=c.effective,bpm=c.clock(t).bpm,active=s.amount>0&&s.mix>0;outputs[0][0][i]=active?1-s.mix:1;outputs[1][0][i]=(active?s.mix:0)*(key==='bassFace'?p.trim:.5);outputs[2][0][i]=key==='bassFace'&&active?s.mix*s.body*p.body:0;outputs[3][0][i]=key==='bassFace'?Math.min(sampleRate*.4,p.band*(.65+s.tone*1.3)):Math.min(sampleRate*.42,120*Math.pow(100,s.tone));outputs[4][0][i]=key==='bassFace'?500*2**(s.tone*4):0;const q=s.strain==='melt'?1+s.amount*4:.7+s.amount;outputs[5][0][i]=key==='mutilator'?Math.min(16,q*2**((s.resonance-.5)*4)):0;outputs[6][0][i]=s.amount;outputs[7][0][i]=key==='bassFace'?500+s.amount*1800:s.rhythm?(['rupture','hollow'].includes(s.strain)?-1:1)*(1500+s.amount*3300)*s.sweep:3600*s.freeDepth*s.sweep;outputs[8][0][i]=key==='bassFace'?bpm/120:s.rhythm?bpm/120*4/s.cycleBeats:2*s.freeRate;outputs[9][0][i]=key==='mutilator'?10**(s.output/20):1;}return true;}
 dispose(){this.alive=false;}
}
class EffectControl extends AudioWorkletProcessor{
 constructor(options){super();const o=options.processorOptions;this.quality=new MygrainDspQuality(rate=>new ControlEngine(rate,o),sampleRate,o.quality);const engine=this.quality.engine;this.port.onmessage=({data})=>{if(data.dispose){this.quality.dispose();this.port.postMessage({disposed:true});}else if(data.settings){engine.control.set(data.settings);engine.configure(data.settings);}if(data.clock)engine.control.syncClock(data.clock);};}
 process(inputs,outputs){return this.quality.process(inputs,outputs,currentFrame);}
}
registerProcessor('mygrain-effect-lfo-control-v1',EffectControl);
// The existing 2x Mutilator oversampling topology is retained (128-frame total
// linear-phase latency); non-oversampled graphs add no audio delay. See license.
const upKernel=new Float32Array(128),downKernel=new Float32Array(128);
for(let i=0;i<128;i++){let s=Math.PI*(i-63.5),x=(i+.5)/128;upKernel[i]=Math.sin(s)/s*(.42-.5*Math.cos(2*Math.PI*x)+.08*Math.cos(4*Math.PI*x));const j=2*i+1;s=.5*Math.PI*(j-128);x=j/256;downKernel[i]=.5*Math.sin(s)/s*(.42-.5*Math.cos(2*Math.PI*x)+.08*Math.cos(4*Math.PI*x));}
class EffectShaper extends AudioWorkletProcessor{
 constructor(options){super();const o=options.processorOptions;this.key=o.key;this.strain=o.settings.strain;this.base=o.settings.amount;this.over=o.oversample==='2x';this.alive=true;this.history=Array.from({length:2},()=>({input:new Float32Array(128),odd:new Float32Array(128),even:new Float32Array(128),lastOdd:0,pos:0}));this.port.onmessage=({data})=>{if(data.dispose){this.alive=false;this.port.postMessage({disposed:true});}};}
 process(inputs,outputs){if(!this.alive)return false;const x=inputs[0]||[],amount=inputs[1]?.[0],out=outputs[0],lookup=MygrainEffectLfoTransfer.lookup;for(let ch=0;ch<out.length;ch++){const a=x[ch]||x[0],h=this.history[ch];for(let i=0;i<out[ch].length;i++){const v=a?.[i]||0,m=amount?.[i]??this.base;if(!this.over){out[ch][i]=lookup(this.key,this.strain,v,m);continue;}const pos=h.pos;h.input[pos]=v;let u=0;for(let k=0;k<128;k++)u+=upKernel[k]*h.input[(pos-k+128)&127];const even=lookup(this.key,this.strain,h.input[(pos-64+128)&127],m),odd=lookup(this.key,this.strain,Math.fround(u),m);h.odd[pos]=h.lastOdd;h.lastOdd=odd;h.even[pos]=even;let d=0;for(let k=0;k<128;k++)d+=downKernel[k]*h.odd[(pos-k+128)&127];out[ch][i]=Math.fround(Math.fround(d)+.5*h.even[(pos-64+128)&127]);h.pos=(pos+1)&127;}}return true;}
}
registerProcessor('mygrain-effect-lfo-shaper-v1',EffectShaper);
