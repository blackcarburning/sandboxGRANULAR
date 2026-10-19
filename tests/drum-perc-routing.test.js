const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const start = source.indexOf('        function getDrumMachinePattern(track)');
const end = source.indexOf('        function cycleDrumMachineHatTimingMode', start);

function fixture() {
    const context = {
        drumMachineExtraTracks: {},
        drumMachineKickPattern: Array(16).fill(false), drumMachineSnarePattern: Array(16).fill(false),
        drumMachineHatPattern: Array(16).fill(false), drumMachinePercPattern: Array(16).fill(false),
        drumMachineKickRatchetPattern: Array(16).fill(0), drumMachineSnareRatchetPattern: Array(16).fill(0),
        drumMachineHatRatchetPattern: Array(16).fill(0), drumMachinePercRatchetPattern: Array(16).fill(0),
        getPatternLengthSteps: () => 16, clampPatternLengthSteps: value => value, PATTERN_STEPS_PER_BAR: 16,
        renderDrumMachineStepGrid: () => {}, saveState: () => {}
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    return context;
}

test('Perc notes and ratchets never change Kick, Snare or Hat', () => {
    const context = fixture();
    context.toggleDrumMachineStep('perc', 3);
    assert.equal(context.drumMachinePercPattern[3], true);
    context.cycleDrumMachineRatchetStep('perc', 7);
    assert.equal(context.drumMachinePercRatchetPattern[7], 2);
    assert.equal(context.drumMachinePercPattern[7], true);
    for (const lane of ['Kick', 'Snare', 'Hat']) {
        assert.ok(context[`drumMachine${lane}Pattern`].every(value => value === false));
        assert.ok(context[`drumMachine${lane}RatchetPattern`].every(value => value === 0));
    }
});

test('Perc ratchet count cycles independently through 2–8 and off', () => {
    const context = fixture();
    for (const expected of [2, 3, 4, 5, 6, 7, 8, 0]) {
        context.cycleDrumMachineRatchetStep('perc', 0);
        assert.equal(context.drumMachinePercRatchetPattern[0], expected);
        assert.equal(context.drumMachineKickRatchetPattern[0], 0);
    }
});
