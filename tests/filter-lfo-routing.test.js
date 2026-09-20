const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const filterTabMatch = indexHtml.match(/<div class="tab-content" id="filter-tab">([\s\S]*?)<!-- Noise Tab -->/);
const filterTabHtml = filterTabMatch ? filterTabMatch[1] : '';
const utilityTabMatch = indexHtml.match(/<div class="tab-content" id="utility-tab">([\s\S]*?)<!-- LFO Tab -->/);
const utilityTabHtml = utilityTabMatch ? utilityTabMatch[1] : '';
const randomizeSkipParamsMatch = indexHtml.match(/const RANDOMIZE_SKIP_PARAMS = new Set\(\[([\s\S]*?)\]\);/);
const randomizeSkipParamsBlock = randomizeSkipParamsMatch ? randomizeSkipParamsMatch[1] : '';

const utilityMountedFilterParams = [
    'lpfCutoff',
    'lpfQ',
    'hpfCutoff',
    'hpfQ'
];

const expectedFilterTabLfoParams = [
    'filterEnvAmount',
    'filterEnvAttack',
    'filterEnvDecay',
    'filterEnvSustain',
    'filterEnvRelease',
    'preFilterGain',
    'postFilterGain'
];

function countMatches(input, regex) {
    return (input.match(regex) || []).length;
}

test('default layout keeps tabbed controls section visible without simplified-ui body mode', () => {
    assert.doesNotMatch(
        indexHtml,
        /<body[^>]*class="[^"]*\bsimplified-ui\b[^"]*"/i,
        'default body should not opt into simplified-ui mode'
    );
    assert.match(indexHtml, /<div class="controls-section">/);
    assert.match(indexHtml, /<div class="tab-container">/);
    assert.match(indexHtml, /<div class="tab-content" id="utility-tab">/);
    assert.match(indexHtml, /LP Cutoff Mod/);
    assert.match(indexHtml, /LP Resonance Mod/);
    assert.match(indexHtml, /HP Cutoff Mod/);
    assert.match(indexHtml, /HP Resonance Mod/);
});

test('filter utility section hosts the four LP/HP modulation route controls without duplicating them in the filter rows', () => {
    assert.ok(filterTabHtml, 'filter tab markup should be present');
    assert.ok(utilityTabHtml, 'utility tab markup should be present');

    utilityMountedFilterParams.forEach((param) => {
        assert.equal(
            countMatches(filterTabHtml, new RegExp(`class="lfo-toggle" data-param="${param}" data-lfo="1"`, 'g')),
            0,
            `${param} should not keep an L1 route button inside the filter tab rows`
        );
        assert.equal(
            countMatches(filterTabHtml, new RegExp(`class="lfo-toggle" data-param="${param}" data-lfo="2"`, 'g')),
            0,
            `${param} should not keep an L2 route button inside the filter tab rows`
        );
        assert.equal(
            countMatches(utilityTabHtml, new RegExp(`class="lfo-toggle" data-param="${param}" data-lfo="1"`, 'g')),
            1,
            `${param} should expose exactly one utility-tab L1 route button`
        );
        assert.equal(
            countMatches(utilityTabHtml, new RegExp(`class="lfo-toggle" data-param="${param}" data-lfo="2"`, 'g')),
            1,
            `${param} should expose exactly one utility-tab L2 route button`
        );
    });

    expectedFilterTabLfoParams.forEach((param) => {
        assert.equal(
            countMatches(filterTabHtml, new RegExp(`class="lfo-toggle" data-param="${param}" data-lfo="1"`, 'g')),
            1,
            `${param} should keep exactly one L1 route button in the filter tab`
        );
        assert.equal(
            countMatches(filterTabHtml, new RegExp(`class="lfo-toggle" data-param="${param}" data-lfo="2"`, 'g')),
            1,
            `${param} should keep exactly one L2 route button in the filter tab`
        );
    });

    assert.equal(/data-param="autoMakeupGain"/.test(filterTabHtml), false, 'auto makeup checkbox should not get LFO routing buttons');
    assert.match(filterTabHtml, /class="filter-power-toggle active" data-filter-power="lpf">ON<\/button>/);
    assert.match(filterTabHtml, /class="slope-toggle active" data-filter="lpf" data-slope="12" data-poles="2">2P<\/button>/);
    assert.match(filterTabHtml, /class="filter-power-toggle active" data-filter-power="hpf">ON<\/button>/);
    assert.match(utilityTabHtml, /class="utility-route-group" role="group" aria-labelledby="utilityLpfCutoffModLabel"/);
    assert.match(utilityTabHtml, /<span class="param-name" id="utilityLpfCutoffModLabel">LP Cutoff Mod<\/span>/);
    assert.match(utilityTabHtml, /class="utility-route-group" role="group" aria-labelledby="utilityLpfResonanceModLabel"/);
    assert.match(utilityTabHtml, /<span class="param-name" id="utilityLpfResonanceModLabel">LP Resonance Mod<\/span>/);
    assert.match(utilityTabHtml, /class="utility-route-group" role="group" aria-labelledby="utilityHpfCutoffModLabel"/);
    assert.match(utilityTabHtml, /<span class="param-name" id="utilityHpfCutoffModLabel">HP Cutoff Mod<\/span>/);
    assert.match(utilityTabHtml, /class="utility-route-group" role="group" aria-labelledby="utilityHpfResonanceModLabel"/);
    assert.match(utilityTabHtml, /<span class="param-name" id="utilityHpfResonanceModLabel">HP Resonance Mod<\/span>/);
    assert.match(utilityTabHtml, /aria-label="Route LFO1 to low-pass cutoff"/);
    assert.match(utilityTabHtml, /aria-label="Invert LFO2 modulation for low-pass cutoff"/);
    assert.match(utilityTabHtml, /aria-label="Route LFO1 to high-pass resonance"/);
    assert.match(utilityTabHtml, /aria-label="Invert LFO2 modulation for high-pass resonance"/);
});

test('filter LFO routes are randomizable and preset-compatible', () => {
    assert.match(indexHtml, /filterEnvAmount: \{ min: 0, max: 100 \}/);
    assert.match(indexHtml, /filterEnvAttack: \{ min: 1, max: 2000 \}/);
    assert.match(indexHtml, /filterEnvDecay: \{ min: 1, max: 5000 \}/);
    assert.match(indexHtml, /filterEnvSustain: \{ min: 0, max: 100 \}/);
    assert.match(indexHtml, /filterEnvRelease: \{ min: 1, max: 5000 \}/);
    assert.match(indexHtml, /preFilterGain: \{ min: -24, max: 6 \}/);
    assert.match(indexHtml, /postFilterGain: \{ min: -24, max: 12 \}/);
    assert.match(indexHtml, /'filterEnvAmount', 'filterEnvAttack', 'filterEnvDecay', 'filterEnvSustain', 'filterEnvRelease',/);
    assert.match(indexHtml, /'preFilterGain', 'postFilterGain', 'noiseMix', 'reverb',/);
    assert.equal(/'preFilterGain'/.test(randomizeSkipParamsBlock), false, 'preFilterGain should not be skipped by route randomization');
    assert.equal(/'postFilterGain'/.test(randomizeSkipParamsBlock), false, 'postFilterGain should not be skipped by route randomization');
});

test('LFO route buttons sync aria-pressed and shared state through the existing helpers', () => {
    assert.match(
        indexHtml,
        /document\.querySelectorAll\('\.lfo-toggle'\)\.forEach\(btn => \{\s*btn\.setAttribute\('aria-pressed', String\(btn\.classList\.contains\('active'\)\)\);\s*btn\.addEventListener\('click', \(\) => \{\s*const param = btn\.dataset\.param;\s*const lfoNum = btn\.dataset\.lfo;\s*setLfoRouteState\(param, lfoNum, !btn\.classList\.contains\('active'\)\);/s
    );
    assert.match(
        indexHtml,
        /document\.querySelectorAll\('\.inv-toggle'\)\.forEach\(btn => \{\s*btn\.setAttribute\('aria-pressed', String\(btn\.classList\.contains\('active'\)\)\);\s*btn\.addEventListener\('click', \(\) => \{\s*const param = btn\.dataset\.param;\s*const lfoNum = btn\.dataset\.lfo;\s*setLfoInvertState\(param, lfoNum, !btn\.classList\.contains\('active'\)\);/s
    );
    assert.match(
        indexHtml,
        /function setLfoRouteState\(param, lfoNum, enabled\) \{\s*const map = lfoNum === '1' \? lfoEnabled : \(lfoNum === '2' \? lfo2Enabled : lfo3Enabled\);\s*map\[param\] = Boolean\(enabled\);\s*document\.querySelectorAll\(`\.lfo-toggle\[data-param="\$\{param\}"\]\[data-lfo="\$\{lfoNum\}"\]`\)\.forEach\(\(button\) => \{\s*button\.classList\.toggle\('active', Boolean\(enabled\)\);\s*button\.setAttribute\('aria-pressed', String\(Boolean\(enabled\)\)\);/s
    );
    assert.match(
        indexHtml,
        /function setLfoInvertState\(param, lfoNum, enabled\) \{\s*const map = lfoNum === '1' \? lfoInverted : \(lfoNum === '2' \? lfo2Inverted : lfo3Inverted\);\s*map\[param\] = Boolean\(enabled\);\s*document\.querySelectorAll\(`\.inv-toggle\[data-param="\$\{param\}"\]\[data-lfo="\$\{lfoNum\}"\]`\)\.forEach\(\(button\) => \{\s*button\.classList\.toggle\('active', Boolean\(enabled\)\);\s*button\.setAttribute\('aria-pressed', String\(Boolean\(enabled\)\)\);/s
    );
});
