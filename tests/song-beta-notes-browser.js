const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const base = process.env.SONG_BETA_TEST_URL || 'https://openclaw.blackcarburning.com/mygrain/';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mygrain\/$/.test(base) && base !== 'https://openclaw.blackcarburning.com/mygrain/') throw new Error('Use the live MYGRAIN route or an isolated localhost test server.');

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort());
        await page.goto(base, { waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
        const structure = await page.locator('#songBetaCard').evaluate(card => {
            const transport = card.querySelector('#songBetaTransport');
            const info = card.querySelector('#songBetaTransportInfo');
            const status = card.querySelector('#songBetaStatus');
            const parts = card.querySelector('#songBetaParts');
            const notes = card.querySelector('#songBetaNotes');
            return {
                transport: [...transport.children].map(button => button.id),
                transportNext: transport.nextElementSibling.id,
                infoNext: info.nextElementSibling.id,
                infoTitle: info.querySelector('h3').textContent,
                infoLabel: info.getAttribute('aria-labelledby'),
                statusInInfo: info.contains(status),
                partsNext: parts.nextElementSibling.id,
                notesLast: card.lastElementChild === notes,
                notesClosed: !notes.open,
                title: notes.querySelector('summary').textContent,
                helpOnlyInNotes: [...card.querySelectorAll('.song-beta-help')].every(help => help.closest('#songBetaNotes') === notes),
                statusOutsideNotes: !notes.contains(status),
                summaryInNotes: notes.contains(card.querySelector('#songBetaCacheSummary')),
                statusRole: status.getAttribute('role'),
                statusLive: status.getAttribute('aria-live')
            };
        });
        assert.deepEqual(structure, { transport: ['songBetaPlay', 'songBetaLoop', 'songBetaExport', 'songBetaStop'], transportNext: 'songBetaTransportInfo', infoNext: 'songBetaParts', infoTitle: 'TRANSPORT INFO', infoLabel: 'songBetaTransportInfoTitle', statusInInfo: true, partsNext: 'songBetaNotes', notesLast: true, notesClosed: true, title: 'Notes and Instructions', helpOnlyInNotes: true, statusOutsideNotes: true, summaryInNotes: true, statusRole: 'status', statusLive: 'polite' });
        await page.evaluate(() => {
            document.getElementById('start-overlay').style.display = 'none';
            const verse = { id: 'verse', name: 'Verse 1', bpm: 120, patternSteps: 16, repeats: 1, sha256: 'verse-fixture' };
            const song = { id: 'layout-fixture', name: 'Layout fixture', parts: [{ ...verse, id: 'intro', name: 'Intro', sha256: 'intro-fixture' }, verse, { ...verse, id: 'verse-again', sourcePartId: verse.id }] };
            mygrainSongBeta.song = song;
            mygrainSongBeta.songs = [song];
            mygrainSongBeta.render();
            mygrainSongBeta.status('Loading/live status fixture');
        });
        const notes = page.locator('#songBetaNotes');
        const summary = notes.locator('summary');
        const content = notes.locator('.song-beta-notes-content');
        const layouts = [];
        for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 844 }]) {
            await page.setViewportSize(viewport);
            const transportLayout = await page.evaluate(() => {
                const status = document.getElementById('songBetaStatus');
                const info = document.getElementById('songBetaTransportInfo');
                const parts = document.getElementById('songBetaParts');
                const states = [];
                for (const message of ['', 'Playing Intro.', 'Song stopped. Saved parts and armed cache are unchanged.', `Playing ${'Very long song part name '.repeat(40)}`, 'Audio error '.repeat(80)]) {
                    mygrainSongBeta.status(message, message.startsWith('Audio error'));
                    const style = getComputedStyle(status);
                    states.push({
                        infoHeight: info.getBoundingClientRect().height,
                        statusHeight: status.clientHeight,
                        lineHeight: parseFloat(style.lineHeight),
                        partsTop: parts.getBoundingClientRect().top + window.scrollY,
                        overflowing: status.scrollHeight > status.clientHeight,
                        error: status.classList.contains('song-beta-error')
                    });
                }
                status.scrollTop = status.scrollHeight;
                const canScroll = status.scrollTop > 0;
                status.scrollTop = 0;
                mygrainSongBeta.status('Loading/live status fixture');
                return { states, canScroll };
            });
            assert.equal(new Set(transportLayout.states.map(state => state.infoHeight)).size, 1);
            assert.equal(new Set(transportLayout.states.map(state => state.partsTop)).size, 1);
            assert.ok(transportLayout.states.every(state => state.statusHeight === state.lineHeight * 3));
            assert.equal(transportLayout.states.at(-1).overflowing, true);
            assert.equal(transportLayout.states.at(-1).error, true);
            assert.equal(transportLayout.canScroll, true);
            assert.equal(await notes.evaluate(folder => folder.open), false);
            assert.equal(await content.isVisible(), false);
            assert.equal(await summary.locator('.song-beta-notes-indicator').evaluate(indicator => getComputedStyle(indicator, '::before').content), '"+"');
            assert.equal(await page.locator('#songBetaStatus').isVisible(), true);
            const closedHeight = await page.locator('#songBetaCard').evaluate(card => card.getBoundingClientRect().height);
            await summary.click();
            assert.equal(await notes.evaluate(folder => folder.open), true);
            assert.equal(await content.isVisible(), true);
            assert.equal(await content.locator('.song-beta-help').count(), 5);
            assert.equal(await summary.locator('.song-beta-notes-indicator').evaluate(indicator => getComputedStyle(indicator, '::before').content), '"−"');
            assert.equal(await page.locator('#songBetaCard').evaluate(card => card.getBoundingClientRect().height > 0), true);
            const openHeight = await page.locator('#songBetaCard').evaluate(card => card.getBoundingClientRect().height);
            assert.ok(openHeight > closedHeight + 100);
            await page.evaluate(() => mygrainSongBeta.render());
            assert.equal(await notes.evaluate(folder => folder.open), true);
            await summary.focus();
            await summary.press('Enter');
            assert.equal(await notes.evaluate(folder => folder.open), false);
            await summary.press('Space');
            assert.equal(await notes.evaluate(folder => folder.open), true);
            await summary.click();
            assert.equal(await notes.evaluate(folder => folder.open), false);
            const bounds = await page.locator('#songBetaCard').evaluate(card => {
                const transport = card.querySelector('#songBetaTransport').getBoundingClientRect();
                const status = card.querySelector('#songBetaStatus').getBoundingClientRect();
                const parts = card.querySelector('#songBetaParts').getBoundingClientRect();
                const notes = card.querySelector('#songBetaNotes').getBoundingClientRect();
                return { ordered: transport.bottom <= status.top + 1 && status.bottom <= parts.top + 1 && parts.bottom <= notes.top + 1, overflow: card.scrollWidth > card.clientWidth + 2 };
            });
            assert.equal(bounds.ordered, true);
            assert.equal(bounds.overflow, false);
            assert.equal(await page.locator('#songBetaStatus').textContent(), 'Loading/live status fixture');
            if (viewport.width === 1440 || viewport.width === 390) await page.locator('#songBetaCard').screenshot({ path: `/tmp/mygrain-song-notes-${viewport.width}.png` });
            layouts.push({ width: viewport.width, closedHeight, openHeight, transportLayout });
        }
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => window.mygrainSongBeta && !mygrainSongBeta.busy);
        assert.equal(await notes.evaluate(folder => folder.open), false);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ readOnly: true, structure, clickToggle: true, keyboardToggle: true, notesStayOpenAcrossRender: true, notesClosedAfterReload: true, layouts, errors }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
