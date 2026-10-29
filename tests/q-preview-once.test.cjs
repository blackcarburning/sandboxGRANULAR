const test=require('node:test'),assert=require('node:assert/strict'),T=require('../q-theory.js'),{Controller}=require('../q-card.js');
for(const pattern of ['up','down','updown','odds','evens','custom'])test(`chord preview plays one ${pattern} cycle despite until-next; saved sequencer mode unchanged`,async()=>{
 const context={currentTime:0,state:'running'},c=new Controller({length:()=>16,bpm:()=>120,context:()=>context,save(){}}),played=[];
 c.ready=async()=>true;c.prepareSounds=async()=>{};for(const name of ['ensureGraph','updateEffects','reflectPlaying','status','syncTransport'])c[name]=()=>{};
 c.voice=p=>played.push(p);Object.assign(c.state,{arpEnabled:true,arpRepeat:'until-next',arpPattern:pattern,arpSteps:[0,2,0,1],arpDivision:.25});
 const chord=T.normalizeStep({notes:[60,64,67]});const order=T.arpOrder(chord.notes,pattern,c.state.arpSteps).filter(x=>x!==null);
 try{await c.audition(chord);clearInterval(c.previewTimer);for(let i=0;i<160&&c.preview;i++){context.currentTime=i*.05;c.tickPreview()};assert.deepEqual(played,order);assert.equal(c.preview,null);assert.equal(c.state.arpRepeat,'until-next');c.state.sequence[0]=chord;assert(T.playbackEvents(c.state,16).length>order.length);}finally{clearInterval(c.previewTimer)}
});
