import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import agent_plan as plans

STAMP = '2026-11-12T12:00:00Z'

class AgentPlanTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.path = self.root / 'events.jsonl'
        self.cache = patch.object(plans, 'CACHE', self.root / 'cache.sqlite'); self.cache.start(); self.addCleanup(self.cache.stop)

    def write(self, *events, mode='a'):
        with self.path.open(mode) as file:
            for event in events: file.write(json.dumps(event) + '\n')

    def codex(self, items):
        return {'timestamp': STAMP, 'type': 'event_msg', 'payload': {'type': 'plan_update', 'plan': items}}

    def test_incremental_updates_clear_and_new_request(self):
        self.write(self.codex([{'step': 'Test', 'status': 'in_progress'}]))
        self.assertEqual(plans.read_plan(self.path, 'Codex')['steps'][0]['status'], 'inProgress')
        self.write({'type': 'event_msg', 'payload': {'type': 'user_message', 'message': 'Next task'}})
        self.assertTrue(plans.read_plan(self.path, 'Codex')['newerRequest'])
        self.write(self.codex([{'step': 'Test', 'status': 'completed'}]))
        self.assertFalse(plans.read_plan(self.path, 'Codex')['newerRequest'])
        self.write(self.codex([]))
        self.assertIsNone(plans.read_plan(self.path, 'Codex'))
        self.assertIsNone(plans.read_plan(self.path, 'Codex'))

    def test_no_prose_inference_and_bad_data_does_not_replace_plan(self):
        self.write({'type': 'response_item', 'payload': {'type': 'message', 'text': '- [x] Deploy'}})
        self.assertIsNone(plans.read_plan(self.path, 'Codex'))
        self.write(self.codex([{'step': 'Build', 'status': 'pending'}]))
        self.write(self.codex([{'step': 'Build', 'status': {'bad': True}}]), self.codex('bad'))
        self.assertEqual(plans.read_plan(self.path, 'Codex')['steps'][0]['status'], 'pending')

    def test_tool_call_needs_successful_acknowledgment(self):
        self.write({'timestamp': STAMP, 'type': 'response_item', 'payload': {'type': 'function_call', 'name': 'update_plan', 'call_id': 'one', 'arguments': json.dumps({'plan': [{'step': 'Build', 'status': 'completed'}]})}})
        self.assertIsNone(plans.read_plan(self.path, 'Codex'))
        self.write({'timestamp': STAMP, 'type': 'response_item', 'payload': {'type': 'function_call_output', 'call_id': 'other', 'output': 'Plan updated'}})
        self.assertIsNone(plans.read_plan(self.path, 'Codex'))
        self.write({'timestamp': STAMP, 'type': 'response_item', 'payload': {'type': 'function_call_output', 'call_id': 'one', 'output': 'Plan updated'}})
        self.assertEqual(plans.read_plan(self.path, 'Codex')['steps'][0]['text'], 'Build')

    def test_claude_failed_tools_and_subagents_are_ignored(self):
        call = {'timestamp': STAMP, 'type': 'assistant', 'message': {'content': [{'type': 'tool_use', 'name': 'TodoWrite', 'id': 'tool', 'input': {'todos': [{'content': 'Check', 'status': 'pending'}]}}]}}
        result = {'timestamp': STAMP, 'type': 'user', 'message': {'content': [{'type': 'tool_result', 'tool_use_id': 'tool', 'is_error': True}]}}
        self.write(call, result)
        self.assertIsNone(plans.read_plan(self.path, 'Claude'))
        result['message']['content'][0]['is_error'] = False
        self.write(call, result)
        self.assertEqual(plans.read_plan(self.path, 'Claude')['steps'][0]['text'], 'Check')
        call['isSidechain'] = True; call['message']['content'][0]['input']['todos'] = []
        self.write(call, result)
        self.assertEqual(len(plans.read_plan(self.path, 'Claude')['steps']), 1)

    def test_partial_append_and_file_replacement(self):
        event = json.dumps(self.codex([{'step': 'Build', 'status': 'pending'}]))
        self.path.write_text(event[:-4])
        self.assertIsNone(plans.read_plan(self.path, 'Codex'))
        with self.path.open('a') as f: f.write(event[-4:] + '\n')
        self.assertIsNotNone(plans.read_plan(self.path, 'Codex'))
        self.path.unlink(); self.write({'type': 'other'})
        self.assertIsNone(plans.read_plan(self.path, 'Codex'))

    def test_live_notifications_are_scoped_and_clear_old_plans(self):
        message = {'method': 'turn/plan/updated', 'params': {'threadId': 'a', 'plan': [{'step': 'Review', 'status': 'inProgress'}]}}
        self.assertTrue(plans.record_codex_plan(message))
        self.assertIsNone(plans.read_codex_plan(None, 'b'))
        self.assertEqual(plans.read_codex_plan(None, 'a')['steps'][0]['text'], 'Review')
        plans.record_codex_plan({'method': 'turn/started', 'params': {'threadId': 'a'}})
        self.assertTrue(plans.read_codex_plan(None, 'a')['newerRequest'])
        message['params']['plan'] = []
        plans.record_codex_plan(message)
        self.assertIsNone(plans.read_codex_plan(None, 'a'))
        message['id'] = 5
        self.assertFalse(plans.record_codex_plan(message))

    def test_claude_exact_task_directory_and_unknown_status(self):
        folder = self.root / 'tasks' / 'session'; folder.mkdir(parents=True)
        path = folder / '1.json'
        path.write_text(json.dumps({'id': '1', 'subject': 'Run tests', 'status': 'in_progress'}))
        self.assertEqual(plans.read_claude_tasks(self.root, 'session')['steps'][0]['text'], 'Run tests')
        self.assertIsNone(plans.read_claude_tasks(self.root, 'another'))
        self.assertIsNone(plans.read_claude_tasks(self.root, '../session'))
        path.write_text(json.dumps({'id': '1', 'subject': 'Run tests', 'status': 'unknown'}))
        self.assertIsNone(plans.read_claude_tasks(self.root, 'session'))

    def test_copilot_tasks_read_only_statuses_and_isolation(self):
        import sqlite3
        folder = self.root / 'session-state' / 'one'
        folder.mkdir(parents=True)
        path = folder / 'session.db'
        with sqlite3.connect(path) as db:
            db.execute('CREATE TABLE todos (id TEXT, title TEXT, status TEXT, created_at TEXT, updated_at TEXT)')
            for index, status in enumerate(('pending', 'in_progress', 'done', 'blocked')):
                db.execute('INSERT INTO todos VALUES (?,?,?,?,?)', (str(index), 'Step ' + str(index), status, '2026-11-12 12:00:00', '2026-11-12 12:00:00'))
        before = path.read_bytes()
        result = plans.read_copilot_tasks(self.root, 'one', '2026-11-12T13:00:00Z')
        self.assertEqual([s['status'] for s in result['steps']], ['pending', 'inProgress', 'completed', 'blocked'])
        self.assertTrue(result['newerRequest'])
        self.assertEqual(path.read_bytes(), before)
        self.assertIsNone(plans.read_copilot_tasks(self.root, 'two'))
        self.assertFalse((self.root / 'session-state' / 'two').exists())
        self.assertIsNone(plans.read_copilot_tasks(self.root, '../one'))
        with sqlite3.connect(path) as db: db.execute("UPDATE todos SET status='unknown'")
        self.assertIsNone(plans.read_copilot_tasks(self.root, 'one'))
        with sqlite3.connect(path) as db: db.execute('DELETE FROM todos')
        self.assertIsNone(plans.read_copilot_tasks(self.root, 'one'))

if __name__ == '__main__': unittest.main()
