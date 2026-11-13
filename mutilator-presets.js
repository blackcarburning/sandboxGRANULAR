/* 100 editor-only recipes: 50 tempo-locked, 20 static and 30 free-running. */
(function(root){'use strict';
const DSP=root.MygrainMutilator||(typeof require==='function'?require('./mutilator-dsp.js'):null);
const groups=[
 ['Velvet Damage · static',false,'static',['gnaw','venom','diode','cinder'],['auto','lowpass'],['Warm Bite','Velvet Scab','Copper Breath','Soft Ruin','Amber Teeth','Slow Bruise','Worn Leather','Quiet Venom','Tape Wound','Golden Scar']],
 ['Shattered Circuits · static',false,'static',['scab','rupture','splinter','shred','hollow'],['auto','bandpass','highpass'],['Broken Radio','Glass Jaw','Pixel Ash','Rust Alphabet','Fracture Line','Wire Splinters','Concrete Mouth','Carbon Kiss','Serrated Halo','Dead Battery']],
 ['Slow Corrosion · free',false,'free',['vortex','gnaw','cinder','venom'],['notch','lowpass'],['Oxide Tide','Patient Rust','Green Patina','Crawling Wire','Tarnished Moon','Slow Erosion','Sunken Metal','Drifting Teeth','Moss Circuit','Corroded Orbit']],
 ['Liquid Teeth · free',false,'free',['melt','splinter','diode'],['bandpass','lowpass'],['Acid Lagoon','Mercury Smile','Molten Gum','Liquid Molar','Syrup Voltage','Plastic River','Elastic Venom','Chrome Saliva','Bending Fangs','Neon Melt']],
 ['Feral Orbit · free',false,'free',['vortex','shred','maw','hollow'],['notch','bandpass','highpass'],['Feral Satellite','Orbital Bite','Wild Rotor','Crooked Planet','Grit Cyclone','Sideways Teeth','Jagged Comet','Voltage Swarm','Racing Shadows','Broken Compass']],
 ['Clockwork Chew · synced',true,'sync',['gnaw','diode','venom','cinder'],['auto','lowpass'],['Quarter Jaw','Offbeat Chew','Half Bar Bite','Two Bar Bruise','Clockwork Grin','Pocket Teeth','Copper Clave','Pulse Goblin','Backbeat Scar','Ratchet Smile']],
 ['Acid Lattice · synced',true,'sync',['melt','splinter','vortex'],['bandpass','notch'],['Acid Switchyard','Resonant Grid','Clockwork Acid','Lattice Fang','Neon Steps','Biting Tripwire','Folded Clock','Phosphor Teeth','Green Staircase','Tangled Voltage']],
 ['Broken Steps · synced',true,'sync',['scab','rupture','shred','splinter'],['auto','bandpass','lowpass'],['Pixel March','Rupture Relay','Stuttered Teeth','Broken Escalator','Bit Grid','Fragment Factory','Chipped Rhythm','Static Footwork','Serrated Steps','Glitch Mandible']],
 ['Metal Pulse · synced',true,'sync',['diode','venom','cinder','shred'],['lowpass','bandpass','notch'],['Iron Pulse','Forge Teeth','Copper Hammer','Scorched Clave','Steel Gums','Valve Stomp','Chromium Rattle','Furnace Mouth','Hot Wire Walk','Industrial Grin']],
 ['Deep Pressure · synced',true,'sync',['maw','hollow','vortex','gnaw'],['auto','lowpass','notch'],['Subterranean Jaw','Pressure Valve','Hollow Stomp','Deep Bite','Cavern Pulse','Night Compressor','Blackwater Teeth','Heavy Breathing','Low Orbit','Underground Maw']]
];
const round=n=>Math.round(n*100)/100,rate=[.125,.25,.375,.5,.75,1,1.5,2,3,4],fast=[1,1.5,2,2.5,3,4,5,6,8,12],cycles=[4,2,1,8,.5,4,2,8,1,.5];
const PRESETS=[];
for(const[gIndex,[section,synced,motion,strains,filters,names]]of groups.entries())for(const[nameIndex,name]of names.entries()){
 const j=nameIndex,soft=gIndex===0,deep=gIndex===9;
 const recipe=DSP.normalize({enabled:false,rhythm:synced,strain:strains[j%strains.length],amount:round((soft?.22:.4)+(j%5)*.09+(gIndex%3)*.04),tone:round((deep?.18:.26)+(j%6)*.09),mix:round(.44+(j%5)*.1),filter:filters[j%filters.length],resonance:round((gIndex===6?.55:.3)+(j%5)*.1),sweep:round(.35+(j%6)*.12),cycleBeats:synced?cycles[j]:4,freeDepth:motion==='free'?round(.22+(j%6)*.12):0,freeRate:motion==='free'?(gIndex===4?fast[j]:gIndex===3?rate[j]*2:rate[j]):1,output:-2-(j%5)*.5});
 const id='mutilator-'+name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),kind=synced?'Tempo-synced accents':motion==='free'?'Free-running sine sweep':'Static distortion';
 const description=kind+' · '+recipe.strain+' · '+(recipe.filter||'strain-character')+' filter. '+(synced?cycles[j]+'-beat cycle follows the song BPM.':motion==='free'?(recipe.freeRate||1)+' Hz motion stays independent of BPM.':'No modulation clock.');
 PRESETS.push(Object.freeze({id,name,section,synced,motion,description,settings:()=>DSP.normalize({...recipe})}));
}
const fingerprint=value=>{const v=DSP.normalize(value),e={...DSP.EXT,...v};return JSON.stringify([v.strain,v.rhythm,...['amount','tone','mix','filter','resonance','sweep','cycleBeats','freeRate','freeDepth','output'].map(k=>typeof e[k]==='number'?Number(e[k].toFixed(6)):e[k])]);};
const prints=new Map(PRESETS.map(p=>[fingerprint(p.settings()),p.id]));
if(PRESETS.length!==100||prints.size!==100||new Set(PRESETS.map(p=>p.id)).size!==100)throw Error('Mutilator preset inventory mismatch');
const api=Object.freeze({PRESETS:Object.freeze(PRESETS),SECTIONS:Object.freeze(groups.map(g=>g[0])),match:value=>prints.get(fingerprint(value))||'',fingerprint});root.MygrainMutilatorPresets=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
