'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {renderer}=require('./industrial-generated-drums.test.cjs');
const candidate=process.env.MYGRAIN_CANDIDATE||path.resolve(__dirname,'../index.html'),baseline=process.env.MYGRAIN_BASELINE,out=process.env.MYGRAIN_TEST_OUTPUT||'/tmp/mygrain-pink';assert(baseline,'Select an exact pre-change baseline');fs.mkdirSync(out,{recursive:true});
(async()=>{const rows=[];for(const rate of [44100,48000])for(const category of ['kick','impact','snare','closedHat','perc']){
 const input={profile:{generationSeed:'pink-isolated'},sourceBlueprint:{paletteSize:1,events:[{step:0,velocity:1,recipe:{category,family:category+'Metal',toneFreq:category==='kick'?52:380,decaySeconds:.2,durationSteps:4,level:.8,noiseTone:.5,metallic:.4}}]}},r={rate,category};
 for(const [label,file]of [['before',baseline],['after',candidate]]){
  const ctx=renderer(file,rate);await ctx.generate(input);const x=ctx.result.getChannelData(0);let energy=0;for(const v of x)energy+=v*v;let sum=0,end=0;for(let i=0;i<x.length;i++){sum+=x[i]*x[i];if(sum>=energy*.95){end=i/rate;break}}r[label]={duration95:end,energy};
  if(category==='snare')fs.writeFileSync(`${out}/${label}-snare-${rate}.f32`,Buffer.from(x.buffer));
 }
 assert(r.after.duration95<r.before.duration95*.75,JSON.stringify(r));rows.push(r);
 }
 // Capture the actual filter's output before envelopes/saturation to verify pink slope.
 let html=fs.readFileSync(candidate,'utf8');const marker='const pinkNoise = pinkSum * (lowNoiseOnly ? 0.11 : 0.22);';assert(html.includes(marker));html=html.replace(marker,marker+'if(channel===0)globalThis.pinkCapture.push(pinkNoise);');
 const probeFile=out+'/pink-probe.html';fs.writeFileSync(probeFile,html);for(const rate of [44100,48000]){const ctx=renderer(probeFile,rate);ctx.pinkCapture=[];await ctx.generate({profile:{generationSeed:'pink-spectrum'},sourceBlueprint:{paletteSize:1,events:[{step:8,recipe:{category:'snare'}}]}});fs.writeFileSync(`${out}/pink-noise-${rate}.f32`,Buffer.from(Float32Array.from(ctx.pinkCapture).buffer))}
 fs.writeFileSync(out+'/tightness.json',JSON.stringify(rows,null,2));console.log('PASS isolated hit energy decays >25% faster across five drum categories at both sample rates');
})().catch(e=>{console.error(e);process.exitCode=1});
