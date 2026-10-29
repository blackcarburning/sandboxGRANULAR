/* Canonical metadata-only pre-W Song migration; shared by browser and server. */
(function (root) {
    'use strict';
    const own = (value, key) => Boolean(value && Object.hasOwn(value, key));
    const settings = /^(?:bastard(?:Loop)?W|performanceBastardLoopW|performanceBastardWDivision|weirdFx-)/i;
    const referenceKeys = new Set(['loopLayerSolo', 'performanceSourceLayerSolo', 'performanceSourceLayerSoloSnapshot']);
    function evidence(value, reference = false) {
        if (!value || typeof value !== 'object') return reference && typeof value === 'string'
            && value.split(',').some(item => /^(?:w|bastard(?:loop)?w)$/i.test(item.trim()));
        return Object.entries(value).some(([key, entry]) => settings.test(key)
            || (key === 'id' && typeof entry === 'string' && settings.test(entry))
            || evidence(entry, reference || referenceKeys.has(key)));
    }
    function convertSnapshot(original) {
        if (!original || original.format !== 'mygrain-song-part' || original.version !== 1
            || !original.state?.modes || !original.extra || !Array.isArray(original.assets)) {
            throw new Error('This is not a supported complete song-part snapshot.');
        }
        // Pre-portable parts never required an audio inventory. Keep that
        // format intact; the normal legacy reader already treats absent W as off.
        if (original.extra.freezeStateVersion !== 1) return { snapshot: original, changed: false };
        const inventory = original.extra.audioSlots;
        const assets = original.assets.filter(asset => asset.key === 'bastardW');
        const invalid = () => new Error('Saved part audio inventory is incomplete for bastardW. No device sample will be substituted.');
        if (own(inventory, 'bastardW')) {
            if (typeof inventory.bastardW !== 'boolean' || assets.length > 1 || inventory.bastardW !== (assets.length === 1)) throw invalid();
            return { snapshot: original, changed: false };
        }
        if (original.extra.freezeStateVersion === 1 && (!inventory || typeof inventory !== 'object' || Array.isArray(inventory))) throw invalid();
        const extra = Object.fromEntries(Object.entries(original.extra).filter(([key]) => key !== 'audioSlots'));
        // An absent historical lane is safe. A partially saved W lane is not:
        // never hide missing audio, copy current-device audio, or infer a new take.
        if (assets.length || evidence(original.state) || evidence(extra)) throw invalid();
        const snapshot = JSON.parse(JSON.stringify(original));
        snapshot.extra.audioSlots = { ...inventory, bastardW: false };
        snapshot.extra.metadata = { ...snapshot.extra.metadata, bastardW: null };
        Object.assign(snapshot.state.modes, {
            bastardLoopWEnabled: false, bastardLoopWEffects: {}, bastardLoopWCut: null,
            bastardLoopWSourceBpm: 120, bastardLoopWDivisions: ['1/16'],
            bastardLoopWPitchAffectsDuration: false, bastardLoopWReverse: false, bastardLoopWShiftSteps: 0
        });
        snapshot.state.sliders = { ...snapshot.state.sliders,
            performanceBastardLoopWLevel: '50', performanceBastardLoopWLevelMixer: '50',
            performanceBastardLoopWSemitone: '0', performanceBastardLoopWFineTune: '0',
            performanceBastardLoopWFilterCutoff: '18000' };
        return { snapshot, changed: true };
    }
    const api = Object.freeze({ convertSnapshot });
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.MygrainWSongCompat = api;
})(typeof globalThis === 'object' ? globalThis : this);
