import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import compaction_count as counter

class CompactionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'session.jsonl'
        self.cache = patch.object(counter, 'CACHE', Path(self.temp.name) / 'cache.sqlite')
        self.cache.start(); self.addCleanup(self.cache.stop)
    def write(self, events, mode='w'):
        with self.path.open(mode) as f:
            for event in events: f.write(json.dumps(event) + '\n')
    def test_codex_duplicate_representations_and_append(self):
        self.write([{'type': 'compacted'}, {'type': 'event_msg', 'payload': {'type': 'context_compacted'}}])
        self.assertEqual(counter.read_compactions(self.path, 'Codex')['count'], 1)
        self.assertEqual(counter.read_compactions(self.path, 'Codex')['count'], 1)
        self.write([{'type': 'compacted'}], 'a')
        self.assertEqual(counter.read_compactions(self.path, 'Codex')['count'], 2)
    def test_copilot_counts_only_successful_completion(self):
        self.write([{'type': 'session.compaction_start'}, {'type': 'session.compaction_complete', 'data': {'success': False}}, {'type': 'session.compaction_complete', 'data': {'success': True}}])
        self.assertEqual(counter.read_compactions(self.path, 'Copilot')['count'], 1)
    def test_claude_and_truncation(self):
        self.write([{'type': 'system', 'subtype': 'compact_boundary'}] * 2)
        self.assertEqual(counter.read_compactions(self.path, 'Claude')['count'], 2)
        self.write([{'type': 'user'}])
        self.assertEqual(counter.read_compactions(self.path, 'Claude')['count'], 0)
    def test_partial_line_and_unknown_file(self):
        self.path.write_text('{"type":"compacted"}')
        self.assertEqual(counter.read_compactions(self.path, 'Codex')['count'], 0)
        with self.path.open('a') as f: f.write('\n')
        self.assertEqual(counter.read_compactions(self.path, 'Codex')['count'], 1)
        self.assertIsNone(counter.read_compactions('/missing/record', 'Codex'))
