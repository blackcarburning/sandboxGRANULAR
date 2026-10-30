'use strict';
function plan(meta, seconds, variation, seed, options = {}) {
 options={notes:options.notes===true,drums:options.drums===true,recutV:options.recutV===true};
 const cycle=meta.patternSteps*(meta.patternCycleMultiplier||1)*60/meta.bpm/4;
 if(!Number.isFinite(seconds)||seconds<30||seconds>60||!['subtle','moderate','extreme'].includes(variation)||!Number.isFinite(cycle)||cycle<=0||cycle>60)throw Error('Choose 30–60 seconds and a source pattern no longer than 60 seconds.');
 const low=Math.ceil((30-1e-8)/cycle),high=Math.floor((60+1e-8)/cycle);
 if(low>high)throw Error('This source cycle cannot fit a complete 30–60 second reel. Shorten its pattern.');
 const repeats=Math.max(low,Math.min(high,Math.round(seconds/cycle))),duration=cycle*repeats;
 let n=seed>>>0;const random=()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296};
 const events=[],bar=240/meta.bpm,section=Math.min(cycle,bar*2),count=Math.ceil(duration/section);
 for(let i=0;i<count;i++){
  const at=i*section,edge=i===0||at>=duration-section;
  events.push({at,amount:edge?0:(variation==='subtle'?.28:variation==='moderate'?.6:.9)*(.7+.3*Math.sin(Math.PI*i/(count-1)))*(.8+.2*random()),pick:Math.floor(random()*12),hat:!edge&&random()<(variation==='subtle'?.5:variation==='moderate'?.85:1),seed:Math.floor(random()*0xffffffff)});
 }
 // Always restore the original arrangement for a complete final bar.
 if(events.at(-1).amount!==0)events.push({at:duration-bar,amount:0,pick:0,hat:false,seed:0});
 const fills=[],rollIterations=[];
 if(options.drums){
  // Re-evaluate every MAIN pattern, not a fixed phrase or the longer saved Roll cycle.
  // A separate seeded stream leaves all other arrangement choices unchanged.
  const step=60/meta.bpm/4,pattern=meta.patternSteps,closing=Math.round(events.at(-1).at/step),opening=Math.round(section/step);
  let r=(seed^0x726f6c6c)>>>0,last='';const next=()=>{r=(Math.imul(r,1664525)+1013904223)>>>0;return r/4294967296};
  const widths=variation==='subtle'?[2,3,4]:variation==='moderate'?[2,3,4,6,8]:[3,4,6,8,12,16],limit=variation==='subtle'?2:variation==='moderate'?3:4,chance=variation==='subtle'?.45:variation==='moderate'?.7:.9;
  for(let start=0,iteration=0;start<closing;start+=pattern,iteration++){
   const begin=Math.max(opening,start),end=Math.min(closing,start+pattern);
   if(end<=begin)continue;
   rollIterations.push({iteration,at:begin*step,end:end*step,fill:false});
  }
  for(const decision of rollIterations){
   const selected=next()<chance;
   // Even a short reel gets an interior roll; every iteration still has its own draw.
   if(!selected&&(decision!==rollIterations.at(-1)||fills.length))continue;
   const begin=Math.round(decision.at/step),availableEnd=Math.round(decision.end/step),span=availableEnd-begin;
   const choices=widths.filter(width=>width<=span),windowSteps=choices.length?choices[Math.floor(next()*choices.length)]:span;
   const endOffset=Math.floor(next()*Math.min(5,span-windowSteps+1)),end=availableEnd-endOffset,start=end-windowSteps,notes=[],style=Math.floor(next()*3);
   for(let j=0;j<windowSteps;j++){
    if(j>0&&j<windowSteps-1&&next()<(variation==='subtle'?.1:.25))continue;
    const burst=(style===0?j>=windowSteps/2:style===1?j%2===0:true)&&next()<.75;
    notes.push({step:j,ratchet:burst?2+Math.floor(next()*(limit-1)):1});
   }
   if(!notes.some(note=>note.ratchet>1))notes.at(-1).ratchet=2;
   const signature=()=>JSON.stringify([endOffset,windowSteps,notes]);
   // Never copy the preceding generated shape, including after an empty iteration.
   if(signature()===last){notes[0].ratchet=notes[0].ratchet===1?2:1;if(!notes.some(note=>note.ratchet>1))notes.at(-1).ratchet=2}
   last=signature();decision.fill=true;
   fills.push({iteration:decision.iteration,at:start*step,end:end*step,windowSteps,hits:notes.length,ratchet:Math.max(...notes.map(note=>note.ratchet)),notes});
  }
 }
 return {version:8,options,fills,rollIterations,requestedSeconds:seconds,duration,cycle,repeats,bpm:meta.bpm,variation,seed,warmup:cycle,events:events.sort((a,b)=>a.at-b.at)};
}
module.exports={plan};
