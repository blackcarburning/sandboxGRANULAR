(function (root) {
    'use strict';

    function defaultTakeName(songName, date = new Date()) {
        const pad = value => String(value).padStart(2, '0');
        const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
        const song = String(songName || 'none').replace(/[\\/\x00-\x1f]/g, '_');
        return `${stamp}_${song}`.slice(0, 100);
    }

    class Library {
        constructor(adapter, options = {}) {
            this.adapter = adapter;
            this.targets = { M: adapter, ...options.targets };
            this.targetLane = 'M';
            this.base = options.base || '/mygrain/api/vocal-takes';
            this.users = [];
            this.takes = [];
            this.busy = false;
            this.userId = '';
            this.folderId = '';
            this.preview = null;
            this.previewController = null;
            this.build();
            this.restoreSelection();
            this.syncButtons();
        }

        build() {
            this.dialog = document.createElement('dialog');
            this.dialog.id = 'vocalTakesDialog';
            this.dialog.dataset.mygrainWorkspace = 'vocal-takes';
            this.dialog.innerHTML = `
                <header><h2>Temporary Vocal Takes</h2><button type="button" data-action="close" aria-label="Close vocal take browser">Close</button></header>
                <p class="vocal-takes-note">Private workspace for your signed-in account, shared across your songs and patterns. User names organise takes within this account; they are not login accounts. Takes stay here until you delete them.</p>
                <p data-target role="status">Load/save target: M (lead vocals)</p>
                <div class="vocal-takes-toolbar">
                    <label>User<select data-field="user" aria-label="Vocal take user"></select></label>
                    <label>Folder<select data-field="folder" aria-label="Vocal take folder"></select></label>
                    <button type="button" data-action="refresh">Refresh</button>
                    <button type="button" data-action="show-save">Save Version</button>
                </div>
                <div class="vocal-takes-toolbar" data-group="new-user" hidden>
                    <label>New user name<input type="text" data-field="new-user" maxlength="100" autocomplete="off"></label>
                    <button type="button" data-action="create-user">Create User</button>
                </div>
                <form class="vocal-takes-toolbar" data-group="save" hidden>
                    <label>Version name<input type="text" data-field="name" maxlength="100" required autocomplete="off"></label>
                    <button type="submit" data-action="save">Save Take</button>
                    <button type="button" data-action="cancel-save">Cancel Save</button>
                </form>
                <div class="vocal-takes-toolbar" data-group="folder">
                    <label>New folder name<input type="text" data-field="new-folder" maxlength="100" autocomplete="off"></label>
                    <button type="button" data-action="create-folder">Create Folder</button>
                </div>
                <p data-status role="status" aria-live="polite">Loading takes…</p>
                <div data-list aria-label="Saved vocal takes"></div>`;
            document.body.append(this.dialog);
            this.field = name => this.dialog.querySelector(`[data-field="${name}"]`);
            this.group = name => this.dialog.querySelector(`[data-group="${name}"]`);
            this.dialog.querySelector('[data-action="close"]').addEventListener('click', () => {
                this.stopPreview();
                this.dialog.close();
            });
            this.dialog.addEventListener('cancel', () => this.stopPreview());
            this.dialog.addEventListener('close', () => this.stopPreview());
            root.addEventListener('mygrain-account-lock', () => this.stopPreview());
            this.dialog.querySelector('[data-action="refresh"]').addEventListener('click', () => this.run(() => this.refresh()));
            this.dialog.querySelector('[data-action="show-save"]').addEventListener('click', () => this.showSave());
            this.dialog.querySelector('[data-action="cancel-save"]').addEventListener('click', () => { this.group('save').hidden = true; });
            this.dialog.querySelector('[data-action="create-user"]').addEventListener('click', () => this.run(() => this.createUser()));
            this.dialog.querySelector('[data-action="create-folder"]').addEventListener('click', () => this.run(() => this.createFolder()));
            this.group('save').addEventListener('submit', event => { event.preventDefault(); this.run(() => this.save()); });
            this.field('user').addEventListener('change', () => {
                this.userId = this.field('user').value;
                this.folderId = '';
                this.stopPreview();
                this.render();
                this.rememberSelection();
            });
            this.field('folder').addEventListener('change', () => {
                this.folderId = this.field('folder').value;
                this.stopPreview();
                this.renderTakes();
                this.rememberSelection();
            });
            this.observer = new MutationObserver(() => this.syncButtons());
            for (const lane of Object.keys(this.targets)) {
                const prefix = lane === 'M+' ? 'performanceBastardLoopMPlus' : 'performanceBastardLoopM';
                document.getElementById(`${prefix}SaveVersionBtn`).addEventListener('click', () => this.open(true, lane));
                document.getElementById(`${prefix}TakesBtn`).addEventListener('click', () => this.open(false, lane));
                this.observer.observe(document.getElementById(`${prefix}NormalizeBtn`), { attributes: true, attributeFilter: ['disabled'] });
            }
        }

        async request(path = '', options = {}) {
            const response = await fetch(this.base + path, { cache: 'no-store', ...options });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || `Vocal storage returned ${response.status}.`);
            return result;
        }

        post(path, payload) {
            return this.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        }

        setStatus(message) {
            this.dialog.querySelector('[data-status]').textContent = message;
        }

        async run(action) {
            if (this.busy) return;
            this.busy = true;
            this.syncButtons();
            try {
                await action();
            } catch (error) {
                this.setStatus(error.message);
            } finally {
                this.busy = false;
                this.syncButtons();
            }
        }

        syncButtons() {
            const available = this.adapter.canSave();
            for (const [lane, adapter] of Object.entries(this.targets)) {
                const prefix = lane === 'M+' ? 'performanceBastardLoopMPlus' : 'performanceBastardLoopM';
                document.getElementById(`${prefix}SaveVersionBtn`).disabled = !adapter.canSave() || this.busy;
            }
            this.dialog.querySelectorAll('button, input, select').forEach(control => {
                if (control.closest('[data-mygrain-workspace="favourites"], .sample-favourite-item')) return;
                control.disabled = this.busy && control.dataset.action !== 'close';
            });
            for (const action of ['show-save', 'save']) {
                this.dialog.querySelector(`[data-action="${action}"]`).disabled = this.busy || !available;
            }
            this.dialog.querySelector('[data-action="create-folder"]').disabled = this.busy || !this.selectedUser();
            this.dialog.querySelectorAll('[data-load-take]').forEach(button => { button.disabled = this.busy || !this.adapter.canLoad(); });
        }

        async open(save, lane = this.targetLane || 'M') {
            if (this.busy) return;
            if (!this.targets[lane]) throw new Error('Unknown vocal lane.');
            this.targetLane = lane;
            this.adapter = this.targets[lane];
            this.dialog.querySelector('[data-target]').textContent = `Load/save target: ${lane} (${lane === 'M+' ? 'backing' : 'lead'} vocals)`;
            if (!this.dialog.open) this.dialog.showModal();
            this.group('save').hidden = true;
            await this.run(async () => {
                await this.refresh();
                if (save) this.showSave();
            });
        }

        showSave() {
            if (!this.adapter.canSave()) { this.setStatus(`Record or load an ${this.targetLane}-loop take first, and finish recording before saving.`); return; }
            this.field('name').value = defaultTakeName(this.adapter.songName());
            this.group('save').hidden = false;
            this.setStatus('Choose a user and folder, edit the version name if needed, then Save Take.');
            this.field('name').focus();
        }

        async refresh() {
            const result = await this.request();
            this.users = result.users;
            this.takes = result.takes;
            if (!this.users.some(user => user.id === this.userId) && this.userId !== '__new__') this.userId = this.users[0]?.id || '__new__';
            this.render();
            this.setStatus(`${this.takes.length} take${this.takes.length === 1 ? '' : 's'} in the shared workspace.`);
        }

        selectedUser() {
            return this.users.find(user => user.id === this.userId);
        }

        setOptions(select, entries, value) {
            select.replaceChildren(...entries.map(([id, name]) => new Option(name, id)));
            select.value = value;
        }

        render() {
            this.setOptions(this.field('user'), [...this.users.map(user => [user.id, user.name]), ['__new__', '+ Create New User']], this.userId);
            const user = this.selectedUser();
            const folders = user?.folders || [];
            if (!folders.some(folder => folder.id === this.folderId)) this.folderId = '';
            this.setOptions(this.field('folder'), [['', 'Main folder'], ...folders.map(folder => [folder.id, folder.name])], this.folderId);
            this.group('new-user').hidden = Boolean(user);
            this.group('folder').hidden = !user;
            this.renderTakes();
            this.syncButtons();
        }

        renderTakes() {
            const list = this.dialog.querySelector('[data-list]');
            const favourites = root.mygrainFavourites;
            favourites?.ensureToolbar('vocals', list, () => this.renderTakes());
            list.replaceChildren();
            const user = this.selectedUser();
            const takes = this.takes.filter(take => take.userId === this.userId && take.folderId === this.folderId && (!favourites || favourites.matches('vocals', root.MygrainFavourites.itemKey('vocal', take.id))));
            if (!takes.length) {
                const empty = document.createElement('p');
                empty.textContent = user ? 'No vocal takes in this folder yet.' : 'Choose a user, or enter a new name and Create User.';
                list.append(empty);
            }
            for (const take of takes) {
                const row = document.createElement('article');
                row.className = 'vocal-take-row';
                row.dataset.takeId = take.id;
                const title = document.createElement('h3');
                title.textContent = take.name;
                favourites?.decorate('vocals', root.MygrainFavourites.itemKey('vocal', take.id), take.name, row);
                const metadata = document.createElement('p');
                metadata.textContent = `${take.durationSeconds.toFixed(2)}s · ${take.bpm} BPM · ${take.songName} · ${new Date(take.createdAt * 1000).toLocaleString()}`;
                const actions = document.createElement('div');
                actions.className = 'vocal-takes-toolbar';
                const button = (label, action) => {
                    const control = document.createElement('button');
                    control.type = 'button';
                    control.textContent = label;
                    control.addEventListener('click', () => this.run(action));
                    actions.append(control);
                    return control;
                };
                button('Audition', () => this.audition(take));
                button('Stop Audition', () => { this.stopPreview(); this.setStatus('Vocal audition stopped.'); });
                button('Load into M', () => this.load(take)).dataset.loadTake = take.id;
                button('Rename', async () => {
                    const name = window.prompt('Rename vocal take:', take.name);
                    if (name === null) return;
                    await this.post(`/takes/${take.id}/rename`, { name });
                    await this.refresh();
                });
                button('Delete', async () => {
                    if (!window.confirm(`Delete vocal take “${take.name}” from the shared workspace? Saved song parts and the current M take are not deleted.`)) return;
                    this.stopPreview();
                    await this.post(`/takes/${take.id}/delete`, {});
                    await this.refresh();
                });
                const moveLabel = document.createElement('label');
                moveLabel.textContent = 'Move to';
                const move = document.createElement('select');
                move.setAttribute('aria-label', `Move ${take.name} to folder`);
                this.setOptions(move, [['', 'Main folder'], ...user.folders.map(folder => [folder.id, folder.name])], take.folderId);
                move.addEventListener('change', () => this.run(async () => {
                    try {
                        await this.post(`/takes/${take.id}/move`, { folderId: move.value });
                        this.stopPreview();
                        await this.refresh();
                    } catch (error) {
                        move.value = take.folderId;
                        throw error;
                    }
                }));
                moveLabel.append(move);
                actions.append(moveLabel);
                row.append(title, metadata, actions);
                list.append(row);
            }
            this.syncButtons();
        }

        async createUser() {
            const result = await this.post('/users', { name: this.field('new-user').value });
            this.userId = result.user.id;
            this.folderId = '';
            this.field('new-user').value = '';
            await this.refresh();
            this.rememberSelection();
            this.setStatus(`Created user ${result.user.name}. You can now save their takes.`);
        }

        async createFolder() {
            if (!this.selectedUser()) throw new Error('Choose or create a user first.');
            const result = await this.post(`/users/${this.userId}/folders`, { name: this.field('new-folder').value });
            this.folderId = result.folder.id;
            this.field('new-folder').value = '';
            await this.refresh();
            this.rememberSelection();
            this.setStatus(`Created folder ${result.folder.name}.`);
        }

        async save() {
            if (!this.adapter.canSave()) throw new Error(`Finish recording, and load an ${this.targetLane || 'M'}-loop take before saving.`);
            if (!this.selectedUser()) throw new Error('Choose a user or Create User before saving.');
            const snapshot = this.adapter.capture();
            const query = new URLSearchParams({ userId: this.userId, folderId: this.folderId, name: this.field('name').value, songName: snapshot.songName || 'none', bpm: String(snapshot.bpm) });
            this.setStatus('Saving vocal version…');
            await this.request(`/takes?${query}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: snapshot.wav });
            await this.refresh();
            this.group('save').hidden = true;
            this.rememberSelection();
            this.setStatus(`Vocal version saved. The current ${this.targetLane || 'M'} take and saved song parts are unchanged.`);
        }

        async load(take) {
            if (!this.adapter.canLoad()) throw new Error('Start MYGRAIN and finish recording or song playback before loading a take.');
            const lane = this.targetLane || 'M';
            if (!window.confirm(`Load “${take.name}” into ${lane}? This replaces the current ${lane} take, not the other vocal lane, saved song parts or the shared library.`)) return;
            this.stopPreview();
            this.setStatus(`Loading vocal take into ${lane}…`);
            const response = await fetch(`${this.base}/takes/${take.id}/audio`, { cache: 'no-store' });
            if (!response.ok) throw new Error('The vocal take could not be downloaded. Refresh and retry.');
            await this.adapter.load(await response.arrayBuffer(), take);
            this.setStatus(`Loaded ${take.name} into ${lane}. Save a song part/amendment if you want that part to use this take.`);
        }

        async audition(take) {
            if (this.preview?.paused && this.previewTakeId === take.id && this.previewController) {
                if (await this.previewController.play()) this.setStatus(this.preview.paused
                    ? `Loaded ${take.name}. Tap Audition again to allow playback.` : `Auditioning ${take.name} only.`);
                return;
            }
            this.stopPreview();
            if (!root.mygrainAccounts?.createMediaPreview) throw new Error('Log in to audition saved vocal takes.');
            const preview = new Audio();
            this.preview = preview;
            this.previewTakeId = take.id;
            this.previewController = root.mygrainAccounts.createMediaPreview(preview, `${this.base}/takes/${take.id}/audio`);
            preview.addEventListener('ended', () => {
                if (this.preview !== preview) return;
                this.stopPreview();
                this.setStatus(`Finished auditioning ${take.name}.`);
            });
            try {
                if (await this.previewController.play() && this.preview === preview) this.setStatus(preview.paused
                    ? `Loaded ${take.name}. Tap Audition again to allow playback.` : `Auditioning ${take.name} only.`);
            } catch (error) {
                if (this.preview === preview) this.stopPreview();
                throw new Error('Audition could not start. Refresh and try again.');
            }
        }

        stopPreview() {
            this.previewController?.dispose();
            this.previewController = null;
            this.previewTakeId = null;
            if (!this.preview) return;
            this.preview.pause();
            this.preview.removeAttribute('src');
            this.preview.load();
            this.preview = null;
        }

        rememberSelection() {
            try { localStorage.setItem('mygrain-vocal-workspace-selection-v1', JSON.stringify({ userId: this.userId, folderId: this.folderId })); } catch (error) {}
        }

        restoreSelection() {
            try {
                const selection = JSON.parse(localStorage.getItem('mygrain-vocal-workspace-selection-v1') || '{}');
                this.userId = selection.userId || '';
                this.folderId = selection.folderId || '';
            } catch (error) {}
        }
    }

    const exported = { defaultTakeName, Library };
    if (typeof module !== 'undefined' && module.exports) module.exports = exported;
    root.MygrainVocalTakes = exported;
    if (typeof document === 'undefined' || root.__mygrainSongRenderDeck) return;
    function laneAdapter(lane) {
        const backing = lane === 'M+';
        return {
            canSave: () => Boolean((backing ? bastardLoopMPlusRawBuffer : bastardLoopMRawBuffer) && (backing ? bastardLoopMPlusRecordingState : bastardLoopMRecordingState) === 'idle' && !engineStarting && !stateSaveSuspended),
            canLoad: () => Boolean(isAudioGraphReady() && !engineStarting && !stateSaveSuspended && bastardLoopMRecordingState === 'idle' && bastardLoopMPlusRecordingState === 'idle' && !root.mygrainSongBeta?.busy && !root.mygrainSongBeta?.playing),
            songName: () => root.mygrainSongBeta?.song?.name || 'none',
            capture() {
                return { wav: audioBufferToWav(backing ? bastardLoopMPlusRawBuffer : bastardLoopMRawBuffer), bpm: backing ? bastardLoopMPlusSourceBpm : bastardLoopMSourceBpm, songName: this.songName() };
            },
            async load(body, take) {
                const context = audioContext;
                const buffer = await context.decodeAudioData(body);
                if (!this.canLoad() || context !== audioContext) throw new Error(`${lane}-loop state changed while loading; retry after playback or recording finishes.`);
                const stop = backing ? stopBastardLoopMPlus : stopBastardLoopM;
                const apply = backing ? applyRecordedBastardLoopMPlusBuffer : applyRecordedBastardLoopMBuffer;
                stop({ skipUi: true });
                await apply(buffer, { bpm: take.bpm, durationSeconds: take.durationSeconds, summary: `${take.name} · ${take.durationSeconds.toFixed(2)}s vocal take`, statusMessage: `Loaded vocal take into ${lane}: ${take.name}` });
                saveState({ force: true });
            }
        };
    }
    root.mygrainVocalTakes = new Library(laneAdapter('M'), { targets: { 'M+': laneAdapter('M+') } });
})(typeof window !== 'undefined' ? window : globalThis);
