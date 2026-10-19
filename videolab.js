(function (root) {
    'use strict';

    const BUILD = 'v2026.10.19.V.2';
    const MAX_SECONDS = 180;
    const MAX_BYTES = 128 * 1024 * 1024;
    const BUILTIN = Object.freeze({ id: 'bbc-archive', name: 'BBC Archive', url: 'https://www.youtube.com/@BBCArchive', builtin: true });
    const TARGETS = Object.freeze({ grainMain: 'Apply', V: 'V', grainA: 'Grain A', grainB: 'Grain B' });

    function parseYouTubeURL(value) {
        let url;
        try { url = new URL(String(value).trim()); } catch { throw new Error('Paste a complete YouTube video or channel URL.'); }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be'].includes(url.hostname)) throw new Error('Use a youtube.com or youtu.be URL, not another host.');
        let videoID;
        if (url.hostname.endsWith('youtu.be')) videoID = url.pathname.split('/')[1];
        else if (url.pathname === '/watch') videoID = url.searchParams.get('v');
        else if (/^\/(shorts|live|embed)\//.test(url.pathname)) videoID = url.pathname.split('/')[2];
        if (videoID && /^[A-Za-z0-9_-]{11}$/.test(videoID)) return { kind: 'video', videoID, url: `https://www.youtube.com/watch?v=${videoID}` };
        const channel = url.pathname.replace(/\/$/, '');
        if (/^\/@[A-Za-z0-9_.%-]+(?:\/(?:videos|featured|shorts|streams))?$/.test(channel) || /^\/(?:channel|c|user)\/[A-Za-z0-9_.%-]+(?:\/(?:videos|featured|shorts|streams))?$/.test(channel)) return { kind: 'channel', url: `https://www.youtube.com${channel}` };
        throw new Error('Choose one video or save a channel bookmark. Playlist downloads are not supported.');
    }

    function captureSettings(start, duration) {
        const timestamp = String(start).trim().match(/^(\d{1,3}):([0-5]\d(?:\.\d{1,3})?)$/);
        if (!timestamp) throw new Error('Enter Start time as minutes:seconds (mm:ss), e.g. 02:30 for 2 minutes 30 seconds.');
        const startSeconds = Number(timestamp[1]) * 60 + Number(timestamp[2]);
        if (startSeconds > 21600) throw new Error('Start time must be between 00:00 and 360:00 (6 hours).');
        const durationSeconds = Number(duration);
        if (!Number.isFinite(durationSeconds) || durationSeconds < 0.1 || durationSeconds > MAX_SECONDS) throw new Error('Duration must be 0.1–180 seconds (default 120).');
        return { startSeconds, durationSeconds };
    }

    function seedRecorder(buffer, radio = root.MygrainRadiolab, metadata = {}) {
        if (!radio?.PCMRecorder) throw new Error('RadioLab PCM is not ready. Please try again.');
        if (!buffer || !Number.isInteger(buffer.length) || buffer.length < 1 || !Number.isFinite(buffer.sampleRate) || buffer.sampleRate < 1 || buffer.sampleRate > 192000 || ![1, 2].includes(buffer.numberOfChannels) || buffer.length / buffer.sampleRate > MAX_SECONDS) throw new Error('Server audio must be a non-empty, finite mono/stereo take of at most 180 seconds.');
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
        if (channels.some(channel => channel.length !== buffer.length || channel.some(value => !Number.isFinite(value)))) throw new Error('Server audio contains invalid PCM samples. Previous take retained.');
        const recorder = new radio.PCMRecorder({ sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, maxSeconds: MAX_SECONDS, maxBytes: MAX_BYTES }).start(null, 0, metadata);
        recorder.append(channels);
        recorder.stop();
        if (recorder.frames !== buffer.length || !recorder.hasSignal) { recorder.clear(); throw new Error('Server audio is empty or contains only digital silence. Previous take retained.'); }
        return recorder;
    }

    function apiBase(base) { return new URL('api/videolab/', new URL('.', base)); }

    function capturePhase(capture) {
        const phase = String(capture?.status || capture?.phase || capture?.state || '').toLowerCase();
        if (['ready', 'complete', 'completed', 'done', 'finished'].includes(phase)) return 'ready';
        if (['error', 'failed', 'failure'].includes(phase)) return 'error';
        if (['cancelled', 'canceled'].includes(phase)) return 'cancelled';
        if (['queued', 'pending'].includes(phase)) return 'queued';
        return 'working';
    }

    class Controller {
        constructor(card, adapter, environment = root) {
            if (!environment.MygrainRadiolab?.PCMRecorder) throw new Error('Load radiolab.js before starting Video Lab.');
            this.root = environment;
            this.card = card;
            this.adapter = adapter;
            this.dialog = this.element('videolabSamplesDialog');
            this.base = apiBase(environment.document.baseURI);
            this.epoch = 0;
            this.browserEpoch = 0;
            this.previewEpoch = 0;
            this.requests = new Set();
            this.bookmarks = [BUILTIN];
            this.samples = [];
            this.sampleRows = new Map();
            this.recorder = null;
            this.capture = null;
            this.busy = false;
            this.username = null;
            this.locked = true;
            this.closed = false;
            this.bind();
            this.open();
        }

        element(id) { return this.root.document.getElementById(id); }
        status(message, browser = false) { this.element(browser ? 'videolabBrowserStatus' : 'videolabStatus').textContent = message; }

        assertActive(epoch = this.epoch) {
            const accounts = this.root.mygrainAccounts;
            if (!accounts?.authenticated || (this.username && accounts.user?.username !== this.username)) this.close(true);
            if (this.locked || this.closed || epoch !== this.epoch || !this.username) throw new Error('Video Lab account session ended. Reopen after login.');
        }

        assertBrowser(generation) {
            this.assertActive();
            if (!this.dialog.open || generation !== this.browserEpoch) throw new Error('Video Lab browser closed. Reopen to try again.');
        }

        get state() {
            return Object.freeze({ build: BUILD, locked: this.locked, closed: this.closed, busy: this.busy, capturing: Boolean(this.capture), phase: this.capture?.phase || null, hasTake: Boolean(this.recorder?.frames), recordedSeconds: this.recorder?.duration || 0, trimStartSeconds: this.recorder ? this.recorder.trimStartFrame / this.recorder.sampleRate : 0, trimEndSeconds: this.recorder ? this.recorder.endFrame / this.recorder.sampleRate : 0, trimmedSeconds: this.recorder ? this.recorder.selectedFrames / this.recorder.sampleRate : 0, normalized: Boolean(this.recorder?.normalized), previewing: Boolean(this.preview) });
        }

        async request(path, options = {}, operation = null, binary = false) {
            const epoch = this.epoch;
            this.assertActive(epoch);
            const abort = new AbortController();
            const cancel = () => abort.abort();
            operation?.abort.signal.addEventListener('abort', cancel, { once: true });
            if (operation?.abort.signal.aborted) abort.abort();
            this.requests.add(abort);
            const timer = this.root.setTimeout(() => abort.abort(), 45000);
            const headers = new Headers(options.headers || {});
            headers.set('X-Mygrain-User', this.username);
            try {
                const response = await this.root.fetch(new URL(path, this.base).href, { ...options, headers, credentials: 'same-origin', cache: 'no-store', signal: abort.signal });
                if (!response.ok) {
                    const payload = await response.json().catch(() => ({}));
                    throw new Error(typeof payload.error === 'string' ? payload.error : `Video Lab returned ${response.status}.`);
                }
                if (binary && Number(response.headers.get('Content-Length')) > MAX_BYTES) throw new Error('Server audio is too large. Previous take retained.');
                const payload = binary ? await response.arrayBuffer() : await response.json();
                if (operation && !binary && payload.capture?.id && this.capture !== operation && operation.username && this.root.mygrainAccounts?.user?.username === operation.username) this.deleteCapture(payload.capture.id, operation.username);
                this.assertActive(epoch);
                if (abort.signal.aborted) throw new Error('Video Lab request cancelled or timed out.');
                if (binary && (!payload.byteLength || payload.byteLength > MAX_BYTES)) throw new Error('Server audio is empty or too large. Previous take retained.');
                if (!binary && payload.ok === false) throw new Error(typeof payload.error === 'string' ? payload.error : 'Video Lab request failed.');
                return payload;
            } finally {
                this.root.clearTimeout(timer);
                this.requests.delete(abort);
                operation?.abort.signal.removeEventListener('abort', cancel);
            }
        }

        async run(action, browser = false) {
            if (this.busy || this.capture || this.locked || this.closed) return;
            const epoch = this.epoch;
            const generation = this.browserEpoch;
            this.busy = true;
            this.render();
            try { return await action(); }
            catch (error) { if (epoch === this.epoch && !this.locked && (!browser || (this.dialog.open && generation === this.browserEpoch))) this.status(error.message || 'Video Lab action failed.', browser); }
            finally { if (epoch === this.epoch) { this.busy = false; this.render(); } }
        }

        context() {
            this.assertActive();
            const context = this.adapter.getContext?.();
            if (!context || context.state !== 'running') throw new Error('Start MYGRAIN first, then tap this action again to enable audio.');
            return context;
        }

        bind() {
            const click = (id, action, browser = false) => this.element(id).addEventListener('click', () => this.run(action, browser));
            click('videolabSaveURL', () => this.saveURL());
            click('videolabShowVideo', () => this.showVideo());
            click('videolabSave', () => this.save());
            click('videolabBrowse', () => this.openBrowser());
            click('videolabRefreshSamples', () => this.refreshSamples(), true);
            click('videolabNormalize', () => this.normalizeTake());
            click('videolabTrimReset', () => { this.stopPreview(); this.recorder.setTrimFrames(0, this.recorder.frames); this.render(); });
            this.element('videolabFetch').addEventListener('click', () => { this.fetchAudio().catch(error => { if (!this.locked && !this.closed) this.status(error.message); }); });
            this.element('videolabCancel').addEventListener('click', () => this.cancelCapture());
            this.element('videolabPreview').addEventListener('click', () => { if (this.preview) this.stopPreview(); else this.run(() => this.previewTake()); });
            this.element('videolabStopPreview').addEventListener('click', () => this.stopPreview());
            this.element('videolabBrowserClose').addEventListener('click', () => this.dialog.close());
            this.dialog.addEventListener('close', () => { if (!this.clearing && !this.closed) this.close(); });
            this.element('videolabSavedURL').addEventListener('change', event => { this.element('videolabURL').value = event.target.value; this.urlChanged(); });
            this.element('videolabURL').addEventListener('input', () => this.urlChanged());
            this.element('videolabLoadTarget').addEventListener('change', () => { this.stopPreview(); this.renderSamples(); });
            for (const [id, boundary] of [['videolabTrimStart', 'start'], ['videolabTrimEnd', 'end']]) this.element(id).addEventListener('input', event => this.setTrim(boundary, Number(event.target.value)));
            const canvas = this.element('videolabWaveform');
            canvas.addEventListener('pointerdown', event => {
                if (!this.canTrim() || event.button > 0) return;
                const bounds = canvas.getBoundingClientRect();
                const frame = (event.clientX - bounds.left) / bounds.width * this.recorder.frames;
                this.pointer = { id: event.pointerId, boundary: Math.abs(frame - this.recorder.trimStartFrame) < Math.abs(frame - this.recorder.endFrame) ? 'start' : 'end' };
                canvas.setPointerCapture(event.pointerId);
                this.setTrim(this.pointer.boundary, frame / this.recorder.sampleRate);
                event.preventDefault();
            });
            canvas.addEventListener('pointermove', event => {
                if (event.pointerId !== this.pointer?.id || !this.canTrim()) return;
                const bounds = canvas.getBoundingClientRect();
                this.setTrim(this.pointer.boundary, (event.clientX - bounds.left) / bounds.width * this.recorder.duration);
                event.preventDefault();
            });
            for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, () => this.releasePointer());
            this.root.addEventListener('resize', () => this.drawWaveform());
            this.root.addEventListener('mygrain-account-lock', () => this.close(true));
            this.root.addEventListener('mygrain-account-changed', () => { this.close(true); this.open(); });
            this.root.addEventListener('mygrain-videolab-close', () => this.close());
            this.root.addEventListener('mygrain-videolab-open', () => this.open());
            this.root.addEventListener('pagehide', () => this.close(true));
            this.root.addEventListener('pageshow', event => { if (event.persisted) this.open(); });
            this.root.document.addEventListener('visibilitychange', () => { if (this.root.document.visibilityState === 'hidden') this.stopPreview(); });
            if (this.root.ResizeObserver) { this.observer = new this.root.ResizeObserver(() => this.drawWaveform()); this.observer.observe(canvas); }
        }

        open() {
            if (!this.closed && this.username && this.username === this.root.mygrainAccounts?.user?.username && !this.locked) return;
            this.closed = false;
            this.username = this.root.mygrainAccounts?.authenticated ? this.root.mygrainAccounts.user?.username || null : null;
            this.locked = !this.username;
            this.status(this.locked ? 'Log in to use your private Video Lab.' : 'Choose a video URL. Start MYGRAIN, then tap Record/Fetch audio.');
            this.render();
            if (!this.locked) return this.run(() => this.refreshBookmarks());
        }

        close(lock = false) {
            this.clearing = true;
            this.cancelCapture(false, true);
            this.epoch += 1;
            this.browserEpoch += 1;
            this.requests.forEach(abort => abort.abort());
            this.requests.clear();
            this.stopPreview();
            this.savedEditor?.close();
            this.recorder?.clear();
            this.recorder = null;
            this.samples = [];
            this.bookmarks = [BUILTIN];
            this.username = null;
            this.locked = lock;
            this.closed = true;
            this.busy = false;
            this.hideVideo();
            this.releasePointer();
            for (const id of ['videolabSampleName', 'videolabBookmarkName']) this.element(id).value = '';
            this.element('videolabURL').value = BUILTIN.url;
            this.element('videolabStart').value = '00:00';
            this.element('videolabDuration').value = '120';
            this.element('videolabLoadTarget').value = 'grainMain';
            this.renderBookmarks();
            this.element('videolabSampleList').replaceChildren();
            this.sampleRows?.clear();
            this.status('Video Lab cleared. Reopen after starting MYGRAIN.');
            this.status('Private sample browser cleared.', true);
            if (this.dialog.open) this.dialog.close();
            this.render();
            this.clearing = false;
        }

        urlChanged() {
            this.cancelCapture(false);
            this.stopPreview();
            this.hideVideo();
            this.updateURL();
            this.status('URL changed. Previous take retained; fetch replaces it only after a successful decode.');
            this.render();
        }

        updateURL() {
            let parsed;
            try { parsed = parseYouTubeURL(this.element('videolabURL').value); } catch {}
            const link = this.element('videolabOpenURL');
            if (parsed && !this.locked && !this.closed && !this.busy && !this.capture) { link.href = parsed.url; link.removeAttribute('aria-disabled'); link.removeAttribute('tabindex'); }
            else { link.removeAttribute('href'); link.setAttribute('aria-disabled', 'true'); link.setAttribute('tabindex', '-1'); }
            this.element('videolabURLHelp').textContent = parsed?.kind === 'channel' ? 'Channel bookmark: open the archive, choose one video, then paste its video URL here. Channels and playlists are not fetched.' : parsed ? 'Single video selected. Enter the source start time and a finite duration (120 seconds by default, maximum 180).' : 'Paste a valid YouTube video URL, or save a channel bookmark. Playlist downloads are not supported.';
            return parsed;
        }

        async refreshBookmarks() {
            const payload = await this.request('bookmarks');
            const entries = Array.isArray(payload.bookmarks) ? payload.bookmarks : [];
            const seen = new Set([BUILTIN.url]);
            this.bookmarks = [BUILTIN];
            for (const item of entries) {
                try {
                    const parsed = parseYouTubeURL(item.url);
                    if (parsed.url === BUILTIN.url) { this.bookmarks[0] = { ...BUILTIN, id: item.id || BUILTIN.id, name: String(item.name || BUILTIN.name).slice(0, 100) }; continue; }
                    if (seen.has(parsed.url)) continue;
                    seen.add(parsed.url);
                    this.bookmarks.push({ id: item.id, name: String(item.name || 'Saved URL').slice(0, 100), url: parsed.url });
                } catch {}
            }
            this.renderBookmarks();
        }

        renderBookmarks() {
            const select = this.element('videolabSavedURL');
            const selected = this.element('videolabURL').value;
            select.replaceChildren();
            for (const bookmark of this.bookmarks) {
                const option = this.root.document.createElement('option');
                option.value = bookmark.url;
                option.textContent = `${bookmark.name}${parseYouTubeURL(bookmark.url).kind === 'channel' ? ' · channel' : ''}`;
                select.append(option);
            }
            select.value = selected;
        }

        async saveURL() {
            const parsed = parseYouTubeURL(this.element('videolabURL').value);
            const name = this.element('videolabBookmarkName').value.trim();
            if (!name || name.length > 100) throw new Error('Give this URL a name (1–100 characters).');
            await this.request('bookmarks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, url: parsed.url }) });
            await this.refreshBookmarks();
            this.status(`Saved URL “${name}” to this account. Channel bookmarks open for video selection; they are not downloaded.`);
        }

        showVideo() {
            this.context();
            const parsed = parseYouTubeURL(this.element('videolabURL').value);
            if (parsed.kind !== 'video') throw new Error('Open the archive and choose a single video first.');
            this.hideVideo();
            const frame = this.root.document.createElement('iframe');
            frame.id = 'videolabYouTubeFrame';
            frame.title = 'YouTube video preview · native controls';
            frame.src = `https://www.youtube.com/embed/${parsed.videoID}?controls=1&playsinline=1&autoplay=0`;
            frame.allow = 'encrypted-media; fullscreen; picture-in-picture';
            frame.referrerPolicy = 'strict-origin-when-cross-origin';
            frame.allowFullscreen = true;
            this.element('videolabVideoPreview').append(frame);
            this.element('videolabVideoPreview').hidden = false;
        }

        hideVideo() { this.element('videolabVideoPreview').replaceChildren(); this.element('videolabVideoPreview').hidden = true; }

        deleteCapture(id, username = this.username) {
            if (!id || !username || !this.root.mygrainAccounts?.authenticated || this.root.mygrainAccounts.user?.username !== username) return;
            const abort = new AbortController();
            const timer = this.root.setTimeout(() => abort.abort(), 5000);
            Promise.resolve(this.root.fetch(new URL(`captures/${encodeURIComponent(id)}`, this.base).href, { method: 'DELETE', credentials: 'same-origin', cache: 'no-store', headers: { 'X-Mygrain-User': username }, signal: abort.signal })).catch(() => {}).finally(() => this.root.clearTimeout(timer));
        }

        cancelCapture(announce = true, clearIdentity = false) {
            const operation = this.capture;
            if (!operation) return;
            this.capture = null;
            operation.abort.abort();
            if (operation.timer) this.root.clearTimeout(operation.timer);
            operation.wake?.();
            this.deleteCapture(operation.id, operation.username);
            if (operation.id || clearIdentity) operation.username = null;
            if (announce) this.status('Retrieval cancelled. Previous take retained.');
            this.render();
        }

        assertCapture(operation) {
            this.assertActive(operation.epoch);
            if (this.capture !== operation || operation.abort.signal.aborted) throw new Error('Retrieval cancelled. Previous take retained.');
        }

        async fetchAudio() {
            this.assertActive();
            if (this.capture || this.busy) return;
            const parsed = parseYouTubeURL(this.element('videolabURL').value);
            if (parsed.kind !== 'video') throw new Error('Channel bookmark: open the archive, choose one video and paste its URL. No channel or playlist is downloaded.');
            const settings = captureSettings(this.element('videolabStart').value, this.element('videolabDuration').value);
            const context = this.context();
            this.stopPreview();
            this.hideVideo();
            const operation = { abort: new AbortController(), epoch: this.epoch, username: this.username, phase: 'queued', started: Date.now(), id: null };
            this.capture = operation;
            this.status('Queued server audio retrieval… Previous take retained until a new take is ready.');
            this.render();
            try {
                let payload = await this.request('captures', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: parsed.url, ...settings }) }, operation);
                this.assertCapture(operation);
                if (!payload.capture?.id) throw new Error('Server did not return a capture ID. Previous take retained.');
                operation.id = payload.capture.id;
                for (;;) {
                    this.assertCapture(operation);
                    const capture = payload.capture || payload;
                    operation.phase = capturePhase(capture);
                    if (operation.phase === 'error') throw new Error(typeof capture.error === 'string' ? capture.error : 'Server retrieval failed. Previous take retained.');
                    if (operation.phase === 'cancelled') throw new Error('Server retrieval cancelled. Previous take retained.');
                    if (operation.phase === 'ready') break;
                    if (Date.now() - operation.started > 300000) throw new Error('Server retrieval timed out. Previous take retained.');
                    this.status(operation.phase === 'queued' ? 'Server job queued… Cancel is available.' : 'Server is fetching/decoding the selected interval… Cancel is available.');
                    const progress = Number(capture.progress ?? capture.progressPercent);
                    operation.progress = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress <= 1 ? progress * 100 : progress)) : null;
                    this.render();
                    await new Promise(resolve => { operation.wake = resolve; operation.timer = this.root.setTimeout(resolve, 800); });
                    operation.timer = null;
                    operation.wake = null;
                    this.assertCapture(operation);
                    payload = await this.request(`captures/${encodeURIComponent(operation.id)}`, {}, operation);
                }
                operation.phase = 'decoding';
                operation.progress = null;
                this.status('Decoding the finite WAV take… Previous take still retained.');
                this.render();
                const body = await this.request(`captures/${encodeURIComponent(operation.id)}/audio`, {}, operation, true);
                this.assertCapture(operation);
                const buffer = await context.decodeAudioData(body);
                this.assertCapture(operation);
                if (context !== this.adapter.getContext?.() || context.state !== 'running') throw new Error('MYGRAIN audio state changed. Previous take retained; start MYGRAIN and retry.');
                const capture = payload.capture || payload;
                const recorder = seedRecorder(buffer, this.root.MygrainRadiolab, { source: { title: String(capture.source?.title || 'YouTube video').slice(0, 200), url: parsed.url }, ...settings });
                this.recorder?.clear();
                this.recorder = recorder;
                this.element('videolabSampleName').value = String(capture.source?.title || 'Video take').slice(0, 100);
                this.status(`Take ready: ${recorder.duration.toFixed(2)} s. Trim, Preview, Normalise and Save. No playback was started.`);
            } catch (error) {
                if (this.capture === operation && operation.epoch === this.epoch) this.status(`${error.message || 'Server retrieval failed.'} Previous take retained.`);
            } finally {
                if (this.capture === operation) {
                    this.capture = null;
                    this.deleteCapture(operation.id, operation.username);
                    this.render();
                }
                operation.username = null;
            }
        }

        canTrim() { return !this.locked && !this.closed && !this.busy && !this.capture && this.recorder?.state === 'stopped' && this.recorder.frames > 0; }

        currentTake() {
            this.assertActive();
            if (!this.recorder?.selectedFrames || !this.recorder.selectionStats().audible || this.capture) throw new Error('Choose a non-empty, audible take selection first.');
            return this.recorder;
        }

        releasePointer() {
            const pointer = this.pointer;
            this.pointer = null;
            const canvas = this.element('videolabWaveform');
            if (pointer && canvas.hasPointerCapture?.(pointer.id)) canvas.releasePointerCapture(pointer.id);
        }

        setTrim(boundary, seconds) {
            if (!this.canTrim() || !Number.isFinite(seconds)) return;
            const recorder = this.recorder;
            const frame = Math.round(seconds * recorder.sampleRate);
            const start = boundary === 'start' ? Math.max(0, Math.min(recorder.endFrame - 1, frame)) : recorder.trimStartFrame;
            const end = boundary === 'end' ? Math.max(start + 1, Math.min(recorder.frames, frame)) : recorder.endFrame;
            this.stopPreview();
            recorder.setTrimFrames(start, end);
            this.status('Trim updated. Preview and Save use only this selection. Save normalises the selection; original take retained.');
            this.render();
        }

        normalizeTake() {
            this.stopPreview();
            this.currentTake().normalize();
            this.status('Selected audio normalised to peak 1.0 (0 dBFS). Original PCM retained; changing trim resets normalisation.');
            this.render();
        }

        stopPreview() {
            this.previewEpoch += 1;
            this.savedTrimPreview = null;
            if (this.preview) {
                this.preview.onended = null;
                try { this.preview.stop(); } catch {}
                this.preview.disconnect();
                this.preview = null;
            }
            this.render();
        }

        playRecorder(recorder, generation) {
            const context = this.context();
            if (generation !== this.previewEpoch) return;
            const chunks = recorder.selectedChunks();
            const buffer = context.createBuffer(recorder.channels, recorder.selectedFrames, recorder.sampleRate);
            let offset = 0;
            for (const chunk of chunks) { chunk.forEach((channel, index) => buffer.copyToChannel(channel, index, offset)); offset += chunk[0].length; }
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.loop = false;
            source.connect(context.destination);
            this.preview = source;
            source.onended = () => { if (this.preview === source) this.stopPreview(); };
            try { source.start(); } catch (error) { this.stopPreview(); throw error; }
            this.render();
        }

        previewTake() {
            const recorder = this.currentTake();
            this.stopPreview();
            this.playRecorder(recorder, this.previewEpoch);
        }

        async save() {
            const recorder = this.currentTake();
            const name = this.element('videolabSampleName').value.trim();
            if (!name || name.length > 100) throw new Error('Name the recording (1–100 characters) before saving.');
            this.stopPreview();
            recorder.normalize();
            const payload = await this.request(`samples?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: recorder.wav() });
            this.status(`Saved “${payload.sample?.name || name}” to your private Video Lab samples. Only the normalised selected interval was saved.`);
            this.render();
            return payload.sample;
        }

        async openBrowser(target) {
            this.assertActive();
            if (target !== undefined && !Object.hasOwn(TARGETS, target)) throw new Error('Choose Apply, V, Grain A or Grain B.');
            this.stopPreview();
            if (target) this.element('videolabLoadTarget').value = target;
            this.browserEpoch += 1;
            if (this.dialog.parentNode !== this.root.document.body) this.root.document.body.append(this.dialog);
            if (!this.dialog.open) this.dialog.showModal();
            this.render();
            await this.refreshSamples();
        }

        async refreshSamples() {
            const generation = this.browserEpoch;
            this.assertBrowser(generation);
            this.stopPreview();
            this.status('Loading private Video Lab samples…', true);
            const payload = await this.request('samples');
            this.assertBrowser(generation);
            this.samples = (Array.isArray(payload.samples) ? payload.samples : []).filter(sample => typeof sample?.filename === 'string' && sample.filename.length <= 255 && !/[\\/\x00-\x1f]/.test(sample.filename) && !['.', '..'].includes(sample.filename));
            this.renderSamples();
            this.status(`${this.samples.length} private sample${this.samples.length === 1 ? '' : 's'}. Load never starts playback.`, true);
        }

        async sampleBody(sample, generation) {
            this.assertBrowser(generation);
            const body = await this.request(`samples/${encodeURIComponent(sample.filename)}`, {}, null, true);
            this.assertBrowser(generation);
            return body;
        }

        async playSample(sample) {
            const generation = this.browserEpoch;
            this.assertBrowser(generation);
            const context = this.context();
            this.stopPreview();
            const preview = this.previewEpoch;
            const body = await this.sampleBody(sample, generation);
            if (preview !== this.previewEpoch) return;
            const buffer = await context.decodeAudioData(body);
            this.assertBrowser(generation);
            if (preview !== this.previewEpoch || context !== this.adapter.getContext?.()) return;
            const recorder = seedRecorder(buffer, this.root.MygrainRadiolab);
            try { this.playRecorder(recorder, preview); } finally { recorder.clear(); }
        }

        async loadSample(sample) {
            const epoch = this.epoch;
            const generation = this.browserEpoch;
            this.assertBrowser(generation);
            const context = this.context();
            const target = this.element('videolabLoadTarget').value;
            if (!Object.hasOwn(TARGETS, target)) throw new Error('Choose Apply, V, Grain A or Grain B.');
            const guard = () => { this.assertActive(epoch); this.assertBrowser(generation); if (context !== this.context()) throw new Error('MYGRAIN audio context changed. Retry loading this sample.'); };
            const body = await this.sampleBody(sample, generation);
            guard();
            this.stopPreview();
            await this.adapter.load(body, sample, target, guard);
            guard();
            this.status(`Loaded “${sample.name || sample.filename}” into ${TARGETS[target]}. Playback was not started.`, true);
        }

        async deleteSample(sample) {
            const generation = this.browserEpoch;
            this.assertBrowser(generation);
            if (!this.root.confirm(`Delete “${sample.name || sample.filename}” from your private Video Lab samples?`)) return;
            this.stopPreview();
            await this.request(`samples/${encodeURIComponent(sample.filename)}`, { method: 'DELETE' });
            this.assertBrowser(generation);
            await this.refreshSamples();
        }

        editSampleName(sample) {
            this.assertBrowser(this.browserEpoch);
            this.stopPreview();
            this.savedEditor ||= new this.root.MygrainRadiolab.SavedSampleEditor(this, 'videolab');
            this.savedEditor.open(sample);
        }

        async trimSample(sample) {
            const generation = this.browserEpoch;
            this.assertBrowser(generation);
            this.savedEditor?.close();
            this.stopPreview();
            const context = this.context();
            const previewEpoch = this.previewEpoch;
            this.status(`Opening “${sample.name || sample.filename}” for re-trim…`, true);
            const body = await this.sampleBody(sample, generation);
            if (previewEpoch !== this.previewEpoch) return;
            const buffer = await context.decodeAudioData(body);
            this.assertBrowser(generation);
            if (previewEpoch !== this.previewEpoch || context !== this.adapter.getContext?.()) return;
            const recorder = seedRecorder(buffer, this.root.MygrainRadiolab);
            this.savedEditor ||= new this.root.MygrainRadiolab.SavedSampleEditor(this, 'videolab');
            this.savedEditor.open(sample, recorder);
            this.status('Re-trim ready. Preview is manual; Save new WAV keeps the original and current take unchanged.', true);
        }

        previewSavedTrim(editor) {
            const recorder = editor.selectedRecorder();
            this.stopPreview();
            this.savedTrimPreview = recorder;
            this.playRecorder(recorder, this.previewEpoch);
        }

        async renameSavedSample(editor) {
            const name = editor.validatedName();
            const revision = editor.revision;
            const filename = editor.sample.filename;
            this.stopPreview();
            const payload = await this.request(`samples/${encodeURIComponent(filename)}/rename`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
            editor.assertCurrent(revision);
            if (payload.sample?.filename !== filename || typeof payload.sample.name !== 'string' || (editor.sample.url && payload.sample.url && payload.sample.url !== editor.sample.url)) throw new Error('Storage did not confirm a safe name change with the same source link. Refresh the browser before retrying.');
            this.samples = this.samples.map(sample => sample.filename === filename ? { ...sample, ...payload.sample } : sample);
            this.renderSamples();
            this.status(`Renamed to “${payload.sample.name}”. Existing project and Song links are unchanged.`, true);
            this.sampleRows.get(payload.sample.filename)?.rename.focus();
        }

        async saveSavedTrim(editor) {
            const name = editor.validatedName();
            const revision = editor.revision;
            const recorder = editor.selectedRecorder();
            const original = editor.sample.filename;
            this.stopPreview();
            recorder.normalize();
            const params = new URLSearchParams({ name, sourceFilename: original });
            const payload = await this.request(`samples?${params}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: recorder.wav() });
            editor.assertCurrent(revision);
            if (!payload.sample?.filename || payload.sample.filename === original) throw new Error('Storage did not confirm a NEW WAV. The original and trim are retained; refresh before retrying.');
            this.samples = [payload.sample, ...this.samples];
            this.renderSamples();
            this.status(`Saved new WAV “${payload.sample.name || name}”. Original file and current take are unchanged.`, true);
            this.sampleRows.get(payload.sample.filename)?.trim.focus();
        }

        renderSamples() {
            this.savedEditor?.close();
            const list = this.element('videolabSampleList');
            list.replaceChildren();
            this.sampleRows ||= new Map();
            this.sampleRows.clear();
            if (!this.samples.length) { const empty = this.root.document.createElement('p'); empty.textContent = 'No saved Video Lab samples yet. Fetch, trim and Save a take first.'; list.append(empty); }
            for (const sample of this.samples) {
                const row = this.root.document.createElement('article');
                row.className = 'radiolab-sample-row videolab-sample-row';
                row.dataset.filename = sample.filename;
                const heading = this.root.document.createElement('h3');
                heading.textContent = sample.name || sample.filename;
                row.append(heading);
                const details = this.root.document.createElement('p');
                details.className = 'videolab-note';
                details.textContent = `${sample.downloadName || sample.filename}${Number.isFinite(sample.duration) ? ` · ${sample.duration.toFixed(2)}s` : ''}`;
                row.append(details);
                const actions = this.root.document.createElement('div');
                actions.className = 'radiolab-sample-actions videolab-controls';
                const controls = { row };
                for (const [label, action, method] of [['Preview', 'preview', 'playSample'], ['Load', 'load', 'loadSample'], ['Rename file', 'rename', 'editSampleName'], ['Re-trim', 'trim', 'trimSample'], ['Delete', 'delete', 'deleteSample']]) {
                    const button = this.root.document.createElement('button');
                    button.type = 'button';
                    button.className = 'performance-btn';
                    button.textContent = label;
                    button.dataset.action = action;
                    button.setAttribute('aria-label', `${label} ${sample.name || sample.filename}${action === 'load' ? ` into ${TARGETS[this.element('videolabLoadTarget').value]}` : ''}`);
                    button.disabled = this.locked || this.closed || this.busy || Boolean(this.capture);
                    button.addEventListener('click', () => this.run(() => this[method](sample), true));
                    controls[action] = button;
                    actions.append(button);
                }
                row.append(actions);
                list.append(row);
                this.sampleRows.set(sample.filename, controls);
            }
        }

        render() {
            const blocked = this.locked || this.closed || this.busy || Boolean(this.capture);
            const parsed = this.updateURL();
            for (const id of ['videolabSavedURL', 'videolabURL', 'videolabBookmarkName', 'videolabSaveURL', 'videolabStart', 'videolabDuration', 'videolabBrowse', 'videolabSampleName']) this.element(id).disabled = blocked;
            this.element('videolabFetch').disabled = blocked || parsed?.kind !== 'video';
            this.element('videolabShowVideo').disabled = blocked || parsed?.kind !== 'video';
            this.element('videolabCancel').disabled = !this.capture;
            const progress = this.element('videolabProgress');
            progress.hidden = !this.capture;
            if (this.capture?.progress != null) progress.value = this.capture.progress;
            else progress.removeAttribute('value');
            const hasTake = Boolean(this.recorder?.frames);
            for (const id of ['videolabPreview', 'videolabNormalize', 'videolabSave', 'videolabTrimReset', 'videolabTrimStart', 'videolabTrimEnd']) this.element(id).disabled = blocked || !hasTake;
            if (this.preview && !this.locked && !this.closed) this.element('videolabPreview').disabled = false;
            this.element('videolabPreview').setAttribute('aria-pressed', String(Boolean(this.preview)));
            this.element('videolabPreview').textContent = this.preview ? 'Stop Preview' : 'Preview';
            this.element('videolabNormalize').setAttribute('aria-pressed', String(Boolean(this.recorder?.normalized)));
            this.element('videolabTake').textContent = hasTake ? `${this.recorder.duration.toFixed(3)} s take · ${this.recorder.normalized ? 'normalised selection' : 'original PCM'}` : 'No take yet.';
            const panel = this.element('videolabTrimPanel');
            panel.hidden = !hasTake;
            panel.disabled = blocked || !hasTake;
            if (panel.disabled) this.releasePointer();
            if (hasTake) {
                const recorder = this.recorder;
                for (const [boundary, frame] of [['Start', recorder.trimStartFrame], ['End', recorder.endFrame]]) {
                    const input = this.element(`videolabTrim${boundary}`);
                    input.max = String(recorder.duration);
                    input.step = String(1 / recorder.sampleRate);
                    input.value = String(frame / recorder.sampleRate);
                    input.setAttribute('aria-valuetext', `${(frame / recorder.sampleRate).toFixed(3)} seconds`);
                    this.element(`videolabTrim${boundary}Value`).textContent = `${(frame / recorder.sampleRate).toFixed(3)} s`;
                }
                this.element('videolabTrimDuration').textContent = `Selected: ${(recorder.selectedFrames / recorder.sampleRate).toFixed(3)} s`;
            }
            this.drawWaveform();
            this.element('videolabLoadTarget').disabled = blocked;
            this.element('videolabRefreshSamples').disabled = blocked;
            this.element('videolabStopPreview').disabled = !this.preview;
            for (const button of this.element('videolabSampleList').querySelectorAll('button')) button.disabled = blocked;
            this.savedEditor?.render(blocked);
        }

        drawWaveform() {
            const canvas = this.element('videolabWaveform');
            const painter = canvas.getContext('2d');
            if (!painter) return;
            if (!this.recorder?.frames) { painter.clearRect(0, 0, canvas.width, canvas.height); return; }
            const bounds = canvas.getBoundingClientRect();
            if (!bounds.width || !bounds.height) return;
            const ratio = this.root.devicePixelRatio || 1;
            canvas.width = Math.round(bounds.width * ratio);
            canvas.height = Math.round(bounds.height * ratio);
            painter.setTransform(ratio, 0, 0, ratio, 0, 0);
            const recorder = this.recorder;
            canvas.setAttribute('aria-label', `Recording waveform, ${recorder.duration.toFixed(3)} seconds. Selected ${(recorder.trimStartFrame / recorder.sampleRate).toFixed(3)} to ${(recorder.endFrame / recorder.sampleRate).toFixed(3)} seconds. Use Start and End sliders to trim.`);
            const start = recorder.trimStartFrame / recorder.frames * bounds.width;
            const end = recorder.endFrame / recorder.frames * bounds.width;
            painter.fillStyle = '#78e0d024';
            painter.fillRect(start, 0, end - start, bounds.height);
            const { minimum, maximum, stride } = recorder.envelope();
            const gain = recorder.normalized ? recorder.normalizationGain : 1;
            painter.strokeStyle = '#78e0d0';
            painter.beginPath();
            for (let bin = 0; bin < minimum.length; bin += 1) {
                const horizontal = bin * stride / recorder.frames * bounds.width;
                const selected = bin * stride >= recorder.trimStartFrame && bin * stride < recorder.endFrame;
                const scale = selected ? gain : 1;
                painter.moveTo(horizontal, bounds.height * (0.5 - Math.max(-1, Math.min(1, maximum[bin] * scale)) * 0.45));
                painter.lineTo(horizontal, bounds.height * (0.5 - Math.max(-1, Math.min(1, minimum[bin] * scale)) * 0.45));
            }
            painter.stroke();
            painter.fillStyle = '#ffc281';
            for (const horizontal of [start, end]) painter.fillRect(Math.max(0, Math.min(bounds.width - 3, horizontal)), 0, 3, bounds.height);
        }
    }

    let controller;
    function boot() {
        if (controller || !root.document || root.__mygrainSongRenderDeck) return controller;
        const card = root.document.getElementById('performanceVideoLabCard');
        if (!card || !root.MygrainRadiolab?.PCMRecorder || typeof root.mygrainVideolabAdapter?.getContext !== 'function' || typeof root.mygrainVideolabAdapter?.load !== 'function') return null;
        controller = new Controller(card, root.mygrainVideolabAdapter);
        root.mygrainVideolab = Object.freeze({ get state() { return controller.state; }, open: () => controller.open(), close: () => controller.close(), openBrowser: async target => { if (controller.closed) await controller.open(); return controller.run(() => controller.openBrowser(target), true); } });
        root.dispatchEvent(new Event('mygrain-videolab-ready'));
        return controller;
    }

    const exported = { BUILD, MAX_SECONDS, MAX_BYTES, BUILTIN, TARGETS, parseYouTubeURL, captureSettings, capturePhase, apiBase, seedRecorder, Controller, boot };
    if (typeof module !== 'undefined' && module.exports) module.exports = exported;
    root.MygrainVideolab = Object.freeze(exported);
    if (root.document && !root.__mygrainSongRenderDeck) {
        const start = () => {
            if (boot() || !root.document.getElementById('performanceVideoLabCard')) return;
            root.document.getElementById('videolabStatus').textContent = 'Video Lab is waiting for RadioLab and the MYGRAIN adapter. Reopen once they are ready.';
        };
        if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start, { once: true });
        else start();
        root.addEventListener('mygrain-videolab-adapter-ready', start);
    }
})(typeof window !== 'undefined' ? window : globalThis);
