(function (root) {
    'use strict';
    const gatedBuffers = new WeakMap();
    const waveformPeaks = new WeakMap();
    const grids = [1 / 32, ...Array.from({ length: 16 }, (unused, index) => (index + 1) / 16)];

    function normalizeGaps(value) {
        const ranges=(Array.isArray(value)?value:[]).slice(0,1024).filter(r=>Array.isArray(r)&&r.length===2&&r.every(n=>typeof n==='number'&&Number.isFinite(n))).map(([a,b])=>[Math.max(0,a),Math.min(1,b)]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
        const merged=[];for(const range of ranges){const last=merged.at(-1);if(last&&range[0]<=last[1]+1e-9)last[1]=Math.max(last[1],range[1]);else merged.push(range);}
        return merged;
    }
    function toggleGap(settings, start, end) {
        const cut=normalize(settings), ranges=cut.gaps;
        const muted=ranges.some(([a,b])=>a<end-1e-9&&b>start+1e-9);
        const gaps=muted?ranges.flatMap(([a,b])=>b<=start||a>=end?[[a,b]]:[[a,Math.min(b,start)],[Math.max(a,end),b]].filter(([x,y])=>y>x)):ranges.concat([[start,end]]);
        return normalize({...cut,gapEnabled:true,gaps});
    }
    function copyGapSection(settings, start, end) {
        start = Math.max(0, Math.min(1, start));
        end = Math.max(start, Math.min(1, end));
        if (!(end > start)) throw new Error('Select a gap section first.');
        return { length: end - start, gaps: normalize(settings).gaps
            .filter(([a,b]) => a < end && b > start)
            .map(([a,b]) => [Math.max(a,start)-start, Math.min(b,end)-start]) };
    }
    function pasteGapSection(settings, section, target, repeat = false) {
        if (!Number.isFinite(target) || target < 0 || target >= 1 || !Number.isFinite(section?.length) || section.length <= 0) throw new Error('Invalid gap copy destination.');
        const cut = normalize(settings), end = repeat ? 1 : Math.min(1, target + section.length);
        const gaps = cut.gaps.flatMap(([a,b]) => b <= target || a >= end ? [[a,b]] : [[a,Math.min(b,target)],[Math.max(a,end),b]].filter(([x,y])=>y>x));
        const count = repeat ? Math.ceil((1-target)/section.length-1e-9) : 1;
        if (count > 1024) throw new Error('Choose a longer section to copy.');
        for (let i=0;i<count;i++) for (const [a,b] of section.gaps) {
            const left=target+i*section.length+a, right=Math.min(end,target+i*section.length+b);
            if (right > left) gaps.push([left,right]);
        }
        if(gaps.length>1024)throw new Error('Too many gaps to copy. Choose a longer section or clear some gaps.');
        return normalize({...cut,gapEnabled:true,gaps});
    }
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
            gapEnabled: value?.gapEnabled === true,
            gaps: normalizeGaps(value?.gaps),
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

    function randomize(settings, timing = {}, random = Math.random) {
        const current = normalize(settings);
        const cycle = Number(timing.cycle) > 0 ? Number(timing.cycle) : 1;
        const bar = Number(timing.bar) > 0 ? Number(timing.bar) : cycle;
        const step = current.snap ? Math.min(1, current.grid * bar / cycle) : 1 / 128;
        const units = Math.max(1, Math.floor(1 / step + 1e-9));
        const integer = (min, max) => min + Math.floor(random() * (max - min + 1));
        const minimum = Math.min(units, Math.max(1, Math.ceil(.125 / step)));
        const maximum = Math.min(units, Math.max(minimum, Math.floor(.75 / step)));
        const length = integer(minimum, maximum);
        const start = integer(0, units - length);
        const stretch = random() < .5;
        const fromStart = random() < .5;
        const ratios = [.5, .75, 1.25, 1.5, 2];
        const targetLength = Math.max(1, Math.min(units, Math.round(length * ratios[integer(0, ratios.length - 1)])));
        const targetStart = fromStart ? 0 : integer(0, units - targetLength);
        return normalize({ ...current, enabled: true,
            start: start * step, end: Math.min(1, (start + length) * step), stretch, fromStart,
            targetStart: stretch ? targetStart * step : null,
            targetDuration: stretch ? Math.min(1, targetLength * step) : null });
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

    // Move the source window without trimming or altering its saved duration.
    function moveSection(settings, position, step = 0) {
        const next = normalize(settings);
        if (next.stretch || !Number.isFinite(position)) return next;
        const length = next.end - next.start;
        const snapped = step > 0 ? Math.round(position / step) * step : position;
        next.start = Math.max(0, Math.min(1 - length, snapped));
        next.end = next.start + length;
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

    function cutGate(context, buffer, settings, duration = buffer?.duration, fadeSeconds = .004) {
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

    const gapBuffers=new WeakMap();
    function gate(context, buffer, settings, duration=buffer?.duration, fadeSeconds=.004) {
        const result=cutGate(context,buffer,settings,duration,fadeSeconds);
        const cut=normalize(settings);
        if(!result||!cut.gapEnabled||!cut.gaps.length)return result;
        const frames=Math.max(1,Math.min(result.length,Math.round(duration*result.sampleRate)));
        const key=JSON.stringify([frames,fadeSeconds,cut.gaps]);
        const cached=gapBuffers.get(result);if(cached?.context===context&&cached.key===key)return cached.buffer;
        const output=context.createBuffer(result.numberOfChannels,result.length,result.sampleRate);
        for(let c=0;c<result.numberOfChannels;c++){
            const samples=output.getChannelData(c);samples.set(result.getChannelData(c));
            for(const [a,b] of cut.gaps){
                const first=Math.round(a*frames),last=Math.round(b*frames),fade=Math.min(Math.round(fadeSeconds*result.sampleRate),Math.floor((last-first)/4));
                samples.fill(0,first,last);
                for(let i=1;i<=fade;i++){if(first-i>=0)samples[first-i]*=i/fade;if(last+i-1<frames)samples[last+i-1]*=i/fade;}
            }
        }
        gapBuffers.set(result,{context,key,buffer:output});return output;
    }

    function sourcePhase(settings, phase) {
        if (phase === null) return null;
        const cut = normalize(settings);
        if(cut.gapEnabled&&cut.gaps.some(([a,b])=>phase>=a&&phase<b))return null;
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

    // Output placement/repeats without allocating a rendered PCM buffer. Gaps
    // remain a red overlay so the underlying audio stays visible while editing.
    function timelinePeaks(buffer, columns, duration, settings) {
        const cut=normalize(settings), values=peaks(buffer,columns,duration);
        if(!cut.enabled)return values;
        const length=cut.stretch?cut.targetDuration:cut.end-cut.start;
        const placement=cut.stretch?cut.targetStart:cut.fromStart?0:cut.start;
        const range=(a,b)=>{
            const out={low:0,high:0};
            for(let i=Math.max(0,Math.floor(a*columns));i<Math.min(columns,Math.ceil(b*columns-1e-9));i++){
                out.low=Math.min(out.low,values[i].low);out.high=Math.max(out.high,values[i].high);
            }
            return out;
        };
        const selected=range(cut.start,cut.end), ratio=(cut.end-cut.start)/length;
        return Array.from({length:columns},(_,i)=>{
            const a=Math.max(i/columns,placement), b=Math.min((i+1)/columns,cut.repeat?1:placement+length);
            if(b<=a)return {low:0,high:0};
            if(b-a>=length-1e-9)return {...selected};
            const offset=((a-placement)%length+length)%length, stop=offset+b-a;
            const first=range(cut.start+offset*ratio,cut.start+Math.min(length,stop)*ratio);
            if(stop>length+1e-9){const next=range(cut.start,cut.start+(stop-length)*ratio);first.low=Math.min(first.low,next.low);first.high=Math.max(first.high,next.high);}
            return first;
        });
    }
    function outputWaveform(settings) { return settings.gapEnabled || (settings.enabled && settings.repeat); }

    class Editor {
        constructor(adapter) {
            this.adapter = adapter;
            this.label=({bastardLoopCut:'A',bastardLoop2Cut:'B',bastardLoop3Cut:'C',bastardLoopWCut:'W',bastardLoopPCut:'P',bastardLoopOCut:'O'})[adapter.prefix]||'V';
            this.document = root.document;
            this.overlay = this.element('bastardLoopVCutOverlay');
            if(this.document.body && this.overlay.parentElement!==this.document.body)this.document.body.append(this.overlay);
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
            const gapRow=this.document.createElement('div');gapRow.className='loop-gap-controls';
            this.gapButton=this.document.createElement('button');this.gapButton.type='button';this.gapButton.className='performance-btn';this.gapButton.id=(adapter.prefix||'bastardLoopVCut')+'Gap';
            this.clearGaps=this.document.createElement('button');this.clearGaps.type='button';this.clearGaps.className='performance-btn';this.clearGaps.textContent='Clear Gaps';
            this.gapCopy={mode:'idle'};
            this.gapCopyButtons=['Copy','Copy Sec'].map((label,i)=>{const b=this.document.createElement('button');b.type='button';b.className='performance-btn';b.textContent=label;b.dataset.gapCopy=i?'section':'range';b.title=i?'Copy a section repeatedly to the end of the gap grid':'Copy a section once';b.addEventListener('click',()=>this.beginGapCopy(i===1));return b;});
            this.gapCopyHint=this.document.createElement('p');this.gapCopyHint.className='loop-gap-copy-hint';this.gapCopyHint.setAttribute('aria-live','polite');
            this.gapHint=this.document.createElement('p');this.gapHint.textContent='Gap On: tap grid cells or the waveform to mute/unmute multiple sections. Red cells are silent. Gap Off bypasses your pattern; Clear Gaps removes it. Gaps follow the output timeline, after cut/stretch.';
            this.gapCells=this.document.createElement('div');this.gapCells.className='loop-gap-cells';this.gapCells.setAttribute('role','group');this.gapCells.setAttribute('aria-label','Loop gap grid');
            gapRow.append(this.gapButton,this.clearGaps,...this.gapCopyButtons,this.gapHint,this.gapCopyHint,this.gapCells);this.timeline.before(gapRow);
            this.gapButton.addEventListener('click',()=>{this.gapCopy={mode:'idle'};this.change({gapEnabled:!this.adapter.settings().gapEnabled});});
            this.clearGaps.addEventListener('click',()=>{this.gapCopy={mode:'idle'};this.change({gaps:[]});});
            this.gapCells.addEventListener('click',event=>{const b=event.target.closest('[data-gap-cell]');if(b)this.toggleGapCell(Number(b.dataset.gapCell));});
            this.timeline.addEventListener('click',event=>{if(!this.adapter.settings().gapEnabled||event.target.closest('button'))return;const box=this.timeline.getBoundingClientRect();const step=this.gapStep();this.toggleGapCell(Math.min(Math.ceil(1/step)-1,Math.max(0,Math.floor((event.clientX-box.left)/box.width/step))));});
            this.bindDrag(this.timeline, 'start', true);
            if (['V','W'].includes(this.label)) {
                this.sectionDrag = this.document.createElement('button');
                this.sectionDrag.type = 'button';
                this.sectionDrag.id = (adapter.prefix || 'bastardLoopVCut') + 'DragSection';
                this.sectionDrag.className = 'vocal-cut-drag-section';
                this.sectionDrag.textContent = '↔ Drag section';
                this.sectionDrag.title = 'Drag the highlighted source section left or right without changing its length';
                this.timeline.append(this.sectionDrag);
                this.bindDrag(this.sectionDrag, 'section');
                this.sectionDrag.addEventListener('keydown', event => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    const settings = this.adapter.settings(), timing = this.adapter.timing();
                    const step = settings.snap ? settings.grid * timing.bar / timing.cycle : 1 / 1000;
                    const position = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : settings.start + (event.key === 'ArrowRight' ? 1 : -1) * step * (event.shiftKey ? 10 : 1);
                    this.move('section', position);
                });
            }
            this.element('bastardLoopVCutEnabled').addEventListener('change', event => this.change({ enabled: event.target.checked }));
            this.element('bastardLoopVCutRepeat').addEventListener('click', () => this.change({ enabled: true, repeat: !this.adapter.settings().repeat }));
            this.element('bastardLoopVCutFromStart').addEventListener('click', () => this.change({ ...setFromStart(this.adapter.settings(), !this.adapter.settings().fromStart), enabled: true }));
            this.element('bastardLoopVCutStretch').addEventListener('click', () => this.change({ ...setStretch(this.adapter.settings(), !this.adapter.settings().stretch), enabled: true }));
            this.element('bastardLoopVCutRandomize')?.addEventListener('click', () => this.edit(() => this.adapter.randomize(), `Loop ${this.label} cut`));
            this.element('bastardLoopVCutSnap').addEventListener('change', event => this.change({ snap: event.target.checked }));
            grid.addEventListener('change', event => {this.gapCopy={mode:'idle'};this.change({ grid: Number(event.target.value) });});
            this.element('bastardLoopVCutReset').addEventListener('click', () => this.change({ gapEnabled: false, gaps: [], enabled: false, repeat: false, fromStart: false, stretch: false, targetStart: null, targetDuration: null, start: 0, end: 1 }));
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
            for(const event of ['mygrain-account-lock','mygrain-account-changed'])root.addEventListener?.(event,()=>{this.gapCopy={mode:'idle'};if(!this.overlay.hidden)this.close();});
            root.addEventListener?.('mygrain-history-update',()=>{if(!this.overlay.hidden)this.refresh();});
            if (root.ResizeObserver) {
                this.resize = new root.ResizeObserver(() => this.refresh());
                this.resize.observe(this.timeline);
            }
        }

        gapStep() { const timing=this.adapter.timing();return Math.max(1/1024,Math.min(1,this.adapter.settings().grid*timing.bar/timing.cycle)); }
        beginGapCopy(repeat) {
            this.finishDrag();
            this.gapCopy=this.gapCopy.mode!=='idle'&&this.gapCopy.repeat===repeat?{mode:'idle'}:{mode:'start',repeat,step:this.gapStep()};
            this.refresh();
        }
        toggleGapCell(index) {
            const step=this.gapStep();this.finishDrag();
            const flow=this.gapCopy;
            if(flow.mode!=='idle'){
                if(flow.step!==step){this.gapCopy={mode:'idle'};this.refresh();return;}
                if(flow.mode==='start'){flow.start=index;flow.mode='end';this.refresh();return;}
                if(flow.mode==='end'){
                    flow.end=Math.max(flow.start,index);flow.start=Math.min(flow.start,index);
                    flow.section=copyGapSection(this.adapter.settings(),flow.start*step,Math.min(1,(flow.end+1)*step));flow.mode='paste';this.refresh();return;
                }
                const action=()=>this.adapter.set(pasteGapSection(this.adapter.settings(),flow.section,index*step,flow.repeat));
                const finish=()=>{this.gapCopy={mode:'idle'};this.refresh();this.message(`Gap ${flow.repeat?'section repeated to loop end':'section copied'} from cell ${index+1}.`);};
                const result=this.edit(action,`Loop ${this.label} gap ${flow.repeat?'section copy':'copy'}`);
                if(result?.then)result.then(finish,()=>{});else if(result!==false)finish();
                return;
            }
            this.edit(()=>this.adapter.set(toggleGap(this.adapter.settings(),index*step,Math.min(1,(index+1)*step))), `Loop ${this.label} gap edit`);this.refresh();
        }
        refreshGaps(settings) {
            this.gapButton.textContent=`Gap ${settings.gapEnabled?'On':'Off'}`;
            this.gapButton.classList.toggle('active',settings.gapEnabled);this.gapButton.setAttribute('aria-pressed',String(settings.gapEnabled));
            this.clearGaps.disabled=!settings.gaps?.length;this.gapCells.hidden=!settings.gapEnabled;this.gapHint.hidden=!settings.gapEnabled;
            if(!settings.gapEnabled)this.gapCopy={mode:'idle'};
            if(this.gapCopy.mode!=='idle'&&this.gapCopy.step!==this.gapStep())this.gapCopy={mode:'idle'};
            const flow=this.gapCopy;
            for(const [i,b]of this.gapCopyButtons.entries()){b.hidden=!settings.gapEnabled;const active=flow.mode!=='idle'&&flow.repeat===(i===1);b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));}
            this.gapCopyHint.hidden=!settings.gapEnabled;
            this.gapCopyHint.textContent=flow.mode==='start'?'Tap the first cell to copy.':flow.mode==='end'?`Start: ${flow.start+1}. Tap the last cell to copy.`:flow.mode==='paste'?`Cells ${flow.start+1}–${flow.end+1} copied. Tap a destination${flow.repeat?' to repeat through the loop end':''}. Tap the active Copy button to cancel.`:'Copy / Copy Sec: tap first cell, last cell, then destination. Copy Sec repeats to the loop end.';
            if(!settings.gapEnabled)return;
            const step=this.gapStep(),count=Math.ceil(1/step-1e-9);
            if(this.gapCells.children.length!==count){this.gapCells.replaceChildren();for(let i=0;i<count;i++){const b=this.document.createElement('button');b.type='button';b.dataset.gapCell=String(i);b.textContent=String(i+1);this.gapCells.append(b);}}
            [...this.gapCells.children].forEach((b,i)=>{const start=i*step,end=Math.min(1,(i+1)*step);const muted=settings.gaps.some(([a,z])=>a<end-1e-9&&z>start+1e-9);b.classList.toggle('muted',muted);b.setAttribute('aria-pressed',String(muted));b.setAttribute('aria-label',`Grid section ${i+1}: ${muted?'muted; tap to restore':'audible; tap to mute'}`);});
            [...this.gapCells.children].forEach((b,i)=>{
                b.classList.toggle('copy-selected',flow.mode!=='idle'&&Number.isInteger(flow.start)&&i>=flow.start&&i<=(flow.end??flow.start));
                if(flow.mode!=='idle')b.setAttribute('aria-label',`Grid section ${i+1}: ${flow.mode==='start'?'choose copy start':flow.mode==='end'?'choose copy end':flow.repeat?'repeat copied section from here to loop end':'paste copied section here'}`);
            });
        }
        element(id) { return this.document.getElementById(this.adapter.prefix ? id.replace('bastardLoopVCut', this.adapter.prefix) : id); }
        handle(boundary) { return this.element(boundary === 'start' ? 'bastardLoopVCutStart' : 'bastardLoopVCutEnd'); }
        message(text) { this.element('bastardLoopVCutStatus').textContent = text; }

        edit(action, label = `Loop ${this.label} cut edit`) {
            try {
                const result = this.adapter.edit ? this.adapter.edit(label, action) : action();
                if (result?.catch) result.catch(error => this.message(error.message));
                return result;
            } catch (error) { this.message(error.message); return false; }
        }

        bindDrag(element, boundary, body = false) {
            element.addEventListener('pointerdown', event => {
                if (event.button !== 0 || this.drag) return;
                const settings = this.adapter.settings();
                if ((body && settings.gapEnabled) || (boundary === 'section' && (settings.stretch || settings.gapEnabled))) return;
                const rect = this.timeline.getBoundingClientRect();
                const position = (event.clientX - rect.left) / rect.width;
                const selected = region(settings);
                if (body && ((!settings.stretch && !['V','W'].includes(this.label)) || position < selected.start || position > selected.end)) return;
                const dragBoundary = body && !settings.stretch ? 'section' : boundary;
                event.preventDefault();
                event.stopPropagation();
                this.edit(() => new Promise(resolve => {
                    this.drag = { boundary: dragBoundary, pointerId: event.pointerId, offset: dragBoundary === 'section' ? position - selected.start : settings.stretch ? position - selected[boundary] : 0, finish: resolve };
                    try { element.setPointerCapture(event.pointerId); }
                    catch (error) { this.drag = null; throw error; }
                }));
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
            const finish = this.drag.finish;
            this.drag = null;
            try { this.adapter.set(this.adapter.settings()); }
            catch (error) { this.message(error.message); }
            finally { finish?.(); this.refresh(); }
        }

        change(patch) {
            this.finishDrag();
            this.edit(() => this.adapter.set(normalize({ ...this.adapter.settings(), ...patch })));
            this.refresh();
        }

        move(boundary, position, preview = false) {
            const settings = this.adapter.settings();
            const timing = this.adapter.timing();
            const step = settings.snap ? timing.bar * settings.grid / timing.cycle : 0;
            const apply = () => this.adapter.set(boundary === 'section' ? moveSection(settings, position, step) : moveBoundary(settings, boundary, position, step, 1 / timing.frames), { preview });
            if (preview) apply(); else this.edit(apply);
            this.refresh();
        }

        open() {
            if (!this.adapter.buffer()) throw new Error('Load or generate a loop first.');
            this.previousFocus = this.document.activeElement;
            this.overlay.hidden = false;
            this.overlay.setAttribute('aria-hidden', 'false');
            this.refresh();
            this.message(`${['V','W'].includes(this.label) ? 'Stretch Off: drag the highlighted source section to move it without changing its length; use Start/End to trim.' : 'Stretch Off edits the source.'} Stretch On captures that source: drag its highlighted body or Start to move it, End to stretch without changing pitch. Loop timing and the original sample stay unchanged.`);
            this.element('bastardLoopVCutClose').focus();
            const tick = () => {
                if (this.overlay.hidden) return;
                if(root.mygrainDisplay&&!root.mygrainDisplay.canDraw(this.canvas,tick,'playhead'))return;
                const settings = normalize(this.adapter.settings());
                const output = this.adapter.phase();
                const source = sourcePhase(settings, output);
                const phase = outputWaveform(settings) ? (source===null?null:output) : source === null || !settings.stretch || !settings.enabled ? source : settings.targetStart + (source - settings.start) / (settings.end - settings.start) * settings.targetDuration;
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
            this.gapCopy={mode:'idle'};
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
            this.refreshGaps(normalize(settings));
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
            this.timeline.classList.toggle('gap-active', settings.gapEnabled);
            this.canvas.setAttribute('aria-label', outputWaveform(settings) ? 'Output timeline waveform showing section placement and repeats; red gaps mark muted output. Trim handles still edit the selected source or stretch destination.' : settings.stretch ? 'Selected source audio scaled into its destination; drag highlighted region to move without trimming' : 'Full vocal source waveform; highlighted source section may play at loop start or its original position');
            this.canvas.dataset.waveformView=outputWaveform(settings)?'output':'source';
            this.element('bastardLoopVCutSnap').checked = settings.snap;
            this.element('bastardLoopVCutGrid').value = String(settings.grid);
            const selected = region(settings);
            if (this.sectionDrag) {
                this.sectionDrag.hidden = settings.stretch || settings.gapEnabled;
                this.sectionDrag.style.left = `${selected.start * 100}%`;
                this.sectionDrag.style.width = `${selected.duration * 100}%`;
                this.sectionDrag.setAttribute('aria-label', `Move selected ${this.label} source section, ${(selected.start * timing.cycle).toFixed(3)} to ${(selected.end * timing.cycle).toFixed(3)} seconds; drag or use arrow keys`);
            }
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
            if(outputWaveform(settings))this.element('bastardLoopVCutRange').textContent+=' Waveform shows output placement/repeats; handles edit the source or stretch destination.';
            for (const id of ['bastardLoopVCutAuditionMetro', 'bastardLoopVCutAuditionLoops']) this.element(id).disabled = this.starting || !this.adapter.buffer();
            this.draw(settings, timing);
        }

        draw(settings, timing) {
            if(root.mygrainDisplay&&!root.mygrainDisplay.canDraw(this.canvas,()=>this.draw(normalize(this.adapter.settings()),this.adapter.timing())))return;
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
            const outputView=outputWaveform(settings);
            if (buffer) {
                const columns = Math.max(1, Math.min(1000, width));
                const values = outputView ? timelinePeaks(buffer,columns,timing.duration,settings) : peaks(buffer, columns, timing.duration);
                const peak = Math.max(.001, ...values.map(value => Math.max(Math.abs(value.low), value.high)));
                drawing.strokeStyle = settings.stretch && !outputView ? '#31495d' : '#7ce1f4';
                for (let column = 0; column < columns; column += 1) {
                    drawing.beginPath();
                    drawing.moveTo(column * width / columns, height / 2 - values[column].high / peak * height * .43);
                    drawing.lineTo(column * width / columns, height / 2 - values[column].low / peak * height * .43 + 1);
                    drawing.stroke();
                }
                if (settings.stretch && !outputView) {
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
            if(!outputView){
                drawing.fillRect(0, 0, selected.start * width, height);
                drawing.fillRect(selected.end * width, 0, (1 - selected.end) * width, height);
            }else if(settings.enabled&&settings.repeat){
                const placement=settings.stretch?settings.targetStart:settings.fromStart?0:settings.start;
                const length=selected.duration;
                drawing.strokeStyle='#73b4bf';drawing.setLineDash([3,4]);
                for(let i=0;i<1024;i++){const x=(placement+i*length)*width;if(x>=width)break;drawing.beginPath();drawing.moveTo(x,0);drawing.lineTo(x,height);drawing.stroke();}
                drawing.setLineDash([]);
            }
            if(settings.gapEnabled){drawing.fillStyle='#ff526b88';for(const [a,b] of settings.gaps){drawing.fillRect(a*width,0,(b-a)*width,height);}}
            drawing.strokeStyle = '#36ef69';
            drawing.strokeRect(selected.start * width, 1, selected.duration * width, height - 2);
        }
    }

    const api = { normalizeGaps, toggleGap, copyGapSection, pasteGapSection, normalize, region, setStretch, setFromStart, randomize, moveBoundary, moveSection, gate, sourcePhase, peaks, timelinePeaks, grids, Editor };
    root.MygrainVocalCut = api;
    if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis);
