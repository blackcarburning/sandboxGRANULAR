const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const filterTabMatch = indexHtml.match(/<div class="tab-content" id="filter-tab">([\s\S]*?)<!-- Noise Tab -->/);
const filterTabHtml = filterTabMatch ? filterTabMatch[1] : '';
const randomizeSkipParamsMatch = indexHtml.match(/const RANDOMIZE_SKIP_PARAMS = new Set\(\[([\s\S]*?)\]\);/);
const randomizeSkipParamsBlock = randomizeSkipParamsMatch ? randomizeSkipParamsMatch[1] : '';

const expectedFilterLfoParams = [
    'lpfCutoff',
    'lpfQ',
    'hpfCutoff',
    'hpfQ',
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

test('every filter slider exposes exactly one L1 and one L2 route button', () => {
    assert.ok(filterTabHtml, 'filter tab markup should be present');

    expectedFilterLfoParams.forEach((param) => {
        assert.equal(
            countMatches(filterTabHtml, new RegExp(`class="lfo-toggle" data-param="${param}" data-lfo="1"`, 'g')),
            1,
            `${param} should expose exactly one L1 route button`
        );
        assert.equal(
            countMatches(filterTabHtml, new RegExp(`class="lfo-toggle" data-param="${param}" data-lfo="2"`, 'g')),
            1,
            `${param} should expose exactly one L2 route button`
        );
    });

    assert.equal(/data-param="autoMakeupGain"/.test(filterTabHtml), false, 'auto makeup checkbox should not get LFO routing buttons');
    assert.match(filterTabHtml, /class="filter-power-toggle active" data-filter-power="lpf">ON<\/button>/);
    assert.match(filterTabHtml, /class="slope-toggle active" data-filter="lpf" data-slope="12" data-poles="2">2P<\/button>/);
    assert.match(filterTabHtml, /class="filter-power-toggle active" data-filter-power="hpf">ON<\/button>/);
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
