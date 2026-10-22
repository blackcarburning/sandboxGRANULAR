(function (root) {
    'use strict';

    const notes = ['C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F', 'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B'];
    const qualities = {
        major: [0, 4, 7], minor: [0, 3, 7], diminished: [0, 3, 6], augmented: [0, 4, 8],
        sus2: [0, 2, 7], sus4: [0, 5, 7], fifth: [0, 7], major6: [0, 4, 7, 9], minor6: [0, 3, 7, 9],
        dominant7: [0, 4, 7, 10], major7: [0, 4, 7, 11], minor7: [0, 3, 7, 10],
        minorMajor7: [0, 3, 7, 11], diminished7: [0, 3, 6, 9], halfDiminished7: [0, 3, 6, 10],
        augmentedMajor7: [0, 4, 8, 11], augmented7: [0, 4, 8, 10], dominant7sus4: [0, 5, 7, 10],
        add9: [0, 4, 7, 14], minorAdd9: [0, 3, 7, 14], major69: [0, 4, 7, 9, 14],
        dominant9: [0, 4, 7, 10, 14], major9: [0, 4, 7, 11, 14], minor9: [0, 3, 7, 10, 14],
        dominant11: [0, 4, 7, 10, 14, 17], minor11: [0, 3, 7, 10, 14, 17],
        majorSharp11: [0, 4, 7, 11, 14, 18], dominant13: [0, 4, 7, 10, 14, 21],
        major13: [0, 4, 7, 11, 14, 21], minor13: [0, 3, 7, 10, 14, 21],
        dominantFlat9: [0, 4, 7, 10, 13], dominantSharp9: [0, 4, 7, 10, 15],
        dominantFlat5: [0, 4, 6, 10], dominantSharp5: [0, 4, 8, 10], quartal: [0, 5, 10], unison: [0]
    };

    const clamp = (value, minimum, maximum, fallback) => Number.isFinite(Number(value)) ? Math.min(maximum, Math.max(minimum, Number(value))) : fallback;
    const copy = value => JSON.parse(JSON.stringify(value));
    const pitchClass = midi => ((midi % 12) + 12) % 12;
    const noteName = midi => `${notes[pitchClass(midi)].split('/')[0]}${Math.floor(midi / 12) - 1}`;
    const instruments = {
        piano: { id: 'salamander-v3-q-4layer-44100-v1', repository: 'SAMPLES_Q/', label: 'Piano', count: 120 },
        strings: { id: 'vsco2-ce-q-strings-2layer-44100-v1', repository: 'SAMPLES_Q_STRINGS/', label: 'Strings', count: 34 }
    };
    const stringSections = { cello: [36, 40, 43, 47], viola: [48, 50, 52, 55, 59, 62], violin: [66, 69, 72, 76, 79, 83, 86] };
    const stringRoots = Object.values(stringSections).flat();

    function chord(rootNote, type = 'major', inversion = 0, voicing = 'close') {
        const intervals = qualities[type];
        if (!intervals) throw new Error('Unknown chord quality.');
        const result = intervals.map(interval => rootNote + interval);
        for (let index = 0; index < Math.min(inversion, result.length - 1); index += 1) result.push(result.shift() + 12);
        if (voicing === 'open' && result.length > 2) result[1] += 12;
        if (voicing === 'octave-bass') result.unshift(rootNote - 12);
        return [...new Set(result)].sort((first, second) => first - second);
    }

    function qualityFor(pitches) {
        const intervals = pitches.map(pitch => pitch - pitches[0]);
        return Object.keys(qualities).find(name => qualities[name].join(',') === intervals.join(',')) || 'scale chord';
    }

    // Exact pitch-class matching also recognizes inversions and doubled octaves.
    // Unknown voicings stay custom rather than receiving a misleading major label.
    function identifyChord(pitches, preferredRoot) {
        const sorted = [...new Set(pitches)].sort((a, b) => a - b);
        if (!sorted.length) throw new Error('Choose at least one note.');
        const classes = [...new Set(sorted.map(pitchClass))].sort((a, b) => a - b);
        const bass = sorted[0], roots = [...new Set([...(Number.isInteger(preferredRoot) ? [pitchClass(preferredRoot)] : []), pitchClass(bass), ...classes])];
        for (const rootClass of roots) for (const [type, intervals] of Object.entries(qualities)) {
            const expected = [...new Set(intervals.map(interval => (interval + rootClass) % 12))].sort((a, b) => a - b);
            if (expected.join(',') !== classes.join(',')) continue;
            let rootNote = bass - ((pitchClass(bass) - rootClass + 12) % 12);
            if (rootNote < 21) rootNote += 12;
            const inversion = [...new Set(intervals.map(pitchClass))].indexOf((pitchClass(bass) - rootClass + 12) % 12);
            const rootName = notes[rootClass].split('/')[0], bassName = notes[pitchClass(bass)].split('/')[0];
            const quality = type.replace(/([a-z])([A-Z])/g, '$1 $2').replace('dominant', 'dominant ');
            return { root: rootNote, type, inversion: Math.max(0, inversion), name: `${rootName} ${quality}${pitchClass(bass) !== rootClass ? ` / ${bassName}` : ''}` };
        }
        return { root: bass, type: 'custom', inversion: 0, name: `Custom · ${classes.map(value => notes[value].split('/')[0]).join(' – ')}` };
    }

    function editChordNotes(step, pitches, transpose = 0) {
        if (!step?.notes?.length || step.rest || !Array.isArray(pitches) || !pitches.length || pitches.length > 8 || pitches.some(pitch => !Number.isInteger(pitch) || pitch < 21 || pitch > 108)) throw new Error('Keep notes in the piano range A0–C8.');
        if (new Set(pitches).size !== pitches.length) throw new Error('That pitch is already used by another note.');
        transposed(pitches, transpose);
        const sorted = pitches.slice().sort((a, b) => a - b);
        const { root, type, inversion } = identifyChord(sorted, step.root);
        return { ...copy(step), notes: sorted, root, type, inversion, voicing: 'close' };
    }

    function chordEditLoop(state, patternLength, start, steps) {
        if (!Number.isInteger(patternLength) || patternLength < 1 || patternLength > 64 || !Number.isInteger(start) || start < 0 || start >= patternLength || !Number.isInteger(steps) || steps < 1 || steps > 256) throw new Error('Choose a loop length from 1 to 256 steps.');
        const loop = copy(state);
        loop.enabled = true;
        loop.record = false;
        loop.selection = null;
        loop.sequence = Array.from({ length: Math.max(64, steps) }, (_, index) => index < steps ? copy(state.sequence[(start + index) % patternLength] || null) : null);
        return loop;
    }

    function scaleChords(tonic, intervals, octave, size = 3) {
        if (!Array.isArray(intervals) || intervals.length < 3) return [];
        const base = (octave + 1) * 12 + tonic;
        return intervals.map((interval, degree) => {
            const pitches = Array.from({ length: size }, (_, index) => {
                const position = degree + index * 2;
                return base + intervals[position % intervals.length] + 12 * Math.floor(position / intervals.length);
            });
            return { root: base + interval, type: qualityFor(pitches), notes: pitches, degree: degree + 1 };
        });
    }

    function chordPalette(state, intervals) {
        const bassRoots = state.paletteBassRoots?.length ? state.paletteBassRoots : null;
        const allowed = new Set(intervals.map(interval => (state.tonic + interval) % 12));
        const roots = bassRoots
            ? bassRoots.map((pitch, index) => ({ root: (state.octave + 1) * 12 + pitch, degree: index + 1 }))
            : intervals.map((interval, index) => ({ root: (state.octave + 1) * 12 + state.tonic + interval, degree: index + 1 }));
        const focused = roots.findIndex(item => pitchClass(item.root) === state.chordRoot);
        if (focused > 0) roots.push(...roots.splice(0, focused));
        const result = [];
        for (const item of roots) {
            const types = Object.keys(qualities);
            const preferred = types.indexOf(state.chordType);
            if (preferred > 0) types.unshift(...types.splice(preferred, 1));
            for (const type of types) {
                const size = qualities[type].length;
                if (state.paletteFamilies === 'triads' && size !== 3) continue;
                if (state.paletteFamilies === 'sevenths' && size !== 4) continue;
                if (state.paletteFamilies === 'extended' && size < 5) continue;
                const pitches = chord(item.root, type, state.inversion, state.voicing);
                if (pitches.some(pitch => pitch < 21 || pitch > 108 || (!bassRoots && !allowed.has(pitchClass(pitch))))) continue;
                result.push({ ...item, type, notes: pitches, inversion: Math.min(state.inversion, size - 1), voicing: state.voicing, id: `${item.root}-${type}-${state.inversion}-${state.voicing}` });
            }
        }
        return result;
    }

    function normalizeStep(step) {
        if (step?.kind === 'accent' && Array.isArray(step.notes) && !step.notes.length && step.accent === true && step.rest !== true) return { kind: 'accent', notes: [], accent: true };
        if (!step || !Array.isArray(step.notes) || !step.notes.length) return null;
        const pitches = [...new Set(step.notes.filter(Number.isInteger))].sort((first, second) => first - second);
        if (!pitches.length || pitches.length > 8 || pitches.some(pitch => pitch < 21 || pitch > 108)) return null;
        return {
            root: Math.round(clamp(step.root, 21, 108, pitches[0])), type: String(step.type || 'custom').slice(0, 40), notes: pitches,
            velocity: Math.round(clamp(step.velocity, 1, 127, 96)), gate: clamp(step.gate, .1, 64, 4),
            inversion: Math.round(clamp(step.inversion, 0, 6, 0)), rest: step.rest === true,
            voicing: ['close', 'open', 'octave-bass'].includes(step.voicing) ? step.voicing : 'close',
            accent: step.accent === true, tie: step.tie === true, ratchet: Math.round(clamp(step.ratchet, 1, 8, 1))
        };
    }

    function defaults() {
        return {
            version: 1, performanceVersion: 6, instrument: 'piano', enabled: true, level: .5, pan: 0, tonic: 0, scale: 'major', customScale: [0, 2, 4, 5, 7, 9, 11],
            octave: 3, chordRoot: 0, chordType: 'major', inversion: 0, voicing: 'close', paletteSize: 3,
            transpose: 0, rate: 1, gate: 4, velocity: 96, accentAmount: .25, sampleLength: 1, sampleDecay: 1, record: false, recordMode: 'step',
            selection: null, chordHold: false,
            paletteFamilies: 'all', paletteBassRoots: null, arpEnabled: false, arpPattern: 'up', arpRepeat: 'once', arpDivision: .25,
            arpSteps: [1, 2, 3, 0, 3, 2, 1, 0],
            lowpass: 18000, highpass: 20, room: 0, delay: 0, delayBeats: .5, feedback: .32,
            sequence: Array(64).fill(null), bank: null
        };
    }

    function normalizeState(input) {
        const state = { ...defaults(), ...(input && typeof input === 'object' ? copy(input) : {}) };
        for (const [key, minimum, maximum] of [['level', 0, 1], ['pan', -1, 1], ['tonic', 0, 11], ['octave', 0, 8],
            ['chordRoot', 0, 11], ['inversion', 0, 6], ['transpose', -24, 24], ['gate', .1, 64], ['velocity', 1, 127],
            ['accentAmount', 0, 1], ['sampleLength', .05, 1], ['sampleDecay', .05, 1], ['lowpass', 100, 20000], ['highpass', 20, 10000], ['room', 0, 1],
            ['delay', 0, 1], ['feedback', 0, .8], ['delayBeats', 1 / 12, 6]]) state[key] = clamp(state[key], minimum, maximum, defaults()[key]);
        for (const key of ['tonic', 'octave', 'chordRoot', 'inversion', 'transpose', 'velocity']) state[key] = Math.round(state[key]);
        state.enabled = input && typeof input === 'object' ? input.enabled === true : true;
        state.instrument = state.instrument === 'strings' ? 'strings' : 'piano';
        state.record = state.record === true;
        state.recordMode = state.recordMode === 'live' ? 'live' : 'step';
        state.rate = [.25, .5, 1, 2, 4].includes(state.rate) ? state.rate : 1;
        state.paletteSize = state.paletteSize === 4 ? 4 : 3;
        state.chordType = qualities[state.chordType] ? state.chordType : 'major';
        state.voicing = ['close', 'open', 'octave-bass'].includes(state.voicing) ? state.voicing : 'close';
        state.scale = typeof state.scale === 'string' ? state.scale.slice(0, 100) : 'major';
        state.customScale = [...new Set((Array.isArray(state.customScale) ? state.customScale : defaults().customScale).filter(pitch => Number.isInteger(pitch) && pitch >= 0 && pitch < 12).concat(0))].sort((first, second) => first - second);
        state.sequence = Array.from({ length: 64 }, (_, index) => normalizeStep(state.sequence?.[index]));
        state.selection = state.selection?.notes?.length ? normalizeStep(state.selection) : null;
        state.paletteFamilies = ['all', 'triads', 'sevenths', 'extended'].includes(state.paletteFamilies) ? state.paletteFamilies : 'all';
        const bassRoots = Array.isArray(state.paletteBassRoots) ? [...new Set(state.paletteBassRoots.filter(pitch => Number.isInteger(pitch) && pitch >= 0 && pitch < 12))] : [];
        state.paletteBassRoots = bassRoots.length ? bassRoots : null;
        state.arpEnabled = state.arpEnabled === true;
        state.chordHold = state.chordHold === true;
        state.arpPattern = ['up', 'down', 'updown', 'odds', 'evens', 'custom'].includes(state.arpPattern) ? state.arpPattern : 'up';
        state.arpSteps = validArpSteps(state.arpSteps) ? state.arpSteps.slice() : defaults().arpSteps;
        state.arpRepeat = state.arpRepeat === 'until-next' ? 'until-next' : 'once';
        state.arpDivision = clamp(state.arpDivision, .03125, 4, .25);
        state.version = 1;
        state.performanceVersion = 6;
        return state;
    }

    function sampleEnvelope(state, duration, release) {
        const length = clamp(state.sampleLength, .05, 1, 1);
        const decay = clamp(state.sampleDecay, .05, 1, 1);
        return { duration: Math.min(duration, Math.max(.006, duration * length * decay)), release: release * length, fading: decay < 1 };
    }

    function validArpSteps(steps) {
        return Array.isArray(steps) && steps.length >= 1 && steps.length <= 32 && steps.every(value => Number.isInteger(value) && value >= 0 && value <= 8);
    }

    function accentGain(state, position, length) {
        const index = ((Math.floor(position + .0000001) % length) + length) % length;
        return state.sequence[index]?.accent ? 1 + 2 * state.accentAmount : 1;
    }

    function transposed(pitches, amount) {
        const result = pitches.map(pitch => pitch + amount);
        if (result.some(pitch => pitch < 21 || pitch > 108)) throw new Error('That transposition would leave the piano range A0–C8.');
        return result;
    }

    function effectiveVelocity(state, step) {
        return Math.round(Math.min(127, step.velocity * (step.accent ? 1 + state.accentAmount : 1)));
    }

    function events(state, length) {
        const result = [];
        for (let index = 0; index < length; index += 1) {
            const step = state.sequence[index];
            if (!step?.notes?.length || step.rest) continue;
            const pitches = transposed(step.notes, state.transpose);
            const previous = result.at(-1);
            if (step.tie && previous && previous.notes.join(',') === pitches.join(',') && previous.start + previous.gate >= index) {
                previous.gate = Math.max(previous.gate, index - previous.start + step.gate);
                continue;
            }
            for (let repeat = 0; repeat < step.ratchet; repeat += 1) result.push({ start: index + repeat / step.ratchet, gate: step.gate / step.ratchet, notes: pitches, velocity: effectiveVelocity(state, step), sampleVelocity: effectiveVelocity(state, step), index });
        }
        return result;
    }

    function arpOrder(pitches, pattern = 'up', steps = defaults().arpSteps) {
        const sorted = [...new Set(pitches)].sort((first, second) => first - second);
        if (pattern === 'custom') return steps.map(rank => rank === 0 ? null : sorted[(rank - 1) % sorted.length]);
        if (pattern === 'down') return sorted.reverse();
        if (pattern === 'updown') return sorted.concat(sorted.slice(1, -1).reverse());
        const odds = sorted.filter((pitch, index) => index % 2 === 0);
        const evens = sorted.filter((pitch, index) => index % 2 === 1);
        if (pattern === 'odds') return odds.concat(evens);
        if (pattern === 'evens') return evens.concat(odds);
        return sorted;
    }

    function arpPhrase(state, chordStep, start = 0, length = 64) {
        if (!state.arpEnabled) throw new Error('Switch Q from block chords to ARP before copying.');
        const step = normalizeStep(chordStep);
        if (!step?.notes?.length || step.rest) throw new Error('Select a playable Q chord before copying its arp.');
        const order = arpOrder(transposed(step.notes, state.transpose), state.arpPattern, state.arpSteps);
        const interval = state.arpDivision * 4 * state.rate;
        return order.map((pitch, pulse) => {
            const cell = Math.floor(start + pulse * interval + .000001) % length;
            const accent = state.accentAmount > 0 && (Boolean(state.sequence[cell]?.accent) || (cell === Math.floor(start) % length && step.accent));
            return { note: pitch === null ? '' : noteName(pitch).replaceAll('♯', '#'), rest: pitch === null, accent: pitch !== null && accent, slide: false, ratchet: 1 };
        });
    }

    function arpSequence(state, length = 64) {
        if (!state.arpEnabled) throw new Error('Switch Q from block chords to ARP before copying.');
        const interval = state.arpDivision * 4 * state.rate;
        const timeline = playbackEvents(state, length).map(event => ({ ...event, start: event.start % length }))
            .sort((first, second) => first.start - second.start);
        const steps = [];
        const gap = () => ({ note: '', rest: true, accent: false, slide: false, ratchet: 1 });
        let position = 0;
        for (const event of timeline) {
            while (position < event.start - .000001) {
                steps.push(gap());
                position += interval;
            }
            steps.push({ note: noteName(event.notes[0]).replaceAll('♯', '#'), rest: false,
                accent: accentGain(state, event.start, length) > 1, slide: false, ratchet: 1 });
            position = event.start + interval;
        }
        while (position < length - .000001) {
            steps.push(gap());
            position += interval;
        }
        return steps;
    }

    function playbackEvents(state, length) {
        const chords = events(state, length);
        const stops = state.sequence.slice(0, length).flatMap((step, index) => step?.rest ? [index] : []);
        const firstBoundary = Math.min(chords[0]?.start ?? length, stops[0] ?? length);
        if (!state.arpEnabled) return state.chordHold ? chords.map((event, index) => ({
            ...event,
            gate: Math.min(chords[index + 1]?.start ?? length + firstBoundary,
                stops.find(position => position > event.start) ?? length + firstBoundary) - event.start
        })) : chords;
        const interval = state.arpDivision * 4 * state.rate;
        const result = [];
        for (const [index, event] of chords.entries()) {
            const stop = stops.find(position => position > event.start);
            const boundary = Math.min(chords[index + 1]?.start ?? length + firstBoundary, stop ?? length + firstBoundary);
            const order = arpOrder(event.notes, state.arpPattern, state.arpSteps);
            const end = state.arpRepeat === 'until-next' ? boundary : Math.min(length, stop ?? length, event.start + interval * order.length);
            for (let pulse = 0; event.start + pulse * interval < end - .000001; pulse += 1) {
                const start = event.start + pulse * interval;
                const pitch = order[pulse % order.length];
                if (pitch === null) continue;
                const step = state.sequence[event.index];
                const velocity = effectiveVelocity(state, { ...step, accent: accentGain(state, start, length) > 1 });
                result.push({ ...event, start, velocity, gate: Math.min(interval * .8, end - start), notes: [pitch], chordNotes: event.notes });
            }
        }
        return result.sort((first, second) => first.start - second.start);
    }

    function sampleFor(samples, midi, velocity) {
        if (!samples?.length) throw new Error('No piano samples are available.');
        return samples.reduce((best, sample) => {
            const distance = Math.abs(sample.midi - midi) * 1000 + Math.abs(sample.velocity - velocity);
            const previous = Math.abs(best.midi - midi) * 1000 + Math.abs(best.velocity - velocity);
            return distance < previous ? sample : best;
        });
    }

    const sampleMidi = (midi, instrument = 'piano') => instrument === 'strings'
        ? stringRoots.reduce((best, value) => Math.abs(value - midi) < Math.abs(best - midi) ? value : best)
        : Math.min(108, Math.max(21, 21 + Math.round((midi - 21) / 3) * 3));
    const sampleVelocity = (velocity, instrument = 'piano') => (instrument === 'strings' ? [32, 96] : [32, 64, 95, 127]).reduce((best, value) => Math.abs(value - velocity) < Math.abs(best - velocity) ? value : best);

    function sampleIdentity(id, instrument = 'piano') {
        if (instrument === 'strings') {
            const match = /^(cello|viola|violin)(\d{2})v(32|96)$/.exec(id);
            return match && stringSections[match[1]].includes(Number(match[2])) ? { midi: Number(match[2]), velocity: Number(match[3]) } : null;
        }
        const match = /^([A-G])(s?)(\d)v(4|8|12|16)$/.exec(id);
        return match ? { midi: (Number(match[3]) + 1) * 12 + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1]] + Number(Boolean(match[2])), velocity: Math.round(Number(match[4]) / 16 * 127) } : null;
    }

    function validateBank(state, asset) {
        if (state?.version !== 1 || !Array.isArray(state.sequence) || state.sequence.length !== 64) throw new Error('Saved Q piano settings are incomplete.');
        const instrument = state.instrument === undefined ? 'piano' : state.instrument;
        if (!Object.hasOwn(instruments, instrument)) throw new Error('Saved Q instrument is unsupported.');
        const specification = instruments[instrument];
        if ((state.arpEnabled !== undefined && typeof state.arpEnabled !== 'boolean') || (state.arpPattern !== undefined && !['up', 'down', 'updown', 'odds', 'evens', 'custom'].includes(state.arpPattern)) || (state.arpRepeat !== undefined && !['once', 'until-next'].includes(state.arpRepeat)) || (state.arpDivision !== undefined && (!Number.isFinite(state.arpDivision) || state.arpDivision < .03125 || state.arpDivision > 4)) || (state.arpSteps !== undefined && !validArpSteps(state.arpSteps)) || (state.arpPattern === 'custom' && !validArpSteps(state.arpSteps))) throw new Error('Saved Q arpeggiator settings are invalid.');
        if (state.chordHold !== undefined && typeof state.chordHold !== 'boolean') throw new Error('Saved Q chord hold is invalid.');
        if (state.performanceVersion !== undefined && state.performanceVersion !== 6) throw new Error('Saved Q performance version is unsupported.');
        for (const key of ['sampleLength', 'sampleDecay']) {
            if (state[key] !== undefined && (!Number.isFinite(state[key]) || state[key] < .05 || state[key] > 1)) throw new Error('Saved Q sample length or decay is invalid.');
        }
        for (const step of state.sequence) {
            if (step === null) continue;
            if (step?.kind === 'accent' && step.accent === true && step.rest !== true && Array.isArray(step.notes) && step.notes.length === 0) continue;
            if (!step || !Array.isArray(step.notes) || !step.notes.length || step.notes.length > 8 || step.notes.some(pitch => !Number.isInteger(pitch) || pitch < 21 || pitch > 108) || !Number.isInteger(step.velocity) || step.velocity < 1 || step.velocity > 127 || !Number.isFinite(step.gate) || step.gate < .1 || step.gate > 64) throw new Error('Saved Q chord settings are invalid.');
        }
        const bank = state?.bank;
        const needed = state?.sequence?.some(step => step?.notes?.length && !step.rest);
        if (!needed && !bank && !asset) return;
        if (!bank || bank.version !== 1 || !asset || asset.channels !== 2 || !Array.isArray(bank.samples) || !bank.samples.length || bank.samples.length > 120 || bank.sampleRate !== asset.sampleRate) throw new Error('Saved Q piano bank is incomplete. No phone samples will be substituted.');
        if ((bank.instrument === undefined ? instruments.piano.id : bank.instrument) !== specification.id || bank.samples.length > specification.count) throw new Error('Saved Q instrument and sample bank do not match.');
        let previousEnd = 0;
        const identifiers = new Set();
        for (const sample of bank.samples) {
            const identity = sampleIdentity(sample?.id, instrument);
            if (!identity || identifiers.has(sample.id) || !Number.isInteger(sample.offset) || !Number.isInteger(sample.frames) || sample.offset < previousEnd || sample.frames < 1 || sample.offset + sample.frames > asset.frames || sample.midi !== identity.midi || sample.midi < 21 || sample.midi > 108 || sample.velocity !== identity.velocity) throw new Error('Saved Q piano sample inventory is invalid.');
            if (instrument === 'strings' && (!Number.isInteger(sample.loopStart) || !Number.isInteger(sample.loopEnd) || sample.loopStart < 1 || sample.loopEnd <= sample.loopStart || sample.loopEnd > sample.frames)) throw new Error('Saved Q string sustain loop is invalid.');
            previousEnd = sample.offset + sample.frames;
            identifiers.add(sample.id);
        }
        for (const step of state.sequence.filter(step => step?.notes?.length && !step.rest)) {
            const velocity = effectiveVelocity(state, step);
            for (const pitch of transposed(step.notes, state.transpose)) {
                if (!bank.samples.some(sample => sample.midi === sampleMidi(pitch, instrument) && sample.velocity === sampleVelocity(velocity, instrument))) throw new Error('Saved Q piano bank is missing a required pitch or velocity layer.');
            }
        }
    }

    function midiFile(state, length, bpm) {
        const sequence = [{ tick: 0, priority: 0, bytes: [255, 81, 3, ...[16, 8, 0].map(shift => (Math.round(60000000 / bpm) >> shift) & 255)] }, { tick: 0, priority: 1, bytes: [192, state.instrument === 'strings' ? 48 : 0] }];
        for (const event of playbackEvents(state, length)) {
            const start = Math.round(event.start * 120 / state.rate);
            const end = Math.round((event.start + event.gate) * 120 / state.rate);
            for (const pitch of event.notes) {
                sequence.push({ tick: start, priority: 3, bytes: [144, pitch, event.velocity] }, { tick: end, priority: 2, bytes: [128, pitch, 0] });
            }
        }
        sequence.sort((first, second) => first.tick - second.tick || first.priority - second.priority);
        const track = [];
        let previous = 0;
        for (const event of sequence.concat({ tick: Math.max(sequence.at(-1)?.tick || 0, Math.round(length * 120 / state.rate)), bytes: [255, 47, 0] })) {
            let delta = event.tick - previous;
            const encoded = [delta & 127];
            while ((delta >>= 7) > 0) encoded.unshift((delta & 127) | 128);
            track.push(...encoded, ...event.bytes);
            previous = event.tick;
        }
        return new Uint8Array([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107, ...[24, 16, 8, 0].map(shift => (track.length >> shift) & 255), ...track]);
    }

    const api = { notes, qualities, instruments, stringSections, clamp, copy, pitchClass, noteName, chord, identifyChord, editChordNotes, chordEditLoop, scaleChords, chordPalette, normalizeStep, defaults, normalizeState, sampleEnvelope, validArpSteps, accentGain, transposed, effectiveVelocity, events, arpOrder, arpPhrase, arpSequence, playbackEvents, sampleFor, sampleMidi, sampleVelocity, sampleIdentity, validateBank, midiFile };
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.MygrainQTheory = api;
})(typeof window === 'object' ? window : globalThis);
