'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{spawnSync}=require('node:child_process');
const DSP=require('../mastering-dsp.js');let Worklet;
class AudioWorkletProcessor{constructor(){this.messages=[];this.port={postMessage:m=>this.messages.push(m)};}}
const scope={AudioWorkletProcessor,sampleRate:48000,MygrainMasterDSP:DSP,registerProcessor:(name,type)=>Worklet=type};scope.globalThis=scope;
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../mastering-worklet.js'),'utf8').replace(/^import .*;\n/,''),scope);
for(const hz of [50,1000,8000]){
 const w=new Worklet({processorOptions:{settings:DSP.PRESETS.level}}),n=48000*5,pcm=Buffer.alloc(n*8);
 for(let i=0;i<n;i+=128){const l=new Float32Array(128),r=new Float32Array(128),ol=new Float32Array(128),orr=new Float32Array(128);for(let j=0;j<128;j++){l[j]=.1*Math.sin(2*Math.PI*hz*(i+j)/48000);r[j]=l[j]*.7;}w.process([[l,r]],[[ol,orr]]);for(let j=0;j<128&&i+j<n;j++){pcm.writeFloatLE(ol[j],(i+j)*8);pcm.writeFloatLE(orr[j],(i+j)*8+4);}}
 const ff=spawnSync('ffmpeg',['-hide_banner','-f','f32le','-ar','48000','-ac','2','-i','pipe:0','-af','ebur128=peak=none','-f','null','-'],{input:pcm,maxBuffer:4*1024*1024});assert.equal(ff.status,0);const readings=[...ff.stderr.toString().matchAll(/M:\s*([\d.-]+)\s+S:\s*([\d.-]+)/g)];assert(readings.length);const last=readings.at(-1),measured=w.messages.at(-1);assert(Math.abs(measured.lufsMomentary-Number(last[1]))<.15,JSON.stringify({hz,measured,last}));assert(Math.abs(measured.lufsShortTerm-Number(last[2]))<.15);assert.equal(w.messages[0].lufsMomentary,null);assert.equal(w.messages[0].lufsShortTerm,null);console.log('PASS output LUFS vs FFmpeg',hz,measured.lufsMomentary.toFixed(2),measured.lufsShortTerm.toFixed(2));
 // Audition switches must not change export-level loudness readings.
 w.port.onmessage({data:{bypass:true,match:true}});assert(w.bypass&&w.match);
}
const silent=new Worklet({processorOptions:{settings:DSP.PRESETS.level}});for(let i=0;i<1200;i++)silent.process([[new Float32Array(128),new Float32Array(128)]],[[new Float32Array(128),new Float32Array(128)]]);assert.equal(silent.messages.at(-1).lufsMomentary,null);assert.equal(silent.messages.at(-1).lufsShortTerm,null);console.log('PASS silence and startup do not display bogus finite LUFS');
