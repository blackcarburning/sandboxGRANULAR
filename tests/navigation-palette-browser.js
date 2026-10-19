const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { chromium, webkit } = require('playwright-core');

const sourceRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(process.env.MYGRAIN_VIDEO_HTML || path.join(sourceRoot, 'index.html'), 'utf8');
const paletteSource = fs.readFileSync(process.env.MYGRAIN_VIDEO_PALETTE || path.join(sourceRoot, 'navigation-palette.js'), 'utf8');
const windowMock = { document: { readyState: 'loading', addEventListener() {} } };
vm.runInNewContext(paletteSource, { window: windowMock });
const contract = windowMock.mygrainNavigation;
const pinned = {
    song: '#b8efbe',
    mega: 'linear-gradient(180deg, rgba(8, 54, 70, 0.96), rgba(17, 103, 125, 0.96))',
    sparse: 'linear-gradient(180deg, rgba(74, 46, 10, 0.96), rgba(138, 98, 18, 0.96))',
    keyboard: '#b4c5ff', 'granular-keys': '#85d6ed', synth: '#e1bbff',
    transport: 'linear-gradient(180deg, rgba(72, 20, 28, 0.96), rgba(128, 32, 46, 0.96))',
    top: '#dae2eb', 'loop-a': '#ffad91', 'loop-b': '#f3bc75', 'loop-c': '#ece276',
    'loop-v': '#ff9dbb', radiolab: '#78e0d0', videolab: '#bcc8ef', 'loop-p': '#c2de80', 'loop-o': '#89dba7',
    'loop-l': '#8bcce5', 'loop-x': '#b6b0ff', 'loop-q': '#d6a1ed', 'loop-m': '#f5acd8',
    'loop-m-plus': '#e6c0a0', 'loop-k': '#b7d4bc', drums: '#e9a28c', sample: '#9ed6d9',
    layers: '#a4e8cb', mixer: '#ffc28e', 'quick-grain': '#c2c8ed', filter: '#b6d76d',
    actions: '#dfb0f2', export: '#edc677', 'wav-browser': '#8cbce3', 'stem-export': '#e3d0a5',
    grain: '#92c9bc', mix: '#e8b5a6', lfo: '#b5ca83', fx: '#c3b3d8', delay: '#d8b1c0',
    reverb: '#9fbbca', sources: '#d5cea1', waveforms: '#9fb8ef', 'source-wave': '#7ed9f0',
    'wave-a': '#c6dbb1', 'wave-b': '#dec1e7', pan: '#efc4cf'
};
assert.deepEqual(JSON.parse(JSON.stringify(contract.palette)), pinned);
assert.ok(Object.isFrozen(contract.palette));
assert.ok(Object.isFrozen(contract.appearances));
assert.equal(new Set(Object.values(pinned)).size, Object.keys(pinned).length);
for (const [section, appearance] of Object.entries(contract.appearances)) {
    assert.ok(appearance.background.startsWith('linear-gradient('), `${section} gradient`);
    assert.ok(Object.isFrozen(appearance));
}
for (const match of html.matchAll(/data-jump-(?:target|click)="([^"]+)"/g)) {
    assert.ok(contract.sectionForTarget(match[1]), `Unregistered destination ${match[1]}`);
}
let inlineScripts = 0;
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(match[1])) continue;
    new vm.Script(match[2]);
    inlineScripts += 1;
}
const buildMarkers = Array.from(html.matchAll(/(v\d{4}\.\d{2}\.\d{2}\.[A-Z]\.\d+)<\/strong>/g), match => match[1]);
assert.equal(buildMarkers.length, 2);
assert.equal(new Set(buildMarkers).size, 1);
assert.ok(html.includes('q-card.js?v=20261016-k-keyboard-19'));
assert.ok(html.includes('mygrain-accounts.js?v=20261017-account-credits-r2'));

const evidence = process.env.NAVIGATION_EVIDENCE || fs.mkdtempSync(path.join(os.tmpdir(), 'mygrain-navigation-test-'));
fs.mkdirSync(evidence, { recursive: true });
const isolatedRoot = path.join(evidence, 'site');
const staticRoot = path.join(isolatedRoot, 'mygrain');
fs.mkdirSync(staticRoot, { recursive: true });
for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (entry.isFile() && /\.(?:html|css|js|json)$/.test(entry.name)) {
        fs.copyFileSync(path.join(sourceRoot, entry.name), path.join(staticRoot, entry.name));
    }
}
fs.writeFileSync(path.join(staticRoot, 'index.html'), html);
fs.writeFileSync(path.join(staticRoot, 'navigation-palette.js'), paletteSource);
const identity = { ok: true, user: { username: 'navigation-test' } };
const blocked = [];
const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!['GET', 'HEAD'].includes(request.method)) {
        blocked.push(`${request.method} ${pathname}`);
        response.writeHead(405).end();
        return;
    }
    if (pathname === '/mygrain/account-context.js') {
        response.writeHead(200, { 'Content-Type': 'text/javascript' });
        response.end(`window.mygrainAccountContext=${JSON.stringify(identity)};`);
        return;
    }
    if (pathname.startsWith('/mygrain/api/')) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ...identity, stations: [], samples: [], files: [], folders: [], songs: [], patches: [], favourites: [], sources: [], users: [] }));
        return;
    }
    const filename = path.resolve(isolatedRoot, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
    if (!filename.startsWith(`${isolatedRoot}${path.sep}`) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
        response.writeHead(404).end();
        return;
    }
    const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[path.extname(filename)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    fs.createReadStream(filename).pipe(response);
});

function luminance(channels) {
    return channels.map(channel => {
        const fraction = channel / 255;
        return fraction <= 0.04045 ? fraction / 12.92 : ((fraction + 0.055) / 1.055) ** 2.4;
    }).reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrast(background, foreground) {
    const first = luminance(background);
    const second = luminance(foreground);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

async function inspectPalette(page) {
    return page.evaluate(() => {
        const navigation = window.mygrainNavigation;
        return Array.from(document.querySelectorAll(navigation.selector), button => {
            const style = getComputedStyle(button);
            return {
                id: button.id, label: button.textContent.trim(), section: button.dataset.navSection,
                missing: button.dataset.navMissing, background: style.backgroundColor,
                image: style.backgroundImage, foreground: style.color,
                canonical: button.style.getPropertyValue('--nav-background'),
                navigation: button.matches('.section-jump-option, .section-jump-quick, .performance-layer-jump-btn, [data-jump-target], [data-jump-click], [data-granular-keyboard-ready], .performance-mixer-jump-btn, [data-gain-stage-control]'),
                control: button.dataset.performanceModuleJump || button.getAttribute('aria-controls'),
                module: Boolean(button.dataset.performanceModuleJump),
                slider: button.closest('#performanceMixerSliderJumps') !== null
            };
        });
    });
}

async function verifyLayerStates(page, viewport) {
    const activate = button => viewport.width < 1000 ? button.tap() : button.click();
    const buttons = page.locator('#performanceLayerSwitchesCard .performance-layer-solo-btn');
    const count = await buttons.count();
    let stableJumps = 0;
    for (let index = 0; index < count; index += 1) {
        const button = buttons.nth(index);
        await button.scrollIntoViewIfNeeded();
        const inspect = () => button.evaluate(element => {
            const jump = element.closest('.performance-layer-switch-row').querySelector('.performance-layer-jump-btn');
            return {
                width: element.getBoundingClientRect().width,
                jumpX: jump?.getBoundingClientRect().x ?? null,
                pressed: element.getAttribute('aria-pressed'),
                label: element.textContent.trim(),
                image: getComputedStyle(element).backgroundImage,
                foreground: getComputedStyle(element).color,
                overflow: element.scrollWidth > element.clientWidth
            };
        });
        const initial = await inspect();
        assert.equal(initial.pressed, 'false');
        assert.equal(initial.label, 'Solo Off');
        assert.equal(initial.width, 100);
        assert.equal(initial.overflow, false);
        for (const pressed of ['true', 'false', 'true', 'false']) {
            await activate(button);
            const state = await inspect();
            assert.equal(state.pressed, pressed);
            assert.equal(state.label, pressed === 'true' ? 'Solo On' : 'Solo Off');
            assert.equal(state.width, initial.width, 'Fixed Solo width');
            assert.equal(state.jumpX, initial.jumpX, 'Jump must never move during Solo toggles');
            assert.equal(state.overflow, false);
            if (pressed === 'true') assert.notEqual(state.image, initial.image, 'Solo active state remains distinct');
            else assert.equal(state.image, initial.image, 'Solo off restores destination gradient');
        }
        if (initial.jumpX !== null) stableJumps += 1;
    }
    const oscillator = page.locator('#performanceLayerOscBtn');
    const initialMute = await oscillator.evaluate(element => ({ pressed: element.getAttribute('aria-pressed'), image: getComputedStyle(element).backgroundImage }));
    await activate(oscillator);
    const toggledMute = await oscillator.evaluate(element => ({ pressed: element.getAttribute('aria-pressed'), image: getComputedStyle(element).backgroundImage, muted: element.classList.contains('layer-muted') }));
    assert.notEqual(toggledMute.pressed, initialMute.pressed);
    assert.notEqual(toggledMute.image, initialMute.image, 'Muted layer remains visually distinct');
    assert.equal(toggledMute.muted, toggledMute.pressed === 'false');
    await activate(oscillator);
    await page.locator('#performanceLayerSwitchesCard').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidence, `layers-${viewport.width}x${viewport.height}.png`) });
    return { soloButtons: count, toggles: count * 4, stableJumps };
}

async function verifyMixerStates(page, viewport) {
    const activate = button => viewport.width < 1000 ? button.tap() : button.click();
    const buttons = page.locator('#performanceMixerCard .performance-mixer-solo-btn');
    const count = await buttons.count();
    assert.ok(count >= 20, 'Mixer Solo buttons mounted');
    for (let index = 0; index < count; index += 1) {
        const button = buttons.nth(index);
        const before = await button.evaluate(element => getComputedStyle(element).backgroundImage);
        await activate(button);
        assert.equal(await button.getAttribute('aria-pressed'), 'true');
        assert.notEqual(await button.evaluate(element => getComputedStyle(element).backgroundImage), before);
        await activate(button);
        assert.equal(await button.getAttribute('aria-pressed'), 'false');
        assert.equal(await button.evaluate(element => getComputedStyle(element).backgroundImage), before);
    }
    const vu = page.locator('#performanceMixerVuToggleBtn');
    const before = await vu.evaluate(element => getComputedStyle(element).backgroundImage);
    await activate(vu);
    assert.equal(await vu.getAttribute('aria-pressed'), 'false');
    assert.notEqual(await vu.evaluate(element => getComputedStyle(element).backgroundImage), before);
    await activate(vu);
    await page.locator('#performanceMixerJumpCard').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidence, `mixer-${viewport.width}x${viewport.height}.png`) });
    return { soloButtons: count, toggles: count * 2, vuState: true };
}

async function clickArrival(page, buttonSelector, targetSelector, touch) {
    await page.waitForFunction(() => {
        const drawer = document.querySelector('#sectionJumpDrawer');
        return !drawer.classList.contains('is-close-guarded') && !drawer.classList.contains('is-settling');
    });
    const before = await page.locator(targetSelector).evaluate(target => target.getBoundingClientRect().top);
    await page.locator(buttonSelector).scrollIntoViewIfNeeded();
    if (touch) await page.locator(buttonSelector).tap();
    else await page.locator(buttonSelector).click();
    try {
        await page.waitForFunction(target => {
            const rectangle = document.querySelector(target).getBoundingClientRect();
            return rectangle.top >= -2 && rectangle.top < innerHeight * 0.65;
        }, targetSelector);
    } catch (error) {
        console.error(JSON.stringify({ buttonSelector, targetSelector, state: await page.evaluate(target => ({ top: document.querySelector(target).getBoundingClientRect().top, scrollY, drawer: document.querySelector('#sectionJumpDrawer').className }), targetSelector) }));
        await page.screenshot({ path: path.join(evidence, 'failed-navigation.png') });
        throw error;
    }
    assert.ok(await page.locator(targetSelector).evaluate(target => {
        const rectangle = target.getBoundingClientRect();
        const hit = document.elementFromPoint(Math.min(innerWidth - 40, Math.max(10, rectangle.left + 30)), Math.max(5, rectangle.top + 20));
        return target.contains(hit);
    }), `${targetSelector} receives taps after navigation`);
    return before;
}

(async () => {
    let browser;
    const results = [];
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;
        assert.notEqual(port, 18840);
        const base = `http://127.0.0.1:${port}/mygrain/`;
        const engine = process.env.NAVIGATION_TEST_BROWSER === 'webkit' ? webkit : chromium;
        browser = await engine.launch(engine === webkit ? { headless: true } : { executablePath: process.env.CHROMIUM_PATH || '/snap/chromium/current/usr/lib/chromium-browser/chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        let reference;
        for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1365, height: 900 }]) {
            const touch = viewport.width < 1000;
            const context = await browser.newContext({ viewport, isMobile: touch, hasTouch: touch, reducedMotion: 'reduce' });
            const page = await context.newPage();
            page.setDefaultTimeout(15000);
            const errors = [];
            const expectedPageErrors = engine === webkit ? ["null is not an object (evaluating 'document.body.prepend')"] : [];
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', route => {
                const request = route.request();
                if (new URL(request.url()).origin !== new URL(base).origin) return route.abort();
                if (!['GET', 'HEAD'].includes(request.method())) {
                    blocked.push(`${request.method()} ${request.url()}`);
                    return route.abort();
                }
                return route.continue();
            });
            const ready = async () => {
                try {
                    await page.waitForFunction(() => window.mygrainNavigation && document.querySelectorAll('#performanceMixerSliderJumps button').length > 0 && document.querySelectorAll('#performanceMixerSliderJumps button').length === document.querySelectorAll('#performanceMixerCard input[type="range"]').length);
                } catch (error) {
                    console.error(JSON.stringify({ errors, state: await page.evaluate(() => ({ url: location.href, navigation: Boolean(window.mygrainNavigation), sliders: document.querySelectorAll('#performanceMixerSliderJumps button').length, locked: document.documentElement.dataset.mygrainLocked, text: document.body.innerText.slice(0, 800) })) }, null, 2));
                    throw error;
                }
                await page.evaluate(() => {
                    document.querySelector('#start-overlay').style.display = 'none';
                    window.scrollTo(0, 0);
                });
            };
            await page.goto(base, { waitUntil: 'load' });
            await ready();
            const rows = await inspectPalette(page);
            assert.ok(rows.length > 100);
            const bySection = new Map();
            for (const row of rows) {
                assert.ok(row.section && !row.missing, `Uncoloured jump ${row.id || row.label}`);
                assert.equal(row.canonical, contract.appearances[row.section].background);
                assert.ok(row.image.startsWith('linear-gradient('), `Gradient missing ${row.id || row.label}`);
                const visibleColour = JSON.stringify([row.background, row.image, row.foreground]);
                if (row.navigation) {
                    if (bySection.has(row.section)) assert.equal(visibleColour, bySection.get(row.section), `Colour mismatch ${row.section}`);
                    bySection.set(row.section, visibleColour);
                }
                const foreground = row.foreground.match(/[\d.]+/g).slice(0, 3).map(Number);
                assert.ok(foreground.every(channel => channel >= 190), `Light writing ${row.id || row.label}`);
                const backgrounds = row.image === 'none' ? [row.background] : row.image.match(/rgba?\([^)]+\)/g);
                for (const background of backgrounds) {
                    const channels = background.match(/[\d.]+/g).slice(0, 3).map(Number);
                    assert.ok(contrast(channels, foreground) >= 4.5, `Unreadable ${row.section}: ${background}`);
                }
            }
            assert.equal(new Set(bySection.values()).size, bySection.size, 'Distinct semantic destinations must have distinct visible colours');
            const sorted = Object.fromEntries([...bySection.entries()].sort());
            if (reference) assert.deepEqual(sorted, reference, 'Phone/desktop palette equality');
            reference = sorted;
            const modules = rows.filter(row => row.module);
            const sliders = rows.filter(row => row.slider);
            const mixerControls = await page.locator('#performanceMixerCard input[type="range"]').count();
            assert.equal(sliders.length, mixerControls);
            assert.equal(modules.length, mixerControls);
            for (const module of modules) {
                assert.equal(sliders.find(slider => slider.control === module.control)?.section, module.section, `Module/slider equality ${module.control}`);
            }
            const layers = await verifyLayerStates(page, viewport);
            const mixer = await verifyMixerStates(page, viewport);
            if (process.env.NAVIGATION_TEST_SCOPE === 'appearance') {
                if (touch) {
                    await page.locator('#sectionJumpHandle').tap();
                    await page.screenshot({ path: path.join(evidence, `menu-${viewport.width}x${viewport.height}.png`) });
                }
                assert.deepEqual(errors, expectedPageErrors, 'No new appearance fixture errors');
                results.push({ viewport, scope: 'appearance', paintedButtons: rows.length, semanticColours: bySection.size, moduleSliderPairs: modules.length, layers, mixer, pageErrors: errors });
                await context.close();
                continue;
            }
            if (touch) {
                await page.locator('#sectionJumpHandle').tap();
                await page.screenshot({ path: path.join(evidence, `menu-${viewport.width}x${viewport.height}.png`) });
                await clickArrival(page, '#sectionJumpRadiolabBtn', '#radiolabCard', touch);
                await page.waitForFunction(() => !document.querySelector('#sectionJumpDrawer').classList.contains('is-open'));
                await page.waitForFunction(() => !document.querySelector('#sectionJumpDrawer').classList.contains('is-close-guarded'));
                await page.locator('#sectionJumpHandle').tap();
                await clickArrival(page, '#sectionJumpActionsBtn', '.performance-actions-card', touch);
            } else {
                assert.equal(await page.locator('#sectionJumpHandle').isVisible(), false);
                await page.locator('.performance-actions-card').scrollIntoViewIfNeeded();
            }
            await page.waitForFunction(() => !document.querySelector('#sectionJumpDrawer').classList.contains('is-settling'));
            await clickArrival(page, '#performanceRadiolabJumpBtn', '#radiolabCard', touch);
            await page.screenshot({ path: path.join(evidence, `radiolab-${viewport.width}x${viewport.height}.png`) });
            await page.waitForFunction(() => !document.querySelector('#sectionJumpDrawer').classList.contains('is-settling'));
            if (touch) await clickArrival(page, '#sectionJumpBastardMixerBtn', '#performanceMixerCard', touch);
            else await page.locator('#performanceMixerJumpCard').scrollIntoViewIfNeeded();
            for (const control of ['performanceBastardLoopQLevelMixer', 'performanceGrainAVolume', 'performanceGrainBVolume']) {
                const button = page.locator(`#${control}JumpBtn`);
                await button.scrollIntoViewIfNeeded();
                if (touch) await button.tap(); else await button.click();
                assert.equal(await page.evaluate(() => document.activeElement.id), control);
                const module = page.locator(`[data-performance-module-jump="${control}"]`);
                const expected = await module.evaluate(element => window.mygrainNavigation.sectionForTarget(PERFORMANCE_MIXER_MODULE_JUMPS[element.dataset.performanceModuleJump]));
                assert.equal(await module.getAttribute('data-nav-section'), expected);
                await module.scrollIntoViewIfNeeded();
                if (touch) await module.tap(); else await module.click();
                const target = await page.evaluate(controlId => PERFORMANCE_MIXER_MODULE_JUMPS[controlId], control);
                await page.waitForFunction(selector => Math.abs(document.querySelector(selector).getBoundingClientRect().top) < 200, target);
            }
            await page.evaluate(() => {
                for (const selector of ['#sectionJumpTransportBtn', '#sectionJumpTransportPanelBtn']) document.querySelector(selector).classList.add('is-running');
            });
            const running = (await inspectPalette(page)).filter(row => row.section === 'transport');
            assert.equal(running.length, 2);
            assert.equal(running[0].image, running[1].image);
            assert.ok(running[0].image.includes('11, 72, 40'));
            await page.evaluate(() => {
                document.querySelectorAll('[data-nav-section="transport"]').forEach(button => button.classList.remove('is-running'));
                const grid = document.querySelector('.section-jump-grid');
                Array.from(grid.children).reverse().forEach(button => grid.appendChild(button));
                const link = document.createElement('button');
                link.id = 'navigationDynamicGrainJump';
                link.dataset.jumpTarget = '#grainAWaveformEditor';
                document.body.appendChild(link);
                const gain = document.createElement('button');
                gain.id = 'navigationDynamicGainJump';
                gain.dataset.gainStageControl = 'performanceBastardLoopQLevelMixer';
                document.body.appendChild(gain);
            });
            await page.waitForFunction(() => document.querySelector('#navigationDynamicGrainJump').dataset.navSection === 'wave-a' && document.querySelector('#navigationDynamicGainJump').dataset.navSection === 'loop-q');
            const reordered = await inspectPalette(page);
            for (const row of reordered) assert.equal(row.canonical, contract.appearances[row.section].background);
            await page.evaluate(() => {
                const future = document.createElement('section');
                future.id = 'futureUnregisteredSection';
                document.querySelector('.synth-container').appendChild(future);
                const button = document.querySelector('#navigationDynamicGrainJump');
                button.dataset.jumpTarget = '#futureUnregisteredSection';
            });
            await page.waitForFunction(() => document.querySelector('#navigationDynamicGrainJump').dataset.navMissing === 'true');
            await page.screenshot({ path: path.join(evidence, `navigation-${viewport.width}x${viewport.height}.png`) });
            await page.reload({ waitUntil: 'load' });
            await ready();
            const reloaded = await inspectPalette(page);
            assert.deepEqual(reloaded.map(row => [row.id, row.section, row.canonical]), rows.map(row => [row.id, row.section, row.canonical]));
            assert.deepEqual(errors, expectedPageErrors, 'No new navigation fixture errors');
            results.push({ viewport, paintedButtons: rows.length, semanticColours: bySection.size, moduleSliderPairs: modules.length, layers, mixer, radiolabMenuClick: touch, radiolabActionsClick: true, desktopMenuRemainsHidden: !touch, grainAndLoopClicks: true, reorderReloadAndDynamic: true });
            await context.close();
        }
        const result = { ok: true, base, isolatedRoot, evidence, inlineScripts, paletteEntries: Object.keys(pinned).length, blockedWrites: blocked, results };
        fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(result, null, 2));
        console.log(JSON.stringify(result, null, 2));
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => {
    console.error(`Evidence: ${evidence}`);
    console.error(error);
    process.exitCode = 1;
});
