(function (root) {
    'use strict';

    const palette = Object.freeze({
        song: '#b8efbe',
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
        drums: '#e9a28c',
        sample: '#9ed6d9',
        layers: '#a4e8cb',
        mixer: '#ffc28e',
        'quick-grain': '#c2c8ed',
        filter: '#b6d76d',
        actions: '#dfb0f2',
        export: '#edc677',
        'wav-browser': '#8cbce3',
        'stem-export': '#e3d0a5',
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
        pan: '#efc4cf'
    });
    const foreground = '#f2f6ff';
    const states = Object.freeze({
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
        '.performance-keyboard-card': 'keyboard',
        '.synth-container': 'synth',
        '.performance-toolbar': 'top',
        '[aria-label="Bastardloop controls"]': 'loop-a',
        '[aria-label="Bastardloop B controls"]': 'loop-b',
        '[aria-label="Bastardloop C controls"]': 'loop-c',
        '[aria-label="Bastardloop V controls"]': 'loop-v',
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
        '#performanceStemExportCard': 'stem-export',
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
        '#finalPanSection': 'pan',
        '#performancePanLabResetBtn': 'pan'
    });
    const buttons = Object.freeze({
        sectionJumpMegaRandomBtn: 'mega', sectionJumpMegaRandomPanelBtn: 'mega',
        sectionJumpSparseRandomBtn: 'sparse', sectionJumpSparseRandomPanelBtn: 'sparse',
        sectionJumpTransportBtn: 'transport', sectionJumpTransportPanelBtn: 'transport'
    });
    const selector = '.section-jump-option, .section-jump-quick, .performance-layer-jump-btn, [data-jump-target], [data-jump-click], [data-granular-keyboard-ready], .performance-mixer-jump-btn, [data-gain-stage-control], #performanceLayerSwitchesCard button, #performanceMixerCard button, .performance-mixer-solo-btn';
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

    function refresh(container = root.document) {
        if (container.matches?.(selector)) paint(container);
        container.querySelectorAll?.(selector).forEach(paint);
    }

    root.mygrainNavigation = Object.freeze({
        palette, appearances, foreground, states, targets, selector, sectionForTarget, sectionForButton, refresh,
        setMixerTargets(mapping) {
            mixerTargets = Object.freeze({ ...mapping });
            refresh();
        }
    });

    function initialize() {
        refresh();
        initializeDesktopDock();
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

    function initializeDesktopDock() {
        const drawer = root.document.getElementById('sectionJumpDrawer');
        const panel = root.document.getElementById('sectionJumpPanel');
        const handle = root.document.getElementById('sectionJumpHandle');
        if (!drawer || !panel || !handle) return;
        const desktop = root.matchMedia('(min-width: 961px)');
        const tools = root.document.createElement('div');
        tools.className = 'desktop-nav-tools';
        tools.innerHTML = '<label for="desktopNavSearch">Direct links</label><input id="desktopNavSearch" type="search" placeholder="Find a section…" autocomplete="off" aria-controls="sectionJumpPanel"><p class="desktop-nav-empty" hidden role="status">No matching sections.</p>';
        panel.before(tools);
        const search = tools.querySelector('input');
        const empty = tools.querySelector('p');
        const links = [...panel.querySelectorAll('.section-jump-option')];
        const quickTargets = new Set([...drawer.querySelectorAll('.section-jump-quick[data-jump-target]')].map(button => button.dataset.jumpTarget));
        const duplicateActions = new Set(['sectionJumpMegaRandomPanelBtn', 'sectionJumpSparseRandomPanelBtn', 'sectionJumpTransportPanelBtn']);
        const filter = () => {
            const query = desktop.matches ? search.value.trim().toLowerCase() : '';
            let matches = 0;
            for (const link of links) {
                const duplicate = desktop.matches && (quickTargets.has(link.dataset.jumpTarget) || duplicateActions.has(link.id));
                link.hidden = duplicate || !link.textContent.toLowerCase().includes(query);
                if (!link.hidden) matches += 1;
            }
            empty.hidden = matches > 0;
        };
        search.addEventListener('input', filter);
        handle.addEventListener('click', () => {
            if (desktop.matches) { search.focus(); search.select(); }
        });
        search.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                search.value = '';
                filter();
                search.blur();
            } else if (event.key === 'Enter') {
                links.find(link => !link.hidden)?.click();
            }
        });
        const updateMode = () => {
            // CSS keeps the desktop dock persistent; mobile retains its drawer.
            if (desktop.matches) handle.setAttribute('aria-expanded', 'true');
            else {
                search.value = '';
                handle.setAttribute('aria-expanded', String(drawer.classList.contains('is-open')));
            }
            filter();
        };
        desktop.addEventListener('change', updateMode);
        const observer = new MutationObserver(() => {
            if (desktop.matches && handle.getAttribute('aria-expanded') !== 'true') handle.setAttribute('aria-expanded', 'true');
        });
        observer.observe(handle, { attributes: true, attributeFilter: ['aria-expanded'] });
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
