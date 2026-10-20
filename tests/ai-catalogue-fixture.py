"""Populate ONLY an isolated account store with exact copies of real catalogue candidates."""
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys

repo = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('catalogue_fixture', repo / 'backend/mygrain_sample_catalogue.py')
cat = importlib.util.module_from_spec(spec); spec.loader.exec_module(cat)
root = Path(sys.argv[1]).resolve()
assert root.is_relative_to(Path('/tmp')) and root.name.startswith('mygrain-song-test-')
with sqlite3.connect(root / 'auth/accounts.sqlite3') as db:
    user_id = db.execute('SELECT id FROM users WHERE username=?', (sys.argv[2],)).fetchone()[0]
user_root = root / 'users' / user_id / 'source_mirrors'
context = cat.retrieve('C minor 104 BPM dry piano strings sub bass', {'globalBpmSlider': 104}, cat.SOURCE_BASE)
if os.environ.get('AI_CATALOGUE_FIXTURE_ALL') == '1':
    for entry in context['entries'].values():
        target = cat.safe_path(user_root, entry['source'], entry['row']['relative_path'])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(Path(entry['row']['absolute_path']).read_bytes())
selected = {}
for lane, candidates in context['candidates'].items():
    # Keep copies modest and retain exact bytes/hash; no changes to original audio.
    role_terms = {'P': {'piano', 'keys'}, 'O': {'strings', 'violin', 'cello', 'orchestra'}, 'V': {'vocal', 'voice'}}.get(lane, set())
    role_candidates = [c for c in candidates if role_terms.intersection(c['filename']['tags'])]
    candidate = min(role_candidates or candidates, key=lambda c: c['durationS'])
    entry = context['entries'][candidate['sampleId']]
    target = cat.safe_path(user_root, entry['source'], entry['row']['relative_path'])
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(Path(entry['row']['absolute_path']).read_bytes())
    selected[lane] = {'reload': True, 'enabled': True, 'sampleId': candidate['sampleId']}
    if lane in ('X', 'L'): selected[lane]['notes'] = [36 if lane == 'X' else 60, None, None, None] * 4
    else: selected[lane]['divisions'] = ['uncut']
cat.attach_selections({'loops': selected}, context)
print(json.dumps({'selections': selected, 'sourceRoot': str(user_root)}))
