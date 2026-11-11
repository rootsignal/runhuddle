import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from attention_request import request

class AttentionRequestTests(unittest.TestCase):
    def test_explicit_requests_are_bounded_and_do_not_copy_other_fields(self):
        result = request('PermissionRequest', {'tool_name': 'Bash', 'tool_input': {'command': 'npm test', 'secret': 'private'}, 'api_key': 'private'}, 100)
        self.assertEqual(result, {'kind': 'permission', 'detail': 'Bash\nnpm test', 'since': 100})
        self.assertLessEqual(len(request('PermissionRequest', {'message': 'x' * 10000}, 100)['detail']), 4000)
    def test_questions_preserve_options_and_plan_is_distinct(self):
        result = request('PreToolUse', {'tool_name': 'AskUserQuestion', 'tool_input': {'questions': [{'question': 'Which database?', 'options': [{'label': 'Postgres'}, {'label': 'SQLite'}]}]}}, 100)
        self.assertEqual(result['kind'], 'question')
        self.assertIn('• SQLite', result['detail'])
        self.assertEqual(request('PermissionRequest', {'tool_name': 'ExitPlanMode'}, 100)['kind'], 'plan')
    def test_missing_or_malformed_details_are_not_invented(self):
        self.assertIsNone(request('Notification', {}, 100)['detail'])
        self.assertIsNone(request('Notification', {'tool_input': ['not a mapping'], 'message': {}}, 100)['detail'])
