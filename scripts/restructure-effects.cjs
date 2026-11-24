'use strict';
// Native Cooking Pot processors in a disposable offline deck. No account state,
// corpus/network access, live-rack edits or shared effect histories between grains.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
const app=path.resolve(__dirname,'..');
async function main(){
 const folder=process.argv[2],plan=JSON.parse(fs.readFileSync(path.join(folder,'effects.json')));
 const browser=await chromium.launch({executablePath:process.env.MYGRAIN_CHROMIUM||'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage();await page.route('**/*',r=>r.abort());
  for(const file of ['effect-inputs.js','heavy-lifter-dsp.js','effect-lfo.js','henrys-hose-dsp.js','acoustic-fx-dsp.js','turntable-dsp.js','resonator-dsp.js','wasp-dsp.js','wasp-master-desktop.js','mutilator-dsp.js','character-fx.js']){
   let content=fs.readFileSync(path.join(app,file),'utf8');
   if(file==='character-fx.js'){
    const boundary='if(!root.document)return;';
    if(content.split(boundary).length!==2)throw Error('Native Bass Face DSP boundary changed.');
    content=content.split(boundary)[0]+'})(window);';
   }
   await page.addScriptTag({content});
  }
  const result=await page.evaluate(async({bytes,plan})=>{
   const raw=Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)),input=new Float32Array(raw.buffer),output=new Float32Array(input.length),rate=48000;
   const random=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t^=t+Math.imul(t^t>>>7,61|t);return((t^t>>>14)>>>0)/4294967296;};
   let cursor=0;
   for(const grain of plan.recipe){
    const frames=grain.frames,key=grain.effect.name,rng=random(grain.effect.seed),amount=grain.effect.amount;
    let settings={enabled:true,level:1,source:'A',input:'A'},engine,cross,wet;
    const pick=list=>list[Math.floor(rng()*list.length)];
    if(['mutilator','bassFace'].includes(key)){
     const model=key==='mutilator'?MygrainMutilator:MygrainBassFace;
     settings={...settings,strain:key==='mutilator'?pick(model.STRAINS):pick(model.STRAINS).id,amount,tone:.2+rng()*.6,mix:1,rhythm:false,body:.5};
     const warm=Math.ceil(Math.max(frames,rate*.15)/frames)*frames,ctx=new OfflineAudioContext(2,warm+frames,rate),buffer=ctx.createBuffer(2,frames,rate),source=ctx.createBufferSource();
     for(let c=0;c<2;c++)for(let i=0;i<frames;i++)buffer.getChannelData(c)[i]=input[(cursor+i)*2+c];
     source.buffer=buffer;source.loop=true;
     const graph=model.createGraph(ctx,source,ctx.destination,{bpm:plan.bpm,origin:0,time:0,oversample:'none',pot:true});
     graph.set(settings);source.start();
     try{const rendered=await ctx.startRendering();wet=[rendered.getChannelData(0).subarray(warm),rendered.getChannelData(1).subarray(warm)];}
     finally{graph.dispose();source.disconnect();source.buffer=null;}
    }else{
     if(MygrainAcousticFx.KEYS.includes(key)){
      settings=MygrainAcousticFx.normalize(key,{...settings,dispersion:amount,travel:.15+rng()*.65,feedback:.2+rng()*.4,tuning:.2+rng()*.6,radius:.2+rng()*.6,decay:.1+rng()*.35});
      if(key==='heavyLifter'){
       settings=MygrainHeavyLifter.normalize({...settings,mode:'materialBody'});
       settings.recipes.materialBody={...settings.recipes.materialBody,blend:.65,drive:amount,size:.2+rng()*.6};
       const mono=new Float32Array(Math.max(512,Math.ceil(frames/2)));
       for(let i=0;i<mono.length;i++){const at=(i*2)%frames;mono[i]=(input[(cursor+at)*2]+input[(cursor+at)*2+1])*.5;}
       settings.prepared={signature:'public-grain-'+grain.effect.seed,profiles:[MygrainHeavyLifter.analyse(mono,24000)],sampleRate:24000};
      }
      engine=new MygrainAcousticFx.Engine(key,rate,settings);engine.syncClock({origin:0,at:0,bpm:plan.bpm});
     }else if(key==='turntable'){
      settings=MygrainTurntable.normalize({...settings,wear:amount,wow:amount*.4,flutter:amount*.3});engine=new MygrainTurntable.Engine(rate,settings,grain.effect.seed);
     }else if(key==='resonator'){
      settings=MygrainResonator.normalize({...settings,slots:[{enabled:true,level:.8,source:'A'}]});engine=new MygrainResonator.Engine(rate,settings,plan.bpm);
     }else if(key==='playground'){
      settings={...MygrainWasp.normalize().playground,...settings,mix:1};
      engine=new MygrainWasp.MasterEngine(rate);engine.update({...MygrainWasp.normalize(),enabled:false,playground:settings,playgroundInputResolved:true});engine.setClock({origin:0,at:0,bpm:plan.bpm});
     }else if(key==='wasp'){
      const base=MygrainWasp.normalize();settings={...base,enabled:true,blend:1,melt:amount,output:0,filter:{...base.filter,enabled:true,cutoff:400+rng()*4000},playground:{enabled:false},routes:base.routes.map((r,i)=>({...r,enabled:i===0,source:'A',destination:'A'}))};
      cross=new MygrainWasp.Engine(rate,1);cross.update(settings,['A']);engine=new MygrainWasp.MasterEngine(rate);engine.update(settings);
     }else throw Error('Unknown Cooking Pot effect: '+key);
     const bus=[new Float32Array(128),new Float32Array(128)],out=[new Float32Array(128),new Float32Array(128)],crossOut=[new Float32Array(128),new Float32Array(128)];
     wet=[new Float32Array(frames),new Float32Array(frames)];
     const warm=Math.ceil(Math.max(frames,rate*.15)/128)*128;
     try{
      for(let offset=0;offset<warm+frames;offset+=128){
       for(let i=0;i<128;i++){const at=((offset-warm+i)%frames+frames)%frames;for(let c=0;c<2;c++)bus[c][i]=input[(cursor+at)*2+c];}
       let inputs=[bus,bus,bus,bus];if(cross){cross.process([bus],[crossOut]);inputs=[crossOut];}
       engine.process(inputs,[out],offset);
       for(let i=0;i<128;i++){const at=offset+i-warm;if(at>=0&&at<frames)for(let c=0;c<2;c++)wet[c][at]=out[c][i];}
      }
     }finally{engine.dispose();cross?.dispose();}
    }
    // A fixed native insert balance retains transients; no level matching until
    // all independently processed grains return to CUDA.
    for(let i=0;i<frames;i++)for(let c=0;c<2;c++){
     const value=.25*input[(cursor+i)*2+c]+.75*wet[c][i];
     if(!Number.isFinite(value))throw Error('Non-finite Cooking Pot grain');
     output[(cursor+i)*2+c]=value;
    }
    delete settings.prepared;grain.effect.settings=settings;grain.effect.mix=.75;
    cursor+=frames;
   }
   let binary='';const data=new Uint8Array(output.buffer);for(let i=0;i<data.length;i+=8192)binary+=String.fromCharCode(...data.subarray(i,i+8192));
   return {bytes:btoa(binary),recipe:plan.recipe};
  },{bytes:fs.readFileSync(path.join(folder,'dry.f32')).toString('base64'),plan});
  fs.writeFileSync(path.join(folder,'wet.f32'),Buffer.from(result.bytes,'base64'));
  fs.writeFileSync(path.join(folder,'effects-result.json'),JSON.stringify(result.recipe));
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
