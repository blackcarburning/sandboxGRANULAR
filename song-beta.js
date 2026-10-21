(function (root) {
    'use strict';

    function partDurationSeconds(part) {
        const bpm = Number(part.bpm);
        const steps = Number(part.patternSteps);
        const repeats = Number(part.repeats);
        const cycle = part.patternCycleMultiplier ?? 1;
        const playbackSteps = part.playbackSteps ?? steps * cycle;
        if (!Number.isFinite(bpm) || bpm < 40 || bpm > 300 || !Number.isInteger(steps) || steps < 8 || steps > 64 || !Number.isInteger(repeats) || repeats < 1 || repeats > 64 || ![1, 2, 4, 8].includes(cycle) || !Number.isInteger(playbackSteps) || playbackSteps < 1 || playbackSteps > steps * cycle) {
            throw new Error('Invalid saved part timing.');
        }
        return (60 / bpm) * (playbackSteps / 4) * repeats;
    }

    function sourcePartDurationSeconds(part) {
        return partDurationSeconds({ ...part, playbackSteps: undefined, repeats: 1 });
    }

    function libraryKey(storage, crypto) {
        let key = storage.getItem('mygrain-song-library-key-v1');
        if (!/^[a-f0-9]{64}$/.test(key || '')) {
            key = Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join('');
            storage.setItem('mygrain-song-library-key-v1', key);
        }
        return key;
    }

    function libraryStorage(storage) {
        const values = new Map();
        return {
            persistent: Boolean(storage),
            getItem(key) {
                if (values.has(key)) return values.get(key);
                try { return storage?.getItem(key) ?? null; }
                catch { this.persistent = false; return null; }
            },
            setItem(key, value) {
                values.set(key, String(value));
                try { storage?.setItem(key, String(value)); }
                catch { this.persistent = false; }
            }
        };
    }

    function parseLibraryAccess(value) {
        if (typeof value !== 'string' || value.length > 4096) throw new Error('Choose a MYGRAIN Song Access JSON file (up to 4 KB).');
        let access;
        try { access = JSON.parse(value); }
        catch { throw new Error('This is not a valid MYGRAIN Song Access file.'); }
        if (!access || access.format !== 'mygrain-song-library-access' || access.version !== 1 || typeof access.key !== 'string' || !/^[a-f0-9]{64}$/.test(access.key)) throw new Error('This is not a supported MYGRAIN Song Access file.');
        if (access.songId != null && (typeof access.songId !== 'string' || !/^[A-Za-z0-9_-]{1,100}-[a-f0-9]{8}$/.test(access.songId))) throw new Error('The Song Access file contains an invalid song selection.');
        return { key: access.key, songId: access.songId || '' };
    }

    function armConcurrency(value) {
        const count = Number(value);
        return Number.isInteger(count) && count >= 1 && count <= 10 ? count : 2;
    }

    function contentKey(part) {
        return part.contentSha256 || part.sha256;
    }

    function sourceId(part) {
        return part.sourcePartId || part.id;
    }

    const loopLayers = ['A', 'B', 'C', 'V', 'P', 'O', 'L', 'X', 'Q', 'M', 'M+'];

    function needsPortableFreeze(decoded) {
        return decoded?.snapshot?.extra?.freezeStateVersion === 1 || Boolean(decoded?.snapshot?.state?.sliders?.performanceDrumMachineLevel);
    }

    function needsQRender(decoded) {
        const state = decoded?.snapshot?.state?.q;
        return state?.enabled === true && state.sequence?.some(step => step?.notes?.length && !step.rest);
    }

    function qRenderVersion(decoded) {
        if (!needsQRender(decoded)) return 0;
        const state = decoded.snapshot.state.q;
        if (Number(state.sampleLength ?? 1) < 1 || Number(state.sampleDecay ?? 1) < 1) return 7;
        if (state.performanceVersion === 6 || state.arpPattern === 'custom' || state.sequence?.some(step => step?.accent === true)) return 6;
        return state.instrument === 'strings' ? 5 : Number(state.room) > 0 ? 4 : state.arpEnabled === true ? 3 : 1;
    }

    class Controller {
        constructor(adapter, options = {}) {
            this.adapter = adapter;
            this.document = options.document || root.document;
            let storage = options.storage;
            if (storage === undefined) {
                try { storage = root.localStorage; } catch { storage = null; }
            }
            this.storage = libraryStorage(storage);
            this.crypto = options.crypto || root.crypto;
            this.fetch = options.fetch || root.fetch.bind(root);
            this.api = options.api || `${root.location.origin}/mygrain/api/songs`;
            this.key = libraryKey(this.storage, this.crypto);
            this.song = null;
            this.songs = [];
            this.cache = new Map();
            this.snapshots = new Map();
            this.renders = new Map();
            this.renderSources = new Map();
            this.renderLoads = new Map();
            this.renderBytes = 0;
            this.phonePreparation = /iPhone|iPad|iPod/i.test(root.navigator?.userAgent || '')
                || (root.navigator?.platform === 'MacIntel' && root.navigator?.maxTouchPoints > 1);
            this.renderLimitBytes = options.renderLimitBytes ?? (this.phonePreparation ? 24 : 96) * 1024 * 1024;
            this.renderStore = options.renderStore || new root.MygrainSongStorage.RenderStore();
            this.memoryBudget = new root.MygrainSongStorage.MemoryBudget(options.preparationLimitBytes);
            this.downloadBudget = new root.MygrainSongStorage.MemoryBudget(64 * 1024 * 1024);
            this.armConcurrency = this.phonePreparation ? 1 : armConcurrency(this.storage.getItem('mygrain-song-arm-concurrency-v1'));
            this.playback = null;
            this.editing = null;
            this.loopClipboard = null;
            this.expandedParts = new Set();
            this.audioCache = { buffers: new Map(), bytes: 0 };
            this.armed = false;
            this.playing = false;
            this.loopSong = false;
            this.loopPartId = null;
            this.active = null;
            this.prepared = null;
            this.busy = false;
            this.generation = 0;
            this.timer = null;
            this.abort = null;
            this.card = this.document.getElementById('songBetaCard');
            this.revisionConflict = false;
            this.lockCanWrite = false;
            this.lease = new root.MygrainSongLocks.EditingLease({
                storage: this.storage, crypto: this.crypto, agent: root.navigator?.userAgent || '',
                request: (path, options) => this.request(path, options),
                onChange: () => {
                    const writable = this.canEditSong();
                    if (writable !== this.lockCanWrite) { this.lockCanWrite = writable; this.render(); }
                    else this.renderLockUi();
                }
            });
            const deviceName = this.element('songBetaDeviceName');
            if (deviceName) deviceName.value = this.lease.device.label;
            this.bind();
        }

        element(id) {
            return this.document.getElementById(id);
        }

        preparationConcurrency() {
            return this.phonePreparation ? 1 : armConcurrency(this.armConcurrency);
        }

        status(message, error = false) {
            const status = this.element('songBetaStatus');
            status.textContent = message;
            status.classList.toggle('song-beta-error', error);
        }

        startArmFeedback(generation, parts) {
            let view = this.armFeedbackView;
            const container = this.element('songBetaTransportInfo');
            if (!view && this.document.createElement && container?.append) {
                const panel = this.document.createElement('div');
                panel.className = 'song-beta-arm-feedback';
                panel.setAttribute('role', 'group');
                panel.setAttribute('aria-label', 'Song cache preparation');
                const meter = this.document.createElement('div');
                meter.className = 'song-beta-arm-meter';
                meter.setAttribute('role', 'progressbar');
                meter.setAttribute('aria-label', 'Song cache preparation (indeterminate)');
                const detail = this.document.createElement('p');
                detail.setAttribute('role', 'status');
                detail.setAttribute('aria-live', 'polite');
                const clock = this.document.createElement('p');
                clock.setAttribute('aria-live', 'off');
                panel.append(meter, detail, clock);
                container.append(panel);
                view = this.armFeedbackView = { panel, meter, detail, clock };
            }
            const feedback = this.armFeedback = {
                generation, started: root.performance?.now() ?? Date.now(), state: 'running',
                stage: 'Waiting for audio to be ready', total: parts.length, placements: this.song.parts.length,
                completed: 0, reused: 0, current: new Map(), timer: null, paints: new Set()
            };
            this.element('songBetaArm')?.setAttribute?.('aria-busy', 'true');
            this.paintArmFeedback(feedback);
            const tick = () => {
                if (this.armFeedback !== feedback || feedback.state !== 'running' || generation !== this.generation) return;
                this.paintArmFeedback(feedback, true);
                feedback.timer = root.setTimeout(tick, 1000);
            };
            feedback.timer = root.setTimeout(tick, 1000);
        }

        paintArmFeedback(feedback, heartbeat = false) {
            const view = this.armFeedbackView;
            if (!view || this.armFeedback !== feedback) return;
            if (!heartbeat) {
                view.panel.setAttribute('data-state', feedback.state);
                view.meter.hidden = feedback.state !== 'running';
                view.meter.setAttribute('aria-busy', String(feedback.state === 'running'));
                const current = [...feedback.current.values()].map(entry => `${entry.name}: ${entry.stage}`).join(' · ');
                const detail = `${feedback.stage} · ${feedback.completed}/${feedback.total} unique parts complete (${feedback.reused} reused) · ${feedback.placements} placements${current ? ` · ${current}` : ''}`;
                view.detail.textContent = detail;
                view.meter.setAttribute('aria-valuetext', detail);
            }
            const seconds = Math.floor(((feedback.ended ?? (root.performance?.now() ?? Date.now())) - feedback.started) / 1000);
            view.clock.textContent = `${feedback.state === 'running' ? 'Arming Song Cache' : 'Song Cache'} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} elapsed${feedback.state === 'running' ? ' · Page responsive; completion time unknown. Keep this page open.' : ''}`;
        }

        armStage(generation, stage, part = null) {
            const feedback = this.armFeedback;
            if (!feedback || feedback.state !== 'running' || feedback.generation !== generation || generation !== this.generation) return;
            if (part) feedback.current.set(sourceId(part), { name: part.name, stage });
            else feedback.stage = stage;
            this.paintArmFeedback(feedback);
        }

        async paintBeforeArmWork(generation) {
            const feedback = this.armFeedback;
            if (!root.requestAnimationFrame || !feedback || feedback.generation !== generation || feedback.state !== 'running') return;
            await new Promise(resolve => {
                let frame;
                let fallback;
                const finish = () => {
                    root.cancelAnimationFrame(frame);
                    root.clearTimeout(fallback);
                    feedback.paints.delete(finish);
                    resolve();
                };
                feedback.paints.add(finish);
                frame = root.requestAnimationFrame(() => { frame = root.requestAnimationFrame(finish); });
                fallback = root.setTimeout(finish, 100);
            });
            if (generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
        }

        finishArmFeedback(generation, state, message) {
            const feedback = this.armFeedback;
            if (!feedback || feedback.generation !== generation || feedback.state !== 'running') return;
            feedback.state = state;
            feedback.stage = message;
            feedback.ended = root.performance?.now() ?? Date.now();
            root.clearTimeout(feedback.timer);
            feedback.timer = null;
            for (const finish of [...feedback.paints]) finish();
            feedback.current.clear();
            this.element('songBetaArm')?.setAttribute?.('aria-busy', 'false');
            this.paintArmFeedback(feedback);
        }

        async request(path = '', options = {}) {
            const mutation = options.method === 'POST' && path && !/^\/[^/]+\/lock\//.test(path) && !/\/parts\/[a-f0-9]{32}\/render(?:\?|$)/.test(path);
            if (mutation) this.requireEditing();
            const response = await this.fetch(`${this.api}${path}`, {
                ...options,
                cache: 'no-store',
                headers: { 'X-Mygrain-Song-Key': this.key, ...(mutation ? { ...this.lease.credentials(), 'If-Match': `"${this.song.revision}"` } : {}), ...options.headers }
            });
            if (options.binary && response.ok) return response.arrayBuffer();
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.ok) {
                if (mutation && response.status === 423) this.lease.lost(payload);
                if (mutation && payload.code === 'SONG_REVISION_CONFLICT') this.revisionConflict = true;
                const error = new Error(payload.error || `Song request failed (${response.status}).`);
                Object.assign(error, { code: payload.code, lock: payload.lock });
                throw error;
            }
            return payload;
        }

        canEditSong() {
            return Boolean(this.song && this.lease?.songId === this.song.id && this.lease.canWrite && !this.revisionConflict);
        }

        requireEditing() {
            if (!this.canEditSong()) throw new Error(this.revisionConflict ? 'This song changed on the server. Refresh Songs before saving; your live pattern is still available.' : 'This song is read-only. Use Edit Song first; an expired session must obtain a new lock before saving.');
        }

        async ensureEditing(part) {
            if (!this.song) throw new Error('Create or choose a song first.');
            if (this.revisionConflict) this.requireEditing();
            const songId = this.song.id;
            const revision = this.song.revision;
            const library = this.key;
            if (!this.canEditSong()) {
                this.status('Checking editing access…');
                if (this.lease.token) await this.lease.check();
                if (!this.canEditSong()) {
                    if (this.lease.token) throw Object.assign(new Error(this.lease.message || 'Editing is paused until this device’s connection is verified. Reconnect and try again.'), { code: 'SONG_EDIT_UNVERIFIED' });
                    await this.beginEditing();
                }
            }
            this.requireEditing();
            if (this.key !== library || this.song.id !== songId || this.song.revision !== revision) throw new Error('The song changed while requesting editing. Refresh Songs before trying again; your live pattern is still available.');
            if (part && !this.song.parts.some(entry => entry.id === part.id && entry.sha256 === part.sha256)) throw new Error('The saved part changed. Refresh Songs before editing it.');
        }

        renderLockUi() {
            const status = this.element('songBetaLockStatus');
            if (status) {
                status.textContent = !this.song ? 'Choose a song. One editing session per song; everyone else can still play it.'
                    : this.revisionConflict ? 'Song changed on the server: Refresh Songs before saving. Your live pattern is still available.'
                    : this.lease.message || (this.canEditSong() ? `Editing on ${this.lease.device.label}. Finish Editing releases access for another device.`
                    : this.lease.lock ? `Read-only: being edited on ${this.lease.lock.label}. Last confirmed expiry: ${new Date(this.lease.lock.expiresAt * 1000).toLocaleTimeString()}. Playback is available.`
                    : 'Ready to edit. Changes request editing access automatically. A same-name crashed session can be cleared explicitly; other device names stay protected.');
                status.classList.toggle('song-beta-error', Boolean(this.lease.message || this.revisionConflict));
            }
            const edit = this.element('songBetaEditSong');
            if (edit) edit.disabled = this.busy || !this.song || Boolean(this.lease.token);
            const finish = this.element('songBetaFinishEditing');
            if (finish) finish.disabled = this.busy || !this.lease.token;
            const device = this.element('songBetaDeviceName');
            if (device) device.disabled = this.busy || Boolean(this.lease.token);
            const recover = this.element('songBetaRecoverLock');
            if (recover) {
                recover.hidden = !this.canRecoverLock();
                recover.disabled = this.busy || this.playing || this.revisionConflict;
            }
        }

        canRecoverLock() {
            const label = (this.element('songBetaDeviceName')?.value || this.lease.device.label).trim();
            return Boolean(this.song && !this.canEditSong() && this.lease.lock?.recoveryId
                && label && label.toLowerCase() === this.lease.lock.label.trim().toLowerCase());
        }

        async recoverEditingLock() {
            if (!this.canRecoverLock()) throw new Error('Only a lock with the same device name can be cleared here.');
            const recoveryId = this.lease.lock.recoveryId;
            const label = this.lease.lock.label;
            if (!root.confirm(`Clear the editing lock for ${label} and edit this song here? Use this after a crash. Any other session using that name will lose editing access. Saved song data and your unsaved live pattern stay unchanged.`)) return;
            await this.beginEditing(recoveryId);
        }

        async beginEditing(recoveryId = null) {
            if (!this.song) throw new Error('Choose a song first.');
            if (this.revisionConflict) throw new Error('Refresh Songs before editing the changed song.');
            const label = (this.element('songBetaDeviceName')?.value || this.lease.device.label).trim();
            if (!label || label.length > 100 || /[\x00-\x1f]/.test(label)) throw new Error('Use a device name between 1 and 100 characters.');
            const song = await this.lease.acquire(this.song.id, this.song.revision, label, recoveryId);
            this.lease.device.label = label;
            this.storage.setItem('mygrain-song-device-label-v1', label);
            this.song = song;
            this.songs = this.songs.map(entry => entry.id === song.id ? song : entry);
            this.status(`Editing ${song.name} on ${label}. Finish Editing releases the song for other devices.`);
        }

        async finishEditing() {
            if (this.editing && !root.confirm('Finish editing without saving this amendment? The server part is unchanged and your live pattern will remain available.')) return;
            this.editing = null;
            await this.lease.release();
            this.status('Editing released for other devices. Your next change requests access automatically. Your live pattern and playback are unchanged.');
        }

        cancelAmendment() {
            this.editing = null;
            this.status('Amendment cancelled. The server part is unchanged; the live pattern remains available for New Part.');
            this.render();
        }

        async run(action) {
            if (this.busy) return;
            this.busy = true;
            this.render();
            try {
                await action();
            } catch (error) {
                if (error.name !== 'AbortError') this.status(error.message, true);
            } finally {
                this.busy = false;
                this.render();
            }
        }

        bind() {
            this.element('songBetaEditSong')?.addEventListener('click', () => this.run(() => this.beginEditing()));
            this.element('songBetaRecoverLock')?.addEventListener('click', () => this.run(() => this.recoverEditingLock()));
            this.element('songBetaDeviceName')?.addEventListener('input', () => this.renderLockUi());
            this.element('songBetaFinishEditing')?.addEventListener('click', () => this.run(() => this.finishEditing()));
            this.element('songBetaBackupAccess')?.addEventListener('click', () => this.run(() => this.backupLibraryAccess()));
            this.element('songBetaOpenAccess')?.addEventListener('click', () => this.element('songBetaAccessFile')?.click());
            this.element('songBetaAccessFile')?.addEventListener('change', event => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) this.run(() => this.openLibraryAccess(file));
            });
            for (const id of ['performanceMainStopAllBtn', 'performancePanicBtn', 'resetEngineBtn', 'performanceResetPatchBtn']) {
                this.element(id)?.addEventListener('click', () => { if (this.playing || this.abort) this.stop(); }, true);
            }
            root.addEventListener?.('pagehide', () => {
                if (this.playing || this.abort) this.stop();
                this.lease.release({ keepalive: true });
            });
            root.addEventListener?.('pageshow', () => this.lease.check());
            this.document.addEventListener?.('visibilitychange', () => { if (!this.document.hidden) this.lease.check(); });
            this.element('songBetaNewSong').addEventListener('click', () => this.run(() => this.newSong()));
            this.element('songBetaRenameSong')?.addEventListener('click', () => this.run(() => this.renameSong()));
            this.element('songBetaNewPart').addEventListener('click', () => this.run(() => this.newPart()));
            this.element('songBetaSavePart').addEventListener('click', () => this.run(() => this.savePart()));
            this.element('songBetaCancelEdit').addEventListener('click', () => this.cancelAmendment());
            this.element('songBetaArm').addEventListener('click', () => this.run(() => this.arm()));
            this.element('songBetaArmConcurrency')?.addEventListener('change', event => {
                this.armConcurrency = this.phonePreparation ? 1 : armConcurrency(event.target.value);
                this.storage.setItem('mygrain-song-arm-concurrency-v1', String(this.armConcurrency));
                event.target.value = String(this.armConcurrency);
            });
            this.element('songBetaPlay').addEventListener('click', () => this.run(() => this.playSong()));
            this.element('songBetaLoop')?.addEventListener('click', () => {
                if (this.busy || this.playing || this.editing) return;
                this.loopSong = !this.loopSong;
                this.status(this.loopSong ? 'Loop Song on. Play Song repeats the arrangement until Stop Song.' : 'Loop Song off. Play Song plays the arrangement once.');
                this.render();
            });
            this.element('songBetaExport')?.addEventListener('click', () => this.run(() => this.exportSong()));
            this.element('songBetaStop').addEventListener('click', () => this.stop());
            this.element('songBetaRefresh').addEventListener('click', () => this.run(() => this.refresh()));
            this.element('songBetaSongs').addEventListener('change', event => {
                const id = event.target.value;
                return this.run(async () => {
                    this.cancel(true);
                    this.invalidate();
                    this.editing = null;
                    this.song = id ? (await this.request(`/${encodeURIComponent(id)}`)).song : null;
                    this.revisionConflict = false;
                    await this.lease.watch(this.song?.id);
                    this.storage.setItem('mygrain-song-selected-v1', id);
                    this.status(this.song ? `Loaded ${this.song.name}. Arm Cache before playing the order.` : 'Create or choose a song.');
                });
            });
        }

        cancel(stopAudio = false, stopOptions = {}) {
            this.finishArmFeedback(this.generation, 'cancelled', 'Arming cancelled');
            this.generation += 1;
            this.renderLoads.clear();
            if (this.abort) this.abort.abort();
            this.abort = null;
            if (this.timer !== null) root.clearTimeout(this.timer);
            this.timer = null;
            this.playback?.stop();
            this.playback = null;
            if (stopAudio && (this.playing || this.active)) this.adapter.stop(stopOptions);
            this.playing = false;
            this.loopPartId = null;
            this.active = null;
            this.prepared = null;
        }

        stop() {
            this.cancel();
            this.adapter.stop();
            this.status('Song stopped. Saved parts and armed cache are unchanged.');
            this.render();
        }

        invalidate(preserve = false) {
            this.armed = false;
            if (preserve) {
                const parts = new Map((this.song?.parts || []).map(part => [sourceId(part), part]));
                for (const [id, decoded] of this.cache) {
                    if (!parts.has(id) || (decoded.contentSha256 || decoded.sourceSha256) !== contentKey(parts.get(id))) this.releasePart({ id });
                    else decoded.sourceSha256 = parts.get(id).sha256;
                }
                for (const [id, decoded] of this.snapshots) {
                    if (!parts.has(id) || decoded.contentSha256 !== contentKey(parts.get(id))) this.snapshots.delete(id);
                }
                for (const [id, source] of this.renderSources) {
                    if (!parts.has(id) || source !== contentKey(parts.get(id))) this.renderSources.delete(id);
                }
                for (const id of this.renders.keys()) {
                    if (!parts.has(id) || this.renderSources.get(id) !== contentKey(parts.get(id))) {
                        this.renders.delete(id);
                        this.renderSources.delete(id);
                    }
                }
                const retained = new Set([...this.cache.values()].flatMap(decoded => [...(decoded.buffers?.values() || [])]));
                this.audioCache.buffers = new Map([...this.audioCache.buffers].filter(([, buffer]) => retained.has(buffer)));
                this.audioCache.bytes = [...this.audioCache.buffers.values()].reduce((bytes, buffer) => bytes + buffer.length * buffer.numberOfChannels * 4, 0);
                this.renderBytes = [...this.renders.values()].reduce((bytes, buffer) => bytes + buffer.length * buffer.numberOfChannels * 4, 0);
                return;
            }
            for (const id of [...this.cache.keys()]) this.releasePart({ id });
            this.snapshots.clear();
            this.renders.clear();
            this.renderSources.clear();
            this.renderBytes = 0;
            this.audioCache = { buffers: new Map(), bytes: 0 };
        }

        async refresh() {
            if (this.editing && !root.confirm('Refresh Songs and cancel the unsaved amendment? Your live pattern will remain available.')) return;
            const selected = this.song?.id || this.storage.getItem('mygrain-song-selected-v1');
            const payload = await this.request();
            this.cancel(true);
            this.editing = null;
            this.songs = payload.songs;
            const previous = this.song?.id;
            this.song = this.songs.find(song => song.id === selected) || null;
            this.revisionConflict = false;
            await this.lease.watch(this.song?.id);
            this.invalidate(Boolean(previous && previous === this.song?.id));
            this.status(this.song ? `Loaded ${this.song.name}. ${this.song.parts.length} saved parts.` : 'Create a song, then save named parts.');
        }

        async backupLibraryAccess() {
            if (this.playing || this.editing) throw new Error('Stop the song and finish the amendment before backing up library access.');
            const saved = await this.adapter.downloadLibraryAccess({ format: 'mygrain-song-library-access', version: 1, key: this.key, songId: this.song?.id || null });
            if (saved === false) { this.status('Song Access backup cancelled. No library settings changed.'); return; }
            this.status('Song Access file downloaded. Keep it private: it grants access to all songs in this library. Open it on another device to load the original songs and audio from the server.');
        }

        async openLibraryAccess(file) {
            if (this.playing || this.editing) throw new Error('Stop the song and finish the amendment before opening another library.');
            if (!file || file.size > 4096) throw new Error('Choose a MYGRAIN Song Access JSON file (up to 4 KB).');
            const access = parseLibraryAccess(await file.text());
            if (access.key !== this.key && this.songs.length && !root.confirm('Switch song libraries? Back up this device’s current Song Access first. No server songs will be deleted.')) return;
            const payload = await this.request('', { headers: { 'X-Mygrain-Song-Key': access.key } });
            if (!Array.isArray(payload.songs)) throw new Error('The song server returned an invalid library. Current access is unchanged.');
            this.cancel(true);
            this.invalidate();
            await this.lease.watch(null);
            this.key = access.key;
            this.loopClipboard = null;
            this.storage.setItem('mygrain-song-library-key-v1', this.key);
            this.songs = payload.songs;
            this.song = this.songs.find(song => song.id === access.songId) || this.songs[0] || null;
            this.storage.setItem('mygrain-song-selected-v1', this.song?.id || '');
            this.editing = null;
            this.expandedParts.clear();
            this.revisionConflict = false;
            await this.lease.watch(this.song?.id);
            this.status(`Opened server library: ${this.songs.length} songs. Recall restores editable settings and original audio; Arm Cache loads or prepares server playback. ${this.storage.persistent ? 'Access is remembered on this device.' : 'Browser storage is unavailable; reopen your Song Access file after each reload.'}`);
        }

        acceptSong(song) {
            const preserve = this.song?.id === song.id;
            this.editing = null;
            this.song = song;
            this.songs = [...this.songs.filter(entry => entry.id !== song.id), song];
            this.storage.setItem('mygrain-song-selected-v1', song.id);
            this.invalidate(preserve);
        }

        uniqueParts() {
            const parts = new Map();
            for (const part of this.song?.parts || []) {
                if (!parts.has(sourceId(part))) parts.set(sourceId(part), part);
            }
            return [...parts.values()];
        }

        async reusePart(part) {
            if (this.playing || this.editing) throw new Error('Stop the song and finish the amendment before reusing a part.');
            await this.ensureEditing(part);
            const wasArmed = this.armed;
            this.cancel(true, { hardCut: true });
            const result = await this.request(`/${encodeURIComponent(this.song.id)}/parts/${part.id}/reuse?sha256=${part.sha256}`, { method: 'POST' });
            this.acceptSong(result.song);
            this.armed = wasArmed && this.song.parts.every(entry => this.isPartReady(entry));
            this.status(`Added another use of ${part.name} at the end of the song. Move it with the arrows. Audio and amendments are shared; order and repeat counts are independent. No sounds or renders were copied.`);
        }

        async fullCopyPart(part) {
            if (this.playing || this.editing) throw new Error('Stop the song and finish the amendment before making a full copy.');
            await this.ensureEditing(part);
            const wasArmed = this.armed;
            const sourceReady = this.isPartReady(part);
            this.status(`Making a full independent copy of ${part.name}…`);
            const result = await this.request(`/${encodeURIComponent(this.song.id)}/parts/${part.id}/full-copy?sha256=${part.sha256}`, { method: 'POST' });
            this.acceptSong(result.song);
            const copied = this.song.parts.find(entry => entry.id === result.partId);
            if (copied && sourceReady && copied.sha256 === part.sha256 && copied.render?.sha256 === part.render?.sha256 && this.hasSavedRender(copied)) {
                this.renderSources.set(copied.id, contentKey(copied));
            }
            this.armed = wasArmed && this.song.parts.every(entry => this.isPartReady(entry));
            if (copied) this.expandedParts.add(`${this.song.id}:${copied.id}`);
            this.status(`Added ${copied?.name || 'the full copy'} at the end of the song. It has independent saved sounds and settings: Amend either part without changing the other. Your live pattern is unchanged.`);
        }

        async newSong() {
            const name = this.element('songBetaName').value.trim();
            if (!name) throw new Error('Enter a song name first.');
            const result = await this.request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
            this.cancel(true);
            await this.lease.watch(result.song.id);
            this.acceptSong(result.song);
            this.revisionConflict = false;
            await this.beginEditing();
            this.element('songBetaName').value = '';
            this.status(`Created ${this.song.name} on the server. Set up a pattern and save New Part.`);
        }

        async renameSong() {
            if (!this.song) throw new Error('Create or choose a song first.');
            if (this.playing || this.editing) throw new Error('Stop the song and finish the amendment before renaming.');
            const value = root.prompt('Song name', this.song.name);
            if (value === null) return;
            const name = value.trim();
            if (!name || name.length > 100 || /[\x00-\x1f]/.test(name)) throw new Error('Use a song name between 1 and 100 characters.');
            if (name === this.song.name) return;
            await this.ensureEditing();
            const wasArmed = this.armed;
            const result = await this.request(`/${encodeURIComponent(this.song.id)}/rename`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name })
            });
            this.song = result.song;
            this.songs = this.songs.map(song => song.id === result.song.id ? result.song : song);
            this.invalidate(true);
            this.armed = wasArmed && this.song.parts.length > 0 && this.song.parts.every(part => this.isPartReady(part));
            this.status(`Renamed song to ${name}. Saved parts and unchanged cached audio are retained.`);
        }

        async newPart(options = {}) {
            if (!this.song) throw new Error('Create or choose a song first.');
            const name = String(options.name ?? this.element('songBetaPartName').value).trim();
            const repeats = Number(options.repeats ?? this.element('songBetaRepeats').value);
            if (!name) throw new Error('Enter a part name, such as Intro or Verse 1.');
            if (!Number.isInteger(repeats) || repeats < 1 || repeats > 64) throw new Error('Choose 1–64 pattern repeats.');
            await this.ensureEditing();
            const songId = this.song.id;
            this.status('Capturing complete settings, patterns, and current audio…');
            const blob = options.blob || await this.adapter.capture();
            if (blob.size > 128 * 1024 * 1024) throw new Error('This part exceeds the 128 MB upload limit. Shorten its source audio.');
            if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
            this.status(`Saving ${name} and its sounds to the song folder…`);
            const result = await this.request(`/${encodeURIComponent(songId)}/parts?name=${encodeURIComponent(name)}&repeats=${repeats}`, {
                method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: blob, ...(options.signal ? { signal: options.signal } : {})
            });
            this.acceptSong(result.song);
            if (options.name === undefined) this.element('songBetaPartName').value = '';
            this.active = this.song.parts.at(-1).id;
            this.status(`Saved ${name}, including ${this.song.parts.at(-1).audioAssets} audio assets. Existing parts are unchanged.`);
            return this.song.parts.at(-1);
        }

        async readPart(part, generation = this.generation) {
            if (generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
            this.armStage(generation, 'Waiting for download memory', part);
            const releaseDownload = await this.downloadBudget.acquire(Number(part.bytes) || 128 * 1024 * 1024, this.abort?.signal);
            try {
                if (generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
                this.armStage(generation, 'Downloading saved part', part);
                const body = await this.request(`/${encodeURIComponent(this.song.id)}/parts/${part.id}`, { binary: true, signal: this.abort?.signal });
                this.armStage(generation, 'Checking saved part integrity', part);
                const digest = Array.from(new Uint8Array(await this.crypto.subtle.digest('SHA-256', body)), value => value.toString(16).padStart(2, '0')).join('');
                if (digest !== part.sha256) throw new Error(`Saved audio integrity check failed for ${part.name}.`);
                if (generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
                this.armStage(generation, 'Inspecting saved part', part);
                await this.paintBeforeArmWork(generation);
                const info = this.adapter.inspectPart(body);
                this.snapshots.set(sourceId(part), { snapshot: info.snapshot, contentSha256: contentKey(part), upgradePending: Boolean(info.upgrade) });
                return { body, ...info, releaseDownload };
            } catch (error) { releaseDownload(); throw error; }
        }

        async loadPart(part, generation = this.generation, inspected = null) {
            if (generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
            const existing = this.cache.get(sourceId(part));
            if (existing && (existing.contentSha256 || existing.sourceSha256) === contentKey(part)) return existing;
            const info = inspected || await this.readPart(part, generation);
            const renderSize = sourcePartDurationSeconds(part) * (this.adapter.context?.()?.sampleRate || 48000) * 8;
            let release;
            try {
                this.armStage(generation, 'Waiting for preparation memory', part);
                release = await this.memoryBudget.acquire(info.decodedBytes * 2 + renderSize * 3, this.abort?.signal);
                if (generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
                const sourceCache = { buffers: new Map(), bytes: 0 };
                this.armStage(generation, 'Decoding saved audio', part);
                await this.paintBeforeArmWork(generation);
                const decoded = await this.adapter.decode(info.body, sourceCache);
                if (generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
                decoded.sourceSha256 = part.sha256;
                decoded.contentSha256 = contentKey(part);
                decoded.releaseMemory = release;
                this.cache.set(sourceId(part), decoded);
                this.updateSourceMemory();
                return decoded;
            } catch (error) { release?.(); throw error; }
            finally { info.body = null; info.releaseDownload?.(); }
        }

        updateSourceMemory() {
            const buffers = new Set([...this.cache.values()].flatMap(decoded => [...(decoded.buffers?.values() || [])]));
            this.audioCache = { buffers: new Map([...buffers].map(buffer => [buffer, buffer])), bytes: [...buffers].reduce((bytes, buffer) => bytes + buffer.length * buffer.numberOfChannels * 4, 0) };
        }

        releasePart(part) {
            const decoded = this.cache.get(sourceId(part));
            this.cache.delete(sourceId(part));
            decoded?.releaseMemory?.();
            this.updateSourceMemory();
        }

        isRenderCompatible(part, decoded = this.snapshots.get(sourceId(part)) || this.cache.get(sourceId(part))) {
            const pianoVersion = Number(part.qVersion) >= 2 ? Math.max(3, Number(part.qVersion)) : Number(part.qVersion) || 0;
            if (!decoded) return (!pianoVersion || Number(part.render?.qVersion) >= pianoVersion) && ((this.renderSources.has(sourceId(part)) && this.renderSources.get(sourceId(part)) === contentKey(part))
                || (part.render?.keyboardVersion === 1 && part.render?.grainVersion === 1 && part.render?.portableVersion === 1));
            const keyboard = Boolean(decoded?.snapshot?.extra?.heldNotes?.length);
            const grains = decoded?.snapshot?.state?.modes?.granularLayersEnabled === true;
            const vocalCut = decoded?.snapshot?.state?.modes?.bastardLoopVCut?.enabled === true;
            const vocalRepeat = vocalCut && decoded.snapshot.state.modes.bastardLoopVCut.repeat === true;
            const drumLanes = Object.values(decoded?.snapshot?.state?.modes?.drumMachineExtraTracks || {}).some(track => track?.pattern?.some(Boolean));
            return (!keyboard || part.render?.keyboardVersion === 1) && (!grains || part.render?.grainVersion === 1) && (!vocalCut || part.render?.vocalCutVersion === 1) && (!vocalRepeat || part.render?.vocalRepeatVersion === 1) && (!drumLanes || part.render?.drumLanesVersion === 1) && (!needsPortableFreeze(decoded) || part.render?.portableVersion === 1) && (!qRenderVersion(decoded) || Number(part.render?.qVersion) >= qRenderVersion(decoded));
        }

        isPartReady(part) {
            return this.renderSources.get(sourceId(part)) === contentKey(part) && this.isRenderCompatible(part);
        }

        hasSavedRender(part) {
            const known = this.snapshots.has(sourceId(part)) || this.cache.has(sourceId(part)) || this.renderSources.has(sourceId(part));
            return part.render?.version === 1 && part.render.sourceSha256 === part.sha256 && (!known || this.isRenderCompatible(part));
        }

        async prepareRender(part, decoded, generation) {
            if (generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
            const portable = needsPortableFreeze(decoded);
            const piano = qRenderVersion(decoded);
            const keyboard = Boolean(decoded?.snapshot?.extra?.heldNotes?.length);
            const grains = decoded?.snapshot?.state?.modes?.granularLayersEnabled === true;
            const vocalCut = decoded?.snapshot?.state?.modes?.bastardLoopVCut?.enabled === true;
            const vocalRepeat = vocalCut && decoded.snapshot.state.modes.bastardLoopVCut.repeat === true;
            const drumLanes = Object.values(decoded?.snapshot?.state?.modes?.drumMachineExtraTracks || {}).some(track => track?.pattern?.some(Boolean));
            const compatible = this.isRenderCompatible(part, decoded);
            if (this.renderSources.get(sourceId(part)) === contentKey(part) && compatible) return;
            if (this.renders.has(sourceId(part))) {
                const previous = this.renders.get(sourceId(part));
                this.renderBytes -= previous.length * previous.numberOfChannels * 4;
                this.renders.delete(sourceId(part));
                this.renderSources.delete(sourceId(part));
            }
            let buffer;
            let bytes;
            let rendered = false;
            if (part.render?.version === 1 && part.render.sourceSha256 === part.sha256 && compatible) {
                bytes = await this.readRender(part, this.abort?.signal, generation);
                this.armStage(generation, 'Decoding playback render', part);
                await this.paintBeforeArmWork(generation);
                buffer = await this.adapter.decodeRender(bytes.slice(0));
            } else {
                rendered = true;
                this.status(`Rendering ${part.name} for exact beat playback (${sourcePartDurationSeconds(part).toFixed(1)}s). Keep this page open…`);
                this.armStage(generation, 'Rendering exact beat playback', part);
                await this.paintBeforeArmWork(generation);
                buffer = await this.adapter.renderPart(decoded, part, this.abort?.signal);
                if (generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
                this.armStage(generation, 'Encoding playback render', part);
                await this.paintBeforeArmWork(generation);
                const body = this.adapter.encodeRender(buffer);
                bytes = body;
                this.armStage(generation, 'Saving playback render to server', part);
                const result = await this.request(`/${encodeURIComponent(this.song.id)}/parts/${part.id}/render?sha256=${part.sha256}${keyboard ? '&keyboard=1' : ''}${grains ? '&grain=1' : ''}${vocalCut ? '&vocalcut=1' : ''}${vocalRepeat ? '&vocalrepeat=1' : ''}${drumLanes ? '&drumlanes=1' : ''}${portable ? '&portable=1' : ''}${piano ? `&q=${piano}` : ''}`, {
                    method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body, signal: this.abort?.signal
                });
                if (generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
                const saved = result.song.parts.find(entry => entry.id === part.id && entry.sha256 === part.sha256);
                if (!saved?.render) throw new Error(`The song changed while rendering ${part.name}. Refresh Songs and arm again.`);
                if (keyboard && saved.render.keyboardVersion !== 1) throw new Error('The song server needs keyboard-render support. Reload MYGRAIN and arm again.');
                if (grains && saved.render.grainVersion !== 1) throw new Error('The song server needs grain-fade render support. Reload MYGRAIN and arm again.');
                if (vocalCut && saved.render.vocalCutVersion !== 1) throw new Error('The song server needs vocal-cut render support. Reload MYGRAIN and arm again.');
                if (vocalRepeat && saved.render.vocalRepeatVersion !== 1) throw new Error('The song server needs vocal section-repeat render support. Reload MYGRAIN and arm again.');
                if (drumLanes && saved.render.drumLanesVersion !== 1) throw new Error('The song server needs Clap/Cymbals render support. Reload MYGRAIN and arm again.');
                if (portable && saved.render.portableVersion !== 1) throw new Error('The song server needs portable-freeze support. Reload MYGRAIN and arm again.');
                if (piano && !(Number(saved.render.qVersion) >= piano)) throw new Error(`The song server needs Q ${piano >= 7 ? 'sample length / decay' : piano >= 6 ? 'accent / custom arpeggiator' : piano >= 5 ? 'strings' : piano >= 4 ? 'piano effects' : piano >= 2 ? 'piano arpeggiator' : 'piano'} render support. Reload MYGRAIN and arm again.`);
                this.song = { ...this.song, parts: this.song.parts.map(entry => sourceId(entry) === sourceId(part) ? { ...entry, render: saved.render } : entry) };
                this.songs = this.songs.map(song => song.id === this.song.id ? this.song : song);
                this.armStage(generation, 'Decoding saved playback render', part);
                await this.paintBeforeArmWork(generation);
                buffer = await this.adapter.decodeRender(body.slice(0));
            }
            if (generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
            const saved = this.song.parts.find(entry => entry.id === part.id);
            if (rendered) {
                this.armStage(generation, 'Saving playback render in browser storage', part);
                await this.renderStore.put(this.renderKey(saved), bytes);
            }
            if (generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
            this.retainRender(part, buffer);
            this.renderSources.set(sourceId(part), contentKey(part));
        }

        renderKey(part) {
            return `${this.key}:${this.song.id}:${sourceId(part)}:${contentKey(part)}:${part.render.sha256}`;
        }

        async readRender(part, signal, generation = this.generation) {
            const key = this.renderKey(part);
            this.armStage(generation, 'Reading browser render cache', part);
            let bytes = await this.renderStore.get(key);
            const digest = async body => Array.from(new Uint8Array(await this.crypto.subtle.digest('SHA-256', body)), value => value.toString(16).padStart(2, '0')).join('');
            if (bytes && await digest(bytes) !== part.render.sha256) { await this.renderStore.delete(key); bytes = null; }
            if (!bytes) {
                if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
                this.armStage(generation, 'Downloading playback render', part);
                bytes = await this.request(`/${encodeURIComponent(this.song.id)}/parts/${part.id}/render`, { binary: true, signal });
                this.armStage(generation, 'Checking playback render integrity', part);
                if (await digest(bytes) !== part.render.sha256) throw new Error(`Song render integrity check failed for ${part.name}.`);
                if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
                this.armStage(generation, 'Saving playback render in browser storage', part);
                await this.renderStore.put(key, bytes);
            }
            if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
            return bytes;
        }

        retainRender(part, buffer) {
            const expected = sourcePartDurationSeconds(part);
            if (Math.abs(buffer.duration - expected) > 2 / buffer.sampleRate) throw new Error(`Prepared audio has the wrong pattern length for ${part.name}.`);
            const size = buffer.length * buffer.numberOfChannels * 4;
            if (this.renders.has(sourceId(part))) {
                const previous = this.renders.get(sourceId(part));
                this.renderBytes -= previous.length * previous.numberOfChannels * 4;
                this.renders.delete(sourceId(part));
            }
            while (this.renders.size && this.renderBytes + size > this.renderLimitBytes) {
                const [id, previous] = this.renders.entries().next().value;
                this.renderBytes -= previous.length * previous.numberOfChannels * 4;
                this.renders.delete(id);
            }
            this.renderBytes += size;
            this.renders.set(sourceId(part), buffer);
        }

        async loadRender(part, signal, generation = this.generation) {
            if (signal?.aborted || generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
            if (!this.isPartReady(part)) throw new Error(`Arm Cache again: ${part.name} has changed audio.`);
            const id = sourceId(part);
            if (this.renders.has(id)) return this.renders.get(id);
            if (this.renderLoads.has(id)) return this.renderLoads.get(id);
            const load = (async () => {
                const bytes = await this.readRender(part, signal);
                const buffer = await this.adapter.decodeRender(bytes);
                if (signal?.aborted || generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
                this.retainRender(part, buffer);
                return buffer;
            })();
            this.renderLoads.set(id, load);
            try { return await load; }
            finally { if (this.renderLoads.get(id) === load) this.renderLoads.delete(id); }
        }

        assertUpgradeCurrent(generation, expected, committed = false) {
            const sameSong = this.key === expected.library && this.song?.id === expected.songId;
            const sources = sameSong ? this.song.parts.filter(entry => sourceId(entry) === expected.sourceId) : [];
            if (generation !== this.generation || !sameSong || this.song.revision !== expected.revision
                || !sources.some(entry => entry.id === expected.partId) || sources.some(entry => entry.sha256 !== expected.sha256)) {
                if (committed && sameSong) this.revisionConflict = true;
                throw new DOMException('Song upgrade response is stale. Refresh Songs to reconcile any committed save.', 'AbortError');
            }
        }

        async upgradeSongParts(generation) {
            let pending = 0;
            let writable = !this.editing;
            for (const part of this.uniqueParts()) {
                if (generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
                const known = this.snapshots.get(sourceId(part));
                if (known && !known.upgradePending) continue;
                let info;
                let releaseRender;
                try {
                    this.armStage(generation, 'Checking saved-part compatibility', part);
                    info = await this.readPart(part, generation);
                    if (!info.upgrade) continue;
                    if (writable) {
                        this.armStage(generation, 'Checking editing access for upgrade', part);
                        try { await this.ensureEditing(part); }
                        catch (error) {
                            if (!['SONG_LOCKED', 'SONG_LOCK_REQUIRED', 'SONG_LOCK_LOST', 'SONG_EDIT_UNVERIFIED'].includes(error.code)) throw error;
                            writable = false;
                        }
                    }
                    if (!writable) { pending += 1; continue; }
                    if (generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
                    const songId = this.song.id;
                    const library = this.key;
                    const expected = { songId, library, revision: this.song.revision, sourceRevision: part.revision || 1, sourceId: sourceId(part), partId: part.id, sha256: part.sha256 };
                    this.armStage(generation, 'Upgrading saved-part snapshot', part);
                    await this.paintBeforeArmWork(generation);
                    const body = await this.adapter.upgradePart(info);
                    if (body.size > 128 * 1024 * 1024) throw new Error('The upgraded part exceeds the 128 MB upload limit. No saved part was changed.');
                    const digest = Array.from(new Uint8Array(await this.crypto.subtle.digest('SHA-256', await body.arrayBuffer())), value => value.toString(16).padStart(2, '0')).join('');
                    let renderBytes;
                    if (part.render?.version === 1 && part.render.sourceSha256 === part.sha256 && this.isRenderCompatible(part, info)) {
                        releaseRender = await this.memoryBudget.acquire(Number(part.render.bytes) || sourcePartDurationSeconds(part) * 48000 * 8, this.abort?.signal);
                        renderBytes = await this.readRender(part, this.abort?.signal, generation);
                    }
                    this.assertUpgradeCurrent(generation, expected);
                    if (!this.canEditSong()) { writable = false; pending += 1; continue; }
                    this.status(`Upgrading ${part.name}: adding empty, muted ${info.upgrade.lanes.join(', ')} lanes to its saved snapshot…`);
                    let result;
                    try {
                        this.armStage(generation, 'Saving upgraded part to server', part);
                        result = await this.request(`/${encodeURIComponent(songId)}/parts/${part.id}/save?sha256=${part.sha256}`, {
                            method: 'POST', headers: { 'Content-Type': 'application/zip' }, body
                        });
                    } catch (error) {
                        if (!['SONG_LOCKED', 'SONG_LOCK_REQUIRED', 'SONG_LOCK_LOST', 'SONG_EDIT_UNVERIFIED'].includes(error.code)) throw error;
                        writable = false;
                        pending += 1;
                        continue;
                    }
                    this.assertUpgradeCurrent(generation, expected, true);
                    const saved = result.song?.parts?.find(entry => entry.id === part.id && sourceId(entry) === expected.sourceId && entry.sha256 === digest);
                    if (result.song?.id !== songId || result.song.revision !== expected.revision + 1 || !saved || saved.revision !== expected.sourceRevision + 1
                        || result.song.parts.some(entry => sourceId(entry) === expected.sourceId && entry.sha256 !== digest)) {
                        this.revisionConflict = true;
                        throw new Error('Unexpected saved-song upgrade revision or audio hash. Refresh Songs to reconcile the committed save.');
                    }
                    this.song = result.song;
                    this.songs = this.songs.map(song => song.id === songId ? this.song : song);
                    this.invalidate(true);
                    this.snapshots.set(sourceId(saved), { snapshot: info.snapshot, contentSha256: contentKey(saved), upgradePending: false });
                    if (generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
                    if (renderBytes && !this.hasSavedRender(saved)) {
                        const renderExpected = { ...expected, revision: this.song.revision, sha256: digest };
                        const flags = [['keyboard', 'keyboardVersion'], ['grain', 'grainVersion'], ['vocalcut', 'vocalCutVersion'],
                            ['vocalrepeat', 'vocalRepeatVersion'], ['drumlanes', 'drumLanesVersion'], ['portable', 'portableVersion'], ['q', 'qVersion']]
                            .filter(([, field]) => part.render[field]).map(([flag, field]) => `&${flag}=${part.render[field]}`).join('');
                        this.armStage(generation, 'Saving retained playback render', part);
                        result = await this.request(`/${encodeURIComponent(songId)}/parts/${saved.id}/render?sha256=${saved.sha256}${flags}`, {
                            method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: renderBytes, signal: this.abort?.signal
                        });
                        this.assertUpgradeCurrent(generation, renderExpected, true);
                        const rendered = result.song?.parts?.find(entry => entry.id === saved.id && entry.sha256 === saved.sha256);
                        if (result.song?.id !== songId || result.song.revision !== renderExpected.revision || sourceId(rendered || {}) !== expected.sourceId || rendered?.revision !== saved.revision
                            || rendered?.render?.sourceSha256 !== digest || rendered?.render?.sha256 !== part.render.sha256) {
                            this.revisionConflict = true;
                            throw new Error('The song changed while retaining its render. Refresh Songs and arm again.');
                        }
                        this.song = { ...this.song, parts: this.song.parts.map(entry => sourceId(entry) === sourceId(saved) ? { ...entry, render: rendered.render } : entry) };
                        this.songs = this.songs.map(song => song.id === songId ? this.song : song);
                    }
                } finally {
                    if (info) info.body = null;
                    info?.releaseDownload?.();
                    releaseRender?.();
                    if (this.armFeedback?.generation === generation && this.armFeedback.state === 'running') this.armFeedback.current.delete(sourceId(part));
                }
            }
            return pending;
        }

        async arm() {
            if (!this.song?.parts.length) throw new Error('Save at least one part first.');
            this.cancel(true);
            this.invalidate(true);
            for (const id of [...this.cache.keys()]) this.releasePart({ id });
            const generation = this.generation;
            const abort = this.abort = new AbortController();
            let uniqueParts = this.uniqueParts();
            this.render();
            this.status('Arming cache: waiting for audio to be ready…');
            this.startArmFeedback(generation, uniqueParts);
            let next = 0;
            let completed = 0;
            let workers = [];
            try {
                if (root.requestAnimationFrame) await this.paintBeforeArmWork(generation);
                if (generation !== this.generation) return;
                await this.adapter.ready();
                if (generation !== this.generation) return;
                this.song.parts.forEach(partDurationSeconds);
                this.armStage(generation, 'Checking saved-part compatibility');
                const pendingUpgrades = this.adapter.upgradePart ? await this.upgradeSongParts(generation) : 0;
                if (generation !== this.generation) return;
                uniqueParts = this.uniqueParts();
                const parts = uniqueParts.filter(part => !this.isPartReady(part));
                const reused = uniqueParts.length - parts.length;
                this.armFeedback.completed = reused;
                this.armFeedback.reused = reused;
                this.armStage(generation, 'Preparing playback cache');
                const preparationConcurrency = this.preparationConcurrency();
                workers = Array.from({ length: Math.min(preparationConcurrency, parts.length) }, async () => {
                    while (next < parts.length) {
                        if (generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
                        const part = parts[next++];
                        this.armStage(generation, 'Preparing part', part);
                        this.status(`Arming ${completed}/${parts.length} pending (${preparationConcurrency === 1 ? 'one part at a time' : `up to ${preparationConcurrency} memory-aware workers`}; ${reused} reused): ${part.name}…`);
                        let decoded;
                        let info;
                        let releaseRender;
                        try {
                            info = this.snapshots.get(sourceId(part));
                            if (!info && (!this.isRenderCompatible(part) || (Number(part.qVersion) > 0 && Number(part.render?.qVersion) < 6))) info = await this.readPart(part, generation);
                            if (this.hasSavedRender(part)) {
                                const renderSize = sourcePartDurationSeconds(part) * (this.adapter.context?.()?.sampleRate || 48000) * 8;
                                this.armStage(generation, 'Waiting for playback memory', part);
                                releaseRender = await this.memoryBudget.acquire(renderSize * 3, abort.signal);
                                await this.prepareRender(part, info || {}, generation);
                            } else {
                                decoded = await this.loadPart(part, generation, info?.body ? info : null);
                                await this.prepareRender(part, decoded, generation);
                            }
                        } finally {
                            decoded = null;
                            if (info) info.body = null;
                            info?.releaseDownload?.();
                            releaseRender?.();
                            this.releasePart(part);
                        }
                        if (generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
                        completed += 1;
                        this.armFeedback.completed = reused + completed;
                        this.armFeedback.current.delete(sourceId(part));
                        this.armStage(generation, 'Preparing playback cache');
                        this.renderCacheSummary();
                        this.status(`Arming ${completed}/${parts.length} pending complete; ${reused} unchanged parts reused. Keep this page open.`);
                    }
                });
                await Promise.all(workers);
                if (generation !== this.generation) return;
                if (this.song.parts.some(part => !this.isPartReady(part))) {
                    throw new Error('The song changed while arming. Refresh Songs and arm its current parts again.');
                }
                this.armed = true;
                this.finishArmFeedback(generation, 'success', 'Song cache armed');
                this.status(`Armed ${this.song.parts.length} parts (${Math.round(this.renderBytes / 1048576)} MB playback memory): ${parts.length} prepared, ${reused} unchanged reused. Original samples stay on the server; renders use browser storage and bounded playback memory. ${this.renderStore.warning}${pendingUpgrades ? ` Saved-song compatibility upgrade pending for ${pendingUpgrades} shared parts: read-only playback uses empty, muted defaults. Finish the amendment or obtain Edit Song access, then Arm Cache to persist the upgrade.` : ''}`);
            } catch (error) {
                const failed = generation === this.generation;
                if (failed) {
                    this.finishArmFeedback(generation, error.name === 'AbortError' ? 'cancelled' : 'failure', error.name === 'AbortError' ? 'Arming cancelled' : `Arming failed: ${error.message}`);
                    this.cancel();
                }
                await Promise.allSettled(workers);
                if (failed) {
                    for (const part of uniqueParts) {
                        if (!this.isPartReady(part)) this.cache.delete(sourceId(part));
                    }
                    this.invalidate(true);
                }
                if (!failed || this.generation !== generation + 1) throw new DOMException('Cancelled', 'AbortError');
                throw error;
            } finally {
                if (this.abort === abort) this.abort = null;
            }
        }

        async recall(part, options = {}) {
            this.cancel(true);
            const generation = this.generation;
            this.abort = new AbortController();
            this.status(`Loading ${part.name}…`);
            await this.adapter.ready();
            if (generation !== this.generation) return;
            for (const id of [...this.cache.keys()]) if (id !== sourceId(part)) this.releasePart({ id });
            const decoded = await this.loadPart(part, generation);
            if (generation !== this.generation) return;
            this.adapter.recall(decoded, { start: options.start !== false });
            decoded.releaseMemory?.();
            this.active = part.id;
            this.editing = options.amend ? { id: part.id, sha256: part.sha256, songId: this.song.id } : null;
            this.element('songBetaPartName').value = part.name;
            this.element('songBetaRepeats').value = part.repeats;
            this.status(options.amend ? `Amending ${part.name}. Edit the live pattern/settings/sounds, then Save Amendment to commit to every use of this part. The server copy is unchanged until saved.` : options.start === false ? `${part.name} loaded for editing. New Part saves a separate copy; Amend + Save Amendment updates every use of the existing part.` : `${part.name} recalled and playing live. It loops until stopped or another part is chosen.`);
        }

        copyLoop(part, layer) {
            if (this.playing || this.editing) throw new Error('Stop the song and finish the amendment before copying a saved loop.');
            if (!loopLayers.includes(layer) || !this.song?.parts.some(entry => entry.id === part.id && entry.sha256 === part.sha256)) throw new Error('Choose a current saved part and Bastardloop.');
            this.loopClipboard = {
                sourceSongId: this.song.id, sourcePartId: sourceId(part), sourceSha256: part.sha256,
                layer, name: part.name, library: this.key
            };
            this.status(`Copied Bastardloop ${layer} from ${part.name}. Use Paste Part on the destination. Nothing has changed yet.`);
        }

        openLoopCopyPicker(part, opener) {
            if (this.busy || this.playing || this.editing || !this.song || this.document.querySelector('.song-beta-copy-dialog')) return;
            const dialog = this.document.createElement('dialog');
            dialog.className = 'song-beta-copy-dialog';
            dialog.setAttribute('aria-labelledby', 'songBetaCopyTitle');
            dialog.setAttribute('aria-describedby', 'songBetaCopyHelp');
            const heading = this.document.createElement('h3');
            heading.id = 'songBetaCopyTitle';
            heading.textContent = `Copy from ${part.name}`;
            const help = this.document.createElement('p');
            help.id = 'songBetaCopyHelp';
            help.textContent = '1. Choose a Bastardloop below. 2. Open the destination part and press Paste Part. Only that Bastardloop is replaced, not the whole Song part. The copy comes from the saved part, not unsaved live edits.';
            const buttons = this.document.createElement('div');
            buttons.className = 'song-beta-copy-layers';
            for (const layer of loopLayers) {
                const button = this.document.createElement('button');
                button.type = 'button';
                button.className = 'performance-btn';
                button.textContent = `Bastardloop ${layer}`;
                button.dataset.layer = layer;
                button.addEventListener('click', () => {
                    dialog.close();
                    this.run(() => this.copyLoop(part, layer));
                });
                buttons.append(button);
            }
            const cancel = this.document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'performance-btn';
            cancel.textContent = 'Cancel';
            cancel.addEventListener('click', () => dialog.close());
            dialog.append(heading, help, buttons, cancel);
            dialog.addEventListener('keydown', event => event.stopPropagation());
            dialog.addEventListener('keyup', event => event.stopPropagation());
            dialog.addEventListener('close', () => {
                dialog.remove();
                if (opener?.isConnected) opener.focus();
            }, { once: true });
            this.document.body.append(dialog);
            dialog.showModal();
        }

        async pasteLoop(part) {
            if (this.revisionConflict) this.requireEditing();
            if (this.playing || this.editing) throw new Error('Stop the song and finish the amendment before pasting a loop.');
            this.adapter.assertNotRecording?.();
            const copied = this.loopClipboard;
            if (!copied || copied.library !== this.key) throw new Error('Use Copy From Part and choose a Bastardloop first.');
            if (!this.song?.parts.some(entry => entry.id === part.id && entry.sha256 === part.sha256)) throw new Error('Refresh Songs before pasting into a changed part.');
            const uses = this.song.parts.filter(entry => sourceId(entry) === sourceId(part)).length;
            if (!root.confirm(`Replace Bastardloop ${copied.layer} in ${part.name} completely with the saved copy from ${copied.name}?${uses > 1 ? ` This shared part is used ${uses} times; every use changes.` : ''} Other loops, tempo, pattern length and repeats stay unchanged.${!this.canEditSong() ? ' Editing access will be requested automatically; another device’s lock cannot be overridden.' : ''}`)) return;
            await this.ensureEditing();
            this.adapter.assertNotRecording?.();
            if (!this.song?.parts.some(entry => entry.id === part.id && entry.sha256 === part.sha256)) throw new Error('The destination changed while requesting editing. Refresh Songs before pasting.');
            const wasArmed = this.armed;
            this.status(`Pasting Bastardloop ${copied.layer} into ${part.name} on the server…`);
            const result = await this.request(`/${encodeURIComponent(this.song.id)}/parts/${part.id}/paste-loop?sha256=${part.sha256}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sourceSongId: copied.sourceSongId, sourcePartId: copied.sourcePartId, sourceSha256: copied.sourceSha256, layer: copied.layer })
            });
            this.cancel(true, { hardCut: true });
            this.acceptSong(result.song);
            const message = `Pasted Bastardloop ${copied.layer} from ${copied.name} into every use of ${part.name}. Other loops and arrangement settings are unchanged.`;
            if (wasArmed) {
                try {
                    await this.arm();
                    this.status(`${message} Cache re-armed; unchanged audio was reused. Amend loads the pasted part for editing.`);
                } catch (error) {
                    this.status(`${message} Paste is saved, but cache preparation did not finish: ${error.message}. Use Arm Cache again.`, true);
                }
            } else this.status(`${message} Use Arm Cache before song playback. Your live pattern was not replaced; Amend loads the pasted part for editing.`);
        }

        async savePart() {
            if (!this.editing || this.editing.songId !== this.song?.id) throw new Error('Choose Amend on a saved part first.');
            const draft = { ...this.editing };
            const name = this.element('songBetaPartName').value.trim();
            const repeats = Number(this.element('songBetaRepeats').value);
            if (!name || !Number.isInteger(repeats) || repeats < 1 || repeats > 64) throw new Error('Enter a part name and 1–64 pattern repeats.');
            await this.ensureEditing(draft);
            this.cancel(true, { hardCut: true });
            this.status('Capturing the amended full pattern and sounds…');
            const body = await this.adapter.capture();
            if (body.size > 128 * 1024 * 1024) throw new Error('This part exceeds the 128 MB upload limit.');
            const result = await this.request(`/${encodeURIComponent(draft.songId)}/parts/${draft.id}/save?sha256=${draft.sha256}&name=${encodeURIComponent(name)}&repeats=${repeats}`, {
                method: 'POST', headers: { 'Content-Type': 'application/zip' }, body
            });
            this.acceptSong(result.song);
            this.active = draft.id;
            const saved = this.song.parts.find(part => part.id === draft.id);
            this.status(`Saved amendment to every use of ${name}. Its previous revision is retained on the server. ${this.hasSavedRender(saved) ? 'Audio is unchanged; its saved render is retained.' : 'Only this shared part needs a new render.'} Arm Cache to prepare pending parts.`);
        }

        async amendPart(part) {
            if (this.playing || this.editing) throw new Error('Stop Song and save or cancel the current amendment before amending another part.');
            this.adapter.assertNotRecording?.();
            await this.ensureEditing(part);
            this.adapter.assertNotRecording?.();
            this.expandedParts.add(`${this.song.id}:${part.id}`);
            if (this.active !== part.id) return this.recall(part, { start: false, amend: true });
            this.cancel(true, { hardCut: true });
            this.active = part.id;
            this.editing = { id: part.id, sha256: part.sha256, songId: this.song.id };
            if (!this.element('songBetaPartName').value.trim()) this.element('songBetaPartName').value = part.name;
            this.status(`Amending the currently loaded ${part.name}. Your live edits are kept; Save Amendment commits them to every use of this part.`);
        }

        async deletePart(part) {
            if (!root.confirm(`Remove this occurrence of ${part.name} from the song? Other uses are unchanged. Its saved files remain in the server recovery history.`)) return;
            await this.ensureEditing(part);
            this.cancel(true, { hardCut: true });
            const result = await this.request(`/${encodeURIComponent(this.song.id)}/parts/${part.id}/delete?sha256=${part.sha256}`, { method: 'POST' });
            this.acceptSong(result.song);
            this.status(`Removed this occurrence of ${part.name}. Other uses and server recovery files are retained.`);
        }

        async exportSong() {
            if (!this.song?.parts.length) throw new Error('Save at least one part before exporting.');
            if (this.playing || this.editing) throw new Error('Stop the song and finish the amendment before exporting.');
            const promptGeneration = this.generation;
            const filename = await this.adapter.chooseSongExportFilename(this.song);
            if (promptGeneration !== this.generation) throw new DOMException('Cancelled', 'AbortError');
            if (!filename) { this.status('Song WAV export cancelled.'); return; }
            if (!this.armed) await this.arm();
            if (!this.armed) throw new DOMException('Cancelled', 'AbortError');
            const generation = this.generation;
            const abort = this.abort = new AbortController();
            try {
                this.status(`Building ${filename} from the complete arrangement…`);
                const renders = this.song.parts.every(part => this.renders.has(sourceId(part))) ? this.renders : part => this.loadRender(part, abort.signal, generation);
                const result = await this.adapter.exportSong(this.song.parts, renders, filename, abort.signal);
                if (generation !== this.generation) return;
                this.status(`Saved ${result.savedName || filename} to the rendered WAV folder.${result.peak >= .999 ? ' Audio reaches full scale; check the saved part levels if you hear distortion.' : ''}`);
            } finally {
                if (this.abort === abort) this.abort = null;
            }
        }

        async playSongFromHere(partId) {
            if (this.editing) throw new Error('Finish or cancel the amendment before playing the song.');
            const part = this.song?.parts.find(part => part.id === partId);
            if (!part) throw new Error('That part is no longer in this song. Choose a current part.');
            if (!this.armed) {
                if (!root.confirm(`Arm Cache?\n\nThe song cache is not armed. Prepare it now, then play from ${part.name}?`)) return;
                await this.arm();
                if (!this.armed) return;
            }
            await this.playSong(partId);
        }

        async loopPart(partId) {
            if (this.playing && this.loopPartId === partId) { this.stop(); return; }
            if (this.editing) throw new Error('Finish or cancel the amendment before looping a part.');
            const part = this.song?.parts.find(part => part.id === partId);
            if (!part) throw new Error('That part is no longer in this song. Choose a current part.');
            if (!this.armed) {
                if (!root.confirm(`Arm Cache?\n\nPrepare the song cache, then loop ${part.name} until Stop Song?`)) return;
                await this.arm();
                if (!this.armed) return;
            }
            await this.playSong(partId, { loopPart: true });
        }

        async playSong(startPartId = null, options = {}) {
            if (!this.armed || !this.song?.parts.length) throw new Error('Arm Cache successfully before playing the song.');
            if (this.editing) throw new Error('Finish or cancel the amendment before playing the song.');
            const startIndex = startPartId === null ? 0 : this.song.parts.findIndex(part => part.id === startPartId);
            if (startIndex < 0) throw new Error('That part is no longer in this song. Choose a current part.');
            const looping = options.loopPart === true || this.loopSong;
            const parts = options.loopPart ? [this.song.parts[startIndex]] : looping ? this.song.parts : this.song.parts.slice(startIndex);
            this.cancel(true);
            const generation = this.generation;
            await this.adapter.ready();
            if (generation !== this.generation) return;
            this.adapter.stop({ hardCut: true });
            this.playing = true;
            this.loopPartId = options.loopPart ? startPartId : null;
            try {
                const ended = reason => {
                    if (generation !== this.generation) return;
                    this.cancel(true, { hardCut: true });
                    const finishedMessage = startIndex ? `Song finished. Played from ${parts[0].name} through the last part.` : 'Song finished. All parts played in order.';
                    this.status(reason === 'interrupted' ? 'Song stopped because its audio context was interrupted. Resume MYGRAIN before playing again.' : reason === 'finished' ? finishedMessage : `Song stopped: ${reason}`, !['finished', 'interrupted'].includes(reason));
                    this.render();
                };
                if (!looping && parts.every(part => this.renders.has(sourceId(part)))) {
                    this.playback = this.adapter.scheduleSong(parts, this.renders, ended);
                } else {
                    const abort = this.abort = new AbortController();
                    this.status(`Loading song audio from ${this.song.parts[startIndex].name}…`);
                    const load = part => this.renders.get(sourceId(part)) || this.loadRender(part, abort.signal, generation);
                    const playback = await this.adapter.scheduleStoredSong(parts, load, ended, abort.signal, undefined, { loop: looping, startIndex: options.loopPart ? 0 : startIndex });
                    if (generation !== this.generation) { playback.stop(); return; }
                    this.playback = playback;
                }
                const tick = () => {
                    if (generation !== this.generation) return;
                    if (!this.adapter.clockRunning(this.playback)) {
                        this.cancel(true);
                        this.status('Song stopped because its audio clock was suspended.');
                        this.render();
                        return;
                    }
                    const entry = this.playback.entries.find(entry => this.adapter.time() < entry.end) || this.playback.entries.at(-1);
                    if (entry.id !== this.active) {
                        this.active = entry.id;
                        const mode = this.loopPartId ? 'Looping part' : looping ? 'Looping song' : 'Playing';
                        this.status(`${mode} ${this.song.parts.findIndex(part => part.id === entry.id) + 1}/${this.song.parts.length}: ${this.song.parts.find(part => part.id === entry.id).name} · audio-clock scheduled.`);
                        this.render();
                    }
                    this.timer = root.setTimeout(tick, 25);
                };
                tick();
            } catch (error) {
                this.cancel(true);
                this.status(error.message, true);
                this.render();
            }
        }

        async setRepeats(part, value) {
            if (this.playing || this.editing) throw new Error('Stop playback and finish the amendment before changing repeats.');
            const repeats = Number(value);
            if (!Number.isInteger(repeats) || repeats < 1 || repeats > 64) throw new Error('Choose 1–64 whole-pattern repeats.');
            if (repeats === part.repeats) return;
            const parts = this.song.parts.map(entry => ({ id: entry.id, name: entry.name, playbackSteps: entry.playbackSteps, repeats: entry.id === part.id ? repeats : entry.repeats }));
            await this.saveArrangement(parts);
            if (this.active === part.id) this.element('songBetaRepeats').value = repeats;
        }

        async setSteps(part, value) {
            if (this.playing || this.editing) throw new Error('Stop playback and finish the amendment before changing steps.');
            const steps = Number(value);
            const fullSteps = part.patternSteps * (part.patternCycleMultiplier ?? 1);
            if (!Number.isInteger(steps) || steps < 1 || steps > fullSteps) throw new Error(`Choose 1–${fullSteps} steps. The complete saved pattern is retained.`);
            if (steps === (part.playbackSteps ?? fullSteps)) return;
            const parts = this.song.parts.map(entry => ({ id: entry.id, name: entry.name, repeats: entry.repeats, playbackSteps: entry.id === part.id ? steps : entry.playbackSteps }));
            await this.saveArrangement(parts);
            this.status(`Saved ${steps} of ${fullSteps} steps for this occurrence of ${part.name}. The full pattern is unchanged; increase Steps to restore it. Arm Cache before playback; existing audio is reused.`);
        }

        async setColour(part, value) {
            if (value !== null && !/^#[a-f0-9]{6}$/i.test(value)) throw new Error('Choose a six-digit hex colour or clear the colour.');
            const colour = value === null ? null : value.toLowerCase();
            if (colour === (part.colour || null)) return;
            await this.ensureEditing(part);
            const result = await this.request(`/${encodeURIComponent(this.song.id)}/parts/${part.id}/colour?sha256=${part.sha256}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ colour })
            });
            this.song = result.song;
            this.songs = this.songs.map(song => song.id === result.song.id ? result.song : song);
            this.status(colour ? `Colour saved for ${part.name}. Playback and the armed cache are unchanged.` : `Colour cleared for ${part.name}.`);
        }

        async arrange(part, direction = 0) {
            if (this.playing) throw new Error('Stop the song before changing its arrangement.');
            const parts = this.song.parts.map(entry => ({ id: entry.id, name: entry.name, repeats: entry.repeats, playbackSteps: entry.playbackSteps }));
            const index = parts.findIndex(entry => entry.id === part.id);
            if (direction) {
                const destination = index + direction;
                if (destination < 0 || destination >= parts.length) return;
                [parts[index], parts[destination]] = [parts[destination], parts[index]];
            } else {
                const name = root.prompt('Part name', part.name);
                if (name === null) return;
                for (const [position, entry] of this.song.parts.entries()) {
                    if (sourceId(entry) === sourceId(part)) parts[position] = { ...parts[position], name };
                }
            }
            await this.saveArrangement(parts);
        }

        async saveArrangement(parts) {
            await this.ensureEditing();
            const result = await this.request(`/${encodeURIComponent(this.song.id)}/arrange`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parts })
            });
            this.acceptSong(result.song);
            this.status('Arrangement saved. Arm Cache again before Play Song.');
        }

        renderCacheSummary() {
            const uniqueParts = this.uniqueParts();
            const ready = uniqueParts.filter(part => this.isPartReady(part)).length;
            const pending = uniqueParts.length - ready;
            const summary = this.element('songBetaCacheSummary');
            if (summary) summary.textContent = this.song ? `${ready} unique parts ready · ${pending} to prepare · ${this.song.parts.length} placements. Reused parts share sounds and renders. Only new or changed audio is rendered.` : 'Choose a song to see its cache status.';
            return pending;
        }

        render() {
            this.renderLockUi();
            const changesBlocked = this.revisionConflict;
            for (const id of ['songBetaBackupAccess', 'songBetaOpenAccess']) {
                const button = this.element(id);
                if (button) button.disabled = this.busy || this.playing || Boolean(this.editing);
            }
            const accessStatus = this.element('songBetaAccessStatus');
            if (accessStatus) accessStatus.textContent = this.storage.persistent
                ? 'Songs and samples live on the server. Back up Song Access once; open that file on another device. Keep it private: it grants access to this entire library. Browser audio storage is only an optional cache.'
                : 'Browser storage is unavailable. Songs and audio still load from the server; keep your Song Access file and reopen it after each reload.';
            const select = this.element('songBetaSongs');
            select.replaceChildren();
            const placeholder = this.document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = 'Choose a saved song';
            select.append(placeholder);
            for (const song of this.songs) {
                const option = this.document.createElement('option');
                option.value = song.id;
                option.textContent = song.name;
                select.append(option);
            }
            select.value = this.song?.id || '';
            select.disabled = this.busy || this.playing || Boolean(this.editing);
            this.element('songBetaNewSong').disabled = this.busy || this.playing || Boolean(this.editing);
            this.element('songBetaRefresh').disabled = this.busy || this.playing;
            const renameSong = this.element('songBetaRenameSong');
            if (renameSong) renameSong.disabled = changesBlocked || this.busy || this.playing || !this.song || Boolean(this.editing);
            this.element('songBetaSavePart').disabled = changesBlocked || this.busy || this.playing || !this.editing;
            this.element('songBetaCancelEdit').disabled = this.busy || this.playing || !this.editing;
            this.element('songBetaNewPart').disabled = changesBlocked || this.busy || this.playing || !this.song;
            this.element('songBetaArm').disabled = this.busy || this.playing || !this.song?.parts.length || Boolean(this.editing);
            const pending = this.renderCacheSummary();
            this.element('songBetaArm').textContent = this.armed ? 'Cache Armed ✓' : `Arm Cache${pending ? ` (${pending})` : ''}`;
            this.element('songBetaArm').classList.toggle('song-beta-armed', this.armed);
            const concurrency = this.element('songBetaArmConcurrency');
            if (concurrency) {
                concurrency.value = String(this.preparationConcurrency());
                concurrency.disabled = this.busy || this.playing || this.phonePreparation;
                if (this.phonePreparation) {
                    const sequential = concurrency.querySelector?.('option[value="1"]');
                    if (sequential) sequential.textContent = 'One part at a time (iPhone/iPad memory protection)';
                    concurrency.title = 'iPhone and iPad prepare one part at a time to reduce audio memory use.';
                }
            }
            this.element('songBetaPlay').disabled = this.busy || this.playing || !this.armed || Boolean(this.editing);
            const loopSong = this.element('songBetaLoop');
            if (loopSong) {
                loopSong.disabled = this.busy || this.playing || !this.song?.parts.length || Boolean(this.editing);
                loopSong.setAttribute('aria-pressed', String(this.loopSong));
                loopSong.classList.toggle('song-beta-looping', this.loopSong);
                loopSong.textContent = this.loopSong ? 'Loop Song: On' : 'Loop Song';
                loopSong.title = 'Repeat the complete song until Stop Song. Stop playback to change this option.';
            }
            const exportButton = this.element('songBetaExport');
            if (exportButton) exportButton.disabled = this.busy || this.playing || !this.song?.parts.length || Boolean(this.editing);
            const list = this.element('songBetaParts');
            const clipboard = this.element('songBetaClipboard');
            if (clipboard) {
                clipboard.textContent = this.loopClipboard ? `Copied: Bastardloop ${this.loopClipboard.layer} from ${this.loopClipboard.name}. Use Paste Part on the destination.` : '';
                clipboard.hidden = !this.loopClipboard;
            }
            list.replaceChildren();
            for (const [index, part] of (this.song?.parts || []).entries()) {
                const row = this.document.createElement('div');
                row.className = 'song-beta-part';
                if (/^#[a-f0-9]{6}$/i.test(part.colour || '')) {
                    row.style.setProperty('--song-beta-part-colour', part.colour);
                    row.style.setProperty('--song-beta-part-tint', `${part.colour}22`);
                }
                row.classList.toggle('song-beta-active', part.id === this.active);
                row.classList.toggle('song-beta-amending', part.id === this.editing?.id);
                const header = this.document.createElement('div');
                header.className = 'song-beta-part-header';
                const controls = this.document.createElement('div');
                controls.className = 'song-beta-part-controls';
                controls.id = `song-beta-controls-${this.song.id}-${part.id}`;
                const expansionKey = `${this.song.id}:${part.id}`;
                controls.hidden = !this.expandedParts.has(expansionKey);
                const toggle = this.document.createElement('button');
                toggle.type = 'button';
                toggle.className = 'performance-btn song-beta-toggle';
                const partName = this.document.createElement('span');
                partName.className = 'song-beta-part-name';
                partName.textContent = `${index + 1}. ${part.name}`;
                toggle.append(partName);
                toggle.setAttribute('aria-expanded', String(!controls.hidden));
                toggle.setAttribute('aria-controls', controls.id);
                toggle.title = `${part.name}: show or hide part controls`;
                toggle.addEventListener('click', () => {
                    controls.hidden = !controls.hidden;
                    toggle.setAttribute('aria-expanded', String(!controls.hidden));
                    if (controls.hidden) this.expandedParts.delete(expansionKey);
                    else this.expandedParts.add(expansionKey);
                });
                header.append(toggle);
                const actions = this.document.createElement('div');
                actions.className = 'song-beta-part-actions';
                const transport = this.document.createElement('button');
                const canStop = this.playing || Boolean(this.abort);
                transport.type = 'button';
                transport.className = `performance-btn song-beta-part-transport ${canStop ? 'song-beta-part-stop' : 'song-beta-part-play'}`;
                transport.textContent = canStop ? '■ Stop' : '▶ Play';
                transport.setAttribute('aria-label', canStop ? `Stop song from ${part.name}` : `Play song at ${part.name}`);
                transport.title = canStop ? 'Stop the entire song, from any part. Also cancels cache preparation.' : `Start the song at ${part.name} and continue through the following parts.`;
                transport.disabled = !canStop && (this.busy || Boolean(this.editing));
                transport.addEventListener('click', () => {
                    if (this.playing || this.abort) this.stop();
                    else this.run(() => this.playSongFromHere(part.id));
                });
                actions.append(transport);
                const cacheStatus = this.document.createElement('span');
                cacheStatus.className = 'song-beta-cache-state';
                cacheStatus.textContent = this.isPartReady(part) ? 'Ready' : this.hasSavedRender(part) ? 'Saved' : (part.revision || 1) > 1 ? 'Changed' : 'New';
                cacheStatus.title = this.isPartReady(part) ? 'Unchanged audio is ready in playback memory or song storage.' : this.hasSavedRender(part) ? 'The existing server render will be loaded without rendering again.' : 'Arm Cache will render only this new or changed part.';
                toggle.append(cacheStatus);
                row.append(header, controls);
                const button = this.document.createElement('button');
                button.type = 'button';
                button.className = 'performance-btn song-beta-recall';
                button.textContent = 'Audition';
                button.setAttribute('aria-label', `Audition ${part.name}`);
                button.setAttribute('aria-pressed', String(part.id === this.active));
                button.disabled = this.busy || Boolean(this.editing);
                button.addEventListener('click', () => this.run(() => this.recall(part)));
                controls.append(button);
                const playFrom = this.document.createElement('button');
                playFrom.type = 'button';
                playFrom.className = 'performance-btn song-beta-play-from';
                playFrom.textContent = 'Play Song From Here';
                playFrom.setAttribute('aria-label', `Play song from ${part.name}`);
                playFrom.title = this.armed ? 'Play this part and every following part with the saved repeats and tempos.' : 'Ask to arm the cache, then play this part and the rest of the song.';
                playFrom.disabled = this.busy || Boolean(this.editing);
                playFrom.addEventListener('click', () => this.run(() => this.playSongFromHere(part.id)));
                controls.append(playFrom);
                const loopPart = this.document.createElement('button');
                loopPart.type = 'button';
                loopPart.className = 'performance-btn song-beta-loop-part';
                const isLoopingPart = this.playing && this.loopPartId === part.id;
                loopPart.textContent = isLoopingPart ? 'Stop Part Loop' : 'Loop Part';
                loopPart.setAttribute('aria-label', `${isLoopingPart ? 'Stop looping' : 'Loop part'} ${part.name}`);
                loopPart.setAttribute('aria-pressed', String(isLoopingPart));
                loopPart.classList.toggle('song-beta-looping', isLoopingPart);
                loopPart.title = 'Play only this saved part repeatedly until Stop Song or Stop Part Loop.';
                loopPart.disabled = this.busy || Boolean(this.editing);
                loopPart.addEventListener('click', () => this.run(() => this.loopPart(part.id)));
                controls.append(loopPart);
                const detail = this.document.createElement('span');
                detail.className = 'song-beta-part-detail';
                const uses = this.song.parts.filter(entry => sourceId(entry) === sourceId(part)).length;
                const savedSteps = part.patternSteps * (part.patternCycleMultiplier ?? 1);
                const playedSteps = part.playbackSteps ?? savedSteps;
                detail.textContent = `${part.bpm} BPM · ${playedSteps} steps${playedSteps < savedSteps ? ` of ${savedSteps} saved` : ''} · ${partDurationSeconds(part).toFixed(1)}s${uses > 1 ? ` · Shared: ${uses} uses` : ''}`;
                controls.append(detail);
                const colourLabel = this.document.createElement('label');
                colourLabel.className = 'song-beta-part-colour';
                colourLabel.textContent = 'Colour';
                const colour = this.document.createElement('input');
                colour.type = 'color';
                colour.value = part.colour || '#75dfb4';
                colour.setAttribute('aria-label', `Colour for ${part.name}`);
                colour.title = 'Choose a colour. Saves automatically and stays with this part.';
                colour.disabled = changesBlocked || this.busy;
                colour.addEventListener('change', () => this.run(() => this.setColour(part, colour.value)));
                colourLabel.append(colour);
                controls.append(colourLabel);
                const clearColour = this.document.createElement('button');
                clearColour.type = 'button';
                clearColour.className = 'performance-btn song-beta-clear-colour';
                clearColour.textContent = 'Clear Colour';
                clearColour.setAttribute('aria-label', `Clear colour for ${part.name}`);
                clearColour.disabled = changesBlocked || this.busy || !part.colour;
                clearColour.addEventListener('click', () => this.run(() => this.setColour(part, null)));
                controls.append(clearColour);
                const repeatLabel = this.document.createElement('label');
                repeatLabel.className = 'song-beta-part-repeats';
                repeatLabel.textContent = 'Repeats';
                const repeats = this.document.createElement('input');
                repeats.type = 'number';
                repeats.min = '1';
                repeats.max = '64';
                repeats.step = '1';
                repeats.value = part.repeats;
                repeats.setAttribute('aria-label', `Repeats for ${part.name}`);
                repeats.title = '1–64 whole-pattern repeats. Saves when you leave the box or press Enter.';
                repeats.disabled = changesBlocked || this.busy || this.playing || Boolean(this.editing);
                repeats.addEventListener('change', () => this.run(() => this.setRepeats(part, repeats.value)));
                repeats.addEventListener('keydown', event => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    repeats.blur();
                });
                repeatLabel.append(repeats);
                header.append(repeatLabel);
                const stepsLabel = this.document.createElement('label');
                stepsLabel.className = 'song-beta-part-steps';
                stepsLabel.textContent = 'Steps';
                const steps = this.document.createElement('input');
                const fullSteps = part.patternSteps * (part.patternCycleMultiplier ?? 1);
                steps.type = 'number';
                steps.min = '1';
                steps.max = String(fullSteps);
                steps.step = '1';
                steps.value = part.playbackSteps ?? fullSteps;
                steps.setAttribute('aria-label', `Steps for ${part.name}`);
                steps.title = `Play the first 1–${fullSteps} steps per repeat. The full saved pattern is retained. Saves when you leave the box or press Enter.`;
                steps.disabled = changesBlocked || this.busy || this.playing || Boolean(this.editing);
                steps.addEventListener('change', () => this.run(() => this.setSteps(part, steps.value)));
                steps.addEventListener('keydown', event => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    steps.blur();
                });
                stepsLabel.append(steps);
                header.append(stepsLabel);
                for (const [label, className, action] of [
                    ['Recall', 'song-beta-load', () => this.recall(part, { start: false })],
                    ['Reuse Part', 'song-beta-reuse', () => this.reusePart(part)],
                    ['Make a full copy', 'song-beta-full-copy', () => this.fullCopyPart(part)],
                    ['Amend', 'song-beta-amend', () => this.amendPart(part)],
                    ['Delete', 'song-beta-delete', () => this.deletePart(part)],
                    ['Copy From Part', 'song-beta-copy', null],
                    ['Paste Part', 'song-beta-paste', () => this.pasteLoop(part)]
                ]) {
                    const actionButton = this.document.createElement('button');
                    actionButton.type = 'button';
                    actionButton.className = `performance-btn ${className}`;
                    actionButton.textContent = label;
                    actionButton.setAttribute('aria-label', `${label} ${part.name}`);
                    if (className === 'song-beta-reuse') actionButton.title = 'Add this existing part again at the end, without copying sounds or renders. Amendments affect every use; order and repeats are independent.';
                    if (className === 'song-beta-full-copy') actionButton.title = 'Append a full independent copy of this saved part, including all sounds and settings. Its name ends in _full_copy; editing it does not change the original.';
                    if (className === 'song-beta-amend') actionButton.title = 'Amend the shared pattern and sounds for every use of this part.';
                    if (className === 'song-beta-paste') actionButton.title = !this.loopClipboard ? 'Copy a Bastardloop from a saved part first.' : this.busy ? 'Wait for the current Song operation to finish.' : this.playing ? 'Stop Song before pasting.' : this.editing ? 'Save or cancel the current amendment before pasting.' : `Replace Bastardloop ${this.loopClipboard.layer} with the saved copy from ${this.loopClipboard.name}. Shared occurrences change together. Editing access is requested automatically.`;
                    actionButton.disabled = (!['song-beta-load', 'song-beta-copy'].includes(className) && changesBlocked) || this.busy || this.playing || Boolean(this.editing) || (className === 'song-beta-paste' && !this.loopClipboard);
                    actionButton.addEventListener('click', () => className === 'song-beta-copy' ? this.openLoopCopyPicker(part, actionButton) : this.run(action));
                    controls.append(actionButton);
                }
                for (const [label, direction] of [['Rename', 0], ['↑', -1], ['↓', 1]]) {
                    const edit = this.document.createElement('button');
                    edit.type = 'button';
                    edit.className = 'performance-btn song-beta-edit';
                    edit.textContent = label;
                    edit.setAttribute('aria-label', direction ? `Move ${part.name} ${direction < 0 ? 'up' : 'down'}` : `Rename ${part.name}`);
                    edit.disabled = changesBlocked || this.busy || this.playing || Boolean(this.editing) || (direction === -1 && index === 0) || (direction === 1 && index === this.song.parts.length - 1);
                    edit.addEventListener('click', () => this.run(() => this.arrange(part, direction)));
                    if (direction) actions.append(edit);
                    else controls.append(edit);
                }
                header.append(actions);
                list.append(row);
            }
            this.adapter.refreshPlaybackUi?.();
        }
    }

    root.MygrainSongBeta = { Controller, partDurationSeconds, sourcePartDurationSeconds, libraryKey, libraryStorage, parseLibraryAccess };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.MygrainSongBeta;
})(globalThis);
