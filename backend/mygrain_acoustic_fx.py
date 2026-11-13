"""Bounded optional acoustic returns. Defaults match acoustic-fx-dsp.js.
Only audible non-external content versions server renders; legacy hashes survive.
"""
import math

KEYS = ('wireWorld', 'sonicCrystal', 'bubbleChamber')
SOURCES = ('all', 'A', 'B', 'C', 'D', 'V', 'W', 'P', 'O', 'L', 'X', 'Q', 'M', 'M+', 'generated', 'sample', 'K', 'K1', 'K2', 'K3', 'K4', 'K5', 'drums', 'drumKick', 'drumSnare', 'drumHat', 'drumPerc', 'drumClap', 'drumCymbals', 'drumEtc', 'drumRoll', 'N', 'DAW')
DEFAULTS = {
    'wireWorld': dict(dispersion=.72, travel=.38, feedback=.42, damping=.35, direction='down', width=.75, level=.5),
    'sonicCrystal': dict(tuning=.48, spacing=.35, coupling=.55, disorder=.12, defect=.25, loss=.25, cells=8, reflection=.28, width=.7, level=.7),
    'bubbleChamber': dict(radius=.48, spread=.5, decay=.4, density=.45, motion=.5, mode='hybrid', population=16, width=.8, level=.65),
}
LIQUID_DEFAULTS = dict(radius=math.log(11.74/3)/math.log(20), spread=.42, decay=math.sqrt((.039-.018)/3.2), motion=.86, population=8, damping=0, resonance=0, fizz=0, flow=0, width=.62, level=.88)

def defaults(key, value):
    return LIQUID_DEFAULTS if key == 'bubbleChamber' and value.get('version') == 2 else DEFAULTS[key]

ENUMS = {'direction': ('up', 'down'), 'cells': (4, 8, 12), 'mode': ('resonate', 'droplets', 'hybrid'), 'population': (8, 16, 24)}


def validate(modes):
    for key in KEYS:
        value = modes.get(key)
        if value is None:
            continue
        if not isinstance(value, dict) or type(value.get('version', 1)) is not int or value.get('version', 1) not in ((1, 2) if key == 'bubbleChamber' else (1,)):
            raise ValueError('Invalid acoustic effect version: ' + key)
        if 'enabled' in value and type(value['enabled']) is not bool:
            raise ValueError('Invalid acoustic power: ' + key)
        if value.get('source', 'all') not in SOURCES:
            raise ValueError('Invalid acoustic source: ' + key)
        for field, default in defaults(key, value).items():
            v = value.get(field, default)
            if field in ENUMS:
                if type(v) is not type(default) or v not in ENUMS[field]:
                    raise ValueError('Invalid acoustic choice: ' + key + '.' + field)
            elif type(v) not in (float, int) or not math.isfinite(v) or not 0 <= v <= 1:
                raise ValueError('Invalid acoustic parameter: ' + key + '.' + field)


def canonical(key, value):
    value = value or {}
    return dict(version=2 if key == 'bubbleChamber' and value.get('version') == 2 else 1, enabled=value.get('enabled') is True, source=value.get('source', 'all'),
                **{field: value.get(field, default) for field, default in defaults(key, value).items()})


def audible(key, value):
    s = canonical(key, value)
    return s['enabled'] and s['level'] > 0 and s['source'] != 'DAW'


def apply_content(content, modes):
    active = 0
    for key in KEYS:
        value = modes.get(key)
        if not audible(key, value):
            content['state']['modes'].pop(key, None)
        else:
            content['state']['modes'][key] = canonical(key, value)
            active = max(active, canonical(key, value)['version'])
    if active:
        content['acousticFxEngineRevision'] = active
    return active
