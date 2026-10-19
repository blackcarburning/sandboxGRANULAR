(function (root) {
    'use strict';
    if (root.__mygrainSongRenderDeck) return;
    let controls, proposal = null, previous = null, request = null, serial = 0, locked = false;
    const byId = id => document.getElementById(id);
    const adapter = () => root.mygrainAiPatchAdapter;
    const status = message => { byId('aiPatchStatus').textContent = message; };
    function update() {
        byId('aiPatchGenerate').disabled = locked || !controls || Boolean(request) || Boolean(previous);
        byId('aiPatchCancel').hidden = !request;
        byId('aiPatchUndo').hidden = !previous;
        byId('aiPatchKeep').hidden = !previous;
        byId('aiPatchPrompt').disabled = Boolean(request) || Boolean(previous) || locked;
        byId('aiPatchCard').setAttribute('aria-busy', String(Boolean(request)));
    }
    function validateRecipe(recipe) {
        if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe) || Object.keys(recipe).sort().join() !== 'description,parameters,title') throw Error('Invalid AI proposal. Nothing was changed.');
        for (const [key, limit] of [['title', 80], ['description', 600]]) {
            if (typeof recipe[key] !== 'string' || !recipe[key].trim() || recipe[key].length > limit) throw Error('Invalid AI description. Nothing was changed.');
        }
        if (!recipe.parameters || typeof recipe.parameters !== 'object' || Array.isArray(recipe.parameters)) throw Error('Missing patch controls.');
        const entries = Object.entries(recipe.parameters);
        if (!entries.length || entries.length > Object.keys(controls).length) throw Error('Invalid control count.');
        for (const [key, value] of entries) {
            const spec = controls[key];
            if (!Object.hasOwn(controls, key) || !spec || typeof value !== 'number' || !Number.isFinite(value) || value < spec.min || value > spec.max || (value - spec.min) % spec.step !== 0) throw Error('Unsupported or out-of-range AI control. Nothing was changed.');
        }
        return recipe;
    }
    function cancel(message = 'Cancelled. Your patch is unchanged.') {
        serial++;
        request?.abort();
        request = null;
        proposal = null;
        if (!previous) byId('aiPatchProposal').hidden = true;
        status(message);
        update();
    }
    function show(recipe, current) {
        byId('aiPatchTitle').textContent = recipe.title;
        byId('aiPatchDescription').textContent = recipe.description;
        const list = byId('aiPatchChanges');
        list.replaceChildren();
        for (const [key, value] of Object.entries(recipe.parameters)) {
            if (current[key] === value) continue;
            const item = document.createElement('li');
            item.textContent = `${controls[key].label}: ${current[key]} → ${value} ${controls[key].unit}`;
            list.append(item);
        }
        byId('aiPatchProposal').hidden = false;
    }
    async function generate() {
        if (request || previous || locked || !controls) return;
        const prompt = byId('aiPatchPrompt').value.trim();
        if (prompt.length < 3 || prompt.length > 1500) { status('Describe your direction in 3–1500 characters.'); return; }
        let timeout;
        const token = ++serial;
        try {
            adapter().assertReady();
            const fingerprint = adapter().fingerprint();
            const current = adapter().read(Object.keys(controls));
            request = new AbortController();
            const signal = request.signal;
            timeout = root.setTimeout(() => { if (token === serial) cancel('AI timed out. Your patch is unchanged. Try again shortly.'); }, 85000);
            proposal = null;
            byId('aiPatchProposal').hidden = true;
            status('GPT-6.1 Sol is shaping a direction… Your patch is unchanged.');
            update();
            const response = await root.fetch(new URL('api/ai-patch-direction', document.baseURI), {
                method: 'POST', credentials: 'same-origin', signal,
                headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, current })
            });
            const payload = await response.json();
            if (token !== serial || locked) return;
            if (!response.ok || !payload.ok) throw Error(payload.error || 'AI unavailable. Your patch is unchanged.');
            if (payload.model !== 'openai/gpt-6.1-sol') throw Error('Unexpected AI model. Nothing was changed.');
            adapter().assertReady();
            if (adapter().fingerprint() !== fingerprint) throw Error('Your patch or Song changed while AI was working. Generate a fresh direction.');
            const recipe = validateRecipe(payload.recipe);
            const combined = { ...current, ...recipe.parameters };
            if (combined.hpfCutoff >= combined.lpfCutoff / 2) throw Error('The proposed filters would remove too much sound. Try again.');
            if (!Object.entries(recipe.parameters).some(([key, value]) => current[key] !== value)) throw Error('No control changes proposed. Try a contrasting direction.');
            proposal = { recipe, current, fingerprint };
            show(recipe, current);
            apply();
        } catch (error) {
            if (token === serial && !locked) status(error.message || 'AI unavailable. Your patch is unchanged.');
        } finally {
            root.clearTimeout(timeout);
            if (token === serial) { request = null; update(); }
        }
    }
    function apply() {
        if (!proposal || previous || locked) return;
        try {
            const before = Object.fromEntries(Object.keys(proposal.recipe.parameters).map(key => [key, proposal.current[key]]));
            const result = adapter().write(proposal.recipe.parameters, proposal.fingerprint);
            previous = { values: before, fingerprint: adapter().fingerprint(), saved: result.saved };
            const count = Object.entries(proposal.recipe.parameters).filter(([key, value]) => proposal.current[key] !== value).length;
            status(result.saved ? `Applied ${count} parameter changes and autosaved. Listen using your usual controls. Keep finishes this choice; Undo restores the changed controls.` : `Applied ${count} parameter changes, but autosave is unavailable. Export this patch to keep a copy. Undo is still available.`);
        } catch (error) { proposal = null; status(error.message); }
        update();
    }
    function undo() {
        if (!previous || locked) return;
        try {
            // Original controls may be outside the beta's narrower generation bounds.
            const result = adapter().write(previous.values, previous.fingerprint, { undo: true });
            previous = null;
            proposal = null;
            byId('aiPatchProposal').hidden = true;
            status(result.saved ? 'Undone. The previous control values are restored.' : 'Undone in this session, but autosave is unavailable. Export the restored patch to keep a copy.');
        } catch (error) { status(`${error.message} Undo has not overwritten your newer edits. Keep current to continue.`); }
        update();
    }
    async function initialize() {
        if (!byId('aiPatchCard')) return;
        byId('aiPatchGenerate').addEventListener('click', generate);
        byId('aiPatchCancel').addEventListener('click', () => cancel());
        byId('aiPatchUndo').addEventListener('click', undo);
        byId('aiPatchKeep').addEventListener('click', () => {
            const saved = previous?.saved;
            previous = null; proposal = null;
            byId('aiPatchProposal').hidden = true;
            status(saved ? 'Kept. Save or export the patch as usual when you want a named copy.' : 'Kept for this session. Autosave was unavailable; export this patch to keep a copy.'); update();
        });
        document.querySelectorAll('[data-ai-patch-example]').forEach(button => button.addEventListener('click', () => {
            if (!request && !previous && !locked) { byId('aiPatchPrompt').value = button.dataset.aiPatchExample; byId('aiPatchPrompt').focus(); }
        }));
        root.addEventListener('mygrain-account-lock', () => { locked = true; previous = null; cancel('Sign in again to use AI Patch Direction.'); });
        root.addEventListener('pagehide', () => cancel());
        update();
        try {
            const response = await root.fetch(new URL('ai-patch-controls.json?v=20261019-ai-1', document.baseURI), { credentials: 'same-origin' });
            if (!response.ok) throw Error();
            const schema = await response.json();
            if (schema.version !== 1 || !schema.controls || Object.keys(schema.controls).length !== 21) throw Error();
            controls = schema.controls;
            update();
        } catch { status('AI beta could not load. Reload to try again. Your other controls still work.'); }
    }
    root.mygrainAiPatch = Object.freeze({ generate, apply, undo, cancel, get ready() { return Boolean(controls); }, get busy() { return Boolean(request); } });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
    else void initialize();
})(window);
