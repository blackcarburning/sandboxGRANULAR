const test = require('node:test');
const assert = require('node:assert/strict');
const tone = require('../drum-tone.js');

function fixture() {
    const nodes = [];
    const makeNode = () => ({ connections: [], connect(destination) { this.connections.push(destination); } });
    const context = { sampleRate: 48000, createBiquadFilter: () => {
        const node = makeNode();
        node.Q = { value: 0 };
        node.frequency = { events: [], setValueAtTime(value, time) { this.events.push(['set', value, time]); }, exponentialRampToValueAtTime(value, time) { this.events.push(['ramp', value, time]); } };
        nodes.push(node);
        return node;
    } };
    return { context, input: makeNode(), output: makeNode(), nodes };
}

test('the cutoff control spans 20 Hz to 20 kHz logarithmically', () => {
    assert.equal(tone.cutoffHz(0), 20);
    assert.equal(tone.cutoffHz(100), 20000);
    assert.ok(Math.abs(tone.cutoffHz(50) - Math.sqrt(20 * 20000)) < .0001);
});

test('open neutral settings bypass processing exactly for legacy patches', () => {
    const { context, input, output, nodes } = fixture();
    assert.deepEqual(tone.connect(context, input, output), []);
    assert.equal(nodes.length, 0);
    assert.equal(input.connections[0], output);
});

test('48 dB/oct filtering uses four serial low-pass biquads with eighth-order Butterworth Q', () => {
    const { context, input, output, nodes } = fixture();
    const filters = tone.connect(context, input, output, { cutoff: 50, start: 2, duration: .2 });
    assert.equal(filters.length, 4);
    assert.equal(input.connections[0], nodes[0]);
    for (const [index, node] of nodes.entries()) {
        assert.equal(node.type, 'lowpass');
        assert.equal(node.Q.value, 20 * Math.log10(1 / (2 * Math.cos((2 * index + 1) * Math.PI / 16))));
        assert.equal(node.connections[0], index === 3 ? output : nodes[index + 1]);
    }
});

test('accent filter envelopes open then decay back to the cutoff on each stage', () => {
    const { context, input, output } = fixture();
    const filters = tone.connect(context, input, output, { cutoff: 40, envAmount: .8, accent: true, start: 1, duration: .3 });
    for (const filter of filters) {
        const [base, peak, end] = filter.frequency.events;
        assert.ok(peak[1] > base[1]);
        assert.equal(end[1], base[1]);
        assert.ok(end[2] > peak[2]);
        assert.ok(peak[1] <= 20000);
    }
});

test('unaccented hits and zero envelope amount never sweep the cutoff', () => {
    for (const options of [{ accent: false, envAmount: 1 }, { accent: true, envAmount: 0 }]) {
        const { context, input, output } = fixture();
        assert.ok(tone.connect(context, input, output, { cutoff: 40, ...options }).every(filter => filter.frequency.events.length === 1));
    }
});
