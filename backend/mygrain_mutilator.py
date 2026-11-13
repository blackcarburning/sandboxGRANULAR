"""Additive Mutilator controls: strict new fields, neutral legacy identity."""
import math

DEFAULTS = {'filter': 'auto', 'resonance': .5, 'sweep': 1, 'cycleBeats': 4, 'freeRate': 1, 'freeDepth': 0, 'output': 0}
FILTERS = ('auto', 'lowpass', 'bandpass', 'highpass', 'notch')
CYCLES = (.5, 1, 2, 4, 8)

def validate(modes):
    value = (modes.get('loopD') or {}).get('mutilator')
    if not isinstance(value, dict):
        return
    for key in DEFAULTS:
        if key not in value:
            continue
        v = value[key]
        if key == 'filter':
            valid = v in FILTERS if isinstance(v, str) else False
        else:
            lo, hi = (-18, 6) if key == 'output' else (.125, 12) if key == 'freeRate' else (0, 1)
            valid = type(v) in (int, float) and math.isfinite(v) and (v in CYCLES if key == 'cycleBeats' else lo <= v <= hi)
        if not valid:
            raise ValueError('Invalid Mutilator '+key+'.')

def audible_controls(value):
    result = {k: value[k] for k in ('filter', 'resonance', 'output') if k in value and value[k] != DEFAULTS[k]}
    keys = ('sweep', 'cycleBeats') if value.get('rhythm') is True else ('sweep', 'freeRate', 'freeDepth') if value.get('freeDepth', 0) > 0 else ()
    result.update({k: value[k] for k in keys if k in value and value[k] != DEFAULTS[k]})
    return result

def positive(value):
    try:
        number = float(0 if value is None or value == '' else value)
        return not math.isfinite(number) or number > 0
    except (ValueError, TypeError):
        return True  # retain existing client defaulting for malformed legacy scalars

def apply_content(content, modes, asset_keys):
    lane = modes.get('loopD') or {}
    value = lane.get('mutilator')
    if not isinstance(value, dict):
        return False
    selected = value.get('input', 'D')
    active = value.get('enabled') is True and selected != 'DAW' and positive(value.get('amount', .5)) and positive(value.get('mix', .5)) and (selected != 'D' or (lane.get('enabled') is True and 'bastardD' in asset_keys))
    audible = audible_controls(value) if active else {}
    stored_lane = content['state']['modes'].get('loopD', lane)
    stored = stored_lane.get('mutilator')
    if isinstance(stored, dict):
        clean = {k: v for k, v in stored.items() if k not in DEFAULTS}
        clean.update(audible)
        content['state']['modes']['loopD'] = {**stored_lane, 'mutilator': clean}
    if audible:
        content['mutilatorControlsEngineRevision'] = 1
    return bool(audible)
