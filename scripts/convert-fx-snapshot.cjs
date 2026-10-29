'use strict';
const fs=require('node:fs'),fx=require('../loop-card-fx.js');
try { const body=fs.readFileSync(0,'utf8');if(Buffer.byteLength(body)>2*1024*1024)throw Error('Part settings are too large.');process.stdout.write(JSON.stringify(fx.convertSnapshot(JSON.parse(body)))); }
catch(error){process.stderr.write(String(error.message||error).slice(0,500));process.exitCode=1;}
