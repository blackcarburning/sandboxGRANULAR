(function (globalScope) {
    'use strict';

    function clampNumber(value, options = {}) {
        const { min = -Infinity, max = Infinity, fallback = min } = options;
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return fallback;
        }
        return Math.min(max, Math.max(min, numericValue));
    }

    function sanitizeBooleanMap(input, allowedKeys) {
        const output = {};
        if (!input || typeof input !== 'object') {
            return output;
        }

        allowedKeys.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(input, key)) {
                output[key] = Boolean(input[key]);
            }
        });

        return output;
    }

    function validatePreset(rawPreset, options = {}) {
        if (!rawPreset || typeof rawPreset !== 'object' || Array.isArray(rawPreset)) {
            throw new Error('Invalid preset format');
        }

        const {
            sliderSchema = {},
            allowedWaveforms = ['sine', 'triangle', 'sawtooth', 'square'],
            allowedNoiseTypes = ['none', 'white', 'pink'],
            allowedModes = ['hz', 'bpm'],
            toggleParams = [],
            maxOctave = 3
        } = options;

        const warnings = [];
        const preset = {
            version: typeof rawPreset.version === 'string' ? rawPreset.version : '3.0',
            timestamp: rawPreset.timestamp || new Date().toISOString(),
            sliders: {},
            lfo: { mode: 'hz', enabled: {}, inverted: {} },
            lfo2: { mode: 'hz', enabled: {}, inverted: {} },
            lfo3: { enabled: {}, inverted: {} },
            octave: 0,
            lfoWaveform: 'sine',
            lfo2Waveform: 'sine',
            lfo3Waveform: 'sine',
            noiseType: 'none'
        };

        Object.entries(sliderSchema).forEach(([id, schema]) => {
            const fallback = schema.defaultValue;
            const hasValue = rawPreset.sliders && Object.prototype.hasOwnProperty.call(rawPreset.sliders, id);
            const sanitizedValue = clampNumber(hasValue ? rawPreset.sliders[id] : fallback, {
                min: schema.min,
                max: schema.max,
                fallback
            });

            if (hasValue && Number(rawPreset.sliders[id]) !== sanitizedValue) {
                warnings.push(`Clamped ${id}`);
            }

            preset.sliders[id] = sanitizedValue;
        });

        const sanitizeWaveform = (value, fallback, label) => {
            if (allowedWaveforms.includes(value)) {
                return value;
            }
            if (value !== undefined) {
                warnings.push(`Unsupported ${label}`);
            }
            return fallback;
        };

        preset.lfoWaveform = sanitizeWaveform(rawPreset.lfoWaveform, 'sine', 'LFO waveform');
        preset.lfo2Waveform = sanitizeWaveform(rawPreset.lfo2Waveform, 'sine', 'LFO2 waveform');
        preset.lfo3Waveform = sanitizeWaveform(rawPreset.lfo3Waveform, 'sine', 'LFO3 waveform');

        if (allowedNoiseTypes.includes(rawPreset.noiseType)) {
            preset.noiseType = rawPreset.noiseType;
        } else if (rawPreset.noiseType !== undefined) {
            warnings.push('Unsupported noise type');
        }

        const sanitizeMode = (value, fallback, label) => {
            if (allowedModes.includes(value)) {
                return value;
            }
            if (value !== undefined) {
                warnings.push(`Unsupported ${label}`);
            }
            return fallback;
        };

        preset.lfo.mode = sanitizeMode(rawPreset.lfo && rawPreset.lfo.mode, 'hz', 'LFO mode');
        preset.lfo2.mode = sanitizeMode(rawPreset.lfo2 && rawPreset.lfo2.mode, 'hz', 'LFO2 mode');

        preset.lfo.enabled = sanitizeBooleanMap(rawPreset.lfo && rawPreset.lfo.enabled, toggleParams);
        preset.lfo.inverted = sanitizeBooleanMap(rawPreset.lfo && rawPreset.lfo.inverted, toggleParams);
        preset.lfo2.enabled = sanitizeBooleanMap(rawPreset.lfo2 && rawPreset.lfo2.enabled, toggleParams);
        preset.lfo2.inverted = sanitizeBooleanMap(rawPreset.lfo2 && rawPreset.lfo2.inverted, toggleParams);
        preset.lfo3.enabled = sanitizeBooleanMap(rawPreset.lfo3 && rawPreset.lfo3.enabled, toggleParams);
        preset.lfo3.inverted = sanitizeBooleanMap(rawPreset.lfo3 && rawPreset.lfo3.inverted, toggleParams);

        preset.octave = clampNumber(rawPreset.octave, {
            min: -maxOctave,
            max: maxOctave,
            fallback: 0
        });

        return { preset, warnings };
    }

    function resolveSampleWindow(options = {}) {
        const bufferDuration = clampNumber(options.bufferDuration, { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
        const startPct = clampNumber(options.startPct, { min: 0, max: 1, fallback: 0 });
        const endPct = clampNumber(options.endPct, { min: 0, max: 1, fallback: 1 });
        const grainSizeSeconds = clampNumber(options.grainSizeSeconds, { min: 0.001, max: Math.max(bufferDuration, 0.001), fallback: 0.1 });
        const positionPct = clampNumber(options.positionPct, { min: 0, max: 1, fallback: 0 });
        const sprayAmount = clampNumber(options.sprayAmount, { min: 0, max: 1, fallback: 0 });
        const randomValue = clampNumber(options.randomValue, { min: -1, max: 1, fallback: 0 });

        let boundedStartPct = Math.min(startPct, endPct);
        let boundedEndPct = Math.max(startPct, endPct);

        let startTime = bufferDuration * boundedStartPct;
        let endTime = bufferDuration * boundedEndPct;

        if (endTime - startTime < grainSizeSeconds) {
            const midpoint = (startTime + endTime) / 2;
            const halfSize = grainSizeSeconds / 2;
            startTime = Math.max(0, midpoint - halfSize);
            endTime = Math.min(bufferDuration, startTime + grainSizeSeconds);
            startTime = Math.max(0, endTime - grainSizeSeconds);
        }

        const usableDuration = Math.max(0.001, endTime - startTime);
        const sprayOffset = randomValue * usableDuration * 0.5 * sprayAmount;
        const maxPlayPosition = Math.max(startTime, endTime - grainSizeSeconds);
        const rawPlayPosition = startTime + usableDuration * positionPct + sprayOffset;
        const playPosition = clampNumber(rawPlayPosition, {
            min: startTime,
            max: maxPlayPosition,
            fallback: startTime
        });

        return {
            startTime,
            endTime,
            usableDuration,
            playPosition,
            grainSizeSeconds: Math.min(grainSizeSeconds, Math.max(0.001, bufferDuration || grainSizeSeconds))
        };
    }

    function resolveLoopedPlayPosition(options = {}) {
        const startTime = clampNumber(options.startTime, { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
        const rawEndTime = clampNumber(options.endTime, { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: startTime + 0.001 });
        const endTime = Math.max(startTime + 0.001, rawEndTime);
        const positionPct = clampNumber(options.positionPct, { min: 0, max: 1, fallback: 0 });
        const elapsedSeconds = clampNumber(options.elapsedSeconds, { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
        const playbackRate = Math.max(0.001, Math.abs(clampNumber(options.playbackRate, { min: -128, max: 128, fallback: 1 })));
        const loopDuration = Math.max(0.001, endTime - startTime);
        const baseOffset = loopDuration * positionPct;
        const travelSeconds = elapsedSeconds * playbackRate;
        const wrappedOffset = ((baseOffset + travelSeconds) % loopDuration + loopDuration) % loopDuration;
        const epsilon = Math.min(0.001, loopDuration * 0.1);

        return clampNumber(startTime + wrappedOffset, {
            min: startTime,
            max: Math.max(startTime, endTime - epsilon),
            fallback: startTime
        });
    }

    function buildKeyboardGeometry(noteNames, whiteKeyWidth, blackKeyWidth) {
        const notes = Array.isArray(noteNames) ? noteNames : [];
        const safeWhiteWidth = clampNumber(whiteKeyWidth, { min: 24, max: 240, fallback: 48 });
        const safeBlackWidth = clampNumber(blackKeyWidth, { min: 12, max: safeWhiteWidth, fallback: safeWhiteWidth * 0.62 });
        const layout = [];
        let whiteIndex = 0;

        notes.forEach((note) => {
            const isBlack = String(note).includes('#');
            if (!isBlack) {
                layout.push({ note, left: whiteIndex * safeWhiteWidth, width: safeWhiteWidth, isBlack: false });
                whiteIndex += 1;
                return;
            }

            const left = Math.max(0, (whiteIndex * safeWhiteWidth) - (safeBlackWidth / 2));
            layout.push({ note, left, width: safeBlackWidth, isBlack: true });
        });

        return layout;
    }

    function recordingExtensionForMimeType(mimeType) {
        const value = String(mimeType || '').toLowerCase();
        if (value.includes('wav')) return '.wav';
        if (value.includes('ogg')) return '.ogg';
        if (value.includes('mp4') || value.includes('aac')) return '.m4a';
        if (value.includes('webm')) return '.webm';
        return '.webm';
    }

    function hashSeed(seedValue) {
        const text = String(seedValue ?? 'mygrain');
        let hash = 2166136261 >>> 0;
        for (let index = 0; index < text.length; index += 1) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }

    function createSeededRandom(seedValue) {
        let state = hashSeed(seedValue);
        return function seededRandom() {
            state += 0x6D2B79F5;
            let t = state;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function pickWeighted(values, randomFn) {
        const choices = Array.isArray(values) ? values : [];
        if (choices.length === 0) return null;
        const random = typeof randomFn === 'function' ? randomFn : Math.random;
        const totalWeight = choices.reduce((sum, item) => sum + Math.max(0, Number(item && item.weight) || 0), 0);
        if (totalWeight <= 0) {
            return choices[0].value;
        }

        let threshold = random() * totalWeight;
        for (let index = 0; index < choices.length; index += 1) {
            const item = choices[index];
            threshold -= Math.max(0, Number(item && item.weight) || 0);
            if (threshold <= 0) {
                return item.value;
            }
        }
        return choices[choices.length - 1].value;
    }

    function generateRhythmicStepBlueprint(options = {}) {
        const stepCount = Math.max(8, Math.min(64, Math.round(clampNumber(options.stepCount, { min: 8, max: 64, fallback: 16 }))));
        const random = typeof options.random === 'function'
            ? options.random
            : createSeededRandom(options.seed ?? `mygrain-${stepCount}`);

        const archetypes = {
            straight: { motif: [1, 0, 1, 0, 1, 0, 1, 0], mutationRate: 0.16, restChance: 0.18, velocity: [62, 88], fillChance: 0.12 },
            pulsed: { motif: [1, 0, 1, 1, 1, 0, 1, 0], mutationRate: 0.24, restChance: 0.14, velocity: [58, 86], fillChance: 0.2 },
            syncopated: { motif: [1, 0, 0, 1, 1, 0, 1, 1], mutationRate: 0.3, restChance: 0.22, velocity: [52, 84], fillChance: 0.28 },
            sparse: { motif: [1, 0, 0, 0, 1, 0, 1, 0], mutationRate: 0.14, restChance: 0.34, velocity: [56, 90], fillChance: 0.08 },
            rolling: { motif: [1, 1, 0, 1, 1, 0, 1, 0], mutationRate: 0.26, restChance: 0.16, velocity: [54, 82], fillChance: 0.2 },
            glitchFill: { motif: [1, 0, 1, 1, 0, 1, 1, 0], mutationRate: 0.34, restChance: 0.2, velocity: [48, 78], fillChance: 0.52 }
        };

        const selectedArchetype = options.archetype && archetypes[options.archetype]
            ? options.archetype
            : pickWeighted([
                { value: 'straight', weight: 1.1 },
                { value: 'pulsed', weight: 1.1 },
                { value: 'syncopated', weight: 1 },
                { value: 'sparse', weight: 0.85 },
                { value: 'rolling', weight: 1.1 },
                { value: 'glitchFill', weight: 0.7 }
            ], random);
        const archetype = archetypes[selectedArchetype] || archetypes.straight;

        const halfLength = Math.ceil(stepCount / 2);
        const halfPattern = new Array(halfLength).fill(false).map((_, index) => Boolean(archetype.motif[index % archetype.motif.length]));
        const basePattern = new Array(stepCount).fill(false).map((_, index) => {
            return halfPattern[index % halfPattern.length];
        });
        const enabled = [...basePattern];
        const accents = new Array(stepCount).fill(false);
        const velocities = new Array(stepCount).fill(0);
        const pitchOffsets = new Array(stepCount).fill(0);
        const motif = [0, 2, 3, 5, 7, 8, 10, 12];

        const anchorSteps = new Set([0, 4, 8, 12].filter((index) => index < stepCount));
        anchorSteps.forEach((index) => {
            enabled[index] = true;
        });

        for (let index = 0; index < stepCount; index += 1) {
            if (index < halfLength) continue;
            if (random() < archetype.mutationRate) {
                const wasEnabled = enabled[index];
                enabled[index] = !enabled[index];
                if (anchorSteps.has(index) && !enabled[index]) {
                    enabled[index] = true;
                } else if (wasEnabled && random() < archetype.restChance) {
                    enabled[index] = false;
                }
            }
        }

        for (let index = 0; index < stepCount; index += 1) {
            if (!enabled[index]) continue;
            if (!anchorSteps.has(index) && random() < archetype.restChance) {
                enabled[index] = false;
            }
        }

        let activeCount = enabled.filter(Boolean).length;
        const minimumActive = Math.max(4, Math.round(stepCount * 0.32));
        if (activeCount < minimumActive) {
            for (let index = 0; index < stepCount && activeCount < minimumActive; index += 1) {
                if (!enabled[index]) {
                    enabled[index] = true;
                    activeCount += 1;
                }
            }
        }

        let fillApplied = false;
        if (random() < archetype.fillChance && stepCount >= 16) {
            fillApplied = true;
            for (let index = Math.max(0, stepCount - 4); index < stepCount; index += 1) {
                enabled[index] = random() < 0.8;
            }
        }

        for (let index = 0; index < stepCount; index += 1) {
            const isAnchor = anchorSteps.has(index);
            const isSyncAccent = index % 4 === 3;
            const accent = Boolean(enabled[index] && (isAnchor || (isSyncAccent && random() < 0.58)));
            accents[index] = accent;

            if (!enabled[index]) {
                velocities[index] = 0;
                pitchOffsets[index] = 0;
                continue;
            }

            const [velocityMin, velocityMax] = archetype.velocity;
            const baseVelocity = velocityMin + random() * (velocityMax - velocityMin);
            const dynamicContour = (index % 8 === 0 ? 8 : (index % 2 === 0 ? 2 : -4));
            const accentLift = accent ? 12 : 0;
            velocities[index] = Math.round(clampNumber(baseVelocity + dynamicContour + accentLift, { min: 32, max: 96, fallback: 64 }));

            const motifDegree = motif[index % motif.length];
            const octaveOffset = random() < 0.28 ? 12 : 0;
            const passing = random() < 0.24 ? (random() < 0.5 ? 1 : -1) : 0;
            pitchOffsets[index] = Math.round(clampNumber(motifDegree + octaveOffset + passing, { min: -12, max: 24, fallback: 0 }));
        }

        return {
            archetype: selectedArchetype,
            enabled,
            accents,
            velocities,
            pitchOffsets,
            fillApplied
        };
    }

    function buildDrumSoundPalette() {
        const palette = [];
        const categorySpecs = [
            { category: 'kick', count: 32, families: ['kickSub', 'kickPunch', 'kickThud'] },
            { category: 'snare', count: 28, families: ['snareCrack', 'snareDust', 'snareSnap'] },
            { category: 'clap', count: 18, families: ['clapTight', 'clapWide', 'clapDust'] },
            { category: 'closedHat', count: 28, families: ['hatTick', 'hatChip', 'hatMetal'] },
            { category: 'openHat', count: 18, families: ['openHatAir', 'openHatMetal'] },
            { category: 'cymbal', count: 14, families: ['cymbalWash', 'cymbalPing'] },
            { category: 'tom', count: 24, families: ['tomLow', 'tomMid', 'tomHigh'] },
            { category: 'rim', count: 10, families: ['rimWood', 'rimMetal'] },
            { category: 'click', count: 10, families: ['clickDigital', 'clickMuted'] },
            { category: 'shaker', count: 20, families: ['shakerDry', 'shakerWide'] },
            { category: 'perc', count: 18, families: ['percTone', 'percNoise', 'percHybrid'] },
            { category: 'miscPerc', count: 12, families: ['miscWood', 'miscMetal', 'miscZap'] }
        ];

        const shape = (index, count) => count <= 1 ? 0 : index / (count - 1);
        const vary = (min, max, t, wobble = 0, phase = 0) => {
            const arc = 0.5 - (0.5 * Math.cos((t + phase) * Math.PI));
            const wobbleValue = wobble === 0 ? 0 : Math.sin((t + phase) * Math.PI * 4) * wobble;
            return min + (max - min) * Math.max(0, Math.min(1, arc + wobbleValue));
        };

        categorySpecs.forEach(({ category, count, families }) => {
            for (let index = 0; index < count; index += 1) {
                const t = shape(index, count);
                const family = families[index % families.length];
                const recipe = {
                    id: `${category}-${String(index + 1).padStart(3, '0')}`,
                    category,
                    family,
                    weight: 1,
                    level: 0.4,
                    panWidth: 0.1,
                    toneFreq: 220,
                    overtone: 1.5,
                    metallic: 0.3,
                    noiseTone: 0.2,
                    click: 0.15,
                    cluster: 3,
                    attackSeconds: 0.0015,
                    decaySeconds: 0.06,
                    durationSteps: 0.5,
                    pitchDrop: 20,
                    dropRate: 18,
                    drive: 1.2
                };

                if (category === 'kick') {
                    Object.assign(recipe, {
                        weight: 1.35,
                        level: vary(0.74, 0.96, t, 0.08),
                        toneFreq: vary(38, 68, t, 0.04),
                        overtone: vary(0.46, 1.14, t, 0.06),
                        click: vary(0.08, 0.34, t, 0.04),
                        noiseTone: vary(0.01, 0.12, t, 0.03),
                        attackSeconds: vary(0.001, 0.0035, t),
                        decaySeconds: vary(0.18, 0.42, t, 0.05),
                        durationSteps: vary(0.72, 1.2, t, 0.03),
                        pitchDrop: vary(40, 110, t, 0.08),
                        dropRate: vary(10, 24, t, 0.06),
                        drive: vary(1.15, 1.95, t, 0.06)
                    });
                } else if (category === 'snare') {
                    Object.assign(recipe, {
                        weight: 1.18,
                        level: vary(0.42, 0.8, t, 0.08),
                        toneFreq: vary(150, 290, t, 0.06),
                        overtone: vary(1.8, 3.6, t, 0.08),
                        metallic: vary(0.12, 0.42, t, 0.04),
                        noiseTone: vary(0.46, 0.95, t, 0.05),
                        click: vary(0.14, 0.34, t, 0.03),
                        attackSeconds: vary(0.001, 0.0025, t),
                        decaySeconds: vary(0.08, 0.22, t, 0.05),
                        durationSteps: vary(0.42, 0.84, t, 0.04),
                        drive: vary(1.18, 1.92, t, 0.04),
                        panWidth: vary(0.04, 0.18, t)
                    });
                } else if (category === 'clap') {
                    Object.assign(recipe, {
                        weight: 0.95,
                        level: vary(0.36, 0.74, t, 0.06),
                        toneFreq: vary(520, 1100, t, 0.06),
                        noiseTone: vary(0.52, 0.92, t, 0.04),
                        click: vary(0.18, 0.4, t, 0.04),
                        cluster: Math.round(vary(3, 5.6, t, 0.05)),
                        attackSeconds: vary(0.001, 0.0022, t),
                        decaySeconds: vary(0.07, 0.16, t, 0.03),
                        durationSteps: vary(0.36, 0.64, t, 0.04),
                        drive: vary(1.22, 1.86, t, 0.04),
                        panWidth: vary(0.16, 0.34, t)
                    });
                } else if (category === 'closedHat') {
                    Object.assign(recipe, {
                        weight: 1.24,
                        level: vary(0.18, 0.42, t, 0.04),
                        toneFreq: vary(3400, 7600, t, 0.05),
                        overtone: vary(1.21, 1.93, t, 0.03),
                        metallic: vary(0.52, 0.94, t, 0.06),
                        noiseTone: vary(0.38, 0.82, t, 0.05),
                        click: vary(0.06, 0.2, t, 0.03),
                        attackSeconds: vary(0.0005, 0.0015, t),
                        decaySeconds: vary(0.018, 0.06, t, 0.03),
                        durationSteps: vary(0.18, 0.42, t, 0.04),
                        drive: vary(1.08, 1.68, t, 0.04),
                        panWidth: vary(0.22, 0.72, t)
                    });
                } else if (category === 'openHat') {
                    Object.assign(recipe, {
                        weight: 0.76,
                        level: vary(0.16, 0.36, t, 0.04),
                        toneFreq: vary(3000, 6200, t, 0.04),
                        overtone: vary(1.32, 2.1, t, 0.04),
                        metallic: vary(0.68, 1.04, t, 0.04),
                        noiseTone: vary(0.42, 0.88, t, 0.05),
                        click: vary(0.02, 0.14, t, 0.02),
                        attackSeconds: vary(0.0005, 0.0013, t),
                        decaySeconds: vary(0.09, 0.22, t, 0.05),
                        durationSteps: vary(0.8, 1.45, t, 0.06),
                        drive: vary(1.04, 1.58, t, 0.04),
                        panWidth: vary(0.32, 0.84, t)
                    });
                } else if (category === 'cymbal') {
                    Object.assign(recipe, {
                        weight: 0.48,
                        level: vary(0.14, 0.3, t, 0.03),
                        toneFreq: vary(2600, 5200, t, 0.05),
                        overtone: vary(1.55, 2.45, t, 0.04),
                        metallic: vary(0.84, 1.2, t, 0.03),
                        noiseTone: vary(0.52, 0.94, t, 0.04),
                        click: vary(0.01, 0.1, t, 0.02),
                        attackSeconds: vary(0.0006, 0.0018, t),
                        decaySeconds: vary(0.18, 0.42, t, 0.05),
                        durationSteps: vary(1.2, 2.4, t, 0.05),
                        drive: vary(1.02, 1.44, t, 0.04),
                        panWidth: vary(0.34, 0.92, t)
                    });
                } else if (category === 'tom') {
                    Object.assign(recipe, {
                        weight: 0.88,
                        level: vary(0.32, 0.74, t, 0.07),
                        toneFreq: vary(92, 240, t, 0.07),
                        overtone: vary(1.12, 1.82, t, 0.04),
                        metallic: vary(0.04, 0.24, t, 0.03),
                        noiseTone: vary(0.05, 0.22, t, 0.03),
                        click: vary(0.04, 0.22, t, 0.03),
                        attackSeconds: vary(0.001, 0.0035, t),
                        decaySeconds: vary(0.11, 0.28, t, 0.04),
                        durationSteps: vary(0.46, 0.92, t, 0.04),
                        pitchDrop: vary(16, 42, t, 0.05),
                        dropRate: vary(8, 15, t, 0.04),
                        drive: vary(1.1, 1.72, t, 0.04),
                        panWidth: vary(0.16, 0.54, t)
                    });
                } else if (category === 'rim') {
                    Object.assign(recipe, {
                        weight: 0.7,
                        level: vary(0.18, 0.4, t, 0.04),
                        toneFreq: vary(680, 1800, t, 0.06),
                        overtone: vary(2.2, 4.4, t, 0.06),
                        metallic: vary(0.28, 0.64, t, 0.03),
                        noiseTone: vary(0.12, 0.32, t, 0.02),
                        click: vary(0.32, 0.62, t, 0.04),
                        attackSeconds: vary(0.0005, 0.0015, t),
                        decaySeconds: vary(0.02, 0.07, t, 0.03),
                        durationSteps: vary(0.16, 0.34, t, 0.02),
                        drive: vary(1.14, 1.74, t, 0.03),
                        panWidth: vary(0.18, 0.7, t)
                    });
                } else if (category === 'click') {
                    Object.assign(recipe, {
                        weight: 0.56,
                        level: vary(0.14, 0.3, t, 0.03),
                        toneFreq: vary(1200, 5200, t, 0.08),
                        overtone: vary(1.4, 5.1, t, 0.08),
                        metallic: vary(0.12, 0.48, t, 0.03),
                        noiseTone: vary(0.08, 0.26, t, 0.02),
                        click: vary(0.42, 0.86, t, 0.03),
                        attackSeconds: vary(0.0004, 0.0012, t),
                        decaySeconds: vary(0.01, 0.035, t, 0.02),
                        durationSteps: vary(0.08, 0.22, t, 0.02),
                        drive: vary(1.02, 1.52, t, 0.04),
                        panWidth: vary(0.18, 0.66, t)
                    });
                } else if (category === 'shaker') {
                    Object.assign(recipe, {
                        weight: 0.8,
                        level: vary(0.12, 0.26, t, 0.03),
                        toneFreq: vary(2400, 5400, t, 0.05),
                        overtone: vary(1.1, 1.75, t, 0.03),
                        metallic: vary(0.18, 0.42, t, 0.03),
                        noiseTone: vary(0.54, 0.96, t, 0.03),
                        click: vary(0.04, 0.16, t, 0.03),
                        cluster: Math.round(vary(4, 8, t, 0.05)),
                        attackSeconds: vary(0.0004, 0.0013, t),
                        decaySeconds: vary(0.03, 0.08, t, 0.02),
                        durationSteps: vary(0.18, 0.38, t, 0.03),
                        drive: vary(1.08, 1.46, t, 0.03),
                        panWidth: vary(0.28, 0.82, t)
                    });
                } else if (category === 'perc') {
                    Object.assign(recipe, {
                        weight: 0.84,
                        level: vary(0.24, 0.52, t, 0.04),
                        toneFreq: vary(180, 1200, t, 0.07),
                        overtone: vary(1.08, 2.84, t, 0.05),
                        metallic: vary(0.12, 0.58, t, 0.03),
                        noiseTone: vary(0.14, 0.52, t, 0.03),
                        click: vary(0.08, 0.32, t, 0.03),
                        attackSeconds: vary(0.0007, 0.0022, t),
                        decaySeconds: vary(0.04, 0.14, t, 0.03),
                        durationSteps: vary(0.22, 0.52, t, 0.03),
                        pitchDrop: vary(6, 26, t, 0.04),
                        dropRate: vary(10, 26, t, 0.04),
                        drive: vary(1.04, 1.64, t, 0.03),
                        panWidth: vary(0.18, 0.74, t)
                    });
                } else if (category === 'miscPerc') {
                    Object.assign(recipe, {
                        weight: 0.58,
                        level: vary(0.18, 0.42, t, 0.04),
                        toneFreq: vary(220, 2400, t, 0.08),
                        overtone: vary(1.2, 3.4, t, 0.05),
                        metallic: vary(0.16, 0.72, t, 0.04),
                        noiseTone: vary(0.1, 0.42, t, 0.03),
                        click: vary(0.1, 0.36, t, 0.03),
                        attackSeconds: vary(0.0006, 0.002, t),
                        decaySeconds: vary(0.03, 0.12, t, 0.03),
                        durationSteps: vary(0.18, 0.46, t, 0.03),
                        pitchDrop: vary(0, 18, t, 0.04),
                        dropRate: vary(6, 20, t, 0.04),
                        drive: vary(1.02, 1.52, t, 0.03),
                        panWidth: vary(0.24, 0.84, t)
                    });
                }

                palette.push(recipe);
            }
        });

        return palette;
    }

    const DRUM_SOUND_PALETTE = buildDrumSoundPalette();

    function generateDrumLoopBlueprint(options = {}) {
        // The groove templates are authored as one 16-step bar, so keep source-drum blueprints pinned to that grid.
        const stepCount = 16;
        const random = typeof options.random === 'function'
            ? options.random
            : createSeededRandom(options.seed ?? `mygrain-drum-${stepCount}`);
        const densityBias = clampNumber(options.densityBias, { min: 0, max: 1, fallback: 0.55 });
        const energy = clampNumber(options.energy, { min: 0.35, max: 1, fallback: 0.7 });
        const lowNoiseOnly = Boolean(options.lowNoiseOnly);
        const palette = DRUM_SOUND_PALETTE.map((recipe) => ({ ...recipe }));
        const groupedPalette = palette.reduce((groups, recipe) => {
            if (!groups[recipe.category]) groups[recipe.category] = [];
            groups[recipe.category].push(recipe);
            return groups;
        }, {});

        const grooveTemplates = {
            straight: {
                label: 'steady pocket',
                weight: 1.15,
                kick: [[0, 1, 1], [6, 0.32, 0.62], [8, 0.92, 0.84], [11, 0.24, 0.5], [14, 0.42, 0.64]],
                snare: [[4, 1, 0.96], [12, 1, 1], [15, 0.18, 0.44]],
                hats: 'eighths',
                perc: [[3, 0.16, 'rim'], [7, 0.24, 'shaker'], [10, 0.18, 'perc'], [15, 0.3, 'shaker']],
                fillChance: 0.22
            },
            pulsed: {
                label: 'pulsed groove',
                weight: 1.08,
                kick: [[0, 1, 1], [3, 0.24, 0.52], [6, 0.38, 0.62], [8, 0.78, 0.82], [10, 0.26, 0.46], [14, 0.56, 0.7]],
                snare: [[4, 1, 0.94], [12, 1, 1], [11, 0.14, 0.38], [15, 0.24, 0.46]],
                hats: 'busyOffbeats',
                perc: [[2, 0.24, 'shaker'], [7, 0.28, 'rim'], [10, 0.26, 'perc'], [13, 0.24, 'click'], [15, 0.34, 'shaker']],
                fillChance: 0.28
            },
            syncopated: {
                label: 'syncopated snap',
                weight: 1,
                kick: [[0, 1, 1], [3, 0.28, 0.56], [7, 0.24, 0.48], [8, 0.7, 0.74], [10, 0.34, 0.56], [14, 0.64, 0.72]],
                snare: [[4, 1, 0.9], [12, 1, 0.96], [15, 0.36, 0.42]],
                hats: 'brokenSixteenths',
                perc: [[1, 0.2, 'click'], [6, 0.22, 'shaker'], [9, 0.32, 'rim'], [11, 0.22, 'perc'], [13, 0.28, 'miscPerc']],
                fillChance: 0.34
            },
            sparse: {
                label: 'sparse anchors',
                weight: 0.82,
                kick: [[0, 1, 1], [8, 0.86, 0.76], [14, 0.28, 0.54]],
                snare: [[4, 1, 0.9], [12, 1, 0.95]],
                hats: 'offbeats',
                perc: [[7, 0.18, 'shaker'], [15, 0.22, 'rim']],
                fillChance: 0.18
            },
            rolling: {
                label: 'rolling hats',
                weight: 1.06,
                kick: [[0, 1, 1], [5, 0.26, 0.5], [8, 0.84, 0.8], [10, 0.22, 0.42], [13, 0.32, 0.54], [14, 0.46, 0.62]],
                snare: [[4, 1, 0.92], [12, 1, 0.96], [15, 0.22, 0.4]],
                hats: 'sixteenths',
                perc: [[2, 0.28, 'shaker'], [7, 0.18, 'rim'], [11, 0.26, 'click'], [15, 0.36, 'perc']],
                fillChance: 0.3
            },
            glitchFill: {
                label: 'fill-forward break',
                weight: 0.72,
                kick: [[0, 1, 1], [2, 0.18, 0.42], [6, 0.26, 0.52], [8, 0.74, 0.78], [11, 0.24, 0.46], [14, 0.68, 0.74], [15, 0.22, 0.4]],
                snare: [[4, 1, 0.9], [12, 1, 0.96], [14, 0.18, 0.36]],
                hats: 'brokenSixteenths',
                perc: [[1, 0.18, 'click'], [5, 0.22, 'perc'], [9, 0.28, 'shaker'], [13, 0.36, 'miscPerc'], [15, 0.42, 'rim']],
                fillChance: 0.42
            }
        };

        const archetypeId = grooveTemplates[options.archetype]
            ? options.archetype
            : pickWeighted(Object.keys(grooveTemplates).map((id) => ({ value: id, weight: grooveTemplates[id].weight })), random);
        const groove = grooveTemplates[archetypeId] || grooveTemplates.straight;
        const events = [];
        const occupied = new Set();

        function normalizedVelocity(base, accent = false, bonus = 0) {
            const velocity = clampNumber(base + (accent ? 0.12 : 0) + bonus + ((random() - 0.5) * 0.08), {
                min: 0.24,
                max: 1,
                fallback: 0.64
            });
            return Number(velocity.toFixed(3));
        }

        function chooseRecipe(categoryOptions) {
            const categories = Array.isArray(categoryOptions) ? categoryOptions : [categoryOptions];
            const candidates = categories.flatMap((category) => groupedPalette[category] || []);
            if (candidates.length === 0) return null;
            return pickWeighted(candidates.map((recipe) => {
                let weight = recipe.weight || 1;
                if (lowNoiseOnly) {
                    if (recipe.category === 'cymbal' || recipe.category === 'click') weight *= 0.45;
                    if (recipe.category === 'openHat') weight *= 0.72;
                    if (recipe.category === 'kick' || recipe.category === 'tom') weight *= 1.16;
                }
                if (energy > 0.82 && (recipe.category === 'closedHat' || recipe.category === 'openHat')) {
                    weight *= 1.08;
                }
                return { value: recipe, weight };
            }), random);
        }

        function addHit(step, categoryOptions, velocity, optionsForHit = {}) {
            if (!Number.isInteger(step) || step < 0 || step >= stepCount) return false;
            if (optionsForHit.probability !== undefined && random() > optionsForHit.probability) return false;
            const recipe = chooseRecipe(categoryOptions);
            if (!recipe) return false;
            const role = optionsForHit.role || recipe.category;
            const key = `${step}:${role}`;
            if (occupied.has(key) && !optionsForHit.allowLayer) return false;
            occupied.add(key);
            events.push({
                step,
                recipe,
                velocity: normalizedVelocity(velocity, Boolean(optionsForHit.accent), optionsForHit.velocityBonus || 0),
                accent: Boolean(optionsForHit.accent),
                role
            });
            return true;
        }

        groove.kick.forEach(([step, probability, velocity]) => {
            addHit(step, 'kick', velocity, { probability, accent: step === 0 || step === 8, role: 'kick' });
        });

        const backbeatRecipe = random() < 0.28 ? ['snare', 'clap'] : 'snare';
        groove.snare.forEach(([step, probability, velocity]) => {
            addHit(step, backbeatRecipe, velocity, { probability, accent: step === 4 || step === 12, role: 'snare' });
            if ((step === 4 || step === 12) && random() < 0.32) {
                addHit(step, 'clap', Math.max(0.42, velocity - 0.12), { allowLayer: true, probability: 1, role: 'clapLayer' });
            }
        });

        const hatModes = {
            offbeats(step) {
                return step % 2 === 1 ? 0.88 : (step % 4 === 0 ? 0.12 : 0);
            },
            eighths(step) {
                return step % 2 === 0 ? 0.72 : 0.92;
            },
            busyOffbeats(step) {
                return step % 2 === 1 ? 0.94 : (step % 4 === 0 ? 0.18 : 0.42);
            },
            sixteenths(step) {
                return step % 2 === 1 ? 0.96 : (step % 4 === 0 ? 0.44 : 0.68);
            },
            brokenSixteenths(step) {
                if (step === 4 || step === 12) return 0.28;
                return step % 2 === 1 ? 0.9 : ([2, 6, 10, 14].includes(step) ? 0.58 : 0.16);
            }
        };
        const hatMode = hatModes[groove.hats] || hatModes.eighths;

        for (let step = 0; step < stepCount; step += 1) {
            let probability = hatMode(step) * (0.76 + densityBias * 0.36);
            if (lowNoiseOnly) probability *= 0.84;
            if (step === 4 || step === 12) probability *= 0.72;
            const velocity = step % 4 === 0 ? 0.34 : (step % 2 === 1 ? 0.46 : 0.4);
            addHit(step, 'closedHat', velocity, {
                probability: Math.max(0, Math.min(0.98, probability)),
                accent: step % 2 === 1,
                role: 'hat'
            });
        }

        [7, 11, 15].forEach((step) => {
            let probability = 0.18 + (densityBias * 0.16) + (energy * 0.08);
            if (step === 15) probability += 0.08;
            if (lowNoiseOnly) probability *= 0.68;
            if (random() < probability) {
                addHit(step, random() < 0.72 ? 'openHat' : 'cymbal', 0.42 + (step === 15 ? 0.08 : 0), {
                    role: 'openHat',
                    accent: step === 15,
                    allowLayer: false
                });
            }
        });

        const percussionDensity = 0.18 + (densityBias * 0.24) + (energy * 0.08);
        groove.perc.forEach(([step, probability, category]) => {
            addHit(step, category, 0.32 + (probability * 0.2), {
                probability: Math.max(0, Math.min(0.9, probability + (percussionDensity - 0.24))),
                accent: step >= stepCount - 2,
                role: `${category}-${step}`
            });
        });

        if (random() < 0.22 + (densityBias * 0.2)) {
            const doubleSteps = [5, 6, 13, 14].filter((step) => step < stepCount);
            const step = doubleSteps[Math.floor(random() * doubleSteps.length)];
            addHit(step, random() < 0.5 ? 'kick' : 'closedHat', 0.48, {
                probability: 0.58,
                accent: false,
                role: `double-${step}`,
                allowLayer: false
            });
        }

        let fillApplied = false;
        const fillProbability = groove.fillChance + ((densityBias - 0.5) * 0.16);
        if (stepCount >= 16 && random() < fillProbability) {
            fillApplied = true;
            const fillStarts = [12, 13];
            const fillStart = fillStarts[Math.floor(random() * fillStarts.length)];
            for (let step = fillStart; step < stepCount; step += 1) {
                const fillCategory = step % 2 === 0 ? ['tom', 'snare'] : ['rim', 'perc', 'miscPerc'];
                addHit(step, fillCategory, 0.4 + ((step - fillStart) * 0.06), {
                    probability: step === stepCount - 1 ? 1 : 0.78,
                    accent: step >= stepCount - 2,
                    role: `fill-${step}`,
                    allowLayer: false
                });
            }
        }

        if (!events.some((event) => event.role === 'kick')) {
            addHit(0, 'kick', 0.92, { accent: true, role: 'kick' });
        }
        if (!events.some((event) => event.role === 'snare')) {
            addHit(Math.min(4, stepCount - 1), 'snare', 0.74, { accent: true, role: 'snare' });
            if (stepCount > 12) addHit(12, 'snare', 0.78, { accent: true, role: 'snare', allowLayer: false });
        }
        if (!events.some((event) => event.role === 'hat')) {
            [2, 6, 10, 14].filter((step) => step < stepCount).forEach((step) => {
                addHit(step, 'closedHat', 0.42, { probability: 1, role: 'hat' });
            });
        }

        events.sort((left, right) => {
            if (left.step !== right.step) return left.step - right.step;
            return left.recipe.category.localeCompare(right.recipe.category);
        });

        return {
            palette,
            paletteSize: palette.length,
            stepCount,
            archetype: archetypeId,
            grooveLabel: groove.label,
            fillApplied,
            events
        };
    }

    const exported = {
        buildDrumSoundPalette,
        buildKeyboardGeometry,
        clampNumber,
        createSeededRandom,
        generateDrumLoopBlueprint,
        generateRhythmicStepBlueprint,
        pickWeighted,
        recordingExtensionForMimeType,
        resolveLoopedPlayPosition,
        resolveSampleWindow,
        validatePreset
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = exported;
    }

    globalScope.MYGRAIN_UTILS = exported;
})(typeof window !== 'undefined' ? window : globalThis);
