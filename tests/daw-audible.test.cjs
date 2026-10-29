'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const window={__mygrainSongRenderDeck:true,addEventListener(){}};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../daw-export.js'),'utf8'),{window,document:{getElementById(){return null}}});
function fixture(modes={},extra={}){return {snapshot:{state:{modes:{bastardLoopLEnabled:true,bastardLoopXEnabled:true,drumMachineEnabled:true,drumMachineKickPattern:[true],drumMachineSnarePattern:[true],noiseN:{enabled:true},...modes}},extra},buffers:new Map()};}
const keys=d=>Array.from(window.mygrainDaw.components(d),x=>x.key);
test('enabled unsoloed mix retains enabled sources',()=>assert.deepEqual(keys(fixture()),['loopL','loopX','drumkick','drumsnare','noise']));
test('collection of loop solos excludes other enabled layers and oscillator support',()=>assert.deepEqual(keys(fixture({oscillatorsEnabled:true,loopLayerSolo:['bastardl','bastardx']})),['loopL','loopX']));
test('loop and source solos are a union',()=>assert.deepEqual(keys(fixture({oscillatorsEnabled:true,loopLayerSolo:['bastardl']},{performanceSourceLayerSolo:['osc']})),['osc','loopL']));
test('grain solo excludes siblings and enabled loops',()=>assert.deepEqual(keys(fixture({granularLayersEnabled:true,grainLayerSolo:['A']})),['grainA']));
test('drum sub-solo is local to drum lanes, does not hide other mix sources',()=>assert.deepEqual(keys(fixture({drumMachineLaneSolos:['kick']})),['loopL','loopX','drumkick','noise']));
test('global drums solo plus snare-only keeps normal snare without Roll suppression',()=>{const items=window.mygrainDaw.components(fixture({loopLayerSolo:['drums'],drumMachineLaneSolos:['snare'],drumMachineRoll:{pattern:[true]}}));assert.deepEqual(Array.from(items,x=>x.key),['drumsnare']);assert.equal(items[0].rollActive,false);});
test('muted or disabled K tracks stay excluded',()=>{const d=fixture({loopLayerSolo:['bastardk'],bastardLoopKEnabled:true,kMultitrack:{tracks:[{enabled:true,mute:true},{enabled:false},{enabled:true,mute:false}]}});for(const key of ['bastardK','bastardKTrack2','bastardKTrack3'])d.buffers.set(key,{});assert.deepEqual(keys(d),['K3']);});
