const test = require('node:test');
const assert = require('node:assert/strict');
const { sources, fixture, evaluate } = require('./grain-sustain-fixture.cjs');
const production = sources();
for (const notes of [1, 4, 6]) test(`default A/B sustain has no scheduled holes with ${notes} held notes`, () => {
    const f = fixture({ ...production, notes }); const result = f.run(evaluate);
    assert.equal(result.gaps, 0, JSON.stringify(result));
    assert.ok(result.maxPool <= production.cap);
    assert.ok(result.sources > 30 * notes);
});
test('the old six-slot budget reproduces gaps rather than merely a lower level', () => {
    const result = fixture({ ...production, cap: 6, lookahead: .35 }).run(evaluate);
    assert.ok(result.gaps > 0 && result.longestGapMs > 50, JSON.stringify(result));
});
test('short A and long B keep independent cadences instead of filling the pool with B', () => {
    const layers = [{ key: 'A', sizeSeconds: .02, blend: .5, smoothing: .5 }, { key: 'B', sizeSeconds: .5, blend: .5, smoothing: .5 }]
        .map(layer => ({ attackSeconds: .005, decaySeconds: .01, releaseSeconds: .02, volume: .5, ...layer }));
    const f = fixture({ ...production, notes: 4, layers }); const result = f.run(evaluate);
    assert.equal(result.gaps, 0, JSON.stringify(result));
    const short = f.starts.filter(v => v.d === .02).length, long = f.starts.filter(v => v.d === .5).length;
    assert.ok(short > long * 5, JSON.stringify({ short, long }));
    assert.ok(result.maxPool <= production.cap);
});
test('maximum blend/smoothing chords remain sustained within a bounded source budget', () => {
    const layers = ['A', 'B'].map(key => ({ key, sizeSeconds: .15, blend: 1, smoothing: 1, attackSeconds: .02, decaySeconds: .03, releaseSeconds: .2, volume: .4 }));
    const result = fixture({ ...production, notes: 4, layers }).run(evaluate);
    assert.equal(result.gaps, 0, JSON.stringify(result)); assert.ok(result.maxPool <= production.cap);
});
test('overload never exceeds the source budget and late ended callbacks are idempotent', () => {
    const f = fixture({ ...production, notes: 30 }); const result = f.run(evaluate);
    assert.equal(result.maxPool, production.cap);
    const callbacks = [...f.state.scheduledGrainVoices].map(v => v.source.onended);
    callbacks.forEach(done => { done(); done(); });
    assert.equal(f.state.activeGrainNodes, 0); assert.equal(f.state.getConcurrentGrainSourceCount(), 0);
});

for (const role of ['sequencer', 'arp']) test(`${role} grains honour the transport queue before the next note replaces the stream`, () => {
    const f = fixture({ ...production, notes: 1 });
    const stream = [...f.state.activeGrains.values()][0];
    stream.role = role; stream.startTime = .25; stream.nextTime = .25;
    f.run(evaluate, .001);
    assert.ok(f.starts.length > 0, 'A note inside the transport horizon must not be discarded by the shorter keyboard queue');
    assert.ok(f.starts.every(source => source.t >= .25 && source.t < .35));
});
