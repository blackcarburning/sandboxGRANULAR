'use strict';
// Evaluated only inside the disposable server-render deck.
module.exports=String.raw`(function(){
 const quiet={silent:true,skipSave:true},lanes=[['A','performanceBastardLoopLevel',bastardLoopEnabled,!!bastardLoopBuffer,v=>setBastardLoopEnabled(v,quiet)],['B','performanceBastardLoop2Level',bastardLoop2Enabled,!!bastardLoop2Buffer,v=>setBastardLoop2Enabled(v,quiet)],['C','performanceBastardLoop3Level',bastardLoop3Enabled,!!bastardLoop3Buffer,v=>setBastardLoop3Enabled(v,quiet)],['V','performanceBastardLoopVLevel',bastardLoopVEnabled,!!bastardLoopVBuffer,v=>setBastardLoopVEnabled(v,quiet)],['W','performanceBastardLoopWLevel',bastardLoopWEnabled,!!bastardLoopWBuffer,v=>setBastardLoopWEnabled(v,quiet)],['P','performanceBastardLoopPLevel',bastardLoopPEnabled,!!bastardLoopPBuffer,v=>setBastardLoopPEnabled(v,quiet)],['O','performanceBastardLoopOLevel',bastardLoopOEnabled,!!bastardLoopOBuffer,v=>setBastardLoopOEnabled(v,quiet)],['L','performanceBastardLoopLLevel',bastardLoopLEnabled,!!bastardLoopLSampleBuffer,v=>setBastardLoopLEnabled(v,quiet)],['X','performanceBastardLoopXLevel',bastardLoopXEnabled,!!bastardLoopXSampleBuffer,v=>setBastardLoopXEnabled(v,quiet)],['M','performanceBastardLoopMLevel',bastardLoopMEnabled,!!bastardLoopMRawBuffer,v=>setBastardLoopMEnabled(v,quiet)],['M+','performanceBastardLoopMPlusLevel',bastardLoopMPlusEnabled,!!bastardLoopMPlusRawBuffer,v=>setBastardLoopMPlusEnabled(v,quiet)],['K','performanceBastardLoopKLevel',bastardLoopKEnabled,!!bastardLoopKRawBuffer,v=>setBastardLoopKEnabled(v,quiet)]];
 // Synth-mode lead lanes are playable without an audio sample. Empty sequences are not layers.
 for(const lane of lanes){if(lane[0]==='L')lane[3]=hasPlayableBastardLoopLTransportSource();if(lane[0]==='X')lane[3]=hasPlayableBastardLoopXTransportSource();if(lane[0]==='K'&&window.mygrainKMultitrack)lane[3]=window.mygrainKMultitrack.hasAudio()}
 const controls=lanes.map(([key,id,on,loaded,enable])=>({key,el:document.getElementById(id),on,loaded,enable})).filter(x=>x.el).map(x=>({...x,value:Number(x.el.value)}));
 const active=controls.filter(x=>x.on&&x.value>0),available=controls.filter(x=>(!x.on||x.value<=0)&&x.loaded);
 const q=document.getElementById('performanceBastardLoopQLevelMixer');if(window.mygrainQ?.state.enabled&&q&&Number(q.value)>0)active.push({el:q,value:Number(q.value)});
 const drum=document.getElementById('performanceDrumMachineLevel');
 if(drumMachineEnabled&&drum&&Number(drum.value)>0)active.push({el:drum,value:Number(drum.value)});
 const filter=document.getElementById('lpfCutoff'),cutoff=Number(filter?.value);
 const noise=window.mygrainNoise,originalNoise=noise?{...noise.settings()}:null;
 const leadFilters=['L','X'].map(key=>({key,el:document.getElementById('performanceBastardLoop'+key+'FilterEnvelope')})).filter(x=>x.el).map(x=>({...x,value:Number(x.el.value)}));
 const originalGlobal=typeof lpfSlope==='number'?{slope:lpfSlope,enabled:lpfEnabled}:null;
 let motion=null,mixDriver=false;const mixTaps=new Set();
 function refreshMix(){
  const target=noise?.graph?.envelope,wanted=new Set(mixDriver&&target?[...(noise.taps||[])].filter(t=>t.context===noise.graph.native&&!['N','noise'].includes(t.key)).map(t=>t.source):[]);
  if(mixDriver&&target)for(const tap of noise.taps||[])if(tap.target===target){try{tap.source.disconnect(target)}catch{}tap.target=null;mixTaps.delete(tap.source)}
  for(const source of mixTaps)if(!wanted.has(source)){try{source.disconnect(target)}catch{}mixTaps.delete(source)}
  for(const source of wanted)if(!mixTaps.has(source)){source.connect(target);mixTaps.add(source)}
 }
 const recuts=[['A',()=>bastardLoopBuffer,()=>getBastardLoopLevelValue(),()=>getBastardLoopCycleDuration(),()=>bastardLoopCut,v=>setBastardLoopCut(v,quiet)],['B',()=>bastardLoop2Buffer,()=>getBastardLoop2LevelValue(),()=>getBastardLoop2CycleDuration(),()=>bastardLoop2Cut,v=>setBastardLoop2Cut(v,quiet)],['C',()=>bastardLoop3Buffer,()=>getBastardLoop3LevelValue(),()=>getBastardLoop3CycleDuration(),()=>bastardLoop3Cut,v=>setBastardLoop3Cut(v,quiet)],['V',()=>bastardLoopVBuffer,()=>getBastardLoopVLevelValue(),()=>getBastardLoopVCycleDuration(),()=>bastardLoopVCut,v=>setBastardLoopVCut(v,quiet)],['W',()=>bastardLoopWBuffer,()=>getBastardLoopWLevelValue(),()=>getBastardLoopWCycleDuration(),()=>bastardLoopWCut,v=>setBastardLoopWCut(v,quiet)]].map(([key,buffer,audible,cycle,get,set])=>({key,buffer,audible,cycle,set,original:MygrainVocalCut.normalize(get()),last:'',developed:'',turn:0,width:null}));
 const hats=drumMachineHatPattern.slice(),accents=drumMachineHatAccentPattern.slice(),hatRatchets=drumMachineHatRatchetPattern.slice();
 function level(x,value){x.el.value=String(value);x.el.dispatchEvent(new Event('input',{bubbles:true}))}
 let plan={options:{notes:false,drums:false}},leads=null,evolvingHats=hats.slice(),evolvingHatAccents=accents.slice(),hatChanges=new Set(),drumGeneration=0,evolvingSnare=null;
 function cloneSequence(value){return value.map(step=>({...step}))}
 function varyLead(lane,event){
  const original=lane.sequence,sequence=cloneSequence(event.amount>0&&lane.current?lane.current:original);
  if(event.amount===0){lane.touched=new Set();lane.turn=0}
  if(event.amount>0&&lane.enabled()&&lane.playable()&&original.slice(0,lane.length).some(step=>step.note&&!step.rest)){
   const stepSeconds=lane.seconds(),start=Math.ceil((plan.warmup+event.at+.2)/stepSeconds)+event.seed%3;
   const count=plan.variation==='subtle'?1:plan.variation==='moderate'?2:3,root=noteNameToMidi(lane.root()),cap=Math.max(1,Math.floor(lane.length*(plan.variation==='subtle'?.25:plan.variation==='moderate'?.375:.5)));
   lane.touched||=new Set();lane.turn=(lane.turn||0)+1;
   for(let j=0;j<count;j++){
    let index=(start+j*2)%lane.length;
    if(lane.touched.size<cap){for(let n=0;n<lane.length&&lane.touched.has(index);n++)index=(index+1)%lane.length}
    else index=[...lane.touched][(lane.turn+j-1)%lane.touched.size];
    lane.touched.add(index);
    const step=sequence[index],baseline=original[index],reference=baseline.note?noteNameToMidi(baseline.note):root;
    const near=root+Math.round((reference-root)/12)*12;
    // Root, fifth and octave avoid inventing an unsupported major/minor third.
    const offsets=plan.variation==='subtle'?[7,-5]:[7,-5,12,0];
    let midi=Math.max(0,Math.min(107,near+offsets[(event.pick+j)%offsets.length]));
    if(step.note&&midi===noteNameToMidi(step.note))midi=Math.max(0,Math.min(107,near+(midi>=near? -5:7)));
    sequence[index]={...step,note:midiToNoteName(midi),rest:false,accent:false,slide:false,ratchet:1};
   }
  }
  lane.current=cloneSequence(sequence);lane.set(sequence);
 }
 const apply=event=>{
  active.forEach((x,i)=>level(x,x.value*(1-event.amount*(i===event.pick%Math.max(1,active.length)?1:.15))));
  const selected=event.amount>0?Math.min(available.length,plan.variation==='extreme'?3:event.amount>.3?2:1):0;
  const added=[];
  available.forEach((x,i)=>{const offset=(i-event.pick%Math.max(1,available.length)+available.length)%available.length,on=offset<selected;
   // Set the level before waking a parked lane; never add unloaded sources.
   level(x,on?Math.min(x.value||35,plan.variation==='extreme'?42:event.amount>.3?30:16):x.value);x.enable(on||x.on);if(on)added.push(x.key);
  });
  let seed=((event.seed||0)^Math.imul(event.pick||0,2654435761)^plan.seed)>>>0;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
  const nAllowed=typeof hasAnyPerformanceLayerSoloSelection!=='function'||!hasAnyPerformanceLayerSoloSelection()||loopLayerSolo.includes('noise');
  mixDriver=false;refreshMix();
  if(noise&&originalNoise){
   // N is an ordinary occasional layer, not a fixed every-third-section gesture.
   const on=event.amount>0&&nAllowed&&random()<.55;
   if(on){
    mixDriver=!drumMachineEnabled||!noise.mixDriverSources?.().includes('drums')||random()<.4;
    noise.restore({...originalNoise,enabled:true,level:3+random()*4,type:originalNoise.type,filterEnabled:true,filterType:random()<.5?'lowpass':'bandpass',poles:4,cutoff:180+random()*1600,resonance:.5+random()*.5,drive:0,source:mixDriver?'sample':'drums',mode:mixDriver?'follow':'trigger',amount:2+random()*3,sensitivity:8,threshold:.035,attack:2,decay:35+random()*50,sustain:0,release:35,hold:5});
    if(!noise.running)noise.start();added.push('N');
   }else noise.restore(event.amount===0?originalNoise:{...originalNoise,enabled:false});
  }
  refreshMix();
  for(const x of leadFilters){const used=x.key==='L'?bastardLoopLEnabled:bastardLoopXEnabled;level(x,event.amount>0&&used?Math.max(5,Math.min(90,x.value+(random()-.35)*event.amount*90)):x.value)}
  motion=null;
  if(originalGlobal){
   const on=event.amount>0&&random()<.35;
   setFilterPoles('lpf',on?4:originalGlobal.slope/6);setFilterEnabled('lpf',on||originalGlobal.enabled);
   if(on)motion={at:event.at,base:Math.min(cutoff,(plan.variation==='subtle'?6000:plan.variation==='moderate'?3500:1800)+random()*2400),depth:.15+random()*.25,hz:(plan.bpm||120)/60/[4,8,16][Math.floor(random()*3)]};
  }
  if(filter&&Number.isFinite(cutoff)){filter.value=String(cutoff);filter.dispatchEvent(new Event('input',{bubbles:true}))}
  if(plan.options.drums&&drumMachineEnabled){
   if(event.amount===0){evolvingHats=hats.slice();evolvingHatAccents=accents.slice();hatChanges.clear();drumGeneration=0}
   else drumGeneration++;
   if(drumMachineHatBuffer){
    if(event.amount>0){
     const count=getPatternLengthSteps(),weak=Array.from({length:count},(_,i)=>i).filter(i=>i%4===3),cap=plan.variation==='subtle'?2:plan.variation==='moderate'?4:6;
     if(weak.length){
      const fresh=weak.filter(i=>!hatChanges.has(i)),choices=hatChanges.size<cap&&fresh.length?fresh:[...hatChanges],i=choices[event.seed%choices.length];
      if(!evolvingHats[i]){evolvingHats[i]=true;evolvingHatAccents[i]=false}else evolvingHatAccents[i]=!evolvingHatAccents[i];
      hatChanges.add(i);
     }
    }
    drumMachineHatPattern=evolvingHats.slice();drumMachineHatAccentPattern=evolvingHatAccents.slice();
    // Temporary bursts, not cumulative density: always restore manual ratchets first.
    drumMachineHatRatchetPattern=hatRatchets.slice();
    if(event.amount>0&&drumGeneration%3===1&&event.at+Math.min(plan.cycle,480/plan.bpm)+2<=plan.events.at(-1).at&&isDrumMachineLaneAudible('hat')){
     const candidates=evolvingHats.slice(0,getPatternLengthSteps()).map((on,i)=>on&&(Number(hatRatchets[i])||1)<=1?i:-1).filter(i=>i>=0);
     if(candidates.length){const i=candidates[event.seed%candidates.length];drumMachineHatRatchetPattern[i]=plan.variation==='subtle'?2:plan.variation==='moderate'?3:4}
    }
   }
  }
  if(plan.options.notes&&leads)for(const lane of leads)varyLead(lane,event);
  if(plan.options.drums&&drumMachineEnabled){
   if(event.amount===0||!evolvingSnare)evolvingSnare=apply.snareAccents.slice();
   if(event.amount>0&&drumMachineSnareBuffer&&isDrumMachineLaneAudible('snare')){
    const candidates=drumMachineSnarePattern.map((on,i)=>on?i:-1).filter(i=>i>=0);
    if(candidates.length){const i=candidates[(drumGeneration-1)%candidates.length];evolvingSnare[i]=!evolvingSnare[i]}
   }
  }
  if(plan.options.drums&&drumMachineEnabled)drumMachineBaseAccents.snare=evolvingSnare.slice();
  return {active:active.length,added};
 };
 // Separate lane-cycle callbacks: arrangement sections may be longer/shorter than a source repeat.
 apply.cutEvents=()=>{
  const events=[],closing=plan.events.at(-1).at;
  for(const lane of recuts){
   if(!lane.buffer()||lane.key==='V'&&!plan.options.recutV)continue;
   const seconds=Number(lane.cycle());if(!Number.isFinite(seconds)||seconds<=0)continue;
   // Bound callbacks for extremely short imported sources; normal musical loops retain every repeat.
   const cycle=seconds*Math.max(1,Math.ceil(plan.duration/512/seconds)),phase=(plan.warmup||0)%cycle;
   events.push({at:0,key:lane.key,repeat:0,restore:true});
   let repeat=1;for(let at=phase<1e-6?cycle:cycle-phase;at<closing-1e-6;at+=cycle){events.push({at,key:lane.key,repeat,restore:lane.key==='V'&&repeat%2===0});repeat++}
   events.push({at:closing,key:lane.key,repeat,restore:true});
  }
  return events.sort((a,b)=>a.at-b.at);
 };
 apply.cut=event=>{
  const lane=recuts.find(x=>x.key===event.key);if(!lane)return;
  let next=lane.original;
  if(!event.restore&&lane.buffer()&&lane.audible()>0&&(lane.key!=='V'||plan.options.recutV)){
   const base=lane.original,begin=base.enabled?base.start:0,end=base.enabled?base.end:1,span=end-begin;
   const fractions=plan.variation==='subtle'?[.875,.75]:plan.variation==='moderate'?[.75,.5]:[.5,.25,.375];
   let seed=(plan.seed^Math.imul(lane.key.charCodeAt(0),2654435761)^Math.imul(++lane.turn,1597334677))>>>0;
   const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
   let fraction=fractions[Math.floor(random()*fractions.length)];if(fraction===lane.width)fraction=fractions[(fractions.indexOf(fraction)+1)%fractions.length];lane.width=fraction;
   const slots=Math.round((1-fraction)*32),width=span*fraction;
   let position=Math.floor(random()*(slots+1));
   const build=()=>MygrainVocalCut.normalize({...base,enabled:true,start:begin+position*span/32,end:begin+position*span/32+width,repeat:true,fromStart:true,stretch:false,targetStart:null,targetDuration:null});
   next=build();if(JSON.stringify(next)===lane.developed){position=(position+1)%(slots+1);next=build()}
   lane.developed=JSON.stringify(next);
  }
  const key=JSON.stringify(next);if(key!==lane.last){lane.set(next);lane.last=key}
  return next;
 };
 apply.tick=seconds=>{refreshMix();if(motion&&filter){filter.value=String(Math.max(Number(filter.min)||20,motion.base*(1+motion.depth*Math.sin(2*Math.PI*motion.hz*(seconds-motion.at)))));filter.dispatchEvent(new Event('input',{bubbles:true}))}};
 apply.cleanup=()=>{mixDriver=false;refreshMix()};
 apply.prepare=value=>{
  plan=value;plan.options=plan.options||{notes:false,drums:false,recutV:false};
  for(const lane of recuts){lane.turn=0;lane.developed=''}
  if(plan.options.notes)leads=[
   {sequence:cloneSequence(bastardLoopLSequence),length:getBastardLoopLPatternLength(),enabled:()=>bastardLoopLEnabled,playable:()=>hasBastardLoopLPlaybackSource(),root:()=>getBastardLoopLRootNote(),seconds:()=>getBastardLoopLStepDurationSeconds(),set:value=>{bastardLoopLSequence=value}},
   {sequence:cloneSequence(bastardLoopXSequence),length:getBastardLoopXPatternLength(),enabled:()=>bastardLoopXEnabled,playable:()=>hasBastardLoopXPlaybackSource(),root:()=>getBastardLoopXRootNote(),seconds:()=>getBastardLoopXStepDurationSeconds(),set:value=>{bastardLoopXSequence=value}}
  ];
  if(!plan.options.drums)return {fills:0};
  apply.snareAccents=drumMachineBaseAccents.snare.slice();
  if(!drumMachineEnabled||!drumMachineSnareBuffer)return {fills:0};
  // The source patch may solo other drum lanes. Include Roll additively in this
  // disposable deck so generated fills remain audible; no solos means no change.
  if(drumMachineLaneSolos.length&&!drumMachineLaneSolos.includes('roll'))restoreDrumMachineLaneSolos([...drumMachineLaneSolos,'roll']);
  if(!isDrumMachineLaneAudible('roll'))return {fills:0};
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
   const end=Math.round(fill.end/step),hits=fill.hits||(plan.variation==='subtle'?2:3),indices=Array.from({length:hits},(_,j)=>end-hits+j);
   for(const index of new Set(indices)){const i=(offset+index)%length;if(roll.pattern[i])continue;
    roll.pattern[i]=true;roll.ratchets[i]=index>=end-2?fill.ratchet:1;roll.dips[i]=roll.dip<100;roll.accents[i]=false;added=true;
   }
   if(added)fills++;
  }
  if(fills)drumMachineRoll=roll;
  return {fills};
 };
 return apply;
})()`;
