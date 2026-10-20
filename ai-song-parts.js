(function (root) {
    'use strict';
    if (root.__mygrainSongRenderDeck || !document.getElementById('aiPartSlots')) return;
    const byId = id => document.getElementById(id), ai = () => root.mygrainAiPatch;
    const api = new URL('api/ai-parts', document.baseURI);
    const colors = ['#ffd86f', '#f6a5ff', '#98f9ff', '#b7ff84', '#ffb0d8'];
    let entries = [], loading = null, locked = false, dirtyRecall = false;
    const message = text => { byId('aiPartStatus').textContent = text; };
    const label = type => ({ verse: 'Verse', chorus: 'Chorus', bridge: 'Bridge', middle8: 'Middle 8' }[type] || 'Take');
    const entryAt = slot => entries.find(entry => entry.slot === slot);
    const nameInput = slot => byId('aiPartName' + slot);
    const utf8Base64 = value => {
        let binary = ''; for (const byte of new TextEncoder().encode(JSON.stringify(value))) binary += String.fromCharCode(byte);
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_');
    };
    function update() {
        const busy = locked || Boolean(loading) || ai()?.busy;
        byId('aiPartGenerate').disabled = busy || !ai()?.direction().prompt;
        byId('aiPartRefresh').disabled = busy;
        for (const id of ['aiPartType', 'aiPartBars', 'aiPartRolls', 'aiPartInstruction']) byId(id).disabled = busy || (id === 'aiPartBars' && byId('aiPartType').value === 'middle8');
        for (let slot = 1; slot <= 5; slot++) {
            const stored = entryAt(slot), row = byId('aiPartSlot' + slot);
            if (!row) continue;
            nameInput(slot).disabled = busy;
            for (const button of row.querySelectorAll('button')) button.disabled = busy || (button.dataset.action !== 'store' && !stored);
            row.querySelector('h5').textContent = `Take ${slot}${stored ? ' ★ · ' + stored.name : ' · empty'}`;
            row.querySelector('.ai-part-meta').textContent = stored ? `${stored.bpm} BPM · ${stored.patternSteps / 16}-bar pattern × ${stored.repeats} = ${stored.patternSteps / 16 * stored.repeats} bars · ${stored.audioAssets} audio assets · saved to your account` : 'Store the current editable pattern and its sounds here.';
        }
        const context = ai()?.direction();
        byId('aiPartContext').textContent = context?.section ? `${label(context.section.type)} · four-bar pattern × ${context.section.bars / 4} = ${context.section.bars} bars. Store this version before developing another part.` : context?.prompt ? 'Current AI take is ready. Store it before generating the next section.' : 'Generate or recall a take first. Store the original in a slot before developing another section.';
    }
    function accept(payload, replaceNames = false) {
        if (!payload.ok || !Array.isArray(payload.parts) || payload.parts.length > 5 || payload.parts.some(p => !Number.isInteger(p.slot) || p.slot < 1 || p.slot > 5 || typeof p.name !== 'string' || p.name.length > 100 || !/^[a-f0-9]{64}$/.test(p.sha256) || !Number.isInteger(p.revision) || p.revision < 1 || typeof p.prompt !== 'string' || p.prompt.length > 1500)) throw Error(payload.error || 'Saved part list is unreadable.');
        const oldEntries = entries; entries = payload.parts;
        for (let slot = 1; slot <= 5; slot++) if (entryAt(slot) && (replaceNames || nameInput(slot).value === (oldEntries.find(entry => entry.slot === slot)?.name || `Take ${slot}`))) nameInput(slot).value = entryAt(slot).name;
        update();
    }
    async function jsonRequest(options = {}) {
        const response = await root.fetch(api, { credentials: 'same-origin', cache: 'no-store', ...options });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw Error(payload.error || 'Saved parts unavailable.');
        return payload;
    }
    async function refresh() {
        if (loading || locked || ai()?.busy) return;
        const controller = loading = new AbortController(), timeout = root.setTimeout(() => controller.abort(), 15000); update();
        try { const result = await jsonRequest({ signal: controller.signal }); if (!locked && !controller.signal.aborted) { accept(result); message('Part takes loaded from your account. Store, Recall, Rename or Add to Song.'); } }
        catch (error) { if (!locked) message(error.name === 'AbortError' ? 'Part list timed out. Refresh to retry.' : error.message); }
        finally { root.clearTimeout(timeout); loading = null; update(); }
    }
    async function read(stored, signal) {
        const url = new URL(api); url.searchParams.set('slot', stored.slot);
        const response = await root.fetch(url, { credentials: 'same-origin', cache: 'no-store', signal });
        if (!response.ok) { const error = await response.json(); throw Error(error.error || 'Stored take unavailable.'); }
        if (!response.headers.get('Content-Type')?.startsWith('application/zip') || Number(response.headers.get('Content-Length')) !== stored.bytes || stored.bytes > 128 * 1024 * 1024) throw Error('Stored take size/type changed. Refresh slots.');
        const body = await response.arrayBuffer();
        if (body.byteLength !== stored.bytes) throw Error('Stored take download incomplete.');
        const digest = Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256', body)), value => value.toString(16).padStart(2, '0')).join('');
        if (digest !== stored.sha256) throw Error('Stored take changed. Refresh slots before recalling.');
        return body;
    }
    async function action(kind, slot) {
        if (loading || locked || ai()?.busy) return;
        const stored = entryAt(slot), currentName = nameInput(slot).value.trim();
        if (['store', 'rename'].includes(kind) && (!currentName || currentName.length > 100)) { message('Give this take a name using 1–100 characters.'); return; }
        if (kind !== 'store' && !stored) return;
        message(kind === 'store' ? `Storing Take ${slot} with its complete pattern and sounds…` : kind === 'recall' ? `Loading ${stored.name}…` : kind === 'add' ? `Adding saved ${stored.name} to the selected Song…` : 'Renaming saved take…');
        try {
            await ai().withPartAction(async (signal, check) => {
                const adapter = root.mygrainSongBetaAdapter;
                if (kind === 'recall') { await adapter.ready(); check(); }
                if (kind === 'store') {
                    const fingerprint = root.mygrainAiPatchAdapter.fingerprint({ ignoreQBank: true }), fullFingerprint = root.mygrainAiPatchAdapter.fingerprint(), context = ai().direction();
                    const body = await adapter.capture(); check();
                    ai().acceptCapture(fullFingerprint, fingerprint);
                    const section = context.section;
                    const metadata = { slot, revision: stored?.revision || 0, name: currentName, prompt: context.prompt || byId('aiPatchPrompt').value.trim(), section, repeats: section ? section.bars / 4 : 1 };
                    const result = await jsonRequest({ method: 'POST', signal, headers: { 'Content-Type': 'application/zip', 'X-Mygrain-AI-Part': utf8Base64(metadata) }, body }); check(); accept(result);
                    message(`Stored Take ${slot} · ${currentName}. Pattern, sounds and prompt are saved; Recall restores them.`);
                } else if (kind === 'rename') {
                    const result = await jsonRequest({ method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slot, revision: stored.revision, name: currentName }) }); check(); accept(result); message(`Renamed Take ${slot} to ${currentName}.`);
                } else {
                    const fingerprint = root.mygrainAiPatchAdapter.fingerprint({ ignoreQBank: true }), body = await read(stored, signal); check();
                    if (root.mygrainAiPatchAdapter.fingerprint({ ignoreQBank: true }) !== fingerprint) throw Error('Your patch changed while downloading. Recall again.');
                    if (kind === 'add') {
                        const song = root.mygrainSongBeta;
                        if (!song?.song) throw Error('Create or choose a Song in the Song card first, then Add to Song.');
                        if (song.busy || song.playing || song.editing) throw Error('Finish the current Song operation first.');
                        song.busy = true; song.render();
                        try { await song.newPart({ blob: new Blob([body], { type: 'application/zip' }), name: stored.name, repeats: stored.repeats, signal }); check(); }
                        finally { song.busy = false; song.render(); }
                        message(`Added saved ${stored.name} to ${song.song.name}. Live patch unchanged; arrange or reuse it in the Song card.`);
                    } else {
                        if (adapter.inspectPart(body).decodedBytes > 80 * 1024 * 1024) throw Error('This take exceeds the 80 MB recall audio budget. Its saved copy is unchanged; it can still be added to Song.');
                        const decoded = await adapter.decode(body, { buffers: new Map(), bytes: 0, limitBytes: 80 * 1024 * 1024 }); check();
                        if (root.mygrainAiPatchAdapter.fingerprint({ ignoreQBank: true }) !== fingerprint) throw Error('Your patch changed while preparing. Recall again.');
                        const previous = await adapter.capture({ liveOnly: true }); check();
                        try {
                            adapter.recall(decoded, { start: false, prepared: decoded }); dirtyRecall = true;
                            await adapter.whenPersisted(); check();
                            ai().setDirection(stored); dirtyRecall = false;
                        } catch (error) {
                            if (root.mygrainAccounts?.authenticated && !locked) { adapter.recall(previous, { start: false, prepared: previous }); await adapter.whenPersisted(); }
                            dirtyRecall = false; throw error;
                        }
                        message(`Recalled Take ${slot} · ${stored.name}. Pattern, sounds and prompt restored. Hear patch to play; Generate progression to develop it.`);
                    }
                }
            });
        } catch (error) { if (!locked) message(error.name === 'AbortError' ? (kind === 'add' ? 'Add cancelled or timed out. Refresh Songs before retrying; an in-flight add may have saved.' : 'Take operation cancelled or timed out. Refresh slots to confirm any in-flight save.') : error.message); }
        finally { update(); }
    }
    for (let slot = 1; slot <= 5; slot++) {
        const row = document.createElement('article'); row.className = 'ai-part-slot'; row.id = 'aiPartSlot' + slot; row.style.setProperty('--take-color', colors[slot - 1]);
        const heading = document.createElement('h5'), label = document.createElement('label'), input = document.createElement('input'), metadata = document.createElement('p'), actions = document.createElement('div');
        label.htmlFor = input.id = 'aiPartName' + slot; label.textContent = `Take ${slot} name`; input.type = 'text'; input.maxLength = 100; input.value = `Take ${slot}`; metadata.className = 'ai-part-meta'; actions.className = 'ai-patch-actions';
        for (const [kind, title] of [['store', `Store Take ${slot}`], ['recall', 'Recall'], ['rename', 'Rename'], ['add', 'Add to Song']]) { const button = document.createElement('button'); button.type = 'button'; button.dataset.action = kind; button.textContent = title; button.className = kind === 'store' ? 'ai-part-store' : ''; button.addEventListener('click', () => action(kind, slot)); actions.append(button); }
        row.append(heading, label, input, metadata, actions); byId('aiPartSlots').append(row);
    }
    byId('aiPartRefresh').addEventListener('click', refresh);
    byId('aiPartType').addEventListener('change', () => { if (byId('aiPartType').value === 'middle8') byId('aiPartBars').value = '8'; update(); });
    byId('aiPartGenerate').addEventListener('click', async () => {
        const section = { type: byId('aiPartType').value, bars: Number(byId('aiPartBars').value), rolls: byId('aiPartRolls').checked };
        message(`Generating a related ${label(section.type)}. Drum samples stay loaded…`);
        const result = await ai().section(section);
        message(result?.applied ? `${label(section.type)} ready · ${section.bars} bars. Hear it, refine it, then Store in a take slot.` : byId('aiPatchStatus').textContent);
        update();
    });
    root.addEventListener('mygrain-ai-update', update);
    root.addEventListener('mygrain-account-lock', () => { locked = true; entries = []; loading?.abort(); for (let slot = 1; slot <= 5; slot++) nameInput(slot).value = ''; byId('aiPartInstruction').value = ''; message('Sign in again to use your part takes.'); update(); });
    root.addEventListener('pagehide', () => loading?.abort());
    root.mygrainAiParts = Object.freeze({ refresh, diagnostics: () => ({ loading: Boolean(loading), stored: entries.length, dirtyRecall }), get ready() { return !loading; } });
    update(); void refresh();
})(window);
