(function(root){
'use strict';
const FX=root.MygrainLoopFx,eq=root.mygrainChannelEq;if(!FX||!eq)throw Error('Loop effects could not load. Reload MYGRAIN.');
let state=FX.normalize(null,readStoredStateSnapshot()||{});const groups=new Set(),panels=[];
let preparationDepth=0;
// Source preparation is stopped: retain routing/settings, but release native
// delay/convolution storage until the ownership transfer and IDB copies finish.
const graphSettings=key=>preparationDepth?{...state.channels[key],delayEnabled:false,reverbEnabled:false}:state.channels[key];
function prepareEditing(){
 preparationDepth++;for(const g of groups)rebuild(g);for(const ctx of new Set([...groups].map(g=>g.context)))FX.releaseImpulseCache(ctx);
 let done=false;return()=>{if(done)return;done=true;preparationDepth--;update()};
}
const bpm=()=>typeof getTransportClockBpm==='function'?getTransportClockBpm():Number(document.getElementById('globalBpmSlider')?.value||120);
function createGraph(context,bridge,key){
 const clock=context===audioContext&&transportSync.context===context?transportSync:null;
 return FX.createGraph(context,bridge,graphSettings(key),bpm(),Number.isFinite(clock?.origin)?clock.origin:0,Math.max(context.currentTime,Number.isFinite(clock?.startTime)?clock.startTime:context.currentTime));
}
function rebuild(g){const old=g.graph;for(const source of g.sources)try{source.disconnect(old.input)}catch{};old.dispose();g.graph=createGraph(g.context,g.bridge,g.key);for(const source of g.sources)source.connect(g.graph.input)}
function syncClock(origin,tempo,at){for(const g of groups)if(g.context===audioContext)g.graph.syncClock(origin,tempo,at)}
const rawConnect=eq.connect.bind(eq),rawRelease=eq.releaseContext.bind(eq);
function release(g){g.graph.dispose();g.eqRoute.disconnect();g.bridge.disconnect();groups.delete(g)}
function connect(key,source,destination,owner=null,contextOverride=null){
 if(!FX.KEYS.includes(key))return rawConnect(key,source,destination,owner);
 for(const g of [...groups])if(g.context.state==='closed')release(g);
 const context=contextOverride || audioContext || source.context;
 let g=[...groups].find(g=>g.key===key&&g.context===context&&g.destination===destination);
 if(!g){const bridge=context.createGain(),eqRoute=key==='N'?(root.mygrainWasp?root.mygrainWasp.connect(key,bridge,destination):(bridge.connect(destination),{disconnect(){try{bridge.disconnect(destination)}catch{}}})):rawConnect(key,bridge,destination),graph=createGraph(context,bridge,key);g={key,context,destination,bridge,eqRoute,graph,sources:new Set()};groups.add(g)}
 source.connect(g.graph.input);g.sources.add(source);let ended=false;
 const route={disconnect(){if(ended)return;ended=true;owner?.removeEventListener?.('ended',route.disconnect);g.sources.delete(source);try{source.disconnect(g.graph.input)}catch{}}};owner?.addEventListener?.('ended',route.disconnect,{once:true});return route;
}
eq.connect=connect;eq.releaseContext=function(ctx){for(const g of [...groups])if(!ctx||g.context===ctx)release(g);return rawRelease(ctx)};
const selectedK=()=>`K${(root.mygrainKMultitrack?.selected||0)+1}`;
function keyFor(panel){return panel.dataset.loopFxKey==='K'?selectedK():panel.dataset.loopFxKey}
function update(){for(const g of groups)if(g.context.state!=='closed')g.graph.update(graphSettings(g.key),bpm());sync()}
function restore(value,legacy){state=FX.normalize(value,legacy||{});update()}
function sync(){for(const panel of panels){const key=keyFor(panel),s=state.channels[key];panel.querySelector('[data-loop-fx-title]').textContent=key==='N'?'Reverb & tempo delay':key.startsWith('K')?`${key} · Filter & space`:'Filter & space';for(const el of panel.querySelectorAll('[data-loop-fx]')){const k=el.dataset.loopFx;if(document.activeElement!==el){if(el.type==='checkbox')el.checked=s[k];else el.value=String(s[k])}const o=panel.querySelector(`[data-loop-fx-value="${k}"]`);if(o)o.textContent=format(k,s[k])}}}
function format(key,v){if(key==='pan')return v===0?'Centre':Math.round(Math.abs(v)*100)+'% '+(v<0?'L':'R');if(['room','delay','feedback','lfoDepth','reverbSize','reverbWidth'].includes(key))return Math.round(v*100)+'%';if(/cutoff|damping|lowcut/i.test(key))return v>=1000?(v/1000).toFixed(1)+' kHz':Math.round(v)+' Hz';if(key==='reverbDecay')return Number(v).toFixed(1)+' s';if(key==='reverbPredelay')return v+' ms';return Number(v).toFixed(2)}
const slider=(k,label,min,max,step)=>`<label class="loop-fx-control"><span>${label}<output data-loop-fx-value="${k}"></output></span><input type="range" data-loop-fx="${k}" min="${min}" max="${max}" step="${step}"></label>`;
const select=(k,label,values)=>`<label class="loop-fx-control">${label}<select data-loop-fx="${k}">${values.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label>`;
const check=(k,label)=>`<label class="loop-fx-check"><input type="checkbox" data-loop-fx="${k}">${label}</label>`;
const divisions=[[1/12,'1/32 triplet'],[.125,'1/32'],[1/6,'1/16 triplet'],[.25,'1/16'],[1/3,'1/8 triplet'],[.5,'1/8'],[.75,'Dotted 1/8'],[1,'1/4'],[1.5,'Dotted 1/4'],[2,'1/2'],[3,'Dotted 1/2'],[4,'1 bar'],[6,'Dotted bar']];
const presets={piano:{reverbEnabled:true,room:.32,reverbDecay:3.8,reverbSize:.75,reverbPredelay:28,reverbDamping:7000,reverbLowcut:180,reverbWidth:1},strings:{reverbEnabled:true,room:.45,reverbDecay:6.5,reverbSize:.95,reverbPredelay:40,reverbDamping:5500,reverbLowcut:220,reverbWidth:1},cathedral:{reverbEnabled:true,room:.55,reverbDecay:10,reverbSize:1,reverbPredelay:65,reverbDamping:4800,reverbLowcut:250,reverbWidth:1},off:{reverbEnabled:false},delayOff:{delayEnabled:false}};
const legacyBin=document.createElement('div');legacyBin.hidden=true;legacyBin.inert=true;legacyBin.id='loopFxLegacyControls';document.body.append(legacyBin);
function retire(el){if(!el||el.closest('#loopFxLegacyControls'))return;legacyBin.append(el)}
function mount(key,card){if(!card)return;
 if(!card.dataset.loopFxMounted && !root.__mygrainSongRenderDeck){root.mygrainDemand.whenVisible(card,()=>{card.dataset.loopFxMounted='true';mount(key,card);sync()});return;}
 if(root.__mygrainSongRenderDeck)return;
 // Keep old IDs in an inert, non-rendered compatibility bin for old exports and code.
 for(const input of [...card.querySelectorAll('[id]')]){
  if(!/^(?:performanceBastardLoop.*(?:Filter(?:Mode|Cutoff|Lfo.*)|Delay(?:Division|FilterCutoff|Mix|PingPongBtn)|RoomReverbMix|Reverb(?:Mix|Size|Decay|Tone))|qReverb.*)$/.test(input.id))continue;
  if(/FilterEnvelope/.test(input.id))continue;retire(input.closest('.performance-sound-card')||input);
 }
 retire(card.querySelector('.q-reverb-panel'));retire(card.querySelector('.weird-effects'));
 if(key==='Q')for(const input of [...card.querySelectorAll('[data-q-field]')])if(['highpass','lowpass','room','delay','delayBeats','feedback'].includes(input.dataset.qField))retire(input.closest('.performance-sound-card')||input.closest('label')||input);
 // Native K filter / delay / reverb editor is superseded, but tuning, drive and envelope remain.
 if(key==='K')for(const input of [...card.querySelectorAll('[data-k-processing]')])if(['filterMode','cutoff','resonance','lfoWave','lfoDivision','lfoAmount','lfoInvert','delayMix','delayDivision','delayFeedback','delayCutoff','reverbMix','reverbDecay'].includes(input.dataset.kProcessing)){const row=input.closest('label')||input.parentElement;row.hidden=true;row.inert=true;row.dataset.loopFxSuperseded='true'}
 const panel=document.createElement('section');panel.className='loop-fx';panel.dataset.loopFxKey=key;panel.setAttribute('aria-label',`Loop ${key} filter, reverb and delay`);
 panel.innerHTML=`<h4 data-loop-fx-title>Filter &amp; space</h4>${!['K','M+'].includes(key)?slider('pan','Pan',-1,1,.01):''}<details class="loop-fx-filter"><summary>LFO Filter</summary><p class="loop-fx-filter-note">Resonance emphasises the cutoff frequency. Switch Filter on and sweep Cutoff through the sound’s range to hear it.</p><div class="loop-fx-grid">${check('filterEnabled','Filter on')}${select('filterType','Type',[['lowpass','Low-pass'],['highpass','High-pass']])}${select('filterSlope','Poles / slope',FX.SLOPES.map(n=>[n,`${n/6} poles · ${n} dB/oct`]))}${slider('cutoff','Cutoff',20,20000,10)}${slider('resonance','Resonance (Q)',.1,4,.01)}${select('lfoWave','LFO shape',[['sine','Sine'],['triangle','Triangle'],['sawtooth','Saw down'],['ramp','Ramp up'],['square','Square']])}${select('lfoBeats','LFO cycle',[[.25,'1/16'],[.5,'1/8'],[1,'1/4'],[2,'1/2'],[4,'1 bar'],[8,'2 bars'],[16,'4 bars'],[32,'8 bars'],[64,'16 bars']])}${slider('lfoDepth','LFO depth',0,1,.01)}${check('lfoInvert','Invert LFO')}</div></details><details class="loop-fx-hall"><summary>Stereo Hall Reverb</summary><p>Parallel stereo hall: the dry attack stays intact.</p><div class="loop-fx-actions">${[['piano','Piano Hall'],['strings','Lush Strings'],['cathedral','Cathedral'],['off','Reverb Off']].map(([k,l])=>`<button type="button" class="performance-btn" data-loop-fx-preset="${k}">${l}</button>`).join('')}</div><div class="loop-fx-grid">${check('reverbEnabled','Reverb on')}${slider('room','Reverb Mix',0,1,.01)}${slider('reverbDecay','Decay',.5,12,.1)}${slider('reverbSize','Room Size / Bloom',0,1,.01)}${slider('reverbPredelay','Pre-delay',0,200,1)}${slider('reverbDamping','High-frequency Damping',1000,18000,100)}${slider('reverbLowcut','Reverb Low Cut',20,1500,10)}${slider('reverbWidth','Stereo Width',0,1,.01)}</div></details><details class="loop-fx-delay"><summary>Tempo Delay</summary><div class="loop-fx-actions"><button type="button" class="performance-btn" data-loop-fx-preset="delayOff">Delay Off</button></div><div class="loop-fx-grid">${check('delayEnabled','Delay on')}${slider('delay','Delay Mix',0,1,.01)}${select('delayBeats','Delay time',divisions)}${slider('feedback','Feedback',0,.7,.01)}${slider('delayCutoff','Delay Tone',200,18000,100)}${check('pingPong','Ping pong')}</div></details>`;
 if(key==='N'){panel.querySelector('.loop-fx-filter').remove();panel.setAttribute('aria-label','N noise reverb and tempo delay')}
 for(const el of panel.querySelectorAll('[data-loop-fx]')){el.id=`loopFx-${key.replace('+','Plus')}-${el.dataset.loopFx}`;el.closest('label').htmlFor=el.id}
 for(const event of ['keydown','keyup'])panel.addEventListener(event,event=>event.stopPropagation());
 panel.addEventListener('input',event=>{const el=event.target,k=el.dataset.loopFx;if(!k)return;const key=keyFor(panel);state.channels[key]=FX.channel({...state.channels[key],[k]:el.type==='checkbox'?el.checked:el.tagName==='SELECT'&&['filterType','lfoWave'].includes(k)?el.value:Number(el.value)});update();saveState()});
 panel.addEventListener('click',event=>{const p=event.target.dataset.loopFxPreset;if(!p)return;Object.assign(state.channels[keyFor(panel)],presets[p]);update();saveState()});
 if(key==='L'||key==='X'){const accent=card.querySelector(`[id="performanceBastardLoop${key}FilterEnvelope"]`);if(accent)panel.querySelector('.loop-fx-filter .loop-fx-grid').append(accent.closest('.performance-sound-card')||accent)}
 if(key==='K'){const old=card.querySelector('#performanceBastardLoopKFilterEnvelope');if(old)retire(old.closest('.performance-sound-card')||old)}
 card.append(panel);panels.push(panel);
}
mount('N',document.getElementById('noiseCard'));
for(const key of ['A','B','C','V','W','P','O','L','X','M','M+','K','Q']){
 const id={A:'bastardLoopCard',B:'bastardLoop2Card',C:'bastardLoop3Card','M+':'bastardLoopMPlusCard'}[key]||`bastardLoop${key}Card`;mount(key,document.getElementById(id)||document.querySelector(`[aria-label="Bastardloop${key==='A'?'':' '+key} controls"]`));
}
root.mygrainLoopFx={prepareEditing,settings:()=>JSON.parse(JSON.stringify(state)),channel:key=>state.channels[key],restore,update,sync,syncClock,connect,groups,randomise(){state=FX.subtle(state);setSliderValue('grainSynthAPan',0);setSliderValue('grainSynthBPan',0);setBastardLoopMPlusPanPercent(0,{skipSave:true});root.mygrainKMultitrack?.centrePans();if(root.mygrainQ){root.mygrainQ.state.pan=0;root.mygrainQ.updateEffects()}update()},stop(){for(const g of groups)rebuild(g)}};
// Legacy filters are retained only as the independent note/accent-envelope stage.
createBastardLoopConfigurableFilters=function(cutoff,mode,key){
 if(!['L','X','K1'].includes(key))return [];
 const f=audioContext.createBiquadFilter();f.type='allpass';f.frequency.value=cutoff;f.Q.value=.707;return[f];
};
function triggerNoteEnvelope(key,time,duration,step){
 const isL=key==='L',amount=isL?getBastardLoopLFilterEnvelopeAmountForStep(step):getBastardLoopXFilterEnvelopeAmountForStep(step);
 const base=isL?getBastardLoopLFilterCutoff():getBastardLoopXFilterCutoff();
 const peak=isL?computeBastardLoopLFilterEnvelopePeakCutoff(base,amount):computeBastardLoopXFilterEnvelopePeakCutoff(base,amount);
 const cents=amount>.001&&peak>base+2?1200*Math.log2(peak/base):0;
 const decay=isL?getBastardLoopLDecayRatio():getBastardLoopXDecayRatio();
 for(const g of groups)if(g.key===key&&g.context===audioContext)g.graph.triggerEnvelope(time,duration,cents,decay);
}
for(const key of ['L','X']){
 const wrapped=function(filters,time,duration,step){for(const f of filters||[])f.type='allpass';triggerNoteEnvelope(key,time,duration,step)};
 if(key==='L')applyBastardLoopLFilterEnvelope=wrapped;else applyBastardLoopXFilterEnvelope=wrapped;
 // OSC3 source modes bypass the sample scheduler's envelope hook.
 const original=key==='L'?playBastardLoopLSynthVoice:playBastardLoopXSynthVoice;
 const synth=function(step,time,duration,next,options){const result=original(step,time,duration,next,options);if(result)triggerNoteEnvelope(key,time,duration,step);return result};
 if(key==='L')playBastardLoopLSynthVoice=synth;else playBastardLoopXSynthVoice=synth;
}
// The old X/K LFOs must not stack on top of the common audio-clock LFO.
attachBastardLoopXFilterLfoToVoice=()=>{};attachBastardLoopKFilterLfo=()=>{};
destroyBastardLoopXFilterLfoSource();destroyBastardLoopKFilterLfoSource();
ensureBastardLoopXFilterLfoSource=()=>null;
const oldBpm=applyGlobalBpm;applyGlobalBpm=function(...args){const result=oldBpm(...args);update();return result};
// K's selected-track panel follows its existing tab, with no DOM rebuild.
const oldKSync=syncBastardLoopKUi;syncBastardLoopKUi=function(...args){const result=oldKSync(...args);sync();return result};
root.mygrainWEffects=Object.freeze({sync(){},normalized:v=>FX.channel(v)});
sync();
})(window);

/* Checkbox adapters retain the authoritative existing effect actions and save paths. */
(function(){
'use strict';
const controls=[['drumSendReverbEnabledBtn','Drum reverb'],['drumSendDelayEnabledBtn','Drum delay'],['performanceLayerReverbBtn','Global reverb'],['performanceLayerDelayBtn','Global delay'],['performanceFinalReverbBtn','Final reverb']];
for(const [id,title] of controls){
 const button=document.getElementById(id);if(!button)continue;
 const label=document.createElement('label');label.className='loop-fx-check';
 const input=document.createElement('input');input.type='checkbox';input.id=id+'Checkbox';
 label.append(input,document.createTextNode(title+' on'));button.after(label);button.hidden=true;button.style.display='none';
 const sync=()=>{input.checked=button.getAttribute('aria-pressed')==='true';};
 input.addEventListener('change',()=>{if(input.checked!==(button.getAttribute('aria-pressed')==='true'))button.click();sync();});
 new MutationObserver(sync).observe(button,{attributes:true,attributeFilter:['aria-pressed']});sync();
}
// The final delay previously only had an Off action; give it the shared on/off control.
const off=document.getElementById('performanceDelayOffBtn'),main=document.getElementById('performanceLayerDelayBtnCheckbox');
if(off&&main){const label=document.createElement('label');label.className='loop-fx-check';const input=document.createElement('input');input.type='checkbox';input.id='performanceFinalDelayCheckbox';label.append(input,document.createTextNode('Final delay on'));off.after(label);off.hidden=true;off.style.display='none';input.checked=main.checked;input.onchange=()=>{if(input.checked!==main.checked)main.click();};new MutationObserver(()=>{input.checked=document.getElementById('performanceLayerDelayBtn').getAttribute('aria-pressed')==='true';}).observe(document.getElementById('performanceLayerDelayBtn'),{attributes:true,attributeFilter:['aria-pressed']});}
})();
