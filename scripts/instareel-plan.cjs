'use strict';
function plan(meta, seconds, variation, seed) {
 const cycle=meta.patternSteps*(meta.patternCycleMultiplier||1)*60/meta.bpm/4;
 if(!Number.isFinite(seconds)||seconds<30||seconds>60||!['subtle','moderate'].includes(variation)||!Number.isFinite(cycle)||cycle<=0||cycle>60)throw Error('Choose 30–60 seconds and a source pattern no longer than 60 seconds.');
 const low=Math.ceil((30-1e-8)/cycle),high=Math.floor((60+1e-8)/cycle);
 if(low>high)throw Error('This source cycle cannot fit a complete 30–60 second reel. Shorten its pattern.');
 const repeats=Math.max(low,Math.min(high,Math.round(seconds/cycle))),duration=cycle*repeats;
 let n=seed>>>0;const random=()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296};
 const events=[],bar=240/meta.bpm,section=Math.min(cycle,bar*2),count=Math.ceil(duration/section);
 for(let i=0;i<count;i++){
  const at=i*section,edge=i===0||at>=duration-section;
  events.push({at,amount:edge?0:(variation==='subtle'?.28:.6)*(.7+.3*Math.sin(Math.PI*i/(count-1)))*(.8+.2*random()),pick:Math.floor(random()*12),hat:!edge&&random()<(variation==='subtle'?.5:.85),seed:Math.floor(random()*0xffffffff)});
 }
 // Always restore the original arrangement for a complete final bar.
 if(events.at(-1).amount!==0)events.push({at:duration-bar,amount:0,pick:0,hat:false,seed:0});
 return {version:2,requestedSeconds:seconds,duration,cycle,repeats,bpm:meta.bpm,variation,seed,warmup:cycle,events:events.sort((a,b)=>a.at-b.at)};
}
module.exports={plan};
