/* W has an independent instance of Q's stereo hall and tempo delay graph. */
(function(root){
'use strict';
if(!root.MygrainQ||!root.document)return;
const fields=[['room','Reverb Mix',0,1,.01],['reverbDecay','Decay (seconds)',.5,12,.1],['reverbSize','Room Size / Bloom',0,1,.01],['reverbPredelay','Pre-delay (ms)',0,200,1],['reverbDamping','Damping (Hz)',1000,18000,100],['reverbLowcut','Reverb Low Cut (Hz)',20,1500,10],['reverbWidth','Stereo Width',0,1,.01],['delay','Delay Mix',0,1,.01],['feedback','Delay Feedback',0,.8,.01]];
const keys=[...fields.map(f=>f[0]),'delayBeats'];
const controller=new root.MygrainQ.Controller({context:()=>audioContext,destination:()=>preFilterGainNode||masterGain||audioContext.destination,bpm:()=>Number(document.getElementById('globalBpmSlider').value||120),soloGain:()=>1,channelKey:'W'});
function normalized(value){const state=root.MygrainQTheory.normalizeState(value||{});return Object.fromEntries(keys.map(key=>[key,state[key]]));}
function sync(){
 bastardLoopWEffects=normalized(bastardLoopWEffects);
 Object.assign(controller.state,bastardLoopWEffects,{level:1,enabled:true});
 for(const input of document.querySelectorAll('[data-w-fx]')){input.value=String(bastardLoopWEffects[input.dataset.wFx]);const output=input.parentElement.querySelector('output');if(output)output.textContent=input.value;}
 controller.updateEffects();
}
function input(){sync();return controller.ensureGraph().input;}
const card=document.querySelector('[aria-label="Bastardloop W controls"]');
const panel=document.createElement('details');panel.className='weird-effects';panel.innerHTML='<summary>W · Stereo Hall Reverb &amp; Delay</summary><div class="performance-layer-switches"><button type="button" class="performance-btn" data-w-preset="piano">Piano Hall</button><button type="button" class="performance-btn" data-w-preset="strings">Lush Strings</button><button type="button" class="performance-btn" data-w-preset="cathedral">Cathedral</button><button type="button" class="performance-btn" data-w-preset="off">Reverb Off</button></div>'+fields.map(([key,label,min,max,step])=>'<label class="performance-sound-card"><span>'+label+' <output></output></span><input type="range" id="weirdFx-'+key+'" data-w-fx="'+key+'" min="'+min+'" max="'+max+'" step="'+step+'"></label>').join('')+'<label class="performance-sound-card">Delay time<select id="weirdFx-delayBeats" data-w-fx="delayBeats">'+[[1/12,'1/32 triplet'],[.125,'1/32'],[1/6,'1/16 triplet'],[.25,'1/16'],[1/3,'1/8 triplet'],[.5,'1/8'],[.75,'Dotted 1/8'],[1,'1/4'],[1.5,'Dotted 1/4'],[2,'1/2'],[3,'Dotted 1/2'],[4,'1 bar'],[6,'Dotted bar']].map(([v,label])=>'<option value="'+v+'">'+label+'</option>').join('')+'</select></label>';
card?.append(panel);
panel.addEventListener('input',event=>{const key=event.target.dataset.wFx;if(!key)return;bastardLoopWEffects={...bastardLoopWEffects,[key]:Number(event.target.value)};sync();saveState();});
panel.addEventListener('click',event=>{const preset=event.target.dataset.wPreset;if(!preset)return;const presets={piano:{room:.32,reverbDecay:3.8,reverbSize:.75,reverbPredelay:28,reverbDamping:7000,reverbLowcut:180,reverbWidth:1},strings:{room:.45,reverbDecay:6.5,reverbSize:.95,reverbPredelay:40,reverbDamping:5500,reverbLowcut:220,reverbWidth:1},cathedral:{room:.55,reverbDecay:10,reverbSize:1,reverbPredelay:65,reverbDamping:4800,reverbLowcut:250,reverbWidth:1},off:{room:0}};Object.assign(bastardLoopWEffects,presets[preset]);sync();saveState();});
root.mygrainWEffects=Object.freeze({input,sync,controller,normalized});sync();
})(window);
