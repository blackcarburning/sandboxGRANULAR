'use strict';
function plan(meta, seconds, variation, seed) {
 const cycle=meta.patternSteps*(meta.patternCycleMultiplier||1)*60/meta.bpm/4;
 if(!Number.isFinite(seconds)||seconds<30||seconds>60||!['subtle','moderate'].includes(variation)||!Number.isFinite(cycle)||cycle<=0||cycle>60)throw Error('Choose 30–60 seconds and a source pattern no longer than 60 seconds.');
 const low=Math.ceil((30-1e-8)/cycle),high=Math.floor((60+1e-8)/cycle);
 if(low>high)throw Error('This source cycle cannot fit a complete 30–60 second reel. Shorten its pattern.');
 const repeats=Math.max(low,Math.min(high,Math.round(seconds/cycle))),duration=cycle*repeats;
 let n=seed>>>0;const random=()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296};
 const events=[];
 for(let i=0;i<repeats;i++){
  const edge=i===0||i===repeats-1;
  events.push({at:i*cycle,amount:edge?0:(variation==='subtle'?.12:.32)*(.5+.5*Math.sin(Math.PI*i/(repeats-1)))*(.65+.35*random()),pick:Math.floor(random()*12),hat:!edge&&random()<(variation==='subtle'?.35:.65),seed:Math.floor(random()*0xffffffff)});
 }
 // Even a long source cycle gets gentle bar-aligned movement, without truncation.
 if(repeats===1){const bar=240/meta.bpm;for(let t=bar;t<duration-bar/2;t+=bar)events.push({at:t,amount:t>=duration-bar?0:(variation==='subtle'?.1:.25),pick:Math.floor(random()*12),hat:false,seed:0})}
 return {version:1,requestedSeconds:seconds,duration,cycle,repeats,bpm:meta.bpm,variation,seed,warmup:cycle,events:events.sort((a,b)=>a.at-b.at)};
}
module.exports={plan};
