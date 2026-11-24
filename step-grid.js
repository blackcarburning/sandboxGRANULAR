/* Shared Ember / Restructure / Robot ratchet-cell editing. 0 = rest, 1–4 hits. */
(function(root){'use strict';root.MygrainStepGrid={nextRatchet:n=>(Math.max(0,Math.min(4,Math.round(Number(n)||0)))+1)%5,shift:(pattern,delta)=>pattern.map((_,i)=>pattern[(i-delta+16)%16])};})(globalThis);
