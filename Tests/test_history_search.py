import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from history_search import initialize, index_file, search


class HistorySearchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'events.jsonl'
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        initialize(self.db)

    def event(self, text):
        return json.dumps({'type': 'response_item', 'payload': {'type': 'message', 'role': 'user', 'content': [{'type': 'input_text', 'text': text}]}}) + '\n'

    def test_search_finds_older_messages_and_returns_excerpt(self):
        self.path.write_text(self.event('Fix notification permissions') + self.event('Now change the icon'))
        index_file(self.db, 'Codex:a', self.path)
        hits = search(self.db, 'notification permissions')
        self.assertEqual(hits[0]['id'], 'Codex:a')
        self.assertIn('[notification]', hits[0]['excerpt'])
        self.assertEqual(search(self.db, 'missing'), [])

    def test_incremental_append_does_not_duplicate_messages(self):
        self.path.write_text(self.event('First request'))
        index_file(self.db, 'Codex:a', self.path)
        with self.path.open('a') as file: file.write(self.event('Second request'))
        index_file(self.db, 'Codex:a', self.path)
        index_file(self.db, 'Codex:a', self.path)
        self.assertEqual(self.db.execute('select count(*) from messages').fetchone()[0], 2)

    def test_partial_lines_and_truncation(self):
        full = self.event('recoverable message')
        self.path.write_text(full[:20])
        index_file(self.db, 'Codex:a', self.path)
        self.assertEqual(search(self.db, 'recoverable'), [])
        self.path.write_text(full)
        index_file(self.db, 'Codex:a', self.path)
        self.assertEqual(len(search(self.db, 'recoverable')), 1)
        self.path.write_text(self.event('new'))
        index_file(self.db, 'Codex:a', self.path)
        self.assertEqual(search(self.db, 'recoverable'), [])

    def test_query_syntax_is_treated_as_words(self):
        self.path.write_text(self.event('quoted AND request'))
        index_file(self.db, 'Codex:a', self.path)
        self.assertEqual(len(search(self.db, '"quoted AND request"')), 1)
        self.assertEqual(search(self.db, '"*'), [])

    def test_copilot_messages_are_indexed(self):
        self.path.write_text(json.dumps({'type': 'assistant.message', 'data': {'content': 'Tests failed: permission denied'}}) + '\n')
        index_file(self.db, 'Copilot:b', self.path)
        self.assertEqual(search(self.db, 'permission')[0]['role'], 'assistant')
