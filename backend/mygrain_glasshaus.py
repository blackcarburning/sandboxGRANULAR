"""GlassHaus portable recipe validation. No assets, inference or new worker pool."""
import math


def audible(v):
    if not v or v.get('enabled') is not True or v.get('level', 0) <= 0: return False
    lanes = v.get('lanes')
    return any(o.get('enabled') and o.get('level', 0) > 0 and
               (any(on and lanes[i][round(j*8/v['bars'])] > 1e-5 for j,on in enumerate(v['hits'][i][:v['bars']*16])) if 'hits' in v and v['mode']=='strike' else any(x > 0 for x in lanes[i]) if lanes is not None else any(s.get('on') for s in v.get('steps', [])))
               for i, o in enumerate(v.get('objects', [])))


def validate(v):
    if v is None:
        return
    def fail():
        raise ValueError('Invalid GlassHaus instrument recipe.')
    def number(obj, key, lo, hi, integer=False):
        n = obj.get(key)
        if type(n) not in ((int,) if integer else (int, float)) or not math.isfinite(n) or not lo <= n <= hi:
            fail()
    if not isinstance(v, dict) or type(v.get('version')) is not int or v['version'] != 1 or type(v.get('enabled')) is not bool:
        fail()
    if 'contact' in v and v['contact'] not in ('auto', 'finger', 'mallet'): fail()
    if 'lanes' in v:
        lanes = v['lanes']
        if not isinstance(lanes, list) or len(lanes) != 3: fail()
        for lane in lanes:
            if not isinstance(lane, list) or len(lane) != 128: fail()
            for x in lane:
                if type(x) not in (int, float) or not math.isfinite(x) or not 0 <= x <= 1: fail()

    if 'hits' in v:
        if 'lanes' not in v or not isinstance(v['hits'], list) or len(v['hits']) != 3: fail()
        for lane in v['hits']:
            if not isinstance(lane, list) or len(lane) != 128 or any(type(x) is not bool for x in lane): fail()

    for key, choices in {'mode': ('strike','rub','both'), 'tuning': ('keyboard','physical'), 'scale': ('major','minor','dorian','pentatonic','chromatic'), 'chord': ('off','major','minor','sus2','sus4','dim','seventh','maj7'), 'assignment': ('layer','split'), 'bars': (1,2,4,8)}.items():
        if v.get(key) not in choices: fail()
    for key, bounds in {'level': (0,1), 'hardness': (0,1), 'pressure': (0,1), 'speed': (.05,3)}.items():
        number(v, key, *bounds)
    if 'slideGain' in v: number(v, 'slideGain', 1, 16)
    number(v, 'root', 24, 84, True)
    number(v, 'bars', 1, 8, True)
    vib = v.get('vibrato')
    if not isinstance(vib, dict) or type(vib.get('sync')) is not bool or type(vib.get('ratio')) not in (int, float) or vib.get('ratio') not in (1/16,1/8,1/4,1/2,1,2,4,8,16): fail()
    number(vib, 'depth', 0, 100)
    number(vib, 'rate', .02, 20)
    if not isinstance(v.get('objects'), list) or len(v['objects']) != 3 or not isinstance(v.get('steps'), list) or len(v['steps']) != 16: fail()
    for o in v['objects']:
        if not isinstance(o, dict) or type(o.get('enabled')) is not bool or o.get('type') not in ('wineglass','shallow','deep'): fail()
        for key, bounds in {'diameter': (5,80), 'thickness': (.5,10), 'tune': (-24,24), 'level': (0,1), 'pan': (-1,1), 'decay': (.2,120), 'brightness': (0,1), 'split': (0,30), 'damping': (0,1), 'position': (0,1)}.items(): number(o, key, *bounds)
    for s in v['steps']:
        if not isinstance(s, dict) or type(s.get('on')) is not bool: fail()
        for key, bounds in {'degree': (0,13), 'octave': (-2,2), 'ratchet': (1,4)}.items(): number(s, key, *bounds, True)
        for key, bounds in {'velocity': (.05,1), 'gate': (.05,2)}.items(): number(s, key, *bounds)


def render_version(v):
    return (41 if v.get('mode') == 'rub' and v.get('slideGain', 1) != 1 else 40 if 'hits' in v else 39 if 'lanes' in v else 38) if audible(v) else 0
