'use strict';
// Evaluated only inside the disposable server-render deck.
module.exports=String.raw`(function(){
 const quiet={silent:true,skipSave:true},lanes=[['A','performanceBastardLoopLevel',bastardLoopEnabled,!!bastardLoopBuffer,v=>setBastardLoopEnabled(v,quiet)],['B','performanceBastardLoop2Level',bastardLoop2Enabled,!!bastardLoop2Buffer,v=>setBastardLoop2Enabled(v,quiet)],['C','performanceBastardLoop3Level',bastardLoop3Enabled,!!bastardLoop3Buffer,v=>setBastardLoop3Enabled(v,quiet)],['V','performanceBastardLoopVLevel',bastardLoopVEnabled,!!bastardLoopVBuffer,v=>setBastardLoopVEnabled(v,quiet)],['W','performanceBastardLoopWLevel',bastardLoopWEnabled,!!bastardLoopWBuffer,v=>setBastardLoopWEnabled(v,quiet)],['P','performanceBastardLoopPLevel',bastardLoopPEnabled,!!bastardLoopPBuffer,v=>setBastardLoopPEnabled(v,quiet)],['O','performanceBastardLoopOLevel',bastardLoopOEnabled,!!bastardLoopOBuffer,v=>setBastardLoopOEnabled(v,quiet)],['L','performanceBastardLoopLLevel',bastardLoopLEnabled,!!bastardLoopLSampleBuffer,v=>setBastardLoopLEnabled(v,quiet)],['X','performanceBastardLoopXLevel',bastardLoopXEnabled,!!bastardLoopXSampleBuffer,v=>setBastardLoopXEnabled(v,quiet)],['M','performanceBastardLoopMLevel',bastardLoopMEnabled,!!bastardLoopMRawBuffer,v=>setBastardLoopMEnabled(v,quiet)],['M+','performanceBastardLoopMPlusLevel',bastardLoopMPlusEnabled,!!bastardLoopMPlusRawBuffer,v=>setBastardLoopMPlusEnabled(v,quiet)],['K','performanceBastardLoopKLevel',bastardLoopKEnabled,!!bastardLoopKRawBuffer,v=>setBastardLoopKEnabled(v,quiet)]];
 const controls=lanes.map(([key,id,on,loaded,enable])=>({key,el:document.getElementById(id),on,loaded,enable})).filter(x=>x.el).map(x=>({...x,value:Number(x.el.value)}));
 const active=controls.filter(x=>x.on&&x.value>0),available=controls.filter(x=>(!x.on||x.value<=0)&&x.loaded);
 const q=document.getElementById('performanceBastardLoopQLevelMixer');if(window.mygrainQ?.state.enabled&&q&&Number(q.value)>0)active.push({el:q,value:Number(q.value)});
 const drum=document.getElementById('performanceDrumMachineLevel');
 if(drumMachineEnabled&&drum&&Number(drum.value)>0)active.push({el:drum,value:Number(drum.value)});
 const filter=document.getElementById('lpfCutoff'),cutoff=Number(filter?.value);
 const hats=drumMachineHatPattern.slice(),accents=drumMachineHatAccentPattern.slice();
 function level(x,value){x.el.value=String(value);x.el.dispatchEvent(new Event('input',{bubbles:true}))}
 let plan={options:{notes:false,drums:false}},leads=null;
 function cloneSequence(value){return value.map(step=>({...step}))}
 function varyLead(lane,event){
  const original=lane.sequence,sequence=cloneSequence(original);
  if(event.amount>0&&lane.enabled()&&lane.playable()&&original.slice(0,lane.length).some(step=>step.note&&!step.rest)){
   const stepSeconds=lane.seconds(),start=Math.ceil((plan.warmup+event.at+.2)/stepSeconds)+event.seed%3;
   const count=plan.variation==='subtle'?1:2,root=noteNameToMidi(lane.root());
   for(let j=0;j<count;j++){
    const index=(start+j*2)%lane.length,step=sequence[index],reference=step.note?noteNameToMidi(step.note):root;
    const near=root+Math.round((reference-root)/12)*12;
    // Root, fifth and octave avoid inventing an unsupported major/minor third.
    const offsets=plan.variation==='subtle'?[7,-5]:[7,-5,12,0];
    let midi=Math.max(0,Math.min(107,near+offsets[(event.pick+j)%offsets.length]));
    if(step.note&&midi===reference)midi=Math.max(0,Math.min(107,near+(midi>=near? -5:7)));
    sequence[index]={...step,note:midiToNoteName(midi),rest:false,accent:false,slide:false,ratchet:1};
   }
  }
  lane.set(sequence);
 }
 const apply=event=>{
  active.forEach((x,i)=>level(x,x.value*(1-event.amount*(i===event.pick%Math.max(1,active.length)?1:.15))));
  const selected=event.amount>0?Math.min(available.length,event.amount>.3?2:1):0;
  const added=[];
  available.forEach((x,i)=>{const offset=(i-event.pick%Math.max(1,available.length)+available.length)%available.length,on=offset<selected;
   // Set the level before waking a parked lane; never add unloaded sources.
   level(x,on?Math.min(x.value||35,event.amount>.3?30:16):x.value);x.enable(on||x.on);if(on)added.push(x.key);
  });
  if(filter&&Number.isFinite(cutoff)){filter.value=String(Math.max(Number(filter.min),cutoff*(1-event.amount*.65)));filter.dispatchEvent(new Event('input',{bubbles:true}))}
  if(plan.options.drums&&drumMachineEnabled&&drumMachineHatBuffer){drumMachineHatPattern=hats.slice();drumMachineHatAccentPattern=accents.slice();
   if(event.hat){const count=getPatternLengthSteps(),i=(event.seed%Math.max(1,Math.floor(count/4)))*4+3;drumMachineHatPattern[i]=true;drumMachineHatAccentPattern[i]=false;
    if(event.amount>.3&&count>8){const j=(i+count-4)%count;drumMachineHatPattern[j]=!hats[j]}}
  }
  if(plan.options.notes&&leads)for(const lane of leads)varyLead(lane,event);
  if(plan.options.drums&&drumMachineEnabled){
   drumMachineBaseAccents.snare=apply.snareAccents.slice();
   if(event.amount>0&&drumMachineSnareBuffer&&isDrumMachineLaneAudible('snare')){
    const candidates=drumMachineSnarePattern.map((on,i)=>on?i:-1).filter(i=>i>=0);
    if(candidates.length)drumMachineBaseAccents.snare[candidates[event.pick%candidates.length]]=event.pick%2===0;
   }
  }
  return {active:active.length,added};
 };
 apply.prepare=value=>{
  plan=value;plan.options=plan.options||{notes:false,drums:false};
  if(plan.options.notes)leads=[
   {sequence:cloneSequence(bastardLoopLSequence),length:getBastardLoopLPatternLength(),enabled:()=>bastardLoopLEnabled,playable:()=>hasBastardLoopLPlaybackSource(),root:()=>getBastardLoopLRootNote(),seconds:()=>getBastardLoopLStepDurationSeconds(),set:value=>{bastardLoopLSequence=value}},
   {sequence:cloneSequence(bastardLoopXSequence),length:getBastardLoopXPatternLength(),enabled:()=>bastardLoopXEnabled,playable:()=>hasBastardLoopXPlaybackSource(),root:()=>getBastardLoopXRootNote(),seconds:()=>getBastardLoopXStepDurationSeconds(),set:value=>{bastardLoopXSequence=value}}
  ];
  if(!plan.options.drums)return {fills:0};
  apply.snareAccents=drumMachineBaseAccents.snare.slice();
  if(!drumMachineEnabled||!drumMachineSnareBuffer||!isDrumMachineLaneAudible('roll'))return {fills:0};
  // Compile the entire independent Roll timeline BEFORE starting the scheduler.
  // The existing renderer queues Roll two seconds ahead; late timer edits miss hits.
  const old=window.MygrainDrumRoll.normalize(drumMachineRoll),step=60/plan.bpm/4,length=Math.round(plan.duration/step),offset=Math.round(plan.warmup/step);
  if(length>1024)throw Error('Reel Roll timeline exceeds the existing lane limit.');
  const roll=window.MygrainDrumRoll.normalize({length,dip:old.dip});
  const originalDips=old.dip>0&&old.pattern.some((on,i)=>on&&old.dips[i]);
  roll.dip=originalDips?old.dip:Math.max(45,old.dip);
  for(let i=0;i<length;i++){const j=i%old.length;roll.pattern[i]=old.pattern[j];roll.ratchets[i]=old.ratchets[j];roll.dips[i]=old.dip>0&&old.dips[j];roll.accents[i]=old.accents[j]}
  let fills=0;
  for(const fill of plan.fills||[]){let added=false;
   const begin=Math.round(fill.at/step),end=Math.round(fill.end/step),indices=plan.variation==='subtle'?[end-2,end-1]:[begin+1,end-2,end-1];
   for(const index of new Set(indices)){const i=(offset+index)%length;if(roll.pattern[i])continue;
    roll.pattern[i]=true;roll.ratchets[i]=roll.dip<30?1:fill.ratchet;roll.dips[i]=true;roll.accents[i]=false;added=true;
   }
   if(added)fills++;
  }
  if(fills)drumMachineRoll=roll;
  return {fills};
 };
 return apply;
})()`;
