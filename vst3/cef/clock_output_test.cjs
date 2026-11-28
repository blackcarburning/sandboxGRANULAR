'use strict';
// Real packaged VST3 EventList versus independent host project-sample trace.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const core=require('../../cicada-core.js');
module.exports=async({p,command,until,delay,raw,out})=>{
    const csv=file=>fs.readFileSync(file,'utf8').trim().split('\n').slice(1).map(line=>line.split(',').map(Number));
    const reports=[];
    for(const cycle of [true,false]){
        command('rewind');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.playing===false);
        command(cycle?'loop':'linear');await delay(150);command('arm-plugin');await delay(150);command('play');
        await p.waitForFunction(()=>{const c=mygrainDawBridge.diagnostics().clock;return c?.playing&&c.armed&&c.target>c.clock+10000&&c.hostPosition;});
        const c=await p.evaluate(()=>mygrainDawBridge.diagnostics().clock),state=core.normalize({...core.patch(),engine:'arp',expression:false});
        Object.assign(state.arp,{root:60,chord:'Major',count:3,octaves:1,rate:.25,gate:50});
        const origin={epoch:c.epoch,target:c.target,rate:c.rate};
        await p.evaluate(({origin,state})=>cefCcWireWorker.postMessage({type:'cicadaMidi',action:'start',origin,state,suppressed:[]}),{origin,state});
        await p.waitForFunction(target=>mygrainDawBridge.diagnostics().clock.clock>target+24000,c.target);
        // Longer than the entire 230ms MIDI lookahead. Notes must continue while
        // the main browser thread cannot ACK even one clock or execute timers.
        await p.evaluate(()=>{const end=performance.now()+850;while(performance.now()<end){};});
        const finish=c.target+48000*7;
        await p.waitForFunction(end=>mygrainDawBridge.diagnostics().clock.clock>end,finish);
        await p.evaluate(()=>cefCcWireWorker.postMessage({type:'cicadaMidi',action:'stop'}));
        await delay(200);command('stop');await delay(1100);
        const positions=new Map(csv(raw+'.blocks.csv').filter(row=>row.length===7).map(row=>[row[0],row]));
        const notes=csv(raw+'.midi.csv').filter(row=>row.length===6&&row[2]===0&&row[3]===3&&row[0]*128+row[1]>=c.target&&row[0]*128+row[1]<finish);
        assert(notes.length>=50,'sufficient actual native notes');
        const frames=notes.map(row=>row[0]*128+row[1]);
        for(let i=1;i<frames.length;i++)assert.equal(frames[i]-frames[i-1],6000,'straight 1/16 attacks: no dotted gaps, duplicates or UI-stall bunching');
        for(const row of notes){const host=positions.get(row[0]*128);assert(host);assert.equal((host[1]+row[1])%6000,0,'note aligned to actual DAW musical sample grid, not block boundary');}
        reports.push({cycle,notes:notes.length,mainThreadBlockedMs:850,attackIntervalSamples:6000,maxHostGridErrorSamples:0});
    }
    command('linear');command('stop-plugin');
    fs.writeFileSync(path.join(out,'native-clock-output-results.json'),JSON.stringify({packagedVst3EventList:true,workerOwnsScheduling:true,reports},null,2));
    console.log('PASS actual native MIDI: straight 6000-sample attack intervals on host grid, looping/continuous, 850ms blocked browser UI, zero-sample grid error');
};
