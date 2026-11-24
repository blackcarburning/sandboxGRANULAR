/* Surface the native retained-loop/offline boundary; do not fake a live bounce. */
(function(root){
'use strict';
if(root.__mygrainSongRenderDeck)return;
let button,dialog,busy=false;
const active=()=>root.mygrainDawFx?.connected?'fx':root.mygrainDawBridge?.connected?'bridge':null;
function sync(){const hidden=!active();if(button&&button.hidden!==hidden)button.hidden=hidden;}
async function wait(check,deadline,message){while(!check()){if(!root.mygrainDawBridge?.connected)throw Error('Plugin disconnected.');if(performance.now()>deadline)throw Error(message);await new Promise(resolve=>setTimeout(resolve,100));}}
async function prepare(select,status){
 if(busy)return;busy=true;select.disabled=true;const action=dialog.querySelector('[data-render-prepare]');action.disabled=true;
 try{
  const api=root.mygrainDawBridge,d=api.diagnostics();if(!d.connected||active()!=='bridge')throw Error('Connect an instrument instance first.');
  if(d.clock?.playing)throw Error('Stop Cubase playback before preparing the loop.');if(d.busy||d.project?.busy||d.project?.storing||!d.project?.ready)throw Error('Wait for project storage/recall to finish.');
  document.getElementById('dawBridgeBars').value=select.value;
  api.selectMode('rendered');status.textContent='Preparing a retained loop for offline rendering…';
  const deadline=performance.now()+150000;await wait(()=>!api.diagnostics().busy,deadline,'Could not select Rendered mode.');
  const before=api.diagnostics().clock?.loopRevision;
  await api.prepareLoop();
  // A failed or cancelled render never counts as an updated native snapshot.
  if(!api.diagnostics().awaitingUpload&&!api.diagnostics().busy&&api.diagnostics().clock?.loopRevision===before)throw Error(document.getElementById('dawBridgeStatus').textContent);
  await wait(()=>{const d=api.diagnostics();return d.prepared&&!d.busy&&!d.awaitingUpload&&d.clock?.loopRevision!==before;},deadline,'No completed native render was acknowledged.');
  await api.arm(false);await wait(()=>api.diagnostics().clock?.armed,performance.now()+10000,'Arm was not acknowledged.');
  const session=[...(root.mygrainProjectSessions||[])].find(s=>s.options.kind==='bridge'&&s.worker&&s.ready);if(!session||!await session.storeAndWait())throw Error('Loop prepared, but the editable project was not stored. Use Store now to retry before saving the DAW project.');
  status.textContent='Rendered loop ready and stored in the plugin. Save your DAW project. In Cubase, select the intended event/range and Render in Place. The loop repeats at the DAW musical position. Refresh this render after any sound changes.';
 }catch(error){status.textContent=error.message;}
 finally{busy=false;select.disabled=false;action.disabled=false;}
}
function open(){
 if(dialog)return;const kind=active();if(!kind)return;
 const d=dialog=document.createElement('dialog');d.className='parts-bin-dialog';d.id='pluginRenderDialog';d.setAttribute('aria-labelledby','pluginRenderTitle');
 const h=document.createElement('h3');h.id='pluginRenderTitle';h.textContent=kind==='fx'?'Cubase · printing CEF FX':'Cubase · Render in Place';
 const text=document.createElement('p');text.textContent=kind==='fx'?'CEF FX processes a live browser audio stream. Fast offline Render in Place cannot include that processed return: this version outputs time-aligned dry audio offline. This is not fixed by arming or choosing more render channels.':'Live CEF / Bridge streams cannot supply a fast offline render. Prepare a Rendered loop first: its audio is held inside the plugin and can be read at Cubase’s timeline position during Render in Place. This captures the instrument patch, not incoming track audio or an arrangement of changing patches.';
 const instructions=document.createElement('p');instructions.textContent=kind==='fx'?'To include the effects now: solo the required track, use File → Export → Audio Mixdown, enable Real-Time Export, then import that WAV onto an audio track. Alternatively, record the processed output to a separate audio track in real time. Keep the FX armed, allow its one-second buffer to settle and include the intended effect tail. Avoid routing the recorded return back to its own input.':'Stop Cubase, choose the loop length below, then prepare it. The plugin switches to Rendered and arms after the completed loop arrives. It repeats this snapshot; later sound edits require a fresh render. Include effects/channel settings as needed in Cubase’s Render Settings. For non-repeating live performances, use real-time export or record to another audio track.';
 d.append(h,text,instructions);
 if(kind==='bridge'){
  const label=document.createElement('label');label.textContent='Loop length';label.htmlFor='pluginRenderBars';const select=document.createElement('select');select.id='pluginRenderBars';for(const n of [1,2,4,8,16]){const o=document.createElement('option');o.value=n;o.textContent=n+' bars';select.append(o);}select.value=document.getElementById('dawBridgeBars').value;
  const status=document.createElement('p');status.setAttribute('role','status');const action=document.createElement('button');action.type='button';action.dataset.renderPrepare='';action.textContent='Prepare instrument render';action.onclick=()=>prepare(select,status);d.append(label,select,action,status);
 }
 const close=document.createElement('button');close.type='button';close.textContent='Close';close.onclick=()=>{if(!busy)d.close();};d.append(close);d.oncancel=event=>{if(busy)event.preventDefault();};d.onclose=()=>{d.remove();dialog=null;button?.focus({preventScroll:true});};document.body.append(d);d.showModal();close.focus();
}
function mount(){button=document.getElementById('dawRenderHelpBtn');if(button)button.onclick=open;sync();}
root.mygrainPluginRender={sync,open};root.addEventListener('mygrain-account-lock',()=>{if(dialog){busy=false;dialog.close();}sync();});
if(document.readyState==='complete')mount();else root.addEventListener('load',mount,{once:true});
})(window);
