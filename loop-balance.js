/* Shared generation analysis. Native Master Baker K-weighting, not RMS. */
(function(root){
'use strict';
const Master=typeof module==='object'?require('./mastering-dsp.js'):root.MygrainMasterDSP;
const POLICY={version:1,startLevel:.4,targetLu:-6,minGain:.0001,maxGain:2.5,quietLufs:-55};
class Integrated {
 constructor(rate){this.meter=new Master.OutputLoudness(rate);this.hop=Math.round(rate*.1);this.blocks=[];this.peak=0;this.sum=0;this.frames=0;}
 process(l,r){if(!Number.isFinite(l)||!Number.isFinite(r))throw Error('Invalid analysis PCM');const m=this.meter;m.process(l,r);this.peak=Math.max(this.peak,Math.abs(l),Math.abs(r));this.sum+=l*l+r*r;this.frames++;if(m.frames>=m.mFrames&&(m.frames-m.mFrames)%this.hop===0){if(this.blocks.length>=512)throw Error('Analysis window exceeded');this.blocks.push(m.m/m.mFrames);}}
 result(){const absolute=this.blocks.filter(e=>e>10**((-70+.691)/10));let lufs=null;if(absolute.length){const gate=absolute.reduce((a,b)=>a+b,0)/absolute.length*.1,relative=absolute.filter(e=>e>gate);if(relative.length)lufs=-.691+10*Math.log10(relative.reduce((a,b)=>a+b,0)/relative.length);}return{lufs,peak:this.peak,rms:Math.sqrt(this.sum/Math.max(1,2*this.frames)),frames:this.frames};}
}
const D_POLICY={...POLICY,startLevel:1,targetLu:0,maxGain:1,sourceKey:'d'};
const R_POLICY={...D_POLICY,startLevel:.7,sourceKey:'restructure'};
function decide(drums,ember,policy=POLICY){
 if(!Number.isFinite(drums.lufs)||drums.rms<1e-7)throw Error('Drum reference is silent; retrying the loop');
 if(!Number.isFinite(ember.lufs)||ember.rms<1e-7)throw Error((policy.sourceKey==='d'?'D':policy.sourceKey==='restructure'?'Restructure':'Ember')+' reference is silent; retrying the patch');
 // Fixed post-insert trim: retain nonlinear effect tone, avoid noise chasing,
 // and do not let isolated Ember peaks steal all of the final mix headroom.
 const ceiling=ember.lufs<policy.quietLufs?1:policy.maxGain;
 const gain=Math.max(policy.minGain,Math.min(ceiling,10**((drums.lufs+policy.targetLu-ember.lufs)/20),drums.peak/Math.max(1e-12,ember.peak)));
 return{...policy,gain,effectiveLevel:policy.startLevel*gain,gainDb:20*Math.log10(gain),drums,[policy.sourceKey||'ember']:ember,aimLufs:drums.lufs+policy.targetLu,predictedSourceLufs:ember.lufs+20*Math.log10(gain),...(policy.sourceKey?{}:{predictedEmberLufs:ember.lufs+20*Math.log10(gain)})};
}
function scaleMetric(metric,gain){return{...metric,lufs:Number.isFinite(metric.lufs)?metric.lufs+20*Math.log10(gain):null,peak:metric.peak*gain,rms:metric.rms*gain};}
function drumMakeup(dry,wet,effected){
 if(!Number.isFinite(wet.lufs)||wet.rms<1e-7)throw Error('Post-FX drums are silent; retrying the loop');
 if(!effected)return{gain:1,gainDb:0,status:'bypassed',dry,wet};
 if(!Number.isFinite(dry.lufs)||dry.rms<1e-7||wet.lufs<-55)throw Error('Drum effect has no usable signal; retrying the loop');
 // Makeup only: never turn the drum fader down or chase near-silent noise.
 // Retain stereo dynamics and floating-point headroom for final normalisation.
 const gain=Math.max(1,Math.min(8,10**((dry.lufs-wet.lufs)/20),Math.max(1,dry.peak)/Math.max(1e-12,wet.peak)));
 return{gain,gainDb:20*Math.log10(gain),status:gain>1?'compensated':'unchanged',dry,wet,post:scaleMetric(wet,gain)};
}
function verifySaved(drums,ember,d=null,restructure=null){
 for(const metric of [drums,...(ember?[ember]:[]),...(d?[d]:[]),...(restructure?[restructure]:[])])if(!Number.isFinite(metric?.lufs)||!Number.isFinite(metric?.peak)||metric.rms<1e-7)throw Error('Saved post-FX source is silent; retrying the loop');
 if(ember&&(ember.lufs>drums.lufs-3||ember.peak>drums.peak*1.02))throw Error('Ember exceeded the saved post-FX drum balance; retrying the loop');
 if(d&&(d.lufs>drums.lufs+.15||d.peak>drums.peak*1.02))throw Error('D exceeded the saved post-FX drum reference; retrying the loop');
 if(restructure&&(restructure.lufs>drums.lufs+.15||restructure.peak>drums.peak*1.02))throw Error('Restructure exceeded the saved post-FX drum reference; retrying the loop');
 return true;
}
const api={POLICY,D_POLICY,R_POLICY,Integrated,decide,scaleMetric,drumMakeup,verifySaved};root.MygrainLoopBalance=api;if(typeof module==='object')module.exports=api;
})(globalThis);
