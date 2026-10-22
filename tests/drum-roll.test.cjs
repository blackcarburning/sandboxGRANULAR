const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const roll = require('../drum-roll.js');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const adapter = fs.readFileSync(require('node:path').join(__dirname, '../song-beta-adapter.js'), 'utf8');
function extract(source, name) { const start = source.indexOf(`        function ${name}(`), end = source.indexOf('\n        }', start); return source.slice(start, end + 10); }
const cycleStart = adapter.indexOf('    function songPatternCycleMultiplier(');
const songCycle = vm.runInNewContext(`(${adapter.slice(cycleStart, adapter.indexOf('    function validateSongRollCycle('))})`);
function lane(length, index = length - 1, count = 4) { const s = roll.normalize({length}); s.pattern[index] = true; s.ratchets[index] = count; return s; }
test('live Roll pattern history permits Song amendment without unlocking Undo or active operations', () => {
    const context = {initializing:false, window:{mygrainAccounts:{authenticated:true},mygrainSongBeta:{editing:{}},mygrainAiPatch:{}},
        isAudioGraphReady:()=>true, engineStarting:false, stateSaveSuspended:false,
        isRecording:false, isOutputRecording:false, isOutputRecordingArmed:false,
        bastardLoopMRecordingState:'idle', bastardLoopMPlusRecordingState:'idle', bastardLoopKRecordingState:'idle',
        megaRandomizeInFlight:false, drumMachineLoadInFlight:false, bastardLoopGenerationInFlight:false,
        bastardLoop2GenerationInFlight:false, bastardLoop3GenerationInFlight:false, bastardLoopVGenerationInFlight:false,
        bastardLoopPGenerationInFlight:false, bastardLoopOGenerationInFlight:false, dropboxSampleLayerLoadInFlight:false};
    vm.createContext(context); vm.runInContext(extract(adapter, 'assertReady'), context);
    assert.throws(() => context.assertReady(), /Finish recording/, 'ordinary history/Undo stays locked');
    assert.doesNotThrow(() => context.assertReady(false, false, true));
    for (const key of ['initializing','engineStarting','stateSaveSuspended','isRecording','isOutputRecording','isOutputRecordingArmed',
        'megaRandomizeInFlight','drumMachineLoadInFlight','bastardLoopGenerationInFlight']) {
        context[key] = true;
        assert.throws(() => context.assertReady(false, false, true), undefined, `${key} must remain protected`);
        context[key] = false;
    }
    for (const target of [context.window.mygrainSongBeta, context.window.mygrainAiPatch]) {
        target.busy = true; assert.throws(() => context.assertReady(false, false, true)); target.busy = false;
    }
    context.window.mygrainSongBeta.playing = true;
    assert.throws(() => context.assertReady(false, false, true));
});
test('legacy absent lane is empty; resizing zero-fills without duplicating fills; snapshot is independent', () => {
    assert.equal(roll.normalize().length, 64); assert(!roll.normalize().pattern.some(Boolean));
    const s = lane(64, 63); const larger = roll.normalize({...s, length: 128});
    assert(larger.pattern[63]); assert(!larger.pattern[127]); assert.equal(larger.ratchets[63], 4);
    larger.pattern[63] = false; assert(s.pattern[63]); assert.equal(roll.normalize({...s, length: 12}).pattern.length, 12);
    for (const n of [1, 24, 64, 128, 1024]) assert.doesNotThrow(() => roll.validate(roll.normalize({length:n})));
    for (const s of [{}, {...lane(64), length:1025}, {...lane(64), pattern:[true]}, {...lane(64), ratchets:Array(64).fill(9)}]) assert.throws(() => roll.validate(s));
});
function fixture(base, length, horizon, options = {}) {
    const hits = [], snare = Array(base).fill(false), ratchets = Array(base).fill(1);
    for (let i = 4; i < base; i += 8) snare[i] = true;
    const state = lane(length, length - 4, 4);
    const context = {window:{MygrainDrumRoll:roll}, drumMachineRoll:state, drumMachineRollStep:0,
        audioContext:{currentTime:0}, drumMachinePlaying:true, drumMachineCurrentStep:0, drumMachineNextStepTime:0,
        drumMachineExtraTracks:{}, drumMachineSnarePattern:snare, drumMachineSnareRatchetPattern:ratchets, drumMachineSnareBuffer:{id:'snare'},
        getDrumMachineStepDuration:()=>.125,getDrumMachinePatternLength:()=>base,getTransportScheduleHorizon:()=>horizon,
        countMissedAudioSteps:()=>0,scheduleDrumMachineHatStep(){},scheduleDrumMachineVisualStep(){},
        getDrumMachineSnareLevelValue:()=>.8,getDrumMachineSnarePitchRatio:()=>2,getDrumMachineSnareDecayValue:()=>.75,getDrumMachineSnareLengthValue:()=>.65,getDrumMachineSnareDistortionAmount:()=>.4,
        getDrumMachineKickPlaybackLevel:()=>0,getDrumMachineKickPitchRatio:()=>1,getDrumMachineKickDecayValue:()=>1,getDrumMachineKickLengthValue:()=>1,shouldRouteKickAroundFinalCompressor:()=>false,
        drumMachineKickBuffer:null,drumMachineKickPattern:[],drumMachinePercBuffer:null,drumMachinePercPattern:[],
        playDrumMachineHit:(buffer,time,ratio,settings)=>hits.push({buffer,time,ratio,...settings}),...options};
    vm.createContext(context);
    for (const name of ['scheduleDrumMachineRepeats', 'scheduleDrumMachineRoll', 'scheduleDrumMachine']) vm.runInContext(extract(html,name),context);
    return {context,hits,state};
}
for (const base of [8,16,64]) for (const length of [64,128]) test(`actual audio scheduler: ${base}-step drums / ${length}-step Roll, priority and two full cycles`, () => {
    const {context,hits} = fixture(base,length,length * 2 * .125); context.scheduleDrumMachine();
    const fill = hits.filter(h => h.time % (length*.125) >= (length - 4) * .125 && h.time % (length*.125) < (length - 3) * .125);
    assert.equal(fill.length, 8); assert.equal(hits.filter(h => h.time === (length - 4)*.125).length, 1, 'overlap cannot add an ordinary Snare hit');
    assert.deepEqual(fill.slice(0,4).map(h => h.time), [0,1,2,3].map(i => (length-4)*.125 + i*.125/4));
    for (const hit of fill) { assert.equal(hit.buffer.id,'snare'); assert.equal(hit.ratio,2); assert.equal(hit.decayRatio,.75); assert.equal(hit.lengthRatio,.65); assert.equal(hit.distortionAmount,.4); assert.equal(hit.bypassFinalCompressor,false); }
    assert.deepEqual(fill.slice(0,4).map(h=>h.level),[.8,.48,.48,.48]);
    const expectedNormal = Array.from({length:length*2},(_,i)=>i).filter(i => i%base%8===4 && i%length!==length-4).length;
    assert.equal(hits.length,expectedNormal+8);
});
test('skipped audio steps preserve the long-lane phase without bursting missed hits', () => {
    const {context,hits}=fixture(16,128,15.8,{countMissedAudioSteps:()=>124}); context.scheduleDrumMachine();
    assert.equal(hits[0].time,15.5); assert.equal(hits.length,4); assert.equal(context.drumMachineRollStep,127);
});
test('section looping addresses the source Roll step instead of the wrapped normal Snare step', () => {
    const {Section}=require('../q-card.js'); const section=new Section(10,15.5,.5);
    const {context,hits}=fixture(16,128,11,{audioContext:{currentTime:9.9},drumMachineNextStepTime:10,drumMachineRollStep:0,
        window:{MygrainDrumRoll:roll,mygrainPatternSection:{position:(...args)=>section.position(...args),next:(...args)=>section.next(...args)}}});
    context.scheduleDrumMachine(); assert.equal(hits.filter(h=>h.level===.48).length,6);
    assert.equal(hits[0].time,10); assert.equal(hits[4].time,10.5);
});
test('Roll-only loaded Snare is playable and never seeds default normal patterns', () => {
    const {context}=fixture(16,128,0); context.drumMachineSnarePattern.fill(false); context.drumMachineHatPattern=[];
    vm.runInContext(extract(html,'hasPlayableDrumMachinePattern'),context); assert.equal(context.hasPlayableDrumMachinePattern(),true);
    context.drumMachineSnareBuffer=null; assert.equal(context.hasPlayableDrumMachinePattern(),false);
});
test('Song captures whole 64/128 and non-power-of-two roll cycles combined with slow Q/L/X', () => {
    for (const [base,length,want] of [[16,128,8],[64,128,2],[16,64,4],[16,24,3],[64,24,3],[16,1,1]]) {
        const state={patternLength:base,modes:{drumMachineEnabled:true,drumMachineRoll:lane(length)}};
        assert.equal(songCycle(state),want);
        state.q={enabled:true,rate:.25,sequence:[{notes:[48]}]}; assert.equal(songCycle(state),roll.cycleSteps(base*4,length)/base);
        state.modes.drumMachineEnabled=false; assert.equal(songCycle(state),4);
    }
});
test('MIDI exports a complete independent cycle and replaces an overlapping Snare hit', () => {
    const state=lane(128,124,4), snare=Array(16).fill(false);snare[12]=true;
    const events=[],context={window:{MygrainDrumRoll:roll},drumMachineRoll:state,drumMachineSnarePattern:snare,
        getDrumMachinePatternLength:()=>16,getDrumMachineStepDuration:()=>.125,getSharedBpmClockValue:()=>120,clampBpmValue:x=>x,
        secondsToMidiTicks:()=>120,clampMidiExportVelocity:x=>x,computeMidiNoteLengthTicks:()=>30,
        addMidiNoteEvents:(list,channel,note,tick,duration,velocity)=>list.push({tick,velocity}),createMidiTrackChunk:list=>events.push(...list)};
    vm.createContext(context);vm.runInContext(extract(html,'buildDrumMachineMidiTrackChunk'),context);
    context.buildDrumMachineMidiTrackChunk({pattern:snare,ratchets:[],level:1});assert.equal(events.length,11);
    assert.deepEqual(events.slice(-4).map(x=>x.tick),[14880,14910,14940,14970]);
});
test('preset import prepares its grid before sliders and skips nonexistent short-grid steps', () => {
    const start=html.indexOf('        function applyPreset('),end=html.indexOf('            // Apply dropdown values',start);
    const source=html.slice(start,end)+'return true; }';
    for (const saved of [8,16,64]) {
        let length=64,calls=[];
        const context={mygrainUtils:{},DEFAULT_REMEMBERED_PATTERN_LENGTH_STEPS:16,presetToggleParams:[],
            clearDisabledLoopStartLfoRoutes(){},normalizeStoredLfoSliderValues:x=>x,setBastardLoopMPlusPanPercent(){},restoreDrumMachineToneDefaults(){},restoreBastardLoopLReverbDefaults(){},
            syncPatternLengthControls:n=>{length=n;return n},Event:class{},document:{getElementById:id=>({closest:()=>null,dispatchEvent(){const step=Number(id.match(/\d+/)[0]);assert(step<=length);calls.push(step)}})}};
        vm.createContext(context);vm.runInContext(source,context);
        assert(context.applyPreset({patternLength:saved,sliders:{seqStep1Pitch:48,seqStep16Pitch:50,seqStep64Vol:60}}));assert.equal(length,saved);
        assert.deepEqual(calls,[1,...(saved>=16?[16]:[]),...(saved>=64?[64]:[])]);
    }
});
test('active Roll invalidates old freezes even when the previous drum-decay version is current', () => {
    require('../song-beta.js'); const controller={snapshots:new Map(),cache:new Map(),renderSources:new Map()};
    const check=(part,decoded)=>globalThis.MygrainSongBeta.Controller.prototype.isRenderCompatible.call(controller,part,decoded);
    const part={id:'roll',sha256:'source',render:{drumSampleVersion:1}}, decoded={snapshot:{state:{modes:{drumMachineEnabled:true,drumMachineRoll:lane(128)}}}};
    assert.equal(check(part,decoded),false);assert.equal(check({...part,render:{drumSampleVersion:1,drumRollVersion:1}},decoded),true);
    decoded.snapshot.state.modes.drumMachineEnabled=false;assert.equal(check(part,decoded),true);
    decoded.snapshot.state.modes.drumMachineEnabled=true;decoded.snapshot.state.modes.drumMachineRoll.pattern.fill(false);assert.equal(check(part,decoded),true);
});
test('late join, re-alignment and fresh transport starts derive Roll from the shared absolute tick', () => {
    const {context}=fixture(16,128,0,{drumMachinePlaying:false,drumMachineTransportStartTime:null,preFilterGainNode:{},
        resolveTransportLaneStart:()=>({origin:10,index:12,elapsedSteps:124,time:25.5}),updateDrumMachineMix(){},ensureSharedRhythmClockRunning(){},syncPerformanceControlState(){}});
    for(const name of ['startDrumMachine','alignDrumMachineToTransport'])vm.runInContext(extract(html,name),context);
    assert(context.startDrumMachine(10,{ensureAudible:false,silent:true,skipSave:true}));assert.equal(context.drumMachineCurrentStep,12);assert.equal(context.drumMachineRollStep,124);
    context.drumMachineRollStep=7;context.alignDrumMachineToTransport(10);assert.equal(context.drumMachineRollStep,124);
    context.drumMachinePlaying=false;context.resolveTransportLaneStart=()=>({origin:40,index:0,elapsedSteps:0,time:40});
    assert(context.startDrumMachine(40,{ensureAudible:false,silent:true,skipSave:true}));assert.equal(context.drumMachineRollStep,0);
});
test('MIDI end-of-track padding preserves a complete long Roll cycle, not only the last note', () => {
    const context={createMidiChunk:(id,payload)=>payload,encodeMidiVariableLength:n=>[n]};vm.createContext(context);vm.runInContext(extract(html,'createMidiTrackChunk'),context);
    assert.deepEqual([...context.createMidiTrackChunk([{tick:124,bytes:[1]}],{endTick:128})].slice(-4),[4,255,47,0]);
    assert.deepEqual([...context.createMidiTrackChunk([{tick:124,bytes:[1]}])].slice(-4),[0,255,47,0]);
});
test('static Song decks queue across a throttled iframe timer; live scheduling stays responsive', () => {
    for(const frozen of [false,true]){
        let now=0,skips=0;
        const {context,hits,state}=fixture(16,128,0,{window:{MygrainDrumRoll:roll,__mygrainSongRenderDeck:frozen},getTransportScheduleHorizon:()=>now+.35,
            countMissedAudioSteps:(next,dt,time)=>{const missed=Math.max(0,Math.ceil((time-next-.000001)/dt));skips+=missed;return missed}});
        state.pattern.fill(false);state.ratchets.fill(0);state.pattern[12]=true;state.ratchets[12]=4;
        context.scheduleDrumMachine();now=1.6;context.audioContext.currentTime=now;context.scheduleDrumMachine();
        if(frozen){assert.equal(skips,0);assert.equal(hits.filter(h=>h.time>=1.5&&h.time<1.625).length,4);}
        else{assert(skips>0);assert.equal(hits.filter(h=>h.time>=1.5&&h.time<1.625).length,0);}
    }
});
test('changing the Snare sample/settings changes Roll immediately, without a copied audio slot', () => {
    const {context,hits}=fixture(16,128,0);const next={id:'replacement'};context.drumMachineSnareBuffer=next;context.getDrumMachineSnarePitchRatio=()=>.5;context.getDrumMachineSnareLevelValue=()=>.3;
    assert(context.scheduleDrumMachineRoll(124,1,.125));assert(hits.every(h=>h.buffer===next&&h.ratio===.5));assert.equal(hits[0].level,.3);
});
