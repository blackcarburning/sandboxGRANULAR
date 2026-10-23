const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const functionBody = name => {
    const start = html.indexOf(`        function ${name}(`);
    assert.ok(start > 0, name);
    const end = html.indexOf('\n        }', start) + '\n        }'.length;
    return html.slice(start, end);
};
const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const context = { octaveOffset: 0, noteSemitoneOffsets: Object.fromEntries(names.map((name, i) => [name, i])), noteFrequencies: {} };
vm.createContext(context);
vm.runInContext(['parseNoteName', 'transposeNoteName', 'noteNameToMidi', 'getNoteFrequency', 'getKeyboardNoteMidi', 'getKeyboardNoteFrequency', 'getGranularKeyboardNoteFrequency'].map(functionBody).join('\n'), context);

test('all 336 displayed-base-note / octave combinations have exact chromatic MIDI and equal-temperament frequency', () => {
    for (let shift = -3; shift <= 3; shift++) {
        context.octaveOffset = shift;
        for (let octave = 1; octave <= 4; octave++) for (let pitch = 0; pitch < 12; pitch++) {
            const note = names[pitch] + octave, midi = (octave + shift + 1) * 12 + pitch;
            assert.equal(context.getKeyboardNoteMidi(note), midi);
            assert.equal(context.getKeyboardNoteFrequency(note), 440 * 2 ** ((midi - 69) / 12));
            assert.equal(context.transposeNoteName(note, shift), names[pitch] + (octave + shift));
            assert.ok(Math.abs(context.getGranularKeyboardNoteFrequency(note) - context.getKeyboardNoteFrequency(note)) < 1e-8);
        }
    }
});

test('C4 is MIDI 60, A4 is 440 Hz; sharp, E/F and B/C intervals never change order', () => {
    context.octaveOffset = 0;
    assert.equal(context.getKeyboardNoteMidi('C4'), 60);
    assert.equal(context.getKeyboardNoteFrequency('A4'), 440);
    for (const [first, next] of [['C3', 'C#3'], ['C#3', 'D3'], ['E3', 'F3'], ['B3', 'C4']]) {
        assert.equal(context.getKeyboardNoteMidi(next) - context.getKeyboardNoteMidi(first), 1);
        assert.ok(Math.abs(context.getKeyboardNoteFrequency(next) / context.getKeyboardNoteFrequency(first) - 2 ** (1 / 12)) < 1e-12);
    }
});
