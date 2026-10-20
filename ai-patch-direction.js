(function (root) {
    'use strict';
    if (root.__mygrainSongRenderDeck) return;
    let schema, previous = null, request = null, serial = 0, locked = false, phase = 'idle', rendered = null;
    const byId = id => document.getElementById(id);
    const adapter = () => root.mygrainAiPatchAdapter;
    const status = message => { byId('aiPatchStatus').textContent = message; };
    function report(message) {
        const list = byId('aiPatchChanges'), item = document.createElement('li');
        item.textContent = `${new Date().toLocaleTimeString([], { hour12: false })} · ${message}`;
        list.append(item);
        list.scrollTop = list.scrollHeight;
        byId('aiPatchProposal').hidden = false;
    }
    function inventory() {
        const list = byId('aiPatchSamples'); list.replaceChildren();
        for (const [key, lane] of Object.entries(adapter().inventory())) {
            const item = document.createElement('li');
            item.textContent = `Loop ${key} · ${lane.enabled ? 'ON' : 'OFF'} · ${lane.loaded ? lane.samples.join(', ') || 'Existing audio (no filename metadata)' : 'No sample loaded'}`;
            list.append(item);
        }
        for (const [kind, lane] of Object.entries(adapter().drumInventory())) {
            const item = document.createElement('li'); item.textContent = `Drum ${kind} · ${lane.sample} · ${lane.hits} hits`; list.append(item);
        }
    }
    function update() {
        byId('aiPatchGenerate').disabled = locked || !schema || Boolean(request);
        byId('aiPatchCancel').hidden = !request || phase === 'undo';
        byId('aiPatchUndo').hidden = !previous;
        byId('aiPatchKeep').hidden = !previous;
        byId('aiPatchUndo').disabled = Boolean(request) || locked;
        byId('aiPatchKeep').disabled = Boolean(request) || locked;
        byId('aiPatchHear').hidden = false;
        byId('aiPatchRender').disabled = Boolean(request) || locked || !schema;
        byId('aiPatchReplay').hidden = !rendered;
        byId('aiPatchReplay').disabled = Boolean(request) || locked;
        byId('aiPatchHear').disabled = Boolean(request) || locked;
        byId('aiPatchPrompt').disabled = Boolean(request) || locked;
        byId('aiPatchCard').setAttribute('aria-busy', String(Boolean(request)));
    }
    function validateRecipe(recipe) {
        if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe) || !['description,loops,parameters,title', 'description,drums,loops,parameters,title'].includes(Object.keys(recipe).sort().join())) throw Error('Invalid AI recipe. Nothing was changed.');
        for (const [key, limit] of [['title', 80], ['description', 600]]) if (typeof recipe[key] !== 'string' || !recipe[key].trim() || recipe[key].length > limit) throw Error('Invalid AI description.');
        if (!recipe.parameters || typeof recipe.parameters !== 'object' || Array.isArray(recipe.parameters) || !recipe.loops || typeof recipe.loops !== 'object' || Array.isArray(recipe.loops)) throw Error('Missing patch controls or loop operations.');
        const entries = Object.entries(recipe.parameters), lanes = Object.entries(recipe.loops);
        if ((!entries.length && !lanes.length && !recipe.drums) || entries.length > Object.keys(schema.controls).length) throw Error('Invalid control count.');
        for (const [key, value] of entries) {
            const spec = schema.controls[key];
            if (!Object.hasOwn(schema.controls, key) || typeof value !== 'number' || !Number.isFinite(value) || value < spec.min || value > spec.max || (value - spec.min) % spec.step !== 0) throw Error('Unsupported or out-of-range AI control. Nothing was changed.');
        }
        let loads = 0;
        for (const [key, lane] of lanes) {
            const spec = schema.loops[key];
            if (!Object.hasOwn(schema.loops, key) || !lane || typeof lane !== 'object' || Array.isArray(lane)) throw Error('Unsupported loop.');
            const allowed = ['enabled', ...(spec.reload ? ['reload'] : []), ...(spec.divisions ? ['divisions'] : []), ...(spec.notes ? ['notes'] : []), ...(key === 'Q' ? ['instrument', 'chords', 'chordSteps', 'style'] : [])];
            if (!Object.keys(lane).length || Object.keys(lane).some(field => !allowed.includes(field))) throw Error('Unsupported loop operation.');
            for (const field of ['enabled', 'reload']) if (Object.hasOwn(lane, field) && typeof lane[field] !== 'boolean') throw Error('Invalid loop switch.');
            if (lane.divisions && (!Array.isArray(lane.divisions) || !lane.divisions.length || lane.divisions.length > 3 || lane.divisions.some(d => !schema.divisions.includes(d)) || new Set(lane.divisions).size !== lane.divisions.length)) throw Error('Invalid loop divisions.');
            if (Object.hasOwn(lane, 'divisions') && !lane.divisions) throw Error('Invalid loop divisions.');
            if (Object.hasOwn(lane, 'notes') && (!Array.isArray(lane.notes) || !lane.notes.length || lane.notes.length > 64 || !lane.notes.some(n => n !== null) || lane.notes.some(n => n !== null && (!Number.isInteger(n) || n < 24 || n > 84)))) throw Error('Invalid lead/bass notes.');
            if (Object.hasOwn(lane, 'instrument') && !['piano', 'strings'].includes(lane.instrument)) throw Error('Invalid Q instrument.');
            if (Object.hasOwn(lane, 'chords') && (!Array.isArray(lane.chords) || !lane.chords.length || lane.chords.length > 8 || lane.chords.some(chord => !Array.isArray(chord) || !chord.length || chord.length > 4 || chord.some(n => !Number.isInteger(n) || n < 36 || n > 84)))) throw Error('Invalid Q chords.');
            if (Object.hasOwn(lane, 'style') && !['dry', 'warm', 'spacious'].includes(lane.style)) throw Error('Invalid Q style.');
            if (Object.hasOwn(lane, 'chordSteps') && ![4, 8, 16].includes(lane.chordSteps)) throw Error('Invalid Q chord spacing.');
            if (lane.reload) loads++;
        }
        if (loads > schema.maxReloads) throw Error('At most three fresh loop sources per direction.');
        if (Object.hasOwn(recipe, 'drums')) {
            const drums = recipe.drums;
            if (!drums || typeof drums !== 'object' || Array.isArray(drums) || !Object.keys(drums).length || Object.keys(drums).some(key => !['enabled', 'tracks'].includes(key)) || (Object.hasOwn(drums, 'enabled') && typeof drums.enabled !== 'boolean')) throw Error('Invalid drums.');
            if (Object.hasOwn(drums, 'tracks') && (!drums.tracks || typeof drums.tracks !== 'object' || Array.isArray(drums.tracks))) throw Error('Invalid drum tracks.');
            for (const [key, lane] of Object.entries(drums.tracks || {})) {
                if (!['kick', 'snare', 'hat'].includes(key) || !lane || typeof lane !== 'object' || Array.isArray(lane) || !Object.keys(lane).length || Object.keys(lane).some(field => !['reload', 'steps'].includes(field))) throw Error('Unsupported drum operation.');
                if (Object.hasOwn(lane, 'reload') && typeof lane.reload !== 'boolean') throw Error('Invalid drum reload.');
                if (Object.hasOwn(lane, 'steps') && (!Array.isArray(lane.steps) || !lane.steps.length || lane.steps.length > 64 || lane.steps.some(hit => !Number.isInteger(hit) || ![0, 1].includes(hit)))) throw Error('Invalid drum pattern.');
            }
        }
        return recipe;
    }
    function cancel() {
        request?.abort();
        if (phase === 'applying') status('Cancelling… restoring the previous patch and samples.');
        else status('Cancelled. Your patch is unchanged.');
    }
    async function generate() {
        if (request || locked || !schema) return;
        const prompt = byId('aiPatchPrompt').value.trim();
        if (prompt.length < 3 || prompt.length > 1500) { status('Describe your direction in 3–1500 characters.'); return; }
        let timeout;
        const token = ++serial;
        try {
            adapter().assertReady();
            const fingerprint = adapter().fingerprint(), current = adapter().read(Object.keys(schema.controls)), loops = adapter().inventory({ forModel: true });
            request = new AbortController(); const signal = request.signal;
            timeout = root.setTimeout(() => request?.abort(), 85000);
            rendered = null;
            byId('aiPatchPreviewStatus').textContent = 'Render a fresh one-bar preview after this direction finishes. Capture is audible and stays on this device.';
            phase = 'generating';
            byId('aiPatchChanges').replaceChildren();
            byId('aiPatchTitle').textContent = 'Live changes'; byId('aiPatchDescription').textContent = '';
            inventory();
            report('Requesting a musical recipe from GPT-6.1 Sol. No patch changes yet.');
            status('GPT-6.1 Sol is choosing tempo, layers and sound parameters…'); update();
            const response = await root.fetch(new URL('api/ai-patch-direction', document.baseURI), { method: 'POST', credentials: 'same-origin', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, current, loops }) });
            const payload = await response.json();
            if (token !== serial || locked || signal.aborted) return;
            if (!response.ok || !payload.ok) throw Error(payload.error || 'AI unavailable. Your patch is unchanged.');
            if (payload.model !== 'openai/gpt-6.1-sol') throw Error('Unexpected AI model. Nothing was changed.');
            adapter().assertReady();
            if (adapter().fingerprint() !== fingerprint) throw Error('Your patch or Song changed while AI was working. Generate a fresh direction.');
            const recipe = validateRecipe(payload.recipe), combined = { ...current, ...recipe.parameters };
            if (combined.hpfCutoff >= combined.lpfCutoff / 2) throw Error('The proposed filters would remove too much sound. Try again.');
            byId('aiPatchTitle').textContent = recipe.title; byId('aiPatchDescription').textContent = recipe.description;
            root.clearTimeout(timeout); timeout = root.setTimeout(() => request?.abort(), 240000);
            phase = 'applying'; status('Applying the recipe. Follow the live changes and sample loads below…');
            const result = await adapter().execute(recipe, fingerprint, { signal, report: text => { if (!locked && token === serial) { report(text); inventory(); } } });
            if (locked || token !== serial) return;
            previous = result;
            inventory();
            report(`Complete: ${result.changes} actual changes. ${result.saved ? 'Settings autosaved. Save/export a named patch with audio for a portable copy.' : 'Autosave unavailable: export the patch to retain it.'}`);
            status(`Applied ${result.changes} changes. Ready to play, edit or generate again. Undo restores the patch before this direction.`);
        } catch (error) {
            if (!locked && token === serial) {
                const text = error.name === 'AbortError' ? (phase === 'applying' ? 'Cancelled. Previous patch and samples restored.' : 'Cancelled or timed out. Your patch is unchanged.') : error.message || 'AI unavailable.';
                status(text); report(text); inventory();
            }
        } finally {
            root.clearTimeout(timeout);
            if (token === serial) { request = null; phase = 'idle'; update(); }
        }
    }
    async function undo() {
        if (!previous || request || locked) return;
        request = new AbortController(); phase = 'undo'; update();
        try {
            report('Undo: restoring previous controls, tempo, loop patterns and samples…');
            const result = await adapter().undo(previous.before, previous.fingerprint);
            previous = null; rendered = null;
            byId('aiPatchPreviewStatus').textContent = 'Patch restored. Render a fresh preview to capture this version.';
            inventory(); report('Undo complete. Previous patch and samples restored.');
            status(result.saved ? 'Undone. Previous patch and samples restored.' : 'Undone in this session; export the patch to keep a copy.');
        } catch (error) { status(`${error.message} Keep current to continue.`); }
        finally { request = null; phase = 'idle'; update(); }
    }
    async function initialize() {
        if (!byId('aiPatchCard')) return;
        byId('aiPatchGenerate').addEventListener('click', generate);
        byId('aiPatchCancel').addEventListener('click', cancel);
        byId('aiPatchUndo').addEventListener('click', undo);
        byId('aiPatchHear').addEventListener('click', async () => {
            if (request || locked) return;
            request = new AbortController(); phase = 'audition'; update();
            try { if (!await adapter().play(request.signal)) throw Error('No audible loop is ready. Check levels and patterns.'); inventory(); report('Q/X/drums and enabled loops playing through the shared transport.'); status('Playing. Stop, edit or generate another direction whenever ready.'); }
            catch (error) { status(error.message); }
            finally { request = null; phase = 'idle'; update(); }
        });
        byId('aiPatchStop').addEventListener('click', () => { request?.abort(); adapter().stop(); status('Stopped. You can edit, play or generate again.'); });
        byId('aiPatchRender').addEventListener('click', async () => {
            if (request || locked) return;
            request = new AbortController(); phase = 'preview'; rendered = null; update();
            try {
                rendered = await adapter().preview(request.signal, report);
                byId('aiPatchPreviewStatus').textContent = `One bar rendered · ${rendered.buffer.duration.toFixed(2)}s · peak ${rendered.peak.toFixed(3)} · RMS ${rendered.rms.toFixed(4)}. Play rendered preview to hear this capture. New edits make the capture stale.`;
                status('Preview captured. Original transport restored; all controls are ready.');
            } catch (error) { status(error.name === 'AbortError' ? 'Preview cancelled. Controls are ready.' : error.message); }
            finally { request = null; phase = 'idle'; update(); }
        });
        byId('aiPatchReplay').addEventListener('click', () => {
            try {
                if (adapter().fingerprint() !== rendered?.fingerprint) { rendered = null; update(); throw Error('Patch changed. Render a fresh preview.'); }
                adapter().playPreview(rendered.buffer); status('Playing the rendered one-bar capture. Stop remains available.');
            } catch (error) { status(error.message); }
        });
        byId('aiPatchKeep').addEventListener('click', () => { previous = null; status('Kept. The change log remains below. Save/export a named patch as usual.'); update(); });
        document.querySelectorAll('[data-ai-patch-example]').forEach(button => button.addEventListener('click', () => { if (!request && !locked) { byId('aiPatchPrompt').value = button.dataset.aiPatchExample; byId('aiPatchPrompt').focus(); } }));
        root.addEventListener('mygrain-account-lock', () => { locked = true; previous = null; rendered = null; request?.abort(); adapter()?.stopPreview(); status('Sign in again. AI work stopped.'); update(); });
        root.addEventListener('pagehide', cancel);
        // Trusted edits outside this card must not race asynchronous patch writes.
        for (const event of ['click', 'input', 'change', 'keydown']) document.addEventListener(event, e => {
            if (!['applying', 'undo', 'preview', 'audition'].includes(phase) || !e.isTrusted || e.target.closest('#aiPatchCard, #sectionJumpDrawer') || !e.target.closest('button, input, select, textarea')) return;
            e.preventDefault(); e.stopImmediatePropagation();
        }, true);
        update();
        try {
            const response = await root.fetch(new URL('ai-patch-controls.json?v=20261020-ai-qxd-4', document.baseURI), { credentials: 'same-origin' });
            if (!response.ok) throw Error();
            const data = await response.json();
            if (data.version !== 3 || !data.controls || Object.keys(data.loops || {}).length !== 12) throw Error();
            schema = data; inventory(); update();
        } catch { status('AI beta could not load. Reload to try again. Your other controls still work.'); }
    }
    root.mygrainAiPatch = Object.freeze({ generate, undo, cancel, diagnostics: () => ({ phase, busy: Boolean(request), undoAvailable: Boolean(previous), renderedPreview: Boolean(rendered), previewPlaying: Boolean(adapter()?.previewPlaying), status: byId('aiPatchStatus')?.textContent }), get ready() { return Boolean(schema); }, get busy() { return Boolean(request); } });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true }); else void initialize();
})(window);
