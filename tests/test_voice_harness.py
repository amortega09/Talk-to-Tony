import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('voice_harness',ROOT/'scripts/voice-harness.py')
harness=importlib.util.module_from_spec(spec);spec.loader.exec_module(harness)


class HarnessTests(unittest.TestCase):
    def test_case_suite_has_unique_ids_and_explicit_oracles(self):
        cases=json.loads((ROOT/'tests/voice-harness/cases.json').read_text())
        self.assertEqual(len(cases),len({c['id'] for c in cases}))
        for case in cases:
            self.assertTrue(case['turns'])
            for turn in case['turns']:self.assertTrue(turn['expected'])
        self.assertTrue(any(c.get('record') for c in cases))
        self.assertTrue(any(c.get('silence') for c in cases))

    def test_copy_oracle_preserves_holes_in_the_saved_day(self):
        cases=[{'id':'repeat_cfd','turns':[{'expected':{}}]}]
        rows=[{'date':'2026-10-13','start_time':t,'subcategory':'CFD','note':''} for t in ['09:30','10:00','11:30']]
        harness.copy_expectations(cases,rows)
        intervals=cases[0]['turns'][0]['expected']['items']
        self.assertEqual([(i[3],i[5]) for i in intervals],[('09:30','10:30'),('11:30','12:00')])

    def test_private_export_conversion_is_read_only_and_preserves_activity_names(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'diary.json'
            source={'user_id':'not-needed','days':{'2026-10-13':{'blocks':[{'start_time':'09:30','category':'work','subcategory':'CFD','note':''}],'reflection':'A good day'}},'targets':{'short_term':'Finish CFD'}}
            original=json.dumps(source);path.write_text(original)
            rows=harness.exported_history(path)
            self.assertEqual(path.read_text(),original)
            self.assertEqual(rows[0]['subcategory'],'CFD')
            self.assertTrue(any(r['start_time']=='__reflect__' for r in rows))
            self.assertNotIn('not-needed',json.dumps(rows))


if __name__=='__main__':unittest.main()
