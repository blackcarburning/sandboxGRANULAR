'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium,webkit}=require('playwright-core');
const out=process.env.MYGRAIN_FX_EVIDENCE||'/tmp/mygrain-filter-clock';fs.mkdirSync(out,{recursive:true});
(async()=>{const results=[];for(const[engine,type]of Object.entries({chromium,webkit})){const b=await type.launch(engine==='chromium'?{executablePath:'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}:{});try{const p=await b.newPage();await p.goto('about:blank');await p.addScriptTag({content:fs.readFileSync(require.resolve('../loop-card-fx.js'),'utf8')});const result=await p.evaluate(async()=>{
const checks=[];
function expected(wave,t,origin,bpm,beats){const phase=((t-origin)*bpm/60/beats%1+1)%1;return(wave==='ramp'?-1:1)*(1-2*phase)}
async function render({sr=48000,bpm=120,beats=.25,wave='sawtooth',origin=.1,late=false,tempo=false,seconds=3,invert=false}){
 const c=new OfflineAudioContext(1,Math.ceil(seconds*sr),sr);let g,old;
 function build(){g=MygrainLoopFx.createGraph(c,c.createGain(),{lfoWave:wave,lfoBeats:beats,lfoDepth:1,lfoInvert:invert,cutoff:300},bpm,origin,late?c.currentTime:origin);g.lfoOutput.connect(c.destination);}
 if(late)c.suspend(.37).then(()=>{build();c.resume()});else build();
 if(tempo)c.suspend(.3).then(()=>{g.syncClock(.6-60/90,90,.6);c.resume()});
 if(!late&&!tempo)c.suspend(.21).then(()=>{old=g.lfo;g.update({...g.settings,cutoff:600,resonance:1.1},bpm);if(g.lfo!==old)throw Error('cutoff/depth updates reset LFO');c.resume()});
 const buffer=await c.startRendering(),data=buffer.getChannelData(0);let maxError=0;
 const period=60/bpm*beats,begin=late?.4:origin+.01;
 for(let t=begin;t<seconds-.01;t+=period*.073){if(tempo&&Math.abs(t-.6)<.006)continue;const newTempo=tempo&&t>=.6?90:bpm,newOrigin=tempo&&t>=.6?.6-60/90:origin;const phase=((t-newOrigin)*newTempo/60/beats%1+1)%1;if(phase<.025||phase>.975)continue;const i=Math.round(t*sr),value=data[i]/2400,exp=expected(wave,i/sr,newOrigin,newTempo,beats)*(invert?-1:1);maxError=Math.max(maxError,Math.abs(value-exp));}
 // No early reset: waveform direction must remain constant through each interior cycle.
 const values=[.1,.3,.5,.7,.9].map(f=>{const t=origin+period*f;return data[Math.round(t*sr)]/2400});
 g.dispose();return{sr,bpm,beats,wave,late,tempo,invert,maxError,values};
}
for(const sr of [44100,48000])for(const bpm of [73,120,167])for(const wave of ['sawtooth','ramp'])checks.push(await render({sr,bpm,wave}));
for(const wave of ['sawtooth','ramp']){checks.push(await render({wave,beats:.5,late:true}));checks.push(await render({wave,tempo:true}));checks.push(await render({wave,invert:true}));checks.push(await render({wave,bpm:97,beats:4,seconds:80}));}
return checks;
});for(const c of result){assert(c.maxError<.035,engine+' '+JSON.stringify(c));if(!c.late)for(let i=1;i<c.values.length;i++)assert((c.values[i]-c.values[i-1])*(c.wave==='ramp'?1:-1)*(c.invert?-1:1)>.25,engine+' full-cycle direction '+JSON.stringify(c));}results.push({engine,cases:result});console.log('PASS native filter LFO clock',engine,result.length,'cases; max error',Math.max(...result.map(x=>x.maxError)));}finally{await b.close()}}fs.writeFileSync(out+'/native-clock.json',JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
