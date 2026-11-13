"""Only affected legacy SC-kick snapshots need new playback audio."""
import importlib.util, json, os, pathlib, sys, unittest, zipfile, subprocess
from io import BytesIO
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests'))
from test_song_backend import part_zip, rewrite_part

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

new = load('kick_songs', ROOT / 'backend/mygrain_songs.py')
old = load('before_kick_songs', pathlib.Path(os.environ['MYGRAIN_BASELINE_BACKEND'])) if os.environ.get('MYGRAIN_BASELINE_BACKEND') else new

def fixture(modes=None, sliders=None, assets=True):
    def mutate(m):
        m['state']['modes'].update(drumMachineEnabled=True, drumMachineDirectOutput=False,
            finalCompressorSidechainSource='kick', drumMachineKickPattern=[True]+[False]*15)
        m['state']['modes'].update(modes or {})
        m['state']['sliders'] = {'finalCompressorAmount':'30', 'finalSidechainAmount':'0', 'finalSidechainKickLevel':'100', **(sliders or {})}
        if 'wasp' in m['state']['modes']:
            m['state']['modes']['wasp']=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./wasp-dsp.js').normalize("+json.dumps({'version':1,'routes':[{} for _ in range(6)],**m['state']['modes']['wasp']})+")))"],cwd=ROOT))
        if assets: m['assets'][0].update(key='drumKick',path='audio/drumKick.wav')
    body=rewrite_part(part_zip(), mutate)
    if not assets:return body
    result=BytesIO()
    with zipfile.ZipFile(BytesIO(body)) as src, zipfile.ZipFile(result,'w') as dest:
        for key in src.namelist():dest.writestr('audio/drumKick.wav' if key=='audio/bastardL.wav' else key,src.read(key))
    return result.getvalue()

class KickRouting(unittest.TestCase):
    def test_affected_and_unchanged_matrix(self):
        cases = [({}, {}, True, True),
            ({}, {'finalCompressorAmount':0,'finalSidechainAmount':80}, True, True),
            ({'fxMuted':True}, {'finalSidechainAmount':80}, True, True),
            ({}, {'finalSidechainAmount':80}, True, False),
            ({'finalCompressorSidechainSource':'off'}, {}, True, False),
            ({'finalCompressorSidechainSource':'lfo1'}, {}, True, False),
            ({'drumMachineDirectOutput':True}, {}, True, False),
            ({'drumMachineDirectOutput':True}, {'finalSidechainKickLevel':20}, True, True),
            ({'wasp':{'playground':{'enabled':True,'routeKick':True}}}, {}, True, False),
            ({'drumMachineEnabled':False}, {}, True, False),
            ({'drumMachineLaneSolos':['snare']}, {}, True, False),
            ({'drumMachineKickPattern':[False]*16}, {}, True, False),
            ({}, {'drumMachineKickLevel':0}, True, False),
            ({}, {'performanceDrumMachineLevel':0}, True, False),
            ({}, {}, False, False)]
        for modes, sliders, assets, affected in cases:
            with self.subTest(modes=modes, sliders=sliders, assets=assets):
                body=fixture(modes,sliders,assets)
                current, previous = new.validate_part_zip(body), old.validate_part_zip(body)
                self.assertEqual(current.get('kickRoutingVersion'),1 if affected else None)
                if old is not new:
                    if affected: self.assertNotEqual(current['contentSha256'],previous['contentSha256'])
                    else: self.assertEqual(current,previous)

    def test_genuine_pre_sidechain_snapshot_is_unchanged(self):
        body=part_zip()
        self.assertEqual(new.validate_part_zip(body),old.validate_part_zip(body))

if __name__ == '__main__': unittest.main()
