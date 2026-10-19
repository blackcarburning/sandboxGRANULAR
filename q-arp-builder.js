(function (root) {
    'use strict';

    const theory = root.MygrainQTheory;

    class Builder {
        constructor(controller) {
            this.controller = controller;
            this.presets = [];
            this.busy = false;
            this.overlay = document.createElement('div');
            this.overlay.id = 'qArpOverlay';
            this.overlay.dataset.mygrainWorkspace = 'q-arp';
            this.overlay.className = 'sample-browser-overlay';
            this.overlay.hidden = true;
            this.overlay.setAttribute('aria-hidden', 'true');
            this.overlay.innerHTML = `<section class="q-arp-shell" role="dialog" aria-modal="true" aria-labelledby="qArpTitle">
                <header class="sample-browser-head"><h3 id="qArpTitle">Q Custom Arpeggiator</h3><button type="button" class="performance-btn" id="qArpClose">Close</button></header>
                <p class="q-arp-help">Columns are arp pulses; rows choose the chord's notes, lowest first. Tap Gap for silence. Ranks wrap to the chord size. Gaps keep their place in the rhythm.</p>
                <div class="q-arp-settings">
                    <label>Pattern length <input id="qArpLength" type="number" min="1" max="32" step="1"></label>
                    <label>Arp time <select id="qArpDivision"></select></label>
                    <label>Repeat <select id="qArpRepeat"><option value="once">One cycle</option><option value="until-next">Until next chord / rest</option></select></label>
                </div>
                <div class="q-arp-grid-scroll" tabindex="0" aria-label="Note-order grid; scroll for later pulses"><div id="qArpGrid" role="group" aria-label="Custom note order"></div></div>
                <div class="q-arp-repository">
                    <label>Global arp repository <select id="qArpPresets"><option value="">Choose a server preset…</option></select></label>
                    <div class="q-toolbar"><button type="button" class="performance-btn" id="qArpRefresh">Refresh</button><button type="button" class="performance-btn" id="qArpLoad">Load selected</button></div>
                    <label>New preset name <input id="qArpName" type="text" maxlength="80" placeholder="Name this arp"></label>
                    <div class="q-toolbar"><button type="button" class="performance-btn" id="qArpSave">Save new to server</button><button type="button" class="performance-btn" id="qArpApply">Apply to Q</button></div>
                </div>
                <p id="qArpStatus" role="status" aria-live="polite">Patterns are shared server presets, not browser data. Applying embeds the pattern in Q and future Song parts.</p>
            </section>`;
            document.body.append(this.overlay);
            this.element('Division').replaceChildren(...document.getElementById('bastardLoopQArpDivision').cloneNode(true).children);
            this.element('Close').addEventListener('click', () => this.close());
            this.element('Apply').addEventListener('click', () => this.apply());
            this.element('Refresh').addEventListener('click', () => this.refresh());
            this.element('Load').addEventListener('click', () => this.loadSelected());
            this.element('Save').addEventListener('click', () => this.save());
            this.element('Length').addEventListener('change', () => {
                if (!this.draft || this.overlay.hidden) return;
                const count = Math.round(theory.clamp(this.element('Length').value, 1, 32, this.draft.steps.length));
                this.draft.steps = Array.from({ length: count }, (_, index) => this.draft.steps[index] ?? 0);
                this.draw();
            });
            this.element('Grid').addEventListener('click', event => {
                const button = event.target.closest('[data-arp-column]');
                if (!button) return;
                const column = Number(button.dataset.arpColumn);
                const rank = Number(button.dataset.arpRank);
                this.draft.steps[column] = this.draft.steps[column] === rank ? 0 : rank;
                this.draw(false);
            });
            this.overlay.addEventListener('keydown', event => {
                event.stopPropagation();
                if (event.key === 'Escape') { event.preventDefault(); this.close(); }
                if (event.key === 'Tab') {
                    const controls = [...this.overlay.querySelectorAll('button, select, input, [tabindex="0"]')].filter(element => !element.disabled && element.getClientRects().length);
                    if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1).focus(); }
                    if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
                }
            });
            root.addEventListener('resize', () => this.viewport());
            root.visualViewport?.addEventListener('resize', () => this.viewport());
            root.visualViewport?.addEventListener('scroll', () => this.viewport());
        }

        element(name) { return document.getElementById(`qArp${name}`); }

        status(message, error = false) {
            this.element('Status').textContent = message;
            this.element('Status').classList.toggle('q-error', error);
        }

        viewport() {
            if (this.overlay.hidden) return;
            const viewport = root.visualViewport;
            this.overlay.style.setProperty('--arp-height', `${viewport?.height || root.innerHeight}px`);
            this.overlay.style.setProperty('--arp-width', `${viewport?.width || root.innerWidth}px`);
            this.overlay.style.setProperty('--arp-top', `${viewport?.offsetTop || 0}px`);
            this.overlay.style.setProperty('--arp-left', `${viewport?.offsetLeft || 0}px`);
        }

        open() {
            this.returnFocus = document.activeElement;
            const state = this.controller.state;
            this.draft = { version: 1, steps: state.arpSteps.slice(), division: state.arpDivision, repeat: state.arpRepeat };
            this.element('Division').value = String(this.draft.division);
            this.element('Repeat').value = this.draft.repeat;
            this.draw();
            this.overlay.hidden = false;
            this.overlay.setAttribute('aria-hidden', 'false');
            document.body.classList.add('q-arp-open');
            this.viewport();
            this.element('Close').focus({ preventScroll: true });
            this.refresh();
        }

        close() {
            this.overlay.hidden = true;
            this.overlay.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('q-arp-open');
            this.returnFocus?.focus({ preventScroll: true });
        }

        draw(rebuild = true) {
            this.element('Length').value = String(this.draft.steps.length);
            const grid = this.element('Grid');
            if (rebuild) {
                grid.style.gridTemplateColumns = `42px repeat(${this.draft.steps.length}, 34px)`;
                grid.replaceChildren();
                const heading = document.createElement('span'); heading.textContent = 'Note'; grid.append(heading);
                this.draft.steps.forEach((rank, column) => { const label = document.createElement('span'); label.textContent = String(column + 1); grid.append(label); });
                for (const rank of [8, 7, 6, 5, 4, 3, 2, 1, 0]) {
                    const label = document.createElement('span'); label.className = 'q-arp-row-label'; label.textContent = rank ? String(rank) : 'Gap'; grid.append(label);
                    this.draft.steps.forEach((value, column) => {
                        const button = document.createElement('button');
                        button.type = 'button'; button.className = 'q-arp-cell';
                        button.dataset.arpColumn = String(column); button.dataset.arpRank = String(rank);
                        button.setAttribute('aria-label', `Pulse ${column + 1}: ${rank ? `chord note ${rank}` : 'gap'}`);
                        button.textContent = rank ? '●' : '–'; grid.append(button);
                    });
                }
            }
            grid.querySelectorAll('[data-arp-column]').forEach(button => {
                const selected = this.draft.steps[Number(button.dataset.arpColumn)] === Number(button.dataset.arpRank);
                button.setAttribute('aria-pressed', String(selected));
            });
        }

        pattern() {
            return { version: 1, steps: this.draft.steps.slice(), division: Number(this.element('Division').value), repeat: this.element('Repeat').value };
        }

        apply() {
            const pattern = this.pattern();
            const state = this.controller.state;
            state.arpEnabled = true;
            state.arpPattern = 'custom';
            state.arpSteps = pattern.steps;
            state.arpDivision = pattern.division;
            state.arpRepeat = pattern.repeat;
            const preview = this.controller.preview?.chord;
            this.controller.changed({ preserveSamples: true, live: true });
            if (preview) this.controller.task(() => this.controller.audition(preview));
            this.status(`Applied ${pattern.steps.length} pulses (${pattern.steps.filter(rank => rank === 0).length} gaps) to Q. New Song parts include this pattern.`);
        }

        setBusy(value) {
            this.busy = value;
            for (const name of ['Save', 'Refresh', 'Load']) this.element(name).disabled = value;
        }

        async request(options = {}) {
            const response = await fetch(new URL('api/arps', document.baseURI), { cache: 'no-store', credentials: 'same-origin', ...options });
            const body = await response.json();
            if (!response.ok || body.ok !== true) throw new Error(body.error || 'The arp repository is unavailable.');
            if (!Array.isArray(body.presets) || body.presets.some(preset => !theory.validArpSteps(preset.pattern?.steps))) throw new Error('The server returned an invalid arp library.');
            return body;
        }

        displayLibrary(body, selected = this.element('Presets').value) {
            this.presets = body.presets;
            const select = this.element('Presets'); select.replaceChildren();
            const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose a server preset…'; select.append(placeholder);
            for (const preset of this.presets) {
                const option = document.createElement('option'); option.value = preset.id; option.textContent = `${preset.name} · ${preset.pattern.steps.length} pulses`; select.append(option);
            }
            select.value = this.presets.some(preset => preset.id === selected) ? selected : '';
        }

        async refresh() {
            if (this.busy) return;
            this.setBusy(true); this.status('Loading the shared arp repository from the server…');
            try { const body = await this.request(); this.displayLibrary(body); this.status(`${body.presets.length} server presets available. Edit the grid, then Apply to Q or Save new to server.`); }
            catch (error) { this.status(error.message, true); }
            finally { this.setBusy(false); }
        }

        loadSelected() {
            const preset = this.presets.find(entry => entry.id === this.element('Presets').value);
            if (!preset) { this.status('Choose a server preset first.', true); return; }
            this.draft = theory.copy(preset.pattern);
            this.element('Division').value = String(this.draft.division);
            this.element('Repeat').value = this.draft.repeat;
            this.element('Name').value = '';
            this.draw(); this.status(`Loaded ${preset.name}. Press Apply to Q to use it; saving creates a new preset.`);
        }

        async save() {
            if (this.busy) return;
            const name = this.element('Name').value.trim();
            if (!name) { this.status('Give the preset a name before saving.', true); return; }
            const pattern = this.pattern();
            this.setBusy(true); this.status('Saving this arp to the global server repository…');
            try {
                const body = await this.request({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, pattern }) });
                this.displayLibrary(body, body.savedId);
                this.status(`Saved “${name}” on the server for all devices. Press Apply to Q to use the pattern.`);
            } catch (error) { this.status(`Not saved: ${error.message}`, true); }
            finally { this.setBusy(false); }
        }
    }

    root.MygrainQArp = { Builder };
})(typeof window === 'object' ? window : globalThis);
