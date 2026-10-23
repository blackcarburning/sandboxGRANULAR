const test = require('node:test'), assert = require('node:assert/strict');
const {create,prepare} = require('../k-track-dsp'), {processing} = require('../k-multitrack');
function fixture() {
 const nodes = [], param = () => ({value:0,setTargetAtTime(v){this.value=v},setValueAtTime(v){this.value=v},linearRampToValueAtTime(v){this.value=v}});
 const node = (kind, extra={}) => {const n={kind,disconnected:0,connections:[],connect(target){this.connections.push(target)},disconnect(){this.disconnected++;this.connections=[]},...extra};nodes.push(n);return n};
 const ctx={currentTime:1,createConvolver:()=>node('convolver',{buffer:null}),createGain:()=>node('gain',{gain:param()}),createBiquadFilter:()=>node('filter',{frequency:param(),Q:param()}),createWaveShaper:()=>node('drive',{curve:null}),createDelay:capacity=>node('delay',{capacity,delayTime:param()}),createOscillator:()=>node('lfo',{frequency:param(),started:0,stopped:0,start(){this.started++},stop(){this.stopped++}})};
 const input=node('input'),output=node('output'),destination=node('destination');
 const impulses=[];const impulseFor=(...args)=>{const buffer={length:Math.round(args[4]*48000),numberOfChannels:2,args};impulses.push(buffer);return buffer};
 return {ctx,input,output,destination,nodes,impulses,graph(settings,bpm=120){return create(ctx,input,output,processing(settings),bpm,destination,impulseFor)}};
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
 g.dispose();g.dispose();assert.equal(osc.stopped,1);assert(g.nodes.every(n=>n.disconnected===1));assert.equal(g.nodes.find(n=>n.kind==='drive').curve,null);assert.equal(g.nodes.find(n=>n.kind==='convolver').buffer,null);
});
test('a partial DSP allocation failure disconnects every owned node',()=>{
 const f=fixture();f.ctx.createOscillator=()=>{throw new Error('allocation fixture')};assert.throws(()=>f.graph({lfoAmount:1,delayMix:.3,reverbMix:.2}),/allocation fixture/);assert(f.nodes.slice(3).every(n=>n.disconnected===1));assert.equal(f.nodes.find(n=>n.kind==='convolver').buffer,null);
});

test('K reverb uses the shared Hall builder and an acyclic L-style room path',()=>{
 const f=fixture(),g=f.graph({filterMode:'bypass',reverbMix:.6,reverbDecay:2.4});
 assert.equal(f.impulses.length,1);assert.deepEqual(f.impulses[0].args.slice(1),[.45,(2.4-.2)/3.8,'hall',2.4]);
 const room=g.nodes.find(n=>n.kind==='convolver'),pre=g.nodes.find(n=>n.kind==='delay');
 assert.equal(pre.delayTime.value,.018);assert.equal(g.nodes.find(n=>n.kind==='filter').frequency.value,6400);
 const visit=(node,path=new Set())=>{assert(!path.has(node),'Reverb must not recirculate');for(const next of node.connections)visit(next,new Set([...path,node]))};visit(f.input);
 const peer=f.graph({filterMode:'bypass',reverbMix:.2,reverbDecay:2.4});const peerRoom=peer.nodes.find(n=>n.kind==='convolver');
 assert.notEqual(room,peerRoom);assert.equal(room.buffer,peerRoom.buffer);assert.equal(f.impulses.length,1);g.dispose();assert(peerRoom.buffer);peer.dispose();
});
test('Hall cache is per context, LRU bounded by bytes and entries, and dry tracks never build impulses',()=>{
 const f=fixture();f.graph({filterMode:'bypass'}).dispose();assert.equal(f.impulses.length,0);
 const graph=seconds=>f.graph({filterMode:'bypass',reverbMix:.6,reverbDecay:seconds});
 graph(4).dispose();for(let n=0;n<12;n++)graph(2+n*.1).dispose();graph(4).dispose();assert.equal(f.impulses.length,14,'evicted room rebuilt');
 const other=fixture();other.graph({filterMode:'bypass',reverbMix:.5,reverbDecay:4}).dispose();assert.equal(other.impulses.length,1);
});

test('transport prewarming builds only a shared buffer, never an idle processing graph',()=>{
 const f=fixture(),before=f.nodes.length,impulseFor=(ctx,size,decay,room,seconds)=>({length:seconds*48000,numberOfChannels:2});
 assert.equal(prepare(f.ctx,processing({reverbMix:0}),impulseFor),null);
 const buffer=prepare(f.ctx,processing({reverbMix:.5,reverbDecay:4}),impulseFor);assert.equal(f.nodes.length,before);
 const g=f.graph({filterMode:'bypass',reverbMix:.5,reverbDecay:4});assert.equal(g.nodes.find(n=>n.kind==='convolver').buffer,buffer);assert.equal(f.impulses.length,0);g.dispose();
});

test('a preflighted convolver is consumed without rebuilding and released even if an earlier allocation fails',()=>{
 const f=fixture(),room=f.ctx.createConvolver();room.buffer={length:192000,numberOfChannels:2};
 const noBuild=()=>{throw new Error('Room rebuilt inside deadline')};
 const g=create(f.ctx,f.input,f.output,processing({filterMode:'bypass',reverbMix:.5}),120,f.destination,noBuild,room);
 assert.equal(g.nodes.filter(n=>n.kind==='convolver').length,1);g.dispose();assert.equal(room.buffer,null);assert.equal(room.disconnected,1);
 const next=f.ctx.createConvolver();next.buffer={};f.ctx.createWaveShaper=()=>{throw new Error('pre-branch allocation failure')};
 assert.throws(()=>create(f.ctx,f.input,f.output,processing({drive:5,reverbMix:.5}),120,f.destination,noBuild,next),/pre-branch/);
 assert.equal(next.buffer,null);assert.equal(next.disconnected,1);
});

test('render-deck context facades reuse their preflighted native rooms and cancel pending buffers',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../k-multitrack-host.js'),'utf8');
 const native={},nodes=[],impulse={};const context={audioContext:{createConvolver(){const node={context:native,buffer:null,disconnected:0,disconnect(){this.disconnected++}};nodes.push(node);return node}},window:{MygrainKTrackDsp:{prepare:()=>impulse}}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('    const preparedRooms'),source.indexOf('    const recorder =')),context);
 const track={processing:{reverbMix:.5,reverbDecay:4}},first=context.prepareRoom(track);assert.equal(first.context,native);assert.notEqual(first.context,context.audioContext);
 assert.equal(context.prepareRoom(track),first);assert.equal(context.takePreparedRoom(track),first);assert.equal(nodes.length,1,'native setup must not repeat inside capture deadline');
 const pending=context.prepareRoom(track);context.clearPreparedRooms();assert.equal(pending.buffer,null);assert.equal(pending.disconnected,1);
 track.processing.reverbMix=0;assert.equal(context.prepareRoom(track),null);assert.equal(nodes.length,2);first.disconnect();first.buffer=null;
});
