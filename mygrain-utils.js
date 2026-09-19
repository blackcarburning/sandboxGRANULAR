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

    const exported = {
        buildKeyboardGeometry,
        clampNumber,
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
