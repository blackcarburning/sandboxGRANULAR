'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const theory = require('../q-theory.js');
globalThis.MygrainQTheory = theory;
const { Controller } = require(process.env.MYGRAIN_Q_CARD || '../q-card.js');
function fixture(source = 'sample') {
    const q = new Controller({ length: () => 16, bpm: () => 120, context: () => null, save() {} });
    q.state.enabled = false; q.state.soundSource = source; q.state.bank = null;
    q.state.sequence = Array(64).fill(null);
    q.prepareSounds = async () => { throw Error('source preparation'); };
    q.piano.capture = async () => { throw Error('piano preparation'); };
    return q;
}
for (const source of ['sample', 'piano', 'strings', 'grain', 'osc']) {
    test(`empty disabled ${source} saves without preparing a missing source`, async () => {
        const q = fixture(source), before = JSON.stringify(q.state);
        await q.prepareCapture(); assert.equal(JSON.stringify(q.state), before);
    });
}
test('enabled empty sample still requires its source', async () => {
    const q = fixture(); q.state.enabled = true;
    await assert.rejects(q.prepareCapture(), /source preparation/);
});
test('disabled sample with notes beyond the visible pattern still requires its source', async () => {
    const q = fixture(); q.state.sequence[60] = theory.normalizeStep({ notes: [60] });
    await assert.rejects(q.prepareCapture(), /source preparation/);
});
test('disabled piano with an existing bank still captures it', async () => {
    const q = fixture('piano'); q.state.bank = { version: 1 };
    await assert.rejects(q.prepareCapture(), /piano preparation/);
});
