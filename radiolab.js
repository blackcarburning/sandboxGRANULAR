(function (root) {
    'use strict';

    const BUILD = 'v2026.10.17.R.11';
    const TUNE_TIMEOUT_MS = 12000;
    const BUFFER_SECONDS = 15;
    const MAX_RECORD_SECONDS = 120;
    const MAX_PCM_BYTES = 32 * 1024 * 1024;

    function pcm16Value(raw) {
        const value = Math.max(-1, Math.min(1, Number.isFinite(raw) ? raw : 0));
        return Math.round(value * (value < 0 ? 32768 : 32767));
    }

    function pcmWavHasSignal(body) {
        if (!body || body.byteLength < 12) return null;
        const view = new DataView(body);
        const text = offset => String.fromCharCode(...new Uint8Array(body, offset, 4));
        if (text(0) !== 'RIFF' || text(8) !== 'WAVE') return null;
        let bits;
        for (let offset = 12; offset + 8 <= body.byteLength;) {
            const kind = text(offset);
            const length = view.getUint32(offset + 4, true);
            const start = offset + 8;
            if (start + length > body.byteLength) return null;
            if (kind === 'fmt ' && length >= 16 && view.getUint16(start, true) === 1) bits = view.getUint16(start + 14, true);
            if (kind === 'data') {
                if (!length || ![8, 16, 24, 32].includes(bits)) return null;
                const silence = bits === 8 ? 128 : 0;
                return new Uint8Array(body, start, length).some(value => value !== silence);
            }
            offset = start + length + length % 2;
        }
        return null;
    }

    class PCMBufferRing {
        constructor({ sampleRate, channels = 2, seconds = BUFFER_SECONDS }) {
            if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isInteger(channels) || channels < 1 || channels > 2 || !Number.isFinite(seconds) || seconds <= 0) throw new Error('Invalid PCM ring dimensions.');
            this.sampleRate = sampleRate;
            this.channels = channels;
            this.capacity = Math.ceil(sampleRate * seconds);
            this.data = Array.from({ length: channels }, () => new Float32Array(this.capacity));
            this.clear();
        }

        clear() {
            this.frames = 0;
            this.written = 0;
            this.position = 0;
            this.signalSamples = 0;
            this.data.forEach(channel => channel.fill(0));
        }

        get duration() { return this.frames / this.sampleRate; }
        get hasSignal() { return this.signalSamples > 0; }

        append(channels) {
            const frames = channels[0]?.length || 0;
            for (let frame = 0; frame < frames; frame += 1) {
                for (let channel = 0; channel < this.channels; channel += 1) {
                    const value = (channels[channel] || channels[0])[frame];
                    if (this.data[channel][this.position] !== 0) this.signalSamples -= 1;
                    this.data[channel][this.position] = Number.isFinite(value) ? value : 0;
                    if (this.data[channel][this.position] !== 0) this.signalSamples += 1;
                }
                this.position = (this.position + 1) % this.capacity;
            }
            this.written += frames;
            this.frames = Math.min(this.capacity, this.frames + frames);
        }

        snapshot(seconds = this.duration) {
            const rewind = Math.max(0, Math.min(this.duration, Number(seconds) || 0));
            const frames = Math.min(this.frames, Math.round(rewind * this.sampleRate));
            const start = (this.position - frames + this.capacity) % this.capacity;
            return this.data.map(channel => {
                const result = new Float32Array(frames);
                for (let frame = 0; frame < frames; frame += 1) result[frame] = channel[(start + frame) % this.capacity];
                return result;
            });
        }
    }

    class PCMRecorder {
        constructor({ sampleRate, channels = 2, maxSeconds = MAX_RECORD_SECONDS, maxBytes = MAX_PCM_BYTES }) {
            if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isInteger(channels) || channels < 1 || channels > 2 || !Number.isFinite(maxSeconds) || maxSeconds <= 0 || !Number.isFinite(maxBytes) || maxBytes < channels * 4) throw new Error('Invalid PCM recording dimensions.');
            this.sampleRate = sampleRate;
            this.channels = channels;
            this.maxFrames = Math.min(Math.floor(sampleRate * maxSeconds), Math.floor(maxBytes / (channels * 4)));
            this.chunks = [];
            this.frames = 0;
            this.state = 'idle';
            this.limitReached = false;
            this.hasSignal = false;
            this.normalized = false;
            this.trimStartFrame = 0;
            this.trimEndFrame = null;
            this.normalizationGain = 1;
            this.waveform = null;
            this.selection = null;
        }

        get duration() { return this.frames / this.sampleRate; }
        get endFrame() { return this.trimEndFrame ?? this.frames; }
        get selectedFrames() { return this.endFrame - this.trimStartFrame; }

        setTrimFrames(start, end) {
            if (this.state !== 'stopped' || !this.frames || !Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Stop a non-empty recording before trimming.');
            const first = Math.max(0, Math.min(this.frames, Math.round(start)));
            const last = Math.max(first, Math.min(this.frames, Math.round(end)));
            if (first !== this.trimStartFrame || last !== this.endFrame) {
                this.trimStartFrame = first;
                this.trimEndFrame = last;
                this.normalized = false;
                this.normalizationGain = 1;
                this.selection = null;
            }
            return this;
        }

        envelope() {
            if (this.waveform?.frames === this.frames) return this.waveform;
            const stride = Math.max(1, Math.ceil(this.frames / 2048));
            const bins = Math.ceil(this.frames / stride);
            const minimum = new Float32Array(bins).fill(Infinity);
            const maximum = new Float32Array(bins).fill(-Infinity);
            let offset = 0;
            for (const chunk of this.chunks) {
                for (let frame = 0; frame < chunk[0].length; frame += 1) {
                    const bin = Math.floor((offset + frame) / stride);
                    for (const channel of chunk) {
                        minimum[bin] = Math.min(minimum[bin], channel[frame]);
                        maximum[bin] = Math.max(maximum[bin], channel[frame]);
                    }
                }
                offset += chunk[0].length;
            }
            this.waveform = { frames: this.frames, stride, minimum, maximum };
            return this.waveform;
        }

        selectionStats() {
            if (this.selection?.frames === this.frames) return this.selection;
            const { stride, minimum, maximum } = this.envelope();
            let peak = 0;
            let audible = false;
            const include = value => {
                peak = Math.max(peak, Math.abs(value));
                if (pcm16Value(value) !== 0) audible = true;
            };
            const firstFull = Math.ceil(this.trimStartFrame / stride) * stride;
            const lastFull = Math.floor(this.endFrame / stride) * stride;
            for (let frame = firstFull; frame < lastFull; frame += stride) {
                const bin = frame / stride;
                include(minimum[bin]);
                include(maximum[bin]);
            }
            let offset = 0;
            for (const chunk of this.chunks) {
                const start = Math.max(0, this.trimStartFrame - offset);
                const end = Math.min(chunk[0].length, this.endFrame - offset);
                for (let frame = start; frame < end;) {
                    const absolute = offset + frame;
                    if (absolute >= firstFull && absolute < lastFull) { frame = Math.min(end, lastFull - offset); continue; }
                    for (const channel of chunk) include(channel[frame]);
                    frame += 1;
                }
                offset += chunk[0].length;
                if (offset >= this.endFrame) break;
            }
            this.selection = { frames: this.frames, peak, audible: this.selectedFrames > 0 && audible };
            return this.selection;
        }

        selectedChunks() {
            let offset = 0;
            const chunks = [];
            for (const chunk of this.chunks) {
                const start = Math.max(0, this.trimStartFrame - offset);
                const end = Math.min(chunk[0].length, this.endFrame - offset);
                if (end > start) chunks.push(chunk.map(channel => {
                    const selected = channel.subarray(start, end);
                    return this.normalized ? Float32Array.from(selected, value => value * this.normalizationGain) : selected;
                }));
                offset += chunk[0].length;
                if (offset >= this.endFrame) break;
            }
            return chunks;
        }

        start(ring, rewindSeconds = 0, metadata = {}) {
            if (this.state !== 'idle') throw new Error('Use a new recorder for each take.');
            if (ring && (ring.sampleRate !== this.sampleRate || ring.channels !== this.channels)) throw new Error('PCM recording format changed.');
            this.metadata = Object.freeze({ ...metadata, rewindSeconds: ring ? Math.min(ring.duration, Math.max(0, Number(rewindSeconds) || 0)) : 0 });
            this.state = 'recording';
            if (ring) this.append(ring.snapshot(this.metadata.rewindSeconds));
            return this;
        }

        append(channels) {
            if (this.state !== 'recording') return;
            const frames = Math.min(channels[0]?.length || 0, this.maxFrames - this.frames);
            if (frames > 0) {
                const chunk = Array.from({ length: this.channels }, (_, channel) => {
                    const source = channels[channel] || channels[0];
                    const result = new Float32Array(frames);
                    for (let frame = 0; frame < frames; frame += 1) {
                        result[frame] = Number.isFinite(source[frame]) ? source[frame] : 0;
                        if (!this.hasSignal && pcm16Value(result[frame]) !== 0) this.hasSignal = true;
                    }
                    return result;
                });
                this.chunks.push(chunk);
                this.frames += frames;
            }
            if (this.frames >= this.maxFrames) {
                this.limitReached = true;
                this.stop();
            }
        }

        stop() {
            if (this.state === 'recording') this.state = 'stopped';
            return this;
        }

        normalize() {
            if (this.state !== 'stopped' || !this.selectedFrames || !this.selectionStats().audible) throw new Error('Stop a non-empty, audible recording before normalizing.');
            if (this.normalized) return this;
            this.normalizationGain = 1 / this.selectionStats().peak;
            this.normalized = true;
            return this;
        }

        wav() {
            if (this.state !== 'stopped' || !this.selectedFrames) throw new Error('Stop a non-empty recording before saving.');
            return encodeWav(this.chunks, this.sampleRate, this.channels, { startFrame: this.trimStartFrame, endFrame: this.endFrame, gain: this.normalized ? this.normalizationGain : 1 });
        }

        clear() {
            this.chunks.forEach(chunk => chunk.forEach(channel => channel.fill(0)));
            this.chunks = [];
            this.frames = 0;
            this.metadata = null;
            this.state = 'idle';
            this.hasSignal = false;
            this.normalized = false;
            this.trimStartFrame = 0;
            this.trimEndFrame = null;
            this.normalizationGain = 1;
            this.waveform = null;
            this.selection = null;
        }
    }

    function encodeWav(chunks, sampleRate, channels = 2, selection = {}) {
        const totalFrames = chunks.reduce((total, chunk) => total + (chunk[0]?.length || 0), 0);
        const startFrame = selection.startFrame || 0;
        const endFrame = selection.endFrame ?? totalFrames;
        const gain = selection.gain ?? 1;
        const frames = endFrame - startFrame;
        const buffer = new ArrayBuffer(44 + frames * channels * 2);
        const view = new DataView(buffer);
        const text = (offset, value) => { for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index)); };
        text(0, 'RIFF');
        view.setUint32(4, buffer.byteLength - 8, true);
        text(8, 'WAVE');
        text(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, channels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * channels * 2, true);
        view.setUint16(32, channels * 2, true);
        view.setUint16(34, 16, true);
        text(36, 'data');
        view.setUint32(40, buffer.byteLength - 44, true);
        let offset = 44;
        let chunkOffset = 0;
        for (const chunk of chunks) {
            const chunkFrames = chunk[0]?.length || 0;
            for (let frame = Math.max(0, startFrame - chunkOffset); frame < Math.min(chunkFrames, endFrame - chunkOffset); frame += 1) {
                for (let channel = 0; channel < channels; channel += 1) {
                    const value = (chunk[channel] || chunk[0])[frame];
                    view.setInt16(offset, pcm16Value(gain === 1 ? value : Math.fround(value * gain)), true);
                    offset += 2;
                }
            }
            chunkOffset += chunkFrames;
            if (chunkOffset >= endFrame) break;
        }
        return buffer;
    }

    function stationStreamUrl(station, username, base) {
        if (!username || !station || !/^[a-zA-Z0-9_-]+$/.test(station.id)) throw new Error('A signed-in station is required.');
        const origin = new URL(base);
        const url = new URL(station.streamUrl, origin);
        if (url.origin !== origin.origin || !/^https?:$/.test(url.protocol) || url.username || url.password || url.pathname !== `/mygrain/radiolab/stream/${station.id}`) throw new Error('Station relay must be an approved same-origin RADIOLAB stream.');
        url.search = '';
        url.hash = '';
        url.searchParams.set('_mygrain_user', username);
        return url.href;
    }

    function stationPriority(station) {
        const language = String(station.language || '').toLowerCase();
        const kind = String(station.kind || '').toLowerCase();
        return (/spoken|talk|news|state|public/.test(kind) ? 0 : 10) + (/russian|chinese|japanese|^(ru|zh|ja)(-|$)/.test(language) ? 0 : 3);
    }

    class S16LEPCMDecoder {
        constructor(channels = 2) {
            if (channels !== 2) throw new Error('Radio PCM must be stereo.');
            this.channels = channels;
            this.remainder = new Uint8Array(0);
        }

        decode(bytes) {
            if (!(bytes instanceof Uint8Array)) throw new Error('Invalid radio PCM bytes.');
            const joined = new Uint8Array(this.remainder.length + bytes.length);
            joined.set(this.remainder);
            joined.set(bytes, this.remainder.length);
            const frames = Math.floor(joined.length / (this.channels * 2));
            const used = frames * this.channels * 2;
            this.remainder.fill(0);
            this.remainder = joined.slice(used);
            const view = new DataView(joined.buffer, joined.byteOffset, used);
            const decoded = Array.from({ length: this.channels }, () => new Float32Array(frames));
            for (let frame = 0; frame < frames; frame += 1) {
                for (let channel = 0; channel < this.channels; channel += 1) {
                    const value = view.getInt16((frame * this.channels + channel) * 2, true);
                    decoded[channel][frame] = value / (value < 0 ? 32768 : 32767);
                }
            }
            joined.fill(0);
            return decoded;
        }

        clear() { this.remainder.fill(0); this.remainder = new Uint8Array(0); }
    }

    class SavedSampleEditor {
        constructor(host, prefix) {
            this.host = host;
            this.root = host.root;
            this.prefix = prefix;
        }

        assertCurrent(revision = this.revision) {
            this.host.assertBrowser(this.generation);
            if (!this.panel || revision !== this.revision || this.host.savedEditor !== this) throw new Error('This saved WAV editor has closed. Reopen it to try again.');
        }

        open(sample, recorder = null) {
            this.close();
            this.revision = (this.revision || 0) + 1;
            this.generation = this.host.browserEpoch;
            this.host.assertBrowser(this.generation);
            const row = this.host.sampleRows.get(sample.filename)?.row;
            if (!row) { recorder?.clear(); throw new Error('Refresh the browser, then choose this WAV again.'); }
            this.sample = sample;
            this.recorder = recorder;
            this.controls = [];
            const create = (tag, text, parent, suffix) => {
                const element = this.root.document.createElement(tag);
                if (text) element.textContent = text;
                if (suffix) element.id = `${this.prefix}Saved${suffix}`;
                parent?.append(element);
                return element;
            };
            const panel = this.panel = create('fieldset', '', row, 'Editor');
            panel.className = 'lab-saved-editor';
            create('legend', recorder ? 'Re-trim saved WAV' : 'Rename file', panel);
            create('p', recorder ? 'Preview the selected interval, then save a NEW WAV. The original file and your current take stay unchanged.' : 'Change the saved name. Existing project and Song links stay unchanged.', panel).className = 'lab-saved-editor-note';
            const label = create('label', recorder ? 'New WAV name' : 'File name', panel);
            label.htmlFor = `${this.prefix}SavedName`;
            const name = this.name = create('input', '', label, 'Name');
            name.type = 'text';
            name.maxLength = 100;
            name.value = recorder ? `${(sample.name || sample.filename.replace(/\.wav$/i, '')).slice(0, 92)} trimmed` : sample.name || sample.filename.replace(/\.wav$/i, '');
            name.autocomplete = 'off';
            this.controls.push(name);
            const act = action => this.host.run(() => { this.assertCurrent(); return action(); }, true);
            const button = (labelText, suffix, parent, action) => {
                const control = create('button', labelText, parent, suffix);
                control.type = 'button';
                control.className = 'performance-btn';
                control.addEventListener('click', () => act(action));
                this.controls.push(control);
                return control;
            };
            if (recorder) {
                this.canvas = create('canvas', '', panel, 'Waveform');
                this.canvas.height = 100;
                this.canvas.setAttribute('role', 'img');
                this.canvas.setAttribute('aria-label', 'Saved WAV waveform. Use Start and End sliders to trim.');
                const ranges = create('div', '', panel);
                ranges.className = 'lab-saved-trim-ranges';
                this.ranges = {};
                for (const boundary of ['Start', 'End']) {
                    const rangeLabel = create('label', `${boundary} · seconds`, ranges);
                    rangeLabel.htmlFor = `${this.prefix}Saved${boundary}`;
                    const input = create('input', '', rangeLabel, boundary);
                    input.type = 'range';
                    input.min = '0';
                    input.max = String(recorder.duration);
                    input.step = String(1 / recorder.sampleRate);
                    const output = create('output', '', rangeLabel, `${boundary}Value`);
                    output.setAttribute('for', input.id);
                    input.addEventListener('input', () => {
                        const seconds = Number(input.value);
                        act(() => this.setTrim(boundary, seconds));
                    });
                    this.ranges[boundary] = { input, output };
                    this.controls.push(input);
                }
                this.duration = create('output', '', panel, 'Duration');
                const previewActions = create('div', '', panel);
                previewActions.className = 'lab-saved-editor-actions';
                this.previewButton = button('Preview trim', 'Preview', previewActions, () => {
                    if (this.host.savedTrimPreview === this.recorder) this.host.stopPreview();
                    else return this.host.previewSavedTrim(this);
                });
                button('Reset trim', 'Reset', previewActions, () => { this.host.stopPreview(); recorder.setTrimFrames(0, recorder.frames); this.render(); });
            }
            const actions = create('div', '', panel);
            actions.className = 'lab-saved-editor-actions';
            this.saveButton = button(recorder ? 'Save new WAV' : 'Save name', 'Save', actions, () => recorder ? this.host.saveSavedTrim(this) : this.host.renameSavedSample(this));
            this.saveButton.className += ' primary';
            button('Cancel', 'Cancel', actions, () => this.close());
            name.addEventListener('keydown', event => {
                if (event.key === 'Enter') { event.preventDefault(); if (!this.saveButton.disabled) this.saveButton.click(); }
            });
            this.render();
            if (this.root.ResizeObserver) {
                this.observer = new this.root.ResizeObserver(() => this.drawWaveform());
                this.observer.observe(panel);
            }
            if (recorder) { panel.tabIndex = -1; panel.focus({ preventScroll: true }); }
            else name.focus({ preventScroll: true });
            panel.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
        }

        validatedName() {
            this.assertCurrent();
            const name = this.name.value.trim();
            if (!name || name.length > 100 || /[\\/\x00-\x1f\x7f]/.test(name)) throw new Error('Use a name of 1–100 characters, without slashes or control characters.');
            return name;
        }

        selectedRecorder() {
            this.assertCurrent();
            if (!this.recorder?.selectedFrames || !this.recorder.selectionStats().audible) throw new Error('Select a non-empty, audible part of this WAV.');
            return this.recorder;
        }

        setTrim(boundary, seconds) {
            this.assertCurrent();
            if (!this.recorder || !Number.isFinite(seconds)) return;
            const recorder = this.recorder;
            const frame = Math.round(seconds * recorder.sampleRate);
            const start = boundary === 'Start' ? Math.max(0, Math.min(recorder.endFrame - 1, frame)) : recorder.trimStartFrame;
            const end = boundary === 'End' ? Math.max(start + 1, Math.min(recorder.frames, frame)) : recorder.endFrame;
            this.host.stopPreview();
            recorder.setTrimFrames(start, end);
            this.render();
        }

        render(blocked = this.host.locked || this.host.closed || this.host.busy || Boolean(this.host.capture || this.host.pendingRecord || this.host.recorder?.state === 'recording')) {
            if (!this.panel) return;
            for (const control of this.controls) control.disabled = Boolean(blocked);
            if (!this.recorder) return;
            const recorder = this.recorder;
            const audible = recorder.selectedFrames > 0 && recorder.selectionStats().audible;
            this.saveButton.disabled = Boolean(blocked || !audible);
            const previewing = this.host.savedTrimPreview === recorder;
            this.previewButton.disabled = Boolean(this.host.locked || this.host.closed || (!previewing && (blocked || !audible)));
            this.previewButton.textContent = previewing ? 'Stop preview' : 'Preview trim';
            this.previewButton.setAttribute('aria-pressed', String(previewing));
            for (const [boundary, frame] of [['Start', recorder.trimStartFrame], ['End', recorder.endFrame]]) {
                const seconds = frame / recorder.sampleRate;
                this.ranges[boundary].input.value = String(seconds);
                this.ranges[boundary].input.setAttribute('aria-valuetext', `${seconds.toFixed(3)} seconds`);
                this.ranges[boundary].output.textContent = `${seconds.toFixed(3)} s`;
            }
            this.duration.textContent = `Selected: ${(recorder.selectedFrames / recorder.sampleRate).toFixed(3)} s · Original: ${recorder.duration.toFixed(3)} s`;
            this.drawWaveform();
        }

        drawWaveform() {
            if (!this.recorder || !this.canvas) return;
            const painter = this.canvas.getContext('2d');
            const bounds = this.canvas.getBoundingClientRect();
            if (!painter || !bounds.width || !bounds.height) return;
            const ratio = this.root.devicePixelRatio || 1;
            this.canvas.width = Math.round(bounds.width * ratio);
            this.canvas.height = Math.round(bounds.height * ratio);
            painter.setTransform(ratio, 0, 0, ratio, 0, 0);
            const recorder = this.recorder;
            const start = recorder.trimStartFrame / recorder.frames * bounds.width;
            const end = recorder.endFrame / recorder.frames * bounds.width;
            painter.fillStyle = '#78e0d024';
            painter.fillRect(start, 0, end - start, bounds.height);
            const { minimum, maximum, stride } = recorder.envelope();
            painter.strokeStyle = '#78e0d0';
            painter.beginPath();
            for (let bin = 0; bin < minimum.length; bin += 1) {
                const horizontal = bin * stride / recorder.frames * bounds.width;
                painter.moveTo(horizontal, bounds.height * (0.5 - maximum[bin] * 0.45));
                painter.lineTo(horizontal, bounds.height * (0.5 - minimum[bin] * 0.45));
            }
            painter.stroke();
            painter.fillStyle = '#ffc281';
            for (const horizontal of [start, end]) painter.fillRect(Math.max(0, Math.min(bounds.width - 3, horizontal)), 0, 3, bounds.height);
            this.canvas.setAttribute('aria-label', `Saved WAV waveform. Selected ${(recorder.trimStartFrame / recorder.sampleRate).toFixed(3)} to ${(recorder.endFrame / recorder.sampleRate).toFixed(3)} seconds. Use Start and End sliders to trim.`);
        }

        close() {
            if (!this.panel && !this.recorder) return;
            const panel = this.panel;
            const recorder = this.recorder;
            this.panel = this.recorder = this.sample = this.canvas = null;
            this.revision = (this.revision || 0) + 1;
            this.observer?.disconnect();
            this.observer = null;
            if (this.name) this.name.value = '';
            this.name = this.saveButton = this.previewButton = this.ranges = this.duration = null;
            this.controls = [];
            this.host.stopPreview();
            recorder?.clear();
            panel?.remove();
        }
    }

    class Controller {
        constructor(card, adapter, environment = root) {
            this.root = environment;
            this.card = card;
            this.adapter = adapter;
            this.username = environment.mygrainAccounts?.user?.username;
            this.epoch = 0;
            this.requestEpoch = 0;
            this.previewEpoch = 0;
            this.browserEpoch = 0;
            this.browserRequests = new Set();
            this.sampleRows = new Map();
            this.busy = false;
            this.locked = !this.username || !environment.mygrainAccounts?.authenticated;
            this.listening = false;
            this.pendingRecord = null;
            this.monitor = true;
            this.rewind = 0;
            this.stations = [];
            this.samples = [];
            this.requests = new Set();
            this.streamGeneration = 0;
            this.diagnosticEvents = [];
            this.dialog = environment.document.getElementById('radiolabSamplesDialog');
            this.bind();
            this.render();
            if (!this.locked) this.run(() => this.refreshStations());
        }

        element(id) { return this.root.document.getElementById(id); }

        assertActive(epoch = this.epoch) {
            if (this.locked || epoch !== this.epoch || !this.root.mygrainAccounts?.authenticated || this.username !== this.root.mygrainAccounts?.user?.username) throw new Error('RADIOLAB account session ended. Reload after login.');
        }

        get state() {
            return Object.freeze({ build: BUILD, account: this.locked ? null : this.username, locked: this.locked, listening: this.listening, monitoring: this.monitor && this.listening, armed: Boolean(this.pendingRecord), recording: this.recorder?.state === 'recording', station: this.element('radiolabStation').value || null, bufferSeconds: 0, rewindSeconds: 0, recordedSeconds: this.recorder?.duration || 0, hasTake: this.recorder?.state === 'stopped' && this.recorder.frames > 0, normalized: Boolean(this.recorder?.normalized), tap: this.tapKind || null, busy: this.busy, previewing: Boolean(this.preview), previewingTake: Boolean(this.previewTake), trimStartSeconds: this.recorder ? this.recorder.trimStartFrame / this.recorder.sampleRate : 0, trimEndSeconds: this.recorder ? this.recorder.endFrame / this.recorder.sampleRate : 0, trimmedSeconds: this.recorder ? this.recorder.selectedFrames / this.recorder.sampleRate : 0 });
        }

        mediaState() {
            const audio = this.audio;
            return audio ? { paused: audio.paused, ended: audio.ended, readyState: audio.readyState,
                networkState: audio.networkState, currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : null,
                errorCode: audio.error?.code || null } : null;
        }

        diagnosticEvent(type) {
            this.diagnosticEvents ||= [];
            this.diagnosticEvents.push({ timestamp: new Date().toISOString(), type,
                station: this.tunedStation || null, generation: this.streamGeneration,
                context: this.context?.state || null, media: this.mediaState() });
            if (this.diagnosticEvents.length > 32) this.diagnosticEvents.shift();
        }

        get diagnostics() {
            const { account, ...state } = this.state;
            return { ...state, context: this.context?.state || null, media: this.mediaState(),
                hasSignal: Boolean(this.ring?.hasSignal), takeHasSignal: Boolean(this.recorder?.hasSignal),
                capture: this.captureDiagnostics ? { ...this.captureDiagnostics } : null,
                events: (this.diagnosticEvents || []).map(event => ({ ...event, media: event.media && { ...event.media } })) };
        }

        status(message) { this.element('radiolabStatus').textContent = message; }

        async run(action, browser = false) {
            if (this.busy || this.locked) return;
            const epoch = this.epoch;
            const operation = { browser, generation: this.browserEpoch };
            this.actionOperation = operation;
            this.busy = true;
            this.render();
            try { await action(); } catch (error) {
                if (!this.locked && epoch === this.epoch && this.actionOperation === operation && (!browser || (this.dialog.open && operation.generation === this.browserEpoch))) {
                    const message = error.message || 'RADIOLAB action failed.';
                    this.status(message);
                    if (this.dialog.open) this.element('radiolabBrowserStatus').textContent = message;
                }
            }
            finally { if (epoch === this.epoch && this.actionOperation === operation) { this.actionOperation = null; this.busy = false; this.render(); } }
        }

        async request(path, options = {}, browserEpoch) {
            const epoch = this.epoch;
            this.assertActive(epoch);
            if (browserEpoch !== undefined) this.assertBrowser(browserEpoch);
            const abort = new AbortController();
            this.requests.add(abort);
            if (browserEpoch !== undefined) (this.browserRequests ||= new Set()).add(abort);
            try {
                const response = await this.root.fetch(`/mygrain/api/radiolab/${path}`, { cache: 'no-store', credentials: 'same-origin', ...options, signal: abort.signal });
                if (!response.ok) {
                    const body = await response.json().catch(() => ({}));
                    throw new Error(body.error || `RADIOLAB returned ${response.status}.`);
                }
                const result = path.startsWith('file?') ? await response.arrayBuffer() : await response.json();
                this.assertActive(epoch);
                if (browserEpoch !== undefined) this.assertBrowser(browserEpoch);
                return result;
            } finally { this.requests.delete(abort); this.browserRequests?.delete(abort); }
        }

        bind() {
            const click = (id, action, browser = false) => this.element(id).addEventListener('click', () => this.run(action, browser));
            click('radiolabListen', () => this.listen());
            click('radiolabAudition', () => this.auditionRing());
            click('radiolabRecord', () => this.record());
            this.element('radiolabStop').addEventListener('click', () => this.stop());
            this.element('radiolabPreview').addEventListener('click', () => {
                if (this.previewTake) this.stopPreview();
                else this.run(() => this.previewCurrentTake());
            });
            click('radiolabNormalize', () => this.normalizeTake());
            click('radiolabSave', () => this.save());
            this.bindTrim();
            click('radiolabBrowser', () => this.openBrowser(), true);
            click('radiolabRefreshSamples', () => this.refreshSamples(), true);
            this.element('radiolabBrowserClose').addEventListener('click', () => this.dialog.close());
            this.element('radiolabLoadTarget').addEventListener('change', () => this.render());
            this.dialog.addEventListener('close', () => {
                this.browserEpoch = (this.browserEpoch || 0) + 1;
                this.requestEpoch += 1;
                this.cancelBrowserAction();
                this.savedEditor?.close();
                this.stopPreview();
            });
            this.element('radiolabMonitor').addEventListener('click', () => {
                this.monitor = !this.monitor;
                this.syncMonitor();
                this.render();
            });
            this.element('radiolabRewind').addEventListener('input', event => this.setRewind(event.target.value));
            const wheel = this.element('radiolabWheel');
            wheel.addEventListener('wheel', event => {
                event.preventDefault();
                this.setRewind(this.rewind + Math.sign(event.deltaY) * 0.25);
            }, { passive: false });
            let pointer = null;
            wheel.addEventListener('pointerdown', event => {
                if (event.button !== 0) return;
                pointer = { id: event.pointerId, position: event.clientY, rewind: this.rewind };
                wheel.setPointerCapture(event.pointerId);
            });
            wheel.addEventListener('pointermove', event => {
                if (pointer?.id !== event.pointerId) return;
                this.setRewind(pointer.rewind + (pointer.position - event.clientY) / 12);
            });
            const release = () => { pointer = null; };
            wheel.addEventListener('pointerup', release);
            wheel.addEventListener('pointercancel', release);
            wheel.addEventListener('lostpointercapture', release);
            wheel.addEventListener('keydown', event => {
                const movement = { ArrowLeft: -0.25, ArrowDown: -0.25, ArrowRight: 0.25, ArrowUp: 0.25, PageUp: 1, PageDown: -1 };
                if (!(event.key in movement) && event.key !== 'Home' && event.key !== 'End') return;
                event.preventDefault();
                this.setRewind(event.key === 'Home' ? 0 : event.key === 'End' ? this.ring?.duration || 0 : this.rewind + movement[event.key]);
            });
            this.element('radiolabStation').addEventListener('change', () => {
                this.stop();
                this.ring?.clear();
                this.rewind = 0;
                this.status('Station selected. Press Listen / Tune to start; the finished take is unchanged.');
                this.render();
            });
            this.element('performanceBastardLoopVUseRadiolabBtn')?.addEventListener('click', () => this.run(() => this.openBrowser('V'), true));
            this.root.addEventListener('mygrain-account-lock', () => this.dispose(true));
            this.root.addEventListener('pagehide', () => this.dispose(false));
            this.root.document.addEventListener('visibilitychange', () => {
                if (this.root.document.visibilityState !== 'hidden' || this.locked || !(this.listening || this.pendingRecord || this.captureOperation)) return;
                this.stop();
                this.status('Radio stopped while this page is hidden. Captured take retained; tap Record or Listen / Tune to reconnect.');
            });
            this.root.addEventListener('pageshow', event => {
                if (!event.persisted || this.root.mygrainAccounts?.authenticated !== true || this.root.mygrainAccounts?.user?.username !== this.username) return;
                this.locked = false;
                this.status('Radio cleared while away. Press Listen / Tune to reconnect.');
                this.run(() => this.refreshStations());
            });
        }

        bindTrim() {
            for (const [id, boundary] of [['radiolabTrimStart', 'start'], ['radiolabTrimEnd', 'end']]) {
                this.element(id)?.addEventListener('input', event => this.setTrim(boundary, Number(event.target.value)));
            }
            this.element('radiolabTrimReset')?.addEventListener('click', () => this.setTrim('reset'));
            const canvas = this.element('radiolabWaveform');
            if (!canvas) return;
            canvas.addEventListener('pointerdown', event => {
                if (event.button !== 0 || !this.canTrim()) return;
                const bounds = canvas.getBoundingClientRect();
                if (!bounds.width) return;
                const recorder = this.recorder;
                const frame = Math.max(0, Math.min(recorder.frames, (event.clientX - bounds.left) / bounds.width * recorder.frames));
                const boundary = Math.abs(frame - recorder.trimStartFrame) < Math.abs(frame - recorder.endFrame) ? 'start' : 'end';
                this.trimPointer = { id: event.pointerId, boundary, recorder };
                canvas.setPointerCapture(event.pointerId);
                event.preventDefault();
                this.setTrim(boundary, frame / recorder.sampleRate);
            });
            canvas.addEventListener('pointermove', event => {
                const pointer = this.trimPointer;
                if (!pointer || event.pointerId !== pointer.id || pointer.recorder !== this.recorder || !this.canTrim()) return;
                const bounds = canvas.getBoundingClientRect();
                if (bounds.width) this.setTrim(pointer.boundary, (event.clientX - bounds.left) / bounds.width * this.recorder.duration);
                event.preventDefault();
            });
            const release = event => {
                if (event.pointerId !== this.trimPointer?.id) return;
                this.releaseTrimPointer();
            };
            for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, release);
            this.root.addEventListener('resize', () => this.drawWaveform());
        }

        releaseTrimPointer() {
            const pointer = this.trimPointer;
            this.trimPointer = null;
            const canvas = this.element('radiolabWaveform');
            if (pointer && canvas?.hasPointerCapture?.(pointer.id)) canvas.releasePointerCapture(pointer.id);
        }

        canTrim() {
            return !this.locked && this.root?.mygrainAccounts?.authenticated === true && this.username === this.root?.mygrainAccounts?.user?.username && !this.pendingRecord && this.recorder?.state === 'stopped' && this.recorder.frames > 0 && (!this.busy || Boolean(this.previewTake));
        }

        setTrim(boundary, seconds) {
            if (!this.canTrim() || (boundary !== 'reset' && !Number.isFinite(seconds))) return;
            const recorder = this.recorder;
            let start = recorder.trimStartFrame;
            let end = recorder.endFrame;
            if (boundary === 'reset') { start = 0; end = recorder.frames; }
            if (boundary === 'start') start = Math.max(0, Math.min(end - 1, Math.round(seconds * recorder.sampleRate)));
            if (boundary === 'end') end = Math.min(recorder.frames, Math.max(start + 1, Math.round(seconds * recorder.sampleRate)));
            if (start === recorder.trimStartFrame && end === recorder.endFrame) return;
            this.stopPreview();
            recorder.setTrimFrames(start, end);
            this.status('Trim updated. Preview auditions the selection; Save normalizes only the selected audio. Original take retained.');
            this.render();
        }

        renderTrim() {
            const panel = this.element('radiolabTrimPanel');
            if (!panel) return;
            const recorder = this.recorder;
            const stopped = recorder?.state === 'stopped' && recorder.frames > 0;
            panel.hidden = !stopped;
            panel.disabled = !this.canTrim();
            if (panel.disabled) this.releaseTrimPointer();
            if (!stopped) {
                this.waveformPaint = null;
                const canvas = this.element('radiolabWaveform');
                canvas?.getContext?.('2d')?.clearRect(0, 0, canvas.width, canvas.height);
                return;
            }
            const start = recorder.trimStartFrame / recorder.sampleRate;
            const end = recorder.endFrame / recorder.sampleRate;
            for (const [id, value] of [['radiolabTrimStart', start], ['radiolabTrimEnd', end]]) {
                const input = this.element(id);
                if (!input) continue;
                input.min = '0';
                input.max = String(recorder.duration);
                input.step = String(1 / recorder.sampleRate);
                input.value = String(value);
                input.setAttribute('aria-valuetext', `${value.toFixed(3)} seconds`);
            }
            this.element('radiolabTrimStartValue').textContent = `${start.toFixed(3)} s`;
            this.element('radiolabTrimEndValue').textContent = `${end.toFixed(3)} s`;
            this.element('radiolabTrimDuration').textContent = `Selected: ${((recorder.endFrame - recorder.trimStartFrame) / recorder.sampleRate).toFixed(3)} s`;
            const canvas = this.element('radiolabWaveform');
            canvas?.setAttribute('aria-label', `Recording waveform, ${recorder.duration.toFixed(3)} seconds. Selected ${start.toFixed(3)} to ${end.toFixed(3)} seconds. Use Start and End sliders to trim.`);
            if (!this.locked && !this.waveformObserver && this.root?.ResizeObserver && canvas) {
                this.waveformObserver = new this.root.ResizeObserver(() => this.drawWaveform());
                this.waveformObserver.observe(canvas);
            }
            this.drawWaveform();
        }

        drawWaveform() {
            const recorder = this.recorder;
            const canvas = this.element('radiolabWaveform');
            if (this.locked || recorder?.state !== 'stopped' || !recorder.frames || !canvas?.getContext || !canvas.getBoundingClientRect) return;
            const bounds = canvas.getBoundingClientRect();
            if (!bounds.width || !bounds.height) return;
            const ratio = this.root.devicePixelRatio || 1;
            const width = Math.max(1, Math.round(bounds.width * ratio));
            const height = Math.max(1, Math.round(bounds.height * ratio));
            const previous = this.waveformPaint;
            if (previous?.recorder === recorder && previous.width === width && previous.height === height && previous.start === recorder.trimStartFrame && previous.end === recorder.endFrame && previous.normalized === recorder.normalized) return;
            const context = canvas.getContext('2d');
            if (!context) return;
            canvas.width = width;
            canvas.height = height;
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
            context.clearRect(0, 0, bounds.width, bounds.height);
            const color = this.root.getComputedStyle?.(canvas).color || '#eee';
            context.strokeStyle = color;
            context.fillStyle = color;
            const { minimum, maximum, stride } = recorder.envelope();
            const gain = recorder.normalized ? recorder.normalizationGain : 1;
            const center = bounds.height / 2;
            const amplitude = Math.max(1, center - 12);
            context.lineWidth = 1;
            context.globalAlpha = 0.8;
            context.beginPath();
            for (let bin = 0; bin < minimum.length; bin += 1) {
                const position = (bin * stride + Math.min(stride, recorder.frames - bin * stride) / 2) / recorder.frames * bounds.width;
                context.moveTo(position, center - Math.max(-1, Math.min(1, maximum[bin] * gain)) * amplitude);
                context.lineTo(position, center - Math.max(-1, Math.min(1, minimum[bin] * gain)) * amplitude + 1);
            }
            context.stroke();
            const start = recorder.trimStartFrame / recorder.frames * bounds.width;
            const end = recorder.endFrame / recorder.frames * bounds.width;
            context.globalCompositeOperation = 'destination-out';
            context.globalAlpha = 0.75;
            context.fillRect(0, 0, start, bounds.height);
            context.fillRect(end, 0, bounds.width - end, bounds.height);
            context.globalCompositeOperation = 'source-over';
            context.globalAlpha = 0.07;
            context.fillRect(start, 0, end - start, bounds.height);
            context.globalAlpha = 1;
            context.lineWidth = 2;
            for (const position of [start, end]) {
                const visible = Math.max(1, Math.min(bounds.width - 1, position));
                context.beginPath();
                context.moveTo(visible, 0);
                context.lineTo(visible, bounds.height);
                context.stroke();
                context.fillRect(Math.max(0, Math.min(bounds.width - 10, visible - 5)), 0, 10, 12);
                context.fillRect(Math.max(0, Math.min(bounds.width - 10, visible - 5)), bounds.height - 12, 10, 12);
            }
            this.waveformPaint = { recorder, width, height, start: recorder.trimStartFrame, end: recorder.endFrame, normalized: recorder.normalized };
        }

        setRewind() {
            this.rewind = 0;
            this.render();
        }

        async refreshStations() {
            const payload = await this.request('stations');
            this.stations = (Array.isArray(payload.stations) ? payload.stations : []).filter(station => {
                try { stationStreamUrl(station, this.username, this.root.location.href); return true; } catch { return false; }
            }).sort((first, second) => stationPriority(first) - stationPriority(second) || String(first.name).localeCompare(String(second.name)));
            const select = this.element('radiolabStation');
            const previous = select.value;
            select.replaceChildren();
            for (const station of this.stations) {
                const option = this.root.document.createElement('option');
                option.value = station.id;
                option.textContent = `${station.name} · ${station.language || 'radio'} · ${station.kind || 'spoken'}`;
                select.append(option);
            }
            if (this.stations.some(station => station.id === previous)) select.value = previous;
            this.status(this.stations.length ? 'Choose a station, then Listen / Tune. Radio only; no microphone permission.' : 'No approved radio stations are available.');
        }

        prepareContext() {
            this.assertActive();
            if (!this.context || this.context.state === 'closed') {
                this.detach(true);
                const shared = this.adapter.getContext?.();
                const Context = this.root.AudioContext || this.root.webkitAudioContext;
                if (!shared && !Context) throw new Error('Web Audio is unavailable in this browser.');
                this.context = shared || new Context({ latencyHint: 'interactive' });
                this.ownsContext = !shared;
            }
            return this.context;
        }

        async ensureContext() {
            const epoch = this.epoch;
            const context = this.prepareContext();
            if (context.state !== 'running') await context.resume();
            this.assertActive(epoch);
            if (context.state !== 'running') throw new Error('Audio is still suspended. Tap Record or Listen / Tune again to enable audio.');
            return context;
        }

        isCurrentTune(operation) {
            return Boolean(operation && this.streamOperation === operation && !operation.abort.signal.aborted && !this.locked);
        }

        beginStream(clientSuffix = '') {
            if (!this.streamClient) {
                const crypto = this.root.crypto || root.crypto;
                if (!crypto?.getRandomValues) throw new Error('Secure random identifiers are unavailable. Radio was not connected.');
                this.streamClient = crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
            }
            const generation = (this.streamGeneration || 0) + 1;
            if (!Number.isSafeInteger(generation)) throw new Error('Radio retry limit reached. Reload this page.');
            this.streamGeneration = generation;
            return { abort: new AbortController(), epoch: this.epoch, client: this.streamClient + clientSuffix, generation, username: this.username, cleanups: [], ready: false };
        }

        beginTune() {
            const operation = this.beginStream();
            this.streamOperation = operation;
            return operation;
        }

        waitForTune(promise, operation) {
            return new Promise((resolve, reject) => {
                const signal = operation.abort.signal;
                const clearTimer = this.root.clearTimeout?.bind(this.root) || clearTimeout;
                let timer;
                const finish = (error, value) => {
                    clearTimer(timer);
                    signal.removeEventListener('abort', cancelled);
                    if (error) reject(error); else resolve(value);
                };
                const cancelled = () => finish(new Error('Radio tune cancelled.'));
                Promise.resolve(promise).then(value => finish(null, value), error => finish(error));
                if (signal.aborted) { cancelled(); return; }
                signal.addEventListener('abort', cancelled, { once: true });
                timer = (this.root.setTimeout?.bind(this.root) || setTimeout)(() => finish(new Error('Station connection timed out. Tap Record or Listen / Tune to retry.')), TUNE_TIMEOUT_MS);
            });
        }

        releaseStream(operation) {
            if (!operation || !this.root.fetch) return;
            const query = new URLSearchParams({ _mygrain_user: operation.username, _radiolab_client: operation.client, _radiolab_generation: String(operation.generation) });
            try {
                Promise.resolve(this.root.fetch(`/mygrain/api/radiolab/stream/release?${query}`, {
                    method: 'POST', credentials: 'same-origin', cache: 'no-store', keepalive: true,
                    headers: { 'X-Mygrain-User': operation.username }, body: ''
                })).catch(() => {});
            } catch {}
        }

        prepareMedia(station, context, operation) {
            if (!this.audio) {
                this.audio = new this.root.Audio();
                this.audio.preload = 'none';
                this.audio.autoplay = false;
                this.audio.loop = false;
                this.audio.setAttribute('playsinline', '');
            }
            const audio = this.audio;
            if (!this.source) this.source = context.createMediaElementSource(audio);
            const url = new URL(stationStreamUrl(station, this.username, this.root.location.href));
            url.searchParams.set('_radiolab_client', operation.client);
            url.searchParams.set('_radiolab_generation', String(operation.generation));
            audio.src = url.href;
            audio.load();
            const on = (target, type, handler) => {
                target.addEventListener(type, handler);
                operation.cleanups.push(() => target.removeEventListener(type, handler));
            };
            this.tunedStation = station.id;
            this.diagnosticEvent('tune');
            for (const type of ['loadstart', 'loadedmetadata', 'canplay', 'playing', 'stalled']) {
                on(audio, type, () => { if (this.isCurrentTune(operation)) this.diagnosticEvent(type); });
            }
            on(audio, 'error', () => {
                if (!this.isCurrentTune(operation) || !audio.error) return;
                this.diagnosticEvent('error');
                this.interruptMonitor('Station could not play. The relay or codec may be unavailable; choose another station and Listen / Tune.');
            });
            on(audio, 'ended', () => {
                if (!this.isCurrentTune(operation) || !this.listening || !audio.ended) return;
                this.diagnosticEvent('ended');
                this.interruptMonitor(`Station stream ended. ${this.recorder?.hasSignal ? 'Captured take retained.' : 'No audible take was captured.'} Press Record or Listen / Tune to reconnect.`);
            });
            on(audio, 'waiting', () => {
                if (this.isCurrentTune(operation)) this.diagnosticEvent('waiting');
                if (this.isCurrentTune(operation) && this.listening && !this.captureOperation) this.status('Radio monitoring is buffering. Manual recording uses an independent live connection.');
            });
            on(context, 'statechange', () => {
                if (this.isCurrentTune(operation)) this.diagnosticEvent('context-state');
                if (!operation.ready || !this.isCurrentTune(operation) || context.state === 'running') return;
                this.interruptMonitor('Radio audio was interrupted or suspended. Captured take retained; tap Record or Listen / Tune to reconnect.');
            });
            this.ring?.clear();
            this.ring = new PCMBufferRing({ sampleRate: context.sampleRate });
            this.monitorGain = context.createGain();
            this.monitorGain.gain.value = 0;
            this.source.connect(this.monitorGain);
            this.monitorGain.connect(context.destination);
            this.silentGain = context.createGain();
            this.silentGain.gain.value = 0;
            this.silentGain.connect(context.destination);
            this.tunedStation = station.id;
            return audio;
        }

        async createTap(context, operation) {
            let workletError;
            if (context.audioWorklet && this.root.AudioWorkletNode) {
                try {
                    await context.audioWorklet.addModule(new URL(`radiolab-worklet.js?v=${BUILD}`, this.root.document.baseURI).href);
                    if (!this.isCurrentTune(operation)) return;
                    const tap = new this.root.AudioWorkletNode(context, 'mygrain-radiolab-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
                    tap.port.onmessage = event => {
                        if (!this.isCurrentTune(operation) || this.tap !== tap) return;
                        if (event.data.type === 'overflow') {
                            this.interruptMonitor('Radio monitor stopped: the browser could not deliver PCM in time. Listen / Tune to retry.');
                            return;
                        }
                        if (event.data.type !== 'pcm') return;
                        tap.port.postMessage({ type: 'ack' });
                        this.acceptPCM(event.data.channels);
                    };
                    tap.onprocessorerror = () => {
                        if (!this.isCurrentTune(operation) || this.tap !== tap) return;
                        this.interruptMonitor('Radio PCM tap failed. Captured audio is retained; press Listen / Tune to retry.');
                    };
                    this.tap = tap;
                    this.tapKind = 'AudioWorklet';
                } catch (error) { workletError = error; }
            }
            if (!this.isCurrentTune(operation)) return;
            if (!this.tap) {
                if (!context.createScriptProcessor) throw workletError || new Error('No supported PCM tap. This browser cannot record radio.');
                this.tap = context.createScriptProcessor(1024, 2, 2);
                const tap = this.tap;
                tap.onaudioprocess = event => {
                    for (let channel = 0; channel < event.outputBuffer.numberOfChannels; channel += 1) event.outputBuffer.getChannelData(channel).fill(0);
                    if (!this.isCurrentTune(operation) || this.tap !== tap || !this.listening) return;
                    this.acceptPCM(Array.from({ length: event.inputBuffer.numberOfChannels }, (_, channel) => event.inputBuffer.getChannelData(channel)));
                };
                this.tapKind = 'ScriptProcessor fallback';
            }
            this.source.connect(this.tap);
            this.tap.connect(this.silentGain);
            this.tap?.port?.postMessage({ type: 'capture', enabled: true });
        }

        async listen() {
            const epoch = this.epoch;
            this.assertActive(epoch);
            this.stopPreview();
            const station = this.stations.find(item => item.id === this.element('radiolabStation').value);
            if (!station) throw new Error('Choose an approved station first.');
            this.stopListening();
            let operation;
            try {
                const context = this.prepareContext();
                operation = this.beginTune();
                const resumed = this.ensureContext();
                resumed.catch(() => {});
                const audio = this.prepareMedia(station, context, operation);
                this.assertActive(epoch);
                this.rewind = 0;
                this.listening = true;
                this.syncMonitor();
                const playing = audio.play();
                const tapReady = this.createTap(context, operation);
                this.render();
                await this.waitForTune(Promise.all([resumed, tapReady, playing]), operation);
                this.assertActive(epoch);
                if (!this.isCurrentTune(operation)) return;
                if (context.state !== 'running') throw new Error('Audio is still suspended. Tap Record or Listen / Tune again to enable audio.');
                operation.ready = true;
                this.tap?.port?.postMessage({ type: 'capture', enabled: true });
                if (!this.captureOperation && this.recorder?.state !== 'recording') this.status(`Listening to ${station.name}. Press Record for an independent live take; capture may lag monitoring.`);
            } catch (error) {
                if (this.isCurrentTune(operation)) this.stopListening();
                throw error;
            }
        }

        syncMonitor() {
            if (this.monitorGain && this.context?.state !== 'closed') this.monitorGain.gain.setValueAtTime(this.monitor && this.listening && !this.preview ? 0.8 : 0, this.context.currentTime);
        }

        acceptPCM(channels) {
            if (this.locked || !this.listening || this.audio?.paused || this.audio?.readyState < 2 || !channels[0]?.length) return;
            this.ring.append(channels);
            const now = Date.now();
            if (!this.lastPaint || now - this.lastPaint > 100) { this.render(); this.lastPaint = now; }
        }

        async record() {
            const epoch = this.epoch;
            this.assertActive(epoch);
            if (this.pendingRecord || this.recorder?.state === 'recording') return;
            const station = this.stations.find(item => item.id === this.element('radiolabStation').value);
            if (!station) throw new Error('Choose an approved station first.');
            this.stopPreview();
            const operation = this.beginStream('-pcm');
            operation.station = { id: station.id, name: station.name };
            this.captureOperation = operation;
            this.pendingRecord = operation;
            this.captureDiagnostics = { path: 'server-pcm-fetch', state: 'connecting', bytes: 0, sampleRate: null, channels: null };
            this.diagnosticEvent('capture-connect');
            this.status('Connecting independent live recording. Previous take retained until audio arrives; capture may lag monitoring.');
            this.render();
            try {
                this.armCaptureDeadline(operation);
                const url = new URL(stationStreamUrl(station, this.username, this.root.location.href));
                url.searchParams.set('_radiolab_format', 'pcm');
                url.searchParams.set('_radiolab_client', operation.client);
                url.searchParams.set('_radiolab_generation', String(operation.generation));
                const response = await this.waitForTune(this.root.fetch(url.href, {
                    cache: 'no-store', credentials: 'same-origin', signal: operation.abort.signal,
                    headers: { 'X-Mygrain-User': this.username }
                }), operation);
                this.assertActive(epoch);
                if (!this.isCurrentCapture(operation)) return;
                if (!response.ok) throw new Error(response.status === 429 ? 'Radio recording capacity is full. Close or stop another radio tab, then retry Record. Previous take retained.' : `Radio recording relay returned ${response.status}. Retry or choose another station; previous take retained.`);
                const sampleRate = Number(response.headers.get('X-Radiolab-Sample-Rate'));
                const channels = Number(response.headers.get('X-Radiolab-Channels'));
                if (sampleRate !== 44100 || channels !== 2 || !response.headers.get('Content-Type')?.toLowerCase().startsWith('application/octet-stream')) throw new Error('Radio relay did not provide the required stereo PCM format. Previous take retained.');
                if (!response.body?.getReader) throw new Error('Streaming radio recording is unavailable in this browser. Previous take retained.');
                operation.reader = response.body.getReader();
                operation.decoder = new S16LEPCMDecoder(channels);
                operation.sampleRate = sampleRate;
                Object.assign(this.captureDiagnostics, { state: 'waiting-for-signal', sampleRate, channels });
                operation.done = this.receiveCapture(operation).catch(error => this.failCapture(operation, error));
            } catch (error) {
                if (this.isCurrentCapture(operation)) this.failCapture(operation, error);
            }
            this.render();
        }

        isCurrentCapture(operation) {
            return Boolean(operation && this.captureOperation === operation && !operation.abort.signal.aborted && !this.locked && operation.epoch === this.epoch);
        }

        armCaptureDeadline(operation) {
            const clearTimer = this.root.clearTimeout?.bind(this.root) || clearTimeout;
            const setTimer = this.root.setTimeout?.bind(this.root) || setTimeout;
            clearTimer(operation.timer);
            operation.timer = setTimer(() => this.failCapture(operation, new Error(operation.recorder ? 'Radio recording stalled. Captured take retained; reconnect to record again.' : 'No station audio arrived within 12 seconds. Previous take retained; retry or choose another station.')), TUNE_TIMEOUT_MS);
        }

        async receiveCapture(operation) {
            while (this.isCurrentCapture(operation)) {
                const { value, done } = await operation.reader.read();
                if (!this.isCurrentCapture(operation)) return;
                this.assertActive(operation.epoch);
                if (done) {
                    if (operation.decoder.remainder.length) throw new Error('Radio PCM ended inside an audio frame. Captured take retained; retry to start a new take.');
                    if (!operation.recorder) throw new Error('Radio recording ended without audible PCM. Previous take retained; choose another station.');
                    this.closeCapture('ended');
                    operation.recorder.stop();
                    this.status(`Recording stream ended: ${operation.recorder.duration.toFixed(2)}s retained. Save when ready.`);
                    this.render();
                    return;
                }
                if (!value?.length) continue;
                this.captureDiagnostics.bytes += value.length;
                for (let offset = 0; offset < value.length; offset += 65536) {
                    const channels = operation.decoder.decode(value.subarray(offset, offset + 65536));
                    const signal = channels.some(channel => channel.some(sample => pcm16Value(sample) !== 0));
                    if (!operation.recorder && signal) this.startRecording(operation);
                    if (operation.recorder && channels[0].length) {
                        operation.recorder.append(channels);
                        this.armCaptureDeadline(operation);
                        if (operation.recorder.limitReached) {
                            this.stop();
                            this.captureDiagnostics.state = 'limit';
                            this.status(`Safety limit reached at ${operation.recorder.duration.toFixed(2)}s. Take stopped; Save when ready.`);
                            return;
                        }
                    }
                }
                if (!operation.recorder && this.captureDiagnostics.bytes >= operation.sampleRate * 4 * TUNE_TIMEOUT_MS / 1000) {
                    throw new Error('Station supplied only digital silence. Previous take retained; choose another station.');
                }
                const now = Date.now();
                if (!this.lastCapturePaint || now - this.lastCapturePaint > 100) { this.render(); this.lastCapturePaint = now; }
            }
        }

        startRecording(operation) {
            if (!this.isCurrentCapture(operation) || this.pendingRecord !== operation) return;
            this.pendingRecord = null;
            this.recorder?.clear();
            this.recorder = operation.recorder = new PCMRecorder({ sampleRate: operation.sampleRate });
            this.recorder.start(null, 0, { station: operation.station, capturePath: 'server-pcm-fetch' });
            this.captureDiagnostics.state = 'recording';
            this.diagnosticEvent('capture-signal');
            this.element('radiolabName').value = `Radio ${operation.station.name} ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`;
            this.status('Recording independent live station PCM until Stop. No rewind or pre-roll; capture may lag monitoring. Limit 120s / 32 MiB PCM.');
            this.render();
        }

        closeCapture(state = 'stopped') {
            const operation = this.captureOperation;
            if (!operation) return;
            this.captureOperation = null;
            if (this.pendingRecord === operation) this.pendingRecord = null;
            (this.root.clearTimeout?.bind(this.root) || clearTimeout)(operation.timer);
            operation.abort.abort();
            try { Promise.resolve(operation.reader?.cancel()).catch(() => {}); } catch {}
            operation.decoder?.clear();
            this.releaseStream(operation);
            if (this.captureDiagnostics) this.captureDiagnostics.state = state;
            this.diagnosticEvent(`capture-${state}`);
        }

        failCapture(operation, error) {
            if (!this.isCurrentCapture(operation)) return;
            this.closeCapture('failed');
            operation.recorder?.stop();
            this.status(error.message || 'Radio recording failed. Previous audio retained; retry or choose another station.');
            this.render();
        }

        stopListening() {
            this.listening = false;
            this.syncMonitor();
            this.detach();
        }

        interruptMonitor(message) {
            if (this.captureOperation) {
                this.stopListening();
                this.status(`${message} Independent recording remains connected.`);
                this.render();
            } else {
                this.stop();
                this.status(message);
            }
        }

        stop() {
            const armed = Boolean(this.pendingRecord);
            this.closeCapture();
            this.epoch += 1;
            this.pendingRecord = null;
            this.busy = false;
            const recording = this.recorder?.state === 'recording';
            this.recorder?.stop();
            this.stopListening();
            this.stopPreview();
            this.status(recording && !this.recorder.hasSignal
                ? this.recorder.frames ? 'This take contains only digital silence; nothing audible was captured. Choose another station and record again.' : 'No live PCM arrived before Stop; no audible take was captured. Press Record to try again.'
                : recording ? `Take stopped: ${this.recorder.duration.toFixed(2)}s of raw PCM. Save with a name; no loop or tempo processing.` : armed ? 'Record cancelled — no new audio captured. Previous take retained.' : 'Radio stopped. Finished take retained; Record starts a new live capture.');
            this.render();
        }

        async playPCM(channels, sampleRate, previewEpoch = this.previewEpoch, chunks = null) {
            const epoch = this.epoch;
            const context = await this.ensureContext();
            this.assertActive(epoch);
            if (previewEpoch !== this.previewEpoch) return;
            const blocks = chunks || [channels];
            const frames = blocks.reduce((total, block) => total + (block[0]?.length || 0), 0);
            if (!frames) throw new Error('A non-empty recording is required for preview.');
            const buffer = context.createBuffer(blocks[0].length, frames, sampleRate);
            let offset = 0;
            for (const block of blocks) {
                block.forEach((channel, index) => buffer.copyToChannel(channel, index, offset));
                offset += block[0].length;
            }
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.loop = false;
            source.connect(context.destination);
            this.preview = source;
            this.syncMonitor();
            source.onended = () => { if (this.preview === source) this.stopPreview(); };
            try { source.start(); } catch (error) { this.stopPreview(false); throw error; }
            this.render();
        }

        currentTake() {
            this.assertActive();
            if (this.pendingRecord || this.recorder?.state !== 'stopped' || !this.recorder.selectedFrames || !this.recorder.selectionStats().audible) throw new Error('Stop a non-empty, audible recording before previewing or normalizing.');
            return this.recorder;
        }

        async previewCurrentTake() {
            const recorder = this.currentTake();
            this.stopPreview();
            const previewEpoch = this.previewEpoch;
            this.previewTake = recorder;
            if (this.actionOperation) this.actionOperation.previewEpoch = previewEpoch;
            this.render();
            try {
                const chunks = recorder.selectedChunks();
                await this.playPCM(chunks[0], recorder.sampleRate, previewEpoch, chunks);
            } finally {
                if (previewEpoch === this.previewEpoch && !this.preview) this.stopPreview(false);
            }
        }

        normalizeTake() {
            const recorder = this.currentTake();
            this.stopPreview();
            recorder.normalize();
            this.status('Selected take normalized to peak 1.0 (0 dBFS). Stereo balance, timing and sample rate are unchanged; original audio is retained. Save uses this normalized selection.');
            this.render();
        }

        async auditionRing() {
            throw new Error('Radio rewind is unavailable. Record captures live audio from now until Stop.');
        }

        stopPreview(cancelPending = true) {
            if (cancelPending && this.actionOperation?.previewEpoch === this.previewEpoch) {
                this.actionOperation = null;
                this.busy = false;
            }
            this.previewEpoch += 1;
            this.previewFilename = null;
            this.previewTake = null;
            this.savedTrimPreview = null;
            if (this.preview) {
                this.preview.onended = null;
                try { this.preview.stop(); } catch {}
                this.preview.disconnect();
                this.preview = null;
            }
            this.syncMonitor();
            this.render();
        }

        async save() {
            this.assertActive();
            const name = this.element('radiolabName').value.trim();
            if (!name) throw new Error('Give this recording a name before saving.');
            if (this.pendingRecord || !this.recorder || this.recorder.state !== 'stopped') throw new Error('Stop recording before saving.');
            if (!this.recorder.hasSignal) throw new Error('This take contains only digital silence; nothing audible was captured. Choose another station and record again.');
            if (!this.recorder.selectedFrames || !this.recorder.selectionStats().audible) throw new Error('Select a non-empty, audible part of the recording before saving.');
            this.stopPreview();
            this.recorder.normalize();
            this.render();
            const params = new URLSearchParams({ name, station: this.recorder.metadata.station.id });
            const result = await this.request(`samples?${params}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: this.recorder.wav() });
            if (!result.sample) throw new Error('Radio storage did not confirm the saved sample. The take is retained; retry Save.');
            this.status(`Saved “${result.sample.name || name}” to your private SAMPLES_RADIOLAB. Use Browser to play or load the complete file.`);
            this.samples = [];
        }

        async openBrowser(target) {
            this.assertActive();
            if (target) this.element('radiolabLoadTarget').value = target;
            if (!this.dialog.open) {
                this.samples = [];
                this.renderSamples();
                this.dialog.showModal();
            }
            await this.refreshSamples();
        }

        assertBrowser(generation = this.browserEpoch) {
            this.assertActive();
            if (!this.dialog.open || generation !== this.browserEpoch) throw new Error('RADIOLAB browser closed. Reopen it to try again.');
        }

        cancelBrowserAction() {
            this.browserRequests?.forEach(abort => abort.abort());
            this.browserRequests?.clear();
            if (this.actionOperation?.browser) {
                this.actionOperation = null;
                this.busy = false;
            }
        }

        async refreshSamples() {
            const browserEpoch = this.browserEpoch;
            this.assertBrowser(browserEpoch);
            const generation = ++this.requestEpoch;
            this.stopPreview();
            this.element('radiolabBrowserStatus').textContent = 'Loading private recordings…';
            const payload = await this.request('samples', {}, browserEpoch);
            this.assertBrowser(browserEpoch);
            if (generation !== this.requestEpoch) return;
            this.samples = (Array.isArray(payload.samples) ? payload.samples : []).filter(sample => typeof sample?.filename === 'string' && sample.filename);
            this.renderSamples();
            this.element('radiolabBrowserStatus').textContent = `${this.samples.length} private sample${this.samples.length === 1 ? '' : 's'} · SAMPLES_RADIOLAB. Play is one-shot; Load never starts playback.`;
            this.render();
        }

        renderSamples() {
            this.savedEditor?.close();
            const list = this.element('radiolabSampleList');
            list.replaceChildren();
            this.sampleRows ||= new Map();
            this.sampleRows.clear();
            if (!this.samples.length) {
                const empty = this.root.document.createElement('p');
                empty.className = 'radiolab-sample-empty';
                empty.textContent = 'No saved radio recordings. Record a take, Stop, then Save with a name.';
                list.append(empty);
            }
            for (const sample of this.samples) {
                const row = this.root.document.createElement('article');
                row.className = 'sample-browser-card radiolab-sample-row';
                row.dataset.filename = sample.filename;
                row.setAttribute('aria-label', sample.name || sample.filename);
                const name = this.root.document.createElement('h3');
                name.className = 'sample-browser-name radiolab-sample-name';
                name.textContent = sample.name || sample.filename;
                const details = this.root.document.createElement('p');
                details.className = 'sample-browser-path radiolab-sample-details';
                const duration = sample.duration == null ? NaN : Number(sample.duration);
                details.textContent = `${sample.downloadName || sample.filename}${Number.isFinite(duration) && duration >= 0 ? ` · ${duration.toFixed(2)}s` : ''}`;
                const actions = this.root.document.createElement('div');
                actions.className = 'sample-browser-card-actions radiolab-sample-actions';
                const controls = { row };
                for (const action of ['play', 'load', 'rename', 'trim', 'delete']) {
                    const button = this.root.document.createElement('button');
                    button.type = 'button';
                    button.className = `performance-btn${action === 'load' ? ' primary' : ''}`;
                    button.dataset.action = action;
                    button.addEventListener('click', () => {
                        if (action === 'play' && this.previewFilename === sample.filename) {
                            this.cancelBrowserAction();
                            this.stopPreview();
                            return;
                        }
                        const method = { play: 'playSample', load: 'loadSample', rename: 'editSampleName', trim: 'trimSample', delete: 'deleteSample' }[action];
                        this.run(() => this[method](sample), true);
                    });
                    controls[action] = button;
                    actions.append(button);
                }
                row.append(name, details, actions);
                list.append(row);
                this.sampleRows.set(sample.filename, controls);
            }
            this.render();
        }

        async sampleBody(sample, browserEpoch) {
            const body = await this.request(`file?${new URLSearchParams({ name: sample.filename })}`, {}, browserEpoch);
            if (pcmWavHasSignal(body) === false) throw new Error('This saved sample contains only digital silence; Play and Load cannot restore audio that was not captured. Choose another station and record again.');
            return body;
        }

        async playSample(sample) {
            const epoch = this.epoch;
            const browserEpoch = this.browserEpoch;
            this.assertBrowser(browserEpoch);
            this.stopPreview();
            const previewEpoch = this.previewEpoch;
            this.previewFilename = sample.filename;
            this.render();
            try {
                const context = await this.ensureContext();
                if (previewEpoch !== this.previewEpoch || !this.dialog.open) return;
                this.assertBrowser(browserEpoch);
                const body = await this.sampleBody(sample, browserEpoch);
                if (previewEpoch !== this.previewEpoch || !this.dialog.open) return;
                this.assertBrowser(browserEpoch);
                const buffer = await context.decodeAudioData(body);
                this.assertActive(epoch);
                if (previewEpoch !== this.previewEpoch || !this.dialog.open) return;
                this.assertBrowser(browserEpoch);
                await this.playPCM(Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel)), buffer.sampleRate, previewEpoch);
            } finally {
                if (previewEpoch === this.previewEpoch && !this.preview) this.stopPreview();
            }
        }

        async loadSample(sample) {
            const epoch = this.epoch;
            const browserEpoch = this.browserEpoch;
            this.assertBrowser(browserEpoch);
            const target = this.element('radiolabLoadTarget').value;
            const body = await this.sampleBody(sample, browserEpoch);
            this.assertActive(epoch);
            this.assertBrowser(browserEpoch);
            this.stopPreview();
            await this.adapter.load(body, sample, target, () => { this.assertActive(epoch); this.assertBrowser(browserEpoch); });
            this.assertActive(epoch);
            this.assertBrowser(browserEpoch);
            this.element('radiolabBrowserStatus').textContent = `Loaded complete “${sample.name || sample.filename}” into ${target === 'V' ? 'Loop V' : target}. Playback was not started.`;
        }

        async deleteSample(sample) {
            const browserEpoch = this.browserEpoch;
            this.assertBrowser(browserEpoch);
            if (!this.root.confirm(`Delete “${sample.name || sample.filename}” (${sample.filename}) from your private SAMPLES_RADIOLAB? This cannot be undone.`)) return;
            this.assertBrowser(browserEpoch);
            if (this.previewFilename === sample.filename) this.stopPreview();
            await this.request(`samples?${new URLSearchParams({ name: sample.filename })}`, { method: 'DELETE' }, browserEpoch);
            this.assertBrowser(browserEpoch);
            this.requestEpoch += 1;
            const index = this.samples.findIndex(item => item.filename === sample.filename);
            this.samples = this.samples.filter(item => item.filename !== sample.filename);
            this.renderSamples();
            this.element('radiolabBrowserStatus').textContent = `Deleted ${sample.filename} from your private SAMPLES_RADIOLAB.`;
            const next = this.samples[Math.min(index, this.samples.length - 1)];
            (this.sampleRows.get(next?.filename)?.delete || this.element('radiolabRefreshSamples')).focus();
        }

        editSampleName(sample) {
            this.assertBrowser();
            this.stopPreview();
            this.savedEditor ||= new SavedSampleEditor(this, 'radiolab');
            this.savedEditor.open(sample);
        }

        async trimSample(sample) {
            const generation = this.browserEpoch;
            this.assertBrowser(generation);
            this.savedEditor?.close();
            this.stopPreview();
            const previewEpoch = this.previewEpoch;
            this.element('radiolabBrowserStatus').textContent = `Opening “${sample.name || sample.filename}” for re-trim…`;
            const context = await this.ensureContext();
            this.assertBrowser(generation);
            if (previewEpoch !== this.previewEpoch) return;
            const body = await this.sampleBody(sample, generation);
            if (previewEpoch !== this.previewEpoch) return;
            const buffer = await context.decodeAudioData(body);
            this.assertBrowser(generation);
            if (previewEpoch !== this.previewEpoch) return;
            if (!Number.isInteger(buffer?.length) || buffer.length < 1 || ![1, 2].includes(buffer.numberOfChannels) || !Number.isFinite(buffer.sampleRate) || buffer.sampleRate < 1 || buffer.sampleRate > 192000 || buffer.length / buffer.sampleRate > MAX_RECORD_SECONDS) throw new Error('Choose a finite mono/stereo radio WAV of at most 120 seconds.');
            const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
            if (channels.some(channel => channel.some(value => !Number.isFinite(value)))) throw new Error('This saved WAV contains invalid PCM samples.');
            const recorder = new PCMRecorder({ sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels }).start(null, 0, { station: sample.station });
            recorder.append(channels);
            recorder.stop();
            if (recorder.frames !== buffer.length || !recorder.hasSignal) { recorder.clear(); throw new Error('Choose a non-empty, audible saved WAV to re-trim.'); }
            this.savedEditor ||= new SavedSampleEditor(this, 'radiolab');
            this.savedEditor.open(sample, recorder);
            this.element('radiolabBrowserStatus').textContent = 'Re-trim ready. Preview is manual; Save new WAV keeps the original and current take unchanged.';
        }

        async previewSavedTrim(editor) {
            const recorder = editor.selectedRecorder();
            this.stopPreview();
            const previewEpoch = this.previewEpoch;
            this.savedTrimPreview = recorder;
            if (this.actionOperation) this.actionOperation.previewEpoch = previewEpoch;
            this.render();
            try {
                const chunks = recorder.selectedChunks();
                await this.playPCM(chunks[0], recorder.sampleRate, previewEpoch, chunks);
            } finally {
                if (previewEpoch === this.previewEpoch && !this.preview) this.stopPreview(false);
            }
        }

        async renameSavedSample(editor) {
            const name = editor.validatedName();
            const revision = editor.revision;
            const generation = editor.generation;
            const filename = editor.sample.filename;
            this.stopPreview();
            const result = await this.request('rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename, name }) }, generation);
            editor.assertCurrent(revision);
            if (result.sample?.filename !== filename || typeof result.sample.name !== 'string' || (editor.sample.url && result.sample.url && result.sample.url !== editor.sample.url)) throw new Error('Storage did not confirm a safe name change with the same source link. Refresh the browser before retrying.');
            this.requestEpoch += 1;
            this.samples = this.samples.map(sample => sample.filename === filename ? { ...sample, ...result.sample } : sample);
            this.renderSamples();
            this.element('radiolabBrowserStatus').textContent = `Renamed to “${result.sample.name}”. Existing project and Song links are unchanged.`;
            this.sampleRows.get(result.sample.filename)?.rename.focus();
        }

        async saveSavedTrim(editor) {
            const name = editor.validatedName();
            const revision = editor.revision;
            const recorder = editor.selectedRecorder();
            const generation = editor.generation;
            const original = editor.sample.filename;
            this.stopPreview();
            recorder.normalize();
            const params = new URLSearchParams({ name, sourceFilename: original });
            const result = await this.request(`samples?${params}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: recorder.wav() }, generation);
            editor.assertCurrent(revision);
            if (!result.sample?.filename || result.sample.filename === original) throw new Error('Storage did not confirm a NEW WAV. The original and trim are retained; refresh before retrying.');
            this.requestEpoch += 1;
            this.samples = [result.sample, ...this.samples];
            this.renderSamples();
            this.element('radiolabBrowserStatus').textContent = `Saved new WAV “${result.sample.name || name}”. Original file and current take are unchanged.`;
            this.sampleRows.get(result.sample.filename)?.trim.focus();
        }

        detach(discardMedia = false) {
            const operation = this.streamOperation;
            if (operation) this.diagnosticEvent('detach');
            this.streamOperation = null;
            operation?.abort.abort();
            operation?.cleanups.forEach(cleanup => cleanup());
            if (this.audio) {
                this.audio.pause();
                this.audio.removeAttribute('src');
                this.audio.load();
            }
            this.releaseStream(operation);
            if (this.tap?.port) { this.tap.port.onmessage = null; this.tap.port.postMessage({ type: 'dispose' }); this.tap.port.close(); }
            if (this.tap) { this.tap.onaudioprocess = null; this.tap.onprocessorerror = null; }
            for (const node of [this.source, this.tap, this.monitorGain, this.silentGain]) { try { node?.disconnect(); } catch {} }
            this.tap = this.monitorGain = this.silentGain = null;
            if (discardMedia) this.audio = this.source = null;
            this.tunedStation = null;
            this.tapKind = null;
        }

        dispose(accountLock) {
            this.waveformObserver?.disconnect();
            this.waveformObserver = null;
            this.waveformPaint = null;
            this.releaseTrimPointer();
            this.closeCapture('disposed');
            this.locked = true;
            this.pendingRecord = null;
            this.busy = false;
            this.epoch += 1;
            this.requestEpoch += 1;
            this.requests.forEach(abort => abort.abort());
            this.requests.clear();
            this.savedEditor?.close();
            this.listening = false;
            this.stopPreview();
            this.detach(true);
            this.diagnosticEvents = [];
            this.captureDiagnostics = null;
            if (this.ownsContext && this.context?.state !== 'closed') { try { Promise.resolve(this.context.close()).catch(() => {}); } catch {} }
            this.context = null;
            this.ring?.clear();
            this.ring = null;
            this.recorder?.clear();
            this.recorder = null;
            this.samples = [];
            this.sampleRows?.clear();
            this.stations = [];
            this.rewind = 0;
            this.element('radiolabSampleList').replaceChildren();
            this.element('radiolabStation').replaceChildren();
            this.element('radiolabName').value = '';
            this.element('radiolabBrowserStatus').textContent = '';
            if (this.dialog.open) this.dialog.close();
            this.status(accountLock ? 'RADIOLAB locked. Private audio and buffer cleared.' : 'RADIOLAB stopped and cleared while this page is away.');
            this.render();
        }

        render() {
            const recording = this.recorder?.state === 'recording';
            const armed = Boolean(this.pendingRecord);
            const capturing = recording || armed;
            const blocked = this.locked || this.busy;
            const rewind = this.element('radiolabRewind');
            rewind.value = 0;
            rewind.disabled = true;
            rewind.setAttribute('aria-valuetext', 'Live recording only; rewind unavailable');
            this.element('radiolabRewindValue').textContent = 'Live recording only — no rewind or pre-roll.';
            const wheel = this.element('radiolabWheel');
            wheel.style.setProperty('--radiolab-turn', '0deg');
            wheel.setAttribute('aria-valuenow', '0');
            wheel.setAttribute('aria-valuetext', 'Live recording only; rewind unavailable');
            wheel.setAttribute('aria-disabled', 'true');
            this.element('radiolabStation').disabled = this.locked || (this.busy && !this.streamOperation) || capturing || !this.stations.length;
            this.element('radiolabListen').disabled = blocked || capturing || this.listening || !this.stations.length;
            this.element('radiolabMonitor').disabled = this.locked;
            this.element('radiolabMonitor').setAttribute('aria-pressed', String(this.monitor));
            this.element('radiolabMonitor').textContent = this.monitor ? 'Monitor On' : 'Monitor Off';
            this.element('radiolabRecord').disabled = blocked || capturing || !this.stations.some(station => station.id === this.element('radiolabStation').value);
            this.element('radiolabRecord').textContent = armed ? 'Waiting for audio…' : recording ? 'Recording…' : 'Record';
            this.element('radiolabRecord').setAttribute('aria-pressed', String(capturing));
            this.element('radiolabAudition').disabled = true;
            this.element('radiolabStop').disabled = this.locked || !(this.listening || capturing || this.preview || this.busy);
            const playableTake = this.recorder?.state === 'stopped' && this.recorder.selectedFrames > 0 && this.recorder.selectionStats().audible;
            this.element('radiolabSave').disabled = blocked || capturing || !playableTake;
            const preview = this.element('radiolabPreview');
            preview.textContent = this.previewTake ? 'Stop Preview' : 'Preview';
            preview.setAttribute('aria-pressed', String(Boolean(this.previewTake)));
            preview.disabled = this.locked || capturing || !playableTake || (this.busy && !this.previewTake);
            const normalize = this.element('radiolabNormalize');
            normalize.textContent = this.recorder?.normalized ? 'Normalized' : 'Normalize';
            normalize.setAttribute('aria-pressed', String(Boolean(this.recorder?.normalized)));
            normalize.disabled = blocked || capturing || !playableTake || Boolean(this.recorder?.normalized);
            this.element('radiolabBrowser').disabled = blocked || capturing;
            this.element('radiolabName').disabled = this.locked;
            const silentTake = this.recorder?.hasSignal === false;
            this.element('radiolabTake').textContent = armed ? 'Connecting live recording — waiting for station audio, up to 12 seconds. Stop cancels; previous take retained.' : this.recorder?.frames ? `${recording ? (silentTake ? 'Recording digital silence' : 'Recording') : (silentTake ? 'Silent take — record again' : 'Take ready')} · ${this.recorder.duration.toFixed(2)}s · ${this.recorder.metadata?.station?.name || ''}${playableTake ? this.recorder.normalized ? ' · Normalized: peak 1.0 (0 dBFS)' : ' · Not normalized — Save auto-normalizes' : ''}` : recording ? 'Recording — waiting for live PCM. Stop ends this take.' : 'No recording yet. Record is always manual.';
            this.renderTrim();
            const target = this.element('radiolabLoadTarget');
            const targetLabel = target.selectedOptions?.[0]?.textContent || target.value;
            target.disabled = blocked || capturing;
            for (const [filename, controls] of this.sampleRows || []) {
                const stopping = filename === this.previewFilename;
                controls.play.textContent = stopping ? 'Stop' : 'Play';
                controls.play.setAttribute('aria-label', `${stopping ? 'Stop preview of' : 'Play'} ${filename}`);
                controls.play.setAttribute('aria-pressed', String(stopping));
                controls.play.disabled = this.locked || capturing || (this.busy && !stopping);
                controls.load.textContent = 'Load';
                controls.load.setAttribute('aria-label', `Load ${filename} into ${targetLabel}`);
                controls.load.disabled = blocked || capturing;
                if (controls.rename) {
                    controls.rename.textContent = 'Rename file';
                    controls.rename.setAttribute('aria-label', `Rename file ${filename}`);
                    controls.rename.disabled = blocked || capturing;
                    controls.trim.textContent = 'Re-trim';
                    controls.trim.setAttribute('aria-label', `Re-trim ${filename} and save a new WAV`);
                    controls.trim.disabled = blocked || capturing;
                }
                controls.delete.textContent = 'Delete';
                controls.delete.setAttribute('aria-label', `Delete ${filename}`);
                controls.delete.disabled = blocked || capturing;
            }
            this.element('radiolabRefreshSamples').disabled = blocked || capturing;
            this.savedEditor?.render(blocked || capturing);
            this.element('performanceBastardLoopVUseRadiolabBtn')?.toggleAttribute('disabled', blocked || capturing);
        }
    }

    const exported = { BUILD, BUFFER_SECONDS, MAX_RECORD_SECONDS, MAX_PCM_BYTES, PCMBufferRing, PCMRecorder, S16LEPCMDecoder, encodeWav, stationStreamUrl, stationPriority, SavedSampleEditor, Controller };
    if (typeof module !== 'undefined' && module.exports) module.exports = exported;
    root.MygrainRadiolab = Object.freeze(exported);
    if (!root.document || root.__mygrainSongRenderDeck) return;
    const card = root.document.getElementById('radiolabCard');
    if (!card || !root.mygrainRadiolabAdapter) return;
    const controller = new Controller(card, root.mygrainRadiolabAdapter);
    Object.defineProperty(root, 'mygrainRadiolab', { configurable: false, value: Object.freeze({
        get state() { return controller.state; },
        get diagnostics() { return controller.diagnostics; },
        openBrowser: target => controller.run(() => controller.openBrowser(target), true)
    }) });
})(typeof window !== 'undefined' ? window : globalThis);
