import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import codex_events
import claude_bridge
import copilot_bridge


class EventTests(unittest.TestCase):
    def test_codex_observer_only_initializes_and_never_answers_requests(self):
        class Connection:
            def __init__(self):
                self.sent = []
                self.messages = iter([{'id': 1, 'result': {}},
                    {'method': 'thread/status/changed', 'params': {}},
                    {'method': 'item/commandExecution/requestApproval', 'id': 12},
                    {'method': 'item/agentMessage/delta', 'params': {}},
                    {'method': 'thread/closed', 'params': {}}])
            def send(self, raw): self.sent.append(json.loads(raw))
            def recv(self, timeout): return json.dumps(next(self.messages))
        connection = Connection(); events = []
        with self.assertRaises(StopIteration):
            codex_events.observe(connection, events.append)
        self.assertEqual([m['method'] for m in connection.sent], ['initialize', 'initialized'])
        self.assertEqual(events, [{'type': 'connected'}, {'type': 'changed'}, {'type': 'changed'}])

    def test_failed_handshake_does_not_report_connected(self):
        class Connection:
            def send(self, raw): pass
            def recv(self, timeout): return '{"id":1,"error":{"message":"unsupported"}}'
        events = []
        with self.assertRaises(RuntimeError): codex_events.observe(Connection(), events.append)
        self.assertEqual(events, [])

    def test_hook_signal_is_after_commit_and_ignores_repeated_work(self):
        for bridge, start, work, stop, sid in [
            (claude_bridge, 'UserPromptSubmit', 'PostToolUse', 'Stop', 'session_id'),
            (copilot_bridge, 'userPromptSubmitted', 'postToolUse', 'agentStop', 'sessionId')]:
            with self.subTest(provider=bridge.__name__), tempfile.TemporaryDirectory() as folder:
                state = Path(folder) / 'state.sqlite'
                with patch.object(bridge, 'STATE', state):
                    payload = {sid: 'test', 'timestamp': 1000, 'cwd': '/tmp', 'prompt': 'Task'}
                    bridge.record(start, payload)
                    signal = Path(str(state) + '.signal')
                    self.assertTrue(signal.exists())
                    with sqlite3.connect(state) as db:
                        self.assertEqual(json.loads(db.execute('SELECT data FROM states').fetchone()[0])['state'], 'working')
                    signal.unlink()
                    payload['timestamp'] = 2000
                    bridge.record(work, payload)
                    self.assertFalse(signal.exists(), 'Repeated working hooks should not wake the UI')
                    payload['timestamp'] = 3000
                    bridge.record(stop, payload)
                    self.assertTrue(signal.exists())

    def test_snapshot_never_emits_hook_signal(self):
        with tempfile.TemporaryDirectory() as folder:
            state = Path(folder) / 'state.sqlite'
            with patch.multiple(claude_bridge, STATE=state, HOME=Path(folder)), patch.object(claude_bridge, 'cli_sessions', return_value=[]):
                claude_bridge.snapshot()
                self.assertFalse(Path(str(state)+'.signal').exists())
