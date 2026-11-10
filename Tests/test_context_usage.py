import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from context_usage import read_context


class ContextTests(unittest.TestCase):
    def read(self, entries):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'events.jsonl'
            path.write_text('\n'.join(json.dumps(e) for e in entries) + '\n{partial')
            return read_context(path)

    def usage(self, used=80, limit=100):
        return {'type': 'event_msg', 'timestamp': '2026-11-10T04:00:00Z', 'payload': {'type': 'token_count', 'info': {
            'total_token_usage': {'total_tokens': 999999}, 'last_token_usage': {'total_tokens': used}, 'model_context_window': limit}}}

    def test_uses_last_report_not_cumulative_spend(self):
        self.assertEqual(self.read([self.usage()])['used'], 80)

    def test_latest_usage_can_decrease(self):
        self.assertEqual(self.read([self.usage(90), self.usage(20)])['used'], 20)

    def test_compaction_invalidates_old_reading(self):
        self.assertIsNone(self.read([self.usage(), {'type': 'compacted', 'payload': {}}]))
        self.assertEqual(self.read([self.usage(), {'type': 'compacted'}, self.usage(10)])['used'], 10)

    def test_missing_or_invalid_limit_is_unknown(self):
        for value in (None, 0, -1, '100', True):
            self.assertIsNone(self.read([self.usage(limit=value)]))
        self.assertIsNone(read_context('/nonexistent/session.jsonl'))

    def test_above_capacity_is_not_hidden(self):
        self.assertEqual(self.read([self.usage(120)])['used'], 120)
