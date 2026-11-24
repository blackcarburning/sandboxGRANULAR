"""Explicit, installed server voice catalogue. IDs are part of saved recipes."""
VOICES = {
    'festival_kal': ('festival', 'Festival · Kal · US robot'),
    'festival_rab': ('festival', 'Festival · Rab · UK robot'),
    'flite_kal': ('flite', 'Flite · Kal · small robot'),
    'flite_awb': ('flite', 'Flite · AWB · Scottish'),
    'flite_rms': ('flite', 'Flite · RMS · US male'),
    'flite_slt': ('flite', 'Flite · SLT · US female'),
    'sam_classic': ('sam', 'SAM · 1982 computer'),
    'piper_cori': ('piper', 'Piper · Cori · UK female'),
    'piper_ljspeech': ('piper', 'Piper · LJ · US female'),
    'qwen_ryan': ('qwen', 'Qwen3 · Ryan · English male'),
    'qwen_aiden': ('qwen', 'Qwen3 · Aiden · American male'),
    'qwen_vivian': ('qwen', 'Qwen3 · Vivian · female'),
    'bark_0': ('bark', 'Bark · Speaker 0 · experimental speech'),
    'bark_1': ('bark', 'Bark · Speaker 1 · experimental speech'),
    'bark_sing': ('bark', 'Bark · experimental improvised singing'),
    'diffsinger_qixuan': ('diffsinger', 'DiffSinger · Qixuan · scored singing'),
}


def melody(value, count):
    """One explicit MIDI note and beat duration per lyric word."""
    if not isinstance(value, dict) or set(value) != {'bpm', 'notes'}:
        raise ValueError('Singing needs a melody: BPM and one note per word.')
    bpm, notes = value['bpm'], value['notes']
    if type(bpm) is not int or not 60 <= bpm <= 200 or not isinstance(notes, list) or len(notes) != count:
        raise ValueError('Use BPM 60–200 and one melody note per word.')
    for n in notes:
        if not isinstance(n, dict) or set(n) != {'note', 'beats'} or type(n['note']) is not int or not 48 <= n['note'] <= 84 or type(n['beats']) not in (int, float) or n['beats'] not in (.25, .5, 1, 2, 3, 4):
            raise ValueError('Use singing notes C3–C6 and ¼–4 beats per word.')
    if sum(n['beats'] for n in notes) * 60 / bpm > 24:
        raise ValueError('Keep a sung phrase within 24 seconds.')
    return {'bpm': bpm, 'notes': [dict(n) for n in notes]}
