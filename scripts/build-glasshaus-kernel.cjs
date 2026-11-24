'use strict';
// Build-only: npm install --prefix /tmp/glasshaus-wasm-tools --no-audit --no-fund wabt@1.0.39
// NODE_PATH=/tmp/glasshaus-wasm-tools/node_modules node scripts/build-glasshaus-kernel.cjs [--check]
// No runtime dependency. Strict Float64 SIMD, no relaxed SIMD/fast-math.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..'),wabt=await require('wabt')();
 const module=wabt.parseWat('glasshaus-kernel.wat',fs.readFileSync(path.join(root,'dsp/glasshaus-kernel.wat'),'utf8'));
 module.validate();const bytes=Buffer.from(module.toBinary({canonicalize_lebs:true}).buffer),encoded=bytes.toString('base64');
 const file=path.join(root,'glasshaus-dsp.js'),source=fs.readFileSync(file,'utf8'),pattern=/const KERNEL_BASE64='[^']*';/;
 assert(pattern.test(source),'Missing generated kernel marker');
 const updated=source.replace(pattern,"const KERNEL_BASE64='"+encoded+"';");
 if(process.argv.includes('--check'))assert.equal(source,updated,'Embedded kernel needs rebuilding');else fs.writeFileSync(file,updated);
 console.log('GlassHaus kernel: '+bytes.length+' bytes; '+(process.argv.includes('--check')?'reproducible':'embedded'));
})().catch(e=>{console.error(e);process.exitCode=1});
