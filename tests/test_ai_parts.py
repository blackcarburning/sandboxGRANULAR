import base64
import copy
import io
import json
from pathlib import Path
import sqlite3
import stat
import tempfile
import unittest
from unittest.mock import patch
from test_song_backend import part_zip
from test_ai_prompts import ai, CURRENT, LOOPS, STATE

parts = ai.parts
OWNER, OTHER = 'a' * 32, 'b' * 32
META = {'slot': 1, 'revision': 0, 'name': 'Verse 1', 'prompt': 'Warm C minor groove', 'section': {'type': 'verse', 'bars': 8, 'rolls': False}, 'repeats': 2}
RECIPE = {'title': 'Related chorus', 'description': 'Relative-major lift, keeping the kit and tempo.', 'parameters': {}, 'patternSteps': 64, 'loops': {'Q': {'chords': [[60, 63, 67], [60, 63, 68], [58, 62, 65], [59, 62, 67]], 'chordSteps': 16}, 'X': {'notes': [36, None] * 32}}}


class PartsStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup); self.db = Path(self.temp.name)/'ai-parts.sqlite3'; self.body = part_zip(steps=64)
    def store(self, **updates):
        return parts.library(self.db, OWNER, action='store', meta={**copy.deepcopy(META), **updates}, body=self.body)

    def test_full_archive_reopen_owner_isolation_and_permissions(self):
        self.assertEqual(parts.library(self.db, OWNER)['parts'], [])
        first = self.store()['parts'][0]; saved, body = parts.library(self.db, OWNER, action='read', slot=1)
        self.assertEqual(first, saved); self.assertEqual(body, self.body)
        self.assertEqual(parts.library(self.db, OTHER)['parts'], [])
        with self.assertRaises(FileNotFoundError): parts.library(self.db, OTHER, action='read', slot=1)
        self.assertEqual(stat.S_IMODE(self.db.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(next((self.db.parent/'ai-part-audio'/OWNER).glob('*.zip')).stat().st_mode), 0o600)

    def test_rename_preserves_audio_and_revision_conflicts(self):
        old = self.store()['parts'][0]
        audio = next((self.db.parent/'ai-part-audio'/OWNER).glob('*.zip')); before = audio.stat()
        with patch.object(Path, 'read_bytes', side_effect=AssertionError('Rename must not read audio')), patch.object(parts.songs, 'validate_part_zip', side_effect=AssertionError('Rename must not validate audio')), patch.object(parts.hashlib, 'sha256', side_effect=AssertionError('Rename must not hash audio')):
            saved = parts.library(self.db, OWNER, action='rename', meta={'slot': 1, 'revision': 1, 'name': 'Verse <b>two</b>'})['parts'][0]
        self.assertEqual(audio.stat().st_mtime_ns, before.st_mtime_ns)
        self.assertEqual(saved['sha256'], old['sha256']); self.assertEqual(saved['revision'], 2)
        with self.assertRaises(parts.Conflict): self.store(revision=1)
        self.assertEqual(parts.library(self.db, OWNER)['parts'][0]['name'], 'Verse <b>two</b>')
        with self.assertRaises(ValueError): parts.library(self.db, OTHER, action='rename', meta={'slot': 1, 'revision': 0, 'name': 'No'})

    def test_replace_keeps_history_and_deduplicates_zip(self):
        self.store(); self.store(revision=1, name='Verse version two')
        with sqlite3.connect(self.db) as db:
            self.assertEqual(json.loads(db.execute('SELECT meta FROM history').fetchone()[0])['name'], 'Verse 1')
        self.assertEqual(len(list((self.db.parent/'ai-part-audio'/OWNER).glob('*.zip'))), 1)
        self.assertEqual(self.store(slot=2)['parts'][1]['slot'], 2)

    def test_validation_quota_bad_archive_and_corrupt_download(self):
        for changes in [{'slot': 0}, {'slot': True}, {'revision': -1}, {'name': ''}, {'name': 'x'*101}, {'prompt': 'x'*1501}, {'repeats': 1}, {'section': {'type': 'bad', 'bars': 8, 'rolls': False}}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError): self.store(**changes)
        with self.assertRaises(ValueError): parts.library(self.db, OWNER, action='store', meta=META, body=part_zip(steps=64, unexpected=True))
        with patch.object(parts, 'MAX_STORED_BYTES', 1), self.assertRaises(ValueError): self.store()
        self.store()
        obj = next((self.db.parent/'ai-part-audio'/OWNER).glob('*.zip')); obj.write_bytes(b'bad')
        with self.assertRaises(OSError): parts.library(self.db, OWNER, action='read', slot=1)

    def test_symlink_and_owner_input_rejected(self):
        self.store(); link = self.db.parent/'link.sqlite'; link.symlink_to(self.db)
        with self.assertRaises(OSError): parts.library(link, OWNER)
        with self.assertRaises(ValueError): parts.library(self.db, '../outside')
        with self.assertRaises(ValueError): parts.library(self.db, OWNER, action='read', slot=6)

    def test_http_store_read_auth_and_conflict(self):
        class Handler:
            mygrain_user = {'id': OWNER}; path = '/mygrain/api/ai-parts'
            def __init__(self, body=b'', headers=None): self.rfile=io.BytesIO(body);self.wfile=io.BytesIO();self.headers=headers or {};self.out_headers={}
            def send_json(self, payload, status=200, extra_headers=None): self.result=(status,payload,extra_headers)
            def send_response(self, status): self.status=status
            def send_header(self, key, value): self.out_headers[key]=value
            def end_headers(self): pass
        h=Handler();h.mygrain_user=None;parts.handle_request(h,'GET',self.db);self.assertEqual(h.result[0],401)
        headers={'Content-Type':'application/zip','Content-Length':str(len(self.body)),'X-Mygrain-AI-Part':base64.urlsafe_b64encode(json.dumps(META).encode()).decode()}
        h=Handler(self.body,headers);parts.handle_request(h,'POST',self.db);self.assertEqual(h.result[0],200)
        h=Handler(self.body,headers);parts.handle_request(h,'POST',self.db);self.assertEqual(h.result[0],409)
        h=Handler();h.path+='?slot=1';parts.handle_request(h,'GET',self.db);self.assertEqual(h.status,200);self.assertEqual(h.wfile.getvalue(),self.body);self.assertEqual(h.out_headers['Cache-Control'],'no-store')
        h=Handler(b'bad',{'Content-Type':'application/zip','Content-Length':'3','X-Mygrain-AI-Part':'?bad'});parts.handle_request(h,'POST',self.db);self.assertEqual(h.result[0],400)


class SectionGenerationTests(unittest.TestCase):
    def direction(self, **changes):
        data={'prompt':'Warm C minor groove','current':CURRENT,'loops':LOOPS,'mode':'section','musicalState':copy.deepcopy(STATE),'section':{'type':'chorus','bars':8,'rolls':False},'refinement':'Lift to the relative major without changing the kit.'};data.update(changes);ai.validate_request(data);return ai.validate_direction(data)
    def generate(self, recipe):
        with patch.object(ai, 'run_model', return_value=ai.validate_recipe(copy.deepcopy(recipe))), patch.object(ai.catalogue, 'retrieve', side_effect=AssertionError('No fresh library lookup')):
            return ai.generate('warm', CURRENT, LOOPS, direction=self.direction())

    def test_all_types_current_context_and_middle8_length(self):
        for kind in ['verse','chorus','bridge','middle8']:
            self.assertEqual(self.direction(section={'type':kind,'bars':8,'rolls':False})['section']['type'],kind)
        for section in [{'type':'other','bars':8,'rolls':False},{'type':'middle8','bars':4,'rolls':False},{'type':'chorus','bars':True,'rolls':False},{'type':'verse','bars':8,'rolls':1}]:
            with self.assertRaises(ValueError): self.direction(section=section)
        state=copy.deepcopy(STATE);state['Q']['sequence']=[None]*16
        with self.assertRaises(ValueError): self.direction(musicalState=state)

    def test_contextual_chords_no_lookup_and_pattern(self):
        result=self.generate(RECIPE);self.assertEqual(result['patternSteps'],64);self.assertEqual(result['loops']['Q']['chordSteps'],16)

    def test_tempo_kit_source_and_instrument_locks(self):
        for recipe in [{**RECIPE,'parameters':{'globalBpmSlider':CURRENT['globalBpmSlider']+1}},{**RECIPE,'parameters':{'drumMachineSnarePitch':0}},{**RECIPE,'loops':{**RECIPE['loops'],'X':{'reload':True}}},{**RECIPE,'loops':{**RECIPE['loops'],'Q':{'chords':[[60,64,67]],'instrument':'piano'}}},{**RECIPE,'patternSteps':16},{k:v for k,v in RECIPE.items() if k!='patternSteps'}]:
            with self.subTest(recipe=recipe),self.assertRaises(ValueError): self.generate(recipe)

    def test_rolls_are_bounded_and_opt_in(self):
        recipe={**RECIPE,'drums':{'tracks':{'snare':{'steps':[0]*15+[1],'ratchets':[0]*15+[4]}}}}
        with self.assertRaises(ValueError): self.generate(recipe)
        direction=self.direction(section={'type':'chorus','bars':8,'rolls':True})
        with patch.object(ai,'run_model',return_value=ai.validate_recipe(recipe)):
            self.assertEqual(ai.generate('warm',CURRENT,LOOPS,direction=direction)['drums']['tracks']['snare']['ratchets'][-1],4)
        for values in [[True],[1],[9],[4]*9]:
            with self.assertRaises(ValueError): ai.validate_recipe({**RECIPE,'drums':{'tracks':{'snare':{'ratchets':values}}}})


if __name__=='__main__': unittest.main()
