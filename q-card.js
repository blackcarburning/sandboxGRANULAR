(function (root) {
    'use strict';
    // Temporary shared section: map live sequencers and crop looping sources without touching saved patterns.
    const modulo = (value, length) => ((value % length) + length) % length;
    class Section {
        constructor(origin, start, duration) { Object.assign(this, { origin, start, duration }); }
        phase(time) { return modulo(Math.max(0, time - this.origin) + 1e-8, this.duration); }
        boundary(time) { return this.origin + (Math.floor(Math.max(0, time - this.origin) / this.duration + 1e-7) + 1) * this.duration; }
        position(time, step, count) { return Math.floor((this.start + this.phase(time)) / step + 1e-7) % count; }
        alignment(step) {
            const value = modulo(-this.start, step);
            return value < 1e-7 || step - value < 1e-7 ? 0 : value;
        }
        hasSteps(step) { return this.alignment(step) < this.duration - 1e-7; }
        grid(earliest, step, count) {
            if (!this.hasSteps(step)) return { time: Infinity, index: 0, elapsedSteps: 0 };
            let cycle = Math.max(0, Math.floor((earliest - this.origin) / this.duration + 1e-7));
            const alignment = this.alignment(step);
            let offset = alignment + Math.max(0, Math.ceil((earliest - this.origin - cycle * this.duration - alignment) / step - 1e-7)) * step;
            if (offset >= this.duration - 1e-7) { cycle += 1; offset = alignment; }
            const time = this.origin + cycle * this.duration + offset;
            return { time, index: this.position(time, step, count), elapsedSteps: Math.floor((this.start + offset) / step + 1e-7) };
        }
        next(time, step) {
            if (!this.hasSteps(step)) return Infinity;
            const boundary = this.boundary(time);
            return time + step < boundary - 1e-7 ? time + step : boundary + this.alignment(step);
        }
        buffer(context, source, offset) {
            const original = source.buffer, rate = source.playbackRate.value;
            const first = Math.round(source.loopStart * original.sampleRate);
            const last = Math.min(original.length, Math.round((source.loopEnd || original.duration) * original.sampleRate));
            const span = Math.max(1, last - first), start = Math.round(offset * original.sampleRate);
            const frames = Math.max(1, Math.round(this.duration * rate * original.sampleRate));
            const result = context.createBuffer(original.numberOfChannels, frames, original.sampleRate);
            for (let channel = 0; channel < result.numberOfChannels; channel += 1) {
                const input = original.getChannelData(channel), output = result.getChannelData(channel);
                const fade = Math.min(Math.floor(frames / 4), Math.round(original.sampleRate * rate * .002));
                for (let frame = 0; frame < frames; frame += 1) {
                    const envelope = fade ? Math.min(1, frame / fade, (frames - 1 - frame) / fade) : 1;
                    output[frame] = input[first + modulo(start - first + frame, span)] * envelope;
                }
            }
            source.buffer = result; source.loopStart = 0; source.loopEnd = result.duration;
            return 0;
        }
    }
    if (typeof module === 'object' && module.exports) module.exports = { Section };
    root.MygrainPatternSection = { Section };
    if (!root.document) return;
    const api = {
        active: null,
        lanes() {
            return [[bastardLoopSource, startBastardLoop], [bastardLoop2Source, startBastardLoop2],
                [bastardLoop3Source, startBastardLoop3], [bastardLoopVSource, startBastardLoopV],
                [bastardLoopPSource, startBastardLoopP], [bastardLoopOSource, startBastardLoopO],
                [bastardLoopMSource, startBastardLoopM], [bastardLoopMPlusSource, startBastardLoopMPlus],
                [bastardLoopKSource, startBastardLoopK], [dropboxSampleLayerSource, startDropboxSampleLayer]];
        },
        capture() {
            const shared = sequencerPlaying || drumMachinePlaying || bastardLoopPlaying || bastardLoopLTransportActive || bastardLoopXTransportActive || isArpeggiatorPlaying();
            const origin = !shared && root.mygrainQ?.running ? root.mygrainQ.origin : getSharedLoopTransportOriginTime();
            return { origin, sequencer: sequencerPlaying, drums: drumMachinePlaying,
                loops: bastardLoopPlaying, lead: bastardLoopLTransportActive, bass: bastardLoopXTransportActive,
                q: Boolean(root.mygrainQ?.running), arp: isArpeggiatorPlaying(),
                lanes: this.lanes().map(([source]) => Boolean(source)) };
        },
        stop() { this.active = null; stopAllPerformancePlayback({ silent: true }); },
        start(index, steps, rate) {
            const step = 60 / sequencerBPM / 4 / rate;
            const deadline = getBufferedTransportStartTime();
            this.active = new Section(deadline, index * step, steps * step);
            try {
                withBufferedTransportStart(deadline, time => {
                    this.active.origin = time;
                    if (arpEnabled && holdEnabled) { keyboardArpTransportPlaying = true; startArpeggiatorPlayback(time); }
                    else startSequencer(time);
                    startAllBastardLoopLayers(time, { skipUi: true });
                    syncPerformanceControlState();
                }, { reset: true, origin: deadline - index * step, exactStart: true });
                return this.active.origin;
            } catch (error) { this.stop(); throw error; }
        },
        restore(saved) {
            if (!saved || (!saved.lanes.some(Boolean) && !Object.entries(saved).some(([key, value]) => key !== 'origin' && value === true))) return;
            withBufferedTransportStart(null, time => {
                if (saved.sequencer) startSequencer(time);
                this.lanes().forEach(([, start], index) => { if (saved.lanes[index]) start(time, { skipUi: true }); });
                if (saved.lead) startBastardLoopL(time, { skipUi: true });
                if (saved.bass) startBastardLoopX(time, { skipUi: true });
                if (saved.q) startTransportChordLayer(time, saved.origin ?? time);
                bastardLoopPlaying = saved.loops;
                bastardLoopTransportStartTime = saved.loops ? saved.origin ?? time : null;
                if (saved.drums) startDrumMachine(time, { silent: true, skipSave: true, ensureAudible: false });
                if (saved.arp) { keyboardArpTransportPlaying = true; startArpeggiatorPlayback(time); }
            }, { reset: true, origin: saved.origin });
            syncPerformanceControlState();
        },
        position(time, step, count, fallback) { return this.active ? this.active.position(time, step, count) : fallback; },
        next(time, step) { return this.active ? this.active.next(time, step) : time + step; }
    };
    root.mygrainPatternSection = api;
})(typeof window !== 'undefined' ? window : globalThis);

(function (root) {
    'use strict';

    const theory = root.MygrainQTheory || (typeof require === 'function' ? require('./q-theory.js') : null);
    const bankLimit = 96 * 1024 * 1024;
    const keyboardPianoRepository = 'SAMPLES_Q_KEYBOARD/';
    const keyboardPianoId = 'salamander-v3-k-mp3-44100-v1';
    const instrumentCalibrationGain = Object.freeze({ piano: .60, strings: 1.30 });

    class Piano {
        constructor(host) {
            this.host = host;
            this.instrument = 'piano';
            this.manifest = null;
            this.catalogPending = null;
            this.pending = new Map();
            this.cache = new Map();
            this.atlas = null;
            this.bank = null;
            this.pinned = false;
            this.generation = 0;
        }

        select(instrument) {
            if (!Object.hasOwn(theory.instruments, instrument)) throw new Error('Unknown Q instrument.');
            if (this.instrument === instrument) return;
            this.instrument = instrument;
            this.manifest = null;
            this.restored(null, null);
        }

        sample(samples, midi, velocity) {
            const sample = samples?.find(item => item.midi === theory.sampleMidi(midi, this.instrument) && item.velocity === theory.sampleVelocity(velocity, this.instrument));
            if (!sample) throw new Error('Q bank is missing a required pitch or velocity layer.');
            return sample;
        }

        async catalog() {
            if (!this.manifest) {
                if (this.catalogPending) return this.catalogPending;
                const generation = this.generation;
                const specification = theory.instruments[this.instrument];
                const pending = (async () => {
                    const response = await fetch(`${specification.repository}manifest.json`, { cache: 'no-cache' });
                    if (!response.ok) throw new Error(`The local Q ${specification.label} repository is unavailable.`);
                    const manifest = await response.json();
                    if (generation !== this.generation) throw new DOMException('Q sample loading cancelled.', 'AbortError');
                    if (manifest.id !== specification.id || manifest.samples?.length !== specification.count || manifest.samples.some(sample => {
                        const identity = theory.sampleIdentity(sample.id, this.instrument);
                        return !identity || sample.file !== `samples/${sample.id}.wav` || sample.midi !== identity.midi || sample.velocity !== identity.velocity || !/^[a-f0-9]{64}$/.test(sample.sha256) || (this.instrument === 'strings' && (!Number.isInteger(sample.loopStart) || !Number.isInteger(sample.loopEnd) || sample.loopStart < 1 || sample.loopEnd <= sample.loopStart || sample.loopEnd > sample.frames));
                    }) || new Set(manifest.samples.map(sample => sample.id)).size !== specification.count) throw new Error('The local Q sample manifest is invalid.');
                    this.manifest = manifest;
                    return manifest;
                })();
                this.catalogPending = pending;
                try { return await pending; }
                finally { if (this.catalogPending === pending) this.catalogPending = null; }
            }
            return this.manifest;
        }

        async load(sample) {
            if (this.cache.has(sample.id)) return this.cache.get(sample.id);
            if (this.pinned) throw new Error('The saved Q bank is incomplete. No phone-local instrument will be substituted.');
            if (!this.pending.has(sample.id)) {
                const generation = this.generation;
                this.pending.set(sample.id, (async () => {
                    const buffer = await this.decode(sample);
                    if (generation !== this.generation) throw new DOMException('Q sample loading cancelled.', 'AbortError');
                    this.cache.set(sample.id, buffer);
                    return buffer;
                })());
            }
            const pending = this.pending.get(sample.id);
            try { return await pending; }
            finally { if (this.pending.get(sample.id) === pending) this.pending.delete(sample.id); }
        }

        async decode(sample, repository = theory.instruments[this.instrument].repository, fallback = null) {
            const response = await fetch(`${repository}${sample.file}`, { cache: 'force-cache' });
            if (!response.ok) throw new Error(`Could not load Q sample ${sample.id}.`);
            const bytes = await response.arrayBuffer();
            const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
            if (digest !== sample.sha256) throw new Error(`Q sample integrity check failed: ${sample.id}.`);
            const context = this.host.context();
            if (!context) throw new Error('Start MYGRAIN before loading Q samples.');
            try {
                const buffer = await context.decodeAudioData(bytes);
                if (buffer.numberOfChannels !== 2 || !Number.isFinite(buffer.duration) || Math.abs(buffer.duration - sample.frames / sample.sampleRate) > .001) throw new Error(`Q sample dimensions are invalid: ${sample.id}.`);
                return buffer;
            } catch (error) {
                if (fallback) return fallback();
                throw error;
            }
        }

        restored(buffer, bank) {
            if (buffer && bank && (bank.instrument ?? theory.instruments.piano.id) !== theory.instruments[this.instrument].id) throw new Error('Q instrument and saved audio do not match. No other instrument will be substituted.');
            this.generation += 1;
            this.catalogPending = null;
            this.pending.clear();
            this.cache.clear();
            this.atlas = buffer;
            this.bank = bank ? theory.copy(bank) : null;
            this.pinned = Boolean(buffer && bank);
        }

        segment(midi, velocity) {
            if (!this.atlas || !this.bank?.samples?.length) return null;
            const sample = this.bank.samples.find(item => item.midi === theory.sampleMidi(midi, this.instrument) && item.velocity === theory.sampleVelocity(velocity, this.instrument));
            if (!sample) return null;
            const ratio = this.atlas.sampleRate / this.bank.sampleRate;
            return { sample, buffer: this.atlas, offset: Math.round(sample.offset * ratio) / this.atlas.sampleRate, duration: Math.round(sample.frames * ratio) / this.atlas.sampleRate, loopStart: sample.loopStart / this.bank.sampleRate, loopEnd: sample.loopEnd / this.bank.sampleRate };
        }

        async ensure(events) {
            const generation = this.generation;
            const requests = events.flatMap(event => event.notes.map(midi => ({ midi, velocity: event.sampleVelocity ?? event.velocity })));
            if (!requests.length || requests.every(request => this.segment(request.midi, request.velocity))) return;
            if (this.pinned) throw new Error('The saved Q bank is missing required samples. No cached or repository audio will be substituted.');
            const manifest = await this.catalog();
            if (generation !== this.generation) throw new DOMException('Q sample loading cancelled.', 'AbortError');
            const samples = [...new Map(requests.map(request => {
                const sample = this.sample(manifest.samples, request.midi, request.velocity);
                return [sample.id, sample];
            })).values()];
            const context = this.host.context();
            const requiredBytes = samples.reduce((bytes, sample) => bytes + Math.ceil(sample.frames * context.sampleRate / sample.sampleRate) * 8, 0);
            if (requiredBytes > bankLimit) throw new Error('Q needs more than 96 MB of decoded audio. Use fewer pitches/velocity layers in this part.');
            let next = 0;
            await Promise.all(Array.from({ length: Math.min(3, samples.length) }, async () => {
                while (next < samples.length) {
                    if (generation !== this.generation) throw new DOMException('Q sample loading cancelled.', 'AbortError');
                    await this.load(samples[next++]);
                }
            }));
            if (generation !== this.generation) throw new DOMException('Q sample loading cancelled.', 'AbortError');
            const keep = new Set(samples.map(sample => sample.id));
            let bytes = [...this.cache.values()].reduce((total, buffer) => total + buffer.length * buffer.numberOfChannels * 4, 0);
            for (const [id, buffer] of this.cache) {
                if (bytes <= bankLimit || keep.has(id)) continue;
                this.cache.delete(id);
                bytes -= buffer.length * buffer.numberOfChannels * 4;
            }
        }

        source(midi, velocity) {
            const embedded = this.segment(midi, velocity);
            if (embedded) return embedded;
            if (this.pinned) throw new Error('Saved Q audio is missing; playback was stopped.');
            const sample = this.sample(this.manifest?.samples, midi, velocity);
            const buffer = this.cache.get(sample.id);
            if (!buffer) throw new Error('Load the Q samples before playback.');
            return { sample, buffer, offset: 0, duration: buffer.duration, loopStart: sample.loopStart / sample.sampleRate, loopEnd: sample.loopEnd / sample.sampleRate };
        }

        async capture(state) {
            const sequence = state.sequence.filter(step => step?.notes?.length && !step.rest).map(step => ({ notes: theory.transposed(step.notes, state.transpose), velocity: theory.effectiveVelocity(state, step) }));
            if (!sequence.length) {
                this.atlas = null;
                this.bank = null;
                return;
            }
            await this.ensure(sequence);
            const sources = new Map();
            for (const event of sequence) for (const midi of event.notes) {
                const source = this.source(midi, event.velocity);
                sources.set(source.sample.id, source);
            }
            const context = this.host.context();
            const padding = Math.ceil(context.sampleRate * .02);
            const frames = [...sources.values()].reduce((total, source) => total + Math.round(source.duration * context.sampleRate) + padding, 0);
            if (frames * 8 > bankLimit) throw new Error('Q sample bank exceeds 96 MB of decoded audio. Use fewer pitches/velocity layers in this part.');
            const atlas = context.createBuffer(2, frames, context.sampleRate);
            const samples = [];
            let offset = 0;
            for (const source of sources.values()) {
                const start = Math.round(source.offset * context.sampleRate);
                const length = Math.round(source.duration * context.sampleRate);
                for (let channel = 0; channel < 2; channel += 1) atlas.getChannelData(channel).set(source.buffer.getChannelData(channel).subarray(start, start + length), offset);
                samples.push({ id: source.sample.id, midi: source.sample.midi, velocity: source.sample.velocity, offset, frames: length, ...(this.instrument === 'strings' ? { loopStart: Math.round(source.loopStart * context.sampleRate), loopEnd: Math.round(source.loopEnd * context.sampleRate) } : {}) });
                offset += length + padding;
            }
            this.atlas = atlas;
            const provenance = this.manifest || this.bank;
            this.bank = this.instrument === 'strings' ? {
                version: 1, instrument: theory.instruments.strings.id, sampleRate: context.sampleRate, samples,
                ...Object.fromEntries(['credit', 'license', 'licenseUrl', 'source', 'changes'].map(key => [key, provenance[key]]))
            } : {
                version: 1, instrument: theory.instruments.piano.id, sampleRate: context.sampleRate, samples,
                credit: 'Salamander Grand Piano V3 by Alexander Holm', license: 'CC BY 3.0',
                licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
                source: 'https://github.com/sfzinstruments/SalamanderGrandPiano/tree/3382bf9496bba2486f5ab0de55a264d1dfc38404',
                changes: 'Velocity layers 4/8/12/16; FLAC converted to stereo PCM16 at 44.1 kHz, then resampled to the audio-context rate and packed into a portable bank. No trimming or normalization of source recordings. No endorsement implied.'
            };
        }
    }

    class KeyboardPiano extends Piano {
        restored(buffer, bank) {
            super.restored(buffer, bank);
            this.keyboardCatalogPending = null;
        }

        async keyboardCatalog() {
            if (this.keyboardManifest) return this.keyboardManifest;
            if (this.keyboardCatalogPending) return this.keyboardCatalogPending;
            const generation = this.generation;
            const pending = (async () => {
                const original = await this.catalog();
                const response = await fetch(`${keyboardPianoRepository}catalog.json`, { cache: 'no-cache' });
                if (!response.ok) throw new Error('The local keyboard piano repository is unavailable.');
                const manifest = await response.json();
                if (generation !== this.generation) throw new DOMException('Q sample loading cancelled.', 'AbortError');
                const sources = new Map(original.samples.map(sample => [sample.id, sample]));
                if (manifest.version !== 1 || manifest.id !== keyboardPianoId || manifest.sourceId !== original.id || manifest.revision !== original.revision || manifest.codec !== 'mp3' || !Array.isArray(manifest.samples) || manifest.samples.length !== sources.size || manifest.samples.some(sample => {
                    const source = sources.get(sample.id);
                    return !source || sample.file !== `samples/${sample.id}.mp3` || sample.midi !== source.midi || sample.velocity !== source.velocity || sample.frames !== source.frames || sample.sampleRate !== source.sampleRate || sample.channels !== 2 || sample.sourceSha256 !== source.sha256 || !/^[a-f0-9]{64}$/.test(sample.sha256) || !Number.isInteger(sample.bytes) || sample.bytes <= 0 || sample.bytes >= source.bytes;
                }) || new Set(manifest.samples.map(sample => sample.id)).size !== sources.size) throw new Error('The local keyboard piano manifest is invalid.');
                this.keyboardManifest = manifest;
                return manifest;
            })();
            this.keyboardCatalogPending = pending;
            try { return await pending; }
            finally { if (this.keyboardCatalogPending === pending) this.keyboardCatalogPending = null; }
        }

        async decode(sample) {
            if (this.instrument !== 'piano') return super.decode(sample);
            const manifest = await this.keyboardCatalog();
            const derivative = manifest.samples.find(candidate => candidate.id === sample.id);
            return super.decode(derivative, keyboardPianoRepository, () => super.decode(sample));
        }
    }

    class KeyboardPlayer {
        constructor(host) {
            this.host = host;
            this.voices = new Map();
            this.activeVoices = new Set();
            this.pending = new Map();
            this.samplers = new Map(['piano', 'strings'].map(instrument => {
                const piano = instrument === 'piano' ? new KeyboardPiano(host) : new Piano(host);
                piano.select(instrument);
                return [instrument, { piano, queue: new Set(), loading: 0 }];
            }));
        }

        get metrics() {
            return { voices: this.activeVoices.size, pending: this.pending.size, cachedBytes: [...this.samplers.values()].reduce((total, entry) => total + [...entry.piano.cache.values()].reduce((bytes, buffer) => bytes + buffer.length * buffer.numberOfChannels * 4, 0), 0) };
        }

        noteOn(key, midi, options = {}) {
            return this.request(key, midi, options, false);
        }

        prepare(instrument, midi = 60, velocity = 100) {
            return this.request(Symbol('prepare'), midi, { instrument, velocity }, true);
        }

        cachedSource(entry, midi, velocity) {
            const embedded = entry.piano.segment(midi, velocity);
            if (embedded) return embedded;
            if (entry.piano.pinned || !entry.piano.manifest) return null;
            const sample = entry.piano.sample(entry.piano.manifest.samples, midi, velocity);
            const buffer = entry.piano.cache.get(sample.id);
            if (!buffer) return null;
            entry.piano.cache.delete(sample.id);
            entry.piano.cache.set(sample.id, buffer);
            return entry.piano.source(midi, velocity);
        }

        async request(key, midi, options, preparing) {
            const instrument = options.instrument ?? 'piano';
            if (!this.samplers.has(instrument)) throw new Error('Unknown Q keyboard instrument.');
            if (!Number.isFinite(Number(midi))) return null;
            const context = this.host.context();
            if (!context || context.state === 'closed') return null;
            this.noteOff(key, { immediate: true });
            const entry = this.samplers.get(instrument);
            const pitch = theory.clamp(midi, 0, 127, 60);
            const settings = { ...options, instrument, velocity: theory.clamp(options.velocity, 1, 127, 100) };
            const selected = this.cachedSource(entry, pitch, settings.velocity);
            if (selected && (!context.state || context.state === 'running')) {
                this.trimCaches(selected.buffer);
                return preparing ? selected : this.startVoice({ context, key, midi: pitch, options: settings }, selected);
            }
            while (this.pending.size >= 64) this.cancel(this.pending.values().next().value);
            return new Promise((resolve, reject) => {
                const request = { key, midi: pitch, options: settings, preparing, context, entry, resolve, reject };
                this.pending.set(key, request);
                entry.queue.add(request);
                this.drain(entry);
            });
        }

        cancel(request) {
            if (this.pending.get(request.key) === request) this.pending.delete(request.key);
            request.entry.queue.delete(request);
            request.resolve(null);
        }

        drain(entry) {
            while (entry.loading < 3 && entry.queue.size) {
                const request = [...entry.queue].find(candidate => !candidate.preparing) || entry.queue.values().next().value;
                entry.queue.delete(request);
                entry.loading += 1;
                void this.loadRequest(request);
            }
        }

        async loadRequest(request) {
            const entry = request.entry;
            try {
                if (request.context.state && request.context.state !== 'running') {
                    await request.context.resume();
                }
                if (this.pending.get(request.key) !== request) return;
                let selected = this.cachedSource(entry, request.midi, request.options.velocity);
                if (!selected) {
                    await entry.piano.ensure([{ notes: [request.midi], velocity: request.options.velocity }]);
                    selected = entry.piano.source(request.midi, request.options.velocity);
                }
                this.trimCaches(selected.buffer);
                if (this.pending.get(request.key) !== request) return;
                const running = !request.context.state || request.context.state === 'running';
                const result = request.context === this.host.context() && running ? (request.preparing ? selected : this.startVoice(request, selected)) : null;
                this.pending.delete(request.key);
                request.resolve(result);
            } catch (error) {
                this.trimCaches();
                if (this.pending.get(request.key) !== request) return;
                this.pending.delete(request.key);
                request.reject(error);
            } finally {
                entry.loading -= 1;
                this.drain(entry);
            }
        }

        trimCaches(keep) {
            let bytes = this.metrics.cachedBytes;
            for (const entry of this.samplers.values()) for (const [id, buffer] of entry.piano.cache) {
                if (bytes <= bankLimit) return;
                if (buffer === keep) continue;
                entry.piano.cache.delete(id);
                bytes -= buffer.length * buffer.numberOfChannels * 4;
            }
        }

        startVoice(request, selected) {
            const { context, key, midi, options } = request;
            const output = this.host.output(options.instrument);
            if (!output) return null;
            const duration = Number.isFinite(options.duration) ? Math.max(.006, options.duration) : Infinity;
            const scheduled = Number.isFinite(options.startTime) ? options.startTime : context.currentTime;
            if (scheduled + duration <= context.currentTime) return null;
            while (this.activeVoices.size >= 64) this.removeVoice(this.activeVoices.values().next().value, true);
            const start = Math.max(context.currentTime + .001, scheduled);
            const looped = options.instrument === 'strings';
            const release = looped ? .25 : .16;
            const rate = 2 ** ((midi - selected.sample.midi) / 12);
            const end = looped ? start + duration + release : start + Math.min(duration + release, selected.duration / rate);
            const peak = (looped ? options.velocity / 127 : Math.sqrt(options.velocity / 127)) * instrumentCalibrationGain[options.instrument] * theory.clamp(options.volume, 0, 4, 1);
            const source = context.createBufferSource();
            const gain = context.createGain();
            const mixGain = this.host.volume ? context.createGain() : null;
            const voice = { key, source, gain, mixGain, context, instrument: options.instrument, midi, velocity: options.velocity, start, end, release, peak, attackEnd: start + Math.min(looped ? .012 : .004, (end - start) / 2), releaseStart: Number.isFinite(end) ? Math.max(start, end - release) : Infinity, released: false };
            try {
                source.buffer = selected.buffer;
                source.playbackRate.value = rate;
                if (looped) {
                    source.loop = true;
                    source.loopStart = selected.offset + selected.loopStart;
                    source.loopEnd = selected.offset + selected.loopEnd;
                }
                source.connect(gain);
                if (mixGain) {
                    mixGain.gain.value = theory.clamp(this.host.volume(options.instrument), 0, 1, 1);
                    gain.connect(mixGain);
                }
                const voiceOutput = mixGain || gain;
                voiceOutput.connect(output);
                const capture = this.host.capture?.();
                if (capture && capture !== output) voiceOutput.connect(capture);
                gain.gain.setValueAtTime(0, start);
                gain.gain.linearRampToValueAtTime(peak, voice.attackEnd);
                if (Number.isFinite(end)) {
                    voice.releaseStart = Math.max(voice.attackEnd, voice.releaseStart);
                    gain.gain.setValueAtTime(peak, voice.releaseStart);
                    gain.gain.linearRampToValueAtTime(0, end);
                }
                this.voices.set(key, voice);
                this.activeVoices.add(voice);
                source.onended = () => this.removeVoice(voice);
                source.start(start, selected.offset);
                if (Number.isFinite(end)) source.stop(end);
                return voice;
            } catch (error) {
                this.removeVoice(voice, true);
                throw error;
            }
        }

        refreshVolumes() {
            for (const voice of this.activeVoices) {
                if (!voice.mixGain) continue;
                const now = voice.context.currentTime;
                const parameter = voice.mixGain.gain;
                const volume = theory.clamp(this.host.volume(voice.instrument), 0, 1, 1);
                parameter.cancelScheduledValues(now);
                parameter.setValueAtTime(parameter.value, now);
                parameter.linearRampToValueAtTime(volume, now + .015);
            }
        }

        noteOff(key, { immediate = false } = {}) {
            const request = this.pending.get(key);
            if (request) this.cancel(request);
            const voice = this.voices.get(key);
            if (!voice) return;
            if (immediate || voice.context.currentTime <= voice.start) {
                this.removeVoice(voice, true);
                return;
            }
            if (voice.released) return;
            voice.released = true;
            const now = voice.context.currentTime;
            const parameter = voice.gain.gain;
            const current = now < voice.attackEnd ? voice.peak * Math.max(0, now - voice.start) / (voice.attackEnd - voice.start) : now > voice.releaseStart ? voice.peak * Math.max(0, voice.end - now) / (voice.end - voice.releaseStart) : voice.peak;
            voice.end = Math.min(voice.end, now + voice.release);
            parameter.cancelScheduledValues(now);
            parameter.setValueAtTime(current, now);
            parameter.linearRampToValueAtTime(0, voice.end);
            voice.source.stop(voice.end);
        }

        removeVoice(voice, stop = false) {
            if (this.voices.get(voice.key) === voice) this.voices.delete(voice.key);
            this.activeVoices.delete(voice);
            voice.source.onended = null;
            if (stop) { try { voice.source.stop(); } catch (error) {} }
            try { voice.source.disconnect(); } catch (error) {}
            try { voice.gain.disconnect(); } catch (error) {}
            try { voice.mixGain?.disconnect(); } catch (error) {}
        }

        stop() {
            for (const request of this.pending.values()) this.cancel(request);
            for (const voice of this.activeVoices) this.removeVoice(voice, true);
        }
    }

    class ChordEditor {
        constructor(owner) {
            this.owner = owner;
            this.loopSteps = 16;
            this.selected = 0;
            this.request = 0;
            this.mutedNotes = new Set();
            this.soloSelected = false;
        }

        step() { return this.owner.state.sequence[this.index]; }
        status(message, error = false) {
            const label = this.overlay?.querySelector('#qChordEditorStatus');
            if (label) { label.textContent = message; label.classList.toggle('q-error', error); }
        }
        task(action) { return Promise.resolve().then(action).catch(error => { if (error.name !== 'AbortError') this.status(error.message, true); }); }

        mount() {
            const overlay = document.createElement('div');
            overlay.id = 'qChordEditorOverlay';
            overlay.className = 'sample-browser-overlay';
            overlay.hidden = true;
            overlay.setAttribute('aria-hidden', 'true');
            overlay.innerHTML = `<section class="q-chord-editor-shell" role="dialog" aria-modal="true" aria-labelledby="qChordEditorTitle">
                <header class="sample-browser-head"><div><h3 id="qChordEditorTitle">Q · Individual chord</h3><div id="qChordEditorName" aria-live="polite"></div></div><button type="button" id="qChordEditorClose">Close</button></header>
                <p class="q-chord-editor-help">Drag notes or use ↑ / ↓. Solo Note isolates the selected note in this chord only; the rest of the loop keeps playing. Double-click / double-tap to mute or unmute. Close clears mutes and solo. Delete Note is permanent; Undo restores it.</p>
                <div class="q-chord-editor-tools" aria-label="Note and whole-chord editing">
                    <button type="button" data-q-note-action="down">Note ↓</button><button type="button" data-q-note-action="up">Note ↑</button>
                    <button type="button" data-q-note-action="chord-down">Chord −</button><button type="button" data-q-note-action="chord-up">Chord +</button>
                    <button type="button" data-q-note-action="solo" aria-pressed="false" title="Solo the selected note in this chord only; other chords and instruments keep playing">Solo Note</button>
                    <button type="button" data-q-note-action="delete">Delete Note</button>
                </div>
                <div id="qChordEditorNotes" class="q-chord-pitch-scroll" role="listbox" aria-label="Individual chord notes; Up and Down move the selected note"><div class="q-chord-pitch-roll"><div class="q-chord-pitch-labels" aria-hidden="true"></div><div class="q-chord-pitch-notes"></div></div></div>
                <div class="q-chord-loop-controls"><label for="qChordLoopSteps">Loop steps<input type="number" id="qChordLoopSteps" min="1" max="256" step="1" inputmode="numeric" value="16"></label><button type="button" id="qChordLoopToggle">Start loop</button><span id="qChordLoopPosition"></span></div>
                <p id="qChordEditorStatus" role="status">The whole pattern loops over this section. Saved pattern lengths stay unchanged.</p>
            </section>`;
            document.body.append(overlay);
            this.overlay = overlay;
            this.scroller = overlay.querySelector('#qChordEditorNotes');
            const labels = overlay.querySelector('.q-chord-pitch-labels');
            for (let pitch = 108; pitch >= 21; pitch -= 1) {
                const row = document.createElement('div');
                row.className = 'q-chord-pitch-row';
                row.classList.toggle('q-chord-black-key', [1, 3, 6, 8, 10].includes(pitch % 12));
                row.textContent = theory.noteName(pitch);
                labels.append(row);
            }
            overlay.querySelector('#qChordEditorClose').addEventListener('click', () => this.close());
            overlay.querySelector('#qChordLoopToggle').addEventListener('click', () => this.preview?.running || this.loading ? this.stopLoop() : this.task(() => this.startLoop()));
            const length = overlay.querySelector('#qChordLoopSteps');
            const applyLength = () => {
                const value = Number(length.value);
                if (!Number.isInteger(value) || value < 1 || value > 256) { length.value = String(this.loopSteps); this.status('Choose a loop length from 1 to 256 steps.', true); return; }
                if (value === this.loopSteps) return;
                this.loopSteps = value;
                if (this.preview?.running || this.loading) this.task(() => this.startLoop());
                this.syncLoop();
            };
            length.addEventListener('change', applyLength);
            length.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); applyLength(); } });
            overlay.addEventListener('click', event => {
                const button = event.target.closest('[data-q-note-action]');
                if (button) this.task(() => this.move(button.dataset.qNoteAction));
                const note = event.target.closest('[data-q-note-index]');
                if (note) this.selectNote(Number(note.dataset.qNoteIndex));
                if (event.target === overlay) this.close();
            });
            overlay.addEventListener('keydown', event => {
                event.stopPropagation();
                if (event.key === 'Escape') { event.preventDefault(); this.close(); return; }
                if (['Delete', 'Backspace'].includes(event.key) && !event.target.matches('input, select, textarea')) {
                    event.preventDefault(); this.task(() => this.deleteNote()); return;
                }
                if (['ArrowUp', 'ArrowDown'].includes(event.key) && !event.target.matches('input, select, textarea')) {
                    event.preventDefault(); this.task(() => this.move(event.key === 'ArrowUp' ? 'up' : 'down')); return;
                }
                if (['ArrowLeft', 'ArrowRight'].includes(event.key) && !event.target.matches('input, select, textarea')) {
                    event.preventDefault();
                    this.selectNote((this.selected + (event.key === 'ArrowRight' ? 1 : this.step().notes.length - 1)) % this.step().notes.length);
                    this.overlay.querySelector(`[data-q-note-index="${this.selected}"]`).focus({ preventScroll: true });
                    this.revealSelected();
                }
                if (event.key === 'Tab') {
                    const controls = [...overlay.querySelectorAll('button, input')].filter(node => !node.disabled && node.getClientRects().length);
                    if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1).focus(); }
                    if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
                }
            });
            this.scroller.addEventListener('pointerdown', event => {
                const note = event.target.closest('[data-q-note-index]');
                if (!note || event.button !== 0 || this.drag) return;
                event.preventDefault();
                this.selectNote(Number(note.dataset.qNoteIndex));
                this.drag = { pointer: event.pointerId, note, index: this.selected, x: event.clientX, y: event.clientY, scroll: this.scroller.scrollTop, notes: this.step().notes.slice(), draft: this.step().notes.slice() };
                note.setPointerCapture(event.pointerId);
                note.focus({ preventScroll: true });
                this.render();
            });
            this.scroller.addEventListener('pointermove', event => {
                const drag = this.drag;
                if (!drag || drag.pointer !== event.pointerId) return;
                event.preventDefault();
                if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 10) drag.moved = true;
                const bounds = this.scroller.getBoundingClientRect();
                if (event.clientY < bounds.top + 24) this.scroller.scrollTop -= 14;
                if (event.clientY > bounds.bottom - 24) this.scroller.scrollTop += 14;
                const movement = Math.round((drag.y - event.clientY - this.scroller.scrollTop + drag.scroll) / this.rowHeight());
                const transpose = this.owner.state.transpose;
                drag.draft[this.selected] = Math.round(theory.clamp(drag.notes[this.selected] + movement, Math.max(21, 21 - transpose), Math.min(108, 108 - transpose), drag.notes[this.selected]));
                this.render();
            });
            const release = event => {
                const drag = this.drag;
                if (!drag || drag.pointer !== event.pointerId) return;
                this.drag = null;
                if (drag.note.hasPointerCapture(event.pointerId)) drag.note.releasePointerCapture(event.pointerId);
                if (event.type === 'pointerup' && drag.notes.join(',') !== drag.draft.join(',')) {
                    this.lastNoteTap = null;
                    this.task(() => this.commit(drag.draft, drag.draft[this.selected]));
                } else {
                    this.render();
                    // Pointer releases also work on Safari where prevented touch
                    // gestures do not reliably produce native dblclick events.
                    if (event.type !== 'pointerup' || drag.moved || Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 10) { this.lastNoteTap = null; return; }
                    if (this.lastNoteTap?.index === drag.index && event.timeStamp - this.lastNoteTap.time < 500) {
                        this.lastNoteTap = null;
                        this.task(() => this.toggleMute(drag.index));
                    } else this.lastNoteTap = { index: drag.index, time: event.timeStamp };
                }
            };
            for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) this.scroller.addEventListener(type, release);
            this.scroller.addEventListener('dblclick', event => event.preventDefault());
            root.addEventListener('blur', () => this.cancelDrag());
            root.addEventListener('resize', () => this.syncViewport());
            root.visualViewport?.addEventListener('resize', () => this.syncViewport());
            root.visualViewport?.addEventListener('scroll', () => this.syncViewport());
            document.addEventListener('visibilitychange', () => { if (document.hidden && this.opened) { this.cancelDrag(); this.resume = null; this.resumeTransport = null; this.stopLoop(); } });
        }

        rowHeight() { return this.overlay.querySelector('.q-chord-pitch-row').getBoundingClientRect().height || 28; }
        revealSelected() {
            const note = this.overlay.querySelector(`[data-q-note-index="${this.selected}"]`);
            if (!note) return;
            const box = note.getBoundingClientRect(), bounds = this.scroller.getBoundingClientRect();
            if (box.top < bounds.top + 2) this.scroller.scrollTop -= bounds.top + 2 - box.top;
            else if (box.bottom > bounds.bottom - 2) this.scroller.scrollTop += box.bottom - bounds.bottom + 2;
        }
        syncViewport() {
            if (!this.opened) return;
            const view = root.visualViewport;
            for (const [key, value] of Object.entries({ top: view?.offsetTop || 0, left: view?.offsetLeft || 0, width: view?.width || root.innerWidth, height: view?.height || root.innerHeight })) this.overlay.style.setProperty(`--q-chord-${key}`, `${value}px`);
        }
        cancelDrag() {
            const drag = this.drag;
            this.drag = null;
            this.lastNoteTap = null;
            if (drag?.note.hasPointerCapture(drag.pointer)) drag.note.releasePointerCapture(drag.pointer);
            if (this.opened) this.render();
        }
        async open(index) {
            if (this.opened && this.index === index) return;
            if (!this.owner.state.sequence[index]?.notes?.length || this.owner.state.sequence[index].rest) return;
            if (root.mygrainSongBeta?.busy || root.mygrainSongBeta?.playing || root.mygrainSongBeta?.editing || root.mygrainCardHistory?.busy || root.mygrainAiPatch?.busy) throw new Error('Finish the current Song, AI or Undo/Redo operation before editing a chord.');
            if (this.opened) this.close({ resume: false });
            this.index = index;
            this.mutedNotes = new Set();
            this.soloSelected = false;
            this.lastNoteTap = null;
            this.owner.lastChordTouch = null;
            this.selected = 0;
            this.owner.cursor = index;
            this.resumeTransport = root.mygrainPatternSection?.capture();
            this.resume = this.owner.running ? { origin: Number.isFinite(this.owner.origin) ? this.owner.origin : (this.owner.host.context()?.currentTime || 0) + .06, shared: Number.isFinite(this.owner.host.transportOrigin?.()) } : null;
            this.pausingOwner = true;
            try { if (root.mygrainPatternSection) root.mygrainPatternSection.stop(); else this.owner.stop(); } finally { this.pausingOwner = false; }
            this.opened = true;
            this.overlay.hidden = false;
            this.overlay.setAttribute('aria-hidden', 'false');
            document.body.classList.add('q-individual-chord-open');
            this.overlay.querySelector('#qChordLoopSteps').value = String(this.loopSteps);
            this.syncViewport();
            this.render();
            const middle = this.step().notes[Math.floor(this.step().notes.length / 2)];
            this.scroller.scrollTop = (108 - middle) * this.rowHeight() - this.scroller.clientHeight / 2;
            this.overlay.querySelector('[data-q-note-index="0"]').focus({ preventScroll: true });
            await this.task(() => this.startLoop());
        }
        close(options = {}) {
            if (!this.opened) return;
            this.opened = false;
            this.cancelDrag();
            this.mutedNotes = new Set();
            this.soloSelected = false;
            this.owner.lastChordTouch = null;
            this.stopLoop();
            this.overlay.hidden = true;
            this.overlay.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('q-individual-chord-open');
            root.guardSectionJumpAfterOverlayClose?.();
            const resume = this.resume, transport = this.resumeTransport;
            this.resume = null;
            this.resumeTransport = null;
            this.owner.sync();
            document.querySelector(`#bastardLoopQStepGrid [data-q-step="${this.index}"]`)?.focus({ preventScroll: true });
            if (options.resume !== false && transport) root.mygrainPatternSection.restore(transport);
            else if (options.resume !== false && resume && this.owner.state.enabled && (!resume.shared || Number.isFinite(this.owner.host.transportOrigin?.()))) this.owner.start(resume.origin);
        }
        onOwnerStop() {
            if (!this.opened || this.pausingOwner) return;
            this.resume = null;
            this.resumeTransport = null;
            this.stopLoop();
        }
        stopLoop() {
            this.request += 1;
            this.loading = false;
            this.preview?.stop();
            this.pausingOwner = true;
            try { root.mygrainPatternSection?.stop(); } finally { this.pausingOwner = false; }
            this.syncLoop();
        }
        createPreview() {
            const owner = this.owner;
            const preview = new Controller({ ...owner.host, length: () => this.loopSteps, save() {} });
            preview.piano = owner.piano;
            preview.sync = () => {};
            preview.syncTransport = () => this.syncLoop();
            preview.status = message => this.status(message);
            preview.reflectPlaying = () => {};
            preview.updatePlayhead = position => this.syncLoop(position);
            const timeline = preview.timeline.bind(preview);
            let source, muted, solo, filtered;
            preview.timeline = () => {
                const events = timeline();
                const soloPitch = this.soloSelected ? this.step()?.notes[this.selected] : null;
                if (source !== events || muted !== this.mutedNotes || solo !== soloPitch) {
                    source = events;
                    muted = this.mutedNotes;
                    solo = soloPitch;
                    // Filter the edited source cell only (including repeats of
                    // that cell), after ARP expansion so its rhythm is retained.
                    // Empty events retain the clock even with every note muted.
                    // Solo overrides temporary mutes without discarding them.
                    filtered = muted.size || solo !== null ? events.map(event => event.index % owner.length() === 0
                        ? { ...event, notes: event.notes.filter(pitch => solo !== null ? pitch - preview.state.transpose === solo : !muted.has(pitch - preview.state.transpose)) } : event) : events;
                }
                return filtered;
            };
            const voice = preview.voice.bind(preview);
            preview.voice = (pitch, velocity, start, duration, options = {}) => {
                const stepSeconds = 60 / owner.host.bpm() / 4 / preview.state.rate;
                const cycle = Math.floor((start - preview.origin) / (stepSeconds * this.loopSteps) + .000001);
                const remaining = preview.origin + (cycle + 1) * this.loopSteps * stepSeconds - Math.max(start, owner.host.context().currentTime + .001);
                const release = Math.min(options.releaseSeconds ?? (preview.state.instrument === 'strings' ? .25 : .16), remaining / 4);
                return voice(pitch, velocity, start, Math.min(duration, Math.max(.001, remaining - release)), { ...options, releaseSeconds: release });
            };
            return preview;
        }
        async startLoop() {
            this.stopLoop();
            if (!this.opened) return;
            const request = this.request;
            this.loading = true;
            this.syncLoop();
            this.status('Loading the chord edit loop…');
            try {
                await this.owner.ready();
                if (!this.opened || request !== this.request) return;
                const state = theory.chordEditLoop(this.owner.state, this.owner.length(), this.index, this.loopSteps);
                await this.owner.piano.ensure(theory.events(state, this.loopSteps));
                if (!this.opened || request !== this.request) return;
                this.preview ||= this.createPreview();
                this.preview.state = state;
                const origin = root.mygrainPatternSection ? root.mygrainPatternSection.start(this.index, this.loopSteps, state.rate) : this.owner.host.context().currentTime + .06;
                this.preview.start(origin);
                this.status(`Looping the whole pattern from Q step ${this.index + 1} for ${this.loopSteps} steps. ${this.soloSelected ? `Solo Note: ${theory.noteName(this.step().notes[this.selected])} in this chord only; all other chords and instruments keep playing.` : 'Changes use this same sound and effects; Undo restores prior notes.'}`);
            } finally {
                if (request === this.request) { this.loading = false; this.syncLoop(); }
            }
        }
        syncLoop(position) {
            if (!this.overlay) return;
            const playing = this.preview?.running === true;
            const button = this.overlay.querySelector('#qChordLoopToggle');
            button.textContent = playing || this.loading ? 'Stop loop' : 'Start loop';
            button.classList.toggle('q-chord-loop-playing', playing || this.loading);
            button.setAttribute('aria-pressed', String(playing));
            const end = (this.index + this.loopSteps - 1) % this.owner.length();
            this.overlay.querySelector('#qChordLoopPosition').textContent = `From ${this.index + 1} · ${this.loopSteps} steps · last ${end + 1}${Number.isInteger(position) && playing ? ` · Q step ${(this.index + position) % this.owner.length() + 1}` : ''}`;
        }
        render() {
            if (!this.opened) return;
            const step = this.step();
            if (!step?.notes?.length || step.rest) { this.close({ resume: false }); return; }
            const pitches = this.drag?.draft || step.notes;
            const name = theory.identifyChord(pitches, step.root).name;
            this.overlay.querySelector('#qChordEditorTitle').textContent = `Q · Chord at step ${this.index + 1}`;
            this.overlay.querySelector('#qChordEditorName').textContent = name + (this.owner.state.transpose ? ` · sounds as ${theory.identifyChord(theory.transposed(pitches, this.owner.state.transpose)).name}` : '');
            const soloButton = this.overlay.querySelector('[data-q-note-action="solo"]');
            soloButton.textContent = this.soloSelected ? 'Unsolo Note' : 'Solo Note';
            soloButton.setAttribute('aria-pressed', String(this.soloSelected));
            const notes = this.overlay.querySelector('.q-chord-pitch-notes');
            if (notes.children.length !== pitches.length) {
                notes.replaceChildren();
                for (let index = 0; index < pitches.length; index += 1) {
                    const button = document.createElement('button');
                    button.type = 'button'; button.dataset.qNoteIndex = String(index); button.setAttribute('role', 'option'); notes.append(button);
                }
            }
            for (const [index, note] of [...notes.children].entries()) {
                const soloed = this.soloSelected && index === this.selected;
                const muted = this.soloSelected ? !soloed : this.mutedNotes.has(step.notes[index]);
                note.textContent = theory.noteName(pitches[index]);
                note.classList.toggle('q-chord-note-muted', muted);
                note.classList.toggle('q-chord-note-soloed', soloed);
                note.style.top = `${(108 - pitches[index]) * this.rowHeight()}px`;
                note.style.left = `${index * 100 / pitches.length}%`;
                note.style.width = `${100 / pitches.length}%`;
                note.setAttribute('aria-selected', String(this.selected === index));
                note.setAttribute('aria-label', `${theory.noteName(pitches[index])}, voice ${index + 1}${soloed ? ', soloed in this chord only' : muted ? ', muted' : ''}; double-click toggles temporary mute; Up or Down changes pitch; Delete removes note`);
                note.title = this.soloSelected ? soloed ? 'Soloed in this chord only · Unsolo Note restores temporary mutes' : 'Silenced by Solo Note · select this note to solo it instead' : muted ? 'Muted until Close · double-click / double-tap to unmute' : 'Double-click / double-tap to mute until Close';
                note.tabIndex = this.selected === index ? 0 : -1;
            }
        }
        selectNote(index) {
            if (!this.opened || !Number.isInteger(this.step()?.notes[index])) return;
            const changed = this.selected !== index;
            this.selected = index;
            this.render();
            if (changed && this.soloSelected && (this.preview?.running || this.loading)) this.task(() => this.startLoop());
        }
        async toggleSolo() {
            if (!this.opened || this.drag) return;
            this.soloSelected = !this.soloSelected;
            this.lastNoteTap = null;
            this.render();
            if (this.preview?.running || this.loading) await this.startLoop();
            this.status(this.soloSelected ? `${theory.noteName(this.step().notes[this.selected])} soloed in this chord only. Other chords and instruments keep playing; Close clears solo.` : 'Note solo off. Previous temporary note mutes restored; the rest of the loop is unchanged.');
        }
        toggleMute(index) {
            if (!this.opened || this.drag) return;
            const pitch = this.step().notes[index];
            if (!Number.isInteger(pitch)) return;
            const muted = new Set(this.mutedNotes);
            if (muted.has(pitch)) muted.delete(pitch); else muted.add(pitch);
            this.mutedNotes = muted;
            this.render();
            this.status(`${theory.noteName(pitch)} ${muted.has(pitch) ? 'muted' : 'unmuted'} for audition only. ${this.soloSelected ? 'Solo Note overrides mutes until switched off.' : 'Close unmutes all notes; saved notes are unchanged.'}`);
            if (this.preview?.running || this.loading) return this.startLoop();
        }
        deleteNote() {
            if (!this.opened || this.drag) return;
            if (root.mygrainCardHistory?.busy) throw new Error('Wait for Undo/Redo to finish before deleting a note.');
            const pitches = this.step().notes;
            this.lastNoteTap = null;
            if (pitches.length > 1) {
                const indices = pitches.map((_, index) => index).filter(index => index !== this.selected);
                const remaining = indices.map(index => pitches[index]);
                return this.commit(remaining, remaining[Math.min(this.selected, remaining.length - 1)], indices);
            }
            const edit = () => {
                this.owner.state.sequence[this.index] = null;
                this.owner.state.selection = null;
                this.close();
                this.owner.changed();
            };
            if (root.mygrainCardHistory) root.mygrainCardHistory.run('Q delete last note', edit); else edit();
            this.owner.status('Last note deleted; chord removed. Undo restores it.');
        }
        commit(pitches, selectedPitch, sourceIndices = pitches.map((_, index) => index)) {
            if (!this.opened) return;
            try {
                if (root.mygrainCardHistory?.busy) throw new Error('Wait for Undo/Redo to finish before editing a note.');
                const replacement = theory.editChordNotes(this.step(), pitches, this.owner.state.transpose);
                if (this.step().notes.join(',') === replacement.notes.join(',')) { this.render(); return; }
                const focusNote = document.activeElement?.matches('[data-q-note-index]');
                const muted = new Set(pitches.filter((_, index) => this.mutedNotes.has(this.step().notes[sourceIndices[index]])));
                const edit = () => {
                    this.owner.state.sequence[this.index] = replacement;
                    this.owner.state.selection = theory.copy(replacement);
                    this.owner.changed({ reschedule: false });
                };
                if (root.mygrainCardHistory) root.mygrainCardHistory.run(pitches.length < this.step().notes.length ? 'Q delete note' : 'Q chord notes', edit); else edit();
                this.mutedNotes = muted;
                this.lastNoteTap = null;
                this.selected = Math.max(0, replacement.notes.indexOf(selectedPitch));
                this.render();
                if (focusNote) this.overlay.querySelector(`[data-q-note-index="${this.selected}"]`)?.focus({ preventScroll: true });
                this.revealSelected();
                this.status(`${theory.identifyChord(replacement.notes, replacement.root).name} · saved. Undo restores the previous voicing.`);
                if (this.preview?.running || this.loading) return this.startLoop();
            } catch (error) { this.render(); throw error; }
        }
        move(action) {
            if (!this.opened || this.drag) return;
            if (action === 'solo') return this.toggleSolo();
            if (action === 'delete') return this.deleteNote();
            const step = this.step(), delta = action.endsWith('down') ? -1 : 1;
            const pitches = step.notes.map((pitch, index) => pitch + (action.startsWith('chord-') || index === this.selected ? delta : 0));
            return this.commit(pitches, pitches[this.selected]);
        }
    }

    class Controller {
        constructor(host) {
            this.host = host;
            this.state = theory.defaults();
            this.piano = new Piano(host);
            this.scales = [{ name: 'major', intervals: [0, 2, 4, 5, 7, 9, 11] }, { name: 'minor', intervals: [0, 2, 3, 5, 7, 8, 10] }];
            this.cursor = 0;
            this.range = null;
            this.mark = null;
            this.clipboard = null;
            this.arpClipboard = null;
            this.voices = new Set();
            this.running = false;
            this.generation = 0;
            this.graph = null;
            this.timer = null;
            this.nextCycle = 0;
            this.nextEvent = 0;
        }

        length() { return this.host.length(); }
        getState() { return { ...theory.copy(this.state), bank: theory.copy(this.piano.bank) }; }
        getAudioBuffer() { return this.piano.atlas; }
        setAudioBuffer(buffer) { this.piano.restored(buffer, this.state.bank); }
        hasSequence() { return this.state.sequence.slice(0, this.length()).some(step => step?.notes?.length && !step.rest); }
        liveRecording() { return this.state.record && this.state.recordMode === 'live'; }
        playable() { return this.state.enabled && (this.hasSequence() || this.liveRecording()); }
        hasAudio() { return this.running || Boolean(this.preview) || this.voices.size > 0 || this.chordEditor?.preview?.hasAudio() || (this.host.context()?.currentTime || 0) < (this.tailUntil || 0); }

        setEnabled(enabled, options = {}) {
            this.state.enabled = Boolean(enabled);
            if (!this.state.enabled) this.stop();
            this.updateEffects();
            this.sync();
            if (!options.skipSave) this.host.save();
        }

        restore(state, options = {}) {
            this.chordEditor?.close({ resume: false });
            this.stop();
            this.state = theory.normalizeState(state);
            this.piano.select(this.state.instrument);
            this.range = null;
            this.mark = null;
            this.cursor = 0;
            this.paletteFingerprint = null;
            this.gridFingerprint = null;
            this.piano.pinned = false;
            if (!options.keepAudio) this.piano.restored(null, null);
            this.sync();
        }

        async setInstrument(instrument) {
            if (!Object.hasOwn(theory.instruments, instrument)) throw new Error('Unknown Q instrument.');
            if (this.state.instrument === instrument) return;
            const origin = this.running ? this.origin ?? this.host.context().currentTime : null;
            const preview = this.preview?.chord;
            this.stop();
            const generation = this.generation;
            this.piano.select(instrument);
            this.state.instrument = instrument;
            this.state.bank = null;
            this.changed({ preserveSamples: true, reschedule: false });
            this.status(`${theory.instruments[instrument].label} selected. Samples load on demand.`);
            if (origin !== null) {
                await this.preparePlayback();
                if (generation === this.generation) this.start(origin);
            } else if (preview) await this.audition(preview);
        }

        status(message, error = false) {
            for (const id of ['performanceBastardLoopQMeta', 'bastardLoopQStatus']) {
                const element = document.getElementById(id);
                if (!element) continue;
                element.textContent = message;
                element.classList.toggle('q-error', error);
            }
        }

        async task(action) {
            try { await action(); }
            catch (error) { if (error.name !== 'AbortError') this.status(error.message, true); }
        }

        changed(options = {}) {
            if (options.reschedule !== false) this.editRevision = (this.editRevision || 0) + 1;
            const revision = this.editRevision || 0;
            if (!options.preserveSamples) {
                this.piano.pinned = false;
                this.state.bank = null;
            }
            this.host.save();
            this.sync();
            this.updateEffects();
            const now = this.host.context()?.currentTime;
            for (const voice of this.voices) if (voice.preview && !voice.grid && voice.end > now) {
                voice.accentBoost = this.preview?.chord.accent ? 1 + 2 * this.state.accentAmount : 1;
                this.applyVoiceEnvelope(voice, this.state, Math.max(now, voice.start));
            }
            if (this.running && options.reschedule !== false) {
                const generation = this.generation;
                const state = theory.copy(this.state);
                this.task(async () => {
                    await this.piano.ensure(theory.events(state, this.length()));
                    if (generation !== this.generation || revision !== this.editRevision) return;
                    this.playbackState = state;
                    const now = this.host.context().currentTime;
                    for (const voice of this.voices) if (voice.grid && voice.end > now) this.applyVoiceEnvelope(voice, state, Math.max(now, voice.start));
                    if (options.live) {
                        for (const voice of [...this.voices]) if (!voice.preview && voice.start > now) this.removeVoice(voice, true);
                        this.seek(now + .001);
                        this.tick();
                    } else this.seek(now + .12);
                });
            }
        }

        async ready() {
            if (!await this.host.ready()) throw new Error('Start MYGRAIN before using Q.');
            return true;
        }

        async prepareCapture() {
            const serialized = JSON.stringify(this.state);
            await this.piano.capture(this.state);
            if (JSON.stringify(this.state) !== serialized) throw new Error('Q changed while its samples were being captured. Save the part again.');
            this.state.bank = theory.copy(this.piano.bank);
        }

        async preparePlayback() {
            await this.ready();
            this.status(`Loading the ${theory.instruments[this.state.instrument].label} notes needed by this sequence…`);
            const events = theory.events(this.state, this.length());
            if (!events.length) {
                const chord = this.selectedChord();
                events.push({ notes: theory.transposed(chord.notes, this.state.transpose), velocity: this.state.velocity });
            }
            await this.piano.ensure(events);
            this.status(`Local multisample ${theory.instruments[this.state.instrument].label} ready.`);
        }

        ensureGraph() {
            const context = this.host.context();
            const destination = this.host.destination();
            if (this.graph?.context === context && this.graph.destination === destination) return this.graph;
            if (this.graph) for (const node of this.graph.nodes) { try { node.disconnect(); } catch (error) {} }
            const input = context.createGain();
            const highpass = context.createBiquadFilter();
            const lowpass = context.createBiquadFilter();
            highpass.type = 'highpass';
            lowpass.type = 'lowpass';
            highpass.Q.value = .707;
            lowpass.Q.value = .707;
            const dry = context.createGain();
            const delay = context.createDelay(12);
            const feedback = context.createGain();
            const delayWet = context.createGain();
            const convolver = context.createConvolver();
            const roomWet = context.createGain();
            const level = context.createGain();
            const pan = context.createStereoPanner();
            const impulse = context.createBuffer(2, Math.round(context.sampleRate * 1.1), context.sampleRate);
            let random = 19800517;
            for (let channel = 0; channel < 2; channel += 1) {
                const samples = impulse.getChannelData(channel);
                for (let index = 0; index < samples.length; index += 1) {
                    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
                    samples[index] = (random / 2147483648 - 1) * Math.exp(-7 * index / samples.length) * .3;
                }
            }
            convolver.normalize = true;
            convolver.buffer = impulse;
            input.connect(highpass).connect(lowpass);
            lowpass.connect(dry).connect(level);
            lowpass.connect(delay);
            delay.connect(feedback).connect(delay);
            delay.connect(delayWet).connect(level);
            lowpass.connect(convolver).connect(roomWet).connect(level);
            level.connect(pan).connect(destination);
            const nodes = [input, highpass, lowpass, dry, delay, feedback, delayWet, convolver, roomWet, level, pan];
            this.graph = { context, destination, input, highpass, lowpass, dry, delay, feedback, delayWet, convolver, roomWet, level, pan, nodes };
            this.updateEffects();
            return this.graph;
        }

        updateEffects() {
            const graph = this.graph;
            if (!graph || graph.context.state === 'closed') return;
            const now = graph.context.currentTime;
            const targets = [[graph.highpass.frequency, this.state.highpass], [graph.lowpass.frequency, Math.min(this.state.lowpass, graph.context.sampleRate * .45)],
                [graph.delay.delayTime, Math.min(11, 60 / this.host.bpm() * this.state.delayBeats)], [graph.feedback.gain, this.state.feedback],
                [graph.delayWet.gain, this.state.delay * .65], [graph.roomWet.gain, this.state.room * .8],
                [graph.level.gain, this.state.enabled || (this.auditioning && this.hasAudio()) ? this.state.level * this.host.soloGain() : 0], [graph.pan.pan, this.state.pan]];
            for (const [parameter, value] of targets) {
                parameter.cancelScheduledValues(now);
                parameter.setTargetAtTime(value, now, .015);
            }
        }

        voice(pitch, velocity, start, duration, options = {}) {
            const context = this.host.context();
            const graph = this.ensureGraph();
            const selected = this.piano.source(pitch, velocity);
            const rate = 2 ** ((pitch - selected.sample.midi) / 12);
            const when = Math.max(context.currentTime + .001, start);
            const looped = this.state.instrument === 'strings';
            const release = Math.min(looped ? .25 : .16, options.releaseSeconds ?? Infinity);
            const end = when + (looped ? duration + release : Math.min(duration + release, selected.duration / rate - .001));
            if (end <= when + .004) return;
            while (this.voices.size >= 64) this.removeVoice(this.voices.values().next().value, true);
            const source = context.createBufferSource();
            const gain = context.createGain();
            source.buffer = selected.buffer;
            source.playbackRate.value = rate;
            if (looped) {
                source.loop = true;
                source.loopStart = selected.offset + selected.loopStart;
                source.loopEnd = selected.offset + selected.loopEnd;
            }
            const baseVelocity = options.baseVelocity ?? velocity;
            const peak = (looped ? baseVelocity / 127 : Math.sqrt(baseVelocity / 127)) * instrumentCalibrationGain[this.state.instrument];
            source.connect(gain).connect(graph.input);
            const voice = { source, gain, start: when, end, fullDuration: end - when, fullRelease: release, pitch, velocity, peak, release, grid: options.grid === true, stepSeconds: options.stepSeconds, accentBoost: options.accentBoost ?? 1, preview: options.preview === true };
            this.applyVoiceEnvelope(voice, this.playbackState || this.state);
            this.voices.add(voice);
            const tail = Math.max(this.state.room > 0 ? 1.1 : 0, this.state.delay > 0 ? Math.min(8, 60 / this.host.bpm() * this.state.delayBeats * Math.log(.001) / Math.log(Math.max(.01, this.state.feedback))) : 0);
            this.tailUntil = Math.max(this.tailUntil || 0, voice.end + tail);
            if (this.voices.size === 1 && !this.running) this.host.activity?.();
            source.onended = () => this.removeVoice(voice);
            source.start(when, selected.offset);
            voice.started = true;
            source.stop(voice.end);
        }

        applyVoiceEnvelope(voice, state, from = voice.start) {
            voice.fullDuration ??= voice.end - voice.start;
            voice.fullRelease ??= voice.release;
            const shape = theory.sampleEnvelope(state, voice.fullDuration, voice.fullRelease);
            voice.end = voice.start + shape.duration;
            voice.release = shape.release;
            if (voice.started && voice.end <= from) {
                voice.end = from + .006;
                const parameter = voice.gain.gain;
                parameter.cancelScheduledValues(from);
                parameter.setValueAtTime(parameter.value, from);
                parameter.linearRampToValueAtTime(0, voice.end);
                voice.source.stop(voice.end);
                return;
            }
            const { start, end, peak, release } = voice;
            const attack = Math.min(.003, (end - start) / 3);
            const releaseStart = Math.max(start + attack, end - release);
            const baseAt = time => time < start + attack ? peak * Math.max(0, (time - start) / attack)
                : shape.fading ? peak * Math.max(0, (end - time) / (end - start - attack))
                    : time > releaseStart ? peak * Math.max(0, (end - time) / (end - releaseStart)) : peak;
            const cellAt = time => (time - this.origin) / voice.stepSeconds;
            const multiplierAt = time => voice.grid ? theory.accentGain(state, cellAt(time), this.length()) : voice.accentBoost ?? 1;
            const points = new Map([[start + attack, null], [releaseStart, null], [end, 0]]);
            if (voice.grid) {
                for (let cell = Math.floor(cellAt(start)) + 1; this.origin + cell * voice.stepSeconds < end; cell += 1) {
                    const boundary = this.origin + cell * voice.stepSeconds;
                    const before = Math.max(start + attack, boundary - Math.min(.003, voice.stepSeconds / 4));
                    if (before < boundary) points.set(before, baseAt(before) * theory.accentGain(state, cell - 1, this.length()));
                    points.set(boundary, baseAt(boundary) * theory.accentGain(state, cell, this.length()));
                }
            }
            const parameter = voice.gain.gain;
            parameter.cancelScheduledValues(from);
            parameter.setValueAtTime(baseAt(from) * multiplierAt(from), from);
            for (const [time, value] of [...points].sort(([first], [second]) => first - second)) {
                if (time > from) parameter.linearRampToValueAtTime(value ?? baseAt(time) * multiplierAt(time), time);
            }
            if (voice.started) voice.source.stop(end);
        }

        removeVoice(voice, stop = false) {
            if (!voice) return;
            voice.source.onended = null;
            if (stop) { try { voice.source.stop(); } catch (error) {} }
            voice.source.disconnect();
            voice.gain.disconnect();
            this.voices.delete(voice);
            if (this.voices.size === 0 && !this.running) this.host.activity?.();
        }

        stopPreview() {
            this.auditioning = false;
            this.previewToken = (this.previewToken || 0) + 1;
            clearInterval(this.previewTimer);
            this.previewTimer = null;
            this.preview = null;
            for (const voice of [...this.voices]) if (voice.preview) this.removeVoice(voice, true);
            this.updateEffects();
            this.reflectPlaying();
            this.host.activity?.();
        }

        stop() {
            this.chordEditor?.onOwnerStop();
            this.generation += 1;
            this.running = false;
            this.stopPreview();
            this.tailUntil = 0;
            this.lastStepSeconds = 0;
            clearInterval(this.timer);
            this.timer = null;
            for (const voice of [...this.voices]) this.removeVoice(voice, true);
            if (this.graph) {
                for (const node of this.graph.nodes) { try { node.disconnect(); } catch (error) {} }
                this.graph = null;
            }
            this.syncTransport();
            this.reflectPlaying();
            this.host.activity?.();
        }

        start(startTime) {
            if (!this.playable()) return false;
            this.stop();
            const generation = this.generation;
            this.running = true;
            this.host.activity?.();
            const begin = () => {
                if (generation !== this.generation || !this.running) return;
                this.ensureGraph();
                this.origin = startTime;
                this.playbackState = theory.copy(this.state);
                this.nextCycle = 0;
                this.nextEvent = 0;
                const stepSeconds = 60 / this.host.bpm() / 4 / this.state.rate;
                if (this.host.context().currentTime > startTime) this.nextCycle = Math.floor((this.host.context().currentTime - startTime) / (stepSeconds * this.length()));
                this.tick();
                this.timer = setInterval(() => {
                    try { this.tick(); }
                    catch (error) { this.stop(); this.status(error.message, true); }
                }, 25);
                this.syncTransport();
            };
            const sequence = theory.events(this.state, this.length());
            if (sequence.every(event => event.notes.every(pitch => {
                try { this.piano.source(pitch, event.sampleVelocity ?? event.velocity); return true; } catch (error) { return false; }
            }))) begin();
            else this.task(async () => {
                this.status(`Preparing Q ${theory.instruments[this.state.instrument].label}…`);
                try { await this.piano.ensure(sequence); begin(); }
                catch (error) { if (generation === this.generation) this.stop(); throw error; }
            });
            return true;
        }

        tick() {
            if (!this.running) return;
            const context = this.host.context();
            if (!context || context.state !== 'running') { this.stop(); return; }
            const state = this.playbackState || this.state;
            const sequence = this.timeline();
            const stepSeconds = 60 / this.host.bpm() / 4 / state.rate;
            if (this.lastStepSeconds && this.lastStepSeconds !== stepSeconds) this.seek(context.currentTime + .12);
            this.lastStepSeconds = stepSeconds;
            const horizon = context.currentTime + .12;
            let count = 0;
            while (sequence.length && count++ < 512) {
                if (this.nextEvent >= sequence.length) { this.nextCycle += 1; this.nextEvent = 0; }
                const event = sequence[this.nextEvent];
                const when = this.origin + (this.nextCycle * this.length() + event.start) * stepSeconds;
                if (when > horizon) break;
                this.nextEvent += 1;
                if (when < context.currentTime - .02) continue;
                for (const pitch of event.notes) this.voice(pitch, event.sampleVelocity ?? event.velocity, when, event.gate * stepSeconds, { grid: true, stepSeconds, baseVelocity: state.sequence[event.index].velocity, releaseSeconds: state.arpEnabled && state.arpPattern === 'custom' ? event.gate * stepSeconds / 4 : undefined });
            }
            const position = Math.floor(Math.max(0, context.currentTime - this.origin) / stepSeconds) % this.length();
            this.updatePlayhead(position);
            if (this.liveRecording() && !document.hidden && document.getElementById('bastardLoopQOverlay')?.hidden === false && this.livePlayheadPosition !== position) {
                this.livePlayheadPosition = position;
                const label = document.getElementById('bastardLoopQStepCursor');
                if (label) label.textContent = `Live playhead ${position + 1} / ${this.length()} · Selected ${this.cursor + 1} · Rate ×${this.state.rate}`;
                this.revealCursor(position);
            }
            this.reflectPlaying(context.currentTime);
            this.updateEffects();
        }

        timeline() {
            const state = this.playbackState || this.state;
            if (this.timelineState !== state || this.timelineLength !== this.length()) {
                this.timelineState = state;
                this.timelineLength = this.length();
                this.scheduledEvents = theory.playbackEvents(state, this.length());
            }
            return this.scheduledEvents;
        }

        seek(time) {
            const state = this.playbackState || this.state;
            const stepSeconds = 60 / this.host.bpm() / 4 / state.rate;
            const position = Math.max(0, (time - this.origin) / stepSeconds);
            this.nextCycle = Math.floor(position / this.length());
            const phase = position % this.length();
            this.nextEvent = this.timeline().findIndex(event => event.start >= phase);
            if (this.nextEvent < 0) { this.nextCycle += 1; this.nextEvent = 0; }
        }

        selectedChord() {
            if (this.state.selection) return { ...theory.copy(this.state.selection), velocity: this.state.velocity, gate: this.state.gate };
            const rootNote = (this.state.octave + 1) * 12 + this.state.chordRoot;
            const pitches = theory.chord(rootNote, this.state.chordType, this.state.inversion, this.state.voicing);
            theory.transposed(pitches, this.state.transpose);
            return { root: rootNote, type: this.state.chordType, inversion: this.state.inversion, voicing: this.state.voicing, notes: pitches, gate: this.state.gate, velocity: this.state.velocity, ratchet: 1 };
        }

        async audition(chord, options = {}) {
            const request = this.previewToken = (this.previewToken || 0) + 1;
            await this.ready();
            const generation = this.generation;
            const pitches = theory.transposed(chord.notes, this.state.transpose);
            const event = { notes: pitches, velocity: chord.velocity || this.state.velocity };
            await this.piano.ensure([event]);
            if (generation !== this.generation || request !== this.previewToken) return;
            clearInterval(this.previewTimer);
            for (const voice of [...this.voices]) if (voice.preview) this.removeVoice(voice, true);
            this.auditioning = true;
            this.ensureGraph();
            this.preview = { chord: theory.copy(chord), pitches, velocity: event.velocity, order: theory.arpOrder(pitches, this.state.arpPattern, this.state.arpSteps), next: 0, nextTime: this.host.context().currentTime + .06, arp: this.state.arpEnabled, repeat: this.state.arpRepeat === 'until-next', done: false, endPosition: options.endPosition };
            this.tickPreview();
            if (!this.preview) return;
            this.previewTimer = setInterval(() => {
                try { this.tickPreview(); }
                catch (error) { this.stop(); this.status(error.message, true); }
            }, 25);
            this.updateEffects();
            this.status(`${options.recorded ? this.liveRecording() ? 'Live recorded' : 'Recorded' : this.state.record ? 'Audition' : 'Practice'}: ${theory.noteName(chord.root)} ${chord.type} · ${pitches.map(theory.noteName).join(' – ')}`);
        }

        tickPreview() {
            const preview = this.preview;
            const context = this.host.context();
            if (!preview || !context || context.state !== 'running') { this.stop(); return; }
            const cutoff = Number.isFinite(preview.endPosition) ? this.origin + preview.endPosition * (60 / this.host.bpm() / 4 / (this.playbackState || this.state).rate) : Infinity;
            if (context.currentTime >= cutoff) { this.stopPreview(); return; }
            const interval = 60 / this.host.bpm() * this.state.arpDivision;
            if (!preview.done && preview.nextTime < context.currentTime - .02) {
                const missed = Math.floor((context.currentTime - preview.nextTime) / interval);
                preview.next += missed;
                preview.nextTime += missed * interval;
                if (preview.arp && !preview.repeat && preview.next >= preview.order.length) preview.done = true;
            }
            while (!preview.done && preview.nextTime <= context.currentTime + .12) {
                if (preview.nextTime >= cutoff) { preview.done = true; break; }
                const voiceOptions = { preview: true, grid: this.running, stepSeconds: 60 / this.host.bpm() / 4 / (this.playbackState || this.state).rate, accentBoost: preview.chord.accent ? 1 + 2 * this.state.accentAmount : 1 };
                if (preview.arp) {
                    const pitch = preview.order[preview.next % preview.order.length];
                    if (pitch !== null) this.voice(pitch, preview.velocity, preview.nextTime, interval * .8, { ...voiceOptions, releaseSeconds: this.state.arpPattern === 'custom' ? interval * .2 : undefined });
                    preview.next += 1;
                    preview.nextTime += interval;
                    if (!preview.repeat && preview.next >= preview.order.length) preview.done = true;
                } else {
                    for (const pitch of preview.pitches) this.voice(pitch, preview.velocity, preview.nextTime, .85, voiceOptions);
                    preview.done = true;
                }
            }
            this.reflectPlaying(context.currentTime);
            if (preview.done && ![...this.voices].some(voice => voice.preview)) {
                clearInterval(this.previewTimer);
                this.previewTimer = null;
                this.preview = null;
                this.reflectPlaying(context.currentTime);
                this.host.activity?.();
            }
        }

        palette() { return theory.chordPalette(this.state, this.scale()); }

        setPaletteFromBass(fromBass) {
            if (root.mygrainCardHistory?.busy) throw new Error('Wait for Undo/Redo to finish before changing the chord pool.');
            const roots = fromBass ? [...new Set((this.host.bassNotes?.() || []).filter(Number.isInteger).map(theory.pitchClass))] : null;
            if (fromBass && !roots.length) throw new Error('Bass X has no playable notes in the current pattern. Add bass notes first.');
            const edit = () => {
                this.state.paletteBassRoots = roots;
                this.state.chordRoot = roots ? roots[0] : this.state.tonic;
                this.state.selection = null;
                this.changed({ preserveSamples: true, reschedule: false });
            };
            if (root.mygrainCardHistory) root.mygrainCardHistory.run(fromBass ? 'Q pool from bass' : 'Q scale pool', edit); else edit();
            this.status(roots ? `Chord pool filled from Bass X: ${roots.map(pitch => theory.notes[pitch]).join(', ')}. Tap From Bass again after changing the bass sequence.` : 'Scale-matched chord pool restored.');
        }

        updatePlayhead(position) {
            if (typeof document === 'undefined' || document.hidden || document.getElementById('bastardLoopQOverlay')?.hidden !== false) return false;
            const grid = document.getElementById('bastardLoopQStepGrid');
            if (!grid || (root.isPerformanceElementVisible && !root.isPerformanceElementVisible(grid))) return false;
            if (position === undefined) {
                const state = this.playbackState || this.state;
                const stepSeconds = 60 / this.host.bpm() / 4 / state.rate;
                position = this.running ? Math.floor(Math.max(0, this.host.context().currentTime - this.origin) / stepSeconds) % this.length() : -1;
            }
            const previous = grid.querySelector('.playing');
            const current = grid.children[position];
            if (previous === (current || null)) return false;
            previous?.classList.remove('playing');
            current?.classList.add('playing');
            return true;
        }

        reflectPlaying(now = this.host.context()?.currentTime || 0) {
            if (typeof document === 'undefined') return;
            if (document.hidden || document.getElementById('bastardLoopQOverlay')?.hidden !== false) {
                this.playingFingerprint = null;
                return;
            }
            const voices = [...this.voices].filter(voice => voice.start <= now && voice.end > now);
            let chord = voices.some(voice => voice.preview) ? this.preview?.chord : null;
            if (!chord && this.running && voices.length) {
                const state = this.playbackState || this.state;
                const elapsed = Math.max(0, (now - this.origin) / (60 / this.host.bpm() / 4 / state.rate));
                const position = elapsed % this.length();
                let index = Math.floor(position);
                while (index >= 0 && (!state.sequence[index] || state.sequence[index].kind === 'accent')) index -= 1;
                if (index < 0 && elapsed >= this.length()) {
                    index = this.length() - 1;
                    while (index >= 0 && (!state.sequence[index] || state.sequence[index].kind === 'accent')) index -= 1;
                }
                if (index >= 0 && !state.sequence[index].rest) chord = state.sequence[index];
            }
            const signature = chord?.notes.join(',');
            const pitches = new Set(voices.map(voice => voice.pitch));
            const fingerprint = JSON.stringify([signature, [...pitches].sort((first, second) => first - second), this.state.transpose, this.state.arpEnabled ? this.state.arpPattern : null]);
            if (fingerprint === this.playingFingerprint) return;
            this.playingFingerprint = fingerprint;
            document.querySelectorAll('#bastardLoopQPalette [data-q-degree]').forEach(button => {
                const playing = Boolean(signature && button.dataset.notes === signature);
                button.classList.toggle('q-chord-playing', playing);
                button.querySelectorAll('[data-note]').forEach(note => note.classList.toggle('q-note-playing', playing && pitches.has(Number(note.dataset.note) + this.state.transpose)));
            });
            const label = document.getElementById('bastardLoopQPlaying');
            if (label) label.textContent = chord ? `Playing ${theory.noteName(chord.root)} ${chord.type}${this.state.arpEnabled ? ` · ${this.state.arpPattern} arp` : ''}` : 'Tap a chord to play it.';
        }

        insert(chord = this.selectedChord()) {
            const step = theory.normalizeStep(chord);
            if (!step) throw new Error('That chord is outside the piano range A0–C8. Choose a different octave or voicing.');
            theory.transposed(step.notes, this.state.transpose);
            step.accent = step.accent || this.state.sequence[this.cursor]?.accent === true;
            this.state.sequence[this.cursor] = step;
            this.cursor = (this.cursor + 1) % this.length();
            this.state.enabled = true;
            this.changed();
        }

        recordChord(chord) {
            if (!this.liveRecording()) { this.insert(chord); return true; }
            const now = this.host.context()?.currentTime;
            if (!this.running || !Number.isFinite(this.origin) || !Number.isFinite(now) || now < this.origin) {
                this.status('Live is armed. Press green All Play to start recording at the playhead.');
                return false;
            }
            const step = theory.normalizeStep(chord);
            if (!step) throw new Error('That chord is outside the piano range A0–C8.');
            theory.transposed(step.notes, this.state.transpose);
            const stepSeconds = 60 / this.host.bpm() / 4 / (this.playbackState || this.state).rate;
            this.cursor = Math.floor((now - this.origin) / stepSeconds) % this.length();
            step.accent = step.accent || this.state.sequence[this.cursor]?.accent === true;
            this.state.sequence[this.cursor] = step;
            this.state.enabled = true;
            if (step.rest) for (const voice of [...this.voices]) if (!voice.preview) this.removeVoice(voice, true);
            this.changed({ live: true });
            this.status(`Live recorded ${step.rest ? 'Rest' : `${theory.noteName(step.root)} ${step.type}`} at step ${this.cursor + 1}.`);
            return true;
        }

        async playChord(chord) {
            const step = theory.normalizeStep({ ...chord, velocity: this.state.velocity, gate: this.state.gate });
            if (!step) throw new Error('That chord is outside the piano range A0–C8.');
            this.state.selection = step;
            this.piano.pinned = false;
            const recorded = this.state.record && this.recordChord(step);
            if (!recorded) this.changed({ reschedule: false });
            let endPosition;
            if (recorded && this.liveRecording()) {
                const stepSeconds = 60 / this.host.bpm() / 4 / (this.playbackState || this.state).rate;
                const cycle = Math.floor((this.host.context().currentTime - this.origin) / stepSeconds / this.length());
                let end = this.cursor + 1;
                while (end < this.length() && (!this.state.sequence[end] || this.state.sequence[end].kind === 'accent' || (this.state.arpEnabled && this.state.arpRepeat === 'once' && !this.state.sequence[end].rest))) end += 1;
                endPosition = cycle * this.length() + end;
            }
            await this.audition(step, { endPosition, recorded });
            if (this.liveRecording() && !recorded) this.status('Live is armed. Press green All Play; this chord was auditioned only.');
        }

        stepClicked(index) {
            const marking = Boolean(this.mark);
            this.cursor = index;
            const step = this.state.sequence[index];
            if (step?.notes?.length) {
                this.state.selection = theory.copy(step);
                this.state.velocity = step.velocity;
                this.state.gate = step.gate;
            }
            if (this.mark) {
                if (this.mark.start === null) {
                    this.mark.start = index;
                    this.status('Now choose the last step of the section.');
                } else {
                    const range = [Math.min(index, this.mark.start), Math.max(index, this.mark.start)];
                    if (this.mark.type === 'copy') {
                        this.clipboard = theory.copy(this.state.sequence.slice(range[0], range[1] + 1));
                        this.mark = { type: 'paste', start: null, insert: this.mark.insert };
                        this.status('Section copied. Tap its destination step to paste.');
                    } else if (this.mark.type === 'transpose') {
                        this.range = range;
                        this.mark = null;
                        this.status(`Transpose section ${range[0] + 1}–${range[1] + 1} with Seq − / Seq +.`);
                    }
                }
                if (this.mark?.type === 'paste' && this.mark.start !== null) this.paste(index);
            }
            this.sync();
            if (!marking) {
                if (step?.notes?.length && !step.rest) this.task(() => this.audition(step));
                else this.stopPreview();
            }
        }

        paste(index) {
            if (!this.clipboard) return;
            if (this.mark?.insert) {
                for (let target = index; target < this.length(); target += 1) this.state.sequence[target] = theory.copy(this.clipboard[(target - index) % this.clipboard.length]);
            }
            else this.clipboard.forEach((step, offset) => { if (index + offset < this.length()) this.state.sequence[index + offset] = theory.copy(step); });
            this.state.sequence.length = 64;
            this.mark = null;
            this.changed();
            this.status('Copied chords pasted.');
        }

        transpose(amount) {
            const [start, end] = this.range || [0, this.length() - 1];
            const replacement = this.state.sequence.map((step, index) => step?.notes?.length && index >= start && index <= end
                ? { ...step, root: step.root + amount, notes: theory.transposed(step.notes, amount) } : step);
            this.state.sequence = replacement;
            this.changed();
            this.status(`Transposed ${this.range ? `steps ${start + 1}–${end + 1}` : 'the sequence'} ${amount > 0 ? '+' : ''}${amount} semitone.`);
        }

        nudgeStep(amount) {
            const source = this.cursor;
            const step = this.state.sequence[source];
            if (source < 0 || source >= this.length() || !step?.notes?.length || step.rest) throw new Error('Select a grid chord before nudging it.');
            const destination = (source + amount + this.length()) % this.length();
            const neighbour = this.state.sequence[destination];
            this.state.sequence[destination] = step;
            this.state.sequence[source] = neighbour;
            this.cursor = destination;
            this.state.selection = theory.copy(step);
            this.mark = null;
            this.range = null;
            this.stopPreview();
            this.changed({ live: true });
            this.status(`Moved step ${source + 1} ${amount < 0 ? 'left' : 'right'} 1 to step ${destination + 1}${neighbour ? ' · swapped neighbour' : ''}.`);
        }

        async transposeStep(amount) {
            const step = this.state.sequence[this.cursor];
            if (!step?.notes?.length || step.rest) throw new Error('Select a grid chord before transposing it.');
            const pitches = theory.transposed(step.notes, amount);
            theory.transposed(pitches, this.state.transpose);
            const rootNote = step.root + amount;
            if (rootNote < 21 || rootNote > 108) throw new Error('That transposition would leave the piano range A0–C8.');
            const chord = { ...step, root: rootNote, notes: pitches };
            this.state.sequence[this.cursor] = chord;
            this.state.selection = theory.copy(chord);
            this.changed();
            this.status(`Step ${this.cursor + 1}: ${amount > 0 ? '+' : ''}${amount} semitone.`);
            await this.audition(chord);
        }

        copyArp() {
            if (!this.state.arpEnabled) throw new Error('Switch Q from block chords to ARP before copying.');
            const sourceLength = this.length();
            const steps = theory.arpSequence(this.state, sourceLength);
            this.arpClipboard = { steps, pattern: this.state.arpPattern, sourceLength };
            if (typeof root.CustomEvent === 'function') root.dispatchEvent?.(new root.CustomEvent('mygrain-arp-clipboard'));
            const gaps = steps.filter(step => step.rest).length;
            this.status(`Copied the entire ${sourceLength}-step Q pattern from step 1: ${steps.length} arp pulses, ${gaps} gaps. Paste from Arp in X or L at its selected step; destination rate is unchanged.`);
            return this.getArpClipboard();
        }

        getArpClipboard() {
            return this.arpClipboard ? theory.copy(this.arpClipboard) : null;
        }

        async action(action) {
            if (action === 'pool-from-bass' || action === 'pool-from-scale') return this.setPaletteFromBass(action === 'pool-from-bass');
            if (action === 'copy-arp') return this.copyArp();
            if (action === 'arp-builder') return this.arpBuilder.open();
            if (action === 'edit') return this.open();
            if (action === 'close') return this.close();
            if (action === 'load') return this.preparePlayback();
            if (action === 'audition') return this.audition(this.selectedChord());
            if (action === 'audition-step') {
                const step = this.state.sequence[this.cursor];
                if (!step?.notes?.length || step.rest) throw new Error('Choose a step containing a playable chord.');
                return this.audition(step);
            }
            if (action === 'insert') return this.insert();
            if (action === 'stop') { this.stop(); this.status('Q stopped.'); return; }
            if (action === 'stop-all') { this.host.stopAll(); return; }
            if (action === 'play-all') {
                const generation = this.generation;
                await this.ready();
                if (this.hasSequence() || this.liveRecording()) await this.preparePlayback();
                if (generation !== this.generation) return;
                if (this.hasSequence() || this.liveRecording()) this.setEnabled(true);
                this.host.allPlay();
                this.status(this.liveRecording() ? 'Whole pattern playing. Live taps record at the playhead.' : 'Whole pattern playing.');
                return;
            }
            if (action === 'play' || action === 'transport') {
                if (!this.hasSequence() && !this.liveRecording()) throw new Error('Insert a chord or arm Live recording first.');
                const generation = this.generation;
                await this.preparePlayback();
                if (generation !== this.generation) return;
                this.setEnabled(true);
                if (action === 'play') { this.host.stopAll(); this.start(this.host.context().currentTime + .04); }
                else this.host.sharedPlay();
                return;
            }
            if (action === 'toggle') return this.setEnabled(!this.state.enabled);
            if (action === 'solo') { this.host.solo(); return; }
            if (action === 'practice') this.state.record = false;
            if (action === 'record') {
                this.state.recordMode = this.state.record && this.state.recordMode === 'step' ? 'live' : 'step';
                this.state.record = true;
                const origin = this.host.transportOrigin?.();
                if (this.liveRecording() && !this.running && Number.isFinite(origin)) {
                    this.state.enabled = true;
                    this.start(origin);
                }
            }
            if (action === 'back') this.cursor = (this.cursor + this.length() - 1) % this.length();
            if (action === 'forward') this.cursor = (this.cursor + 1) % this.length();
            if (action === 'clear-step') { this.state.sequence[this.cursor] = null; this.stopPreview(); }
            if (action === 'clear-all') { this.state.sequence.fill(null); this.range = null; this.mark = null; }
            if (action === 'transpose-down') return this.transpose(-1);
            if (action === 'transpose-up') return this.transpose(1);
            if (action === 'transpose-step-down') return this.transposeStep(-1);
            if (action === 'transpose-step-up') return this.transposeStep(1);
            if (action === 'nudge-left') return this.nudgeStep(-1);
            if (action === 'nudge-right') return this.nudgeStep(1);
            if (action === 'transpose-range' || action === 'copy-range' || action === 'copy') {
                this.mark = { type: action === 'transpose-range' ? 'transpose' : 'copy', start: null, insert: action === 'copy-range' };
                this.range = null;
                this.status('Choose the first, then last step of the section.');
            }
            if (action === 'clear-range') { this.range = null; this.mark = null; }
            if (action === 'paste') return this.paste(this.cursor);
            if (action === 'rate-down' || action === 'rate-up') {
                const rates = [.25, .5, 1, 2, 4];
                this.state.rate = rates[Math.min(4, Math.max(0, rates.indexOf(this.state.rate) + (action === 'rate-up' ? 1 : -1)))];
            }
            if (action === 'rest') {
                this.stopPreview();
                const chord = this.state.sequence[this.cursor] || this.state.selection || { root: 48, notes: [48] };
                if (this.liveRecording()) { this.recordChord({ ...chord, rest: true }); return; }
                this.state.sequence[this.cursor] = theory.normalizeStep({ ...chord, rest: true, velocity: this.state.velocity, gate: this.state.gate });
                this.cursor = (this.cursor + 1) % this.length();
            }
            if (action === 'accent' || action === 'tie') {
                const step = this.state.sequence[this.cursor];
                if (action === 'accent' && !step) this.state.sequence[this.cursor] = theory.normalizeStep({ kind: 'accent', notes: [], accent: true });
                else if (action === 'accent' && step.kind === 'accent') this.state.sequence[this.cursor] = null;
                else {
                    if (!step?.notes?.length) throw new Error('Choose a step containing a chord first.');
                    step[action] = !step[action];
                    if (action === 'accent' && this.preview?.chord.notes.join(',') === step.notes.join(',')) this.preview.chord.accent = step.accent;
                }
                this.changed({ preserveSamples: action === 'accent' && (!step || step.kind === 'accent'), live: true });
                return;
            }
            if (action === 'random') {
                const randomize = () => { this.randomPattern(); this.changed({ preserveSamples: false, reschedule: true, live: false }); };
                if (window.mygrainCardHistory) window.mygrainCardHistory.run('Loop Q pattern', randomize); else randomize();
                return;
            }
            if (action === 'midi') {
                const link = document.createElement('a');
                link.href = URL.createObjectURL(new Blob([theory.midiFile(this.state, this.length(), this.host.bpm())], { type: 'audio/midi' }));
                link.download = 'bastardloop-q.mid';
                link.click();
                setTimeout(() => URL.revokeObjectURL(link.href), 1000);
            }
            const controlsOnly = ['practice', 'record', 'back', 'forward', 'midi'].includes(action);
            this.changed({ preserveSamples: controlsOnly, reschedule: !controlsOnly, live: action === 'clear-step' });
        }

        scale() {
            return this.state.scale === 'custom' ? this.state.customScale : (this.scales.find(scale => scale.name === this.state.scale) || this.scales[0]).intervals;
        }

        randomPattern() {
            const palette = theory.scaleChords(this.state.tonic, this.scale(), this.state.octave, this.state.paletteSize).filter(chord => theory.normalizeStep(chord));
            if (!palette.length) throw new Error('Choose a scale with at least three notes.');
            this.state.sequence.fill(null);
            for (let index = 0; index < this.length(); index += 4) {
                const chord = palette[index === 0 ? 0 : Math.floor(Math.random() * palette.length)];
                this.state.sequence[index] = theory.normalizeStep({ ...chord, gate: 3.8, velocity: this.state.velocity });
            }
            this.state.enabled = true;
        }

        open() {
            const overlay = document.getElementById('bastardLoopQOverlay');
            this.livePlayheadPosition = null;
            this.returnFocus = document.activeElement;
            overlay.hidden = false;
            overlay.setAttribute('aria-hidden', 'false');
            document.body.classList.add('q-sequencer-open');
            this.syncViewport();
            this.sync();
            document.getElementById('bastardLoopQCloseBtn').focus({ preventScroll: true });
        }

        syncViewport() {
            const overlay = document.getElementById('bastardLoopQOverlay');
            if (!overlay || overlay.hidden) return;
            const viewport = root.visualViewport;
            overlay.style.setProperty('--q-viewport-height', `${viewport?.height || root.innerHeight}px`);
            overlay.style.setProperty('--q-viewport-width', `${viewport?.width || root.innerWidth}px`);
            overlay.style.setProperty('--q-viewport-top', `${viewport?.offsetTop || 0}px`);
            overlay.style.setProperty('--q-viewport-left', `${viewport?.offsetLeft || 0}px`);
            this.revealCursor();
        }

        close() {
            this.chordEditor?.close({ resume: false });
            const overlay = document.getElementById('bastardLoopQOverlay');
            if (!overlay.hidden) root.guardSectionJumpAfterOverlayClose?.();
            overlay.hidden = true;
            overlay.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('q-sequencer-open');
            this.returnFocus?.focus({ preventScroll: true });
        }

        syncTransport() {
            if (typeof document === 'undefined') return;
            for (const button of document.querySelectorAll('[data-q-action="play"]')) button.setAttribute('aria-pressed', String(this.running));
            for (const button of document.querySelectorAll('[data-q-action="play-all"]')) button.setAttribute('aria-pressed', String(this.running || Number.isFinite(this.host.transportOrigin?.())));
            for (const button of document.querySelectorAll('[data-q-action="toggle"]')) {
                button.classList.toggle('layer-muted', !this.state.enabled);
                button.textContent = `Bastardloop Q ${this.state.enabled ? 'On' : 'Off'}`;
                button.setAttribute('aria-pressed', String(this.state.enabled));
            }
            root.syncBastardLoopXQRootButton?.();
        }

        revealCursor(index = this.cursor) {
            const grid = document.getElementById('bastardLoopQStepGrid');
            const scroller = grid.parentElement;
            if (!scroller.clientHeight || (this.visibleCursor === index && this.visibleGridHeight === scroller.clientHeight)) return;
            this.visibleCursor = index;
            this.visibleGridHeight = scroller.clientHeight;
            const cell = grid.children[index].getBoundingClientRect();
            const bounds = scroller.getBoundingClientRect();
            if (cell.top < bounds.top) scroller.scrollTop -= bounds.top - cell.top;
            else if (cell.bottom > bounds.bottom) scroller.scrollTop += cell.bottom - bounds.bottom;
        }

        sync() {
            if (typeof document === 'undefined' || !document.getElementById('bastardLoopQCard')) return;
            for (const button of document.querySelectorAll('[data-q-action="copy-arp"]')) {
                button.disabled = !this.state.arpEnabled;
                button.title = this.state.arpEnabled ? `Copy the entire ${this.length()}-step Q pattern from step 1, including all chord changes, gaps and accents. One pulse per X/L step; destination rate is unchanged.` : 'Copy Arp is unavailable in block chord mode. Switch Chord playback to ARP.';
            }
            for (const input of document.querySelectorAll('[data-q-field]')) {
                const key = input.dataset.qField;
                if (document.activeElement !== input) input.value = String(this.state[key]);
                const output = document.getElementById(`${input.id}Value`);
                if (output) output.textContent = key === 'accentAmount' ? `+${(20 * Math.log10(1 + 2 * this.state[key])).toFixed(1)} dB` : ['level', 'room', 'delay', 'feedback', 'sampleLength', 'sampleDecay'].includes(key) ? `${Math.round(this.state[key] * 100)}%` : String(this.state[key]);
            }
            const record = document.querySelector('[data-q-action="record"]');
            record.textContent = `● ${this.state.recordMode === 'live' ? 'Live' : 'Step'}`;
            record.setAttribute('aria-pressed', String(this.state.record));
            record.setAttribute('aria-label', `Record ${this.state.recordMode}; tap to ${this.state.record && this.state.recordMode === 'step' ? 'switch to Live' : 'arm Step'} recording`);
            document.getElementById('bastardLoopQPracticeBtn').setAttribute('aria-pressed', String(!this.state.record));
            const current = this.state.sequence[this.cursor];
            for (const action of ['transpose-step-down', 'transpose-step-up', 'nudge-left', 'nudge-right']) {
                const button = document.querySelector(`[data-q-action="${action}"]`);
                if (button) button.disabled = !current?.notes?.length || current.rest;
            }
            for (const key of ['accent', 'tie']) {
                const button = document.querySelector(`[data-q-action="${key}"]`);
                button.setAttribute('aria-pressed', String(Boolean(current?.[key])));
            }
            document.getElementById('bastardLoopQStepCursor').textContent = `Editing step ${this.cursor + 1} / ${this.length()} · Rate ×${this.state.rate}${this.range ? ` · Section ${this.range[0] + 1}–${this.range[1] + 1}` : ''}`;
            const selected = this.state.selection;
            document.getElementById('bastardLoopQSelected').textContent = selected ? `Selected chord: ${theory.noteName(selected.root)} ${selected.type} · ${selected.notes.map(theory.noteName).join(' – ')}` : 'Chord builder active. Choose a palette chord or use the controls below.';
            const grid = document.getElementById('bastardLoopQStepGrid');
            this.livePlayheadPosition = null;
            const gridFingerprint = JSON.stringify(this.state.sequence.slice(0, this.length()));
            const rebuildGrid = gridFingerprint !== this.gridFingerprint || grid.children.length !== this.length();
            if (rebuildGrid) grid.replaceChildren();
            for (let index = 0; index < this.length(); index += 1) {
                const step = this.state.sequence[index];
                const button = rebuildGrid ? document.createElement('button') : grid.children[index];
                button.type = 'button';
                button.className = 'performance-btn q-step';
                button.dataset.qStep = String(index);
                button.classList.toggle('selected', index === this.cursor);
                button.classList.toggle('in-range', Boolean(this.range && index >= this.range[0] && index <= this.range[1]));
                button.setAttribute('aria-pressed', String(index === this.cursor));
                const shortType = step?.type?.replace(/major/g, 'maj').replace(/minor/g, 'min').replace(/diminished/g, 'dim').replace(/augmented/g, 'aug').replace(/dominant/g, '');
                button.textContent = `${index + 1}\n${!step || step.kind === 'accent' ? '—' : step.rest ? 'REST' : `${theory.noteName(step.root)} ${shortType}`}${step?.accent ? ' !' : ''}${step?.tie ? ' ~' : ''}${step?.ratchet > 1 ? ` ×${step.ratchet}` : ''}`;
                button.title = step?.kind === 'accent' ? 'Accent only: boosts notes and arpeggios sounding through this cell; does not retrigger a chord.' : step ? `${step.notes.map(theory.noteName).join(' – ')}${!step.rest ? ' · Double-click or press E to edit individual notes' : ''}` : 'Empty step';
                if (rebuildGrid) grid.append(button);
            }
            this.gridFingerprint = gridFingerprint;
            const palette = document.getElementById('bastardLoopQPalette');
            const fingerprint = JSON.stringify([this.state.tonic, this.scale(), this.state.octave, this.state.chordRoot, this.state.chordType, this.state.inversion, this.state.voicing, this.state.paletteFamilies, this.state.paletteBassRoots]);
            if (fingerprint !== this.paletteFingerprint) {
                this.paletteFingerprint = fingerprint;
                this.playingFingerprint = null;
                this.paletteChords = this.palette();
                palette.replaceChildren();
                for (const [index, chord] of this.paletteChords.entries()) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'performance-btn q-chord';
                    button.dataset.qDegree = String(index);
                    button.dataset.root = String(theory.pitchClass(chord.root));
                    button.dataset.type = chord.type;
                    button.dataset.notes = chord.notes.join(',');
                    const title = document.createElement('span');
                    title.className = 'q-chord-name';
                    title.textContent = `${theory.noteName(chord.root)} ${chord.type.replace(/major/g, 'maj').replace(/minor/g, 'min').replace(/dominant/g, '').replace(/diminished/g, 'dim').replace(/augmented/g, 'aug')}`;
                    const noteRow = document.createElement('span');
                    noteRow.className = 'q-chord-notes';
                    for (const pitch of chord.notes) {
                        const note = document.createElement('span');
                        note.dataset.note = String(pitch);
                        note.textContent = theory.noteName(pitch);
                        noteRow.append(note);
                    }
                    button.append(title, noteRow);
                    palette.append(button);
                }
                const roots = document.getElementById('bastardLoopQRoot');
                roots.replaceChildren();
                const classes = this.state.paletteBassRoots?.slice() || this.scale().map(interval => (this.state.tonic + interval) % 12);
                if (!classes.includes(this.state.chordRoot)) classes.push(this.state.chordRoot);
                for (const pitch of classes) {
                    const option = document.createElement('option');
                    option.value = String(pitch);
                    option.textContent = theory.notes[pitch];
                    roots.append(option);
                }
                roots.value = String(this.state.chordRoot);
            }
            for (const button of palette.children) {
                const selected = Boolean(this.state.selection && button.dataset.notes === this.state.selection.notes.join(',') && button.dataset.type === this.state.selection.type);
                button.setAttribute('aria-pressed', String(selected));
                button.title = `${this.state.record ? 'Record' : 'Practice'}: ${button.dataset.notes.split(',').map(Number).map(theory.noteName).join(' – ')}`;
            }
            const bassPool = Boolean(this.state.paletteBassRoots?.length);
            document.getElementById('bastardLoopQPoolFromBassBtn').setAttribute('aria-pressed', String(bassPool));
            document.getElementById('bastardLoopQPoolFromScaleBtn').setAttribute('aria-pressed', String(!bassPool));
            palette.setAttribute('aria-label', bassPool ? 'Playable chords rooted on the bass sequence notes' : 'Playable chords in the current scale');
            document.getElementById('bastardLoopQPoolHelp').textContent = bassPool ? `Bass roots: ${this.state.paletteBassRoots.map(pitch => theory.notes[pitch]).join(', ')} · all chord qualities; key/scale does not limit chord tones. Tap From Bass to refresh.` : 'Scale pool · chords stay within the current key / scale.';
            document.getElementById('bastardLoopQPaletteSummary').textContent = `${this.paletteChords.length} ${bassPool ? 'bass-root' : 'scale-matched'} chords · ${this.state.record ? this.liveRecording() ? 'Live: taps record at playhead' : 'Step: taps write and advance' : 'Practice: taps do not change the grid'}`;
            document.getElementById('bastardLoopQTonalSummary').textContent = `${theory.notes[this.state.tonic]} ${this.state.scale} · octave ${this.state.octave} · root ${theory.notes[this.state.chordRoot]}`;
            document.getElementById('bastardLoopQArpEnabled').value = this.state.arpEnabled ? '1' : '0';
            document.getElementById('bastardLoopQPlaybackSummary').textContent = this.state.arpEnabled ? `ARP · ${this.state.arpPattern}` : 'Block chords';
            document.getElementById('bastardLoopQCustomScale').hidden = this.state.scale !== 'custom';
            document.querySelectorAll('[data-q-pitch]').forEach(button => {
                const interval = Number(button.dataset.qPitch);
                button.setAttribute('aria-pressed', String(this.state.customScale.includes(interval)));
                button.textContent = theory.notes[(this.state.tonic + interval) % 12];
            });
            const solo = document.getElementById('performanceBastardLoopQLayerSoloBtn');
            solo.textContent = this.host.isSolo() ? 'Solo On' : 'Solo Off';
            solo.setAttribute('aria-pressed', String(this.host.isSolo()));
            this.syncTransport();
            this.reflectPlaying();
            this.updatePlayhead();
            const mixer = document.getElementById('performanceBastardLoopQLevelMixer');
            if (mixer && document.activeElement !== mixer) mixer.value = String(Math.round(this.state.level * 100));
            const mixerValue = document.getElementById('performanceBastardLoopQLevelMixerValue');
            if (mixerValue) mixerValue.textContent = `${Math.round(this.state.level * 100)}%`;
            this.revealCursor();
        }

        mount() {
            const card = document.getElementById('bastardLoopQCard');
            const button = (action, label, id = '', description = '') => `<button type="button" class="performance-btn" data-q-action="${action}"${id ? ` id="${id}"` : ''}${description ? ` title="${description}" aria-label="${description}"` : ''}>${label}</button>`;
            const select = (id, label, field) => `<label>${label}<select id="${id}" data-q-field="${field}"></select></label>`;
            const slider = (id, label, field, minimum, maximum, step) => `<div class="performance-sound-card"><label for="${id}"><span>${label}</span><span class="value" id="${id}Value"></span></label><input type="range" id="${id}" data-q-field="${field}" min="${minimum}" max="${maximum}" step="${step}"></div>`;
            card.innerHTML = `<div class="performance-feature-head"><div class="performance-feature-copy"><div class="performance-chip">Polyphonic Chord Seq</div><h3 class="performance-feature-title">Bastardloop Q</h3><p class="performance-feature-note">Local multisample grand piano or sustained string ensemble. Audition chords, then record a progression.</p></div><div class="performance-feature-actions">${button('load', 'Load Samples', 'performanceBastardLoopQLoadBtn')}${button('random', 'Random Pattern', 'performanceBastardLoopQRandomPatternBtn')}${button('edit', 'Edit Sequence', 'performanceBastardLoopQEditBtn')}${button('midi', 'Export MIDI', 'performanceBastardLoopQExportMidiBtn')}${button('transport', 'Start Bastardloops', 'performanceBastardLoopQStartBtn')}</div></div>
                <div class="q-controls">${select('performanceBastardLoopQInstrument', 'Q sound', 'instrument')}${button('arp-builder', 'Custom Arp / Repository', 'performanceBastardLoopQArpBuilderBtn')}${button('copy-arp', 'Copy Arp', 'performanceBastardLoopQCopyArpBtn')}</div>
                ${slider('performanceBastardLoopQLevel', 'Bastardloop Q Volume', 'level', 0, 1, .01)}
                <div class="q-controls">${slider('performanceBastardLoopQSampleLength', 'Sample Length', 'sampleLength', .05, 1, .01)}${slider('performanceBastardLoopQSampleDecay', 'Sample Decay', 'sampleDecay', .05, 1, .01)}</div>
                ${slider('performanceBastardLoopQTranspose', 'Transpose', 'transpose', -24, 24, 1)}
                ${slider('performanceBastardLoopQHighpass', 'Highpass cutoff (Hz)', 'highpass', 20, 10000, 10)}
                ${slider('performanceBastardLoopQLowpass', 'Lowpass cutoff (Hz)', 'lowpass', 100, 20000, 10)}
                ${slider('performanceBastardLoopQRoom', 'Room Reverb', 'room', 0, 1, .01)}
                ${slider('performanceBastardLoopQDelay', 'Delay Mix', 'delay', 0, 1, .01)}
                <div class="q-controls">${select('performanceBastardLoopQDelayDivision', 'Delay time', 'delayBeats')}${slider('performanceBastardLoopQFeedback', 'Delay Feedback', 'feedback', 0, .8, .01)}</div>
                <div class="performance-feature-meta source-waveform-meta" id="performanceBastardLoopQMeta" role="status">Samples are stored locally. Audio loads on demand.</div>
                <div class="performance-layer-switches">${button('toggle', 'Bastardloop Q Off', 'performanceBastardLoopQToggleBtn')}${button('solo', 'Solo Off', 'performanceBastardLoopQLayerSoloBtn')}${button('play', '▶ Play Q', 'performanceBastardLoopQPlayBtn')}${button('stop', '■ Stop Q', 'performanceBastardLoopQStopBtn')}</div>
                <details class="q-attribution"><summary>Instrument / scale credits</summary><p>Salamander Grand Piano V3 by Alexander Holm · CC BY 3.0. Four velocity layers, converted to stereo PCM16 / 44.1 kHz. No endorsement implied.</p><p>Strings: VSCO 2 Community Edition by Versilian Studios / Sam Gossner · CC0 1.0. Recorded cello, viola and violin sections; 17 roots, two dynamic layers and crossfaded sustain loops. Native recordings C2–D6; other notes are pitch-shifted.</p><p><a href="SAMPLES_Q/ATTRIBUTION.txt" target="_blank" rel="noopener">Piano source</a> · <a href="SAMPLES_Q/LICENSE" target="_blank" rel="noopener">Piano licence</a> · <a href="SAMPLES_Q_STRINGS/ATTRIBUTION.txt" target="_blank" rel="noopener">Strings source / preparation</a> · <a href="SAMPLES_Q_STRINGS/LICENSE" target="_blank" rel="noopener">Strings CC0 licence</a> · <a href="third-party/tonal-scale-type-LICENSE.txt" target="_blank" rel="noopener">Tonal scale dictionary MIT licence</a></p></details>`;
            const overlay = document.createElement('div');
            overlay.id = 'bastardLoopQOverlay';
            overlay.className = 'sample-browser-overlay';
            overlay.hidden = true;
            overlay.setAttribute('aria-hidden', 'true');
            overlay.innerHTML = `<div class="lead-sequencer-shell q-shell" role="dialog" aria-modal="true" aria-labelledby="bastardLoopQTitle">
                <div class="sample-browser-head q-head"><h3 id="bastardLoopQTitle">Bastardloop Q · Chords</h3>${button('close', 'Close', 'bastardLoopQCloseBtn')}</div>
                <details class="q-settings" id="bastardLoopQTonalSettings"><summary>Key &amp; chord roots · <span id="bastardLoopQTonalSummary"></span></summary><div class="q-controls">
                    ${select('bastardLoopQInstrument', 'Q sound', 'instrument')}${select('bastardLoopQKey', 'Scale tonic / key', 'tonic')}${select('bastardLoopQScale', 'Scale / mode', 'scale')}${select('bastardLoopQRoot', 'Chord root — show this degree first', 'chordRoot')}${select('bastardLoopQOctave', 'Scale octave', 'octave')}${select('bastardLoopQFamilies', 'Shown chord families', 'paletteFamilies')}${select('bastardLoopQInversion', 'Palette inversion', 'inversion')}${select('bastardLoopQVoicing', 'Palette voicing', 'voicing')}</div>
                    <div id="bastardLoopQCustomScale" class="q-custom-pitches" hidden></div><p class="q-help">Key sets the scale pool. From Bass uses Bass X note roots and allows all chord qualities. Chord root puts that note first; inversion and voicing change its playable notes.</p></details>
                <div class="q-toolbar q-session-controls" aria-label="Practice, Step or Live recording, delete, one-step nudge, transpose and whole-pattern transport">
                    ${button('practice', '<span class="q-control-full">Practice</span><span class="q-control-short" aria-hidden="true">Prac</span>', 'bastardLoopQPracticeBtn', 'Practice chords without recording')}${button('record', '● Step', 'bastardLoopQRecordBtn', 'Dual-function Record: tap to switch Step and Live')}${button('rest', 'Rest', 'bastardLoopQRestBtn', 'Record a Rest at the cursor or live playhead')}${button('clear-step', 'Delete', 'bastardLoopQDeleteStepBtn', 'Delete selected step without advancing')}${button('nudge-left', '<span class="q-nudge-full">Left 1</span><span class="q-nudge-short" aria-hidden="true">← 1</span>', 'bastardLoopQNudgeLeftBtn', 'Left 1: move selected chord left one grid step; occupied neighbours swap')}${button('nudge-right', '<span class="q-nudge-full">Right 1</span><span class="q-nudge-short" aria-hidden="true">1 →</span>', 'bastardLoopQNudgeRightBtn', 'Right 1: move selected chord right one grid step; occupied neighbours swap')}${button('transpose-step-down', '<span class="q-control-full">Chord −</span><span class="q-control-short" aria-hidden="true">Ch −</span>', 'bastardLoopQChordDownBtn', 'Transpose selected grid chord down one semitone')}${button('transpose-step-up', '<span class="q-control-full">Chord +</span><span class="q-control-short" aria-hidden="true">Ch +</span>', 'bastardLoopQChordUpBtn', 'Transpose selected grid chord up one semitone')}${button('play-all', '▶ All', 'bastardLoopQAllPlayBtn', 'Start the whole pattern and all enabled loops and drums')}${button('stop-all', '■ All', 'bastardLoopQAllStopBtn', 'Stop the whole pattern, every loop, drums and audition')}</div>
                <div class="q-record-help" id="bastardLoopQRecordHelp">Rec has two functions: tap Step / Live. Practice disarms recording.</div>
                <div class="q-workbench"><div class="q-pool-controls" aria-label="Chord pick pool source">${button('pool-from-bass', 'From Bass', 'bastardLoopQPoolFromBassBtn', 'Fill the chord pick pool from distinct playable notes in the current Bass X sequence; tap again to refresh')}${button('pool-from-scale', 'Scale Pool', 'bastardLoopQPoolFromScaleBtn', 'Restore chords matched to the current key and scale')}<span id="bastardLoopQPoolHelp"></span></div><div class="q-palette-heading"><span id="bastardLoopQPaletteSummary"></span><span id="bastardLoopQPlaying" role="status">Tap a chord to play it.</span></div>
                    <div class="q-palette" id="bastardLoopQPalette" aria-label="Playable chords in the current scale"></div>
                    <div class="q-grid-heading"><span id="bastardLoopQStepCursor"></span><span id="bastardLoopQSelected"></span></div>
                    <div class="q-grid-scroll"><div class="lead-sequencer-step-grid" id="bastardLoopQStepGrid"></div></div></div>
                <details class="q-settings q-playback-settings" id="bastardLoopQPlaybackSettings"><summary>Chord playback · <span id="bastardLoopQPlaybackSummary"></span></summary><div class="q-controls q-arp-controls" aria-label="Independent chord arpeggiator">
                    ${select('bastardLoopQArpEnabled', 'Chord playback', 'arpEnabled')}${select('bastardLoopQArpPattern', 'Arp order', 'arpPattern')}${select('bastardLoopQArpRepeat', 'Arp repeat', 'arpRepeat')}${select('bastardLoopQArpDivision', 'Arp time — separate from grid', 'arpDivision')}</div><div class="q-toolbar">${button('arp-builder', 'Build / Load Custom Arp', 'bastardLoopQArpBuilderBtn')}${button('copy-arp', 'Copy Arp', 'bastardLoopQCopyArpBtn')}</div>
                    <div class="q-controls">${slider('bastardLoopQSampleLength', 'Sample Length', 'sampleLength', .05, 1, .01)}${slider('bastardLoopQSampleDecay', 'Sample Decay', 'sampleDecay', .05, 1, .01)}</div>
                    <p class="q-help">Length trims each sample's sounding window. Lower Decay fades it earlier. Both at 100% keep the original envelope; reverb and delay tails remain controlled by their own mixes.</p></details>
                <details class="q-settings q-edit-tools" id="bastardLoopQEditTools"><summary>Step editing, transpose &amp; chord builder</summary>
                    <div class="q-controls">${select('bastardLoopQQuality', 'Preferred / builder chord quality', 'chordType')}${slider('bastardLoopQVelocity', 'Chord Velocity', 'velocity', 1, 127, 1)}${slider('bastardLoopQGate', 'Grid chord length (steps)', 'gate', .1, 64, .1)}${slider('bastardLoopQAccentAmount', 'Accent Amount', 'accentAmount', 0, 1, .01)}</div>
                    <div class="q-toolbar">${button('audition', '▶ Builder Chord', 'bastardLoopQAuditionBtn')}${button('audition-step', '▶ Selected Step', 'bastardLoopQAuditionStepBtn')}${button('insert', 'Insert Selected', 'bastardLoopQInsertBtn')}${button('play', '▶ Q Only', 'bastardLoopQSoloPlayBtn')}${button('stop', '■ Q Only', 'bastardLoopQSoloStopBtn')}${button('load', 'Load Samples')}${button('midi', 'Export MIDI')}</div>
                    <div class="q-toolbar">${button('back', 'Back')}${button('forward', 'Forward')}${button('transpose-down', 'Seq −')}${button('transpose-up', 'Seq +')}${button('transpose-range', 'Mark Trans')}${button('clear-range', 'Clear Mark')}${button('rate-down', 'Rate −')}${button('rate-up', 'Rate +')}${button('copy', 'Copy')}${button('copy-range', 'Copy Sec')}${button('paste', 'Paste')}</div>
                    <div class="q-toolbar">${button('accent', 'Accent')}${button('tie', 'Tie (Slide)')}${button('clear-step', 'Clear Step')}${button('clear-all', 'Clear All')}${button('random', 'Random Pattern')}${button('transport', 'Start Bastardloops')}${button('stop-all', 'Stop Bastardloops')}</div>
                    <div class="q-toolbar" id="bastardLoopQRatchets">${Array.from({ length: 8 }, (_, index) => `<button type="button" class="performance-btn" data-q-ratchet="${index + 1}">×${index + 1}</button>`).join('')}</div></details>
                <div id="bastardLoopQStatus" role="status" aria-live="polite">Practice plays without writing. Record writes each chord tap at the cursor and advances. Rest writes a silent cell.</div></div>`;
            document.body.append(overlay);
            root.addEventListener('resize', () => this.syncViewport());
            root.addEventListener('orientationchange', () => this.syncViewport());
            for (const event of ['resize', 'scroll']) root.visualViewport?.addEventListener(event, () => this.syncViewport());
            for (const details of overlay.querySelectorAll('details')) details.addEventListener('toggle', () => this.revealCursor());
            document.getElementById('performanceBastardLoopQLevelMixer')?.addEventListener('input', event => {
                this.state.level = Number(event.target.value) / 100;
                this.changed();
            });
            const options = (id, entries) => {
                const select = document.getElementById(id);
                if (!select) return;
                for (const [value, label] of entries) { const option = document.createElement('option'); option.value = String(value); option.textContent = label; select.append(option); }
            };
            for (const id of ['bastardLoopQKey', 'bastardLoopQRoot']) options(id, theory.notes.map((note, index) => [index, note]));
            options('bastardLoopQOctave', Array.from({ length: 9 }, (_, index) => [index, `Octave ${index}`]));
            options('bastardLoopQQuality', Object.keys(theory.qualities).map(quality => [quality, quality.replace(/([a-z])([A-Z])/g, '$1 $2')]));
            options('bastardLoopQInversion', Array.from({ length: 7 }, (_, index) => [index, index === 0 ? 'Root position' : `Inversion ${index}`]));
            options('bastardLoopQVoicing', [['close', 'Close'], ['open', 'Open'], ['octave-bass', 'Octave bass']]);
            options('bastardLoopQFamilies', [['all', 'All scale chords'], ['triads', 'Triads / suspended'], ['sevenths', 'Four-note chords'], ['extended', 'Extended chords']]);
            options('bastardLoopQArpEnabled', [['0', 'Block chords'], ['1', 'Arpeggiated']]);
            options('bastardLoopQArpPattern', [['up', 'Up'], ['down', 'Down'], ['updown', 'Up / Down'], ['odds', 'Odds first (1,3,5,2,4)'], ['evens', 'Evens first (2,4,1,3,5)'], ['custom', 'Custom note-order grid']]);
            options('bastardLoopQArpRepeat', [['once', 'One cycle'], ['until-next', 'Until next chord / rest']]);
            options('bastardLoopQArpDivision', [[4, '1/1 · ÷16'], [2, '1/2 · ÷8'], [1, '1/4 · ÷4'], [.5, '1/8 · ÷2'], [1 / 3, '1/8 triplet'], [.25, '1/16 · ×1'], [1 / 6, '1/16 triplet'], [.125, '1/32 · ×2'], [1 / 12, '1/32 triplet'], [.0625, '1/64 · ×4'], [.03125, '1/128 · ×8']]);
            this.arpBuilder = new root.MygrainQArp.Builder(this);
            options('bastardLoopQPaletteSize', [[3, 'Triads'], [4, 'Sevenths']]);
            for (const id of ['performanceBastardLoopQInstrument', 'bastardLoopQInstrument']) options(id, [['piano', 'Piano · Salamander Grand'], ['strings', 'Strings · VSCO 2 CE Ensemble']]);
            options('performanceBastardLoopQDelayDivision', [[.125, '1/32'], [.25, '1/16'], [.5, '1/8'], [1, '1/4'], [2, '1/2'], [4, '1 bar']].flatMap(([beats, label]) => [[beats, label], [beats * 1.5, `${label} dotted`], [beats * 2 / 3, `${label} triplet`]]));
            for (const [index, note] of theory.notes.entries()) {
                const pitch = document.createElement('button'); pitch.className = 'performance-btn'; pitch.type = 'button'; pitch.dataset.qPitch = String(index); pitch.textContent = note; document.getElementById('bastardLoopQCustomScale').append(pitch);
            }
            this.chordEditor = new ChordEditor(this);
            this.chordEditor.mount();
            const stepGrid = document.getElementById('bastardLoopQStepGrid');
            // Safari touch clicks do not reliably carry detail=2/pointerType.
            // Detect two stationary touch releases directly; a scrolling gesture
            // cancels the pointer and cannot accidentally open a chord.
            stepGrid.addEventListener('pointerdown', event => {
                const cell = event.target.closest('[data-q-step]');
                this.pendingChordTouch = null;
                this.chordTouchDown = event.pointerType === 'touch' && cell ? { index: Number(cell.dataset.qStep), x: event.clientX, y: event.clientY, pointer: event.pointerId } : null;
            });
            stepGrid.addEventListener('pointercancel', () => { this.chordTouchDown = null; this.lastChordTouch = null; this.pendingChordTouch = null; });
            stepGrid.addEventListener('pointerup', event => {
                const down = this.chordTouchDown;
                this.chordTouchDown = null;
                if (!down || down.pointer !== event.pointerId || this.mark || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 12) return;
                if (this.lastChordTouch?.index === down.index && event.timeStamp - this.lastChordTouch.time < 500) {
                    this.lastChordTouch = null;
                    // Open on the ensuing click, not pointerup: otherwise its
                    // compatibility click can hit a newly exposed modal control.
                    this.pendingChordTouch = down.index;
                } else this.lastChordTouch = { index: down.index, time: event.timeStamp };
            });
            stepGrid.addEventListener('dblclick', event => {
                const step = event.target.closest('[data-q-step]');
                if (step && !this.mark) { event.preventDefault(); this.task(() => this.chordEditor.open(Number(step.dataset.qStep))); }
            });
            stepGrid.addEventListener('keydown', event => {
                if (event.key.toLowerCase() !== 'e' || this.mark) return;
                const step = event.target.closest('[data-q-step]');
                if (step) { event.preventDefault(); this.task(() => this.chordEditor.open(Number(step.dataset.qStep))); }
            });
            const handleClick = event => {
                const target = event.target.closest('button');
                if (!target) return;
                if (target.dataset.qAction) this.task(() => this.action(target.dataset.qAction));
                if (target.dataset.qStep !== undefined) {
                    const index = Number(target.dataset.qStep);
                    if (this.chordEditor.opened) return;
                    const doubleTouch = this.pendingChordTouch === index;
                    this.pendingChordTouch = null;
                    if (!this.mark && (doubleTouch || event.detail >= 2)) {
                        this.task(() => this.chordEditor.open(index));
                        return;
                    }
                    if (this.mark?.type === 'paste') this.paste(index);
                    else this.stepClicked(index);
                }
                if (target.dataset.qDegree !== undefined) this.task(() => this.playChord(this.paletteChords[Number(target.dataset.qDegree)]));
                if (target.dataset.qPitch !== undefined) {
                    const pitch = Number(target.dataset.qPitch);
                    this.state.customScale = this.state.customScale.includes(pitch) && pitch !== 0 ? this.state.customScale.filter(note => note !== pitch) : [...new Set(this.state.customScale.concat(pitch))].sort((first, second) => first - second);
                    this.changed();
                }
                if (target.dataset.qRatchet) {
                    const step = this.state.sequence[this.cursor];
                    if (step?.notes?.length) { step.ratchet = Number(target.dataset.qRatchet); this.changed(); }
                }
            };
            const handleInput = event => {
                const key = event.target.dataset.qField;
                if (!key) return;
                if (key === 'instrument') { this.task(() => this.setInstrument(event.target.value)); return; }
                this.state[key] = ['scale', 'chordType', 'voicing', 'paletteFamilies', 'arpPattern', 'arpRepeat'].includes(key) ? event.target.value : key === 'arpEnabled' ? event.target.value === '1' : Number(event.target.value);
                if (['tonic', 'scale'].includes(key)) this.state.chordRoot = this.state.tonic;
                if (['chordRoot', 'chordType', 'octave', 'inversion', 'voicing', 'tonic', 'scale', 'paletteFamilies'].includes(key)) this.state.selection = null;
                if (['gate', 'velocity'].includes(key) && this.state.sequence[this.cursor]?.notes?.length) this.state.sequence[this.cursor][key] = this.state[key];
                const previewChord = this.preview?.chord;
                this.changed({ preserveSamples: ['level', 'pan', 'lowpass', 'highpass', 'room', 'delay', 'delayBeats', 'feedback', 'sampleLength', 'sampleDecay', 'gate', 'rate', 'arpEnabled', 'arpPattern', 'arpRepeat', 'arpDivision', 'paletteFamilies'].includes(key) });
                if (previewChord && ['arpEnabled', 'arpPattern', 'arpRepeat', 'arpDivision'].includes(key)) this.task(() => this.audition(previewChord));
            };
            for (const container of [card, overlay, document.getElementById('performanceLayerSwitchesCard')].filter(Boolean)) {
                container.addEventListener('click', handleClick);
                container.addEventListener('input', handleInput);
                container.addEventListener('change', event => { if (event.target.tagName === 'SELECT') handleInput(event); });
            }
            overlay.addEventListener('keydown', event => {
                event.stopPropagation();
                if (event.key === 'Escape') this.close();
                if (event.key === 'Tab') {
                    const controls = [...overlay.querySelectorAll('button, select, input, a[href]')].filter(element => !element.disabled && element.getClientRects().length);
                    if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1).focus(); }
                    if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
                }
            });
            this.task(async () => {
                const response = await fetch('q-scales.json?v=20261014-q-1', { cache: 'no-store' });
                if (!response.ok) throw new Error('The local scale dictionary is unavailable.');
                const catalog = await response.json();
                this.scales = catalog.scales;
                options('bastardLoopQScale', [...this.scales.map(scale => [scale.name, `${scale.name}${scale.aliases?.length ? ` (${scale.aliases.join(', ')})` : ''}`]), ['custom', 'Custom / any 12-tone scale']]);
                this.sync();
            });
            this.sync();
        }
    }

    const api = { Section: root.MygrainPatternSection.Section, Piano, Controller, ChordEditor, createKeyboardPlayer: host => new KeyboardPlayer(host) };
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.MygrainQ = api;
    if (root.document?.getElementById('bastardLoopQCard')) {
        const host = {
            context: () => audioContext, destination: () => preFilterGainNode || masterGain || audioContext.destination,
            bpm: () => Number(document.getElementById('globalBpmSlider')?.value || 120), length: () => getPatternLengthSteps(),
            ready: () => ensureAudioReadyForKeyInteraction(), save: () => saveState(),
            bassNotes: () => bastardLoopXSequence.slice(0, getBastardLoopXPatternLength()).filter(step => step && !step.rest && parseNoteName(step.note)).map(step => noteNameToMidi(step.note)),
            activity: () => { updateFinalMixEffects(); syncPerformanceControlState(); },
            stopAll: () => { root.mygrainSongBeta?.stop?.(); stopAllPerformancePlayback({ silent: true }); },
            sharedPlay: () => setBastardLoopPlaying(true), soloGain: () => getLoopLayerSoloGain('bastardq'),
            allPlay: () => { root.mygrainSongBeta?.stop?.(); return restartAllTransport({ silent: true }); },
            transportOrigin: () => (sequencerPlaying || bastardLoopPlaying || drumMachinePlaying || isArpeggiatorPlaying()) ? getSharedLoopTransportOriginTime() : null,
            solo: () => setLoopLayerSolo('bastardq', { toggle: true }), isSolo: () => hasLoopLayerSolo('bastardq')
        };
        root.mygrainQ = new Controller(host);
        root.mygrainQ.mount();
        root.mygrainQ.restore(readStoredStateSnapshot()?.q);
        root.addEventListener('pagehide', () => root.mygrainQ.stop());
    }
})(typeof window === 'object' ? window : globalThis);
