(function (root) {
    'use strict';
    const STORAGE_KEY = 'mygrain-q-custom-chords-v1';
    const theory = root.MygrainQTheory || (typeof require === 'function' ? require('./q-theory.js') : null);
    function chordNotes(notes) {
        if (!Array.isArray(notes) || !notes.length || notes.length > 8 || notes.some(n => !Number.isInteger(n) || n < 21 || n > 108)) throw new Error('Choose 1–8 notes in Q’s A0–C8 range.');
        return [...new Set(notes)].sort((a, b) => a - b);
    }
    function readPool(storage) {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw === null) return [];
        const value = JSON.parse(raw);
        if (value?.version !== 1 || !Array.isArray(value.chords) || value.chords.length > 512) throw new Error('The saved custom chord pool could not be read. Its stored data has not been changed.');
        const ids = new Set();
        return value.chords.map(item => {
            if (!item || typeof item.id !== 'string' || !/^[\w-]{1,80}$/.test(item.id) || ids.has(item.id)) throw new Error('Invalid saved custom chord. Its stored data has not been changed.');
            ids.add(item.id);
            const colour = Number.isInteger(item.colour) && item.colour >= 0 && item.colour < 3600 ? item.colour : [...item.id].reduce((h,c) => (h * 31 + c.charCodeAt(0)) % 3600, 0);
            return { id: item.id, notes: chordNotes(item.notes), colour };
        });
    }
    function writePool(storage, chords) { storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, chords })); }
    class Capture {
        constructor() { this.clear(); }
        clear() { this.held = new Set(); this.sustained = new Set(); this.pedals = new Set(); this.notes = []; this.error = ''; }
        receive(data) {
            if (!data || data.length < 3) return false;
            const [status, note, velocity] = data;
            if (![status, note, velocity].every(Number.isInteger) || status < 128 || status > 239 || note < 0 || note > 127 || velocity < 0 || velocity > 127) return false;
            const channel = status & 15, command = status & 240, key = `${channel}:${note}`;
            if (command === 176) {
                if (note === 64) {
                    if (velocity >= 64) this.pedals.add(channel);
                    else { this.pedals.delete(channel); for (const k of this.sustained) if (k.startsWith(channel + ':')) this.sustained.delete(k); }
                } else if (note === 120 || note === 123) {
                    for (const set of [this.held, this.sustained]) for (const k of set) if (k.startsWith(channel + ':')) set.delete(k);
                    this.pedals.delete(channel);
                }
                return note === 64 || note === 120 || note === 123;
            }
            if (command !== 128 && command !== 144) return false;
            if (command === 144 && velocity > 0) {
                if (!this.held.size && !this.sustained.size) { this.notes = []; this.error = ''; }
                this.held.add(key); this.sustained.delete(key);
                if (note < 21 || note > 108) this.error = 'That note is outside Q’s A0–C8 range. Clear and play a chord in range.';
                else this.notes = [...new Set([...this.notes, note])].sort((a, b) => a - b);
                if (this.notes.length > 8) this.error = 'Q supports up to 8 distinct notes. Clear and play a smaller chord.';
            } else {
                if (this.held.delete(key) && this.pedals.has(channel)) this.sustained.add(key);
            }
            return true;
        }
        valid() { return !this.error && this.notes.length > 0 && this.notes.length <= 8; }
    }
    const api = { STORAGE_KEY, Capture, chordNotes, readPool, writePool };
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (!root.document || root.__mygrainSongRenderDeck || !root.mygrainQ || !theory) return;
    const document = root.document, q = root.mygrainQ, source = document.getElementById('bastardLoopQPoolFromScaleBtn');
    if (!source) return;
    const button = (text, id) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; if (id) b.id = id; return b; };
    const opener = button('Custom from MIDI', 'qCustomChordOpen'); opener.className = 'performance-btn'; source.after(opener);
    const palette = document.getElementById('bastardLoopQPalette'), pools = document.createElement('div'); pools.className = 'q-candidate-pools';
    palette.before(pools); pools.append(palette);
    const custom = document.createElement('section'); custom.id = 'qCustomChordPool'; custom.setAttribute('aria-label', 'Saved custom chord candidates');
    const heading = document.createElement('h4'); heading.textContent = 'Custom chords';
    const list = document.createElement('div'); list.id = 'qCustomChordList';
    const message = document.createElement('p'); message.className = 'q-custom-help'; message.setAttribute('role', 'status');
    const keep = button('Keep selected', 'qCustomChordKeep'); keep.title = 'Keep the selected chord’s exact notes in the custom holding area';
    custom.append(heading, list, message); pools.append(custom);
    const tools = document.querySelector('#qMobileRightPanel .q-mobile-panel-content');
    if (tools) tools.prepend(keep); else custom.insertBefore(keep, list);
    const dialog = document.createElement('dialog'); dialog.id = 'qCustomChordDialog'; dialog.setAttribute('aria-labelledby', 'qCustomChordTitle');
    dialog.innerHTML = '<header><h3 id="qCustomChordTitle">Create custom chord from MIDI</h3><button type="button" id="qCustomChordClose">Close</button></header><p>Play a chord together on your MIDI keyboard. Release the keys: the captured chord stays visible. Playing a new chord replaces the capture, not your saved pool.</p><div class="q-custom-midi"><label for="qCustomChordInput">MIDI input</label><select id="qCustomChordInput" aria-label="MIDI keyboard for custom chord"></select><button type="button" id="qCustomChordConnect">Connect MIDI keyboard</button><span id="qCustomMidiStatus" role="status"></span></div><h4 id="qCustomChordName">Play a chord…</h4><div id="qCustomChordVisual" aria-label="Captured chord keyboard"></div><p id="qCustomChordNotes"></p><p id="qCustomChordStatus" role="status" aria-live="polite"></p><footer><button type="button" id="qCustomChordClear">Clear capture</button><button type="button" id="qCustomChordSave" disabled>Save custom chord</button></footer>';
    document.body.append(dialog);
    const get = id => document.getElementById(id), capture = new Capture(); let pool = [], locked = false;
    function load() {
        try { pool = readPool(root.localStorage); message.textContent = pool.length ? 'Tap to play / record in Q. Saved here until you delete them.' : 'Drag chords here, or use Keep selected / Custom from MIDI. Held notes ignore pitch controls.'; }
        catch (error) { message.textContent = error.message; }
        renderPool();
    }
    function renderPool() {
        list.replaceChildren();
        for (const chord of pool) {
            const tile = document.createElement('div'); tile.className = 'q-custom-chord-tile'; tile.dataset.customId = chord.id; tile.style.setProperty('--q-custom-colour', theory.customColour(chord.colour));
            const play = button(''); play.className = 'q-custom-chord-play'; play.draggable = true; play.disabled = locked;
            const candidate = chord.notes.slice();
            const name = document.createElement('strong'); name.textContent = theory.identifyChord(candidate).name;
            const label = document.createElement('span'); label.textContent = 'Custom';
            const notes = document.createElement('span'); notes.textContent = candidate.map(theory.noteName).join(' · ');
            play.append(name, label); play.title = 'Play / record these fixed notes; global candidate pitch controls do not change them';
            play.addEventListener('click', () => { if (!locked) q.task(() => q.playChord(placementChord(chord))); });
            const remove = button('Delete'); remove.className = 'q-custom-chord-delete'; remove.setAttribute('aria-label', 'Delete custom chord ' + name.textContent); remove.disabled = locked;
            remove.addEventListener('click', () => {
                try { if (locked) return; const next = readPool(root.localStorage).filter(item => item.id !== chord.id); writePool(root.localStorage, next); pool = next; renderPool(); message.textContent = 'Custom chord deleted.'; }
                catch (error) { message.textContent = 'Could not delete: ' + error.message; }
            });
            tile.append(play, remove); list.append(tile);
        }
    }
    // A library tile is a source, never the editable owner of a new sequence cell.
    // Keep its swatch while placing; explicit Save allocates a fresh pool swatch.
    function placementChord(chord) {
        return { ...theory.identifyChord(chord.notes), notes: chord.notes.slice(), customChord: true,
            customChordId: root.crypto.randomUUID(), customChordColour: chord.colour };
    }
    function placeInCell(chord, index) {
        if (locked || root.mygrainCardHistory?.busy || q.chordEditor?.opened) throw new Error('Finish the current edit before placing a chord.');
        if (!Number.isInteger(index) || index < 0 || index >= q.length()) return;
        const edit = () => {
            const step = theory.normalizeStep({ ...placementChord(chord), velocity: q.state.velocity, gate: q.state.gate });
            q.state.sequence[index] = step; q.state.selection = theory.copy(step); q.cursor = index;
            q.changed({ live: true });
        };
        if (root.mygrainCardHistory) root.mygrainCardHistory.run('Q place custom chord', edit); else edit();
        q.status('Custom chord copied here. Edit and Save to create a new holding entry.');
    }
    const grid = document.getElementById('bastardLoopQStepGrid');
    let poolDrag = null;
    const sourceChord = target => pool.find(chord => chord.id === target.closest('.q-custom-chord-tile')?.dataset.customId);
    list.addEventListener('dragstart', event => {
        poolDrag = event.target.closest('.q-custom-chord-play') && !locked ? sourceChord(event.target) : null;
        if (!poolDrag) { event.preventDefault(); return; }
        event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('application/x-mygrain-q-pool', 'internal');
    });
    list.addEventListener('dragend', () => { poolDrag = null; });
    grid.addEventListener('dragover', event => { if (poolDrag && event.target.closest('[data-q-step]')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
    grid.addEventListener('drop', event => {
        const cell = event.target.closest('[data-q-step]');
        if (!poolDrag || !cell) return;
        event.preventDefault(); const chord = poolDrag; poolDrag = null;
        try { placeInCell(chord, Number(cell.dataset.qStep)); } catch (error) { q.status(error.message, true); }
    });
    let poolTouch = null, suppressPoolClickUntil = 0;
    function finishPoolTouch() {
        if (!poolTouch) return;
        clearTimeout(poolTouch.timer); poolTouch.ghost?.remove(); poolTouch.node.draggable = true;
        try { poolTouch.node.releasePointerCapture(poolTouch.id); } catch (_) {}
        poolTouch = null;
    }
    list.addEventListener('pointerdown', event => {
        if (event.pointerType !== 'touch' || locked || !event.target.closest('.q-custom-chord-play')) return;
        const chord = sourceChord(event.target); if (!chord) return;
        finishPoolTouch();
        poolTouch = { id: event.pointerId, node: event.target.closest('.q-custom-chord-play'), chord, x: event.clientX, y: event.clientY, active: false };
        poolTouch.node.draggable = false;
        try { poolTouch.node.setPointerCapture(poolTouch.id); } catch (_) {}
        poolTouch.timer = setTimeout(() => {
            if (!poolTouch) return;
            poolTouch.active = true;
            const ghost = document.createElement('div'); ghost.className = 'q-custom-drag-ghost'; ghost.textContent = theory.identifyChord(chord.notes).name + ' → step';
            ghost.style.left = poolTouch.x + 'px'; ghost.style.top = poolTouch.y + 'px'; document.body.append(ghost); poolTouch.ghost = ghost;
            try { poolTouch.node.setPointerCapture(poolTouch.id); } catch (_) {}
        }, 300);
    });
    list.addEventListener('pointermove', event => {
        if (!poolTouch || event.pointerId !== poolTouch.id) return;
        if (!poolTouch.active && (poolTouch.scrolling || Math.hypot(event.clientX-poolTouch.x,event.clientY-poolTouch.y)>10)) {
            clearTimeout(poolTouch.timer); poolTouch.scrolling = true;
            custom.scrollTop -= event.clientY - (poolTouch.lastY ?? poolTouch.y); poolTouch.lastY = event.clientY;
            event.preventDefault(); return;
        }
        if (poolTouch.active) { event.preventDefault(); poolTouch.ghost.style.left=event.clientX+'px'; poolTouch.ghost.style.top=event.clientY+'px'; }
    }, { passive:false });
    list.addEventListener('pointerup', event => {
        if (!poolTouch || event.pointerId !== poolTouch.id) return;
        if (poolTouch.scrolling) suppressPoolClickUntil = Date.now()+700;
        if (poolTouch.active) {
            suppressPoolClickUntil = Date.now()+700;
            const cell = document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-q-step]');
            if (cell && grid.contains(cell)) try { placeInCell(poolTouch.chord,Number(cell.dataset.qStep)); } catch(error) { q.status(error.message,true); }
        }
        finishPoolTouch();
    });
    list.addEventListener('pointercancel', finishPoolTouch);
    list.addEventListener('click', event => { if (Date.now()<suppressPoolClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); } },true);
    root.addEventListener('pagehide', finishPoolTouch);
    root.addEventListener('mygrain-account-lock', finishPoolTouch);
    document.getElementById('bastardLoopQCloseBtn').addEventListener('click', finishPoolTouch);
    function visualise() {
        const container = get('qCustomChordVisual'); container.replaceChildren();
        const notes = capture.notes, low = notes.length ? Math.max(21, Math.floor(notes[0] / 12) * 12) : 48, high = notes.length ? Math.min(108, Math.ceil((notes.at(-1) + 1) / 12) * 12) : 72;
        const white = []; for (let n = low; n <= high; n++) if (![1, 3, 6, 8, 10].includes(n % 12)) white.push(n);
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', `0 0 ${white.length * 32} 130`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', notes.length ? notes.map(theory.noteName).join(', ') : 'Play a MIDI chord to see its notes');
        const key = (n, x, black) => {
            const rect = document.createElementNS(svg.namespaceURI, 'rect'); rect.setAttribute('x', x); rect.setAttribute('y', '0'); rect.setAttribute('width', black ? '19' : '31'); rect.setAttribute('height', black ? '78' : '125'); rect.setAttribute('rx', '2'); rect.setAttribute('fill', notes.includes(n) ? '#5ee0a5' : black ? '#172126' : '#f0f5f2'); rect.setAttribute('stroke', '#152d23'); rect.dataset.midi = n; rect.dataset.captured = String(notes.includes(n)); svg.append(rect);
            if (notes.includes(n) || (!black && n % 12 === 0)) { const text = document.createElementNS(svg.namespaceURI, 'text'); text.setAttribute('x', x + (black ? 9 : 15)); text.setAttribute('y', black ? '66' : '115'); text.setAttribute('text-anchor', 'middle'); text.setAttribute('font-size', '10'); text.setAttribute('fill', '#102a1d'); text.textContent = theory.noteName(n); svg.append(text); }
        };
        white.forEach((n, i) => key(n, i * 32, false));
        for (let n = low; n <= high; n++) if ([1, 3, 6, 8, 10].includes(n % 12)) { const previous = white.findIndex(w => w === n - 1); if (previous >= 0) key(n, (previous + 1) * 32 - 10, true); }
        container.append(svg);
        get('qCustomChordName').textContent = notes.length ? theory.identifyChord(notes).name + ' · estimated' : 'Play a chord…';
        get('qCustomChordNotes').textContent = notes.map(theory.noteName).join(' · ');
        get('qCustomChordStatus').textContent = capture.error || (notes.length ? 'Captured. Save adds these exact notes to your custom pool.' : 'Waiting for MIDI notes. Use your connected keyboard; Q supports 1–8 notes, A0–C8.');
        get('qCustomChordSave').disabled = locked || !capture.valid();
    }
    function syncMidi() {
        const original = get('performanceMidiInputSelect'), select = get('qCustomChordInput');
        if (original) {
            const options = [...original.options].map(o => [o.value, o.textContent]);
            if (select.dataset.options !== JSON.stringify(options)) { select.replaceChildren(...options.map(([value, text]) => { const o = document.createElement('option'); o.value = value; o.textContent = text; return o; })); select.dataset.options = JSON.stringify(options); }
            select.value = original.value; select.disabled = original.disabled;
        }
        get('qCustomMidiStatus').textContent = get('performanceMidiInputStatus')?.textContent || 'Choose a connected MIDI keyboard.';
    }
    const midiObserver = new MutationObserver(() => { if (dialog.open) { capture.held.clear(); capture.sustained.clear(); capture.pedals.clear(); syncMidi(); } });
    for (const id of ['performanceMidiInputSelect', 'performanceMidiInputStatus']) if (get(id)) midiObserver.observe(get(id), { childList: true, subtree: true, characterData: true });
    function close() { if (dialog.open) dialog.close(); capture.clear(); }
    opener.addEventListener('click', () => { if (locked) return; capture.clear(); syncMidi(); visualise(); dialog.showModal(); });
    get('qCustomChordClose').addEventListener('click', close);
    dialog.addEventListener('close', () => { capture.clear(); opener.focus({ preventScroll: true }); });
    dialog.addEventListener('keydown', event => event.stopPropagation()); dialog.addEventListener('keyup', event => event.stopPropagation());
    get('qCustomChordClear').addEventListener('click', () => { capture.clear(); visualise(); });
    get('qCustomChordInput').addEventListener('change', () => { capture.clear(); visualise(); const original = get('performanceMidiInputSelect'); if (original) { original.value = get('qCustomChordInput').value; original.dispatchEvent(new Event('change', { bubbles: true })); } });
    get('qCustomChordConnect').addEventListener('click', async () => {
        try {
            await root.mygrainMidiKeyboardInput?.refresh();
            syncMidi(); const select = get('qCustomChordInput');
            if (!select.value && select.options.length === 2) { select.value = select.options[1].value; select.dispatchEvent(new Event('change', { bubbles: true })); }
            if (typeof navigator.requestMIDIAccess !== 'function') get('qCustomMidiStatus').textContent = 'Web MIDI is unavailable in this browser. Use a browser with MIDI input support.';
        } catch (error) { get('qCustomMidiStatus').textContent = 'MIDI connection failed: ' + error.message; }
    });
    function saveInstance(notes, id, colour) {
        if (locked) throw new Error('Unlock your account before adding chords.');
        const exact = chordNotes(notes), next = readPool(root.localStorage);
        const existing = typeof id === 'string' && /^[\w-]{1,80}$/.test(id) ? next.find(c => c.id === id) : null;
        if (!existing && next.length >= 512) throw new Error('The custom pool is full (512). Delete a chord before adding another.');
        if (existing) existing.notes = exact;
        else {
            const used = new Set(next.map(c => c.colour));
            let chosen = Number.isInteger(colour) && colour >= 0 && colour < 3600 ? colour : ((next.at(-1)?.colour ?? -1375) + 1375) % 3600;
            if (used.has(chosen)) chosen = ((next.at(-1)?.colour ?? 0) + 1375) % 3600;
            while (used.has(chosen)) chosen = (chosen + 1) % 3600;
            next.push({ id: typeof id === 'string' && /^[\w-]{1,80}$/.test(id) ? id : root.crypto.randomUUID(), notes: exact, colour: chosen });
        }
        const chord = existing || next.at(-1);
        writePool(root.localStorage, next); pool = next; renderPool();
        message.textContent = existing ? 'Custom chord updated.' : 'Custom chord saved. Its colour matches the sequencer.';
        return { customChord: true, customChordId: chord.id, customChordColour: chord.colour };
    }
    function addChord(notes) { return saveInstance(notes).customChordId; }
    keep.addEventListener('click', () => {
        try { if (!q.state.selection?.notes?.length) throw new Error('Select a chord first, then Keep selected.'); addChord(q.state.selection.notes); }
        catch (error) { message.textContent = error.message; }
    });
    get('qCustomChordSave').addEventListener('click', () => {
        try { if (locked || !capture.valid()) return; addChord(capture.notes); close(); }
        catch (error) { get('qCustomChordStatus').textContent = 'Could not save: ' + error.message; }
    });

    // Native desktop drag snapshots the already-transposed displayed pitches.
    // Never accept external drag data or reconstruct notes from global controls.
    let dragged = null;
    function notesFromTile(target) {
        const tile = target.closest('[data-q-degree]');
        if (!tile || !palette.contains(tile)) return null;
        return chordNotes(tile.dataset.notes.split(',').map(Number));
    }
    function makeDraggable() { for (const tile of palette.querySelectorAll('[data-q-degree]')) tile.draggable = true; }
    new MutationObserver(makeDraggable).observe(palette, { childList: true }); makeDraggable();
    palette.addEventListener('dragstart', event => {
        try { dragged = notesFromTile(event.target); if (!dragged || locked) { event.preventDefault(); return; } event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('application/x-mygrain-q-chord', 'internal'); custom.classList.add('q-custom-drop-ready'); }
        catch (_) { event.preventDefault(); dragged = null; }
    });
    palette.addEventListener('dragend', () => { dragged = null; custom.classList.remove('q-custom-drop-ready'); });
    custom.addEventListener('dragover', event => { if (dragged && !locked) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
    custom.addEventListener('drop', event => {
        if (!dragged || locked) return;
        event.preventDefault(); try { addChord(dragged); } catch (error) { message.textContent = error.message; }
        dragged = null; custom.classList.remove('q-custom-drop-ready');
    });

    // iPhone: hold, or drag horizontally. Vertical swipes still scroll candidates.
    let touch = null, suppressClickUntil = 0;
    function finishTouch() {
        if (!touch) return;
        clearTimeout(touch.timer); touch.ghost?.remove();
        try { touch.tile.releasePointerCapture(touch.id); } catch (_) {}
        touch = null; custom.classList.remove('q-custom-drop-ready');
    }
    function activateTouch() {
        if (!touch || locked || touch.active) return;
        touch.active = true;
        const ghost = document.createElement('div'); ghost.className = 'q-custom-drag-ghost'; ghost.textContent = theory.identifyChord(touch.notes).name + ' → custom';
        ghost.style.left = touch.x + 'px'; ghost.style.top = touch.y + 'px'; document.body.append(ghost); touch.ghost = ghost;
        try { touch.tile.setPointerCapture(touch.id); } catch (_) {}
        custom.classList.add('q-custom-drop-ready');
    }
    palette.addEventListener('pointerdown', event => {
        if (event.pointerType !== 'touch' || locked) return;
        const notes = notesFromTile(event.target); if (!notes) return;
        finishTouch(); touch = { id: event.pointerId, x: event.clientX, y: event.clientY, notes, tile: event.target.closest('[data-q-degree]'), active: false };
        touch.timer = setTimeout(activateTouch, 300);
    });
    palette.addEventListener('pointermove', event => {
        if (!touch || touch.id !== event.pointerId) return;
        const dx = Math.abs(event.clientX - touch.x), dy = Math.abs(event.clientY - touch.y);
        if (!touch.active && dy > 10 && dy > dx) { finishTouch(); return; }
        if (!touch.active && dx > 10 && dx > dy) activateTouch();
        if (touch?.active) { event.preventDefault(); touch.ghost.style.left = event.clientX + 'px'; touch.ghost.style.top = event.clientY + 'px'; }
    }, { passive: false });
    palette.addEventListener('pointerup', event => {
        if (!touch || touch.id !== event.pointerId) return;
        if (touch.active) {
            suppressClickUntil = Date.now() + 700;
            const box = custom.getBoundingClientRect();
            if (event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom) {
                try { addChord(touch.notes); } catch (error) { message.textContent = error.message; }
            }
        }
        finishTouch();
    });
    palette.addEventListener('pointercancel', finishTouch);
    document.getElementById('bastardLoopQCloseBtn').addEventListener('click', finishTouch);
    root.addEventListener('pagehide', finishTouch);
    palette.addEventListener('click', event => { if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    root.addEventListener('mygrain-q-palette-change', () => { finishTouch(); });
    root.addEventListener('storage', event => { if (event.key === null || event.key === STORAGE_KEY || event.key?.endsWith(':' + STORAGE_KEY)) load(); });
    root.addEventListener('mygrain-account-lock', () => { locked = true; finishTouch(); close(); opener.disabled = true; keep.disabled = true; renderPool(); });
    root.mygrainQCustomChords = Object.freeze({ addChord, saveInstance, getEntries() { return pool.map(chord => ({...chord, notes: chord.notes.slice()})); }, getNotes() { return pool.map(chord => chord.notes.slice()); }, captureMidi(data) { try { if (!locked && dialog.open && capture.receive(data)) visualise(); } catch (error) { get('qCustomChordStatus').textContent = 'Capture error: ' + error.message; } }, close });
    load();
})(typeof window === 'object' ? window : globalThis);
