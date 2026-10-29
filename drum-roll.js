// Independent snare Roll pattern. Never normalized to the main drum grid.
(function (root) {
    'use strict';
    const MAX_STEPS = 1024, PAGE_STEPS = 32;
    const mod = (n, length) => ((n % length) + length) % length;
    function normalize(value) {
        const n = Number(value?.length ?? 64);
        const length = Number.isFinite(n) ? Math.max(1, Math.min(MAX_STEPS, Math.round(n))) : 64;
        const pattern = Array.from({length}, (_, i) => value?.pattern?.[i] === true);
        const ratchets = Array.from({length}, (_, i) => pattern[i] ? Math.max(1, Math.min(8, Math.round(Number(value?.ratchets?.[i]) || 1))) : 0);
        const dipValue = Number(value?.dip ?? 0);
        const dip = Number.isFinite(dipValue) ? Math.max(0, Math.min(100, dipValue)) : 0;
        // Pre-checkbox saves used a global Dip. Mark their existing notes to retain the sound.
        const dips = Array.from({length}, (_, i) => Array.isArray(value?.dips) ? value.dips[i] === true : dip > 0 && pattern[i]);
        const accents = Array.from({length}, (_, i) => value?.accents?.[i] === true);
        return {version: 1, length, pattern, ratchets, dip, dips, accents};
    }
    function validate(value) {
        if (value == null) return;
        if (value.dip !== undefined && (typeof value.dip !== 'number' || !Number.isFinite(value.dip) || value.dip < 0 || value.dip > 100)) throw new Error('Invalid snare Roll dip.');
        if (value.accents !== undefined && (!Array.isArray(value.accents) || value.accents.length !== value.length || value.accents.some(x => typeof x !== 'boolean'))) throw new Error('Invalid snare Roll accent steps.');
        if (value.dips !== undefined && (!Array.isArray(value.dips) || value.dips.length !== value.length || value.dips.some(x => typeof x !== 'boolean'))) throw new Error('Invalid snare Roll dip steps.');
        if (value.version !== 1 || !Number.isInteger(value.length) || value.length < 1 || value.length > MAX_STEPS
            || !Array.isArray(value.pattern) || value.pattern.length !== value.length || value.pattern.some(x => typeof x !== 'boolean')
            || !Array.isArray(value.ratchets) || value.ratchets.length !== value.length || value.ratchets.some(x => !Number.isInteger(x) || x < 0 || x > 8)) throw new Error('Invalid snare Roll pattern.');
    }
    function eventAt(state, index) {
        const step = mod(index, state.length);
        return state.pattern[step] ? {step, count: Math.max(1, Math.min(8, state.ratchets[step] || 1))} : null;
    }
    const gcd = (a, b) => b ? gcd(b, a % b) : a;
    const cycleSteps = (baseSteps, length) => baseSteps / gcd(baseSteps, length) * length;
    function mount(options) {
        const {document: doc, get, edit, playing, sampleDescription} = options;
        let page = 0, visual = -1, renderedLength, renderSignature, currentButton = null;
        const layout = doc.querySelector('#drumMachineOverlay .drum-machine-layout');
        const card = doc.createElement('article'); card.id = 'drumMachineLane-roll'; card.className = 'drum-machine-track-card'; card.setAttribute('aria-label', 'Snare Roll track');
        card.innerHTML = `<div class="drum-machine-track-head"><div class="drum-machine-track-copy"><div class="performance-chip">Snare Roll</div><p id="drumMachineRollMeta"></p></div><div class="drum-machine-track-actions"><button class="performance-btn" id="drumMachineRollClearBtn" type="button">Clear Roll</button></div></div><div class="drum-roll-controls"><label>Roll length (steps)<input id="drumMachineRollLength" type="number" min="1" max="${MAX_STEPS}" step="1" inputmode="numeric"></label><label>Steps shown<select id="drumMachineRollPage"></select></label><label for="drumMachineRollDip">Dip <output id="drumMachineRollDipValue">0%</output><input id="drumMachineRollDip" type="range" min="0" max="100" step="1" value="0" title="Reduce checked Roll notes only; 0% unchanged, 100% silent"></label><output id="drumMachineRollPosition" aria-label="Roll playback position"></output></div><div class="drum-machine-track-meta"><span>Uses Snare · Roll overrides overlapping Snare hits</span><span>Dip box + ratchet above · Tap = step</span></div><div id="drumMachineRollGrid" class="drum-machine-step-grid" role="group" aria-label="Snare Roll pattern grid"></div>`;
        layout.append(card);
        const nav = doc.querySelector('.drum-machine-jumps'), tab = doc.createElement('button');
        tab.type = 'button'; tab.className = 'performance-btn'; tab.textContent = 'Roll'; tab.dataset.drumJump = 'roll'; tab.setAttribute('aria-controls', card.id);
        tab.addEventListener('click', () => { layout.scrollTo({top: card.offsetTop - layout.offsetTop, behavior: 'auto'}); nav.querySelectorAll('button').forEach(button => button.setAttribute('aria-current', String(button === tab))); }); nav.append(tab);
        const input = doc.getElementById('drumMachineRollLength'), select = doc.getElementById('drumMachineRollPage'), grid = doc.getElementById('drumMachineRollGrid');
        const dip = doc.getElementById('drumMachineRollDip');
        dip.addEventListener('input', () => {
            const value = Number(dip.value);
            if (value !== (get().dip ?? 0)) edit('Roll dip', () => { get().dip = value; });
        });
        const lengthLocked = () => {
            if (!playing()) return false;
            input.value = get().length;
            options.lengthBlocked();
            return true;
        };
        input.addEventListener('click', lengthLocked);
        input.addEventListener('change', () => {
            if (lengthLocked()) return;
            const length = Number(input.value);
            if (!Number.isInteger(length) || length < 1 || length > MAX_STEPS) { input.value = get().length; return; }
            if (length !== get().length) edit('Roll length', () => { options.set(normalize({...get(), length})); page = Math.min(page, Math.floor((length - 1) / PAGE_STEPS)); });
        });
        input.addEventListener('keydown', event => {
            if (playing() && !event.ctrlKey && !event.metaKey && (/^[0-9.+-]$/.test(event.key) || ['ArrowUp', 'ArrowDown', 'Backspace', 'Delete', 'Enter', ' '].includes(event.key))) {
                event.preventDefault(); lengthLocked(); return;
            }
            if (event.key === 'Enter') input.blur();
        });
        select.addEventListener('change', () => { page = Number(select.value); render(); });
        const clear = doc.getElementById('drumMachineRollClearBtn');
        clear.textContent = 'Clear lane';
        clear.title = 'Clear Snare Roll steps and ratchets; keep the Snare sound and Roll length';
        clear.setAttribute('aria-label', 'Clear Snare Roll lane');
        clear.addEventListener('click', () => edit('Clear Roll', () => options.set(normalize({length: get().length, dip: get().dip}))));
        function reflect(index = visual) {
            visual = index;
            if (!playing()) { currentButton?.classList.remove('current'); currentButton = null; }
            if (doc.hidden || doc.getElementById('drumMachineOverlay').hidden) return;
            if (root.isPerformanceElementVisible && !root.isPerformanceElementVisible(card)) return;
            const next = playing() && index >= page * PAGE_STEPS && index < (page + 1) * PAGE_STEPS
                ? grid.children[index - page * PAGE_STEPS]?.querySelector('.drum-machine-step-btn') : null;
            if (next !== currentButton) {
                currentButton?.classList.remove('current');
                next?.classList.add('current');
                currentButton = next;
            }
            const position = doc.getElementById('drumMachineRollPosition');
            const text = playing() && index >= 0 ? `Step ${index + 1} / ${get().length}` : `${get().length} steps`;
            if (position.textContent !== text) position.textContent = text;
        }
        function render() {
            const state = get();
            if (Number(dip.value) !== (state.dip ?? 0)) dip.value = state.dip ?? 0;
            doc.getElementById('drumMachineRollDipValue').textContent = `${state.dip ?? 0}%`;
            page = Math.min(page, Math.floor((state.length - 1) / PAGE_STEPS));
            // Read-only, not disabled: a tap must explain why length is locked.
            input.readOnly = playing();
            input.setAttribute('aria-readonly', String(playing()));
            if (renderedLength !== state.length) {
                input.value = state.length;
                select.replaceChildren();
                for (let start = 0; start < state.length; start += PAGE_STEPS) {
                    const option = doc.createElement('option'); option.value = start / PAGE_STEPS; option.textContent = `${start + 1}–${Math.min(start + PAGE_STEPS, state.length)}`; select.append(option);
                }
                renderedLength = state.length;
            }
            select.value = page;
            const meta = doc.getElementById('drumMachineRollMeta'), description = `Repeats every ${state.length} steps, independently of the drum grid. ${sampleDescription()}`;
            if (meta.textContent !== description) meta.textContent = description;
            // Transport/UI refreshes must not replace controls under a finger.
            // Event handlers read current state, including after snapshot recall.
            const signature = JSON.stringify([page, state.length, state.pattern, state.ratchets, state.dips, state.accents]);
            if (signature === renderSignature) { reflect(); return; }
            renderSignature = signature;
            currentButton = null;
            grid.replaceChildren();
            for (let i = page * PAGE_STEPS; i < Math.min(state.length, (page + 1) * PAGE_STEPS); i++) {
                const cell = doc.createElement('div'); cell.className = 'drum-machine-step-cell';
                const ratchet = doc.createElement('button'); ratchet.type = 'button'; ratchet.className = 'drum-machine-ratchet-btn'; ratchet.textContent = `×${state.ratchets[i] || 1}`; ratchet.setAttribute('aria-label', `Roll step ${i + 1} ratchet ${state.ratchets[i] || 1}`);
                ratchet.addEventListener('click', () => edit('Roll ratchet', () => { const current = get(); current.pattern[i] = true; current.ratchets[i] = (current.ratchets[i] || 1) % 8 + 1; }));
                const button = doc.createElement('button'); button.type = 'button'; button.className = 'drum-machine-step-btn'; button.classList.toggle('active', state.pattern[i]); button.dataset.rollStep = i; button.textContent = i + 1; button.setAttribute('aria-label', `Roll step ${i + 1}`); button.setAttribute('aria-pressed', String(state.pattern[i]));
                button.addEventListener('click', () => edit('Roll step', () => { const current = get(); current.pattern[i] = !current.pattern[i]; current.ratchets[i] = current.pattern[i] ? current.ratchets[i] || 1 : 0; }));
                const dipButton = doc.createElement('button'); dipButton.type = 'button'; dipButton.className = 'drum-machine-accent-btn drum-machine-dip-btn';
                dipButton.classList.toggle('active', Boolean(state.dips?.[i])); dipButton.textContent = 'Dip'; dipButton.dataset.rollDipStep = i;
                dipButton.setAttribute('aria-label', `Roll step ${i + 1} dip`); dipButton.setAttribute('aria-pressed', String(Boolean(state.dips?.[i])));
                dipButton.title = 'Apply the Dip slider level to this note and its ratchets';
                dipButton.addEventListener('click', () => edit('Roll note dip', () => { const current = get(); current.dips[i] = !current.dips[i]; }));
                const accentButton = doc.createElement('button'); accentButton.type = 'button'; accentButton.className = 'drum-machine-accent-btn';
                accentButton.textContent = 'Accent'; accentButton.dataset.rollAccentStep = i;
                accentButton.classList.toggle('active', Boolean(state.accents?.[i]));
                accentButton.setAttribute('aria-label', `Roll step ${i + 1} accent`); accentButton.setAttribute('aria-pressed', String(Boolean(state.accents?.[i])));
                accentButton.addEventListener('click', () => edit('Roll note accent', () => { const current = get(); current.accents ||= Array(current.length).fill(false); current.accents[i] = !current.accents[i]; }));
                cell.append(accentButton, dipButton, ratchet, button); grid.append(cell);
            }
            reflect();
        }
        render(); return {render, reflect};
    }
    const api = {MAX_STEPS, normalize, validate, eventAt, cycleSteps, mount};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.MygrainDrumRoll = api;
})(typeof window !== 'undefined' ? window : globalThis);
