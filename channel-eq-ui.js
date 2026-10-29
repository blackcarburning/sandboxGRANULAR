(function () {
    'use strict';
    if (window.__mygrainSongRenderDeck) return;
    const dsp = window.MygrainChannelEq, runtime = window.mygrainChannelEq;
    if (!dsp || !runtime) throw new Error('Channel EQ could not load. Reload MYGRAIN.');
    const automation = window.mygrainEqAutomation;
    const colours = ['#f1a25c', '#e9d65b', '#7bd8a1', '#81b7ff'];
    const names = Object.fromEntries(dsp.KEYS.map(key => [key, key.startsWith('drum') ? ({ drumRoll: 'Snare Roll', drumEtc: 'ETC', drumCymbals: 'Crash / Cymbals' }[key] || key.slice(4)) : key.startsWith('K') ? `K track ${key.slice(1)}` : key === 'generated' ? 'Generated Loop' : key === 'sample' ? 'Sample Layer' : `Loop ${key}`]));
    const typeNames = { bell: 'Bell', lowshelf: 'Low Shelf', highshelf: 'High Shelf', highpass: 'Low Cut', lowpass: 'High Cut' };
    const dialog = document.createElement('dialog'); dialog.id = 'channelEqDialog'; dialog.setAttribute('aria-labelledby', 'channelEqTitle');
    const x = f => 45 + Math.log(Math.max(20, Math.min(20000, f)) / 20) / Math.log(1000) * 837;
    const y = gain => 20 + (24 - Math.max(-24, Math.min(24, gain))) / 48 * 282;
    const grid = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].map(f => `<line x1="${x(f)}" x2="${x(f)}" y1="20" y2="302"/><text x="${x(f)}" y="322" text-anchor="middle">${f >= 1000 ? f / 1000 + 'k' : f}</text>`).join('')
        + [-24, -12, 0, 12, 24].map(db => `<line x1="45" x2="882" y1="${y(db)}" y2="${y(db)}"/><text x="37" y="${y(db) + 4}" text-anchor="end">${db > 0 ? '+' : ''}${db}</text>`).join('');
    dialog.innerHTML = `<header class="ceq-head"><h2 id="channelEqTitle">Channel EQ</h2><label class="channel-eq-switch"><input type="checkbox" id="channelEqEnabled"> EQ On</label><button type="button" class="ceq-action" id="channelEqReset">Reset</button><button type="button" class="ceq-action" id="channelEqClose">Close</button></header>
        <div class="ceq-body"><div id="channelEqAutomation" class="ceq-automation" hidden></div><div class="ceq-graph" aria-label="EQ response graph. Drag band handles horizontally for frequency and vertically for boost or cut."><svg viewBox="0 0 900 330" preserveAspectRatio="none" aria-hidden="true"><path class="ceq-spectrum"/><g class="ceq-grid">${grid}</g><path class="ceq-preview"/><path class="ceq-response"/></svg>${colours.map((colour, i) => `<button type="button" class="ceq-handle" data-eq-handle="${i}" style="--ceq-band:${colour}" aria-label="Band ${i + 1}">${i + 1}</button>`).join('')}</div>
        <p class="ceq-caption">20 Hz–20 kHz · ±24 dB. Drag a handle for frequency and gain; use each band’s Q slider or scroll over its handle for Q (Shift = fine). Arrow keys edit; Shift + Up/Down edits Q. Shelves have resonant Q; Low/High Cut offers 12–96 dB/oct.</p>
        <div class="ceq-bands">${colours.map((colour, i) => `<section class="ceq-band" data-eq-band="${i}" style="--ceq-band:${colour}"><div class="ceq-band-header"><strong>Band ${i + 1}</strong><label class="channel-eq-switch"><input type="checkbox" data-eq-field="enabled" aria-label="Band ${i + 1} on"> On</label></div><label class="ceq-field">Shape<select data-eq-field="type" aria-label="Band ${i + 1} shape">${Object.entries(typeNames).map(([value, name]) => `<option value="${value}">${name}</option>`).join('')}</select></label><label class="ceq-field">Hz<input type="number" data-eq-field="frequency" min="20" max="20000" step="1" aria-label="Band ${i + 1} frequency"></label><label class="ceq-field">dB<input type="number" data-eq-field="gain" min="-24" max="24" step="0.1" aria-label="Band ${i + 1} gain"></label><label class="ceq-field">Q<input type="number" data-eq-field="q" min="0.1" max="18" step="0.01" aria-label="Band ${i + 1} Q"></label><input class="ceq-q-slider" type="range" min="0" max="1000" step="1" data-eq-q-slider="${i}" aria-label="Band ${i + 1} Q slider" aria-valuetext="Q 0.71"><label class="ceq-field">dB/oct<select data-eq-field="slope" aria-label="Band ${i + 1} cut slope">${dsp.SLOPES.map(value => `<option value="${value}">${value}</option>`).join('')}</select></label></section>`).join('')}</div>
        <p class="ceq-status" id="channelEqStatus" role="status" aria-live="polite"></p><p class="ceq-caption">The shaded trace is this channel’s post-EQ output spectrum (−100 to 0 dBFS, louder of L/R), not the whole mix. Bypass uses no EQ filters or analyser. Closing stops the spectrum, but keeps an enabled EQ sounding.</p></div>`;
    document.body.append(dialog);
    let key = null, selected = 0, frame = null, lastDraw = 0, drag = null, opener = null, disposed = false;
    const graph = dialog.querySelector('.ceq-graph'), handles = [...dialog.querySelectorAll('[data-eq-handle]')];
    const entries = [];
    function mount(parent, channelKey) {
        if (!parent) throw new Error(`EQ controls could not find ${channelKey}.`);
        const row = document.createElement('div'); row.className = 'channel-eq-entry'; row.dataset.eqChannel = channelKey;
        row.innerHTML = `<button type="button" class="performance-btn" data-eq-open="${channelKey}">4-band EQ</button><label class="channel-eq-switch"><input type="checkbox" data-eq-on="${channelKey}" aria-label="${names[channelKey]} EQ on"> EQ On</label>`;
        parent.append(row); entries.push(row);
        if (['X', 'L'].includes(channelKey)) mountAutomation(row, channelKey);
        row.querySelector('button').addEventListener('click', event => open(channelKey, event.currentTarget));
        row.querySelector('input').addEventListener('change', event => { const enabled = event.currentTarget.checked; edit(channelKey, value => { value.enabled = enabled; }); });
    }
    for (const channelKey of ['A', 'B', 'C', 'V', 'W', 'P', 'O', 'L', 'X', 'Q', 'M', 'M+']) {
        const selector = channelKey === 'Q' ? '#bastardLoopQCard' : `[aria-label="Bastardloop${channelKey === 'A' ? '' : ' ' + channelKey} controls"]`;
        const card = document.querySelector(selector);
        mount(card?.querySelector('.performance-feature-head, .q-header') || card, channelKey);
    }
    mount(document.querySelector('[aria-label="Dropbox sample layer controls"]'), 'sample');
    mount(document.getElementById('generatedWaveformEditor'), 'generated');
    for (let i = 0; i < 5; i++) mount(document.querySelector(`[data-k-track="${i}"] .k-track-heading`), `K${i + 1}`);
    for (const kind of ['kick', 'snare', 'hat', 'perc', 'clap', 'cymbals', 'etc', 'roll']) mount(document.querySelector(`#drumMachineLane-${kind} .drum-machine-track-actions`), 'drum' + kind[0].toUpperCase() + kind.slice(1));
    function mountAutomation(parent, channelKey) {
        const controls = document.createElement('span'); controls.className = 'ceq-automation'; controls.dataset.eqAutomation = channelKey;
        controls.innerHTML = `<button type="button" class="ceq-action ceq-read" data-eq-auto="read" aria-label="${channelKey} EQ automation Read" title="Read: play recorded EQ movements with this sequence" aria-pressed="false">R</button><button type="button" class="ceq-action ceq-write" data-eq-auto="write" aria-label="${channelKey} EQ automation Write" title="Write: record one complete sequence from its next start, then switch to Read" aria-pressed="false">W</button><button type="button" class="ceq-action" data-eq-auto="remove" aria-label="Delete ${channelKey} EQ automation">Delete automation</button><span class="ceq-auto-status" role="status"></span>`;
        parent.append(controls);
        controls.addEventListener('click', event => {
            const action = event.target.dataset.eqAuto; if (!action) return;
            try { assertEditable(); automation[action](channelKey); } catch (error) { status(error.message); }
            syncAutomation();
        });
    }
    function syncAutomation() {
        for (const controls of document.querySelectorAll('[data-eq-automation]')) {
            const info = automation.info(controls.dataset.eqAutomation);
            controls.querySelector('[data-eq-auto="read"]').setAttribute('aria-pressed', String(info.read));
            controls.querySelector('[data-eq-auto="read"]').disabled = !info.points;
            controls.querySelector('[data-eq-auto="write"]').setAttribute('aria-pressed', String(info.write));
            controls.dataset.recording = String(info.recording);
            controls.querySelector('[data-eq-auto="remove"]').disabled = !info.points && !info.write;
            controls.querySelector('.ceq-auto-status').textContent = info.message;
        }
    }
    automation.subscribe(syncAutomation);
    function status(message) { dialog.querySelector('#channelEqStatus').textContent = message; }
    function assertEditable() {
        if (window.mygrainCardHistory?.busy) throw new Error('Wait for the current sound change to finish.');
        if (window.mygrainSongBeta?.busy || window.mygrainSongBeta?.playing) throw new Error('Stop Song playback and finish preparation before editing EQ.');
        if (typeof stateSaveSuspended !== 'undefined' && stateSaveSuspended) throw new Error('Wait for the saved sounds to finish loading.');
    }
    async function edit(channelKey, update) {
        try {
            assertEditable();
            const apply = () => { const value = runtime.get(channelKey); update(value); runtime.set(channelKey, value); saveState(); };
            if (window.mygrainCardHistory) await window.mygrainCardHistory.runDraftEdit(`${names[channelKey]} EQ`, apply);
            else apply();
        } catch (error) { status(error.message); if (typeof setStatus === 'function') setStatus(error.message, 'error'); }
        sync();
    }
    function renderCurve() {
        if (!key) return;
        const value = runtime.get(key), rate = typeof audioContext !== 'undefined' && audioContext ? audioContext.sampleRate : 48000;
        const frequencies = Array.from({ length: 420 }, (_, i) => 20 * 1000 ** (i / 419));
        const curve = bypass => dsp.response(value, frequencies, rate, bypass).map((db, i) => `${i ? 'L' : 'M'}${x(frequencies[i]).toFixed(2)},${y(db).toFixed(2)}`).join('');
        dialog.querySelector('.ceq-response').setAttribute('d', curve(true));
        dialog.querySelector('.ceq-preview').setAttribute('d', value.enabled ? '' : curve(false));
        value.bands.forEach((band, i) => {
            const handle = handles[i], cut = ['lowpass', 'highpass'].includes(band.type);
            handle.style.left = `${x(band.frequency) / 9}%`; handle.style.top = `${y(cut ? 0 : band.gain) / 3.3}%`;
            handle.dataset.off = String(!band.enabled); handle.setAttribute('aria-pressed', String(selected === i));
            handle.setAttribute('aria-label', `Band ${i + 1}, ${typeNames[band.type]}, ${Math.round(band.frequency)} Hz, ${cut ? band.slope + ' dB per octave' : band.gain.toFixed(1) + ' dB'}, Q ${band.q.toFixed(2)}. Use arrows or drag.`);
        });
    }
    function sync() {
        if (disposed) return;
        for (const row of entries) row.querySelector('input').checked = runtime.get(row.dataset.eqChannel).enabled;
        if (!key || !dialog.open) return;
        const value = runtime.get(key);
        document.getElementById('channelEqTitle').textContent = `${names[key]} · Channel EQ`;
        document.getElementById('channelEqEnabled').checked = value.enabled;
        for (const card of dialog.querySelectorAll('[data-eq-band]')) {
            const band = value.bands[Number(card.dataset.eqBand)], cut = ['lowpass', 'highpass'].includes(band.type);
            for (const control of card.querySelectorAll('[data-eq-field]')) {
                const field = control.dataset.eqField;
                if (field === 'enabled') control.checked = band.enabled;
                else if (document.activeElement !== control) control.value = String(field === 'q' ? Math.round(band[field] * 100) / 100 : field === 'gain' ? Math.round(band[field] * 10) / 10 : field === 'frequency' ? Math.round(band[field]) : band[field]);
                control.disabled = field === 'gain' ? cut : field === 'slope' ? !cut : false;
            }
        }
        for (const slider of dialog.querySelectorAll('[data-eq-q-slider]')) {
            const q = value.bands[Number(slider.dataset.eqQSlider)].q;
            slider.value = String(Math.round(Math.log(q / .1) / Math.log(180) * 1000));
            slider.setAttribute('aria-valuetext', `Q ${q.toFixed(2)}`);
        }
        renderCurve(); monitor();
    }
    function stopMonitor() { if (frame !== null) cancelAnimationFrame(frame); frame = null; runtime.watch(null); dialog.querySelector('.ceq-spectrum').setAttribute('d', ''); }
    function monitor() {
        const active = dialog.open && key && (runtime.get(key).enabled || automation.info(key).read) && !document.hidden && typeof audioContext !== 'undefined' && audioContext?.state === 'running';
        if (!active) { stopMonitor(); if (dialog.open && !drag) status(runtime.get(key).enabled ? 'EQ enabled · output spectrum waits for audio playback.' : 'EQ bypassed · no filters or analyser running. Dashed line previews your settings.'); return; }
        runtime.watch(key);
        if (frame === null) frame = requestAnimationFrame(tick);
    }
    function tick(time) {
        frame = null;
        if (!dialog.open || !key || (!runtime.get(key).enabled && !automation.info(key).read) || document.hidden || audioContext?.state !== 'running') { stopMonitor(); return; }
        if (!drag && automation.info(key).read) renderCurve();
        if (time - lastDraw > 66) {
            lastDraw = time;
            const spectra = runtime.spectra(key);
            let d = `M45,302`;
            for (let i = 0; i < 300; i++) {
                const frequency = 20 * 1000 ** (i / 299);
                let power = 0;
                for (const spectrum of spectra) {
                    const bin = Math.min(spectrum.values.length - 1, Math.max(0, Math.round(frequency / (spectrum.sampleRate / 2) * spectrum.values.length)));
                    const db = spectrum.values[bin]; if (Number.isFinite(db)) power += 10 ** (db / 10);
                }
                const db = power > 0 ? 10 * Math.log10(power) : -100;
                d += `L${x(frequency).toFixed(2)},${(302 - Math.max(0, Math.min(1, (db + 100) / 100)) * 282).toFixed(2)}`;
            }
            dialog.querySelector('.ceq-spectrum').setAttribute('d', d + 'L882,302Z');
            if (!drag) status(spectra.length ? 'EQ enabled · live post-EQ output spectrum.' : 'EQ enabled · play this channel to see its output spectrum.');
        }
        frame = requestAnimationFrame(tick);
    }
    function open(channelKey, source) {
        key = channelKey; selected = 0; opener = source;
        const autoPanel = document.getElementById('channelEqAutomation');
        autoPanel.replaceChildren(); autoPanel.hidden = !['X', 'L'].includes(key);
        if (!autoPanel.hidden) mountAutomation(autoPanel, key);
        syncAutomation();
        if (!dialog.open) dialog.showModal(); sync();
    }
    // History admission can throw before returning a promise (loading, recording,
    // lease checks). Always settle the gesture, including that synchronous path.
    function runGesture(label, apply, session) {
        let task;
        try { task = window.mygrainCardHistory ? window.mygrainCardHistory.runDraftEdit(label, apply) : apply(); }
        catch (error) { task = Promise.reject(error); }
        let failure;
        Promise.resolve(task).catch(error => {
            failure = error;
            runtime.set(session.channelKey, session.original);
        }).finally(() => {
            automation.touch(session.channelKey, false);
            if (drag === session) drag = null;
            if (session.handle?.hasPointerCapture(session.pointerId)) session.handle.releasePointerCapture(session.pointerId);
            sync();
            if (failure) status(failure.message);
        });
    }
    function cancelDrag() { if (drag) { drag.cancelled = true; drag.end(); } }
    function close() { cancelDrag(); stopMonitor(); if (dialog.open) dialog.close(); }
    document.getElementById('channelEqClose').addEventListener('click', close);
    dialog.addEventListener('close', () => { cancelDrag(); stopMonitor(); opener?.focus({ preventScroll: true }); });
    dialog.addEventListener('cancel', () => { cancelDrag(); stopMonitor(); });
    dialog.addEventListener('keydown', event => event.stopPropagation());
    dialog.addEventListener('keyup', event => event.stopPropagation());
    document.getElementById('channelEqEnabled').addEventListener('change', event => edit(key, value => { value.enabled = event.target.checked; }));
    document.getElementById('channelEqReset').addEventListener('click', () => edit(key, value => { const enabled = value.enabled; Object.assign(value, dsp.defaults(), { enabled }); }));
    for (const card of dialog.querySelectorAll('[data-eq-band]')) card.addEventListener('change', event => {
        const field = event.target.dataset.eqField; if (!field) return;
        const i = Number(card.dataset.eqBand), value = field === 'enabled' ? event.target.checked : field === 'type' ? event.target.value : Number(event.target.value);
        if (event.target.validity && !event.target.validity.valid) { status('Enter a value within the displayed range.'); return; }
        selected = i; edit(key, state => { state.bands[i][field] = value; });
    });
    for (const slider of dialog.querySelectorAll('[data-eq-q-slider]')) {
        const index = Number(slider.dataset.eqQSlider);
        const begin = () => {
            if (drag?.slider === slider) return drag;
            assertEditable();
            if (drag) throw new Error('Finish the current EQ gesture first.');
            const channelKey = key, original = runtime.get(key);
            let end; const done = new Promise(resolve => { end = resolve; });
            const session = drag = { slider, end, original, channelKey, cancelled: false, ready: false, value: null };
            const applyValue = () => {
                if (!session.ready || session.cancelled || session.value === null) return;
                const value = runtime.get(channelKey); value.bands[index].q = .1 * 180 ** (session.value / 1000);
                runtime.set(channelKey, value);
            };
            session.move = value => { session.value = value; applyValue(); };
            const apply = async () => {
                automation.touch(channelKey, true); session.ready = true; applyValue(); await done;
                if (session.cancelled) runtime.set(channelKey, original); else { applyValue(); saveState(); }
            };
            runGesture(`${names[key]} EQ band ${index + 1} Q`, apply, session);
            return session;
        };
        const finish = () => { if (drag?.slider === slider) { drag.ended = true; drag.end(); } };
        slider.addEventListener('pointerdown', () => { try { begin(); } catch (error) { status(error.message); sync(); } });
        slider.addEventListener('input', () => { const value = Number(slider.value); try { begin().move(value); } catch (error) { status(error.message); sync(); } });
        slider.addEventListener('change', finish);
        slider.addEventListener('pointerup', finish);
        slider.addEventListener('pointercancel', cancelDrag);
        // Native range input may release a pointer outside its own bounds.
        window.addEventListener('pointerup', finish);
        slider.addEventListener('keyup', finish);
    }
    for (const handle of handles) {
        const index = Number(handle.dataset.eqHandle);
        handle.addEventListener('pointerdown', event => {
            if (event.button !== 0 || drag) return;
            event.preventDefault(); event.stopPropagation();
            try { assertEditable(); } catch (error) { status(error.message); return; }
            selected = index; handle.focus({ preventScroll: true }); renderCurve(); handle.setPointerCapture(event.pointerId);
            const original = runtime.get(key), channelKey = key;
            let end; const done = new Promise(resolve => { end = resolve; });
            const session = drag = { handle, pointerId: event.pointerId, end, cancelled: false, ready: false, point: null, original, channelKey };
            const applyPoint = () => {
                if (!session.ready || session.cancelled || !session.point) return;
                const rect = graph.getBoundingClientRect(), point = session.point, value = runtime.get(channelKey), band = value.bands[index];
                const px = (point.x - rect.left) / rect.width * 900, py = (point.y - rect.top) / rect.height * 330;
                band.frequency = Math.round(20 * 1000 ** (Math.max(0, Math.min(1, (px - 45) / 837))));
                if (!['lowpass', 'highpass'].includes(band.type)) band.gain = Math.round(Math.max(-24, Math.min(24, 24 - (py - 20) / 282 * 48)) * 10) / 10;
                runtime.set(channelKey, value);
            };
            session.move = point => { session.point = point; applyPoint(); };
            const apply = async () => {
                automation.touch(channelKey, true); session.ready = true; applyPoint(); await done;
                if (session.cancelled) runtime.set(channelKey, original); else { applyPoint(); saveState(); }
            };
            runGesture(`${names[key]} EQ band ${index + 1}`, apply, session);
        });
        handle.addEventListener('pointermove', event => { if (drag && handle.hasPointerCapture(event.pointerId)) drag.move({ x: event.clientX, y: event.clientY }); });
        const finish = event => {
            if (drag?.handle !== handle || drag.pointerId !== event.pointerId) return;
            const session = drag;
            session.move({ x: event.clientX, y: event.clientY }); session.ended = true;
            session.end();
            if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        };
        handle.addEventListener('pointerup', finish);
        window.addEventListener('pointerup', finish);
        handle.addEventListener('pointercancel', event => { if (drag?.handle === handle && drag.pointerId === event.pointerId) cancelDrag(); });
        handle.addEventListener('lostpointercapture', () => { if (drag?.handle === handle && !drag.ended) cancelDrag(); });
        handle.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault(); if (event.repeat) return; selected = index;
            edit(key, value => { const band = value.bands[index], positive = ['ArrowRight', 'ArrowUp'].includes(event.key);
                if (['ArrowLeft', 'ArrowRight'].includes(event.key)) band.frequency *= positive ? (event.shiftKey ? 1.005 : 1.03) : 1 / (event.shiftKey ? 1.005 : 1.03);
                else if (event.shiftKey) band.q *= positive ? 1.08 : 1 / 1.08;
                else band.gain += positive ? .5 : -.5;
            });
        });
        handle.addEventListener('wheel', event => { event.preventDefault(); if (Math.abs(event.deltaY) < 1 || window.mygrainCardHistory?.busy) return; selected = index; edit(key, value => { value.bands[index].q *= Math.exp(-Math.sign(event.deltaY) * (event.shiftKey ? .015 : .08)); }); }, { passive: false });
    }
    runtime.subscribe(sync);
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancelDrag(); monitor(); });
    window.addEventListener('blur', cancelDrag);
    window.addEventListener('mygrain-eq-context', monitor);
    window.addEventListener('mygrain-account-lock', () => { disposed = true; close(); runtime.releaseContext(); runtime.restore(); });
    window.mygrainChannelEqUi = Object.freeze({ open, close, sync, names });
    syncAutomation();
    sync();
})();
