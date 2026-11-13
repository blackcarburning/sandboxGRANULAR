(function (root) {
    'use strict';

    const palette = Object.freeze({
        song: '#b8efbe',
        'ai-patch': '#ff299b',
        mega: 'linear-gradient(180deg, rgba(8, 54, 70, 0.96), rgba(17, 103, 125, 0.96))',
        sparse: 'linear-gradient(180deg, rgba(74, 46, 10, 0.96), rgba(138, 98, 18, 0.96))',
        keyboard: '#b4c5ff',
        'granular-keys': '#85d6ed',
        synth: '#e1bbff',
        transport: 'linear-gradient(180deg, rgba(72, 20, 28, 0.96), rgba(128, 32, 46, 0.96))',
        top: '#dae2eb',
        'loop-a': '#ffad91',
        'loop-b': '#f3bc75',
        'loop-c': '#ece276',
        'loop-v': '#ff9dbb',
        'loop-w': '#87e1c6',
        'loop-d': '#008cff',
        mutilator: '#58b787',
        cookingPot: '#f3b35e',
        partsBin: '#55c99f',
        bassFace: '#58b787', // Same palette, independent linked-power navigation state.
        radiolab: '#78e0d0',
        videolab: '#bcc8ef',
        'loop-p': '#c2de80',
        'loop-o': '#89dba7',
        'loop-l': '#8bcce5',
        'loop-x': '#b6b0ff',
        'loop-q': '#d6a1ed',
        'loop-m': '#f5acd8',
        'loop-m-plus': '#e6c0a0',
        'loop-k': '#b7d4bc',
        'noise-n': '#91cbd4',
        drums: '#e9a28c',
        sample: '#9ed6d9',
        layers: '#a4e8cb',
        mixer: '#ffc28e',
        'quick-grain': '#c2c8ed',
        filter: '#b6d76d',
        actions: '#dfb0f2',
        export: '#edc677',
        'wav-browser': '#8cbce3',
        'loop-store': 'linear-gradient(180deg, #9c4c13, #70330c)',
        'loop-store-render': 'linear-gradient(180deg, #ffad45, #f18418)',
        'stem-export': '#e3d0a5',
        daw: '#4c9ce6',
        'daw-input': '#318cff',
        grain: '#92c9bc',
        mix: '#e8b5a6',
        lfo: '#b5ca83',
        fx: '#c3b3d8',
        delay: '#d8b1c0',
        reverb: '#9fbbca',
        sources: '#d5cea1',
        waveforms: '#9fb8ef',
        'source-wave': '#7ed9f0',
        'wave-a': '#c6dbb1',
        'wave-b': '#dec1e7',
        playground: 'repeating-linear-gradient(125deg,#2a8c62 0px,#2a8c62 16px,#174936 16px,#174936 28px)',
        wasp: 'repeating-linear-gradient(125deg, #ffdc38 0px, #ffdc38 16px, #e23c30 16px, #e23c30 28px)',
        turntable: '#c19a67',
        resonator: '#e8a278',
        wireWorld: '#ffba76', sonicCrystal: '#95fbd9', bubbleChamber: '#a6ccff',
        pan: '#efc4cf'
    });
    const foreground = '#f2f6ff';
    const states = Object.freeze({
        'loop-store': Object.freeze({ color: '#fff4e8', border: '#d47b35' }),
        'loop-store-render': Object.freeze({ color: '#3b1c04', border: '#ffc477' }),
        wasp: Object.freeze({ color: '#21170e', border: '#ffdc38' }),
        playground: Object.freeze({ color: '#f0fff5', border: '#6be2ae' }),
        mega: Object.freeze({ color: '#dffcff', border: 'rgba(126, 246, 255, 0.4)' }),
        sparse: Object.freeze({ color: '#fff2cc', border: 'rgba(255, 212, 102, 0.42)' }),
        transport: Object.freeze({ color: '#ffe0e4', border: 'rgba(255, 116, 142, 0.42)' }),
        running: Object.freeze({
            background: 'linear-gradient(180deg, rgba(11, 72, 40, 0.96), rgba(24, 148, 78, 0.96))',
            color: '#e4fff1', border: 'rgba(116, 255, 171, 0.44)'
        })
    });
    const appearances = Object.freeze(Object.fromEntries(Object.entries(palette).map(([section, background]) => {
        if (!background.startsWith('#')) return [section, Object.freeze({ background, ...states[section] })];
        const channels = background.slice(1).match(/../g).map(channel => parseInt(channel, 16));
        const floor = Math.min(...channels) * 0.78;
        const stops = [0.42, 0.78].map(scale => channels.map(channel => Math.round((channel - floor) * scale)).join(', '));
        return [section, Object.freeze({
            background: `linear-gradient(180deg, rgba(${stops[0]}, 0.96), rgba(${stops[1]}, 0.96))`,
            color: foreground,
            border: `rgba(${channels.join(', ')}, 0.48)`
        })];
    })));
    const targets = Object.freeze({
        '#songBetaCard': 'song',
        '#aiPatchCard': 'ai-patch',
        '.performance-keyboard-card': 'keyboard',
        '.synth-container': 'synth',
        '.performance-toolbar': 'top',
        '[aria-label="Bastardloop controls"]': 'loop-a',
        '[aria-label="Bastardloop B controls"]': 'loop-b',
        '[aria-label="Bastardloop C controls"]': 'loop-c',
        '[aria-label="Bastardloop V controls"]': 'loop-v',
        '[aria-label="Bastardloop W controls"]': 'loop-w',
        '[aria-label="Bastardloop D controls"]': 'loop-d',
        '#radiolabCard': 'radiolab',
        '#performanceVideoLabCard': 'videolab',
        '[aria-label="Bastardloop P controls"]': 'loop-p',
        '[aria-label="Bastardloop O controls"]': 'loop-o',
        '[aria-label="Bastardloop L controls"]': 'loop-l',
        '[aria-label="Bastardloop X controls"]': 'loop-x',
        '#bastardLoopQCard': 'loop-q',
        '[aria-label="Bastardloop M controls"]': 'loop-m',
        '[aria-label="Bastardloop M+ controls"]': 'loop-m-plus',
        '#bastardLoopKCard': 'loop-k',
        '#noiseCard': 'noise-n',
        '#turntableCard': 'turntable',
        '#resonatorCard': 'resonator',
        '[aria-label="Bastardloop K controls"]': 'loop-k',
        '[aria-label="Drum machine controls"]': 'drums',
        '[aria-label="Dropbox sample layer controls"]': 'sample',
        '#performanceLayerSwitchesCard': 'layers',
        '#performanceMixerCard': 'mixer',
        '[aria-label="Mixer controls"]': 'mixer',
        '#performanceGrainQuickControlsCard': 'quick-grain',
        '#performanceFilterCard': 'filter',
        '[aria-label="Filter controls"]': 'filter',
        '.performance-actions-card': 'actions',
        '[aria-label="Main panel controls"]': 'actions',
        '.performance-export-card': 'export',
        '#performanceWavBrowserBtn': 'wav-browser',
        '#performanceLoopStoreBrowserBtn': 'loop-store',
        '#performanceLoopStoreAddBtn': 'loop-store-render',
        '#performanceStemExportCard': 'stem-export',
        '#dawExportCard': 'daw',
        '#dawInputCard': 'daw-input',
        '#performanceGrainControlsCard': 'grain',
        '[aria-label="Mix controls"]': 'mix',
        '#performanceLfoCard': 'lfo',
        '[aria-label="LFO controls"]': 'lfo',
        '#internalEffectsPanel': 'fx',
        '#internalDelayCard': 'delay',
        '#internalReverbCard': 'reverb',
        '.recording-section': 'sources',
        '#grainWaveformEditors': 'waveforms',
        '#generatedWaveformEditor': 'source-wave',
        '#grainAWaveformEditor': 'wave-a',
        '#grainBWaveformEditor': 'wave-b',
        '#waspCard': 'wasp',
        '#filterPlaygroundCard': 'playground',
        '#loopDMutilator': 'mutilator',
        '#bassFaceCard': 'bassFace',
        '#cookingPotCard': 'cookingPot',
        '#partsBinCard': 'partsBin',
        '#wireWorldCard': 'wireWorld', '#sonicCrystalCard': 'sonicCrystal', '#bubbleChamberCard': 'bubbleChamber',
        '#finalPanSection': 'pan',
        '#performancePanLabResetBtn': 'pan'
    });
    const buttons = Object.freeze({
        sectionJumpMegaRandomBtn: 'mega', sectionJumpMegaRandomPanelBtn: 'mega',
        sectionJumpSparseRandomBtn: 'sparse', sectionJumpSparseRandomPanelBtn: 'sparse',
        sectionJumpTransportBtn: 'transport', sectionJumpTransportPanelBtn: 'transport',
        performanceHoldBtn: 'keyboard', performanceGenerateLoopBtn: 'source-wave',
        performanceGenerateJunkBtn: 'sample', performanceDrumMachineMainStartBtn: 'drums',
        performanceSeqPlayBtn: 'source-wave', performanceLoopDisableBtn: 'source-wave',
        performanceRestartAllBtn: 'transport', performanceMainStopAllBtn: 'transport',
        performanceOscToggleBtn: 'synth', performanceSampleSoloBtn: 'source-wave',
        performanceNoiseOffBtn: 'actions', performanceTonalDrumsBtn: 'drums',
        performanceFxMuteBtn: 'fx', performancePanLabResetBtn: 'pan',
        performanceFinalReverbBtn: 'reverb', performanceFinalFxPlacementBtn: 'fx',
        performanceFinalFxPlacementLfoBtn: 'lfo', performanceDryFilterBtn: 'filter',
        performanceLfoSquareBtn: 'lfo', performanceExportBtn: 'export',
        performanceRepoExportBtn: 'stem-export', performanceWavBrowserBtn: 'wav-browser',
        performanceLoopStoreAddBtn: 'loop-store-render', performanceLoopStoreBrowserBtn: 'loop-store',
        performanceMidiBrowserBtn: 'keyboard', performanceExportPatchBtn: 'export',
        performanceImportPatchBtn: 'sources', performanceKeyboardRecordBtn: 'keyboard',
        performanceKeyboardToKRecordBtn: 'loop-k', performanceExportPatchZipBtn: 'export',
        performancePatchBrowserBtn: 'top', performanceRandomizeBtn: 'actions',
        performanceMegaRandomBtn: 'mega', performanceSparseRandomBtn: 'sparse',
        performanceResetPatchBtn: 'grain', performanceSynthPopupBtn: 'synth',
        performanceDrumMachineMainOpenBtn: 'drums', performanceRecordBtn: 'sources',
        performanceTakeSlot1Btn: 'wave-a', performanceTakeSlot2Btn: 'wave-b',
        performanceTakeSlot3Btn: 'loop-m', performanceTakeSlot4Btn: 'loop-x',
        performanceTakeSlot5Btn: 'loop-q', performanceUploadTakesBtn: 'export',
        performancePanicBtn: 'transport'
    });
    const selector = '.section-jump-option, .section-jump-quick, .performance-layer-jump-btn, [data-jump-target], [data-jump-click], [data-granular-keyboard-ready], .performance-mixer-jump-btn, [data-gain-stage-control], #performanceLayerSwitchesCard button, #performanceMixerCard button, .performance-mixer-solo-btn, .performance-actions-card .performance-actions > .performance-btn';
    let mixerTargets = Object.freeze({});

    function sectionForTarget(targetSelector) {
        if (!targetSelector) return null;
        const normalized = targetSelector.replace(/'/g, '"');
        if (targets[normalized]) return targets[normalized];
        const target = root.document.querySelector(targetSelector);
        if (!target) return null;
        const match = Object.entries(targets).find(([alias]) => target.matches(alias));
        return match?.[1] || null;
    }

    function sectionForButton(button) {
        if (button.dataset.granularKeyboardReady) return 'granular-keys';
        if (buttons[button.id]) return buttons[button.id];
        if (button.closest('.performance-actions-card') && button.dataset.bastardloopStart === 'true') return 'loop-a';
        const controlId = button.dataset.performanceModuleJump || button.getAttribute('aria-controls') || button.dataset.gainStageControl;
        const destination = button.dataset.jumpTarget || button.dataset.jumpClick || mixerTargets[controlId];
        if (destination) return sectionForTarget(destination);
        if (button.dataset.gainStageControl) {
            const control = root.document.getElementById(controlId);
            const closest = control?.closest(Object.keys(targets).join(','));
            const match = Object.entries(targets).find(([alias]) => closest?.matches(alias));
            return match?.[1] || null;
        }
        const layerRow = button.closest('.performance-layer-switch-row');
        if (layerRow?.closest('#performanceLayerSwitchesCard')) {
            return sectionForTarget(layerRow.querySelector('[data-jump-target]')?.dataset.jumpTarget) || 'source-wave';
        }
        const mixerControl = button.closest('.performance-sound-card')?.querySelector('input[type="range"]');
        if (mixerTargets[mixerControl?.id]) return sectionForTarget(mixerTargets[mixerControl.id]);
        if (button.closest('#performanceMixerCard')) return 'mixer';
        if (button.closest('#performanceLayerSwitchesCard')) return 'layers';
        return null;
    }

    function paint(button) {
        const section = sectionForButton(button);
        if (!section || !palette[section]) {
            delete button.dataset.navSection;
            button.style.removeProperty('--nav-background');
            button.style.removeProperty('--nav-foreground');
            button.style.removeProperty('--nav-border');
            button.dataset.navMissing = 'true';
            return;
        }
        delete button.dataset.navMissing;
        button.dataset.navSection = section;
        button.style.setProperty('--nav-background', appearances[section].background);
        button.style.setProperty('--nav-foreground', appearances[section].color);
        button.style.setProperty('--nav-border', appearances[section].border);
        if (section === 'transport') {
            button.style.setProperty('--nav-running-background', states.running.background);
            button.style.setProperty('--nav-running-foreground', states.running.color);
            button.style.setProperty('--nav-running-border', states.running.border);
        }
    }

    const cardSelector = '.performance-feature-card, .performance-layer-switches-card';
    function paintCard(card) {
        const section = Object.entries(targets).find(([alias]) => card.matches(alias))?.[1];
        // Only sound/layer cards change; drums and unrelated utility cards retain their backgrounds.
        if (!section || !(section.startsWith('loop-') || ['radiolab', 'videolab', 'sample', 'keyboard', 'grain', 'quick-grain'].includes(section))) return;
        card.dataset.navCard = section;
        card.style.setProperty('--nav-card-background', appearances[section].background);
    }

    const desktopJumpQuery = '(min-width: 961px) and (hover: hover) and (pointer: fine)';
    let jumpSerial = 0;
    const frame = () => new Promise(resolve => root.requestAnimationFrame(resolve));
    const pause = ms => new Promise(resolve => root.setTimeout(resolve, ms));
    async function settleWithin(promise, ms = 8000) {
        let timer;
        try {
            await Promise.race([Promise.resolve(promise).catch(() => {}), new Promise(resolve => { timer = root.setTimeout(resolve, ms); })]);
        } finally { root.clearTimeout(timer); }
    }
    function cancelDesktopJump() {
        jumpSerial += 1;
        const curtain = root.document.getElementById('desktopJumpCurtain');
        if (curtain) { curtain.hidden = true; curtain.setAttribute('aria-hidden', 'true'); }
        delete root.document.documentElement.dataset.mygrainJumping;
        root.dispatchEvent(new root.CustomEvent('mygrain-jump-change'));
    }
    function transitionJump(action) {
        const curtain = root.document.getElementById('desktopJumpCurtain');
        if (!curtain || root.__mygrainSongRenderDeck) return false;
        const serial = ++jumpSerial;
        const started = root.performance.now();
        curtain.hidden = false;
        curtain.setAttribute('aria-hidden', 'false');
        root.document.documentElement.dataset.mygrainJumping = 'true';
        root.dispatchEvent(new root.CustomEvent('mygrain-jump-change'));
        void (async () => {
            try {
                // Present the opaque curtain before scrolling or changing a panel.
                await frame(); await frame();
                if (serial !== jumpSerial) return;
                const result = await action() || {};
                await settleWithin(result.ready);
                let target = result.resolveTarget?.() || result.target;
                if (target?.matches?.('button, input, .control-group')) target = target.closest('.performance-sound-card, .performance-feature-card, .performance-export-card, .performance-actions-card') || target;
                await Promise.all([
                    settleWithin(root.document.fonts?.ready),
                    ...[...(target?.querySelectorAll?.('img') || [])].map(image => settleWithin(image.decode?.()))
                ]);
                if (serial !== jumpSerial) return;
                if (target?.isConnected && result.block) {
                    target.scrollIntoView({ behavior: 'instant', block: 'start', inline: 'nearest' });
                }
                // Layout and canvas/resize observers get actual painted frames;
                // never expose the intermediate smooth-scroll compositor tiles.
                let previous = '', stable = 0;
                for (let i = 0; i < 45 && stable < 3; i += 1) {
                    await frame();
                    if (serial !== jumpSerial) return;
                    const box = target?.getBoundingClientRect();
                    const next = [root.scrollX, root.scrollY, box?.x, box?.y, box?.width, box?.height].map(n => Math.round(n || 0)).join(',');
                    stable = next === previous ? stable + 1 : 0;
                    previous = next;
                }
                if (target?.isConnected && result.block) target.scrollIntoView({ behavior: 'instant', block: 'start', inline: 'nearest' });
                await pause(Math.max(0, 180 - (root.performance.now() - started)));
                await frame();
            } catch (error) {
                root.console.warn('MYGRAIN jump could not finish.', error);
            } finally {
                // A superseded jump must not reveal a newer destination early.
                if (serial === jumpSerial) cancelDesktopJump();
            }
        })();
        return true;
    }

    function refresh(container = root.document) {
        if (container.matches?.(selector)) paint(container);
        container.querySelectorAll?.(selector).forEach(paint);
        if (container.matches?.(cardSelector)) paintCard(container);
        container.querySelectorAll?.(cardSelector).forEach(paintCard);
    }

    root.mygrainNavigation = Object.freeze({
        palette, appearances, foreground, states, targets, selector, sectionForTarget, sectionForButton, refresh, transitionJump, cancelDesktopJump,
        setMixerTargets(mapping) {
            mixerTargets = Object.freeze({ ...mapping });
            refresh();
        }
    });

    // Display order only: never change the Cooking Pot's saved audio-stage order.
    const effectCardIds = Object.freeze([
        'cookingPotCard', 'turntableCard', 'filterPlaygroundCard', 'loopDMutilator',
        'bassFaceCard', 'waspCard', 'resonatorCard', 'wireWorldCard',
        'sonicCrystalCard', 'bubbleChamberCard', 'masterBakerCard'
    ]);
    function arrangeEffectCards() {
        if (root.__mygrainSongRenderDeck) return;
        const doc = root.document, shell = doc.querySelector('.synth-container');
        if (!shell) return;
        const cards = effectCardIds.map(id => doc.getElementById(id)).filter(Boolean);
        for (const card of cards) {
            card.dataset.mygrainEffectCard = '';
            card.style.order = String(200 + effectCardIds.indexOf(card.id));
        }
        const bin = doc.getElementById('partsBinCard');
        if (bin) bin.style.order = '199';
        // Move existing instances, retaining listeners, controls and lazy placeholders.
        const tail = [...shell.children].slice(-cards.length);
        if (cards.some((card, index) => tail[index] !== card)) shell.append(...cards);
        arrangeJumpButtons();
    }
    const jumpOriginalOrder = new Map();
    function arrangeJumpButtons() {
        const doc = root.document, grid = doc.querySelector('#sectionJumpPanel .section-jump-grid');
        if (!grid) return;
        const desktop = root.matchMedia('(min-width: 961px)').matches;
        for (const child of grid.children) if (!jumpOriginalOrder.has(child)) jumpOriginalOrder.set(child, jumpOriginalOrder.size);
        // Never move a placeholder and its replacement back and forth mid-hydration.
        if (effectCardIds.some(id => grid.querySelectorAll('.section-jump-option[data-jump-target="#' + id + '"]').length > 1)) return;
        const button = selector => grid.querySelector(selector);
        const selected = new Set(), ordered = [];
        const add = node => { if (node && !selected.has(node)) { selected.add(node); ordered.push(node); } };
        {
            for (const selector of [
                '#sectionJumpInitialisePanelBtn', '[data-jump-target=".performance-toolbar"]',
                '#sectionJumpAiBtn', '#sectionJumpCookingPotBtn', '#sectionJumpPartsBinBtn', '#sectionJumpMasterBakerBtn', '#sectionJumpSongBtn',
                '#sectionJumpLayerSwitchBtn', '#sectionJumpBastardMixerBtn',
                '#sectionJumpMegaRandomBtn', '#sectionJumpSparseRandomBtn',
                '#sectionJumpFinalMixBtn', '[data-jump-click="#performanceWavBrowserBtn"]',
                '#sectionJumpLoopStoreAddBtn', '[data-jump-click="#performanceLoopStoreBrowserBtn"]',
                '#sectionJumpKeyboardBtn', '#sectionJumpActionsBtn',
                '[data-jump-target="[aria-label=\'Drum machine controls\']"]', '[data-jump-target="#genreatorCard"]'
            ]) add(button(selector));
            const wide = ordered.slice(0, 7);
            for (const child of grid.children) child.classList.toggle('desktop-jump-wide', wide.includes(child));
        }
        const effects = new Set([
            ...['[aria-label=\'Filter controls\']', '#internalEffectsPanel', '#internalDelayCard', '#internalReverbCard'],
            ...effectCardIds.map(id => '#' + id)
        ]);
        const rest = [...grid.children].filter(node => !selected.has(node) && !effects.has(node.dataset.jumpTarget));
        // Loop order is explicit: parked/detached card geometry must not reshuffle it.
        const loopOrder = ['Loop A', 'Loop B', 'Loop C', 'Loop D', 'Loop V', 'Loop W', 'Loop P', 'Loop O', 'Loop L', 'Loop X', 'Loop Q', 'Loop M', 'Loop M+', 'Loop K'];
        rest.sort((a, b) => {
            const ai = loopOrder.indexOf(a.textContent.trim()), bi = loopOrder.indexOf(b.textContent.trim());
            if (ai >= 0 || bi >= 0) return (ai < 0 ? loopOrder.length : ai) - (bi < 0 ? loopOrder.length : bi);
            return jumpOriginalOrder.get(a) - jumpOriginalOrder.get(b);
        });
        rest.forEach(add);
        for (const selector of effects) [...grid.children].filter(node => node.dataset.jumpTarget === selector).forEach(add);
        if (ordered.some((node, index) => grid.children[index] !== node)) grid.append(...ordered);
    }
    function initializeEffectCardOrder() {
        if (root.__mygrainSongRenderDeck) return;
        arrangeEffectCards();
        const shell = root.document.querySelector('.synth-container');
        const grid = root.document.querySelector('#sectionJumpPanel .section-jump-grid');
        if (!shell) return;
        const observer = new MutationObserver(records => {
            if (records.some(record => record.target === shell || record.target === grid ||
                [...record.addedNodes, ...record.removedNodes].some(node =>
                    node.nodeType === 1 && (effectCardIds.includes(node.id) ||
                    effectCardIds.some(id => node.querySelector?.('#' + id)))))) arrangeEffectCards();
        });
        observer.observe(shell, { childList: true, subtree: true });
        if (grid) observer.observe(grid, { childList: true });
    }

    function initialize() {
        initializeEffectCardOrder();
        refresh();
        initializeDesktopDock();
        initializePhoneEdgeShortcuts();
        initializeRenderActions();
        root.matchMedia(desktopJumpQuery).addEventListener('change', cancelDesktopJump);
        root.addEventListener('pagehide', cancelDesktopJump);
        root.document.addEventListener('visibilitychange', () => { if (root.document.hidden) cancelDesktopJump(); });
        root.document.addEventListener('keydown', event => { if (event.key === 'Escape') cancelDesktopJump(); });
        const observer = new MutationObserver(records => {
            for (const record of records) {
                if (record.type === 'attributes') refresh(record.target);
                else record.addedNodes.forEach(node => refresh(node));
            }
        });
        observer.observe(root.document.body, {
            childList: true, subtree: true, attributes: true,
            attributeFilter: ['data-jump-target', 'data-jump-click', 'data-performance-module-jump', 'aria-controls', 'data-gain-stage-control', 'data-granular-keyboard-ready']
        });
    }

    // These shortcuts execute the existing Actions controls in the same click.
    // Observe their actual state; no parallel render, progress timer or sound state.
    function initializeRenderActions() {
        if (root.__mygrainSongRenderDeck) return;
        const drawer = root.document.getElementById('sectionJumpDrawer');
        if (!drawer) return;
        const entries = [...drawer.querySelectorAll('[data-render-action][data-jump-click]')].map(button => {
            const target = root.document.querySelector(button.dataset.jumpClick);
            if (!target) return null;
            const label = button.textContent.trim(), idle = target.textContent.trim();
            const copy = root.document.createElement('span'); copy.className = 'render-action-copy';
            const name = root.document.createElement('span'); name.className = 'render-action-label'; name.textContent = label;
            const progress = root.document.createElement('span'); progress.className = 'render-action-progress';
            progress.setAttribute('aria-live', 'polite'); progress.setAttribute('aria-atomic', 'true');
            copy.append(name, progress); button.replaceChildren(copy);
            return { button, target, label, idle, progress };
        }).filter(Boolean);
        if (!entries.length) return;
        let locked = false;
        const busy = () => entries.some(entry => entry.target.disabled);
        const refresh = () => {
            const anyBusy = busy();
            for (const { button, target, label, idle, progress } of entries) {
                const working = target.disabled, text = target.textContent.trim();
                const stage = working && !locked ? text === idle ? 'Preparing…' : /^(working$|rendering)/i.test(text) ? 'Rendering…' : /^uploading/i.test(text) ? 'Uploading…' : /^adding/i.test(text) ? 'Adding…' : text.replace(/\.{3}$/, '…') : '';
                if (progress.textContent !== stage) progress.textContent = stage;
                button.disabled = locked || anyBusy;
                const ariaBusy = String(working && !locked), ariaLabel = label + (stage ? ' · ' + stage : '');
                if (button.getAttribute('aria-busy') !== ariaBusy) button.setAttribute('aria-busy', ariaBusy);
                if (button.getAttribute('aria-label') !== ariaLabel) button.setAttribute('aria-label', ariaLabel);
            }
        };
        // Capture stops the generic Jump listener before it scrolls/closes the drawer.
        drawer.addEventListener('click', event => {
            const button = event.target.closest('[data-render-action]');
            const entry = entries.find(item => item.button === button);
            if (!entry) return;
            event.preventDefault(); event.stopImmediatePropagation();
            if (locked || button.disabled || busy() || root.mygrainAccounts?.authenticated === false) return;
            // A focus-only drawer would collapse when the active button disables.
            drawer.classList.add('is-open');
            drawer.querySelector('#sectionJumpHandle')?.setAttribute('aria-expanded', 'true');
            entry.target.click(); refresh();
        }, true);
        const observer = new MutationObserver(refresh);
        for (const { target } of entries) observer.observe(target, { attributes: true, attributeFilter: ['disabled'], childList: true, characterData: true, subtree: true });
        const lock = () => { locked = true; observer.disconnect(); refresh(); };
        root.addEventListener('mygrain-account-lock', lock, { once: true });
        root.addEventListener('mygrain-account-changed', lock, { once: true });
        refresh();
    }

    // ID-safe mirrors retain the shared menu and call its authoritative handlers.
    function initializePhoneEdgeShortcuts() {
        if (root.__mygrainSongRenderDeck) return;
        const drawer = root.document.getElementById('sectionJumpDrawer');
        if (!drawer || root.document.querySelector('.phone-edge-shortcuts')) return;
        const stack = root.document.createElement('nav');
        stack.className = 'phone-edge-shortcuts';
        drawer.after(stack);
        stack.setAttribute('aria-label', 'Quick section and transport controls');
        for (const id of [
            'sectionJumpSongBtn', 'sectionJumpMegaRandomBtn', 'sectionJumpSparseRandomBtn',
            'sectionJumpKeyboardBtn', 'sectionJumpLayerSwitchBtn', 'sectionJumpBastardMixerBtn',
            'sectionJumpTransportBtn'
        ]) {
            const source = root.document.getElementById(id);
            if (!source) continue;
            const button = root.document.createElement('button');
            button.type = 'button'; button.className = 'phone-edge-shortcut';
            button.dataset.phoneShortcut = id;
            const sync = () => {
                button.textContent = id === 'sectionJumpTransportBtn' && source.textContent === 'Start' ? 'Play' : source.textContent;
                button.disabled = source.disabled;
                button.classList.toggle('is-running', source.classList.contains('is-running'));
                for (const name of ['aria-label', 'aria-pressed', 'title', 'data-nav-section']) {
                    const value = source.getAttribute(name);
                    if (value === null) button.removeAttribute(name); else button.setAttribute(name, value);
                }
                for (const name of ['--nav-background', '--nav-foreground', '--nav-border', '--nav-running-background', '--nav-running-foreground', '--nav-running-border']) {
                    button.style.setProperty(name, source.style.getPropertyValue(name));
                }
            };
            button.addEventListener('click', () => { if (!source.disabled) source.click(); });
            new MutationObserver(sync).observe(source, {
                attributes: true, attributeFilter: ['disabled', 'class', 'aria-label', 'aria-pressed', 'title', 'data-nav-section', 'style'],
                childList: true, subtree: true, characterData: true
            });
            sync(); stack.append(button);
        }
    }

    function initializeDesktopDock() {
        const drawer = root.document.getElementById('sectionJumpDrawer');
        const panel = root.document.getElementById('sectionJumpPanel');
        const handle = root.document.getElementById('sectionJumpHandle');
        const grid = panel?.querySelector('.section-jump-grid');
        const quickStack = drawer?.querySelector('.section-jump-quick-stack');
        if (!drawer || !panel || !handle || !grid || !quickStack) return;
        const desktop = root.matchMedia('(min-width: 961px)');
        const tools = root.document.createElement('div'); tools.className = 'desktop-nav-tools';
        tools.innerHTML = '<label for="desktopNavSearch">Find / search</label><input id="desktopNavSearch" type="search" placeholder="Find a section…" autocomplete="off" aria-controls="sectionJumpPanel"><p class="desktop-nav-empty" hidden role="status">No matching sections.</p>';
        panel.before(tools);
        const search = tools.querySelector('input'), empty = tools.querySelector('p');
        const origins = new Map();
        const rememberQuick = node => {
            if (origins.has(node)) return;
            const anchor = root.document.createComment('Jump shortcut home');
            if (node.parentElement === grid) {
                let previous = node.previousElementSibling;
                while (previous && !origins.has(previous)) previous = previous.previousElementSibling;
                const home = origins.get(previous);
                if (home?.isConnected) home.after(anchor); else quickStack.append(anchor);
            } else node.before(anchor);
            origins.set(node, anchor);
        };
        quickStack.querySelectorAll('.section-jump-quick').forEach(rememberQuick);
        const duplicateActions = new Set(['sectionJumpMegaRandomPanelBtn', 'sectionJumpSparseRandomPanelBtn', 'sectionJumpTransportPanelBtn']);
        const links = () => [...grid.querySelectorAll('.section-jump-option, .section-jump-quick')];
        const filter = () => {
            const normalize = text => String(text).replace(/\s+/g, ' ').trim().toLowerCase();
            const query = normalize(search.value);
            const quickTargets = new Set([...origins.keys()].map(node => node.dataset.jumpTarget || node.dataset.jumpClick).filter(Boolean));
            let matches = 0;
            for (const link of links()) {
                const duplicate = !origins.has(link) && (quickTargets.has(link.dataset.jumpTarget || link.dataset.jumpClick) || duplicateActions.has(link.id));
                link.dataset.desktopDuplicate = String(duplicate);
                link.hidden = duplicate || !normalize(link.textContent).includes(query);
                if (!link.hidden && !link.closest('[hidden]')) matches += 1;
            }
            empty.hidden = matches > 0;
        };
        const sync = () => {
            // One shared list and identical ordering at every viewport.
            drawer.querySelectorAll('.section-jump-quick').forEach(rememberQuick);
            for (const node of origins.keys()) if (node.parentElement !== grid) grid.append(node);
            arrangeJumpButtons(); filter();
        };
        search.addEventListener('input', () => { filter(); panel.scrollTop = 0; });
        handle.addEventListener('click', () => { if (desktop.matches) { search.focus(); search.select(); } });
        search.addEventListener('keydown', event => {
            if (event.key === 'Escape') { search.value = ''; filter(); search.blur(); }
            else if (event.key === 'Enter') { search.blur(); links().find(link => !link.hidden && !link.closest('[hidden]'))?.click(); }
        });
        const updateMode = () => {
            if (desktop.matches) { panel.before(tools); handle.setAttribute('aria-expanded', 'true'); }
            else { panel.before(tools); search.value = ''; handle.setAttribute('aria-expanded', String(drawer.classList.contains('is-open'))); }
            sync();
        };
        desktop.addEventListener('change', updateMode);
        new MutationObserver(sync).observe(grid, { childList: true });
        new MutationObserver(sync).observe(quickStack, { childList: true });
        new MutationObserver(filter).observe(grid, { childList: true, subtree: true, characterData: true });
        new MutationObserver(() => {
            if (desktop.matches && handle.getAttribute('aria-expanded') !== 'true') handle.setAttribute('aria-expanded', 'true');
        }).observe(handle, { attributes: true, attributeFilter: ['aria-expanded'] });
        drawer.addEventListener('click', event => {
            const link = event.target.closest('[data-jump-target]');
            if (!link || !desktop.matches) return;
            drawer.querySelectorAll('[aria-current]').forEach(button => button.removeAttribute('aria-current'));
            drawer.querySelectorAll('[data-jump-target]').forEach(button => {
                if (button.dataset.jumpTarget === link.dataset.jumpTarget) button.setAttribute('aria-current', 'location');
            });
        });
        updateMode();
    }

    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
})(window);
