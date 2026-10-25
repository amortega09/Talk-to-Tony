import copy
import json
import unittest
from unittest.mock import patch
import desktop


def draft(action):
    return {'reply': 'Review the proposed change.', 'questions': [], 'items': [], 'reflections': [], 'actions': [action]}


class VoiceActionTests(unittest.TestCase):
    def test_valid_action_and_backwards_compatible_draft(self):
        good = draft({'type': 'activity_delete', 'target': 'activity:2026-10-25:09:00'})
        self.assertEqual(desktop.validate_draft(good), good)
        del good['actions']
        self.assertEqual(desktop.validate_draft(good), good)

    def test_rejects_unknown_actions_extra_fields_and_invalid_values(self):
        for action in [
            {'type': 'run_sql', 'text': 'delete everything'},
            {'type': 'navigate', 'url': 'https://example.com'},
            {'type': 'checkin', 'energy': True},
            {'type': 'checkin', 'energy': 6},
            {'type': 'activity_update', 'start': '09:15'},
            {'type': 'activity_delete', 'target': {'id': 'made up'}},
            {'type': 'objective_complete', 'completed': 'true'},
            {'type': 'checkin', 'date': '2000-01-01'},
            {'type': 'checkin', 'date': '2026-02-30'},
        ]:
            with self.subTest(action=action), self.assertRaises(ValueError):
                desktop.validate_draft(draft(action))

    def test_actions_cannot_be_mixed_with_diary_writes_or_exceed_limit(self):
        value = draft({'type': 'navigate', 'screen': 'notes'})
        value['reflections'] = [{'date': '2026-10-25', 'text': 'Reflection'}]
        with self.assertRaises(ValueError): desktop.validate_draft(value)
        value['reflections'] = []
        value['actions'] *= 17
        with self.assertRaises(ValueError): desktop.validate_draft(value)

    @patch('desktop.cloud_models', return_value=[{'name': 'test-model'}])
    @patch('desktop.ollama')
    def test_context_target_ids_and_actions_round_trip_without_executing(self, model, _catalog):
        value = draft({'type': 'objective_complete', 'target': 'objective:2026-10-25:daily:0', 'completed': True})
        model.return_value = {'message': {'content': json.dumps(value)}}
        context = {'today': '2026-10-25', 'viewed_date': '2026-10-25', 'app': {'targets': [{'id': 'objective:2026-10-25:daily:0', 'text': 'Example goal'}]}}
        result = desktop.interpret({'model': 'test-model', 'transcript': 'Complete Example goal', 'context': context})
        self.assertEqual(result['actions'], value['actions'])
        request = model.call_args.args[1]
        self.assertEqual(json.loads(request['messages'][1]['content'])['context'], context)
        self.assertIn('Actions are previews only', request['messages'][0]['content'])
        self.assertIn('Never manufacture a target', request['messages'][0]['content'])
