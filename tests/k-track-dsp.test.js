const test = require('node:test'), assert = require('node:assert/strict');
const {create} = require('../k-track-dsp'), {processing} = require('../k-multitrack');
function fixture() {
 const nodes = [], param = () => ({value:0,setTargetAtTime(v){this.value=v},setValueAtTime(v){this.value=v},linearRampToValueAtTime(v){this.value=v}});
 const node = (kind, extra={}) => {const n={kind,disconnected:0,connections:[],connect(target){this.connections.push(target)},disconnect(){this.disconnected++;this.connections=[]},...extra};nodes.push(n);return n};
 const ctx={currentTime:1,createGain:()=>node('gain',{gain:param()}),createBiquadFilter:()=>node('filter',{frequency:param(),Q:param()}),createWaveShaper:()=>node('drive',{curve:null}),createDelay:capacity=>node('delay',{capacity,delayTime:param()}),createOscillator:()=>node('lfo',{frequency:param(),started:0,stopped:0,start(){this.started++},stop(){this.stopped++}})};
 const input=node('input'),output=node('output'),destination=node('destination');
 return {ctx,input,output,destination,nodes,graph(settings,bpm=120){return create(ctx,input,output,processing(settings),bpm,destination)}};
}
test('bypass/zero mixes allocate no filter, LFO, drive, delay or reverb processors',()=>{
 const f=fixture(),g=f.graph({filterMode:'bypass',lfoAmount:1});g.start(0,1);assert.deepEqual(g.nodes.map(n=>n.kind),['gain']);assert.deepEqual(f.output.connections,[f.destination]);g.dispose();g.dispose();assert(g.nodes.every(n=>n.disconnected===1));
});
test('full graph has bounded wet stores and releases oscillator, feedback and waveshaper storage exactly once',()=>{
 const f=fixture(),g=f.graph({lfoAmount:.8,lfoWave:'ramp',resonance:5,drive:8,delayMix:.5,reverbMix:.5,reverbDecay:4});g.start(1,2);
 assert.equal(g.filters.length,4);assert.deepEqual(g.filters.map(n=>n.Q.value),[5,.707,.707,.707]);
 const osc=g.nodes.find(n=>n.kind==='lfo');assert.equal(osc.type,'sawtooth');assert.equal(osc.started,1);
 assert(g.nodes.filter(n=>n.kind==='delay').every(n=>n.capacity<=.31));
 assert.equal(g.tempo(40),false,'a longer beat requires a newly admitted local delay store');
 g.dispose();g.dispose();assert.equal(osc.stopped,1);assert(g.nodes.every(n=>n.disconnected===1));assert.equal(g.nodes.find(n=>n.kind==='drive').curve,null);
});
test('a partial DSP allocation failure disconnects every owned node',()=>{
 const f=fixture();f.ctx.createOscillator=()=>{throw new Error('allocation fixture')};assert.throws(()=>f.graph({lfoAmount:1,delayMix:.3,reverbMix:.2}),/allocation fixture/);assert(f.nodes.slice(3).every(n=>n.disconnected===1));
});
