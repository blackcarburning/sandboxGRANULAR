"""Bounded optional acoustic returns. Defaults match acoustic-fx-dsp.js.
Only audible non-external content versions server renders; legacy hashes survive.
"""
import math
import importlib.util
import pathlib
_spec = importlib.util.spec_from_file_location('mygrain_heavy_lifter', pathlib.Path(__file__).with_name('mygrain_heavy_lifter.py'))
HEAVY = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(HEAVY)

_lfo_spec = importlib.util.spec_from_file_location('mygrain_effect_lfo', pathlib.Path(__file__).with_name('mygrain_effect_lfo.py'))
LFO = importlib.util.module_from_spec(_lfo_spec)
_lfo_spec.loader.exec_module(LFO)

KEYS = ('wireWorld', 'sonicCrystal', 'bubbleChamber', 'henrysHose', 'heavyLifter')
SOURCES = ('all', 'A', 'B', 'C', 'D', 'E', 'Enemy', 'GlassHaus', 'Robot', 'V', 'W', 'P', 'O', 'L', 'X', 'Q', 'M', 'M+', 'generated', 'sample', 'K', 'K1', 'K2', 'K3', 'K4', 'K5', 'drums', 'drumKick', 'drumSnare', 'drumHat', 'drumPerc', 'drumClap', 'drumCymbals', 'drumEtc', 'drumRoll', 'N', 'DAW')
DEFAULTS = {
    'heavyLifter': {'level': .7, 'width': .75},
    'henrysHose': {'length': 0.34, 'bore': 0.3, 'ribs': 0.65, 'damping': 0.25, 'reflection': 0.58, 'orbit': 0.4, 'freeRate': 0.58, 'rotationMode': 'sync', 'division': '2', 'direction': 'forward', 'phase': 0, 'sing': 0, 'stereoFeed': 1, 'micMode': 'stereo', 'micLType': 'modern', 'micRType': 'modern', 'micLX': 0.33, 'micLY': 0.68, 'micLHeight': 0.08, 'micLAim': 0.875, 'micRX': 0.67, 'micRY': 0.68, 'micRHeight': 0.08, 'micRAim': 0.625, 'width': 1, 'level': 0.8},
    'wireWorld': dict(dispersion=.72, travel=.38, feedback=.42, damping=.35, direction='down', width=.75, level=.5),
    'sonicCrystal': dict(tuning=.48, spacing=.35, coupling=.55, disorder=.12, defect=.25, loss=.25, cells=8, reflection=.28, width=.7, level=.7),
    'bubbleChamber': dict(radius=.48, spread=.5, decay=.4, density=.45, motion=.5, mode='hybrid', population=16, width=.8, level=.65),
}
LIQUID_DEFAULTS = dict(radius=math.log(11.74/3)/math.log(20), spread=.42, decay=math.sqrt((.039-.018)/3.2), motion=.86, population=8, damping=0, resonance=0, fizz=0, flow=0, width=.62, level=.88)

DOPPLER_DEFAULTS = dict(DEFAULTS['henrysHose'], doppler=.625, orbit=.6, division='1', micLX=.22, micRX=.78)

def defaults(key, value):
    if key == 'henrysHose' and value.get('version') == 2:
        return DOPPLER_DEFAULTS
    return LIQUID_DEFAULTS if key == 'bubbleChamber' and value.get('version') == 2 else DEFAULTS[key]

HOSE_ENUMS = {'micMode': ['mono','stereo'], 'rotationMode': ['free', 'sync'], 'division': ['1', '2', '4', '8', '16', '32', '0.25', '0.5'], 'direction': ['forward', 'reverse'], 'micLType': ['modern', 'omni', 'ribbon', 'broadcast', 'snare', 'kick', 'rifle'], 'micRType': ['modern', 'omni', 'ribbon', 'broadcast', 'snare', 'kick', 'rifle']}
ENUMS = {'direction': ('up', 'down'), 'cells': (4, 8, 12), 'mode': ('resonate', 'droplets', 'hybrid'), 'population': (8, 16, 24)}


def validate(modes):
    LFO.validate_modes(modes)
    for key in KEYS:
        value = modes.get(key)
        if value is None:
            continue
        if not isinstance(value, dict) or type(value.get('version', 1)) is not int or value.get('version', 1) not in ((1, 2) if key in ('bubbleChamber', 'henrysHose') else (1,)):
            raise ValueError('Invalid acoustic effect version: ' + key)
        if 'enabled' in value and type(value['enabled']) is not bool:
            raise ValueError('Invalid acoustic power: ' + key)
        if value.get('source', 'all') not in SOURCES:
            raise ValueError('Invalid acoustic source: ' + key)
        if key == 'heavyLifter':
            HEAVY.validate(value)
            continue
        for field, default in defaults(key, value).items():
            v = value.get(field, default)
            choices = HOSE_ENUMS if key == 'henrysHose' else ENUMS
            if field in choices:
                if type(v) is not type(default) or v not in choices[field]:
                    raise ValueError('Invalid acoustic choice: ' + key + '.' + field)
            elif type(v) not in (float, int) or not math.isfinite(v) or not 0 <= v <= 1:
                raise ValueError('Invalid acoustic parameter: ' + key + '.' + field)


def canonical(key, value):
    value = value or {}
    if key == 'heavyLifter':
        return HEAVY.canonical(value)
    return dict(version=2 if key in ('bubbleChamber', 'henrysHose') and value.get('version') == 2 else 1, enabled=value.get('enabled') is True, source=value.get('source', 'all'),
                **{field: value.get(field, default) for field, default in defaults(key, value).items()}, **({'lfo': LFO.canonical(key, value['lfo'])} if key in LFO.SPECS and 'lfo' in value else {}))


def render_canonical(key, value):
    s = canonical(key, value)
    if key == 'heavyLifter' and not HEAVY.has_modulation(s):
        s.pop('lfo', None)
    if key in LFO.SPECS and not LFO.has(key, s):
        s.pop('lfo', None)
    return s

def audible(key, value):
    s = canonical(key, value)
    return s['enabled'] and (s['level'] > 0 or (HEAVY.level_can_move(s) if key == 'heavyLifter' else key in LFO.SPECS and LFO.can_move(key, s, 'level'))) and s['source'] != 'DAW'


def apply_content(content, modes):
    active = 9 if LFO.apply_characters(content, modes) else 0
    for key in KEYS:
        value = modes.get(key)
        if not audible(key, value):
            content['state']['modes'].pop(key, None)
        else:
            content['state']['modes'][key] = render_canonical(key, value)
            active = max(active, 9 if key in LFO.SPECS and LFO.has(key, canonical(key, value)) else 0, (8 if HEAVY.has_modulation(canonical(key, value)) else 6 if canonical(key, value)['mode'] in ('mechanicalMotion', 'spectralImprint') else 5) if key == 'heavyLifter' else (4 if canonical(key, value)['version'] == 2 else 3) if key == 'henrysHose' else canonical(key, value)['version'])
    if active:
        content['acousticFxEngineRevision'] = active
    return active
