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
 return event=>{
  active.forEach((x,i)=>level(x,x.value*(1-event.amount*(i===event.pick%Math.max(1,active.length)?1:.15))));
  const selected=event.amount>0?Math.min(available.length,event.amount>.3?2:1):0;
  const added=[];
  available.forEach((x,i)=>{const offset=(i-event.pick%Math.max(1,available.length)+available.length)%available.length,on=offset<selected;
   // Set the level before waking a parked lane; never add unloaded sources.
   level(x,on?Math.min(x.value||35,event.amount>.3?30:16):x.value);x.enable(on||x.on);if(on)added.push(x.key);
  });
  if(filter&&Number.isFinite(cutoff)){filter.value=String(Math.max(Number(filter.min),cutoff*(1-event.amount*.65)));filter.dispatchEvent(new Event('input',{bubbles:true}))}
  if(drumMachineEnabled&&drumMachineHatBuffer){drumMachineHatPattern=hats.slice();drumMachineHatAccentPattern=accents.slice();
   if(event.hat){const count=getPatternLengthSteps(),i=(event.seed%Math.max(1,Math.floor(count/4)))*4+3;drumMachineHatPattern[i]=true;drumMachineHatAccentPattern[i]=false;
    if(event.amount>.3&&count>8){const j=(i+count-4)%count;drumMachineHatPattern[j]=!hats[j]}}
  }
  return {active:active.length,added};
 };
})()`;
