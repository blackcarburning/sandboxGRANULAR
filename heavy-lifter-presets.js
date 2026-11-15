/* 100 distinct recipes per mode; stable IDs and seeds, no hidden playback. */
(function(root){
'use strict';const H=typeof module==='object'&&module.exports?require('./heavy-lifter-dsp.js'):root.MygrainHeavyLifter;
const families={
 materialBody:['Suspended steel','Hollow vessels','Copper wires','Dark machinery','Small mechanisms','Long girders','Bright sheets','Muted foundry','Hybrid bodies','Impossible alloys'],
 mechanicalMotion:['Slow rotation','Unsteady motors','Ratchet patterns','Pneumatic breath','Chain motion','Factory pulse','Broken bearings','Fine flutter','Hydraulic sway','Heavy transmission'],
 spectralImprint:['Brushed metal','Grinding surfaces','Hollow shells','Bright filings','Dark foundry','Spectral teeth','Moving shutters','Wire sheen','Rust veil','Chrome mirror'],
 livingConvolution:['Short chambers','Forged tails','Breathing kernels','Reversed steel','Twin machines','Scrape corridors','Frozen bodies','Slow exchanges','Hydraulic halls','Factory ghosts'],
 spectralAlloy:['Soft fusion','Pitch anchors','Molten chords','Spectral bridges','Metallic vowels','Loose harmonics','Mass migration','Industrial glass','Bent machinery','Liquid steel'],
 stressedMetal:['Gentle strain','Motor stress','Bearing chatter','Torn sheets','Elastic beams','Pressure fractures','Audio-rate forging','Welded oscillations','Torsion fields','Critical load']};
const words=['Dawn','Lift','Arc','Shift','Bloom','Drift','Turn','Glow','Load','Night'];const BANKS={};
for(const[modeIndex,mode]of H.MODES.entries()){BANKS[mode]=Array.from({length:100},(_,i)=>{const family=Math.floor(i/10),variation=i%10,seed=(0x19f123+modeIndex*1103515245+i*2654435761)>>>0,random=H.rng(seed||1),params={};for(const key of Object.keys(H.PARAMS[mode]))params[key]=Math.round((.12+random()*.76)*1000)/1000;
 // Curated family axes, with deterministic within-family variations.
 if(mode==='materialBody'){params.size=family===4?.22:family===5?.85:.2+family*.065;params.decay=family===5?.85:family===7?.2:.25+variation*.055;params.blend=family===8?.55:family===9?.9:variation*.025;}
 if(mode==='mechanicalMotion'){params.speed=family===0?.15:family===7?.88:.2+family*.06;params.depth=.25+variation*.065;params.flutter=family===7?.8:family===6?.6:variation*.035;}
 if(mode==='spectralImprint'){params.detail=family===5?.95:family===8?.12:.2+variation*.07;params.motion=family===6?.85:family===9?0:.15+variation*.045;params.shift=family===4?.23:family===3?.7:.4+variation*.02;}
 if(mode==='livingConvolution'){params.length=family===0?.08+variation*.01:family===8?.72+variation*.025:.18+family*.05;params.reverse=family===3?1:0;params.speed=family===6?0:family===7?.13:.15+variation*.065;params.morph=variation/9;}
 if(mode==='spectralAlloy'){params.alloy=family===0?.15+variation*.035:.4+variation*.055;params.anchor=family===1?.85:family===5?.08:variation*.06;params.inharmonicity=family===2?.8:family===9?1:.25+variation*.07;}
 if(mode==='stressedMetal'){params.stress=family===0?.08+variation*.025:.22+family*.075;params.speed=family===6?.9:.2+variation*.065;params.loss=.18+variation*.065;}
 const id=mode+'-'+String(i+1).padStart(3,'0');return{id,name:String(i+1).padStart(3,'0')+' · '+families[mode][family]+' / '+words[variation],section:families[mode][family],description:H.NAMES[modeIndex]+' · '+families[mode][family]+'. Recording selection and cuts are reproducible; New samples keeps this recipe.',settings(){const s=H.normalize({mode,level:.7,width:.4+variation*.06});s.recipes[mode]={...params,seed:seed||1};return s;}};});}
const api={BANKS,ALL:H.MODES.flatMap(k=>BANKS[k])};if(typeof module==='object'&&module.exports)module.exports=api;else root.MygrainHeavyLifterPresets=api;
})(globalThis);
