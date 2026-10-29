const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
function extract(name) { const start=html.search(new RegExp('^        (?:async )?function '+name+'\\(', 'm')); assert(start>=0,name);const end=html.indexOf('\n        }',start);return html.slice(start,end+10); }
function fixture(names, values) {const state=vm.createContext(values);for(const name of names)vm.runInContext(extract(name),state);return state;}
function node(){return {edges:new Set(),connects:0,connect(target){this.edges.add(target);this.connects++},disconnect(target){if(target)this.edges.delete(target);else this.edges.clear()}}}

test('disabled distortion stages have no input/output edges, including repeated mute/unmute cycles',()=>{
 const input=node(),nodes=[node(),node(),node(),node()],output=node();const state=fixture(['safeDisconnectNode','configureDistortionStages'],{distortionRoutingStates:new WeakMap(),finalFxInput:null,makeupGain:null});
 state.configureDistortionStages(input,nodes,output,[0,0,0,0]);assert.deepEqual([...input.edges],[output]);assert(nodes.every(n=>n.edges.size===0));
 const connections=input.connects;state.configureDistortionStages(input,[...nodes],output,[0,0,0,0]);assert.equal(input.connects,connections,'equivalent arrays must not reconnect unchanged audio');
 for(let i=0;i<50;i++){state.configureDistortionStages(input,nodes,output,[.5,0,.4,0]);assert.deepEqual([...input.edges],[nodes[0]]);assert.deepEqual([...nodes[0].edges],[nodes[2]]);assert.deepEqual([...nodes[2].edges],[output]);state.configureDistortionStages(input,nodes,output,[0,0,0,0]);assert.deepEqual([...input.edges],[output]);assert(nodes.every(n=>n.edges.size===0));}
});

test('static/hidden controls do not call full FX updates, while routed LFOs retain the audio cadence',()=>{
 const counts={effects:0,compressor:0,pan:0,synth:0,placement:0};const state=fixture(['updateAudioModulationTick'],{audioContext:{state:'running'},document:{hidden:false,getElementById:()=>({})},lfoEnabled:{},lfo2Enabled:{},lfo3Enabled:{},finalFxPlacementSwitchStartTime:0,
 updateFinalFxPlacementLfo(){counts.placement++},updateEffects(){counts.effects++},updateFinalCompressorDynamics(){counts.compressor++},updateFinalOutputPanning(){counts.pan++},updateSynthLfoModulation(){counts.synth++},getSliderPercent:()=>0,isPerformanceElementVisible:()=>false});
 for(let i=0;i<30;i++)state.updateAudioModulationTick();assert.deepEqual(counts,{effects:0,compressor:30,pan:0,synth:30,placement:30});
 state.lfo2Enabled.lpfCutoff=true;for(let i=0;i<30;i++)state.updateAudioModulationTick();assert.equal(counts.effects,30);assert.equal(counts.synth,60);
 state.document.hidden=true;state.updateAudioModulationTick();assert.equal(counts.effects,30);assert.equal(counts.synth,60);
});

for(const kind of ['M','MPlus'])test(`${kind} input meter delegates to the visibility clock without its own timer`,()=>{
 let read,reads=0,updates=0;const name='bastardLoop'+kind,shell={};
 const state=fixture(['startBastardLoop'+kind+'InputMeter'],{window:{mygrainMeters:{watch(el,callback){assert.equal(el,shell);read=callback;return()=>{}}}},document:{getElementById:()=>shell},[name+'MicAnalyserNode']:{getFloatTimeDomainData(data){reads++;data.fill(.1)}},[name+'MicAnalyserData']:new Float32Array(32),
 ['stopBastardLoop'+kind+'InputMeter'](){},['updateBastardLoop'+kind+'InputVuMeter'](){updates++}});
 state['startBastardLoop'+kind+'InputMeter']();assert.equal(reads,0);read();assert.equal(reads,1);assert.equal(updates,1);
});

test('bypass-aware compensation follows live stages and never mutates cached calibration',()=>{
 const input={},legacy={},cache={status:'measured',sampleRate:48000,baseOutputFrames:288,distortionStageFrames:128,frames:288,seconds:.006};const counts={send:0,return:0};let delay;
 const routing=new WeakMap([[input,{key:'1001'}],[legacy,{key:'1'}]]);const state=fixture(['refreshTransportDistortionLatency'],{audioContext:{currentTime:1},transportSync:{latency:cache},distortionRoutingStates:routing,finalFxInput:input,makeupGain:legacy,finalKickBypassDelay:{delayTime:{setValueAtTime(value){delay=value}}},updateTransportSendLatency(){counts.send++},updateDrumSendReturnLatency(){counts.return++}});
 state.refreshTransportDistortionLatency();assert.equal(state.transportSync.latency.frames,288+3*128);assert.equal(state.transportSync.latency.taps.pre.frames,256);assert.equal(state.transportSync.latency.taps.post.frames,384);assert.equal(delay,(288+384)/48000);assert.equal(cache.frames,288);
 routing.set(input,{key:'0000'});routing.set(legacy,{key:'0'});state.refreshTransportDistortionLatency();assert.equal(state.transportSync.latency.frames,288);assert.equal(state.transportSync.latency.taps.post.frames,0);
 state.refreshTransportDistortionLatency();assert.equal(counts.send,2);
});


test('fading handoff grains still occupy slots and are never double-counted',()=>{
 const active={isGrainVoice:true},retiring={isGrainVoice:true},oscillator={};
 const scheduledGrainVoices=new Set([active]);const retiredTransportVoices=new Set([active,retiring,oscillator]);
 const state=fixture(['getConcurrentGrainSourceCount'],{scheduledGrainVoices,retiredTransportVoices});
 assert.equal(state.getConcurrentGrainSourceCount(),2);
 retiredTransportVoices.delete(retiring);assert.equal(state.getConcurrentGrainSourceCount(),1);
 scheduledGrainVoices.clear();assert.equal(state.getConcurrentGrainSourceCount(),1);
 retiredTransportVoices.clear();assert.equal(state.getConcurrentGrainSourceCount(),0);
});
