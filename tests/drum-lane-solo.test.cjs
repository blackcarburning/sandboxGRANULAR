const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
function source(name){const start=html.indexOf('        function '+name+'(');return html.slice(start,html.indexOf('\n        }',start)+10);}
function fixture(){const hits=[],levels=[],c={drumMachineLaneSolos:[],audioContext:{},drumMachineExtraTracks:{clap:{},cymbals:{},etc:{}},drumMachineRoll:{pattern:[true],ratchets:[0]},MygrainDrumRoll:{eventAt:()=>({count:1})},drumMachineHatPattern:[true],drumMachineHatAccentPattern:[false],drumMachineHatRatchetPattern:[0],getDrumMachineHatSwingOffset:()=>0,playDrumMachineHatHit:()=>hits.push('hat'),scheduleExtraDrumMachineRepeats:k=>hits.push(k),playDrumMachineHit:(b,t,p,o)=>{hits.push(o.eqChannel);levels.push({...o});},getDrumMachineAccentPattern:()=>[false],shouldRouteKickAroundFinalCompressor:()=>false,registerFinalSidechainKickTrigger(){}};c.window=c;
for(const k of ['Kick','Snare','Perc']){c['drumMachine'+k+'Pattern']=[true];c['drumMachine'+k+'RatchetPattern']=[0];c['drumMachine'+k+'Buffer']={};for(const suffix of ['LevelValue','PlaybackLevel','PitchRatio','DecayValue','LengthValue'])c['getDrumMachine'+k+suffix]=()=>1;}
c.getDrumMachineSnareDistortionAmount=()=>0;vm.createContext(c);for(const n of ['isDrumMachineLaneAudible','scheduleDrumMachineRepeats','scheduleDrumMachineHatStep','scheduleDrumMachineRoll'])vm.runInContext(source(n),c);
const tick=()=>{for(const k of ['kick','perc','clap','cymbals','etc'])c.scheduleDrumMachineRepeats(k,0,0,.1);if(!c.scheduleDrumMachineRoll(0,0,.1))c.scheduleDrumMachineRepeats('snare',0,0,.1);c.scheduleDrumMachineHatStep(0,0,.1);return hits.splice(0).sort();};return{c,tick,levels};}
test('each solo gates actual scheduled hits, independently including Snare and Roll',()=>{const{c,tick}=fixture();for(const kind of ['kick','snare','hat','perc','clap','cymbals','etc','roll']){c.drumMachineLaneSolos=[kind];assert.deepEqual(tick(),[kind]);}});
test('multiple solo lanes play together; clearing solos restores normal Roll precedence',()=>{const{c,tick}=fixture();c.drumMachineLaneSolos=['kick','hat'];assert.deepEqual(tick(),['hat','kick']);c.drumMachineLaneSolos=[];assert.deepEqual(tick(),['clap','cymbals','etc','hat','kick','perc','roll']);});

test('Roll Dip scales every Roll ratchet without changing ordinary Snare hits',()=>{
 const {c,levels}=fixture();
 c.drumMachineRoll={pattern:[true],ratchets:[4],dip:60,dips:[true]};
 c.scheduleDrumMachineRepeats('snare',0,0,.1);
 const normal=levels.splice(0);
 c.scheduleDrumMachineRoll(0,0,.1);
 assert.equal(normal[0].level,1);
 assert.deepEqual(levels.splice(0).map(x=>x.level),[.4,.24,.24,.24]);
 c.drumMachineRoll.dips[0]=false;c.scheduleDrumMachineRoll(0,0,.1);
 assert.deepEqual(levels.splice(0).map(x=>x.level),[1,.6,.6,.6]);
 c.drumMachineRoll.dips[0]=true;
 c.drumMachineRoll.dip=100;c.scheduleDrumMachineRoll(0,0,.1);
 assert(levels.splice(0).every(x=>x.level===0));
 c.drumMachineRoll.dip=0;c.scheduleDrumMachineRoll(0,0,.1);
 assert.deepEqual(levels.splice(0).map(x=>x.level),[1,.6,.6,.6]);
});
test('Roll Dip retains legacy pattern compatibility and is validated/clamped',()=>{
 const roll=require('../drum-roll.js');
 assert.equal(roll.normalize().dip,0);
 const old={version:1,length:1,pattern:[true],ratchets:[4]};
 assert.doesNotThrow(()=>roll.validate(old));
 assert.equal(roll.normalize({...old,dip:60}).dip,60);
 assert.deepEqual(roll.normalize({...old,dip:60}).dips,[true]);
 assert.deepEqual(roll.normalize({...old,dip:60,dips:[false]}).dips,[false]);
 assert.deepEqual(roll.normalize(old).dips,[false]);
 assert.throws(()=>roll.validate({...old,dips:[1]}));
 assert.equal(roll.normalize({...old,dip:150}).dip,100);
 assert.equal(roll.normalize({...old,dip:-1}).dip,0);
 for(const dip of [-1,101,NaN,'50']) assert.throws(()=>roll.validate({...old,dip}));
});
