"""Optional card LFOs: strict admission, selective acoustic render capability 9."""
import copy
import json
import math
import pathlib
SPECS = json.loads(pathlib.Path(__file__).with_name('effect-lfo-schema.json').read_text())
DEFAULTS = dict(wave='sine', beats=1, timing='straight', pulseWidth=.5, depth=.35, targets=[])
WAVES = ('sine', 'triangle', 'sawUp', 'sawDown', 'square', 'pulse', 'sampleHold', 'randomSmooth')
RATES = (.125, .25, .5, 1, 2, 4, 8)
def canonical(key, value):
    v = value or {}
    return {k: copy.deepcopy(v.get(k, d)) for k, d in DEFAULTS.items()}
def validate(key, value):
    if not isinstance(value, dict) or any(k not in DEFAULTS for k in value):
        raise ValueError('Invalid '+key+' LFO.')
    v = canonical(key, value)
    if v['wave'] not in WAVES or v['timing'] not in ('straight', 'dotted', 'triplet'):
        raise ValueError('Invalid card LFO waveform or timing.')
    for k, lo, hi in [('beats', .125, 8), ('pulseWidth', .01, .99), ('depth', 0, 1)]:
        x = v[k]
        if type(x) not in (int, float) or not math.isfinite(x) or not lo <= x <= hi or k == 'beats' and x not in RATES:
            raise ValueError('Invalid card LFO '+k+'.')
    targets = v['targets']
    if not isinstance(targets, list) or any(not isinstance(t, str) or t not in SPECS[key] for t in targets) or len(set(targets)) != len(targets):
        raise ValueError('Card LFO requires unique valid numeric targets.')
def active_targets(key, s):
    s = s or {}
    v = canonical(key, s.get('lfo'))
    if v['depth'] <= 0:
        return []
    out = []
    for k in v['targets']:
        if k not in SPECS[key]:
            continue
        if key == 'mutilator':
            if k == 'cycleBeats' and not s.get('rhythm') or k in ('freeRate', 'freeDepth') and s.get('rhythm'):
                continue
            if k == 'sweep' and not s.get('rhythm') and s.get('freeDepth', 0) <= 0 and 'freeDepth' not in v['targets']:
                continue
        if key == 'bubbleChamber' and s.get('version', 1) == 1 and k in ('resonance', 'damping', 'fizz', 'flow'):
            continue
        out.append(k)
    return out
def can_move(key, s, field):
    return field in active_targets(key, s)
def has(key, s):
    return bool(active_targets(key, s))
def audible(key, s):
    s = s or {}
    if s.get('enabled') is not True:
        return False
    if key in ('bassFace', 'mutilator'):
        return (s.get('amount', .5) > 0 or can_move(key, s, 'amount')) and (s.get('mix', .5) > 0 or can_move(key, s, 'mix'))
    return s.get('level', .5) > 0 or can_move(key, s, 'level')
def validate_modes(modes):
    for key in SPECS:
        s = (modes.get('loopD') or {}).get('mutilator') if key == 'mutilator' else modes.get(key)
        if isinstance(s, dict) and 'lfo' in s:
            validate(key, s['lfo'])
def apply_characters(content, modes):
    active = False
    target = content['state']['modes']
    for key in ('bassFace', 'mutilator'):
        s = ((modes.get('loopD') or {}).get('mutilator') if key == 'mutilator' else modes.get(key)) or {}
        current = ((target.get('loopD') or {}).get('mutilator') if key == 'mutilator' else target.get(key))
        effective = audible(key, s) and has(key, s) and s.get('input') != 'DAW' and (key != 'mutilator' or s.get('input', 'D') != 'D' or (modes.get('loopD') or {}).get('enabled'))
        if effective:
            current = copy.deepcopy(s)
            current['lfo'] = canonical(key, s['lfo'])
            if key == 'mutilator':
                if current.get('input') == 'D':
                    current.pop('input')
                target['loopD'] = {**target.get('loopD', modes.get('loopD') or {}), 'mutilator': current}
            else:
                target[key] = current
            active = True
        elif isinstance(current, dict) and 'lfo' in current:
            clean = {k: v for k, v in current.items() if k != 'lfo'}
            if key == 'mutilator':
                target['loopD'] = {**target['loopD'], 'mutilator': clean}
            else:
                target[key] = clean
    return active
