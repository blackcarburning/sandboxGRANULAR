/* MYGRAIN's shared, transient sample chooser. Source/PCM ownership stays in adapters. */
(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.MygrainSampleGrid = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';
    const PAGE_SIZE = 200;
    function shuffle(files, random = Math.random) {
        const result = files.slice();
        for (let i = result.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }
    const keyOf = file => JSON.stringify([`sample:${file.sourceKey}`, file.relativePath]);

    class Browser {
        constructor(adapter) {
            this.adapter = adapter;
            this.doc = root.document;
            this.epoch = 0;
            this.order = []; this.files = []; this.selected = -1; this.page = 0;
            this.filter = ''; this.loadedKey = ''; this.playingKey = '';
            this.build();
            for (const event of ['mygrain-account-lock', 'mygrain-account-changed', 'pagehide']) {
                root.addEventListener(event, () => this.close(false));
            }
            this.doc.addEventListener('visibilitychange', () => {
                if (this.doc.hidden) this.stopPreview();
            });
            adapter.favourites?.subscribe(() => {
                if (!this.overlay.hidden) { this.updateHearts(); this.applyFilter(); }
            });
        }

        build() {
            const el = (tag, className, text) => {
                const node = this.doc.createElement(tag);
                if (className) node.className = className;
                if (text) node.textContent = text;
                return node;
            };
            const button = (text, label, action, className = '') => {
                const b = el('button', `sample-grid-control ${className}`, text);
                b.type = 'button'; b.title = label; b.setAttribute('aria-label', label);
                b.addEventListener('click', action); return b;
            };
            this.overlay = el('div', 'sample-grid-overlay');
            this.overlay.id = 'sampleGridBrowser'; this.overlay.hidden = true;
            const panel = el('section', 'sample-grid-panel');
            panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
            panel.setAttribute('aria-labelledby', 'sampleGridTitle');
            const header = el('header', 'sample-grid-header');
            this.previousPage = button('‹', 'Previous page', () => this.goPage(this.page - 1), 'sample-grid-page-left');
            this.previousPage.dataset.gridAction = 'page-previous';
            this.nextPage = button('›', 'Next page', () => this.goPage(this.page + 1), 'sample-grid-page-right');
            this.nextPage.dataset.gridAction = 'page-next';
            const center = el('div', 'sample-grid-center');
            const info = el('div', 'sample-grid-info');
            this.title = el('span', 'sample-grid-title'); this.title.id = 'sampleGridTitle';
            this.pageInfo = el('span', 'sample-grid-page-info');
            const close = button('×', 'Close sample browser', () => this.close(), 'sample-grid-close');
            close.dataset.gridAction = 'close';
            this.transportPlay = button('▶', 'Start whole loop', () => this.playTransport(), 'sample-grid-transport sample-grid-transport-play');
            this.transportPlay.dataset.gridAction = 'transport-play';
            this.transportStop = button('■', 'Stop whole loop', () => this.stopTransport(), 'sample-grid-transport sample-grid-transport-stop');
            this.transportStop.dataset.gridAction = 'transport-stop';
            info.append(this.title, this.transportPlay, this.transportStop, this.pageInfo, close);
            const controls = el('div', 'sample-grid-controls');
            this.heart = button('♡', 'Favourite selected sample', () => this.toggleHeart(), 'sample-grid-heart');
            this.heart.dataset.gridAction = 'heart';
            this.hearts = el('select', 'sample-grid-hearts'); this.hearts.setAttribute('aria-label', 'Filter by heart collection');
            this.hearts.addEventListener('change', () => {
                this.filter = this.hearts.value;
                if (this.filter && this.filter !== '*') {
                    const f = this.adapter.favourites;
                    f.state('samples').collection = this.filter; f.remember();
                }
                this.stopPreview(); this.cancelLoad(); this.applyFilter(true);
            });
            this.minus = button('−', 'Previous sample and audition', () => this.step(-1), 'sample-grid-step');
            this.minus.dataset.gridAction = 'previous';
            this.plus = button('+', 'Next sample and audition', () => this.step(1), 'sample-grid-step');
            this.plus.dataset.gridAction = 'next';
            this.loadButton = button('Load', 'Load selected sample; keep browser open', () => this.load(), 'sample-grid-load');
            this.loadButton.dataset.gridAction = 'load';
            controls.append(this.heart, this.hearts, this.minus, this.plus, this.loadButton);
            const previewLabel = el('label', 'sample-grid-track-preview');
            this.trackPreview = el('input'); this.trackPreview.type = 'checkbox';
            this.trackPreview.dataset.gridAction = 'preview';
            this.trackPreview.setAttribute('aria-label', 'Preview in track');
            previewLabel.append(this.trackPreview, this.doc.createTextNode('Preview'));
            previewLabel.title = 'Audition in the track. Original retained until Add.';
            controls.append(previewLabel);
            this.trackPreview.addEventListener('change', () => {
                this.cancelLoad(); this.stopPreview();
                if (this.trackPreview.checked) {
                    if (this.candidate) this.auditionCandidate();
                    else if (this.config.mode !== 'loop') this.preview();
                } else this.message('Preview off · original retained');
            });
            const detail = el('div', 'sample-grid-detail');
            this.name = el('span', 'sample-grid-filename', 'Tap ▶ to audition');
            this.name.id = 'sampleGridFilename'; this.name.setAttribute('aria-live', 'polite');
            this.source = el('select', 'sample-grid-source'); this.source.setAttribute('aria-label', 'Assigned sample folder');
            this.source.addEventListener('change', async () => {
                const source = this.source.value;
                const epoch = this.epoch, config = this.config;
                this.cancelLoad(); this.stopPreview(); this.source.disabled = true;
                try {
                    await this.adapter.sourceChanged?.(config, source);
                    if (this.valid(epoch)) await this.open(config, source);
                } catch (error) {
                    if (this.valid(epoch)) { this.source.value = this.sourceKey; this.message(error.message, true); }
                } finally { if (this.valid(epoch)) this.source.disabled = false; }
            });
            detail.append(this.name, this.source);
            center.append(info, controls, detail);
            header.append(this.previousPage, center, this.nextPage);
            this.loopTools = el('section', 'sample-grid-loop-tools'); this.loopTools.hidden = true;
            this.pickedList = el('div', 'sample-grid-picked'); this.pickedList.setAttribute('aria-label', 'Selected source samples');
            this.divisions = el('div', 'sample-grid-divisions'); this.divisions.setAttribute('role', 'group'); this.divisions.setAttribute('aria-label', 'Recut divisions');
            const loopActions = el('div', 'sample-grid-loop-actions');
            this.recutButton = button('Recut', 'Prepare a new cut; Add confirms replacement', () => this.recut(), 'sample-grid-recut');
            this.recutButton.dataset.gridAction = 'recut';
            this.resultButton = button('▶ Play loop', 'Audition the prepared cut, or the current card', () => this.playResult(), 'sample-grid-result');
            this.resultButton.dataset.gridAction = 'play-loop';
            this.clearPicks = button('Clear list', 'Clear selected samples without changing the card', () => {
                this.invalidateCandidate(); this.cancelLoad(); this.picks = []; this.paintPicks(); this.paintSelection();
            }); this.clearPicks.dataset.gridAction = 'clear-picks';
            loopActions.append(this.recutButton, this.resultButton, this.clearPicks);
            this.loopTools.append(this.pickedList, this.divisions, loopActions);
            this.status = el('div', 'sample-grid-status'); this.status.setAttribute('role', 'status');
            this.scroller = el('div', 'sample-grid-scroller'); this.scroller.tabIndex = -1;
            this.grid = el('div', 'sample-grid-cells'); this.grid.setAttribute('role', 'group');
            this.grid.setAttribute('aria-label', 'Samples · tap to audition, Add to replace');
            this.empty = el('div', 'sample-grid-empty');
            this.scroller.append(this.grid, this.empty);
            this.hint = el('footer', 'sample-grid-hint', 'Tap ▶ audition · double tap load · ← ↑ ↓ → move · Enter load');
            this.audio = el('audio'); this.audio.preload = 'none'; this.audio.hidden = true;
            this.audio.setAttribute('playsinline', '');
            this.audio.addEventListener('playing', () => {
                if (this.overlay.hidden) return;
                if (this.resultPlaying) { this.resultButton.textContent = '■ Stop loop'; this.message('Playing card loop'); return; }
                if (!this.overlay.hidden && this.previewFile) {
                    this.playingKey = keyOf(this.previewFile); this.paintSelection();
                    this.message('Auditioning');
                }
            });
            this.audio.addEventListener('ended', () => { this.playingKey = ''; this.paintSelection(); this.message(''); });
            this.audio.addEventListener('error', () => {
                if (!this.overlay.hidden && this.audio.getAttribute('src')) {
                    this.resultPlaying = false; this.resultButton.textContent = '▶ Play loop';
                    this.playingKey = ''; this.paintSelection(); this.message('Could not audition. Tap to retry.', true);
                }
            });
            panel.append(header, this.loopTools, this.status, this.scroller, this.hint, this.audio);
            this.overlay.append(panel); this.doc.body.append(this.overlay);
            this.overlay.addEventListener('keydown', event => this.keydown(event));
            // Browsers suppress click on a native pan. Track movement as well so a
            // cancelled drag/long press can never count as the second load tap.
            this.grid.addEventListener('pointerdown', event => {
                this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, at: Date.now(), moved: false };
            }, { passive: true });
            this.grid.addEventListener('pointermove', event => {
                if (this.pointer?.id === event.pointerId && Math.hypot(event.clientX - this.pointer.x, event.clientY - this.pointer.y) > 9) {
                    this.pointer.moved = true; this.lastTap = null;
                }
            }, { passive: true });
            this.grid.addEventListener('pointercancel', () => { this.pointer = { moved: true }; this.lastTap = null; });
            this.grid.addEventListener('click', event => {
                const cell = event.target.closest('[data-sample-index]');
                if (!cell || (event.detail !== 0 && (this.pointer?.moved || Date.now() - (this.pointer?.at || Date.now()) > 700))) return;
                const index = Number(cell.dataset.sampleIndex), now = Date.now();
                const double = this.lastTap?.index === index && now - this.lastTap.time < 400;
                this.lastTap = double ? null : { index, time: now };
                this.select(index);
                if (double && this.config.mode === 'loop') this.load({ togglePick: true }); else this.preview();
            });
        }

        message(text, error = false) {
            this.status.textContent = text;
            this.status.title = text;
            this.status.classList.toggle('sample-grid-error', error);
        }
        get previewing() { return !this.overlay.hidden && Boolean(this.trackAuditionActive || this.resultPlaying || this.decodedPreview?.playing || !this.audio.paused); }
        get file() { return this.files[this.selected]; }
        get pages() { return Math.max(1, Math.ceil(this.files.length / PAGE_SIZE)); }
        valid(epoch) { return !this.overlay.hidden && this.epoch === epoch && this.adapter.identity() === this.identity; }
        guard(epoch, signal) {
            if (signal?.aborted || !this.valid(epoch)) throw new DOMException('Sample selection changed.', 'AbortError');
        }
        async open(config, source = config.sourceKey) {
            const returnFocus = this.overlay.hidden ? this.doc.activeElement : this.returnFocus;
            this.close(false);
            this.returnFocus = returnFocus;
            this.config = config; this.identity = this.adapter.identity();
            this.sourceKey = source; const epoch = ++this.epoch;
            this.order = []; this.files = []; this.selected = -1; this.page = 0;
            this.filter = ''; this.loadedKey = ''; this.lastTap = null;
            this.trackPreview.checked = false; this.candidate = null;
            this.pendingDivisions = config.mode === 'loop' ? this.adapter.getDivisions(config).slice() : [];
            this.picks = this.adapter.initialPicks?.(config, source) || [];
            this.overlay.hidden = false; this.title.textContent = config.title;
            this.loopTools.hidden = config.mode !== 'loop';
            this.grid.setAttribute('aria-label', config.mode === 'loop' ? 'Samples · tap to audition, double tap to select or deselect' : 'Samples · tap to audition, Add to replace');
            this.loadButton.textContent = 'Add';
            this.loadButton.setAttribute('aria-label', 'Add to track; confirm replacement');
            this.hint.textContent = config.mode === 'loop' ? 'Double tap toggle sources · Recut → Preview · Add replaces after confirmation' : 'Tap audition · Preview hears it in track · Add replaces after confirmation';
            this.overlay.dataset.target = config.target;
            this.name.textContent = 'Tap ▶ to audition'; this.name.title = '';
            this.source.replaceChildren();
            const options = config.sourceOptions?.length ? config.sourceOptions.slice() : [{ value: source, label: config.sourceLabel }];
            if (!options.some(option => option.value === source)) options.unshift({ value: source, label: config.sourceLabel || source });
            for (const option of options) this.source.add(new Option(option.label, option.value));
            this.source.value = source; this.source.hidden = options.length < 2;
            this.source.disabled = false;
            this.source.title = options.find(option => option.value === source)?.label || source;
            this.paintDivisions(); this.paintPicks(); this.updateHearts(); this.render(); this.message('Loading samples…');
            this.overlay.querySelector('[data-grid-action="close"]').focus({ preventScroll: true });
            this.listController = new AbortController();
            const controller = this.listController;
            try {
                const files = await this.adapter.list(source, controller.signal);
                this.guard(epoch, controller.signal);
                // A single Fisher–Yates pass, never on paging, favourites or load.
                this.order = shuffle(files.map(file => ({ ...file, sourceKey: source })));
                this.applyFilter(true); this.message('');
            } catch (error) {
                if (this.valid(epoch) && error.name !== 'AbortError') this.message(`List unavailable: ${error.message}. Reopen to retry.`, true);
            } finally { if (this.listController === controller) this.listController = null; }
            const favourites = this.adapter.favourites;
            if (favourites && !favourites.loaded) favourites.refresh().catch(() => {
                if (this.valid(epoch)) this.message('Hearts unavailable; reopen to retry. Samples remain usable.', true);
            });
        }
        close(restoreFocus = true) {
            this.transportSerial = (this.transportSerial || 0) + 1;
            this.transportPlay.disabled = false;
            this.epoch++; this.listController?.abort(); this.listController = null;
            this.confirmCancel?.(); this.confirmCancel = null;
            this.cancelLoad(); this.stopPreview(); this.candidate = null;
            if (this.trackPreview) this.trackPreview.checked = false;
            this.clearResult(); this.picks = []; this.pickedList.replaceChildren();
            this.overlay.hidden = true;
            this.order = []; this.files = []; this.selected = -1; this.grid.replaceChildren();
            this.lastTap = null;
            if (restoreFocus && this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
        }
        async playTransport() {
            if (this.overlay.hidden || this.transportPlay.disabled) return;
            const epoch = this.epoch, serial = this.transportSerial = (this.transportSerial || 0) + 1;
            const guard = () => {
                this.guard(epoch);
                if (serial !== this.transportSerial) throw new DOMException('Playback cancelled.', 'AbortError');
            };
            this.transportPlay.disabled = true;
            if (this.trackPreview.checked && this.candidate) this.auditionCandidate();
            try { await this.adapter.playTransport(guard); }
            catch (error) {
                if (this.valid(epoch) && serial === this.transportSerial && error.name !== 'AbortError') this.message(error.message, true);
            } finally {
                if (serial === this.transportSerial) this.transportPlay.disabled = false;
            }
        }
        stopTransport() {
            this.transportSerial = (this.transportSerial || 0) + 1;
            this.transportPlay.disabled = false;
            this.adapter.stopTransport();
        }
        cancelLoad() { this.loadController?.abort(); this.loadController = null; this.loading = false; }
        stopPreview() {
            this.adapter.setPreview?.(this.config, null); this.trackAuditionActive = false;
            this.previewSerial = (this.previewSerial || 0) + 1;
            this.decodedPreview?.dispose(); this.decodedPreview = null;
            this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load();
            this.audio.loop = false; this.resultPlaying = false;
            this.resultButton.textContent = '▶ Play loop';
            this.playingKey = ''; this.previewFile = null;
            this.paintSelection();
        }
        updateHearts() {
            const favourites = this.adapter.favourites;
            this.hearts.replaceChildren(new Option('All samples', ''), new Option('♥ All hearts', '*'));
            for (const group of favourites?.groups || []) this.hearts.add(new Option(`♥ ${group.name}`, group.id));
            if (this.filter && this.filter !== '*' && !favourites?.groups.some(g => g.id === this.filter)) this.filter = '';
            this.hearts.value = this.filter;
            this.hearts.disabled = !favourites?.loaded;
        }
        applyFilter(reset = false) {
            const previous = this.file, favourites = this.adapter.favourites;
            this.files = this.order.filter(file => !this.filter || favourites?.groups.some(group =>
                (this.filter === '*' || group.id === this.filter) && Object.hasOwn(group.items, keyOf(file))));
            this.selected = reset ? -1 : this.files.indexOf(previous);
            if (this.selected < 0 && previous) { this.stopPreview(); this.cancelLoad(); this.name.textContent = 'Tap ▶ to audition'; }
            this.page = reset ? 0 : Math.min(this.page, this.pages - 1);
            this.render();
        }
        render() {
            const scroll = this.scroller.scrollTop;
            this.grid.replaceChildren();
            const start = this.page * PAGE_SIZE, end = Math.min(start + PAGE_SIZE, this.files.length);
            const heartedKeys = new Set((this.adapter.favourites?.groups || []).flatMap(group => Object.keys(group.items)));
            const fragment = this.doc.createDocumentFragment();
            for (let i = start; i < end; i++) {
                const b = this.doc.createElement('button'); b.type = 'button'; b.className = 'sample-grid-cell';
                b.dataset.sampleIndex = i;
                const hue = 280 * (i - start) / Math.max(1, end - start - 1);
                b.style.setProperty('--sample-hue', hue.toFixed(2));
                b.style.setProperty('--sample-ink', hue >= 35 && hue < 185 ? '#101525' : '#fff');
                const number = this.doc.createElement('span'); number.textContent = String(i + 1);
                const play = this.doc.createElement('span'); play.textContent = '▶'; play.className = 'sample-grid-play'; play.setAttribute('aria-hidden', 'true');
                b.append(number, play);
                const hearted = heartedKeys.has(keyOf(this.files[i]));
                if (hearted) {
                    const heart = this.doc.createElement('span'); heart.textContent = '♥'; heart.className = 'sample-grid-cell-heart'; heart.setAttribute('aria-hidden', 'true');
                    b.append(heart);
                }
                b.title = `${i + 1} · ${this.files[i].name}${hearted ? ' · ♥' : ''}`;
                b.setAttribute('aria-label', `Sample ${i + 1}: ${this.files[i].name}. ${hearted ? 'Hearted. ' : ''}Audition; double tap to ${this.config?.mode === 'loop' ? 'select or deselect in recut list' : 'audition'}.`);
                fragment.append(b);
            }
            this.grid.append(fragment);
            this.empty.hidden = Boolean(this.files.length);
            this.empty.textContent = this.filter ? 'No hearted samples in this folder.' : 'No samples to show.';
            this.pageInfo.textContent = `${this.page + 1}/${this.pages} · ${this.files.length.toLocaleString()}`;
            this.previousPage.disabled = this.page === 0; this.nextPage.disabled = this.page >= this.pages - 1;
            this.scroller.scrollTop = scroll;
            this.paintSelection();
        }
        paintSelection() {
            if (!this.grid) return;
            for (const cell of this.grid.children) {
                const index = Number(cell.dataset.sampleIndex), key = this.files[index] ? keyOf(this.files[index]) : '';
                cell.classList.toggle('selected', index === this.selected);
                cell.classList.toggle('loaded', key === this.loadedKey);
                cell.classList.toggle('playing', key === this.playingKey);
                const picked = (this.picks || []).some(file => keyOf(file) === key);
                cell.classList.toggle('picked', picked);
                cell.dataset.picked = String(picked);
                cell.setAttribute('aria-description', picked ? 'In recut list' : '');
                cell.setAttribute('aria-pressed', String(this.config?.mode === 'loop' ? picked : index === this.selected));
                cell.tabIndex = index === this.selected || (this.selected < 0 && index === this.page * PAGE_SIZE) ? 0 : -1;
            }
            this.loadButton.disabled = (this.config?.mode === 'loop' ? !this.candidate : !this.file) || Boolean(this.loading);
            this.recutButton.disabled = !this.picks?.length || Boolean(this.loading);
            this.clearPicks.disabled = !this.picks?.length || Boolean(this.loading);
            this.resultButton.disabled = this.config?.mode !== 'loop' || !(this.candidate?.buffer || this.adapter.resultBuffer?.(this.config)) || Boolean(this.loading);
            this.minus.disabled = !this.files.length || this.selected === 0;
            this.plus.disabled = !this.files.length || this.selected === this.files.length - 1;
            const f = this.adapter.favourites, group = f?.group('samples');
            const hearted = Boolean(this.file && group && Object.hasOwn(group.items, keyOf(this.file)));
            this.heart.textContent = hearted ? '♥' : '♡'; this.heart.setAttribute('aria-pressed', String(hearted));
            this.heart.disabled = !this.file || !f?.loaded || !group || Boolean(this.heartSaving);
            this.heart.title = `${hearted ? 'Remove from' : 'Add to'} ${group?.name || 'favourites'}`;
            this.heart.setAttribute('aria-label', this.heart.title);
        }
        select(index, focus = false) {
            if (index < 0 || index >= this.files.length) return false;
            if (index !== this.selected) { this.confirmCancel?.(); this.cancelLoad(); this.stopPreview(); if (this.config.mode !== 'loop') this.candidate = null; }
            this.selected = index;
            const page = Math.floor(index / PAGE_SIZE);
            if (this.page !== page) { this.page = page; this.render(); }
            this.name.textContent = this.file.name; this.name.title = this.file.relativePath;
            this.paintSelection();
            if (focus) {
                const cell = this.grid.querySelector(`[data-sample-index="${index}"]`);
                cell.focus({ preventScroll: true }); cell.scrollIntoView({ block: 'nearest' });
            }
            return true;
        }
        goPage(page) {
            if (page < 0 || page >= this.pages || page === this.page) return;
            this.cancelLoad(); this.stopPreview(); this.lastTap = null;
            this.page = page; this.selected = -1; this.name.textContent = 'Tap ▶ to audition';
            this.render(); this.scroller.scrollTop = 0; this.message('');
        }
        step(delta) {
            const index = this.selected < 0 ? (delta > 0 ? this.page * PAGE_SIZE : Math.min(this.files.length - 1, (this.page + 1) * PAGE_SIZE - 1)) : this.selected + delta;
            this.lastTap = null;
            if (this.select(index, true)) this.preview();
        }
        preview() {
            const file = this.file;
            if (!file) return;
            this.stopPreview();
            if (this.trackPreview.checked) {
                if (this.config.mode === 'loop') {
                    if (this.candidate) this.auditionCandidate();
                    else this.message('Select sources and Recut to preview in track');
                } else this.prepareCandidate();
                return;
            }
            this.previewFile = file;
            const serial = this.previewSerial, epoch = this.epoch;
            this.message('Auditioning…');
            const failed = error => {
                if (this.valid(epoch) && this.previewSerial === serial && error?.name !== 'AbortError') this.message('Tap ▶ again to audition this sample.', true);
            };
            if (/\.aiff?$/i.test(file.name) && this.adapter.decodedPreview) {
                this.decodedPreview = this.adapter.decodedPreview(file, playing => {
                    if (this.valid(epoch) && this.previewSerial === serial) {
                        this.playingKey = playing ? keyOf(file) : ''; this.paintSelection();
                    }
                });
                this.decodedPreview.play().catch(failed);
            } else {
                this.audio.src = this.adapter.previewUrl(file);
                // Synchronous trusted tap -> native streaming. No whole-file decode.
                const result = this.audio.play(); result?.catch(failed);
            }
        }
        async load({ togglePick = false } = {}) {
            const file = this.file;
            if (this.loading) return;
            if (this.config.mode === 'loop' && togglePick) {
                if (!file) return;
                this.invalidateCandidate();
                const index = this.picks.findIndex(pick => keyOf(pick) === keyOf(file));
                const remove = togglePick && index >= 0;
                if (remove) this.picks.splice(index, 1);
                else if (index < 0) {
                    if (this.picks.length >= 64) { this.message('Choose up to 64 source samples.', true); return; }
                    this.picks.push(file);
                }
                this.lastTap = null; this.paintPicks(); this.paintSelection();
                this.message(remove ? 'Removed from recut list' : 'Added to recut list');
                return;
            }
            if (this.config.mode !== 'loop' && !file || this.config.mode === 'loop' && !this.candidate) return;
            const epoch = this.epoch, controller = new AbortController(), config = this.config;
            this.loadController = controller; this.loading = true; this.paintSelection(); this.message('Preparing Add…');
            const guard = () => { this.guard(epoch, controller.signal); if (this.config !== config || this.config.mode !== 'loop' && this.file !== file) throw new DOMException('Selection changed.', 'AbortError'); };
            try {
                const candidate = config.mode === 'loop' ? this.candidate : this.candidate?.file === file ? this.candidate : await this.adapter.prepare(config, file, { signal: controller.signal, guard });
                guard();
                if (!await this.confirmReplacement()) { if (this.valid(epoch)) this.message(this.trackAuditionActive ? 'Preview in track · original retained' : 'Not added · original retained'); return; }
                guard();
                this.stopPreview();
                await this.adapter.commit(config, candidate, { signal: controller.signal, guard });
                guard(); this.loadedKey = file ? keyOf(file) : ''; this.candidate = null;
                this.clearResult(); this.message('Loaded · original replaced');
            } catch (error) {
                this.stopPreview();
                if (this.valid(epoch) && !controller.signal.aborted && error.name !== 'AbortError') this.message(`Not loaded: ${error.message}`, true);
            } finally {
                if (this.loadController === controller) { this.loadController = null; this.loading = false; this.paintSelection(); }
            }
        }
        confirmReplacement() {
            return new Promise(resolve => {
                const dialog = this.doc.createElement('dialog'); dialog.className = 'sample-grid-confirm';
                dialog.setAttribute('aria-label', 'Confirm loop replacement');
                const text = this.doc.createElement('p'); text.textContent = 'Are you sure? This will replace the current loop';
                const cancel = this.doc.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.autofocus = true;
                const add = this.doc.createElement('button'); add.type = 'button'; add.textContent = 'Add'; add.dataset.gridAction = 'confirm-add';
                const finish = ok => { if (this.confirmCancel !== abort) return; this.confirmCancel = null; dialog.close(); dialog.remove(); resolve(ok); };
                const abort = () => finish(false); this.confirmCancel = abort;
                cancel.onclick = abort; add.onclick = () => finish(true);
                dialog.addEventListener('cancel', event => { event.preventDefault(); abort(); });
                dialog.addEventListener('close', abort);
                dialog.append(text, cancel, add); this.doc.body.append(dialog); dialog.showModal(); cancel.focus();
            });
        }
        async prepareCandidate() {
            const file = this.file;
            if (!file) return;
            this.cancelLoad(); this.candidate = null;
            const epoch = this.epoch, controller = new AbortController();
            this.loadController = controller; this.loading = true; this.paintSelection(); this.message('Preparing track preview…');
            const guard = () => { this.guard(epoch, controller.signal); if (this.file !== file) throw new DOMException('Selection changed.', 'AbortError'); };
            try {
                const candidate = await this.adapter.prepare(this.config, file, { signal: controller.signal, guard });
                guard(); this.candidate = candidate;
                if (this.trackPreview.checked) this.auditionCandidate();
            } catch (error) {
                if (this.valid(epoch) && error.name !== 'AbortError') { this.stopPreview(); this.message(`Preview unavailable: ${error.message}`, true); }
            } finally {
                if (this.loadController === controller) { this.loadController = null; this.loading = false; this.paintSelection(); }
            }
        }
        auditionCandidate() {
            if (!this.candidate || !this.trackPreview.checked || this.overlay.hidden) return;
            try { this.adapter.setPreview(this.config, this.candidate); this.trackAuditionActive = true; this.message('Preview in track · original retained · Add to replace'); }
            catch (error) { this.adapter.setPreview(this.config, null); this.message(error.message, true); }
        }
        invalidateCandidate() { this.stopPreview(); this.candidate = null; this.clearResult(); }
        paintPicks() {
            this.pickedList.replaceChildren();
            if (!this.picks?.length) { this.pickedList.textContent = 'Double tap samples to add them here'; return; }
            for (const file of this.picks) {
                const item = this.doc.createElement('button'); item.type = 'button'; item.className = 'sample-grid-pick';
                item.textContent = file.name + ' ×'; item.title = `Remove ${file.relativePath}`;
                item.setAttribute('aria-label', `Remove ${file.name} from recut list`);
                item.addEventListener('click', () => {
                    this.invalidateCandidate(); this.cancelLoad(); this.picks = this.picks.filter(pick => keyOf(pick) !== keyOf(file)); this.paintPicks(); this.paintSelection();
                }); this.pickedList.append(item);
            }
        }
        paintDivisions() {
            this.divisions.replaceChildren();
            if (this.config.mode !== 'loop') return;
            const selected = new Set(this.pendingDivisions);
            for (const { value, label: caption } of this.config.divisionOptions) {
                const label = this.doc.createElement('label'), input = this.doc.createElement('input'); input.type = 'checkbox';
                input.value = value; input.checked = selected.has(value); input.setAttribute('aria-label', `Cut ${value}`);
                input.addEventListener('change', () => {
                    this.invalidateCandidate(); this.cancelLoad();
                    let values = [...this.divisions.querySelectorAll('input:checked')].map(input => input.value);
                    if (input.checked && value === 'uncut') values = ['uncut'];
                    else if (input.checked) values = values.filter(value => value !== 'uncut');
                    if (!values.length) values = [value];
                    this.pendingDivisions = values; this.paintDivisions(); this.paintSelection();
                }); label.append(input, this.doc.createTextNode(caption || value)); this.divisions.append(label);
            }
        }
        clearResult() {
            if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
            this.resultUrl = null; this.resultBuffer = null;
        }
        playResult() {
            if (this.resultPlaying) { this.stopPreview(); return; }
            const buffer = this.candidate?.buffer || this.adapter.resultBuffer?.(this.config);
            if (!buffer) return;
            this.stopPreview();
            if (this.resultBuffer !== buffer) {
                this.clearResult(); this.resultBuffer = buffer;
                this.resultUrl = URL.createObjectURL(this.adapter.resultBlob(buffer));
            }
            this.audio.src = this.resultUrl; this.audio.loop = true; this.resultPlaying = true;
            const epoch = this.epoch, serial = this.previewSerial;
            this.audio.play()?.catch(() => {
                if (this.valid(epoch) && serial === this.previewSerial) { this.resultPlaying = false; this.resultButton.textContent = '▶ Play loop'; this.message('Loop ready. Tap Play loop to audition.'); }
            });
        }
        async recut() {
            if (!this.picks?.length || this.loading) return;
            this.invalidateCandidate(); const epoch = this.epoch, config = this.config;
            const files = this.picks.slice(), controller = new AbortController();
            this.loadController = controller; this.loading = true; this.paintSelection(); this.message('Recutting selected samples…');
            const guard = () => this.guard(epoch, controller.signal);
            try {
                const candidate = await this.adapter.recut(config, files, { signal: controller.signal, guard, divisions: this.pendingDivisions.slice() });
                guard(); this.candidate = candidate; this.clearResult(); this.paintSelection();
                if (this.trackPreview.checked) this.auditionCandidate();
                else this.message('Recut ready · original retained · Preview or Play loop to audition · Add to replace');
            } catch (error) {
                if (this.valid(epoch) && error.name !== 'AbortError') { this.stopPreview(); this.message(`Recut failed: ${error.message}`, true); }
            } finally {
                if (this.loadController === controller) { this.loadController = null; this.loading = false; this.paintSelection(); }
            }
        }
        async toggleHeart() {
            const file = this.file, f = this.adapter.favourites, group = f?.group('samples');
            if (!file || !f?.loaded || !group || this.heartSaving) return;
            const epoch = this.epoch;
            this.heartSaving = true; this.paintSelection();
            const ok = await f.change('samples', { operation: 'set', groupId: group.id, key: keyOf(file), name: file.name, selected: !Object.hasOwn(group.items, keyOf(file)) });
            this.heartSaving = false;
            if (this.valid(epoch)) { this.paintSelection(); this.message(ok ? 'Heart saved' : 'Heart not saved. Try again.', !ok); }
        }
        keydown(event) {
            if (this.confirmCancel) return;
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); return; }
            if (event.key === 'Tab') {
                const items = [...this.overlay.querySelectorAll('button:not(:disabled), select:not(:disabled), input:not(:disabled)')].filter(e => e.tabIndex >= 0 && e.getClientRects().length);
                const first = items[0], last = items.at(-1);
                if (event.shiftKey && this.doc.activeElement === first) { event.preventDefault(); last?.focus(); }
                if (!event.shiftKey && this.doc.activeElement === last) { event.preventDefault(); first?.focus(); }
                return;
            }
            if (event.target.matches('select, input, textarea') || event.altKey || event.ctrlKey || event.metaKey) return;
            const columns = getComputedStyle(this.grid).gridTemplateColumns.split(' ').length;
            const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key];
            if (delta !== undefined) { event.preventDefault(); event.stopPropagation(); this.step(delta); }
            else if (event.key === 'Enter' && event.target.closest('[data-sample-index]')) { event.preventDefault(); this.load(); }
            else if (event.key === ' ' && event.target.closest('[data-sample-index]')) { event.preventDefault(); this.lastTap = null; this.preview(); }
        }
    }
    return { Browser, PAGE_SIZE, shuffle, keyOf };
});
