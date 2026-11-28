'use strict';
// Native test only: inject into the existing authenticated fixture socket and
// inspect the packaged plugin's actual IEventList, not an upstream queue trace.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({p,command,until,delay,raw,out})=>{
    const rows=()=>fs.readFileSync(raw+'.midi.csv','utf8').trim().split('\n').slice(1).filter(line=>line.split(',').length===6).map(line=>line.split(',').map(Number));
    const send=commands=>p.evaluate(commands=>window.cefCcWireWorker.postMessage({type:'testNativeCcWire',commands}),commands);
    const zero=()=>send(Array.from({length:4},(_,slot)=>`cicada-lfo:${slot}:0`));
    const reports=[];let sequence=0;
    async function phase(label,playing,disabled=-1){
        await zero();await delay(200);const before=rows().length;let lastNoteEnd=0;
        for(let tick=0;tick<30;++tick){
            const commands=Array.from({length:4},(_,slot)=>`cicada-lfo:${slot}:${slot===disabled?0:1+(sequence*3+slot*17)%128}`);sequence++;
            if(playing){
                const c=await p.evaluate(()=>mygrainDawBridge.diagnostics().clock);
                const frame=Math.round(Math.max(c.clock+6000,c.target+1000))+17;
                lastNoteEnd=frame+1300;
                commands.push(`expr:${c.epoch}:3:1:${sequence%128}:${frame}:${frame}`,`midi:${c.epoch}:3:60:90:${frame}:${frame+1300}`);
            }
            await send(commands);await delay(43);
        }
        // The host can plan a later bar even after Play is acknowledged. Wait
        // for native frame progress, not an assumed wall-clock capture window.
        if(playing)await p.waitForFunction(end=>mygrainDawBridge.diagnostics().clock.clock>=end,lastNoteEnd);
        await delay(150);const events=rows().slice(before),cc=events.filter(row=>row[2]===65535&&row[4]>=102&&row[4]<=105);
        const streams=Array.from({length:4},(_,slot)=>{
            const own=cc.filter(row=>row[3]===slot&&row[4]===102+slot),distinct=new Set(own.map(row=>row[5])).size;
            if(slot===disabled)assert.equal(own.length,0);else assert(distinct>=4,`${label}: missing native CC ${102+slot}`);
            return {channel:slot+1,cc:102+slot,messages:own.length,distinct};
        });
        const stamps=cc.map(row=>`${row[0]}:${row[1]}`);assert.equal(new Set(stamps).size,stamps.length,'live CC timestamps must be distinct');
        if(playing){assert(events.some(row=>row[2]===0&&row[3]===3&&row[4]===60));assert(events.some(row=>row[2]===65535&&row[4]===1));}
        reports.push({label,streams});
    }
    command('stop');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.playing===false);
    await phase('native output, DAW stopped',false);
    command('arm-plugin');await p.waitForFunction(()=>mygrainDawBridge.diagnostics().clock?.armed===true);
    command('play');await p.waitForFunction(()=>{const c=mygrainDawBridge.diagnostics().clock;return c?.playing===true&&c.target>0&&c.clock>=c.target;});
    await phase('native output, notes and expression running',true);
    for(let slot=0;slot<4;++slot)await phase(`native output, LFO ${slot+1} disabled`,true,slot);
    await zero();await send(['midi-cancel:3']);command('stop');await delay(300);const stopped=rows().length;await delay(150);
    assert.equal(rows().slice(stopped).filter(row=>row[2]===65535&&row[4]>=102&&row[4]<=105).length,0);
    command('stop-plugin');await delay(150);
    fs.writeFileSync(path.join(out,'native-cc-output-results.json'),JSON.stringify({packagedVst3EventList:true,realCefSocket:true,distinctTimestamps:true,reports},null,2));
    console.log('PASS packaged VST3 output: four simultaneous changing split-channel CC streams; stopped and playing with notes/expression; independent disable and timestamp separation');
};
