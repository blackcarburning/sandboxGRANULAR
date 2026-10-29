const test = require('node:test');
const assert = require('node:assert/strict');
const { renderCaptureTiming } = require('../song-beta-clock.js');

for (const sampleRate of [44100, 48000]) {
    test(`song capture keeps a buffered source start and trims processor latency at ${sampleRate} Hz`, () => {
        const frames = sampleRate === 44100 ? 1224 : 1248;
        const context = { currentTime: 10, sampleRate };
        const timing = renderCaptureTiming(context, {
            getBufferedTransportStartTime: () => 10.3,
            getTransportOutputLatencySeconds: () => frames / sampleRate
        });
        assert.equal(timing.sourceTime, Math.ceil(10.3 * sampleRate) / sampleRate);
        assert.equal(timing.startFrame, Math.ceil(10.3 * sampleRate) + frames);
        assert.equal(timing.latencyFrames, frames);
    });

    test(`song capture chooses its start after preparation consumes time at ${sampleRate} Hz`, () => {
        const context = { currentTime: 10, sampleRate };
        const timing = renderCaptureTiming(context, {
            getBufferedTransportStartTime() {
                context.currentTime += .4;
                return context.currentTime + .3;
            },
            getTransportOutputLatencySeconds: () => .026
        });
        assert.ok(timing.sourceTime >= 10.7);
        assert.ok(timing.startFrame >= Math.ceil(10.7 * sampleRate));
        assert.ok(timing.sourceTime - context.currentTime >= .3 - 1 / sampleRate);
    });
}

test('song capture remains compatible with older isolated engines without timing helpers', () => {
    const timing = renderCaptureTiming({ currentTime: 4, sampleRate: 48000 }, {});
    assert.equal(timing.sourceTime, 4.3);
    assert.equal(timing.startFrame, 206400);
    assert.equal(timing.latencyFrames, 0);
});

test('a render retry reserves one later origin for both source audio and capture', () => {
    const context = { currentTime: 10, sampleRate: 48000 };
    let requested;
    const timing = renderCaptureTiming(context, {
        getBufferedTransportStartTime(value) { requested = value; return value; },
        getTransportOutputLatencySeconds: () => .026
    }, 4.5);
    assert.equal(requested, 14.5);
    assert.equal(timing.sourceTime, requested);
    assert.equal(timing.startFrame, 14.5 * 48000 + 1248);
});

test('song capture rejects expired starts instead of moving only the audio or capture window', () => {
    for (const value of [9, 10, NaN, Infinity, null]) {
        assert.throws(() => renderCaptureTiming({ currentTime: 10, sampleRate: 48000 }, { getBufferedTransportStartTime: () => value }), /buffered start/);
    }
});

test('song capture rejects invalid measured latency and sample rates', () => {
    for (const value of [-.01, .3, NaN, Infinity]) {
        assert.throws(() => renderCaptureTiming({ currentTime: 10, sampleRate: 48000 }, { getBufferedTransportStartTime: () => 10.3, getTransportOutputLatencySeconds: () => value }), /latency/);
    }
    for (const sampleRate of [0, -1, NaN, Infinity]) {
        assert.throws(() => renderCaptureTiming({ currentTime: 10, sampleRate }, {}), /sample rate/);
    }
});
