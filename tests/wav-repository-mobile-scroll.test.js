const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(process.env.WAV_BROWSER_UNIT_HTML || path.join(__dirname, '../index.html'), 'utf8');

function mobileScrollStyles() {
    const block = html.match(/@media ([^{]+)\{\s*(#wavRepositoryBrowserOverlay \.sample-browser-shell\s*\{[\s\S]*?)\n        \}/);
    assert.ok(block, 'WAV whole-dialog scrolling must have its own mobile media block');
    const rules = new Map([...block[2].matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, declarations]) => [
        selector.trim(),
        Object.fromEntries(declarations.trim().split(';').filter(declaration => declaration.trim()).map(declaration => {
            const separator = declaration.indexOf(':');
            return [declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim()];
        }))
    ]));
    return { query: block[1].trim(), rules };
}

function matchesViewport(query, width, height, pointer) {
    return query.split(',').some(alternative => {
        const conditions = [...alternative.matchAll(/\((max-width|max-height|pointer):\s*([^\)]+)\)/g)];
        assert.ok(conditions.length, 'each alternative must contain a viewport or pointer condition');
        return conditions.every(([, feature, value]) => {
            if (feature === 'pointer') return pointer === value.trim();
            assert.match(value, /^\d+px$/);
            return (feature === 'max-width' ? width : height) <= parseInt(value, 10);
        });
    });
}

test('whole-dialog scroll rules cover phone portrait, wide landscape and reduced viewport heights', () => {
    const { query } = mobileScrollStyles();
    for (const [width, height] of [[320, 568], [390, 844], [430, 932], [390, 500], [844, 390], [844, 300], [932, 430], [932, 300]]) {
        assert.ok(matchesViewport(query, width, height, 'coarse'), `${width}x${height} touch viewport must scroll the entire browser`);
    }
});

test('desktop and non-WAV browser selectors retain their existing scroll layout', () => {
    const { query, rules } = mobileScrollStyles();
    for (const [width, height, pointer] of [[1280, 800, 'fine'], [1440, 900, 'coarse'], [844, 390, 'fine'], [932, 430, 'fine'], [1024, 768, 'coarse']]) {
        assert.equal(matchesViewport(query, width, height, pointer), false, `${width}x${height} ${pointer} viewport must retain its existing layout`);
    }
    assert.deepEqual([...rules.keys()], [
        '#wavRepositoryBrowserOverlay .sample-browser-shell',
        '#wavRepositoryBrowserOverlay .sample-browser-shell > *',
        '#wavRepositoryBrowserOverlay .sample-browser-list'
    ]);
});

test('the bounded WAV shell is the only vertical scroll surface', () => {
    const { rules } = mobileScrollStyles();
    const shell = rules.get('#wavRepositoryBrowserOverlay .sample-browser-shell');
    const list = rules.get('#wavRepositoryBrowserOverlay .sample-browser-list');
    assert.equal(shell['overflow-y'], 'auto');
    assert.equal(shell['-webkit-overflow-scrolling'], 'touch');
    assert.equal(shell['overscroll-behavior-y'], 'contain');
    assert.equal(list.flex, 'none');
    assert.equal(list.overflow, 'visible', 'both axes must be visible so horizontal overflow cannot create a nested vertical scroller');
    assert.match(html, /\.sample-browser-shell\s*\{[^}]*max-height:\s*calc\(100dvh - 24px\)/);
});

test('header, injected favourites, status and complete file list stay in the shell flow', () => {
    const { rules } = mobileScrollStyles();
    const children = rules.get('#wavRepositoryBrowserOverlay .sample-browser-shell > *');
    assert.equal(children['flex-shrink'], '0', 'controls and files must not shrink into separate clipped panels');
    for (const declarations of rules.values()) {
        assert.equal(declarations.position, undefined, 'controls must scroll away instead of becoming pinned');
        assert.equal(declarations.display, undefined, 'controls and hidden upload input must keep their existing visibility');
        assert.equal(declarations.height, undefined, 'content must remain able to grow to the final notes and actions');
        assert.equal(declarations['max-height'], undefined, 'the file list must not gain a second viewport cap');
    }
    const overlay = html.match(/<div class="sample-browser-overlay" id="wavRepositoryBrowserOverlay"[\s\S]*?(?=\n        <div class="sample-browser-overlay")/)[0];
    for (const identifier of ['wavRepositoryBrowserTitle', 'wavRepositoryBrowserCloseBtn', 'wavRepositoryBrowserFilter', 'wavRepositoryBrowserUploadBtn', 'wavRepositoryBrowserRefreshBtn', 'wavRepositoryBrowserStatus', 'wavRepositoryBrowserList']) {
        assert.ok(overlay.includes(`id="${identifier}"`), `${identifier} must stay in the WAV dialog`);
    }
});
