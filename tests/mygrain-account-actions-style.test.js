const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../mygrain-accounts.css'), 'utf8');
const actionScopes = ['.mygrain-start-account', '.mygrain-account-panel'];
const buttonScopes = ['#start-overlay .mygrain-start-account', '.mygrain-account-panel'];
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];

function declarations(selector) {
    const matching = rules.filter(rule => rule[1].split(',').some(part => part.trim() === selector));
    assert.ok(matching.length, `Missing account-action rule: ${selector}`);
    return Object.fromEntries(matching.flatMap(rule => rule[2].split(';').filter(part => part.trim()).map(part => {
        const separator = part.indexOf(':');
        return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
    })));
}

test('remembered-start and login action rows use equal, shrinkable grid columns and stretch', () => {
    for (const [index, scope] of actionScopes.entries()) {
        const style = declarations(`${scope} .mygrain-account-actions`);
        assert.equal(style.display, 'grid');
        assert.equal(style['grid-template-columns'], `repeat(${index === 0 ? 3 : 2}, minmax(0, 1fr))`);
        assert.equal(style['align-items'], 'stretch');
        assert.equal(style.width, '100%');
        assert.equal(style['min-width'], '0');
    }
});

test('scoped action buttons keep full wrapping labels, touch targets and matching navy/cyan surfaces', () => {
    for (const scope of buttonScopes) {
        const style = declarations(`${scope} .mygrain-account-actions > button`);
        assert.equal(style['box-sizing'], 'border-box');
        assert.equal(style.width, '100%');
        assert.equal(style['min-width'], '0');
        assert.equal(style['max-width'], '100%');
        assert.equal(style.height, 'auto');
        assert.equal(style['align-self'], 'stretch');
        assert.ok(parseFloat(style['min-height']) >= 44);
        assert.ok(parseFloat(style['border-radius']) >= 12);
        assert.equal(style['white-space'], 'normal');
        assert.equal(style['overflow-wrap'], 'anywhere');
        assert.equal(style['text-transform'], 'none');
        assert.equal(style['text-overflow'], undefined);
        assert.equal(style.overflow, undefined);
        assert.match(style.background, /linear-gradient\(/);
        assert.match(style['box-shadow'], /inset/);
        assert.match(style.color, /^#/);
    }
});

test('action buttons expose focus, non-disabled hover, disabled and reduced-motion states', () => {
    for (const scope of buttonScopes) {
        const selector = `${scope} .mygrain-account-actions > button`;
        const focus = declarations(`${selector}:focus-visible`);
        assert.match(focus.outline, /^3px solid #/);
        assert.equal(focus['outline-offset'], '3px');
        assert.match(declarations(`${selector}:hover:not(:disabled)`).background, /linear-gradient\(/);
        const disabled = declarations(`${selector}:disabled`);
        assert.equal(disabled.cursor, 'not-allowed');
        assert.ok(Number(disabled.opacity) >= .5 && Number(disabled.opacity) < 1);
    }
    assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^{}]+\{\s*transition:\s*none;/);
});
