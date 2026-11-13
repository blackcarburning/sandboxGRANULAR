(function(root){
'use strict';
if(root.__mygrainSongRenderDeck||root.mygrainPhone||/iPhone|iPad|Android|iPod/i.test(navigator.userAgent))return;
const layerIds=["performanceLayerReverbBtn", "performanceLayerDelayBtn", "performanceLayerOscBtn", "performanceLayerGranularBtn", "performanceLayerPianoBtn", "performanceLayerStringsBtn", "performanceNoiseLayerBtn", "performanceGeneratedLayerBtn", "performanceDryLoopLayerBtn", "performanceBastardLoopToggleBtn", "performanceBastardLoop2ToggleBtn", "performanceBastardLoop3ToggleBtn", "performanceBastardLoopVToggleBtn", "performanceBastardLoopDToggleBtn", "performanceBastardLoopWToggleBtn", "performanceBastardLoopPToggleBtn", "performanceBastardLoopOToggleBtn", "performanceBastardLoopLToggleBtn", "performanceBastardLoopXToggleBtn", "performanceBastardLoopQGlobalToggleBtn", "performanceBastardLoopMToggleBtn", "performanceBastardLoopMPlusToggleBtn", "performanceBastardLoopKToggleBtn", "performanceDropboxSampleLayerBtn", "performanceDrumMachineLayerBtn"],encoder=new TextEncoder();
class Remote {
 constructor(options){this.options=options;this.worker=null;this.id=0;this.busy=false;this.lastSent=0;this.lastCommand='';this.lastCompanion='';this.message='Ready. Automatic patch storage follows your interval; save the DAW project normally.';}
 reset(worker=null){this.generation=(this.generation||0)+1;this.worker=worker;this.id=0;this.busy=false;this.lastSent=0;this.lastCommand='';this.lastCompanion='';this.message='Ready. Automatic patch storage follows your interval; save the DAW project normally.';}
 get audioBusy(){return this.busy&&[1,2,4].includes(this.action);}
 blocked(){return this.options.project.storing||!root.mygrainAccounts?.authenticated||!this.options.ready()||typeof megaRandomizeInFlight==='undefined'||megaRandomizeInFlight||!!root.mygrainCardHistory?.busy||!!root.mygrainSongBeta?.busy||!!root.mygrainSongBeta?.playing||!!root.mygrainAiPatch?.busy||(typeof isOutputRecording!=='undefined'&&(isOutputRecording||isOutputRecordingArmed||isRecording||bastardLoopMRecordingState!=='idle'||bastardLoopMPlusRecordingState!=='idle'||bastardLoopKRecordingState!=='idle'));}
 observe(clock){
  if(clock.remoteControl!==1||!this.worker)return;
  const now=performance.now();if(now-this.lastSent<200)return;this.lastSent=now;
  let enabled=0,available=0;layerIds.forEach((id,i)=>{const b=document.getElementById(id);if(!b)return;available|=1<<i;if(b.getAttribute('aria-pressed')==='true')enabled|=1<<i;});
  if(clock.remotePot===1&&root.mygrainCookingPot?.remoteState){
   const pot=root.mygrainCookingPot.remoteState(),project=this.options.project.diagnostics(),s=project.stats;
   const text=String(project.status).replace(/[\x00-\x1f\x7f]/g,' ').slice(0,250),hex=Array.from(encoder.encode(text),b=>b.toString(16).padStart(2,'0')).join('');
   const values=[pot.enabled?1:0,pot.mask,pot.order.join(''),project.auto.enabled?1:0,project.auto.interval,project.storing?1:0,project.nextIn,Math.floor(s.lastSave/1000),Math.round(s.durationMs),s.transferBytes,s.snapshotBytes,s.count,s.skipped,s.totalBytes];
   const command='companion-state:'+values.join(':')+':'+hex;
   if(command!==this.lastCompanion||now-(this.companionHeartbeat||0)>2000){this.lastCompanion=command;this.companionHeartbeat=now;this.worker.postMessage({type:'companionStatus',command});}
  }
  const generationBusy=typeof megaRandomizeInFlight!=='undefined'&&megaRandomizeInFlight,p=root.mygrainRandomProgress;
  const busy=this.busy||generationBusy,progress=generationBusy||this.action===1||this.action===2?p:null;
  const done=progress?.done||0,total=progress?.total||0,warnings=progress?.warnings||0;
  let text=generationBusy?(p?.message||'Randomising patch...')+(p?.waiting?' '+p.waiting:''):this.message;
  if(!busy&&this.options.rendered())text+=' Rendered audio changes after Refresh render.';
  if(!this.options.ready()&&!busy)text='Start MYGRAIN and finish project recall before using patch controls.';
  text=String(text).replace(/[\x00-\x1f\x7f]/g,' ').slice(0,200);while(encoder.encode(text).length>420)text=text.slice(0,-1);const bytes=encoder.encode(text);const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  const command=`remote-state:${this.id}:${busy?1:0}:${Math.min(done,total)}:${total}:${warnings}:${enabled}:${available}:${!busy&&!this.blocked()?1:0}:${hex}`;
  if(command!==this.lastCommand||now-(this.heartbeat||0)>2000){this.lastCommand=command;this.heartbeat=now;this.worker.postMessage({type:'remoteStatus',command});}
 }
 async event(data){
  if(data.type!=='remoteCommand')return false;
  if(!Number.isInteger(data.id)||data.id<1||data.id<=this.id)return true;
  this.id=data.id;this.action=data.action;const generation=this.generation;
  if(this.busy||this.blocked()){this.message='Another edit, recording or project operation is active. Try again when ready.';return true;}
  this.busy=true;this.message='Working...';if(data.action===1||data.action===2)this.worker.postMessage({type:'command',command:'not-ready'});
  try{
   root.mygrainSongBetaAdapter.assertNotRecording();
   if(data.action===1||data.action===2){await runMegaRandomization({sparseMode:data.action===1});this.message=root.mygrainRandomProgress?.message||'Randomisation complete.';}
   else if(data.action===3){const button=document.getElementById(layerIds[data.index]);if(!button||button.disabled||![0,1].includes(data.value))throw Error('Layer is unavailable.');if((button.getAttribute('aria-pressed')==='true')!==!!data.value)button.click();this.message='Layer updated. Automatic storage will include this edit.';}
   else if(data.action===4){if(!this.options.rendered())throw Error('Refresh render is for Bridge Rendered mode.');await this.options.render();this.message=this.options.renderedReady()?'Rendered loop refreshed. Automatic storage will include it; save the DAW project normally.':'Render did not complete. Stop the DAW and retry.';}
   else if(data.action===5){await this.options.project.store();const end=performance.now()+120000;while((this.options.project.busy||this.options.project.storing)&&performance.now()<end){if(generation!==this.generation)return true;await new Promise(r=>setTimeout(r,100));}this.message=this.options.project.diagnostics().status;}
   else if([6,7,8,9,10].includes(data.action)){await root.mygrainCookingPot.remoteControl(data.action,data.index,data.value);this.message='Cooking pot updated. Automatic storage will include the edit.';}
   else if(data.action===11){this.options.project.configure({enabled:!!data.value});this.message='Automatic storage '+(data.value?'enabled.':'paused.');}
   else if(data.action===12){this.options.project.configure({interval:data.value});this.message='Automatic store interval updated.';}
   else throw Error('Unsupported patch action.');
  }catch(error){this.message='Could not finish: '+error.message;}
  finally{if(generation===this.generation){this.busy=false;this.lastSent=0;this.observe(this.options.clock()||{});}}
  return true;
 }
 diagnostics(){return {busy:this.busy,id:this.id,message:this.message};}
}
root.MygrainDawRemote=Remote;
})(window);
