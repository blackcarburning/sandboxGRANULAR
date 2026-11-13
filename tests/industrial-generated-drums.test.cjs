'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const utils=require('../mygrain-utils.js');
const root=path.resolve(__dirname,'..'), candidate=process.env.MYGRAIN_CANDIDATE||root+'/index.html',out=process.env.MYGRAIN_TEST_OUTPUT||'/tmp/mygrain-industrial';fs.mkdirSync(out,{recursive:true});
function renderer(file,sampleRate,lowNoise=false){
 const html=fs.readFileSync(file,'utf8'),start=html.indexOf('        async function generateRandomSourceSample(options = {}) {'),end=html.indexOf('\n        generateSourceBtn?',start);assert(start>0&&end>start);
 // This unit fixture measures raw synthesis; actual filter rendering is covered in browsers.
 const ctx={buildGeneratedSourceFilterRecipe:()=>({filterType:'lowpass',lfoBeats:1}),renderGeneratedSourceFilter:async b=>b,mygrainUtils:utils,sourceMutationSerial:0,document:{getElementById:()=>({value:120})},clampBpmValue:Number,sequencerBPM:120,getPatternLengthSteps:()=>16,generatedSourceLowNoiseMode:lowNoise,tonalDrumsEnabled:true,isTonalDrumRecipe:()=>false,setStatus:()=>{},PATTERN_STEPS_PER_BAR:16,audioContext:{sampleRate,createBuffer(channels,length,sr){const data=Array.from({length:channels},()=>new Float32Array(length));return {numberOfChannels:channels,length,sampleRate:sr,getChannelData:c=>data[c]}}},applyLoadedAudioBuffer:async b=>ctx.result=b};vm.createContext(ctx);vm.runInContext(html.slice(start,end)+';this.generate=generateRandomSourceSample',ctx);return ctx;
}
async function main(){
 for(const rate of [44100,48000])for(const low of [false,true]){
  const c=renderer(candidate,rate,low),blueprint=utils.generateDrumLoopBlueprint({seed:'industrial-fixture',stepCount:16,includeTonalDrums:true,lowNoiseOnly:low});
  await c.generate({profile:{generationSeed:'industrial-fixture'},sourceBlueprint:blueprint});const first=Buffer.from(c.result.getChannelData(0).buffer),stats={rate,low,peak:0,rms:0};
  for(const x of c.result.getChannelData(0)){assert(Number.isFinite(x));stats.peak=Math.max(stats.peak,Math.abs(x));stats.rms+=x*x}stats.rms=Math.sqrt(stats.rms/c.result.length);assert(stats.peak<=.951&&stats.peak>.1);assert(stats.rms>.005);
  await c.generate({profile:{generationSeed:'industrial-fixture'},sourceBlueprint:blueprint});assert(first.equals(Buffer.from(c.result.getChannelData(0).buffer)),'same seed must replay exactly');
  await c.generate({profile:{generationSeed:'different-circuit'},sourceBlueprint:blueprint});assert(!first.equals(Buffer.from(c.result.getChannelData(0).buffer)),'same hits must get different seeded timbres');
  fs.writeFileSync(`${out}/after-${rate}-${low}.f32`,first);
  if(process.env.MYGRAIN_BASELINE){const b=renderer(process.env.MYGRAIN_BASELINE,rate,low);await b.generate({profile:{generationSeed:'industrial-fixture'},sourceBlueprint:blueprint});fs.writeFileSync(`${out}/before-${rate}-${low}.f32`,Buffer.from(b.result.getChannelData(0).buffer))}
  console.log('PASS',JSON.stringify(stats));
 }
 // Silence where no hit has begun: no hidden sub/drone bed is generated.
 const c=renderer(candidate,48000);await c.generate({profile:{generationSeed:'silence'},sourceBlueprint:{paletteSize:1,events:[{step:8,recipe:{category:'snare',family:'snareCrack'}}]}});assert(c.result.getChannelData(0).slice(0,40000).every(x=>x===0));console.log('PASS clean silence before first hit');
}
module.exports={renderer};
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
