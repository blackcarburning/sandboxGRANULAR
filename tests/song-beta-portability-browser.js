const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL;
const instrument = process.env.SONG_TEST_Q_INSTRUMENT || 'piano';
assert.ok(['piano', 'strings'].includes(instrument));
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base)) throw new Error('Use an isolated localhost song test server.');
const source = fs.readFileSync(path.join(__dirname, '../song-beta-adapter.js'), 'utf8');
const bindings = [...source.slice(0, source.indexOf('const metadataBindings')).matchAll(/\['([^']+)', \(\) => (\w+),/g)].map(match => [match[1], match[2]]);
const metadataBindings = [...source.slice(source.indexOf('const metadataBindings'), source.indexOf('let persistence')).matchAll(/\['([^']+)', \(\) => (\w+),/g)].map(match => [match[1], match[2]]);

function differences(expected, actual, prefix = '') {
    if (JSON.stringify(expected) === JSON.stringify(actual)) return [];
    if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
        return Object.keys(expected).flatMap(key => differences(expected[key], actual[key], `${prefix}.${key}`));
    }
    return [{ key: prefix, expected, actual }];
}

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const contexts = [];
    const errors = [];
    const historyRequests = [];
    const blockedSampleRequests = [];
    async function openPhone(sampleRate, accessFile) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        contexts.push(context);
        await context.addInitScript(({ sampleRate, blockStorage }) => {
            const NativeContext = window.AudioContext || window.webkitAudioContext;
            window.AudioContext = class extends NativeContext {
                constructor(options) { super({ ...options, sampleRate }); }
            };
            window.webkitAudioContext = window.AudioContext;
            if (blockStorage) {
                Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Storage blocked', 'SecurityError'); } });
                Object.defineProperty(window, 'indexedDB', { configurable: true, get() { throw new DOMException('Storage blocked', 'SecurityError'); } });
            }
        }, { sampleRate, blockStorage: Boolean(accessFile) });
        const page = await context.newPage();
        page.setDefaultTimeout(30000);
        page.on('pageerror', error => errors.push(error.stack));
        await page.route('**/*', route => {
            const url = new URL(route.request().url());
            if (accessFile && /\/SAMPLES_Q(?:_STRINGS)?\//.test(url.pathname)) {
                blockedSampleRequests.push(url.pathname);
                return route.abort();
            }
            if (url.pathname.startsWith('/mygrain-bastardloops/')) {
                historyRequests.push(url.pathname);
                return route.abort();
            }
            return url.origin === new URL(base).origin ? route.continue() : route.abort();
        });
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.locator('#start-btn').click();
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy && !engineStarting && !stateSaveSuspended && isAudioGraphReady());
        if (accessFile) {
            assert.equal(await page.evaluate(() => mygrainSongBeta.songs.length), 0, 'A clean device must not already have library access.');
            await page.evaluate(() => {
                Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Storage blocked', 'SecurityError'); } });
                mygrainSongBeta.renderStore = new MygrainSongStorage.RenderStore(null);
                saveAudioBufferToDB = async () => { throw new Error('IndexedDB unavailable'); };
                clearAudioBufferFromDB = async () => { throw new Error('IndexedDB unavailable'); };
            });
            await page.locator('#songBetaAccessFile').setInputFiles({ name: 'MYGRAIN-Song-Access.json', mimeType: 'application/json', buffer: accessFile });
            await page.waitForFunction(() => !mygrainSongBeta.busy && mygrainSongBeta.song?.parts.length > 0);
            assert.match(await page.locator('#songBetaAccessStatus').textContent(), /storage is unavailable/);
        }
        return page;
    }
    try {
        const original = await openPhone(48000);
        const fixture = await original.evaluate(async ({ bindings, metadataBindings, instrument }) => {
            const ranges = [...document.querySelectorAll('input[type="range"]')].filter(input => input.id && !input.closest('#songBetaCard, #bastardLoopVCutOverlay'));
            for (const input of ranges) {
                const minimum = Number(input.min) || 0;
                const maximum = Number(input.max) || 100;
                const step = Number(input.step) || 1;
                input.value = String(minimum + Math.round((maximum - minimum) * .29 / step) * step);
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            flushPendingSliderUpdates();
            for (const select of document.querySelectorAll('select')) {
                if (!select.id || select.closest('#songBetaCard, #bastardLoopVCutOverlay') || /Browser|synthPresetSelect|performanceDropboxSampleSource/.test(select.id)) continue;
                if (select.options.length < 2) continue;
                select.selectedIndex = 1;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            for (const selector of ['.lfo-toggle', '.inv-toggle']) {
                for (const lane of ['1', '2', '3']) {
                    const buttons = [...document.querySelectorAll(`${selector}[data-lfo="${lane}"]`)];
                    buttons.slice(0, 2).forEach(button => { if (!button.classList.contains('active')) button.click(); });
                }
            }
            syncPatternLengthControls(16, { skipSave: true });
            applyGlobalBpm(120);
            for (const [id, value] of [['performanceDrumMachineLevel', 29], ['phaserRate', 173], ['tremoloRate', 231], ['lfo3Rate', 197], ['lfoRate', 349], ['lfo2Rate', 271], ['volume', 70], ['masterTrim', -6]]) setSliderValue(id, value);
            flushPendingSliderUpdates();
            const audio = [];
            function tone(index) {
                const channels = index % 2 + 1;
                const frames = Math.round(audioContext.sampleRate * (index >= 15 && index <= 18 ? 1.5 : .25));
                const buffer = audioContext.createBuffer(channels, frames, audioContext.sampleRate);
                const frequency = 97 + index * 11;
                for (let channel = 0; channel < channels; channel += 1) {
                    const samples = buffer.getChannelData(channel);
                    for (let frame = 0; frame < frames; frame += 1) samples[frame] = .13 * Math.sin(2 * Math.PI * frequency * frame / buffer.sampleRate + channel * .2);
                }
                return { buffer, frequency, channels, frames, duration: buffer.duration };
            }
            for (const [index, [key, variable]] of bindings.entries()) {
                const info = tone(index);
                window.__fixtureBuffer = info.buffer;
                window.eval(`${variable} = window.__fixtureBuffer`);
                audio.push({ key, frequency: info.frequency, channels: info.channels, duration: info.duration });
            }
            for (const [index, track] of Object.values(drumMachineExtraTracks).entries()) {
                const info = tone(bindings.length + index);
                track.buffer = info.buffer;
                audio.push({ key: track.kind === 'clap' ? 'drumClap' : 'drumCymbals', frequency: info.frequency, channels: info.channels, duration: info.duration });
            }
            for (const [key, variable] of metadataBindings) {
                window.__fixtureMetadata = { fileName: `${key}-saved.wav`, name: `${key} saved source`, sourceBpm: 120, duration: audio.find(info => info.key === key)?.duration };
                window.eval(`${variable} = window.__fixtureMetadata`);
            }
            Object.values(drumMachineExtraTracks).forEach(track => { track.metadata = { fileName: `${track.kind}-saved.wav`, sourceBpm: 120 }; });
            syncLegacyAudioBuffer();
            setOscillatorsEnabled(false, { silent: true });
            setGranularLayersEnabled(true, { silent: true });
            setBastardLoopMEnabled(true, { silent: true, skipSave: true });
            setBastardLoopMPlusEnabled(true, { silent: true, skipSave: true });
            setBastardLoopVCut({ enabled: true, repeat: true, start: .125, end: .4375 }, { skipSave: true, skipRestart: true });
            bastardLoopLSequence[0] = normalizeBastardLoopLStep({ note: 'C3', accent: true, ratchet: 3 });
            bastardLoopXSequence[0] = normalizeBastardLoopXStep({ note: 'C3', accent: true, ratchet: 2 });
            bastardLoopXSequence[5] = normalizeBastardLoopXStep({ note: 'E3', slide: true });
            setBastardLoopXEnabled(true, { silent: true, skipSave: true });
            const qState = MygrainQTheory.defaults();
            Object.assign(qState, { instrument, enabled: true, arpEnabled: true, arpPattern: 'odds', arpRepeat: 'until-next', arpDivision: 1 / 6, room: .18, delay: .12, delayBeats: 1 / 3 });
            qState.sequence[0] = MygrainQTheory.normalizeStep({ notes: [48, 52, 55], velocity: 96, gate: 6 });
            qState.sequence[8] = MygrainQTheory.normalizeStep({ notes: [55, 59, 62], velocity: 32, gate: 4 });
            mygrainQ.restore(qState);
            setFilterEnabled('lpf', false);
            setFilterEnabled('hpf', false);
            setGranularLayerMuted('main', true, { silent: true, skipSave: true });
            setGranularLayerMuted('A', false, { silent: true, skipSave: true });
            setGranularLayerMuted('B', false, { silent: true, skipSave: true });
            document.getElementById('grainSynthASource').value = 'grainASample';
            document.getElementById('grainSynthBSource').value = 'grainBMic';
            heldNotes = new Set(['C3', 'E3']);
            seqGrainsEnabled = false;
            document.getElementById('seqGrainsEnabled').checked = false;
            drumMachineHatRatchetPattern = Array.from({ length: 16 }, (_, index) => index % 3 ? index % 7 + 2 : 0);
            flushPendingSliderUpdates();
            const blob = await mygrainSongBetaAdapter.capture();
            const bytes = await blob.arrayBuffer();
            const snapshot = mygrainSongBetaAdapter.inspectPart(bytes).snapshot;
            const created = await mygrainSongBeta.request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Portable song audit' }) });
            const saved = await mygrainSongBeta.request(`/${created.song.id}/parts?name=All%20parameters&repeats=1`, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: blob });
            mygrainSongBeta.song = saved.song;
            mygrainSongBeta.render();
            return { key: mygrainSongBeta.key, songId: saved.song.id, snapshot, audio, ranges: ranges.length };
        }, { bindings, metadataBindings, instrument });
        const downloaded = original.waitForEvent('download');
        await original.locator('#songBetaBackupAccess').click();
        const download = await downloaded;
        assert.equal(download.suggestedFilename(), 'MYGRAIN-Song-Access.json');
        const downloadPath = await download.path();
        const accessFile = fs.readFileSync(fs.existsSync(downloadPath) ? downloadPath : `/tmp/snap-private-tmp/snap.chromium${downloadPath}`);
        const access = JSON.parse(accessFile.toString('utf8'));
        assert.equal(access.key, fixture.key);
        assert.equal(access.songId, fixture.songId);
        assert.deepEqual(Object.keys(access).sort(), ['format', 'key', 'songId', 'version']);
        await original.waitForFunction(() => !mygrainSongBeta.busy);
        async function verifyRecall(page, blockedStorage) {
            return page.evaluate(async ({ fixture, bindings, metadataBindings, blockedStorage }) => {
                for (const [key, variable] of bindings) {
                    const buffer = audioContext.createBuffer(1, 2048, audioContext.sampleRate);
                    buffer.getChannelData(0).fill(.9);
                    window.__conflictingBuffer = buffer;
                    window.eval(`${variable} = window.__conflictingBuffer`);
                }
                for (const input of document.querySelectorAll('input[type="range"]')) {
                    if (!input.id || input.closest('#songBetaCard, #bastardLoopVCutOverlay')) continue;
                    input.value = input.max;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }
                flushPendingSliderUpdates();
                document.querySelectorAll('.lfo-toggle, .inv-toggle').forEach(button => button.click());
                for (const [key, value] of Object.entries(fixture.snapshot.state.modes)) {
                    if (typeof value !== 'boolean') continue;
                    try { if (window.eval(`typeof ${key}`) === 'boolean') window.eval(`${key} = ${!value}`); } catch (error) {}
                }
                for (const [, variable] of metadataBindings) window.eval(`${variable} = {fileName: 'phone-only.wav', sourceBpm: 77}`);
                Object.values(drumMachineExtraTracks).forEach(track => { track.metadata = { fileName: 'phone-only.wav', sourceBpm: 77 }; });
                loadAudioBufferFromDB = async () => { throw new Error('Local samples must never be loaded'); };
                if (blockedStorage) {
                    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage blocked', 'SecurityError'); } });
                    mygrainSongBeta.renderStore = new MygrainSongStorage.RenderStore(null);
                    saveAudioBufferToDB = async () => { throw new Error('IndexedDB unavailable'); };
                    clearAudioBufferFromDB = async () => { throw new Error('IndexedDB unavailable'); };
                }
                const info = await mygrainSongBeta.readPart(mygrainSongBeta.song.parts[0]);
                const body = info.body;
                info.releaseDownload();
                const decoded = await mygrainSongBetaAdapter.decode(body, { buffers: new Map(), bytes: 0 });
                mygrainSongBetaAdapter.recall(decoded, { start: false });
                await mygrainQ.preparePlayback();
                await new Promise(resolve => setTimeout(resolve, 100));
                const actual = saveState({ force: true, snapshotOnly: true });
                delete actual.timestamp;
                const controls = fixture.snapshot.extra.controls.map(control => {
                    const input = document.getElementById(control.id);
                    return { id: input.id, type: input.type, value: input.value, checked: input.checked };
                });
                const metadata = Object.fromEntries(metadataBindings.map(([key, variable]) => [key, window.eval(variable)]));
                Object.values(drumMachineExtraTracks).forEach(track => { metadata[track.kind === 'clap' ? 'drumClap' : 'drumCymbals'] = track.metadata; });
                const audioDifferences = [];
                for (const info of fixture.audio) {
                    const variable = bindings.find(([key]) => key === info.key)?.[1];
                    const buffer = variable ? window.eval(variable) : drumMachineExtraTracks[info.key === 'drumClap' ? 'clap' : 'cymbals'].buffer;
                    if (!buffer || buffer.numberOfChannels !== info.channels || Math.abs(buffer.duration - info.duration) > 2 / buffer.sampleRate) { audioDifferences.push({ key: info.key, expected: info, actual: buffer && { channels: buffer.numberOfChannels, duration: buffer.duration, sampleRate: buffer.sampleRate } }); continue; }
                    const samples = buffer.getChannelData(0);
                    for (const fraction of [.17, .39, .63, .87]) {
                        const frame = Math.floor(buffer.length * fraction);
                        const expected = .13 * Math.sin(2 * Math.PI * info.frequency * frame / buffer.sampleRate);
                        if (Math.abs(samples[frame] - expected) > .003) audioDifferences.push(`${info.key}@${fraction}`);
                    }
                }
                return { actual, controls, metadata, audioDifferences, sampleRate: audioContext.sampleRate, assets: decoded.buffers.size, heldNotes: [...heldNotes], qPinned: mygrainQ.piano.pinned, qBankSamples: mygrainQ.piano.bank.samples.length };
            }, { fixture, bindings, metadataBindings, blockedStorage });
        }
        const expected = JSON.parse(JSON.stringify(fixture.snapshot.state));
        delete expected.timestamp;
        const first = await verifyRecall(original, false);
        assert.deepEqual(differences(expected, first.actual), [], 'Original-device recall must preserve every captured parameter.');
        assert.deepEqual(first.audioDifferences, [], 'Original-device sources must remain the saved sources.');
        assert.deepEqual(first.controls, fixture.snapshot.extra.controls);
        assert.deepEqual(first.metadata, fixture.snapshot.extra.metadata);
        console.log(`Original-device recall: ${Object.keys(expected.sliders).length} ranges, ${Object.keys(expected.selects).length} selects, ${Object.keys(expected.modes).length} mode fields, ${first.assets} audio slots.`);
        const firstRenderPhone = await openPhone(48000, accessFile);
        const firstRender = await firstRenderPhone.evaluate(async () => {
            if (mygrainSongBeta.song.parts[0].render) throw new Error('Expected a source-only part with no previously prepared render.');
            await mygrainSongBeta.arm();
            return { armed: mygrainSongBeta.armed, render: mygrainSongBeta.song.parts[0].render };
        });
        assert.equal(firstRender.armed, true);
        assert.equal(firstRender.render.portableVersion, 1);
        console.log(`First server freeze prepared on a fresh storage-blocked phone from saved ${instrument} sources; no prior local or server render.`);
        await original.evaluate(async () => { await mygrainSongBeta.refresh(); });
        await original.evaluate(async () => { await mygrainSongBeta.arm(); });
        const frozen = await original.evaluate(() => ({ song: mygrainSongBeta.song, armed: mygrainSongBeta.armed }));
        assert.equal(frozen.armed, true);
        assert.equal(frozen.song.parts[0].render.portableVersion, 1);
        for (const sampleRate of [48000, 44100]) {
            const phone = await openPhone(sampleRate, accessFile);
            const recalled = await verifyRecall(phone, true);
            assert.deepEqual(differences(expected, recalled.actual), [], `Clean ${sampleRate}Hz phone must not inherit local parameters.`);
            assert.deepEqual(recalled.audioDifferences, [], `Clean ${sampleRate}Hz phone must not inherit local samples.`);
            assert.deepEqual(recalled.controls, fixture.snapshot.extra.controls);
            assert.deepEqual(recalled.metadata, fixture.snapshot.extra.metadata);
            assert.deepEqual(recalled.heldNotes, fixture.snapshot.extra.heldNotes);
            assert.equal(recalled.qPinned, true);
            assert.equal(recalled.qBankSamples, fixture.snapshot.state.q.bank.samples.length);
            const playback = await phone.evaluate(async () => {
                const controller = mygrainSongBeta;
                await controller.refresh();
                controller.adapter.renderPart = async () => { throw new Error('A saved portable freeze must not be regenerated on another phone'); };
                await controller.arm();
                const part = controller.song.parts[0];
                const bytes = await controller.readRender(part);
                const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
                const buffer = await controller.loadRender(part);
                let energy = 0;
                for (const sample of buffer.getChannelData(0)) energy += sample * sample;
                return { armed: controller.armed, digest, expected: part.render.sha256, rms: Math.sqrt(energy / buffer.length), warning: controller.renderStore.warning };
            });
            assert.equal(playback.armed, true);
            assert.equal(playback.digest, playback.expected);
            assert.ok(playback.rms > 1e-7, JSON.stringify(playback));
            assert.match(playback.warning, /server renders/);
            console.log(`${sampleRate}Hz clean phone: access-file import; Q ${instrument}; all parameters and ${recalled.assets} sample slots match; blocked storage; verified server freeze ${playback.digest}; RMS ${playback.rms}.`);
        }
        const emptyPhone = await openPhone(48000, accessFile);
        const emptySlots = await emptyPhone.evaluate(async bindings => {
            await mygrainSongBetaAdapter.ready();
            Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage blocked', 'SecurityError'); } });
            saveAudioBufferToDB = async () => { throw new Error('IndexedDB unavailable'); };
            clearAudioBufferFromDB = async () => { throw new Error('IndexedDB unavailable'); };
            for (const [, variable] of bindings) window.eval(`${variable} = null`);
            Object.values(drumMachineExtraTracks).forEach(track => { track.buffer = null; });
            syncLegacyAudioBuffer();
            const captured = await mygrainSongBetaAdapter.capture();
            const bytes = await captured.arrayBuffer();
            const snapshot = mygrainSongBetaAdapter.inspectPart(bytes).snapshot;
            const stale = audioContext.createBuffer(1, 2048, audioContext.sampleRate);
            stale.getChannelData(0).fill(.9);
            window.__staleBuffer = stale;
            for (const [, variable] of bindings) window.eval(`${variable} = window.__staleBuffer`);
            Object.values(drumMachineExtraTracks).forEach(track => { track.buffer = stale; });
            mygrainQ.setAudioBuffer(stale);
            syncLegacyAudioBuffer();
            const decoded = await mygrainSongBetaAdapter.decode(bytes, { buffers: new Map(), bytes: 0 });
            mygrainSongBetaAdapter.recall(decoded, { start: false });
            return {
                slots: Object.values(snapshot.extra.audioSlots),
                assets: snapshot.assets.length,
                borrowed: bindings.filter(([, variable]) => window.eval(variable) !== null).map(([key]) => key),
                extraBorrowed: Object.values(drumMachineExtraTracks).filter(track => track.buffer !== null).map(track => track.kind),
                legacyBorrowed: audioBuffer !== null,
                qBorrowed: mygrainQ.getAudioBuffer() !== null
            };
        }, bindings);
        assert.equal(emptySlots.slots.length, 29);
        assert.ok(emptySlots.slots.every(value => value === false));
        assert.equal(emptySlots.assets, 0);
        assert.deepEqual(emptySlots.borrowed, []);
        assert.deepEqual(emptySlots.extraBorrowed, []);
        assert.equal(emptySlots.legacyBorrowed, false);
        assert.equal(emptySlots.qBorrowed, false);
        console.log('Empty-slot capture and recall succeed without browser storage: no stale grain, vocal, drum or legacy-source audio survives.');
        assert.deepEqual(historyRequests, []);
        assert.deepEqual(blockedSampleRequests, [], 'Restored Q banks must never fetch piano or string repository samples.');
        console.log('Generated-loop history is blocked throughout: capture, recall and saved freeze playback make zero requests to that store.');
        assert.deepEqual(errors, []);
    } finally {
        await Promise.all(contexts.map(context => context.close()));
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
