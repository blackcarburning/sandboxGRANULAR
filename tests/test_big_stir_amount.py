import copy,unittest
from test_cooking_pot import songs,old,pot,with_modes
from test_effect_overall_volume import bass
class BigStirAmount(unittest.TestCase):
 def test_metadata_keeps_legacy_audio_identity(self):
  for modes in [{},{'bassFace':bass()}]:
   for amount in [0,.01,.5,.99,1]:
    state={**modes,'cookingPot':{**pot(), 'stirAmount':amount}}
    base=songs.validate_part_zip(with_modes({**modes,'cookingPot':pot()}))
    body=with_modes(state);self.assertEqual(songs.validate_part_zip(body),base)
    if not modes:self.assertEqual(old.validate_part_zip(body),base)
 def test_strict_range_and_type(self):
  for amount in [True,False,-.1,1.1,'0.5',[],{},float('nan'),float('inf')]:
   with self.subTest(amount=amount),self.assertRaises(ValueError):songs.validate_cooking_pot({**pot(),'stirAmount':amount})
if __name__=='__main__':unittest.main()
