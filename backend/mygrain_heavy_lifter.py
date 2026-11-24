"""Heavy Lifter canonical settings; immutable corpus v1, acoustic capabilities 5/6 by active mode, 8 for an effective full-range LFO."""
import copy
import json
import math
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / 'backend/heavy-lifter-schema.json').read_text())
DEFAULTS = SCHEMA['defaults']
CATALOG = {r['id']: r for r in json.loads((ROOT / 'industry-corpus-v1/catalog.json').read_text())['records']}

LFO_WAVES = ('sine', 'triangle', 'sawUp', 'sawDown', 'square', 'pulse', 'sampleHold', 'randomSmooth')
LFO_RATES = (.125, .25, .5, 1, 2, 4, 8)
LFO_TARGETS = ('level', 'width', *(m + '.' + k for m in SCHEMA['modes'] for k in DEFAULTS['recipes'][m] if k != 'seed'))
LFO_DEFAULTS = dict(wave='sine', beats=1, timing='straight', pulseWidth=.5, depth=.35, targets=[])

def canonical_lfo(value):
    return {k: copy.deepcopy(value.get(k, d)) for k, d in LFO_DEFAULTS.items()}

def has_modulation(value):
    v = value or {}
    lfo = v.get('lfo') or {}
    mode = v.get('mode', DEFAULTS['mode'])
    return lfo.get('depth', .35) > 0 and any(t in ('level', 'width') or t.startswith(mode + '.') for t in lfo.get('targets', []))

def level_can_move(value):
    lfo = (value or {}).get('lfo') or {}
    return lfo.get('depth', .35) > 0 and 'level' in lfo.get('targets', [])

def validate_lfo(value):
    if not isinstance(value, dict) or any(k not in LFO_DEFAULTS for k in value):
        raise ValueError('Invalid Heavy Lifter LFO.')
    v = canonical_lfo(value)
    if v['wave'] not in LFO_WAVES or v['timing'] not in ('straight', 'dotted', 'triplet'):
        raise ValueError('Invalid Heavy Lifter LFO waveform or timing.')
    for k, low, high in [('beats', .125, 8), ('pulseWidth', .01, .99), ('depth', 0, 1)]:
        n = v[k]
        if type(n) not in (int, float) or not math.isfinite(n) or not low <= n <= high or (k == 'beats' and n not in LFO_RATES):
            raise ValueError('Invalid Heavy Lifter LFO ' + k)
    targets = v['targets']
    if not isinstance(targets, list) or any(not isinstance(t, str) or t not in LFO_TARGETS for t in targets) or len(set(targets)) != len(targets):
        raise ValueError('Heavy Lifter LFO requires unique valid numeric targets.')

def canonical(value):
    value = value or {}
    s = copy.deepcopy(DEFAULTS)
    for field in ('enabled', 'source', 'mode', 'level', 'width'):
        s[field] = value.get(field, s[field])
    for mode in SCHEMA['modes']:
        s['recipes'][mode].update({k: v for k, v in (value.get('recipes', {}).get(mode) or {}).items() if k in s['recipes'][mode]})
        s['samples'][mode] = [{k: p.get(k, d) for k, d in dict(id='', chunk=0, start=0, duration=2, bars=1, bpm=120).items()} for p in value.get('samples', {}).get(mode, [])]
    if 'lfo' in value:
        s['lfo'] = canonical_lfo(value['lfo'])
    return s

def validate(value):
    if not isinstance(value, dict) or type(value.get('version', 1)) is not int or value.get('version', 1) != 1:
        raise ValueError('Invalid Heavy Lifter version.')
    if value.get('mode', DEFAULTS['mode']) not in SCHEMA['modes']:
        raise ValueError('Invalid Heavy Lifter mode.')
    for container in ('recipes', 'samples'):
        if container in value and (not isinstance(value[container], dict) or any(k not in SCHEMA['modes'] for k in value[container])):
            raise ValueError('Invalid Heavy Lifter ' + container)
    for mode in SCHEMA['modes']:
        if not isinstance(value.get('recipes', {}).get(mode, {}), dict):
            raise ValueError('Invalid Heavy Lifter recipe.')
        raw = value.get('samples', {}).get(mode, [])
        if not isinstance(raw, list) or len(raw) > 3 or any(not isinstance(p, dict) for p in raw):
            raise ValueError('Invalid Heavy Lifter source cuts.')
    if 'lfo' in value:
        validate_lfo(value['lfo'])
    s = canonical(value)
    for field in ('level', 'width'):
        v = s[field]
        if type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1:
            raise ValueError('Invalid Heavy Lifter ' + field)
    for mode in SCHEMA['modes']:
        recipe = s['recipes'][mode]
        raw_recipe = value.get('recipes', {}).get(mode, {})
        if not isinstance(raw_recipe, dict) or any(k not in DEFAULTS['recipes'][mode] for k in raw_recipe):
            raise ValueError('Invalid Heavy Lifter recipe.')
        for field, v in recipe.items():
            if field == 'seed':
                if type(v) is not int or not 1 <= v <= 4294967295:
                    raise ValueError('Invalid Heavy Lifter seed.')
            elif type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1:
                raise ValueError('Invalid Heavy Lifter parameter: ' + mode + '.' + field)
        raw = value.get('samples', {}).get(mode, [])
        if not isinstance(raw, list) or len(raw) > 3 or any(not isinstance(p, dict) for p in raw):
            raise ValueError('Invalid Heavy Lifter source cuts.')
        for cut in s['samples'][mode]:
            row = CATALOG.get(cut['id']) if isinstance(cut['id'], str) else None
            if not row or type(cut['chunk']) is not int or not 0 <= cut['chunk'] < len(row['chunks']):
                raise ValueError('Unknown Heavy Lifter recording or chunk.')
            for f, low, high in [('start', 0, 16), ('duration', .01, 12), ('bpm', 40, 300)]:
                v = cut[f]
                if type(v) not in (int, float) or not math.isfinite(v) or not low <= v <= high:
                    raise ValueError('Invalid Heavy Lifter cut: ' + f)
            if type(cut['bars']) is not int or cut['bars'] not in (1, 2):
                raise ValueError('Invalid Heavy Lifter bar division.')
            if cut['start'] + cut['duration'] > row['chunks'][cut['chunk']]['frames'] / 24000 + 1 / 24000:
                raise ValueError('Heavy Lifter cut exceeds recording.')
