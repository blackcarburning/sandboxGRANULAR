// Server-only metadata migration. No audio, filesystem paths or account tokens.
'use strict';
const fs = require('node:fs');
const K = require('../k-multitrack.js');
try {
    const body = fs.readFileSync(0, 'utf8');
    if (Buffer.byteLength(body) > 2 * 1024 * 1024) throw new Error('Part settings are too large.');
    const snapshot = JSON.parse(body);
    const converted = K.convertSnapshot(snapshot);
    process.stdout.write(JSON.stringify(converted));
} catch (error) {
    process.stderr.write(String(error.message || error).slice(0, 500));
    process.exitCode = 1;
}
