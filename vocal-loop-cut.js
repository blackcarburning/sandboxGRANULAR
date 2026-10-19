(function (root) {
    'use strict';
    const gatedBuffers = new WeakMap();
    const waveformPeaks = new WeakMap();
    const grids = [1 / 32, ...Array.from({ length: 16 }, (unused, index) => (index + 1) / 16)];

    function normalize(value = {}) {
        const start = Number(value?.start ?? 0);
        const end = Number(value?.end ?? 1);
        const valid = Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= 1 && end > start;
        const stretch = valid && value?.stretch === true;
        const numericTarget = field => (typeof field === 'number' || (typeof field === 'string' && field.trim() !== '')) && Number.isFinite(Number(field));
        const mapped = valid && numericTarget(value?.targetStart) && numericTarget(value?.targetDuration) && Number(value.targetDuration) > 0;
        const targetDuration = mapped ? Math.min(1, Number(value.targetDuration)) : stretch ? end - start : null;
        const targetStart = stretch && value?.fromStart === true ? 0 : mapped ? Math.max(0, Math.min(1 - targetDuration, Number(value.targetStart))) : stretch ? start : null;
        return {
            enabled: valid && value?.enabled === true,
            repeat: valid && value?.repeat === true,
            fromStart: valid && value?.fromStart === true,
            start: valid ? start : 0,
            end: valid ? end : 1,
            stretch,
            targetStart,
            targetDuration,
            snap: value?.snap !== false,
            grid: grids.includes(Number(value?.grid)) ? Number(value.grid) : 1 / 16
        };
    }

    function region(settings) {
        const cut = normalize(settings);
        const start = cut.stretch ? cut.targetStart : cut.start;
        const duration = cut.stretch ? cut.targetDuration : cut.end - cut.start;
        return { start, end: start + duration, duration };
    }

    function setStretch(settings, stretch) {
        return normalize({ ...normalize(settings), stretch: stretch === true });
    }

    function setFromStart(settings, fromStart) {
        return normalize({ ...normalize(settings), fromStart: fromStart === true });
    }

    function moveBoundary(settings, boundary, position, step = 0, minimum = .000001) {
        const next = normalize(settings);
        if (!Number.isFinite(position)) return next;
        const snapped = step > 0 ? Math.round(position / step) * step : position;
        if (next.stretch) {
            if (boundary === 'start') {
                next.targetStart = Math.max(0, Math.min(1 - next.targetDuration, snapped));
                if (next.targetStart > 0) next.fromStart = false;
            } else {
                const gap = Math.min(1 - next.targetStart, Math.max(.000001, minimum));
                next.targetDuration = Math.max(gap, Math.min(1 - next.targetStart, snapped - next.targetStart));
            }
            next.enabled = true;
            return next;
        }
        const gap = Math.min(next.end - next.start, Math.max(minimum, step));
        if (boundary === 'start') next.start = Math.max(0, Math.min(next.end - gap, snapped));
        else next.end = Math.min(1, Math.max(next.start + gap, snapped));
        next.targetStart = null;
        next.targetDuration = null;
        next.enabled = true;
        return next;
    }

    function stretchChannels(sources, outputs, sampleRate) {
        const sourceLength = sources[0].length;
        const targetLength = outputs[0].length;
        if (sourceLength === targetLength) {
            outputs.forEach((output, channel) => output.set(sources[channel]));
            return;
        }
        if (sourceLength < 32 || targetLength < 32) {
            outputs.forEach((output, channel) => {
                for (let frame = 0; frame < targetLength; frame += 1) output[frame] = sources[channel][frame % sourceLength];
            });
            return;
        }
        const windowLength = Math.min(2048, Math.round(sampleRate * .04), sourceLength, Math.max(32, Math.floor(targetLength / 2)));
        const hop = Math.max(1, Math.floor(windowLength / 4));
        const window = Float32Array.from({ length: windowLength }, (unused, index) => Math.max(.0001, .5 - .5 * Math.cos(2 * Math.PI * index / (windowLength - 1))));
        const weights = new Float32Array(targetLength);
        const references = sources.map(() => new Float32Array(windowLength));
        let sourceEnergy = 0;
        sources.forEach(source => {
            for (let frame = 0; frame < sourceLength; frame += Math.max(1, Math.floor(sourceLength / 2048))) sourceEnergy += source[frame] * source[frame];
        });
        const radius = Math.min(256, Math.round(sampleRate * .005), Math.floor(windowLength / 3));
        const stride = Math.max(1, Math.floor(radius / 24));
        const compareStride = Math.max(1, Math.floor((windowLength - hop) / 64));
        for (let destination = 0; destination < targetLength; destination += hop) {
            const expected = Math.min(sourceLength - windowLength, Math.round(destination * (sourceLength - windowLength) / Math.max(1, targetLength - windowLength)));
            let analysis = expected;
            const overlap = Math.min(windowLength - hop, targetLength - destination);
            if (destination > 0 && sourceEnergy > 0 && sourceLength > windowLength) {
                let referenceEnergy = 0;
                for (let offset = 0; offset < overlap; offset += compareStride) {
                    for (let channel = 0; channel < sources.length; channel += 1) {
                        const reference = outputs[channel][destination + offset] / Math.max(.0001, weights[destination + offset]);
                        references[channel][offset] = reference;
                        referenceEnergy += reference * reference;
                    }
                }
                let bestScore = -Infinity;
                const score = candidate => {
                    let correlation = 0;
                    let energy = 0;
                    for (let offset = 0; offset < overlap; offset += compareStride) {
                        for (let channel = 0; channel < sources.length; channel += 1) {
                            const sample = sources[channel][candidate + offset];
                            correlation += sample * references[channel][offset];
                            energy += sample * sample;
                        }
                    }
                    const value = correlation / Math.max(1e-12, Math.sqrt(energy * referenceEnergy)) - .0001 * Math.abs(candidate - expected) / (radius + 1);
                    if (value > bestScore) { bestScore = value; analysis = candidate; }
                };
                const first = Math.max(0, expected - radius);
                const last = Math.min(sourceLength - windowLength, expected + radius);
                score(expected);
                for (let candidate = first; candidate <= last; candidate += stride) score(candidate);
                const coarse = analysis;
                for (let candidate = Math.max(first, coarse - stride); candidate <= Math.min(last, coarse + stride); candidate += 1) score(candidate);
            }
            const length = Math.min(windowLength, targetLength - destination);
            for (let offset = 0; offset < length; offset += 1) {
                const weight = window[offset];
                weights[destination + offset] += weight;
                for (let channel = 0; channel < sources.length; channel += 1) outputs[channel][destination + offset] += sources[channel][analysis + offset] * weight;
            }
        }
        outputs.forEach(output => {
            for (let frame = 0; frame < targetLength; frame += 1) output[frame] /= Math.max(.0001, weights[frame]);
        });
    }

    function gate(context, buffer, settings, duration = buffer?.duration, fadeSeconds = .004) {
        if (!buffer) return null;
        const cut = normalize(settings);
        if (!cut.enabled || (cut.start === 0 && cut.end === 1 && (!cut.stretch || (cut.targetStart === 0 && cut.targetDuration === 1)))) return buffer;
        const frames = Math.max(1, Math.min(buffer.length, Math.round(duration * buffer.sampleRate)));
        const first = Math.min(frames - 1, Math.round(cut.start * frames));
        const last = Math.max(first + 1, Math.min(frames, Math.round(cut.end * frames)));
        const placement = cut.stretch ? Math.min(frames - 1, Math.round(cut.targetStart * frames)) : cut.fromStart ? 0 : first;
        const sectionLength = cut.stretch ? Math.max(1, Math.min(frames - placement, Math.round(cut.targetDuration * frames))) : last - first;
        const fade = Math.max(0, Math.min(Math.round(fadeSeconds * buffer.sampleRate), Math.floor(sectionLength / 4)));
        const key = `${frames}:${first}:${last}:${placement}:${sectionLength}:${fade}:${cut.repeat}:${cut.fromStart}:${cut.stretch}`;
        const cached = gatedBuffers.get(buffer);
        if (cached?.context === context && cached.key === key) return cached.buffer;
        const result = context.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
        if (cut.stretch) stretchChannels(
            Array.from({ length: buffer.numberOfChannels }, (unused, channel) => buffer.getChannelData(channel).subarray(first, last)),
            Array.from({ length: buffer.numberOfChannels }, (unused, channel) => result.getChannelData(channel).subarray(placement, placement + sectionLength)),
            buffer.sampleRate
        );
        for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
            const source = buffer.getChannelData(channel);
            const output = result.getChannelData(channel);
            for (let sectionStart = placement; sectionStart < (cut.repeat ? frames : placement + sectionLength); sectionStart += sectionLength) {
                const sectionEnd = Math.min(sectionStart + sectionLength, frames);
                for (let frame = sectionStart; frame < sectionEnd; frame += 1) {
                    const sample = cut.stretch ? output[placement + frame - sectionStart] : source[first + frame - sectionStart];
                    if (!cut.stretch || sectionStart !== placement) output[frame] = sample;
                }
            }
            for (let sectionStart = placement; sectionStart < (cut.repeat ? frames : placement + sectionLength); sectionStart += sectionLength) {
                const sectionEnd = Math.min(sectionStart + sectionLength, frames);
                const sectionFade = Math.min(fade, Math.floor((sectionEnd - sectionStart) / 4));
                for (let frame = sectionStart; frame < sectionEnd; frame += 1) {
                    const attack = sectionFade > 0 ? Math.min(1, (frame - sectionStart) / sectionFade) : 1;
                    const release = sectionFade > 0 ? Math.min(1, (sectionEnd - 1 - frame) / sectionFade) : 1;
                    output[frame] *= Math.max(0, Math.min(attack, release));
                }
            }
        }
        gatedBuffers.set(buffer, { context, key, buffer: result });
        return result;
    }

    function sourcePhase(settings, phase) {
        if (phase === null) return null;
        const cut = normalize(settings);
        if (!cut.enabled) return phase;
        const length = cut.stretch ? cut.targetDuration : cut.end - cut.start;
        const elapsed = phase - (cut.stretch ? cut.targetStart : cut.fromStart ? 0 : cut.start);
        if (elapsed < 0 || (!cut.repeat && elapsed >= length)) return null;
        return cut.start + (cut.stretch ? (elapsed % length) / length * (cut.end - cut.start) : elapsed % length);
    }

    function peaks(buffer, columns, duration = buffer?.duration) {
        const frames = Math.max(1, Math.min(buffer.length, Math.round(duration * buffer.sampleRate)));
        const key = `${frames}:${columns}`;
        const cached = waveformPeaks.get(buffer);
        if (cached?.key === key) return cached.peaks;
        const result = Array.from({ length: columns }, () => ({ low: 0, high: 0 }));
        for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
            const samples = buffer.getChannelData(channel);
            for (let column = 0; column < columns; column += 1) {
                const first = Math.floor(column * frames / columns);
                const last = Math.min(frames, Math.max(first + 1, Math.floor((column + 1) * frames / columns)));
                for (let frame = first; frame < last; frame += 1) {
                    result[column].low = Math.min(result[column].low, samples[frame]);
                    result[column].high = Math.max(result[column].high, samples[frame]);
                }
            }
        }
        waveformPeaks.set(buffer, { key, peaks: result });
        return result;
    }

    class Editor {
        constructor(adapter) {
            this.adapter = adapter;
            this.document = root.document;
            this.overlay = this.element('bastardLoopVCutOverlay');
            this.timeline = this.element('bastardLoopVCutTimeline');
            this.canvas = this.element('bastardLoopVCutWaveform');
            this.drag = null;
            this.starting = false;
            this.timer = null;
            const grid = this.element('bastardLoopVCutGrid');
            for (const division of grids) {
                const option = this.document.createElement('option');
                option.value = String(division);
                option.textContent = division === 1 / 32 ? '1/32' : division === 1 ? '1 bar (16/16)' : `${division * 16}/16`;
                grid.append(option);
            }
            for (const boundary of ['start', 'end']) {
                const handle = this.handle(boundary);
                this.bindDrag(handle, boundary);
                handle.addEventListener('keydown', event => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    const settings = this.adapter.settings();
                    const timing = this.adapter.timing();
                    const step = settings.snap ? settings.grid * timing.bar / timing.cycle : 1 / 1000;
                    const position = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : region(settings)[boundary] + (event.key === 'ArrowRight' ? 1 : -1) * step * (event.shiftKey ? 10 : 1);
                    this.move(boundary, position);
                });
                this.element(boundary === 'start' ? 'bastardLoopVCutStartSeconds' : 'bastardLoopVCutEndSeconds').addEventListener('change', event => {
                    const seconds = Number(event.target.value);
                    if (Number.isFinite(seconds)) this.move(boundary, seconds / this.adapter.timing().cycle);
                    else this.refresh();
                });
            }
            this.bindDrag(this.timeline, 'start', true);
            this.element('bastardLoopVCutEnabled').addEventListener('change', event => this.change({ enabled: event.target.checked }));
            this.element('bastardLoopVCutRepeat').addEventListener('click', () => this.change({ enabled: true, repeat: !this.adapter.settings().repeat }));
            this.element('bastardLoopVCutFromStart').addEventListener('click', () => this.change({ ...setFromStart(this.adapter.settings(), !this.adapter.settings().fromStart), enabled: true }));
            this.element('bastardLoopVCutStretch').addEventListener('click', () => this.change({ ...setStretch(this.adapter.settings(), !this.adapter.settings().stretch), enabled: true }));
            this.element('bastardLoopVCutSnap').addEventListener('change', event => this.change({ snap: event.target.checked }));
            grid.addEventListener('change', event => this.change({ grid: Number(event.target.value) }));
            this.element('bastardLoopVCutReset').addEventListener('click', () => this.change({ enabled: false, repeat: false, fromStart: false, stretch: false, targetStart: null, targetDuration: null, start: 0, end: 1 }));
            this.element('bastardLoopVCutClose').addEventListener('click', () => this.close());
            this.element('bastardLoopVCutStop').addEventListener('click', () => { this.adapter.stop(); this.message('Audition stopped.'); });
            for (const [id, mode] of [['bastardLoopVCutAuditionMetro', 'metronome'], ['bastardLoopVCutAuditionLoops', 'loops']]) {
                this.element(id).addEventListener('click', async () => {
                    if (this.starting) return;
                    this.starting = true;
                    this.refresh();
                    try {
                        await this.adapter.audition(mode);
                        if (!this.overlay.hidden && this.adapter.phase() !== null) this.message(`${mode === 'metronome' ? 'Vocal + metronome' : 'Bastardloops + vocal'} audition from loop start. The yellow cursor follows the source being heard and hides during silence.`);
                    } catch (error) { this.message(error.message); }
                    finally { this.starting = false; this.refresh(); }
                });
            }
            this.overlay.addEventListener('click', event => { if (event.target === this.overlay) this.close(); });
            this.overlay.addEventListener('keydown', event => {
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); }
                if (event.key === 'Tab') {
                    const controls = [...this.overlay.querySelectorAll('button, input, select')].filter(element => !element.disabled);
                    const first = controls[0];
                    const last = controls.at(-1);
                    if (event.shiftKey && this.document.activeElement === first) { event.preventDefault(); last.focus(); }
                    else if (!event.shiftKey && this.document.activeElement === last) { event.preventDefault(); first.focus(); }
                }
            });
            if (root.ResizeObserver) {
                this.resize = new root.ResizeObserver(() => this.refresh());
                this.resize.observe(this.timeline);
            }
        }

        element(id) { return this.document.getElementById(id); }
        handle(boundary) { return this.element(boundary === 'start' ? 'bastardLoopVCutStart' : 'bastardLoopVCutEnd'); }
        message(text) { this.element('bastardLoopVCutStatus').textContent = text; }

        bindDrag(element, boundary, body = false) {
            element.addEventListener('pointerdown', event => {
                if (event.button !== 0 || this.drag) return;
                const settings = this.adapter.settings();
                const rect = this.timeline.getBoundingClientRect();
                const position = (event.clientX - rect.left) / rect.width;
                const selected = region(settings);
                if (body && (!settings.stretch || position < selected.start || position > selected.end)) return;
                event.preventDefault();
                event.stopPropagation();
                this.drag = { boundary, pointerId: event.pointerId, offset: settings.stretch ? position - selected[boundary] : 0 };
                element.setPointerCapture(event.pointerId);
            });
            element.addEventListener('pointermove', event => {
                if (this.drag?.pointerId !== event.pointerId) return;
                event.stopPropagation();
                const rect = this.timeline.getBoundingClientRect();
                this.move(this.drag.boundary, (event.clientX - rect.left) / rect.width - this.drag.offset, true);
            });
            const finish = event => {
                if (this.drag?.pointerId !== event.pointerId) return;
                event.stopPropagation();
                this.finishDrag();
            };
            element.addEventListener('pointerup', finish);
            element.addEventListener('pointercancel', finish);
            element.addEventListener('lostpointercapture', finish);
        }

        finishDrag() {
            if (!this.drag) return;
            this.drag = null;
            this.adapter.set(this.adapter.settings());
            this.refresh();
        }

        change(patch) {
            this.drag = null;
            this.adapter.set(normalize({ ...this.adapter.settings(), ...patch }));
            this.refresh();
        }

        move(boundary, position, preview = false) {
            const settings = this.adapter.settings();
            const timing = this.adapter.timing();
            const step = settings.snap ? timing.bar * settings.grid / timing.cycle : 0;
            this.adapter.set(moveBoundary(settings, boundary, position, step, 1 / timing.frames), { preview });
            this.refresh();
        }

        open() {
            if (!this.adapter.buffer()) throw new Error('Load or generate a vocal loop first.');
            this.previousFocus = this.document.activeElement;
            this.overlay.hidden = false;
            this.overlay.setAttribute('aria-hidden', 'false');
            this.refresh();
            this.message('Stretch Off edits the source. Stretch On captures that source: drag its highlighted body or Start to move it, End to stretch without changing pitch. Loop timing and the original sample stay unchanged.');
            this.element('bastardLoopVCutClose').focus();
            const tick = () => {
                if (this.overlay.hidden) return;
                const settings = normalize(this.adapter.settings());
                const source = sourcePhase(settings, this.adapter.phase());
                const phase = source === null || !settings.stretch || !settings.enabled ? source : settings.targetStart + (source - settings.start) / (settings.end - settings.start) * settings.targetDuration;
                const playhead = this.element('bastardLoopVCutPlayhead');
                playhead.hidden = phase === null;
                if (phase !== null) playhead.style.left = `${phase * 100}%`;
                this.timer = root.requestAnimationFrame(tick);
            };
            root.cancelAnimationFrame(this.timer);
            tick();
        }

        close() {
            this.finishDrag();
            this.adapter.stop();
            this.overlay.hidden = true;
            this.overlay.setAttribute('aria-hidden', 'true');
            root.cancelAnimationFrame(this.timer);
            this.previousFocus?.focus();
        }

        refresh() {
            if (this.overlay.hidden) return;
            const settings = this.adapter.settings();
            const timing = this.adapter.timing();
            this.element('bastardLoopVCutEnabled').checked = settings.enabled;
            const repeat = this.element('bastardLoopVCutRepeat');
            repeat.textContent = `Section Repeat ${settings.repeat ? 'On' : 'Off'}`;
            repeat.classList.toggle('active', settings.repeat);
            repeat.setAttribute('aria-pressed', String(settings.repeat));
            const fromStart = this.element('bastardLoopVCutFromStart');
            fromStart.textContent = `From Start ${settings.fromStart ? 'On' : 'Off'}`;
            fromStart.classList.toggle('active', settings.fromStart);
            fromStart.setAttribute('aria-pressed', String(settings.fromStart));
            const stretch = this.element('bastardLoopVCutStretch');
            stretch.textContent = `Stretch ${settings.stretch ? 'On' : 'Off'}`;
            stretch.classList.toggle('active', settings.stretch);
            stretch.setAttribute('aria-pressed', String(settings.stretch));
            this.timeline.classList.toggle('stretch-active', settings.stretch);
            this.canvas.setAttribute('aria-label', settings.stretch ? 'Selected source audio scaled into its destination; drag highlighted region to move without trimming' : 'Full vocal source waveform; highlighted source section may play at loop start or its original position');
            this.element('bastardLoopVCutSnap').checked = settings.snap;
            this.element('bastardLoopVCutGrid').value = String(settings.grid);
            const selected = region(settings);
            for (const boundary of ['start', 'end']) {
                const handle = this.handle(boundary);
                const seconds = selected[boundary] * timing.cycle;
                handle.style.left = `${selected[boundary] * 100}%`;
                handle.setAttribute('aria-label', settings.stretch ? `Vocal destination ${boundary}${boundary === 'start' ? '; moves whole selection' : '; stretches selected audio'}` : `Vocal cut ${boundary}`);
                handle.setAttribute('aria-valuenow', (selected[boundary] * 100).toFixed(3));
                handle.setAttribute('aria-valuetext', `${seconds.toFixed(3)} seconds, ${(selected[boundary] * timing.cycle / timing.bar * 16).toFixed(2)} sixteenths from start`);
                const input = this.element(boundary === 'start' ? 'bastardLoopVCutStartSeconds' : 'bastardLoopVCutEndSeconds');
                input.value = seconds.toFixed(4);
                input.max = String(timing.cycle);
                input.setAttribute('aria-label', `${settings.stretch ? 'Destination' : 'Source'} ${boundary} in seconds`);
            }
            const placement = (settings.stretch ? settings.targetStart : settings.fromStart ? 0 : settings.start) * timing.cycle;
            const playback = settings.enabled ? `plays at ${placement.toFixed(3)}s · ${settings.repeat ? 'repeats to full loop end' : 'once, then silence'}` : 'full source plays';
            const mapping = settings.stretch ? ` · destination ${(selected.start * timing.cycle).toFixed(3)}–${(selected.end * timing.cycle).toFixed(3)}s · ${(selected.duration / (settings.end - settings.start)).toFixed(3)}× duration, pitch preserved` : '';
            this.element('bastardLoopVCutRange').textContent = `${settings.enabled ? 'Cut on' : 'Cut off'} · source ${(settings.start * timing.cycle).toFixed(3)}–${(settings.end * timing.cycle).toFixed(3)}s · ${((settings.end - settings.start) * timing.cycle / timing.bar * 16).toFixed(2)}/16 selected${mapping} · ${playback} · full loop ${timing.cycle.toFixed(3)}s (${(timing.cycle / timing.bar).toFixed(2)} bars).`;
            for (const id of ['bastardLoopVCutAuditionMetro', 'bastardLoopVCutAuditionLoops']) this.element(id).disabled = this.starting || !this.adapter.buffer();
            this.draw(settings, timing);
        }

        draw(settings, timing) {
            const width = Math.round(this.canvas.clientWidth);
            const height = Math.round(this.canvas.clientHeight);
            if (!width || !height) return;
            const scale = Math.min(2, root.devicePixelRatio || 1);
            this.canvas.width = width * scale;
            this.canvas.height = height * scale;
            const drawing = this.canvas.getContext('2d');
            drawing.scale(scale, scale);
            drawing.fillStyle = '#09121f';
            drawing.fillRect(0, 0, width, height);
            const step = settings.snap ? timing.bar * settings.grid / timing.cycle : timing.bar / 4 / timing.cycle;
            drawing.strokeStyle = '#30425b';
            drawing.lineWidth = 1;
            for (let tick = 0; tick <= 1 && tick / step < 1024; tick += step) {
                drawing.beginPath();
                drawing.moveTo(Math.round(tick * width) + .5, 0);
                drawing.lineTo(Math.round(tick * width) + .5, height);
                drawing.stroke();
            }
            const buffer = this.adapter.buffer();
            if (buffer) {
                const columns = Math.max(1, Math.min(1000, width));
                const values = peaks(buffer, columns, timing.duration);
                const peak = Math.max(.001, ...values.map(value => Math.max(Math.abs(value.low), value.high)));
                drawing.strokeStyle = settings.stretch ? '#31495d' : '#7ce1f4';
                for (let column = 0; column < columns; column += 1) {
                    drawing.beginPath();
                    drawing.moveTo(column * width / columns, height / 2 - values[column].high / peak * height * .43);
                    drawing.lineTo(column * width / columns, height / 2 - values[column].low / peak * height * .43 + 1);
                    drawing.stroke();
                }
                if (settings.stretch) {
                    const selected = region(settings);
                    drawing.fillStyle = '#102d3f';
                    drawing.fillRect(selected.start * width, 0, selected.duration * width, height);
                    drawing.strokeStyle = '#7ce1f4';
                    const targetColumns = Math.max(1, Math.ceil(selected.duration * columns));
                    for (let column = 0; column < targetColumns; column += 1) {
                        const first = Math.min(columns - 1, Math.floor((settings.start + column / targetColumns * (settings.end - settings.start)) * columns));
                        const last = Math.min(columns, Math.max(first + 1, Math.ceil((settings.start + (column + 1) / targetColumns * (settings.end - settings.start)) * columns)));
                        let low = 0;
                        let high = 0;
                        for (let bucket = first; bucket < last; bucket += 1) { low = Math.min(low, values[bucket].low); high = Math.max(high, values[bucket].high); }
                        const position = (selected.start + column / targetColumns * selected.duration) * width;
                        drawing.beginPath();
                        drawing.moveTo(position, height / 2 - high / peak * height * .43);
                        drawing.lineTo(position, height / 2 - low / peak * height * .43 + 1);
                        drawing.stroke();
                    }
                }
            }
            const selected = region(settings);
            drawing.fillStyle = settings.enabled ? '#05080cbb' : '#05080c66';
            drawing.fillRect(0, 0, selected.start * width, height);
            drawing.fillRect(selected.end * width, 0, (1 - selected.end) * width, height);
            drawing.strokeStyle = '#36ef69';
            drawing.strokeRect(selected.start * width, 1, selected.duration * width, height - 2);
        }
    }

    const api = { normalize, region, setStretch, setFromStart, moveBoundary, gate, sourcePhase, peaks, grids, Editor };
    root.MygrainVocalCut = api;
    if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis);
