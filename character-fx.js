/* Bass Face: bass-preserving harmonic insert. Canonical controls, no audio replacement. */
(function(root){
'use strict';
const Inputs=root.MygrainEffectInputs||(typeof module==='object'&&module.exports?require('./effect-inputs.js'):null);
const INPUTS=Inputs.SOURCES;
// id, name, circuit, drive ceiling, pre-emphasis band, harmonic low cut, low body, output trim, asymmetry.
const STRAINS=Object.freeze([
 ['velvet-valve','Velvet valve','valve',3,420,90,.95,.75,.12],
 ['warm-biscuit','Warm biscuit','soft',4,620,110,.9,.75,0],
 ['tape-hug','Tape hug','tape',3.8,510,85,1,.8,.05],
 ['copper-heart','Copper heart','diode',5,740,100,.9,.65,.2],
 ['pillowy-punch','Pillowy punch','soft',5,320,75,1,.8,0],
 ['subtle-beast','Subtle beast','valve',4.5,880,120,1,.65,.08],
 ['rubber-soul','Rubber soul','tape',7,460,95,.9,.7,.18],
 ['rounded-square','Rounded square','square',6,530,100,.85,.55,0],
 ['bloom-box','Bloom box','valve',8,650,80,1,.6,.3],
 ['iron-cheek','Iron cheek','transistor',8,950,130,.85,.55,.2],
 ['diode-disco','Diode disco','diode',10,1200,120,.9,.5,.35],
 ['octave-orbit','Octave orbit','rectify',7,720,95,1,.55,0],
 ['neon-fangs','Neon fangs','fold',9,1050,140,.9,.45,.15],
 ['gravel-grin','Gravel grin','fuzz',11,860,150,.85,.5,.3],
 ['acid-jaw','Acid jaw','sine',10,1350,140,.9,.4,.05],
 ['molten-molar','Molten molar','valve',13,570,85,1,.48,.45],
 ['bass-barnacle','Bass barnacle','gate',11,740,120,.95,.55,.08],
 ['saw-tooth-smile','Saw-tooth smile','fold',14,1600,170,.9,.38,.3],
 ['carbon-crunch','Carbon crunch','crush',10,980,145,.9,.5,0],
 ['hot-rod','Hot rod','transistor',15,1750,180,.85,.4,.4],
 ['broken-speaker','Broken speaker','fuzz',18,1250,180,.8,.4,.5],
 ['doom-dentist','Doom dentist','square',22,680,100,1,.4,.2],
 ['octopus-prime','Octopus prime','rectify',15,1500,160,.95,.45,.25],
 ['pixel-piranha','Pixel piranha','crush',17,1850,210,.9,.42,.25],
 ['ripped-cone','Ripped cone','gate',20,1400,200,.9,.4,.4],
 ['feral-fold','Feral fold','fold',24,2100,220,.9,.32,.35],
 ['voltage-vampire','Voltage vampire','diode',26,1900,180,1,.38,.55],
 ['black-hole-teeth','Black-hole teeth','fuzz',30,820,110,1,.35,.6],
 ['mutant-mandible','Mutant mandible','sine',28,2300,240,.95,.3,.5],
 ['full-bass-face','Full Bass Face','transistor',36,2600,260,1,.3,.65]
].map(row=>Object.freeze({id:row[0],name:row[1],kind:row[2],drive:row[3],band:row[4],lowcut:row[5],body:row[6],trim:row[7],bias:row[8]})));
const num=(v,d,a=0,b=1)=>v!==null&&v!==''&&Number.isFinite(Number(v))?Math.max(a,Math.min(b,Number(v))):d;
function normalize(v={}){v=v||{};return{version:1,enabled:v.enabled===true,input:INPUTS.includes(v.input)?v.input:'X',strain:STRAINS.some(p=>p.id===v.strain)?v.strain:'velvet-valve',amount:num(v.amount,.35),tone:num(v.tone,.45),mix:num(v.mix,.5),body:num(v.body,.85),rhythm:v.rhythm===true};}
// One hundred editor-only recipes. Routing and power are never part of a factory choice.
const THEMES=[
 ['Warm weight','Velvet basement|Sunday valves|Honeycomb low end|Copper cushion|Soft shoulder|Warm transformer|Blanket fort|Analog handshake|Butter circuit|Amber foundation',[0,1,2,3,4,5,6,7,8,9],.12,.34,.35,.7],
 ['Tape & console','Chrome cassette|Oxide pillow|Desk drive|Quarter-inch hug|Dub spool|Red VU smile|Reel pressure|Brown sugar bus|Magnetic cheek|Console confession',[2,0,6,8,1,9,5,3,4,7],.28,.52,.25,.8],
 ['Tight punch','Rubber mallet|Pocket piston|Punch ticket|Nightbus knock|Solid centre|Short fuse bass|Pillow fight|Urban bumper|Dry socket|Locked jaw',[4,6,7,9,10,14,15,16,18,19],.32,.48,.4,.9],
 ['Dub shadows','Sub cellar|Ghost transformer|Midnight valve|Deep end|Black velvet dub|Basement antenna|Soft concrete|Low orbit|Distant sound system|Rubber submarine',[0,2,8,11,15,16,21,22,27,29],.25,.28,.3,.95],
 ['Harmonic clarity','Phone speaker hero|Copper outline|Bass in daylight|Small speaker giant|Defined intentions|Upper-body strength|Golden second|Contour lantern|Clear teeth|Signal silhouette',[0,3,5,9,10,11,19,22,26,28],.38,.66,.48,.9],
 ['Octave colours','Second sun|Octave jellyfish|Double vision|Rectified velvet|Orbital grin|Two-tone monster|Pink octopus|Harmonic umbrella|Folded moon|Parallel fangs',[11,22,3,10,12,14,17,25,26,28],.42,.5,.42,.85],
 ['Acid & elastic','Acid raincoat|Neon tendon|Elastic basement|Rubber lightning|Toxic toffee|Resonant cheek|Sour jawbreaker|Liquid enamel|Lime voltage|Squidgy circuit',[6,8,12,14,15,17,20,25,28,29],.52,.6,.52,.85],
 ['Fuzz & grit','Gravel mattress|Rusty handshake|Sandpaper sub|Fuzz moustache|Coal miner grin|Hairy foundation|Torn wallpaper|Dirty coin|Garage chin|Industrial dentist',[9,13,15,18,19,20,21,24,26,27],.58,.46,.54,.9],
 ['Broken digital','Pixel molar|Six-bit grin|Robot overbite|Packet teeth|Crushed satellite|Error cheek|Broken arcade|Data cavity|Digital barnacle|Bad checksum',[18,23,16,24,7,17,20,22,25,28],.65,.7,.6,.8],
 ['Full face','Doom smile|Black-hole braces|Voltage bite|Ripped cone king|Mutant jaw|Feral basement|Teeth of thunder|No manners|Bass extinction|Full frontal face',[21,27,26,24,28,25,20,23,17,29],.8,.67,.75,1]
];
const PRESETS=Object.freeze(THEMES.flatMap(([section,names,circuits,drive,tone,mix,body],group)=>names.split('|').map((name,i)=>{
 const strain=STRAINS[circuits[i]],settings=()=>normalize({strain:strain.id,amount:Math.min(.98,drive+(i%5)*.027),tone:Math.max(.05,Math.min(.95,tone+(i%4-1.5)*.045)),mix:Math.min(.95,mix+(i%3)*.035),body:Math.min(1,body-(i%4)*.025),rhythm:group===6&&i%3===0});
 return Object.freeze({id:'face-'+group+'-'+i,section,name,description:section+' · '+strain.name+' circuit. '+(group<2?'Low-drive warmth and controlled upper harmonics.':group>6?'Deliberate grain, clipping and harmonic attitude above the clean bass foundation.':'Shaped bass character with a retained low-end foundation.'),settings});
})));
const fingerprint=value=>{const {enabled,input,...settings}=normalize(value);return JSON.stringify(settings);};
const presetPrints=new Map(PRESETS.map(p=>[fingerprint(p.settings()),p.id]));
function shape(x,p,amount){const z=x*(1+amount*p.drive),b=p.bias*amount;let y;
 switch(p.kind){case'valve':y=Math.tanh(z+b)-Math.tanh(b);break;case'tape':y=Math.tanh(z)/(1+Math.abs(z)*.12);break;case'diode':y=z>=0?Math.tanh(z):.28*Math.tanh(1.7*z);break;case'rectify':y=Math.abs(Math.tanh(z+b))-.2*Math.tanh(z);break;case'fold':y=2/Math.PI*Math.asin(Math.sin(z+b));break;case'sine':y=Math.sin(z+b)*.8;break;case'fuzz':y=Math.tanh(z*2)*(.72+.28*Math.cos(z*1.7+b));break;case'square':y=Math.tanh(z*3);break;case'crush':{const n=3+Math.round((1-amount)*45);y=Math.round(Math.tanh(z)*n)/n;break;}case'gate':y=Math.sign(z)*Math.tanh(Math.max(0,Math.abs(z)-(.12+amount*.65)));break;case'transistor':y=z>=0?Math.tanh(z+b):.6*Math.tanh(z*2-b);break;default:y=z/Math.sqrt(1+z*z);}
 return Math.max(-1,Math.min(1,y));
}
function createGraph(ctx,source,destination,clock={}){
 let nodes=null,print='';const unlink=(a,b)=>{try{b?a.disconnect(b):a.disconnect()}catch{}};
 function clear(){unlink(source,destination);if(nodes){if(nodes.pulse)try{nodes.pulse.stop()}catch{}for(const n of Object.values(nodes))if(n?.disconnect){unlink(source,n);unlink(n);}nodes=null;}print='';}
 function set(value){const v=normalize(value),snapshot=clock.snapshot?.();if(snapshot)Object.assign(clock,{origin:snapshot.origin,bpm:snapshot.bpm,time:snapshot.at});const key=JSON.stringify([v,v.rhythm?clock.origin:0,v.rhythm?clock.bpm:0]);if(key===print)return;
  if(!v.enabled||!v.mix||!v.amount){clear();source.connect(destination);print=key;return;}
  const p=STRAINS.find(p=>p.id===v.strain),i=STRAINS.indexOf(p);clear();
  const dry=ctx.createGain(),low=ctx.createBiquadFilter(),body=ctx.createGain(),pre=ctx.createBiquadFilter(),shaper=ctx.createWaveShaper(),dc=ctx.createBiquadFilter(),post=ctx.createBiquadFilter(),wet=ctx.createGain();nodes={dry,low,body,pre,shaper,dc,post,wet};
  dry.gain.value=1-v.mix;low.type='lowpass';low.frequency.value=110;low.Q.value=.707;body.gain.value=v.mix*v.body*p.body;
  pre.type='lowpass';pre.frequency.value=Math.min(ctx.sampleRate*.4,p.band*(.65+v.tone*1.3));pre.Q.value=.707;
  const curve=new Float32Array(8193);for(let j=0;j<curve.length;j++)curve[j]=shape(j/(curve.length-1)*2-1,p,v.amount);shaper.curve=curve;shaper.oversample='none';
  // Bass-limited drive and a DC/high-pass cleanup avoid destroying the fundamental.
  dc.type='highpass';dc.frequency.value=p.lowcut;dc.Q.value=.707;post.type='lowpass';post.frequency.value=500*2**(v.tone*4);post.Q.value=.707;wet.gain.value=v.mix*p.trim;
  source.connect(dry);dry.connect(destination);source.connect(low);low.connect(body);body.connect(clock.wetDestination||destination);source.connect(pre);pre.connect(shaper);shaper.connect(dc);dc.connect(post);post.connect(wet);wet.connect(clock.wetDestination||destination);
  if(v.rhythm){const pulse=ctx.createBufferSource(),depth=ctx.createGain(),b=ctx.createBuffer(1,16384,8192),a=b.getChannelData(0),bpm=num(clock.bpm,120,1,300),origin=Number.isFinite(clock.origin)?clock.origin:ctx.currentTime,time=Math.max(ctx.currentTime,Number(clock.time)||0);for(let j=0;j<a.length;j++){const cell=Math.floor(j/1024),phase=j/1024-cell,accent=((cell*(i%5+1)+i)%7)<3?1:.2;a[j]=accent*Math.min(1,phase/.025)*Math.pow(1-phase,1+i%4);}pulse.buffer=b;pulse.loop=true;pulse.playbackRate.value=bpm/120;depth.gain.value=500+v.amount*1800;pulse.connect(depth);depth.connect(post.detune);nodes.pulse=pulse;nodes.depth=depth;const offset=(((time-origin)*bpm/120)%2+2)%2;nodes.clock={bpm,origin,time,offset,barSeconds:240/bpm};pulse.start(time,offset);}
  print=key;
 }
 return{set,dispose:clear,get active(){return!!nodes},get clock(){return nodes?.clock?{...nodes.clock}:null}};
}
const matches=Inputs.matches;
root.MygrainBassFace=Object.freeze({INPUTS,STRAINS,PRESETS,estimatedBytes:value=>{const v=normalize(value);return v.enabled&&v.input!=='DAW'&&v.mix>0&&v.amount>0?1024*1024:0;},match:value=>presetPrints.get(fingerprint(value))||'',normalize,shape,createGraph,matches});
if(typeof module==='object'&&module.exports)module.exports=root.MygrainBassFace;
if(!root.document)return;
const byId=id=>document.getElementById(id),eq=root.mygrainChannelEq,rawConnect=eq.connect.bind(eq),rawRelease=eq.releaseContext.bind(eq),groups=new Set();
let state=normalize(readStoredStateSnapshot()?.modes?.bassFace),updating=false;
const clock=(ctx,key)=>({wetDestination:root.mygrainEffectOutput.input(key,ctx),bpm:typeof getTransportClockBpm==='function'?getTransportClockBpm():120,origin:typeof transportSync!=='undefined'&&transportSync.context===ctx?transportSync.origin:0,time:ctx.currentTime,snapshot:()=>root.mygrainWasp.clockSnapshot(ctx)});
const mutilator=()=>root.mygrainD?.settings().mutilator||{};
function wire(g){const m={...mutilator(),input:mutilator().input||'D'},v={...m,enabled:!root.mygrainCookingPot?.active()&&m.enabled&&root.mygrainEffectOutput.allows('mutilator')&&(g.wholeMix?m.input==='all':m.input!=='all'&&matches(m.input,g.key))},print=JSON.stringify(v);if(g.mPrint!==print){g.m.set(v);g.mPrint=print;}g.b.set({...state,enabled:!root.mygrainCookingPot?.active()&&root.mygrainEffectOutput.allows('bassFace')&&state.enabled&&(g.wholeMix?state.input==='all':state.input!=='all'&&matches(state.input,g.key))});}
function group(key,context,destination,external=false,routeContext=context,wholeMix=false){
 const input=context.createGain(),middle=context.createGain(),output=context.createGain(),m=root.mygrainD.mutilatorGraph(context,input,middle,{...clock(context,'mutilator'),oversample:external?'none':'2x'}),b=createGraph(context,middle,output,clock(context,'bassFace'));
 const route=wholeMix?(output.connect(destination),{disconnect(){try{output.disconnect(destination)}catch{}}}):external?(root.mygrainTurntable?.connectExternal(output,destination)||(output.connect(destination),{disconnect(){try{output.disconnect(destination)}catch{}}})):root.mygrainLoopFx.connectDownstream(key,output,destination,null,routeContext);
 const g={key,context,destination,input,middle,output,m,b,route,sources:new Set(),external,wholeMix};groups.add(g);wire(g);return g;
}
function release(g){if(!groups.has(g))return;g.m.dispose();g.b.dispose();g.route.disconnect();for(const s of g.sources)try{s.disconnect(g.input)}catch{}g.input.disconnect();g.middle.disconnect();g.output.disconnect();groups.delete(g);}
function connect(key,source,destination,owner=null,contextOverride=null){
 if(key==='all'||!INPUTS.includes(key))return rawConnect(key,source,destination,owner,contextOverride);
 if(root.MygrainLoopFx.KEYS.includes(key))return rawConnect(key,source,destination,owner,contextOverride);
 for(const g of [...groups])if(g.context.state==='closed')release(g);
 let g=[...groups].find(g=>!g.external&&g.key===key&&g.context===source.context&&g.destination===destination);if(!g)g=group(key,source.context,destination,false,contextOverride||(typeof audioContext!=='undefined'&&(audioContext===source.context||audioContext?.__mygrainNativeContext===source.context)?audioContext:source.context));
 source.connect(g.input);g.sources.add(source);root.mygrainCookingPot?.syncSources();let done=false;const route={disconnect(){if(done)return;done=true;owner?.removeEventListener?.('ended',route.disconnect);try{source.disconnect(g.input)}catch{}g.sources.delete(source);root.mygrainCookingPot?.syncSources();}};owner?.addEventListener?.('ended',route.disconnect,{once:true});return route;
}
root.mygrainLoopFx.setEffectConnector((key,source,destination,context)=>{const g=group(key,source.context,destination,false,context);source.connect(g.input);g.sources.add(source);return{disconnect(){release(g)}};});
// One shared, pre-effects EQ bridge per card/destination, never per effect.
// Keep source/owner cleanup separate from local delay/reverb tails downstream.
const inputGroups=new Set();
function releaseInput(g){if(g.dead)return;g.dead=true;for(const source of g.sources)try{source.disconnect(g.input)}catch{}g.eqRoute.disconnect();g.route.disconnect();g.input.disconnect();g.bridge.disconnect();inputGroups.delete(g);}
function connectPreEq(key,source,destination,owner=null,contextOverride=null){
 if(!root.MygrainChannelEq.KEYS.includes(key))return connect(key,source,destination,owner,contextOverride);
 for(const g of [...inputGroups])if(g.context.state==='closed')releaseInput(g);
 let g=[...inputGroups].find(g=>g.key===key&&g.context===source.context&&g.destination===destination);
 if(!g){const input=source.context.createGain(),bridge=source.context.createGain(),eqRoute=eq.connectInput(key,input,bridge),route=connect(key,bridge,destination,null,contextOverride);g={key,context:source.context,destination,input,bridge,eqRoute,route,sources:new Set(),dead:false};inputGroups.add(g);}
 source.connect(g.input);g.sources.add(source);let done=false;
 // Retain the bus after a voice ends: EQ ringing and downstream space tails must decay naturally.
 const route={disconnect(){if(done)return;done=true;owner?.removeEventListener?.('ended',route.disconnect);try{source.disconnect(g.input)}catch{}g.sources.delete(source);}};
 owner?.addEventListener?.('ended',route.disconnect,{once:true});return route;
}
eq.enablePreEffectsRouting();eq.connect=connectPreEq;root.mygrainLoopFx.connect=connectPreEq;
eq.releaseContext=ctx=>{for(const g of [...inputGroups])if(!ctx||g.context===ctx||g.context===ctx.__mygrainNativeContext)releaseInput(g);for(const g of [...groups])if(!ctx||(g.context===ctx||g.context===ctx.__mygrainNativeContext))release(g);return rawRelease(ctx);};
function update(){if(updating)return;updating=true;try{for(const g of groups)wire(g);sync();root.mygrainCookingPot?.changed();}finally{updating=false;}}
function restore(value){state=normalize(value);update();}
function activeInputs(){const keys=root.mygrainLoopFx?.filterActiveKeys()||[];
 if(generatedLoopBuffer&&generatedDryLoopEnabled&&getGeneratedDryMixValue()>0&&!loopLayerSolo.length&&(!hasAnyPerformanceLayerSoloSelection()||generatedSampleSolo))keys.push('generated');
 if(getDrumMachineLevelValue()>0){const has=p=>p?.slice(0,getPatternLengthSteps()).some(Boolean);for(const[name,buffer,level]of[['kick',drumMachineKickBuffer,drumMachineKickTrackLevel],['snare',drumMachineSnareBuffer,drumMachineSnareTrackLevel],['hat',true,drumMachineHatTrackLevel],['perc',drumMachinePercBuffer,drumMachinePercTrackLevel]])if(buffer&&level>0&&has(getDrumMachinePattern(name)))keys.push('drum'+name[0].toUpperCase()+name.slice(1));for(const[name,t]of Object.entries(drumMachineExtraTracks))if(t.buffer&&t.level>0&&has(t.pattern))keys.push('drum'+name[0].toUpperCase()+name.slice(1));if(drumMachineSnareBuffer&&drumMachineSnareTrackLevel>0&&drumMachineRoll.pattern.some(Boolean))keys.push('drumRoll');}
 if(root.mygrainDawFx?.connected)keys.push('DAW');return keys;}
function eligible(input){return activeInputs().some(key=>matches(input,key));}
function randomise(options={}){const random=options.random||Math.random,pick=a=>a[Math.min(a.length-1,Math.floor(random()*a.length))],inputs=activeInputs();state=normalize({...state,enabled:options.enabled??random()<.5,input:options.chooseInput&&inputs.length?pick(inputs):state.input,strain:pick(STRAINS).id,amount:.15+random()*.8,tone:.15+random()*.7,mix:.2+random()*.65,body:.6+random()*.4,rhythm:random()<.35});if(!options.configureOnly&&!root.mygrainCookingPot?.active()&&!eligible(state.input))state.enabled=false;update();return normalize(state);}
function finishRandomization(){if(state.enabled&&!root.mygrainCookingPot?.active()&&!eligible(state.input)){state.enabled=false;update();return true;}return false;}
async function edit(label,action){try{if(root.mygrainCardHistory?.busy||root.mygrainSongBeta?.busy||root.mygrainSongBeta?.playing||stateSaveSuspended)throw Error('Finish the current edit or stop Song playback first.');const run=()=>{action();saveState();};if(root.mygrainCardHistory)await root.mygrainCardHistory.runDraftEdit(label,run);else run();}catch(e){sync();setStatus(e.message,'error');}}
const labels={A:'A · Loop',B:'B · Loop',C:'C · Loop',D:'D · Mutilator loop',V:'V · Vocal',W:'W · Weird',P:'P · Loop',O:'O · Loop',L:'L · Lead',X:'X · Bass',Q:'Q · Instrument',M:'M · Loop','M+':'M+ · Loop',generated:'Generated Loop',sample:'Dropbox sample',K:'K · All tracks',drums:'Drums · All tracks',N:'N · Noise',DAW:'DAW / FX plugin input'};
const options=selected=>Inputs.SOURCES.map(key=>`<option value="${key}"${key===selected?' selected':''}>${Inputs.label(key)}</option>`).join('');
const card=document.createElement('section');card.id='bassFaceCard';card.className='bass-face-card';card.setAttribute('aria-label','Bass Face harmonic distortion');
card.innerHTML=`<div class="bass-face-head"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 14 22 8l10 6 12-6 10 10-4 32-18 8-20-9Z" fill="currentColor"/><path d="m17 25 10 3m10 0 11-4M19 39l8 8 7-7 6 6 8-10" fill="none" stroke="#151020" stroke-width="5" stroke-linejoin="round"/><path d="M5 29v14m54-18v20" stroke="currentColor" stroke-width="4"/></svg><div><h4>BASS FACE</h4><p>Low-end manners. Harmonic misbehaviour.</p></div></div><div class="bass-face-actions"><button type="button" class="performance-btn" id="bassFaceToggle" aria-pressed="false">Bass Face Off</button><button type="button" class="performance-btn" id="bassFaceRandom">New face</button></div><section class="bass-face-bank" aria-label="Bass Face preset browser"><label for="bassFacePreset">PATCH BANK · 100 presets</label><div class="bass-face-preset-controls"><button type="button" class="performance-btn" id="bassFacePrev" aria-label="Previous Bass Face patch">−</button><select id="bassFacePreset" aria-describedby="bassFacePresetDescription"><option value="">Custom / choose a patch…</option>${THEMES.map(([section])=>`<optgroup label="${section}">${PRESETS.filter(p=>p.section===section).sort((a,b)=>a.name.localeCompare(b.name)).map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</optgroup>`).join('')}</select><button type="button" class="performance-btn" id="bassFaceNext" aria-label="Next Bass Face patch">+</button></div><p id="bassFacePresetDescription" aria-live="polite"></p></section><label>Input<select id="bassFaceInput">${options('X')}</select></label><label>Strain · 30 circuits<select id="bassFaceStrain">${STRAINS.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select></label><div class="bass-face-grid">${[['amount','Drive'],['tone','Tone'],['mix','Wet / dry'],['body','Clean bass body']].map(([key,label])=>`<label>${label}<output data-bass-value="${key}"></output><input type="range" id="bassFace-${key}" data-bass-field="${key}" min="0" max="100" value="50" step="1"></label>`).join('')}</div><label class="bass-face-rhythm"><input id="bassFaceRhythm" type="checkbox"> Tempo-locked rhythm</label><p id="bassFaceStatus" role="status">Select a source; its original audio stays untouched.</p>`;
document.querySelector('[aria-label="Bastardloop X controls"]').append(card);
const mPanel=byId('loopDMutilator'),mLabel=document.createElement('label');mLabel.className='d-mutilator-control';mLabel.innerHTML=`Input<select id="mutilatorInput" aria-label="Mutilator input">${options('D')}</select>`;mPanel.querySelector('.d-mutilator-head').after(mLabel);mPanel.setAttribute('aria-label','Mutilator routable filter and distortion');
// The matched sound label may be Custom; keep the last factory browsing position.
let lastBassFacePreset='';
function sync(){if(!byId('bassFaceToggle'))return;byId('bassFaceToggle').textContent='Bass Face '+(state.enabled?'On':'Off');byId('bassFaceToggle').setAttribute('aria-pressed',String(state.enabled));card.dataset.active=String(state.enabled);byId('bassFaceInput').value=state.input;byId('bassFaceStrain').value=state.strain;byId('bassFaceRhythm').checked=state.rhythm;byId('mutilatorInput').value=mutilator().input||'D';const preset=PRESETS.find(p=>p.id===root.MygrainBassFace.match(state));if(preset)lastBassFacePreset=preset.id;byId('bassFacePreset').value=preset?.id||'';byId('bassFacePresetDescription').textContent=preset?preset.description:'Custom bass shaping. Choose a patch; power and input routing stay unchanged.';for(const k of ['amount','tone','mix','body']){if(document.activeElement!==byId('bassFace-'+k))byId('bassFace-'+k).value=String(Math.round(state[k]*100));card.querySelector(`[data-bass-value="${k}"]`).textContent=Math.round(state[k]*100)+'%';}const p=STRAINS.find(p=>p.id===state.strain);byId('bassFaceStatus').textContent=p.name+' · '+p.kind+' harmonics. Clean low-end body is blended beneath the shaped band. '+(state.input==='DAW'?'Connect MYGRAIN FX and select a processed route, not Direct.':'Only '+(labels[state.input]||state.input)+' is processed; turn its card on to hear it.');}
let choosingPreset=false;
async function choosePreset(id){const p=PRESETS.find(p=>p.id===id);if(!p||choosingPreset){sync();return;}choosingPreset=true;const controls=['bassFacePreset','bassFacePrev','bassFaceNext'].map(byId);for(const c of controls)c.disabled=true;try{await edit('Bass Face patch · '+p.name,()=>restore({...p.settings(),enabled:state.enabled,input:state.input}));}finally{choosingPreset=false;for(const c of controls)c.disabled=false;sync();}}
byId('bassFacePreset').onchange=e=>choosePreset(e.target.value);
for(const [id,step]of [['bassFacePrev',-1],['bassFaceNext',1]])byId(id).onclick=()=>{if(choosingPreset)return;const options=[...byId('bassFacePreset').options].filter(p=>p.value),i=options.findIndex(p=>p.value===(byId('bassFacePreset').value||lastBassFacePreset));choosePreset(options[i<0?(step>0?0:options.length-1):(i+step+options.length)%options.length].value);};
byId('bassFaceToggle').onclick=()=>edit('Bass Face on/off',()=>restore({...state,enabled:!state.enabled}));byId('bassFaceRandom').onclick=()=>edit('Bass Face strain',()=>randomise({enabled:true,configureOnly:true}));
for(const [id,key]of [['bassFaceInput','input'],['bassFaceStrain','strain'],['bassFaceRhythm','rhythm']])byId(id).onchange=e=>{const value=e.target.type==='checkbox'?e.target.checked:e.target.value;edit('Bass Face '+key,()=>restore({...state,[key]:value}));};
for(const input of card.querySelectorAll('[data-bass-field]'))input.oninput=e=>{state=normalize({...state,[input.dataset.bassField]:Number(input.value)/100});update();saveState();};
byId('mutilatorInput').onchange=e=>{const input=e.target.value;edit('Mutilator input',()=>root.mygrainD.setMutilator({input},{skipSave:true}));};
// Character inserts precede the existing per-card FX, Wasp and channel EQ routes.
const oldSync=root.mygrainLoopFx.syncClock;root.mygrainLoopFx.syncClock=function(...args){const r=oldSync(...args);root.mygrainWasp.syncClock(...args);for(const g of groups){g.m.dispose();g.b.dispose();g.mPrint=null;g.m=root.mygrainD.mutilatorGraph(g.context,g.input,g.middle,{wetDestination:root.mygrainEffectOutput.input('mutilator',g.context),bpm:args[1],origin:args[0],time:args[2],snapshot:()=>root.mygrainWasp.clockSnapshot(g.context),oversample:g.external?'none':'2x'});g.b=createGraph(g.context,g.middle,g.output,{wetDestination:root.mygrainEffectOutput.input('bassFace',g.context),bpm:args[1],origin:args[0],time:args[2],snapshot:()=>root.mygrainWasp.clockSnapshot(g.context)});wire(g);}return r;};
root.mygrainBassFace={settings:()=>normalize(state),restore,randomise,finishRandomization};
root.mygrainCharacterFx={bindMaster(source,destination){for(const old of [...groups])if(old.wholeMix&&old.context===source.context)release(old);const g=group('all',source.context,destination,false,source.context,true);source.connect(g.input);g.sources.add(source);},update,eligible,activeInputs,groups,inputGroups,connect:connectPreEq,connectExternal(source,destination){const g=group('DAW',source.context,destination,true);source.connect(g.input);g.sources.add(source);return{disconnect(){release(g)}};},diagnostics:()=>({groups:groups.size,processors:[...groups].reduce((n,g)=>n+Number(g.b.active)+Number(g.m.active),0)}),release(){for(const g of [...inputGroups])releaseInput(g);for(const g of [...groups])release(g);}};
root.addEventListener('mygrain-account-lock',()=>root.mygrainCharacterFx.release());root.addEventListener('pagehide',()=>root.mygrainCharacterFx.release());sync();
root.addEventListener('mygrain-effect-solo',()=>update());
})(globalThis);
