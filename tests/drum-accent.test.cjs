const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../song-beta.js'),'utf8');
const start=source.indexOf('    function needsDrumAccentRender('),end=source.indexOf('    function needsDrumRollRender(',start);
const needs=vm.runInNewContext(`(${source.slice(start,end).trim()})`);
test('only audible accented base/Roll parts invalidate pre-fix freezes',()=>{
 const check=m=>needs({snapshot:{state:{modes:m}}});assert.equal(check({}),false);
 for(const kind of ['kick','snare','perc']) {const m={drumMachineEnabled:true,drumMachineBaseAccents:{[kind]:[true]},[`drumMachine${kind[0].toUpperCase()+kind.slice(1)}Pattern`]:[true]};assert.equal(check(m),true);m.drumMachineEnabled=false;assert.equal(check(m),false);m.drumMachineEnabled=true;m.drumMachineBaseAccents[kind]=[false];assert.equal(check(m),false);}
 assert.equal(check({drumMachineEnabled:true,drumMachineRoll:{pattern:[true],accents:[true]}}),true);
 assert.equal(check({drumMachineEnabled:true,drumMachineRoll:{pattern:[true]}}),false);
});
