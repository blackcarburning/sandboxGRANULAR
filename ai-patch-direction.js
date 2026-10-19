(function (root) {
    'use strict';
    if (root.__mygrainSongRenderDeck) return;
    let schema, previous = null, request = null, serial = 0, locked = false, phase = 'idle';
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
    }
    function update() {
        byId('aiPatchGenerate').disabled = locked || !schema || Boolean(request) || Boolean(previous);
        byId('aiPatchCancel').hidden = !request || phase === 'undo';
        byId('aiPatchUndo').hidden = !previous;
        byId('aiPatchKeep').hidden = !previous;
        byId('aiPatchUndo').disabled = Boolean(request) || locked;
        byId('aiPatchKeep').disabled = Boolean(request) || locked;
        byId('aiPatchHear').hidden = !previous;
        byId('aiPatchHear').disabled = Boolean(request) || locked;
        byId('aiPatchPrompt').disabled = Boolean(request) || Boolean(previous) || locked;
        byId('aiPatchCard').setAttribute('aria-busy', String(Boolean(request)));
    }
    function validateRecipe(recipe) {
        if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe) || Object.keys(recipe).sort().join() !== 'description,loops,parameters,title') throw Error('Invalid AI recipe. Nothing was changed.');
        for (const [key, limit] of [['title', 80], ['description', 600]]) if (typeof recipe[key] !== 'string' || !recipe[key].trim() || recipe[key].length > limit) throw Error('Invalid AI description.');
        if (!recipe.parameters || typeof recipe.parameters !== 'object' || Array.isArray(recipe.parameters) || !recipe.loops || typeof recipe.loops !== 'object' || Array.isArray(recipe.loops)) throw Error('Missing patch controls or loop operations.');
        const entries = Object.entries(recipe.parameters), lanes = Object.entries(recipe.loops);
        if ((!entries.length && !lanes.length) || entries.length > Object.keys(schema.controls).length) throw Error('Invalid control count.');
        for (const [key, value] of entries) {
            const spec = schema.controls[key];
            if (!Object.hasOwn(schema.controls, key) || typeof value !== 'number' || !Number.isFinite(value) || value < spec.min || value > spec.max || (value - spec.min) % spec.step !== 0) throw Error('Unsupported or out-of-range AI control. Nothing was changed.');
        }
        let loads = 0;
        for (const [key, lane] of lanes) {
            const spec = schema.loops[key];
            if (!Object.hasOwn(schema.loops, key) || !lane || typeof lane !== 'object' || Array.isArray(lane)) throw Error('Unsupported loop.');
            const allowed = ['enabled', ...(spec.reload ? ['reload'] : []), ...(spec.divisions ? ['divisions'] : []), ...(spec.notes ? ['notes'] : []), ...(key === 'Q' ? ['instrument', 'chords'] : [])];
            if (!Object.keys(lane).length || Object.keys(lane).some(field => !allowed.includes(field))) throw Error('Unsupported loop operation.');
            for (const field of ['enabled', 'reload']) if (Object.hasOwn(lane, field) && typeof lane[field] !== 'boolean') throw Error('Invalid loop switch.');
            if (lane.divisions && (!Array.isArray(lane.divisions) || !lane.divisions.length || lane.divisions.length > 3 || lane.divisions.some(d => !schema.divisions.includes(d)) || new Set(lane.divisions).size !== lane.divisions.length)) throw Error('Invalid loop divisions.');
            if (Object.hasOwn(lane, 'divisions') && !lane.divisions) throw Error('Invalid loop divisions.');
            if (Object.hasOwn(lane, 'notes') && (!Array.isArray(lane.notes) || !lane.notes.length || lane.notes.length > 16 || !lane.notes.some(n => n !== null) || lane.notes.some(n => n !== null && (!Number.isInteger(n) || n < 24 || n > 84)))) throw Error('Invalid lead/bass notes.');
            if (Object.hasOwn(lane, 'instrument') && !['piano', 'strings'].includes(lane.instrument)) throw Error('Invalid Q instrument.');
            if (Object.hasOwn(lane, 'chords') && (!Array.isArray(lane.chords) || !lane.chords.length || lane.chords.length > 8 || lane.chords.some(chord => !Array.isArray(chord) || !chord.length || chord.length > 4 || chord.some(n => !Number.isInteger(n) || n < 36 || n > 84)))) throw Error('Invalid Q chords.');
            if (lane.reload) loads++;
        }
        if (loads > schema.maxReloads) throw Error('At most three fresh loop sources per direction.');
        return recipe;
    }
    function cancel() {
        request?.abort();
        if (phase === 'applying') status('Cancelling… restoring the previous patch and samples.');
        else status('Cancelled. Your patch is unchanged.');
    }
    async function generate() {
        if (request || previous || locked || !schema) return;
        const prompt = byId('aiPatchPrompt').value.trim();
        if (prompt.length < 3 || prompt.length > 1500) { status('Describe your direction in 3–1500 characters.'); return; }
        let timeout;
        const token = ++serial;
        try {
            adapter().assertReady();
            const fingerprint = adapter().fingerprint(), current = adapter().read(Object.keys(schema.controls)), loops = adapter().inventory({ forModel: true });
            request = new AbortController(); const signal = request.signal;
            timeout = root.setTimeout(() => request?.abort(), 85000);
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
            status(`Applied ${result.changes} changes. Press Hear patch if playback was stopped. Undo restores parameters AND samples.`);
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
            previous = null;
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
        byId('aiPatchHear').addEventListener('click', () => { try { if (!adapter().play()) throw Error('No audible loop is ready. Check the loop inventory and layer levels.'); report('Shared loop playback started.'); } catch (error) { status(error.message); } });
        byId('aiPatchKeep').addEventListener('click', () => { previous = null; status('Kept. The change log remains below. Save/export a named patch as usual.'); update(); });
        document.querySelectorAll('[data-ai-patch-example]').forEach(button => button.addEventListener('click', () => { if (!request && !previous && !locked) { byId('aiPatchPrompt').value = button.dataset.aiPatchExample; byId('aiPatchPrompt').focus(); } }));
        root.addEventListener('mygrain-account-lock', () => { locked = true; previous = null; request?.abort(); status('Sign in again. AI work stopped.'); update(); });
        root.addEventListener('pagehide', cancel);
        // Trusted edits outside this card must not race asynchronous patch writes.
        for (const event of ['click', 'input', 'change', 'keydown']) document.addEventListener(event, e => {
            if (!['applying', 'undo'].includes(phase) || !e.isTrusted || e.target.closest('#aiPatchCard, #sectionJumpDrawer') || !e.target.closest('button, input, select, textarea')) return;
            e.preventDefault(); e.stopImmediatePropagation();
        }, true);
        update();
        try {
            const response = await root.fetch(new URL('ai-patch-controls.json?v=20261020-ai-loops-3', document.baseURI), { credentials: 'same-origin' });
            if (!response.ok) throw Error();
            const data = await response.json();
            if (data.version !== 2 || !data.controls || Object.keys(data.loops || {}).length !== 12) throw Error();
            schema = data; inventory(); update();
        } catch { status('AI beta could not load. Reload to try again. Your other controls still work.'); }
    }
    root.mygrainAiPatch = Object.freeze({ generate, undo, cancel, get ready() { return Boolean(schema); }, get busy() { return Boolean(request); } });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true }); else void initialize();
})(window);
