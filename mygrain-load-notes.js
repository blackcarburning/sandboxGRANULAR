(() => {
    if (window.__mygrainSongRenderDeck) return;
    const STORAGE_KEY = 'mygrain-load-notes-v1';
    const TIPS = Object.freeze([
        'Use Jump to reach Keys, Mix, Actions, or any loop card without hunting.',
        'Use Undo and Redo on the edge of the screen to step through patch changes.',
        'K recordings keep their own audio, mute, level, pan, tune, filter, and effects.',
        'Click the blank space in a K track to select it without changing On or Mute.',
        'Record to K captures the keyboard without recording the backing loops.',
        'Change the keyboard octave view to reach more notes without losing held selections.',
        'Loop cards remember their own mix state, so you can shape each lane separately.',
        'Double-tap a note in the Q chord editor to mute it temporarily while auditioning.',
        'The section jump drawer is the quickest way to move between performance areas.',
        'Saved parts keep their pattern cycle and render length together, so exports stay aligned.'
    ]);
    const CHANGES = Object.freeze([Object.freeze({"id": "2026-10-27-daw-3", "date": "2026-10-27", "build": "v2026.10.27.DAW.3", "title": "Export only what you hear", "text": "DAW export now respects the saved mix for each part: selected layer solos, grain solos and drum-lane solos. Non-soloed layers are not rendered just because they remain enabled. Includes FTP folder creation and Bitwig, Ableton and FL Studio import guides."}),Object.freeze({"id": "2026-10-27-daw-2", "date": "2026-10-27", "build": "v2026.10.27.DAW.2", "title": "DAW folders and import guides", "text": "Create a new folder directly in the DAW FTP picker. Bitwig Studio, Ableton Live and FL Studio import guides now appear on the DAW card and inside each new ZIP alongside the Cubase guidance."}),Object.freeze({"id": "2026-10-27-daw-1", "date": "2026-10-27", "build": "v2026.10.27.DAW.1", "title": "DAW export to private FTP", "text": "New blue-and-grey DAW card: export a pattern or saved song as aligned dry 48 kHz/24-bit audio, separate MIDI/drum tracks, original saved samples and an optional reference mix in a named, tempo-labelled ZIP. Server rendering keeps the phone out of stem/ZIP assembly."}),Object.freeze({id:'2026-10-26-global-filter-repair',date:'2026-10-26',title:'Cleaner global audio',text:'Fixed stale FX pre/post connections that could create parallel audio or filter feedback. Mega and Sparse now finish with global filters, reverbs, delays and Panlab disabled, with a brief completion popup.'}),Object.freeze({id:'2026-10-26-private-files',date:'2026-10-26',title:'Easier private files',text:'The in-app and standalone FTP browsers now share management controls. Open folders by clicking their names, go up one level, and recover deleted files from your private Trash. In-app preview and A/B/C/V imports remain available.'}),Object.freeze({id:'2026-10-26-card-navigation',date:'2026-10-26',title:'Clearer cards and navigation',text:'Utility cards now have matching line-art icons, and AI Patch Direction has its own splash header. Desktop jump buttons have even highlights without the thick white-edge animation.'}),Object.freeze({id:"2026-10-26-mobile-vocals-1",date:"2026-10-26",build:"v2026.10.26.MOBILE-VOCALS.1",title:"Faster startup and vocal recording repair",text:"Optional lab, Wasp and loop FX controls load on demand. Wasp has two lanes; iPhone loads a separate simple low/high-pass filter. M/M+ capture follows the audio clock, and M can record or copy directly to V."}),Object.freeze({id:"2026-10-25-loop-retention-1",date:"2026-10-25",build:"v2026.10.25.LOOP-RETENTION.1",title:"No automatic loop archive",text:"Generated loops go straight to the current patch instead of accumulating as server WAVs. All Bastardloop Browser buttons are removed. Original sample browsers, patch/Song audio and intentional WAV exports remain available; existing generated files are archived privately."}), Object.freeze({id:"2026-10-25-filter-clock-1",date:"2026-10-25",build:"v2026.10.25.FILTER-CLOCK.1",title:"Filter LFO beat alignment",text:"Saw down and Ramp up now sweep for their full selected cycle, with the reset at the cycle boundary. Shared card filter LFOs align with the sequencer transport, including newly started lanes and tempo changes; depth and cutoff edits retain phase."}), Object.freeze({id:"2026-10-25-wav-art-1",date:"2026-10-25",build:"v2026.10.25.WAV-ART.1",title:"Artwork for rendered WAVs",text:"Upload Art beside Download/Share WAV adds a small title thumbnail. Click to enlarge. Proportions are preserved, images resized and compressed; artwork follows renames and new shares."}), Object.freeze({id:"2026-10-25-n-threshold-1",date:"2026-10-25",build:"v2026.10.25.N-THRESHOLD.1",title:"N envelope threshold",text:"Threshold now gates Amplitude Follower as well as triggering ADSR. ADSR hits use the selected envelope depth rather than the threshold value as their strength. Manual triggers bypass threshold; driver sensitivity is applied before detection."}), Object.freeze({id:"2026-10-25-lx-accent-1",date:"2026-10-25",build:"v2026.10.25.LX-ACCENT.1",title:"L/X audible filter accents",text:"L and X note envelopes now move the actual shared filter alongside its LFO, rather than opening a filter behind a fixed cutoff. Sample and OSC3 sequencing both trigger the envelope. X Filter Accent no longer changes OSC3 voice gain."}), Object.freeze({id:"2026-10-25-noise-space-1",date:"2026-10-25",build:"v2026.10.25.NOISE-SPACE.1",title:"N stereo hall and tempo delay",text:"N now has the standard Stereo Hall Reverb presets and full controls, plus beat-synced delay with feedback, tone and ping pong. Its existing filter/envelope stays independent. Effects save with patches and Songs; older N patches stay dry."}), Object.freeze({id:"2026-10-25-noise-lfo-1",date:"2026-10-25",build:"v2026.10.25.NOISE-LFO.1",title:"N level LFO and active envelope drivers",text:"N Level LFO routes remain active at zero base level. Random mixes choose the N filter-envelope driver after the layer mutes: a global LFO or an enabled, loaded track with nonzero level and playable notes."}), Object.freeze({id:"2026-10-25-drum-loop-1",date:"2026-10-25",build:"v2026.10.25.DRUM-LOOP.1",title:"Generated loop: drums only",text:"The Actions Loop transport now plays just its generated drum audio. Its step clock no longer triggers Granular A/B or oscillator notes. Keyboard and arpeggiator sounds, other loop cards, and independent layer controls are unchanged."}), Object.freeze({id:"2026-10-25-grain-ab-random-1",date:"2026-10-25",build:"v2026.10.25.GRAIN-AB-RANDOM.1",title:"Fresh Grain A/B samples",text:"Sparse and Mega each load a new random sample into Granular A and B from the same six folders as their Random Sample buttons. Sample identity, waveforms, saved audio and Undo/Redo stay linked; normal Randomise and layer-selection rules are unchanged."}), Object.freeze({id:"2026-10-25-noise-n-2",date:"2026-10-25",build:"v2026.10.25.NOISE-N.2",title:"N mixer and layer controls",text:"N Noise now has On/Off, Jump and Solo in Layers, plus Solo and a direct N Jump in Mix alongside its level and VU meter. N also has Solo on its own card. All controls stay linked, and shared solos save and recall with patches."}), Object.freeze({id:"2026-10-25-noise-n-1",date:"2026-10-25",build:"v2026.10.25.NOISE-N.1",title:"N · independent noise",text:"Noise has its own N card with 2–16-pole low/high/band-pass and notch filtering, drive, triggered ADSR or amplitude following. L1–L3, all loop lanes, individual K tracks and drum tracks can drive the filter without changing their audio. N is included in Sparse and Mega randomisation."}), Object.freeze({id:"2026-10-25-loop-fx-1",date:"2026-10-25",build:"v2026.10.25.LOOP-FX.1",title:"Matching loop filters and space",text:"Every loop card now has the same LFO filter, stereo hall reverb and tempo delay, with subtle patch randomisation and independent K-track settings. Songs has Convert FX for older parts; Arm Cache refreshes their playback audio. Accent filters and original X sample envelopes are retained."}), Object.freeze({id:'2026-10-25-song-w-1',date:'2026-10-25',build:'v2026.10.25.SONG-W.1',title:'W Song compatibility',text:'Pre-W Song parts load with W empty and off. Convert W saves that compatibility on the server without changing recorded audio or existing W parts.'}), Object.freeze({id: '2026-10-25-w-drums-1', date: '2026-10-25', build: 'v2026.10.25.W-DRUMS.1', title: 'W generation & drum volume', text: 'Normal Randomise now builds fresh Weird W audio, as Mega and Sparse already do. Randomised drums start at 40%, with a volume slider beneath the drum card buttons linked to Mix.'}), Object.freeze({id: "2026-10-25-x-envelope-restore-1", date: "2026-10-25", build: "v2026.10.25.X-ENVELOPE-RESTORE.1", title: "Original X sample envelopes restored", text: "Rolled back the X sample attack/decay smoothing and tail-timing changes made during the crackle investigation. Original playback and preview envelopes are restored; scrolling fixes, diagnostics and global FX controls are retained."}), Object.freeze({id: "2026-10-25-global-fx-1", date: "2026-10-25", build: "v2026.10.25.GLOBAL-FX.1", title: "Global mix effects controls", text: "Randomise, Mega and Sparse now reset global delay and reverb sends to zero. Actions has Delay Off; Layers has global Reverb and Delay on/off buttons. Individual cards keep their own effects."}), Object.freeze({id: "2026-10-25-scroll-audio-1", date: "2026-10-25", build: "v2026.10.25.SCROLL-AUDIO.1", title: "Playback and scrolling performance", text: "Sequencer notes no longer refresh every card, including muted backing notes. L now uses lightweight playhead painting like X; both sample keyboards permit vertical touch scrolling and release held notes when panning. X Trace 2 remains available; sound and saved patch formats are unchanged."}), Object.freeze({id: "2026-10-25-x-trace-2", date: "2026-10-25", build: "v2026.10.25.X-TRACE.2", title: "Longer Bass X click investigation", text: "X Trace now captures a 15-minute summary, eight detailed click windows and a longer click-spacing timeline. Added filter/LFO health, shared maintenance timing and overlapping signal probes; sound settings are unchanged."}), Object.freeze({id: '2026-10-25-x-trace-1', date: '2026-10-25', build: 'v2026.10.25.X-TRACE.1', title: 'Bass X diagnostics & scrolling', text: 'X has an opt-in detailed trace for clicks, samples, controls and scrolling, included in submitted logs. Idle sequencer ticks no longer rebuild its editor, and the X keybed permits vertical touch scrolling.'}), Object.freeze({"id": "2026-10-25-x-click-1", "date": "2026-10-25", "build": "v2026.10.25.X-CLICK.1", "title": "Smoother Bass X note starts", "text": "Sample-mode X now honours Click Guard and rounds its attack/decay transition to reduce note-on clicks. Playback and previews share the protection; submitted audio logs now include X sample and envelope settings."}), Object.freeze({"id": "2026-10-25-noise-audio-1", "date": "2026-10-25", "build": "v2026.10.25.NOISE-AUDIO.1", "title": "Noise controls & Loop X fades", "text": "Noise now has its own VU meter and a full 0\u2013100% mixer range. Loop X fits its fade to short or pitched sample ends, including slides and previews."}), Object.freeze({"id": "2026-10-24-wav-share-comments", "date": "2026-10-24", "build": "wav-share-comments", "title": "WAV sharing comments", "text": "Admin-shared WAVs start with old comments cleared. Admin can read each recipient’s new comments; feedback on earlier shared copies is preserved."}), Object.freeze({"id": "2026-10-24-q-lush-reverb", "date": "2026-10-24", "build": "q-lush-reverb", "title": "Q Stereo Hall Reverb", "text": "Q now has stereo reverb with tails up to 12 seconds, size, pre-delay, damping, low cut and width, plus Piano Hall, Lush Strings and Cathedral presets."}), Object.freeze({"id": "2026-10-24-account-approvals", "date": "2026-10-24", "build": "account-approvals", "title": "Account approvals", "text": "New registrations require an email address and owner approval before access is activated. Existing accounts remain active."}), Object.freeze({"id": "2026-10-24-q-preview-once", "date": "2026-10-24", "build": "q-preview-once", "title": "Q chord preview", "text": "Chord auditions now play one arpeggio cycle, without changing the sequencer’s repeat setting."}), Object.freeze({"id": "2026-10-24-q-sound-sources", "date": "2026-10-24", "build": "q-sound-sources", "title": "Q sound sources", "text": "Q now has independent Piano, Strings, OSC, Grain and Sample sources, with its own sample browser and saved sample slot."}), Object.freeze({
        id: '2026-10-24-amend-wait-1',
        date: '2026-10-24',
        build: 'v2026.10.24.AMEND.1',
        text: 'Amend now shows a prominent Please wait notice until the saved part turns orange and is ready to edit.'
    }), Object.freeze({
        id: '2026-10-24-eq-song-copy-2',
        date: '2026-10-24',
        build: 'v2026.10.24.EQ.2',
        text: 'Every EQ band now has a Q slider. Song Copy From Part includes individual EQs; Global Paste lets you choose destination channels and tick multiple song parts, including individual K tracks and drums. Saved-part conversion stays on the server.'
    }), Object.freeze({
        id: '2026-10-24-channel-eq-1',
        date: '2026-10-24',
        build: 'v2026.10.24.EQ.1',
        text: 'Every loop, drum lane and K track now has an independent four-band popup EQ: draggable bands, Q, shelves, 12–96 dB/oct cuts and a live spectrum. EQ is bypassed until switched on; older patches and Songs keep their original sound.'
    }), Object.freeze({
        id: '2026-10-23-sparse-juno-1',
        date: '2026-10-23',
        build: 'v2026.10.23.SPARSE.1',
        text: 'Sparse Randomise always keeps Bass X playing with a clean Juno-6 sample, alongside three random layers and drums.'
    }), Object.freeze({
        id: '2026-10-23-load-notes-3',
        date: '2026-10-23',
        build: 'v2026.10.23.LOADNOTES.3',
        highlight: false,
        text: 'Each load pairs a random tip with one of the last 10 improvements, cycling through them in a shuffled order.'
    }), Object.freeze({
        id: '2026-10-23-load-notes-2',
        date: '2026-10-23',
        build: 'v2026.10.23.LOADNOTES.2',
        highlight: false,
        text: 'Tips and latest changes now appear before login and stay visible at the top after Start, on desktop and phone.'
    }), Object.freeze({
        id: '2026-10-23-load-notes-1',
        date: '2026-10-23',
        build: 'v2026.10.23.LOADNOTES.1',
        highlight: false,
        text: 'Added a random tip above the latest app change on each load.'
    }), Object.freeze({
        id: '82efba8', date: '2026-10-23', build: 'v2026.10.23.BGAUDIO.1',
        text: 'Playback scheduling now stays active when you switch away from the page; iPhone background playback still depends on iOS.'
    }), Object.freeze({
        id: '34dc74f', date: '2026-10-23', build: 'v2026.10.23.KEYFIT.1',
        text: 'The keyboard fits narrow phone screens, with separate K destination and Solo controls to prevent overlap.'
    }), Object.freeze({
        id: 'be1c5f2', date: '2026-10-23', build: 'v2026.10.23.TOUCH.8',
        text: 'Scrolling no longer activates loop buttons. Blank K track space selects the track without changing On or Mute.'
    }), Object.freeze({
        id: '95397d8', date: '2026-10-23', build: 'v2026.10.23.KREV.1',
        text: 'All five K tracks have independent Hall reverbs with Mix and Decay controls, replacing the feedback that caused ringing.'
    }), Object.freeze({
        id: '40ee19d', date: '2026-10-23', build: 'v2026.10.23.ZIP.2',
        text: 'Save a complete named patch ZIP alongside a WAV render or Take, then restore its editable settings from the WAV browser.'
    }), Object.freeze({
        id: '16063c0', date: '2026-10-23', build: 'v2026.10.23.PAN.1',
        text: 'Randomising a patch now resets Pan Lab to centred, motion-free output instead of adding random panning.'
    }), Object.freeze({
        id: 'fb15ff0', date: '2026-10-23', build: 'v2026.10.23.GRAIN.4',
        text: 'Grains can loop within selected source regions, sustain independently of keyboard decay and use wider LFO movement.'
    }), Object.freeze({
        id: 'aa2cd1b', date: '2026-10-23', build: 'v2026.10.23.DECAY.1',
        text: 'Keyboard Decay now runs up to five seconds, while keeping Off and shorter decay settings available.'
    }), Object.freeze({
        id: '8f2c6d4', date: '2026-10-23', build: 'v2026.10.23.SYNTH.1',
        text: 'Previous and next synth-preset buttons now work from both the Synth and Keys panels, with matching preset names.'
    }), Object.freeze({
        id: '0a17b35', date: '2026-10-23', build: 'v2026.10.23.SAMPLE.3',
        text: 'The keyboard sample browser now provides a native audio preview player so you can audition a sound before loading it.'
    })]);
    const LATEST_CHANGES = CHANGES.filter(change => change.highlight !== false).slice(0, 3);
    const RECENT_CHANGES = CHANGES.filter(change => change.highlight !== false).slice(5, 15);
    let selectedTip;
    let selectedChange;

    function getStorage() {
        try {
            return window.localStorage;
        } catch {
            return null;
        }
    }

    function readState() {
        const storage = getStorage();
        if (!storage) {
            return { lastTipIndex: -1 };
        }
        try {
            const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
            return {
                lastTipIndex: Number.isInteger(parsed?.lastTipIndex) ? parsed.lastTipIndex : -1,
                lastChangeId: typeof parsed?.lastChangeId === 'string' ? parsed.lastChangeId : '',
                changePool: typeof parsed?.changePool === 'string' ? parsed.changePool : '',
                remainingChanges: Array.isArray(parsed?.remainingChanges) ? parsed.remainingChanges : []
            };
        } catch {
            return { lastTipIndex: -1 };
        }
    }

    function saveState(state) {
        const storage = getStorage();
        if (!storage) return;
        try {
            storage.setItem(STORAGE_KEY, JSON.stringify({
                lastTipIndex: Number.isInteger(state.lastTipIndex) ? state.lastTipIndex : -1,
                lastChangeId: state.lastChangeId,
                changePool: state.changePool,
                remainingChanges: state.remainingChanges
            }));
        } catch {
        }
    }

    function pickTip(state) {
        if (TIPS.length === 0) {
            return { index: -1, text: '' };
        }
        let index = Math.floor(Math.random() * TIPS.length);
        if (TIPS.length > 1 && index === state.lastTipIndex) {
            index = (index + 1) % TIPS.length;
        }
        return { index, text: TIPS[index] };
    }

    function pickChange(state) {
        const ids = RECENT_CHANGES.map(change => change.id);
        const pool = ids.join('|');
        let remaining = state.changePool === pool && Array.isArray(state.remainingChanges)
            ? state.remainingChanges.filter(id => ids.includes(id)) : [];
        if (new Set(remaining).size !== remaining.length) remaining = [];
        if (!remaining.length) {
            remaining = ids.slice();
            for (let index = remaining.length - 1; index > 0; index -= 1) {
                const swapIndex = Math.floor(Math.random() * (index + 1));
                [remaining[index], remaining[swapIndex]] = [remaining[swapIndex], remaining[index]];
            }
        }
        if (remaining.length > 1 && remaining[0] === state.lastChangeId) {
            [remaining[0], remaining[1]] = [remaining[1], remaining[0]];
        }
        const id = remaining.shift();
        state.changePool = pool;
        state.lastChangeId = id;
        state.remainingChanges = remaining;
        return RECENT_CHANGES.find(change => change.id === id);
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    function ensureStyles() {
        if (document.getElementById('mygrain-load-notes-style')) return;
        const style = document.createElement('style');
        style.id = 'mygrain-load-notes-style';
        style.textContent = `
#mygrain-load-notes-slot, #mygrain-performance-notes-slot {
    box-sizing: border-box;
    width: 100%;
    max-width: 540px;
    min-width: 0;
    margin: 0 auto;
}
.mygrain-load-notes {
    box-sizing: border-box;
    display: grid;
    gap: 6px;
    width: 100%;
    min-width: 0;
    padding: 12px 14px;
    border-radius: 16px;
    border: 1px solid rgba(110, 239, 255, 0.28);
    background: linear-gradient(180deg, rgba(7, 24, 46, 0.98), rgba(5, 15, 31, 0.95));
    color: #e8fcff;
    box-shadow: 0 14px 30px rgba(0, 0, 0, 0.22);
    text-align: left;
    font: 13px/1.4 system-ui, sans-serif;
}
.mygrain-load-notes .mygrain-load-notes__label {
    color: #79eaff;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
}
.mygrain-load-notes .mygrain-load-notes__text {
    color: #f3feff;
    font-size: 13px;
    line-height: 1.35;
    overflow-wrap: anywhere;
}
.mygrain-load-notes .mygrain-load-notes__divider {
    height: 1px;
    background: rgba(121, 234, 255, 0.14);
    margin: 4px 0 2px;
}
.mygrain-load-notes .mygrain-load-notes__change {
    color: #fff0b9;
}
.mygrain-load-notes__latest { margin: 0; padding-left: 20px; }
.mygrain-load-notes__latest li { padding: 3px 0; overflow-wrap: anywhere; }
#mygrain-performance-notes-slot { margin-top: 10px; }
.mygrain-load-notes__mobile-details { display: none; }
@media (max-width: 960px) {
    #start-overlay { gap: 8px; padding: max(12px, env(safe-area-inset-top)) 12px max(12px, env(safe-area-inset-bottom)); height: 100%; height: 100dvh; }
    #start-overlay .mygrain-start-brand { gap: 4px; font-size: 26px; }
    #start-overlay .mygrain-start-logo { width: 120px; height: 120px; }
    #start-overlay .mygrain-start-account { order: 1; }
    #start-overlay #start-btn { order: 2; min-height: 44px; margin: 0; padding: 10px 20px; }
    #start-overlay #mygrain-load-notes-slot { order: 3; max-height: min(32dvh, 210px); overflow-y: auto; overscroll-behavior: contain; }
    #mygrain-load-notes { gap: 4px; padding: 9px 12px; font-size: 12px; }
    #mygrain-load-notes .mygrain-load-notes__latest li { padding: 1px 0; }
    #mygrain-load-notes .mygrain-load-notes__description,
    #mygrain-load-notes > .mygrain-load-notes__random { display: none; }
    #mygrain-load-notes .mygrain-load-notes__mobile-details { display: block; }
    #mygrain-load-notes summary { cursor: pointer; padding: 7px 0; color: #79eaff; font-weight: 700; }
    #mygrain-load-notes .mygrain-load-notes__mobile-details p { margin: 6px 0; font: inherit; text-align: left; color: inherit; }
}
@media (max-width: 960px) and (max-height: 450px) {
    #start-overlay .mygrain-start-logo { display: none; }
    #start-overlay { gap: 5px; }
    #start-overlay #mygrain-load-notes-slot { max-height: 70px; }
}
        `;
        document.head.appendChild(style);
    }

    function render() {
        const slots = ['mygrain-load-notes-slot', 'mygrain-performance-notes-slot']
            .map(id => document.getElementById(id)).filter(Boolean);
        if (!slots.length) return false;
        ensureStyles();
        if (selectedTip === undefined) {
            const state = readState();
            const tip = pickTip(state);
            selectedTip = tip.text;
            state.lastTipIndex = tip.index;
            selectedChange = pickChange(state);
            saveState(state);
        }
        for (const slot of slots) {
            let panel = slot.querySelector('.mygrain-load-notes');
            if (!panel) {
                panel = document.createElement('section');
                panel.id = slot.id === 'mygrain-load-notes-slot' ? 'mygrain-load-notes' : 'mygrain-performance-load-notes';
                panel.className = 'mygrain-load-notes';
                panel.setAttribute('aria-label', 'Latest feature changes and random tips');
                slot.appendChild(panel);
            }
            const latestChange = selectedChange;
            panel.dataset.changeId = latestChange.id;
            panel.innerHTML = [
                ...(slot.id === 'mygrain-load-notes-slot' ? [
                    '<div class="mygrain-load-notes__label">Latest feature changes</div>',
                    '<ol class="mygrain-load-notes__latest">' + LATEST_CHANGES.map(change =>
                        `<li data-change-id="${escapeHtml(change.id)}"><strong>${escapeHtml(change.title || change.date)}</strong><span class="mygrain-load-notes__description"> — ${escapeHtml(change.text)}</span></li>`
                    ).join('') + '</ol>',
                    '<details class="mygrain-load-notes__mobile-details"><summary>Details &amp; random tips</summary>' +
                    LATEST_CHANGES.map(change => `<p><strong>${escapeHtml(change.title || change.date)}</strong> — ${escapeHtml(change.text)}</p>`).join('') +
                    `<p><strong>Random tip</strong> — ${escapeHtml(selectedTip)}</p></details>`
                ] : []),
                '<div class="mygrain-load-notes__random">',
                '<div class="mygrain-load-notes__divider" aria-hidden="true"></div>', 
                '<div class="mygrain-load-notes__label">Random tip</div>',
                `<div class="mygrain-load-notes__text mygrain-load-notes__tip">${escapeHtml(selectedTip)}</div>`,
                ...(slot.id === 'mygrain-load-notes-slot' ? [] : [
                    '<div class="mygrain-load-notes__divider" aria-hidden="true"></div>',
                    '<div class="mygrain-load-notes__label">Earlier changes · random highlight</div>',
                    `<div class="mygrain-load-notes__text mygrain-load-notes__change">${escapeHtml(latestChange.text)}</div>`
                ]),
                '</div>'
            ].join('');
        }
        return true;
    }

    window.mygrainLoadNotes = Object.freeze({
        refresh: render,
        latestChange: () => CHANGES[0],
        latestChanges: () => LATEST_CHANGES.slice(),
        highlightedChange: () => selectedChange,
        recentChanges: () => RECENT_CHANGES.slice(),
        changes: () => CHANGES.slice()
    });
})();
