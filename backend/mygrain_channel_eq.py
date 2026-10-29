"""Additive EQ metadata defaults. No source audio is decoded or rewritten."""
import math

KEYS = ('A', 'B', 'C', 'V', 'W', 'P', 'O', 'L', 'X', 'Q', 'M', 'M+', 'generated', 'sample',
        'K1', 'K2', 'K3', 'K4', 'K5', 'drumKick', 'drumSnare', 'drumHat', 'drumPerc', 'drumClap', 'drumCymbals', 'drumEtc', 'drumRoll')
TYPES = ('bell', 'lowshelf', 'highshelf', 'highpass', 'lowpass')
SLOPES = (12, 24, 36, 48, 72, 96)


def number(value, fallback, low, high):
    if value is None or value == '':
        return fallback
    try:
        value = float(value)
        return max(low, min(high, value)) if math.isfinite(value) else fallback
    except (ValueError, TypeError, OverflowError):
        return fallback


def channel(value=None):
    if value is not None and not isinstance(value, dict):
        raise ValueError('Invalid channel EQ settings.')
    value = value or {}
    bands = value.get('bands')
    if bands is not None and (not isinstance(bands, list) or len(bands) != 4):
        raise ValueError('Channel EQ requires four bands.')
    result = []
    for index, frequency in enumerate((80, 400, 2500, 10000)):
        band = bands[index] if bands is not None else None
        if band is not None and not isinstance(band, dict):
            raise ValueError('Invalid EQ band.')
        band = band or {}
        default_type = 'lowshelf' if index == 0 else 'highshelf' if index == 3 else 'bell'
        result.append({'enabled': band.get('enabled') is not False,
                       'type': band.get('type') if band.get('type') in TYPES else default_type,
                       'frequency': number(band.get('frequency'), frequency, 20, 20000),
                       'gain': number(band.get('gain'), 0, -24, 24),
                       'q': number(band.get('q'), math.sqrt(.5), .1, 18),
                       'slope': band.get('slope') if band.get('slope') in SLOPES else 12})
    output = {'enabled': value.get('enabled') is True, 'bands': result}
    if value.get('automation') is not None:
        output['automation'] = automation(value['automation'])
    return output


def automation(value):
    if not isinstance(value, dict) or value.get('version') != 1 or not isinstance(value.get('points'), list) or len(value['points']) > 32768:
        raise ValueError('Invalid EQ automation.')
    points, previous = [], -1
    for point in value['points']:
        phase = point.get('phase') if isinstance(point, dict) else None
        if not isinstance(phase, (int, float)) or not math.isfinite(phase) or not 0 <= phase <= 1 or phase <= previous:
            raise ValueError('Invalid EQ automation position.')
        previous = phase
        points.append({'phase': phase, **channel({'enabled': point.get('enabled'), 'bands': point.get('bands')})})
    if points and (len(points) < 2 or points[0]['phase'] != 0 or points[-1]['phase'] != 1):
        raise ValueError('Incomplete EQ automation.')
    return {'version': 1, 'read': value.get('read') is True, 'steps': number(value.get('steps'), 16, 1, 64), 'points': points}



def normalize(value=None):
    if value is not None and (not isinstance(value, dict) or value.get('version') != 1 or not isinstance(value.get('channels'), dict)):
        raise ValueError('Unsupported channel EQ version. Reload MYGRAIN.')
    channels = (value or {}).get('channels', {})
    return {'version': 1, 'channels': {key: channel(channels.get(key)) for key in KEYS}}


def audible(value):
    """A bypassed manual EQ can still be enabled by an active read curve."""
    curve = value.get('automation') or {}
    return value['enabled'] or (curve.get('read') is True and any(p['enabled'] for p in curve.get('points', [])))
