(function(root){
'use strict';
const DSP=root.MygrainNoise;if(!DSP)throw Error('N noise generator could not load. Reload MYGRAIN.');
const stored=readStoredStateSnapshot()||{};let state=DSP.startupSettings(stored.modes?.noiseN,stored),graph=null,running=false,lastMessage='',lfosLast='';
const taps=new Set(),modules=new WeakMap();
const byId=id=>document.getElementById(id);
function lfos(){return [1,2,3].map(n=>{const p=n===1?'lfo':`lfo${n}`;return{rate:Number(byId(`${p}Rate`)?.value||120)/60,wave:byId(`${p}Waveform`)?.value||'sine',depth:Number(byId(`${p}Depth`)?.value||0)/100,pulse:getLfoPulseWidth(n),start:n===1?lfoStartTime:n===2?lfo2StartTime:lfo3StartTime,cross:[1,2,3].map(j=>j===n?0:Number(byId(`lfo${j}ToLfo${n}Mod`)?.value||0)/100)}})}
async function prepare(ctx){const native=ctx.createGain().context;if(!modules.has(native))modules.set(native,native.audioWorklet.addModule(new URL('noise-envelope-worklet.js?v=20261025-n-threshold-1',document.baseURI)));await modules.get(native)}
function disconnect(source,target){try{target?source.disconnect(target):source.disconnect()}catch{}}
function selected(tap){return graph&&tap.context===graph.native&&(tap.key===state.source||state.source==='K'&&/^K[1-5]$/.test(tap.key)||state.source==='drums'&&tap.key.startsWith('drum'))}
function wireTaps(){for(const tap of taps){const want=selected(tap)?graph.envelope:null;if(tap.target!==want){if(tap.target)disconnect(tap.source,tap.target);tap.target=want;if(want)tap.source.connect(want)}}}
function observe(key,source,owner){const tap={key,source,context:source.context,target:null};taps.add(tap);wireTaps();let done=false;const release=()=>{if(done)return;done=true;if(tap.target)disconnect(source,tap.target);taps.delete(tap);owner?.removeEventListener?.('ended',release)};owner?.addEventListener?.('ended',release,{once:true});return release}
// The loop-FX host captures this wrapper as its raw EQ connection: loop taps
// therefore read the FX output bridge. Other lanes tap their final EQ input.
const eq=root.mygrainChannelEq,oldConnect=eq.connect.bind(eq),oldRelease=eq.releaseContext.bind(eq);
eq.connect=function(key,source,destination,owner){const route=oldConnect(key,source,destination,owner),release=observe(key,source,owner),close=route.disconnect.bind(route);route.disconnect=()=>{release();close()};return route};
eq.releaseContext=function(ctx){if(!ctx||graph?.context===ctx)dispose();for(const tap of [...taps])if(!ctx||tap.context===ctx||ctx===graph?.context){if(tap.target)disconnect(tap.source,tap.target);taps.delete(tap)}return oldRelease(ctx)};
function makeNoise(ctx,type){const sr=ctx.sampleRate,b=ctx.createBuffer(2,sr*2,sr);for(let ch=0;ch<2;ch++){let seed=1234567+ch*777,b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;const d=b.getChannelData(ch);for(let i=0;i<d.length;i++){seed=(Math.imul(seed,1664525)+1013904223)|0;const w=seed/2147483648;if(type==='pink'){b0=.99886*b0+w*.0555179;b1=.99332*b1+w*.0750759;b2=.969*b2+w*.153852;b3=.8665*b3+w*.3104856;b4=.55*b4+w*.5329522;b5=-.7616*b5-w*.016898;d[i]=(b0+b1+b2+b3+b4+b5+b6+w*.5362)*.11;b6=w*.115926}else d[i]=w*.5}}return b}
function filterQ(s,index){if(s.filterType==='lowpass'||s.filterType==='highpass'){const q=1/(2*Math.cos(Math.PI*(2*index+1)/(2*s.poles)));return 20*Math.log10(q*(index===0?s.resonance/Math.SQRT1_2:1))}return index===0?s.resonance:Math.SQRT1_2}

function createGraph(ctx,destination,settings=state){const native=destination.context,env=new AudioWorkletNode(native,'mygrain-noise-envelope-v1',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],channelCount:2,channelCountMode:'explicit',processorOptions:{settings,lfos:lfos()}}),source=ctx.createBufferSource(),gain=ctx.createGain(),drive=ctx.createWaveShaper(),input=ctx.createGain();
 source.buffer=makeNoise(ctx,'white');source.loop=true;const pinkSource=ctx.createBufferSource(),whiteGain=ctx.createGain(),pinkGain=ctx.createGain();pinkSource.buffer=makeNoise(ctx,'pink');pinkSource.loop=true;source.connect(whiteGain);pinkSource.connect(pinkGain);whiteGain.connect(drive);pinkGain.connect(drive);whiteGain.gain.value=settings.type==='white'?1:0;pinkGain.gain.value=settings.type==='pink'?1:0;drive.connect(input);gain.gain.value=0;const fxRoute=root.mygrainLoopFx?root.mygrainLoopFx.connect('N',gain,destination,null,ctx):(gain.connect(destination),null);source.start();pinkSource.start();
 const g={context:ctx,native,envelope:env,source,pinkSource,whiteGain,pinkGain,gain,drive,input,fxRoute,filters:[],retired:new Set(),settings:null};configureGraph(g,settings,true);return g;
}
function configureGraph(g,s,initial=false){const now=g.context.currentTime,old=g.settings;
 if(!old||old.type!==s.type){g.whiteGain.gain.setTargetAtTime(s.type==='white'?1:0,now,.01);g.pinkGain.gain.setTargetAtTime(s.type==='pink'?1:0,now,.01);}
 if(!old||old.drive!==s.drive){const curve=new Float32Array(2049),a=10**(s.drive/20);for(let i=0;i<curve.length;i++){const x=i/1024-1;curve[i]=s.drive===0?x:Math.tanh(x*a)/Math.tanh(a)}g.drive.curve=curve;g.drive.oversample='2x'}
 if(!old||old.poles!==s.poles||old.filterType!==s.filterType||old.filterEnabled!==s.filterEnabled){const retired=g.branch;const branch={nodes:[],gain:g.context.createGain()};let tail=g.input;const count=s.filterEnabled?s.poles/2:0;for(let i=0;i<count;i++){const f=g.context.createBiquadFilter();f.type=s.filterType;f.frequency.value=Math.min(s.cutoff,g.context.sampleRate*.45);f.Q.value=filterQ(s,i);g.envelope.connect(f.detune);tail.connect(f);tail=f;branch.nodes.push(f)}tail.connect(branch.gain);branch.gain.connect(g.gain);branch.gain.gain.setValueAtTime(initial?1:0,now);if(!initial)branch.gain.gain.linearRampToValueAtTime(1,now+.015);g.branch=branch;g.filters=branch.nodes;
  if(retired){retired.gain.gain.cancelScheduledValues(now);retired.gain.gain.setValueAtTime(retired.gain.gain.value,now);retired.gain.gain.linearRampToValueAtTime(0,now+.015);const timer=setTimeout(()=>{g.retired.delete(item);disconnect(g.input,retired.nodes[0]||retired.gain);for(const f of retired.nodes){disconnect(g.envelope,f.detune);disconnect(f)}disconnect(retired.gain)},40);const item={branch:retired,timer};g.retired.add(item)}
 }
 for(let i=0;i<g.filters.length;i++){g.filters[i].frequency.setTargetAtTime(Math.min(s.cutoff,g.context.sampleRate*.45),now,.012);g.filters[i].Q.setTargetAtTime(filterQ(s,i),now,.012)}
 g.settings={...s};g.envelope.port.postMessage({settings:s,lfos:lfos()});
}
function disposeGraph(g){g.fxRoute?.disconnect();g.envelope.port.onmessage=({data})=>{if(data?.disposed)g.envelope.port.close()};g.envelope.port.postMessage({dispose:true});try{g.source.stop();g.pinkSource.stop()}catch{}for(const item of g.retired||[]){clearTimeout(item.timer);for(const f of item.branch.nodes)disconnect(f);disconnect(item.branch.gain)}for(const n of [g.source,g.pinkSource,g.whiteGain,g.pinkGain,g.drive,g.input,...g.filters,g.branch?.gain,g.gain,g.envelope])if(n)disconnect(n)}
function dispose(){if(graph){const old=graph;graph=null;wireTaps();disposeGraph(old)}taps.clear();running=false}
async function setup(ctx,destination){dispose();await prepare(ctx);graph=createGraph(ctx,destination);wireTaps();lastMessage='';tick()}
function settings(){return DSP.normalize({...state,enabled:byId('noiseType')?isNoiseOscillatorActive():state.enabled,type:['white','pink'].includes(byId('noiseType')?.value)?byId('noiseType').value:state.type,level:Number(byId('noiseMix')?.value??state.level)})}
function sync(){if(!card)return;const s=settings();for(const el of card.querySelectorAll('[data-noise-field]')){const k=el.dataset.noiseField;if(document.activeElement!==el){if(el.type==='checkbox')el.checked=s[k];else el.value=String(s[k])}const output=card.querySelector(`[data-noise-value="${k}"]`);if(output)output.textContent=k==='amount'?s[k].toFixed(1)+' oct':k==='drive'?s[k].toFixed(1)+' dB':['attack','decay','release','hold'].includes(k)?Math.round(s[k])+' ms':k==='cutoff'?Math.round(s[k])+' Hz':String(Math.round(s[k]*100)/100)}card.querySelector('[data-noise-field=threshold]').disabled=s.source==='manual';byId('noiseNToggle').textContent=s.enabled?'N On':'N Off';byId('noiseNToggle').setAttribute('aria-pressed',String(s.enabled));byId('noiseNToggle').classList.toggle('layer-muted',!s.enabled);card.querySelector('[data-noise-status]').textContent=running&&state.enabled?'N playing · '+(state.source==='manual'?'manual trigger':state.source+' envelope driver'):'N stopped';}
function tick(){const s=settings();if(!graph||graph.context.state==='closed'){state.enabled=s.enabled;state.type=s.type;state.level=s.level;return;}const legacyOn=s.enabled;if(state.enabled!==legacyOn){state.enabled=legacyOn;s.enabled=legacyOn;sync()}
 state.type=s.type;state.level=s.level;
 const msg=JSON.stringify(s);if(msg!==lastMessage){configureGraph(graph,s);lastMessage=msg;wireTaps()}
 const l=lfos(),key=JSON.stringify(l);if(key!==lfosLast){graph.envelope.port.postMessage({lfos:l});lfosLast=key}
 const level=Number(getModulatedValue('noiseMix'))/100;
 const soloMuted=hasAnyPerformanceLayerSoloSelection()&&!loopLayerSolo.includes('noise');
 const now=graph.context.currentTime,param=graph.gain.gain;if(param.cancelAndHoldAtTime)param.cancelAndHoldAtTime(now);else{const value=param.value;param.cancelScheduledValues(now);param.setValueAtTime(value,now)}param.setTargetAtTime(running&&state.enabled&&!soloMuted?Math.max(0,Math.min(1,level))*.35:0,Math.max(now,running?graph.playAt||0:0),.012);
}
function setEnabled(enabled,options={}){state.enabled=Boolean(enabled);if(enabled){setSelectValue('noiseType',state.type);if(Number(byId('noiseMix').value)<=0)setSliderValue('noiseMix',state.level||20)}else setSelectValue('noiseType','none');tick();sync();syncPerformanceControlState();if(!options.skipSave)saveState()}
function restore(value,legacy={}){state=DSP.normalize(value,legacy);if(byId('noiseType'))byId('noiseType').value=state.enabled?state.type:'none';if(byId('noiseMix'))byId('noiseMix').value=String(state.level);lastMessage='';tick();sync()}
function start(time=audioContext?.currentTime){if(!graph)return false;running=true;graph.playAt=Math.max(graph.context.currentTime,time||0);graph.envelope.parameters.get('gate').cancelScheduledValues(graph.context.currentTime);graph.envelope.parameters.get('gate').setValueAtTime(0,graph.context.currentTime);graph.envelope.parameters.get('gate').setValueAtTime(1,Math.max(graph.context.currentTime,time||0));tick();sync();return true}
function stop(){running=false;if(graph){graph.envelope.parameters.get('gate').cancelScheduledValues(graph.context.currentTime);graph.envelope.parameters.get('gate').setValueAtTime(0,graph.context.currentTime);graph.gain.gain.cancelScheduledValues(graph.context.currentTime);graph.gain.gain.setTargetAtTime(0,graph.context.currentTime,.005)}sync()}
const select=(k,label,values)=>`<label>${label}<select data-noise-field="${k}">${values.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label>`;
const slider=(k,label,min,max,step)=>`<label><span>${label}<output data-noise-value="${k}"></output></span><input type="range" data-noise-field="${k}" min="${min}" max="${max}" step="${step}"></label>`;
const card=document.createElement('section');card.id='noiseCard';card.className='performance-feature-card';card.setAttribute('aria-label','Noise N controls');card.innerHTML=`<div class="performance-feature-head"><h3>N · Noise</h3><button class="performance-btn" type="button" id="noiseNToggle" aria-pressed="false">N Off</button></div><p>Independent white / pink noise. Drivers are amplitude copies only: their audio, level and routing remain unchanged.</p><div class="noise-actions"><button class="performance-btn" type="button" id="noiseNPlay">Play N</button><button class="performance-btn" type="button" id="noiseNStop">Stop N</button><button class="performance-btn performance-layer-solo-btn" type="button" id="noiseNSolo" aria-pressed="false">Solo Off</button><button class="performance-btn" type="button" id="noiseNTrigger">Trigger envelope</button><button class="performance-btn" type="button" id="noiseNRandom">Randomise N</button></div><div class="noise-grid" id="noiseNLegacy"></div><details open><summary>Multi-pass filter</summary><div class="noise-grid"><label><input type="checkbox" data-noise-field="filterEnabled">Filter on</label>${select('filterType','Pass mode',DSP.TYPES.map(k=>[k,{lowpass:'Low-pass',highpass:'High-pass',bandpass:'Band-pass',notch:'Notch / band-reject'}[k]]))}${select('poles','Poles',DSP.POLES.map(n=>[n,n+' poles']))}${slider('cutoff','Cutoff',20,20000,10)}${slider('resonance','Resonance',.1,4,.01)}${slider('drive','Noise drive',0,24,.1)}</div></details><details open><summary>Driven / triggered filter envelope</summary><div class="noise-grid">${select('source','Envelope driver',DSP.SOURCES.map(k=>[k,k==='manual'?'Manual trigger':k.startsWith('L')&&/^L\d$/.test(k)?k+' · global LFO':k==='drums'?'Drums · all tracks':k.startsWith('drum')?'Drums · '+k.slice(4):k==='K'?'K · all five tracks':k.startsWith('K')?'K · track '+k.slice(1):k==='generated'?'Generated Loop':k==='sample'?'Dropbox sample':'Loop '+k]))}${select('mode','Response',[['trigger','Triggered ADSR'],['follow','Amplitude follower']])}${slider('amount','Envelope depth',-8,8,.1)}${slider('sensitivity','Driver sensitivity',.25,32,.25)}${slider('threshold','Trigger / gate threshold',.005,.95,.005)}${slider('attack','Attack',1,2000,1)}${slider('decay','Decay',5,4000,1)}${slider('sustain','Sustain',0,1,.01)}${slider('hold','Hold',5,2000,1)}${slider('release','Release',5,5000,1)}<label><input type="checkbox" data-noise-field="invert">Invert envelope</label></div><p>Threshold is measured after Driver sensitivity: lower sensitivity if every hit crosses it. Follow opens above threshold, closes below half threshold and uses attack/release smoothing. Trigger fires a full-depth ADSR on each crossing; Envelope depth sets the sweep and Hold sets sustain time. Manual triggers bypass threshold. L1–L3 use their existing global shapes, rates, depths and cross-modulation.</p></details><p data-noise-status role="status"></p>`;
(document.querySelector('[aria-label="Drum machine controls"]')||byId('bastardLoopKCard')).after(card);
const old=byId('noise-tab');for(const child of [...old.children])byId('noiseNLegacy').append(child);old.hidden=true;for(const tab of document.querySelectorAll('[data-tab="noise"]'))tab.hidden=true;card.querySelector('#noiseMix').closest('.control-group').querySelector('.param-name').textContent='N Level';
for(const el of card.querySelectorAll('[data-noise-field]')){el.id='noiseN-'+el.dataset.noiseField;el.closest('label').htmlFor=el.id;el.addEventListener('input',()=>{const k=el.dataset.noiseField;state=DSP.normalize({...settings(),[k]:el.type==='checkbox'?el.checked:['source','mode','filterType'].includes(k)?el.value:Number(el.value)});tick();sync();saveState()})}
for(const id of ['noiseType','noiseMix','performanceNoiseLevel'])for(const event of ['input','change'])byId(id)?.addEventListener(event,()=>{tick();sync()});
for(const event of ['keydown','keyup'])card.addEventListener(event,e=>e.stopPropagation());
byId('noiseNSolo').onclick=()=>setLoopLayerSolo('noise',{toggle:true});byId('noiseNToggle').onclick=()=>setEnabled(!state.enabled);byId('noiseNPlay').onclick=()=>{setEnabled(true);start()};byId('noiseNStop').onclick=stop;byId('noiseNTrigger').onclick=()=>{if(!graph)return;setEnabled(true);if(!running)start();graph.envelope.port.postMessage({trigger:true})};
// Resolve after the random arrangement has applied its final layer mutes. Do
// not use live taps here: playback has not restarted, so they may be stale.
function mixDriverSources(){
 const sources=lfos().flatMap((l,i)=>l.depth>0&&l.rate>0?['L'+(i+1)]:[]);
 const loops=[
  ['A',bastardLoopBuffer,getBastardLoopLevelValue()],
  ['B',bastardLoop2Buffer,getBastardLoop2LevelValue()],
  ['C',bastardLoop3Buffer,getBastardLoop3LevelValue()],
  ['V',bastardLoopVBuffer,getBastardLoopVLevelValue()],
  ['W',bastardLoopWBuffer,getBastardLoopWLevelValue()],
  ['P',bastardLoopPBuffer,getBastardLoopPLevelValue()],
  ['O',bastardLoopOBuffer,getBastardLoopOLevelValue()],
  ['L',hasPlayableBastardLoopLTransportSource(),getBastardLoopLLevelValue()],
  ['X',hasPlayableBastardLoopXTransportSource(),getBastardLoopXLevelValue()],
  ['generated',generatedLoopTransportEnabled&&generatedLoopBuffer,getGeneratedDryMixValue()],
  ['sample',dropboxSampleLayerBuffer,getDropboxSampleLayerLevelValue()]
 ];
 for(const [key,playable,level] of loops)if(playable&&level>0)sources.push(key);
 if(getDrumMachineLevelValue()>0){
  const tracks=[
   ['drumKick',drumMachineKickBuffer,drumMachineKickPattern,getDrumMachineKickPlaybackLevel()],
   ['drumSnare',drumMachineSnareBuffer,drumMachineSnarePattern,getDrumMachineSnareLevelValue()],
   ['drumHat',drumMachineHatBuffer,drumMachineHatPattern,getDrumMachineHatLevelValue()],
   ['drumPerc',drumMachinePercBuffer,drumMachinePercPattern,getDrumMachinePercLevelValue()],
   ['drumRoll',drumMachineSnareBuffer,drumMachineRoll.pattern,getDrumMachineSnareLevelValue()]
  ];
  for(const track of Object.values(drumMachineExtraTracks)){
   const key=track.kind==='clap'?'drumClap':track.kind==='cymbals'?'drumCymbals':'drumEtc';
   tracks.push([key,track.buffer,track.pattern,readExtraDrumMachineControls(track).level]);
  }
  const active=tracks.filter(([,buffer,pattern,level])=>buffer&&level>0&&pattern.some(Boolean));
  if(active.length)sources.push('drums',...active.map(([key])=>key));
 }
 // Randomise always supplies moving LFOs; L1 also remains a safe fallback for
 // an all-empty manual patch, without unmuting or modifying another track.
 return sources.length?sources:['L1'];
}
function randomiseMixDriver(){if(!settings().enabled)return;const sources=mixDriverSources();state.source=sources[Math.floor(Math.random()*sources.length)];lastMessage='';tick();sync();return state.source}
function randomise(){state=DSP.randomise(settings());setSelectValue('noiseType',state.enabled?state.type:'none');setSliderValue('noiseMix',state.level);lastMessage='';tick();sync();syncPerformanceControlState()}
byId('noiseNRandom').onclick=()=>{randomise();saveState()};
const nav=document.createElement('button');nav.type='button';nav.className='section-jump-option';nav.dataset.jumpTarget='#noiseCard';nav.textContent='N · Noise';nav.addEventListener('click',()=>{const jump=()=>{card.scrollIntoView({behavior:'instant',block:'start'});root.guardSectionJumpAfterOverlayClose?.();return {target:card,block:'start'}};if(!root.mygrainNavigation?.transitionJump(jump))jump()});document.querySelector('[data-jump-target="#bastardLoopKCard"]')?.after(nav);if(!nav.isConnected)document.querySelector('[data-jump-target="#performanceMixerCard"]')?.before(nav);
root.mygrainNoise={prepare,setup,settings,restore,tick,sync,start,stop,dispose,lfoSettings:lfos,setEnabled,randomise,randomiseMixDriver,mixDriverSources,observe,taps,get graph(){return graph},get running(){return running},get audible(){return running&&state.enabled},createGraph,disposeGraph};
restore(state);syncPerformanceControlState();root.addEventListener('mygrain-account-lock',dispose);root.addEventListener('pagehide',dispose);
})(window);
