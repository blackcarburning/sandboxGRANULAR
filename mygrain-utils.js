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

    const exported = {
        buildKeyboardGeometry,
        clampNumber,
        createSeededRandom,
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
