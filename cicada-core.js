(function(root){
'use strict';
const clamp=(value,min,max,fallback=min)=>value!=null&&value!==''&&Number.isFinite(+value)?Math.max(min,Math.min(max,+value)):fallback;
const integer=(...args)=>Math.round(clamp(...args));
const wrap=(value,length)=>((value%length)+length)%length;
const pick=(value,choices,fallback)=>choices.includes(value)?value:fallback;
const orders=['Chord','Up','Down','Bounce','Outside in','Inside out','As written','Random','Rotate'];
const arpOrders=['Up','Down','Bounce','Outside in','Inside out','As written'];
const arpDefaults={root:48,chord:'Minor 7',count:4,rate:1/4,order:'Up',octaves:2,gate:65,velocity:94,bend:0,mod:0,cc:0};
const keyDefaults={enabled:false,root:0,octaves:[2,3,4,3,5]};
const waves=['Sine','Triangle','Rising saw','Falling saw','Square','Pulse','Sample & hold','Smooth random','Custom'];
const rates=[1/16,1/12,1/8,1/6,1/4,1/3,1/2,3/4,1,1.5,2,3,4,6,8,12,16,24,32,48,64,96,128];
const straightRates=[1/16,1/8,1/4,1/2,1,2,4,8];
const clocks=[['÷4 dotted',1/6],['÷4',1/4],['÷2 dotted',1/3],['÷2',1/2],['×1 dotted',2/3],['×1',1],['×2 dotted',4/3],['×2',2],['×4 dotted',8/3],['×4',4]];
const defaultClock=5, groupOfFour=(value,max)=>integer(value/4,1,max/4)*4;
const targets={pitch:'Transpose',gate:'Gate',velocity:'Velocity',bend:'Pitch bend',mod:'Mod wheel',cc:'Custom CC',chance:'Probability',ratchets:'Ratchets',offset:'Step offset',morph:'Day / night',inversion:'Inversion',octaves:'Octaves',spread:'Strum',...Object.fromEntries(Array.from({length:4},(_,index)=>['Rate','Depth','Phase'].map(key=>[`lfo${index+1}${key}`,`LFO ${index+1} ${key.toLowerCase()}`])).flat())};
const chords={'Single note':[0],Major:[0,4,7],Minor:[0,3,7],'Power fifth':[0,7],'Major 7':[0,4,7,11],'Minor 7':[0,3,7,10],'Dominant 7':[0,4,7,10],'Minor 9':[0,3,7,10,14],'Major 9':[0,4,7,11,14],'Dominant 9':[0,4,7,10,14],'Sus 2':[0,2,7],'Sus 4':[0,5,7,12],Diminished:[0,3,6,9],Augmented:[0,4,8],Quintal:[0,7,14,21],Octaves:[0,12,24]};
const presets=['Dusk Chorus','Brood XIII','Midnight Glass'];
function random(seed,index,salt){
    let value=Math.imul(index+1,0x9e3779b1)^Math.imul(salt+1,0x85ebca6b)^seed;
    value=Math.imul(value^(value>>>16),0x7feb352d);value=Math.imul(value^(value>>>15),0x846ca68b);
    return ((value^(value>>>16))>>>0)/4294967296;
}
function patch(name='Dusk Chorus',seed=1317){
    const night=name==='Midnight Glass',brood=name==='Brood XIII';
    return {version:1,mode:'crazy',clock:defaultClock,seed,cycle:night?24:16,phase:0,morph:0,swing:0,transpose:0,ccNumber:74,expression:true,previewVolume:35,
        lanes:[0,1].map(index=>({length:index&&brood?24:16,rate:index&&!night?1/2:1/4,order:index?'Bounce':night?'Chord':'Up',octaves:index?2:1,inversion:0,spread:night?24:0,reset:false,
            steps:Array.from({length:32},(_,step)=>({on:index?step%3!==1:step%4!==3,notes:(index?(night?chords['Major 9']:chords.Quintal):chords['Minor 9']).map(interval=>interval+(index?60:48)+[0,0,3,7,5,0,-2][Math.floor(step/3)%7]),gate:index?55:72,velocity:index?79:98,bend:0,mod:index?30:16,cc:index?55:36,chance:100,ratchets:brood&&step%5===0?3:index&&step%4===0?2:1,offset:0,octave:0}))})),
        lfos:[{wave:'Sine',rate:4,depth:85,phase:0,mode:'Free'},{wave:'Triangle',rate:8,depth:70,phase:25,mode:'Free'},{wave:'Sample & hold',rate:1,depth:52,phase:0,mode:'Free'},{wave:'Custom',rate:2,depth:50,phase:0,mode:'Lane cycle'}].map(lfo=>({...lfo,points:[0,75,-40,35,-80,0]})),
        routes:[{from:0,aux:-1,to:'mod',amount:48,curve:1,polarity:'Bipolar'},{from:1,aux:-1,to:'cc',amount:55,curve:1,polarity:'Bipolar'},{from:2,aux:-1,to:'velocity',amount:26,curve:1,polarity:'Bipolar'},{from:3,aux:0,to:'lfo1Depth',amount:36,curve:1,polarity:'Unipolar'}]};
}
function normalize(input){
    const base=patch();if(!input||typeof input!=='object'||input.version!==1)return base;
    const modes=['Free','Day reset','Lane cycle','One shot'];
    const arp=input.arp;
    return {version:1, ...(input.keyOverride&&typeof input.keyOverride==='object'?{keyOverride:{enabled:input.keyOverride.enabled===true,root:integer(input.keyOverride.root,0,11,0),octaves:Array.isArray(input.keyOverride.octaves)?input.keyOverride.octaves.slice(0,32).filter(value=>Number.isInteger(value)&&value>=-1&&value<=8):keyDefaults.octaves.slice()}}:{}), ...(arp||input.engine==='arp'?{engine:input.engine==='arp'?'arp':'lanes',arp:{
        root:integer(arp?.root,0,127,arpDefaults.root),chord:Object.hasOwn(chords,arp?.chord)?arp.chord:arpDefaults.chord,count:integer(arp?.count,1,8,arpDefaults.count),
        rate:pick(+arp?.rate,straightRates,arpDefaults.rate),order:pick(arp?.order,arpOrders,arpDefaults.order),octaves:integer(arp?.octaves,1,4,arpDefaults.octaves),
        gate:integer(arp?.gate,1,100,arpDefaults.gate),velocity:integer(arp?.velocity,1,127,arpDefaults.velocity),bend:integer(arp?.bend,-8192,8191,0),mod:integer(arp?.mod,0,127,0),cc:integer(arp?.cc,0,127,0)}}:{}),mode:input.mode==='calm'?'calm':'crazy',clock:integer(input.clock,0,clocks.length-1,defaultClock),seed:integer(input.seed,0,2147483647,base.seed),cycle:clamp(input.cycle,1,128,base.cycle),phase:clamp(input.phase,-100,100,0),morph:clamp(input.morph,-100,100,0),swing:clamp(input.swing,0,70,0),transpose:integer(input.transpose,-36,36,0),ccNumber:integer(input.ccNumber,2,119,74),expression:input.expression!==false,previewVolume:integer(input.previewVolume,0,100,35),
        lanes:base.lanes.map((fallback,index)=>{
            const lane=input.lanes?.[index];if(!lane)return fallback;
            return {length:integer(lane.length,1,32,fallback.length),rate:pick(+lane.rate,rates,fallback.rate),order:pick(lane.order,orders,fallback.order),octaves:integer(lane.octaves,1,4,1),inversion:integer(lane.inversion,-4,4,0),spread:integer(lane.spread,0,95,0),reset:lane.reset===true,
                steps:fallback.steps.map((defaultStep,stepIndex)=>{
                    const step=lane.steps?.[stepIndex];if(!step)return defaultStep;
                    return {on:step.on===true,notes:Array.isArray(step.notes)?[...new Set(step.notes.slice(0,8).map(note=>integer(note,0,127,60)))]:defaultStep.notes,
                        ...(Object.hasOwn(chords,step.chord)?{chord:step.chord,root:integer(step.root,0,127,60)}:{}),
                        gate:integer(step.gate,1,400,70),velocity:integer(step.velocity,1,127,90),bend:integer(step.bend,-8192,8191,0),mod:integer(step.mod,0,127,0),cc:integer(step.cc,0,127,0),chance:integer(step.chance,0,100,100),ratchets:integer(step.ratchets,1,8,1),offset:integer(step.offset,-45,45,0),octave:integer(step.octave,-3,3,0)};
                })};
        }),
        lfos:base.lfos.map((fallback,index)=>{
            const lfo=input.lfos?.[index];if(!lfo)return fallback;
            return {wave:pick(lfo.wave,waves,fallback.wave),rate:pick(+lfo.rate,rates,fallback.rate),depth:integer(lfo.depth,0,100,100),phase:integer(lfo.phase,0,100,0),mode:pick(lfo.mode,modes,'Free'),points:fallback.points.map((point,ii)=>integer(lfo.points?.[ii],-100,100,point))};
        }),
        routes:Array.isArray(input.routes)?input.routes.slice(0,16).filter(route=>route&&Object.hasOwn(targets,route.to)).map(route=>({from:integer(route.from,0,3,0),aux:integer(route.aux,-1,3,-1),to:route.to,amount:integer(route.amount,-100,100,0),curve:clamp(route.curve,.25,4,1),polarity:pick(route.polarity,['Bipolar','Unipolar'],'Bipolar')})):base.routes};
}
function randomizeNonNotes(input,seed){
    // Deliberate one-shot mutation. No new pitches, recipe reset or running randomizer.
    const state=structuredClone(input);let cursor=0;
    const choose=values=>values[Math.floor(random(seed,cursor++,73)*values.length)];
    const range=(low,high)=>low+Math.floor(random(seed,cursor++,91)*(high-low+1));
    const quarterPhases=[0,25,50,75],gates=[25,50,100];
    state.clock=choose([1,3,5,7,9]); // Only straight clock ratios; never dotted.
    state.cycle=choose([4,8,16,32,64,128]);
    state.phase=choose(quarterPhases);state.morph=range(-50,50);state.swing=0;
    if(state.arp)Object.assign(state.arp,{rate:choose(straightRates),gate:choose(gates),velocity:range(55,115),mod:range(0,127),cc:range(0,127)});
    for(const lane of state.lanes){
        Object.assign(lane,{length:choose([4,8,16,32]),rate:choose(straightRates),spread:0,reset:choose([false,true])});
        for(const step of lane.steps)Object.assign(step,{gate:choose(gates),velocity:range(48,115),mod:range(0,127),cc:range(0,127),chance:choose([50,75,100]),ratchets:choose([1,2,4,8]),offset:0});
    }
    for(const lfo of state.lfos)Object.assign(lfo,{wave:choose(waves),rate:choose([...straightRates,16,32,64,128]),depth:range(15,100),phase:choose(quarterPhases),mode:choose(['Free','Day reset','Lane cycle']),points:lfo.points.map(()=>range(-100,100))});
    // Continuous rate/phase/gate modulation would undo the straight-grid guarantee.
    // Pitch/bend/voicing destinations are deliberately not generated either.
    const destinations=['velocity','mod','cc','morph','lfo1Depth','lfo2Depth','lfo3Depth','lfo4Depth'];
    state.routes=Array.from({length:range(4,8)},(_,index)=>({from:index%4,aux:choose([-1,-1,0,1,2,3]),to:choose(destinations),amount:choose([-1,1])*range(10,60),curve:choose([.5,1,2]),polarity:choose(['Bipolar','Unipolar'])}));
    return state;
}
function waveform(lfo,cycles,seed,index){
    const phase=wrap(cycles,1),step=Math.floor(cycles);
    switch(lfo.wave){
        case 'Triangle':return 1-4*Math.abs(phase-.5);
        case 'Rising saw':return 2*phase-1;
        case 'Falling saw':return 1-2*phase;
        case 'Square':return phase<.5?1:-1;
        case 'Pulse':return phase<.25?1:-1;
        case 'Sample & hold':return 2*random(seed,step,index)-1;
        case 'Smooth random':{const start=random(seed,step,index),end=random(seed,step+1,index);return 2*(start+(end-start)*phase*phase*(3-2*phase))-1;}
        case 'Custom':{const position=phase*lfo.points.length,point=Math.floor(position);return (lfo.points[point]+(lfo.points[(point+1)%lfo.points.length]-lfo.points[point])*(position-point))/100;}
        default:return Math.sin(phase*Math.PI*2);
    }
}
function modulation(state,beat,lane,lfosOnly=false){
    function oscillate(lfo,index,mods){
        const local=lfo.mode==='Day reset'?wrap(beat,state.cycle):lfo.mode==='Lane cycle'?wrap(beat,lane.length*lane.rate):beat;
        const rate=lfo.rate*Math.pow(2,clamp(mods[`lfo${index+1}Rate`],-1,1,0)*2);
        const phase=local/rate+lfo.phase/100+(mods[`lfo${index+1}Phase`]||0);
        const depth=clamp(lfo.depth/100+(mods[`lfo${index+1}Depth`]||0),0,1,0);
        return waveform(lfo,lfo.mode==='One shot'?clamp(phase,0,.999999):phase,state.seed,index)*depth;
    }
    function matrix(values){
        const mods={};
        for(const route of state.routes){
            const input=values[route.from],signal=route.polarity==='Unipolar'?(input+1)*.5:input;
            const via=route.aux<0?1:(values[route.aux]+1)*.5;
            mods[route.to]=(mods[route.to]||0)+Math.sign(signal)*Math.pow(Math.abs(signal),route.curve)*via*route.amount/100;
        }
        return mods;
    }
    const raw=state.lfos.map((lfo,index)=>oscillate(lfo,index,{}));
    const cross=matrix(raw);
    const values=state.lfos.map((lfo,index)=>oscillate(lfo,index,cross));
    return lfosOnly?values:matrix(values);
}
const lfoCcNumbers=[102,103,104,105];
function lfoCcValues(state,transportBeat){
    const pattern=timing(state),beat=Math.max(0,transportBeat)*clockRatio(state);
    return modulation(pattern,beat,state.engine==='arp'?arpLane(state):pattern.lanes[0],true).map(value=>integer((value+1)*63.5,0,127));
}
function sunlight(state,beat,mods={}){
    return clamp((1+Math.cos(Math.PI*2*(beat/state.cycle+state.phase/100)))*.5+state.morph/100+(mods.morph||0)*.5,0,1);
}
function voicing(notes,inversion,octaves){
    const ordered=notes.slice().sort((left,right)=>left-right);if(!ordered.length)return [];
    for(let index=0;index<Math.abs(inversion);index++){
        if(inversion>0)ordered.push(ordered.shift()+12);else ordered.unshift(ordered.pop()-12);
        ordered.sort((left,right)=>left-right);
    }
    return [...new Set(Array.from({length:octaves},(_,octave)=>ordered.map(note=>note+octave*12)).flat())].sort((left,right)=>left-right);
}
function orderNotes(notes,order,original){
    if(order==='Down')return notes.slice().reverse();
    if(order==='Bounce')return notes.concat(notes.slice(1,-1).reverse());
    if(order==='As written')return original.flatMap(note=>notes.filter(pitch=>wrap(pitch,12)===wrap(note,12))).filter((note,index,all)=>all.indexOf(note)===index).concat(notes.filter(note=>!original.some(pitch=>wrap(note-pitch,12)===0)));
    if(order==='Outside in'||order==='Inside out'){
        const result=notes.map((_,index)=>index%2?notes[notes.length-1-(index>>1)]:notes[index>>1]);
        return order==='Inside out'?result.reverse():result;
    }
    return notes;
}
function controls(state,step,mods){
    return [[129,integer(8192+step.bend+(mods.bend||0)*8192,0,16383)],[1,integer(step.mod+(mods.mod||0)*127,0,127)],[state.ccNumber,integer(step.cc+(mods.cc||0)*127,0,127)]];
}
function timing(state){
    // A playback projection, not a destructive migration of saved musical settings.
    const calm=state.mode==='calm';
    return {...state,cycle:groupOfFour(state.cycle,128),swing:0,lanes:state.lanes.map(lane=>({...lane,length:groupOfFour(lane.length,32),...(calm?{rate:straightRates.reduce((best,rate)=>Math.abs(Math.log(rate/lane.rate))<Math.abs(Math.log(best/lane.rate))?rate:best),spread:0}:{})}))};
}
const fixedTargets=new Set(['pitch','gate','chance','ratchets','offset','inversion','octaves','spread']);
function noteModulation(state,mods){
    return state.mode==='crazy'?Object.fromEntries(Object.entries(mods).filter(([target])=>!fixedTargets.has(target))):mods;
}

function clockRatio(state){return clocks[state.clock??defaultClock]?.[1]??1;}
function chordNotes(rootNote,shape,count,existing=[]){
    const intervals=Object.hasOwn(chords,shape)?chords[shape]:[...new Set(existing.map(note=>note-(existing[0]??rootNote)))];
    if(!intervals.length)intervals.push(0);
    const voiced=intervals.slice(0,count);
    for(let octave=12;voiced.length<count;octave+=12){
        for(const interval of intervals){const pitch=interval+octave;if(!voiced.includes(pitch)&&Math.max(pitch,...voiced)-Math.min(pitch,...voiced)<=127)voiced.push(pitch);if(voiced.length===count)break;}
    }
    const low=-Math.min(...voiced),high=127-Math.max(...voiced),minShift=Math.ceil((low-rootNote)/12),maxShift=Math.floor((high-rootNote)/12);
    const fitted=minShift<=maxShift?rootNote+12*clamp(0,minShift,maxShift):clamp(rootNote,low,high);
    return voiced.map(interval=>fitted+interval);
}
function keyRoot(state,original,index=0){
    const key=state.keyOverride;if(!key?.enabled)return original;
    const octave=key.octaves.length?key.octaves[wrap(index,key.octaves.length)]+1:Math.floor(original/12);
    return octave*12+key.root;
}
function fitKeyNotes(notes){
    if(!notes.length)return [];
    const low=Math.min(...notes),high=Math.max(...notes);
    const minShift=Math.ceil(-low/12),maxShift=Math.floor((127-high)/12);
    const shift=12*(minShift<=maxShift?clamp(0,minShift,maxShift):Math.round((60-(low+high)/2)/12));
    // Keep intervals/pitch classes; never clamp separate chord tones to 0 or 127.
    return notes.map(note=>note+shift).filter(note=>note>=0&&note<=127);
}
function keyStepNotes(state,step,index){
    if(!state.keyOverride?.enabled)return step.notes;
    const original=step.root??step.notes[0]??60;
    const offset=keyRoot(state,original,index)-original+(state.keyOverride.octaves.length?0:step.octave*12);
    return fitKeyNotes(step.notes.map(note=>note+offset));
}
function events(state,from,to){
    if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)return [];
    if(state.engine==='arp')return arpEvents(state,from,to);
    const ratio=clockRatio(state);
    state=timing(state);from*=ratio;to*=ratio;
    const calm=state.mode==='calm';
    const output=[];
    const push=event=>{if(event.beat>=from&&event.beat<to)output.push(event);};
    for(const [laneIndex,lane] of state.lanes.entries()){
        const first=Math.max(0,Math.floor(from/lane.rate)-2),last=Math.ceil(to/lane.rate)+1;
        for(let index=first;index<last;index++){
            const baseBeat=index*lane.rate,dayIndex=Math.floor(baseBeat/state.cycle);
            const local=lane.reset?Math.max(0,index-Math.ceil(dayIndex*state.cycle/lane.rate-1e-9)):index;
            const step=lane.steps[wrap(local,lane.length)];if(!step?.on||!step.notes.length)continue;
            const stepIndex=wrap(local,lane.length),patternIndex=calm?index:stepIndex;
            const mods=noteModulation(state,modulation(state,baseBeat,lane)),day=sunlight(state,baseBeat,mods);
            const activity=.18+.82*(laneIndex?1-day:day);
            // Both modes repeat explicit chance/rest settings. Day/night is a
            // dynamics contour, never an invisible probability gate at 100%.
            if(random(calm?state.seed:0,stepIndex,laneIndex)>=step.chance/100)continue;
            const pitchOffset=state.keyOverride?.enabled?0:state.transpose+step.octave*12+Math.round((mods.pitch||0)*24);
            const inversion=integer(lane.inversion+(mods.inversion||0)*4,-6,6);
            const octaves=integer(lane.octaves+(mods.octaves||0)*3,1,4);
            const source=keyStepNotes(state,step,stepIndex),voiced=voicing(source,inversion,octaves);
            const notes=orderNotes(state.keyOverride?.enabled?fitKeyNotes(voiced):voiced,lane.order,source);
            const hits=calm?1:integer(step.ratchets+(mods.ratchets||0)*7,1,8),slice=lane.rate/hits;
            const offset=calm?0:clamp(step.offset/100+(mods.offset||0)*.45,-.45,.45);
            const onset=Math.max(0,baseBeat+offset*lane.rate);
            const gate=clamp(step.gate/100+(mods.gate||0),.01,4)*slice;
            const spread=calm?0:clamp(lane.spread/100+(mods.spread||0),0,.95);
            const velocity=integer((step.velocity+(mods.velocity||0)*127)*(.58+.42*activity),1,127);
            for(let hit=0;hit<hits;hit++){
                const beat=onset+hit*slice,position=(calm?local:stepIndex)+hit;
                const keys=lane.order==='Chord'?notes:[notes[lane.order==='Random'?Math.floor(random(calm?state.seed:0,patternIndex*8+hit,laneIndex+22)*notes.length):wrap(lane.order==='Rotate'?position+Math.floor(patternIndex/lane.length):position,notes.length)]];
                const pitches=[...new Set(keys.map(note=>integer(note+pitchOffset,0,127)))];
                pitches.forEach((pitch,voice)=>push({beat:beat+slice*spread*voice/Math.max(1,pitches.length-1),lane:laneIndex,pitch,velocity:Math.max(1,Math.round(velocity*(hit? .83:1))),gate,step:wrap(local,lane.length)}));
            }
        }
    }
    if(state.expression)for(let pulse=Math.max(0,Math.ceil(from*24));pulse<Math.ceil(to*24);pulse++){
        const beat=pulse/24,day=sunlight(state,beat,modulation(state,beat,state.lanes[0]));
        const laneIndex=day>=.5?0:1,lane=state.lanes[laneIndex];
        const index=Math.floor(beat/lane.rate),local=lane.reset?index-Math.ceil(Math.floor(beat/state.cycle)*state.cycle/lane.rate-1e-9):index;
        const step=lane.steps[wrap(Math.max(0,local),lane.length)];
        for(const [control,value] of controls(state,step,modulation(state,beat,lane)))push({beat,lane:laneIndex,control,value});
    }
    if(state.expression){
        const locks=new Map();
        for(const event of output)if(event.pitch!=null&&!locks.has(event.beat))locks.set(event.beat,event);
        for(const [beat,event] of locks){
            const lane=state.lanes[event.lane];
            for(const [control,value] of controls(state,lane.steps[event.step],modulation(state,beat,lane)))
                output.push({beat,lane:event.lane,control,value,lock:true});
        }
    }
    output.sort((left,right)=>left.beat-right.beat||Number(right.control!=null)-Number(left.control!=null)||Number(!!left.lock)-Number(!!right.lock)||left.lane-right.lane);
    if(ratio!==1)for(const event of output){event.beat/=ratio;if(event.gate!=null)event.gate/=ratio;}
    return output;
}
function arpNotes(state){
    const {root,chord,count,order,octaves}=state.arp;
    const key=state.keyOverride;
    return Array.from({length:key?.enabled?Math.max(1,key.octaves.length):1},(_,index)=>{
        const chordPitches=chordNotes(key?.enabled?keyRoot(state,root,index):root+state.transpose,chord,count);
        const voiced=voicing(chordPitches,0,octaves),keys=key?.enabled?fitKeyNotes(voiced):voiced.filter(pitch=>pitch<=127);
        return orderNotes(keys,order,chordPitches);
    }).flat();
}
function arpLane(state){return {length:arpNotes(state).length,rate:state.arp.rate};}
function arpEvents(state,from,to){
    const ratio=clockRatio(state),arp=state.arp,keys=arpNotes(state),lane={length:keys.length,rate:arp.rate};
    const rate=arp.rate/ratio,expressionRate=1/(24*ratio),output=[];
    for(let index=Math.max(0,Math.floor(from/rate));index*rate<to;index++){
        const beat=index*rate;if(beat<from)continue;
        output.push({beat,lane:0,pitch:keys[index%keys.length],gate:rate*arp.gate/100,velocity:arp.velocity});
    }
    if(state.expression)for(let index=Math.max(0,Math.floor(from/expressionRate));index*expressionRate<to;index++){
        const beat=index*expressionRate;if(beat<from)continue;
        for(const [control,value] of controls(state,arp,modulation(state,beat*ratio,lane)))output.push({beat,lane:0,control,value});
    }
    return output.sort((left,right)=>left.beat-right.beat||Number(right.control!=null)-Number(left.control!=null));
}
// All selectable divisions/clock ratios are exact on this rational beat grid.
const beatTicks=384;
const gcd=(a,b)=>b?gcd(b,a%b):a;
const lcm=(a,b)=>a/gcd(a,b)*b;
function patternLengths(state){
    const pattern=timing(state),ratio=clockRatio(state);
    const ticks=beats=>Math.round(beats/ratio*beatTicks);
    if(state.engine==='arp')return {ticksPerBeat:beatTicks,arp:ticks(arpNotes(state).length*state.arp.rate)};
    const lanes=pattern.lanes.map(lane=>ticks(lane.reset?pattern.cycle:lane.length*lane.rate));
    const day=ticks(pattern.cycle);
    return {ticksPerBeat:beatTicks,lanes,day,alignment:[...lanes,day].reduce(lcm)};
}
function dawTimeline(info,previous,origin){
    const {clock,rate,tempo}=info;
    if(![clock,rate,tempo].every(Number.isFinite)||rate<=0||tempo<=0)return null;
    const framesPerBeat=rate*60/tempo;
    if(previous?.framesPerBeat===framesPerBeat)return previous;
    // Preserve musical phase across tempo changes, never integrate browser time.
    const beat=previous?(clock-previous.anchor)/previous.framesPerBeat:0;
    return {anchor:previous?clock-beat*framesPerBeat:origin.target,framesPerBeat};
}
function dawTimelineEvents(state,timeline,from,to){
    const {anchor,framesPerBeat}=timeline;
    if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)return [];
    const output=[];
    for(const event of events(state,Math.max(0,(from-anchor-.5)/framesPerBeat),Math.max(0,(to-anchor+.5)/framesPerBeat))){
        const frame=Math.round(anchor+event.beat*framesPerBeat);
        if(frame<from||frame>=to)continue;
        // Quantize absolute endpoints once; do not repeatedly round step lengths.
        const end=event.pitch==null?frame:Math.max(frame+1,Math.round(anchor+(event.beat+event.gate)*framesPerBeat));
        output.push({...event,frame,end});
    }
    return output;
}
function dawCycle(info,previous){
    // Native clock is the completed block frontier; PPQ belongs to block START.
    // Only the coherent pair describes a musical sample position.
    info=info.hostPosition??info;
    const {clock,ppq,rate,tempo,cycleStart:start,cycleEnd:end,cycleActive,musical}=info;
    if(!cycleActive||!musical||![clock,ppq,rate,tempo,start,end].every(Number.isFinite)||rate<=0||tempo<=0||end<=start)return null;
    const framesPerBeat=rate*60/tempo,beats=end-start;
    // DAW locators are sample positions: subtract quantized endpoints, not an
    // indefinitely repeated fractional BPM estimate (which accumulates error).
    const period=Math.round(end*framesPerBeat)-Math.round(start*framesPerBeat);
    if(!Number.isSafeInteger(period)||period<1||ppq>=end)return null;
    const observed=Math.round(clock-(ppq-start)*framesPerBeat);
    if(previous?.start===start&&previous.end===end&&previous.framesPerBeat===framesPerBeat){
        const predicted=previous.anchor+Math.round((observed-previous.anchor)/period)*period;
        const error=observed-predicted;
        if(Math.abs(error)<=rate*.045&&!(ppq<start&&Math.abs(observed-previous.anchor)>rate*.045)){
            // Follow the latest host phase as well as its tempo. This also covers
            // hosts quantizing a locator differently, without a stop/restart or
            // releasing already queued notes on every browser clock message.
            previous.anchor+=error;
            return previous;
        }
    }
    return {start,end,beats,framesPerBeat,period,anchor:observed};
}
function dawCycleEvents(state,cycle,from,to){
    const {anchor,period,framesPerBeat,beats}=cycle;
    if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)return [];
    const output=[];
    const first=Math.max(0,Math.floor((from-anchor-.5)/period));
    for(let index=first;anchor+index*period<to+.5;index++){
        const start=anchor+index*period, boundary=Math.round(start+period);
        const localFrom=Math.max(0,(from-start-.5)/framesPerBeat);
        const localTo=Math.min(beats,(to-start+.5)/framesPerBeat);
        for(const event of events(state,localFrom,localTo)){
            const frame=Math.round(start+event.beat*framesPerBeat);
            if(frame<from||frame>=to||frame>=boundary)continue;
            const end=event.pitch==null?frame:Math.min(boundary,Math.max(frame+1,Math.round(start+(event.beat+event.gate)*framesPerBeat)));
            output.push({...event,pass:index,frame,end});
        }
    }
    return output;
}
function midiScheduler(initial,origin,send,cancel){
    let state=initial,cycle=null,timeline=null,nextFrame=null;
    const queued=new Map(),controls=new Map();let suppressed=new Set();
    function reset(){nextFrame=null;queued.clear();controls.clear();cancel();}
    return {
        update(value,excluded=[]){state=value;suppressed=new Set(excluded);reset();},
        tick(info){
            const nextCycle=dawCycle(info,cycle),nextTimeline=dawTimeline(info,timeline,origin);
            if(!nextTimeline)return;
            if(nextCycle!==cycle||nextTimeline!==timeline&&timeline)reset();
            cycle=nextCycle;timeline=nextTimeline;
            const from=Math.max(origin.target,info.clock,cycle?0:nextFrame??0),to=Math.ceil(info.clock+info.rate*.23);
            for(const [key,frame] of queued)if(frame<info.clock-info.rate*.3)queued.delete(key);
            for(const event of cycle?dawCycleEvents(state,cycle,from,to):dawTimelineEvents(state,timeline,from,to)){
                if(cycle){
                    const key=`${event.pass}:${event.beat}:${event.lane}:${event.pitch==null?'c'+event.control+':'+Number(!!event.lock):'n'+event.pitch}`;
                    if(queued.has(key))continue;queued.set(key,event.frame);
                }
                if(event.pitch==null){
                    if(suppressed.has(event.control)||controls.get(event.control)===event.value)continue;
                    controls.set(event.control,event.value);
                }
                send(event);
            }
            nextFrame=Math.max(from,to);
        }
    };
}
const api={patch,normalize,randomizeNonNotes,timing,clockRatio,chordNotes,keyDefaults,keyRoot,keyStepNotes,events,patternLengths,dawTimeline,dawTimelineEvents,dawCycle,dawCycleEvents,midiScheduler,sunlight,modulation,lfoCcNumbers,lfoCcValues,voicing,waveform,orders,arpOrders,arpNotes,waves,rates,straightRates,clocks,targets,fixedTargets:[...fixedTargets],chords,presets,random};
if(typeof module==='object'&&module.exports)module.exports=api;
root.MygrainCicadaCore=api;
})(typeof window==='object'?window:globalThis);
