import json
from pathlib import Path
import shlex
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import claude_bridge as bridge
from history_search import initialize, index_file, search


class ClaudeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='claude tests ')
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.patch = patch.multiple(bridge, HOME=self.home, STATE=self.home / 'tracker.sqlite')
        self.patch.start()
        self.addCleanup(self.patch.stop)
        listing_patch = patch.object(bridge, 'cli_sessions', return_value=[])
        listing_patch.start()
        self.addCleanup(listing_patch.stop)
        self.identity = {'pid': 42, 'start': 'now', 'tty': '/dev/ttys001'}

    def send(self, event, **kwargs):
        bridge.record(event, {'session_id': 'example', 'cwd': '/tmp/project', **kwargs}, self.identity)

    def row(self, live=True):
        with patch.object(bridge, 'live', return_value=live):
            return bridge.snapshot()[0]

    def test_pending_request_survives_parallel_tool_and_clears_when_answered(self):
        self.send('PreToolUse', tool_name='AskUserQuestion', tool_use_id='q', tool_input={'questions': [{'question': 'Choose a database?'}]})
        original = self.row()['attention']
        self.assertEqual(original['kind'], 'question')
        self.send('PostToolUse', tool_use_id='other')
        self.assertEqual(self.row()['attention'], original)
        self.send('PostToolUse', tool_use_id='q')
        self.assertIsNone(self.row()['attention'])

    def test_lifecycle(self):
        for event, state in [('SessionStart', 'idle'), ('UserPromptSubmit', 'working'),
                             ('PermissionRequest', 'needsInput'), ('PostToolUse', 'working'),
                             ('Stop', 'idle'), ('SessionEnd', 'saved')]:
            self.send(event)
            self.assertEqual(self.row()['state'], state)
        self.assertEqual(self.row()['terminalTTY'], None)

    def test_question_parallel_tools_and_subagent_isolation(self):
        self.send('PreToolUse', tool_name='AskUserQuestion', tool_use_id='question')
        self.send('PostToolUse', tool_use_id='other')
        self.assertEqual(self.row()['state'], 'needsInput')
        self.send('Stop', agent_id='child')
        self.assertEqual(self.row()['state'], 'needsInput')
        self.send('PostToolUse', tool_use_id='question')
        self.assertEqual(self.row()['state'], 'working')

    def test_exit_and_pid_reuse(self):
        self.send('UserPromptSubmit')
        self.assertEqual(self.row(live=False)['state'], 'saved')
        with patch.object(bridge, 'process_info', return_value=(1, 'different start', '/bin/claude')):
            self.assertFalse(bridge.live(self.identity))

    def test_failure_and_compaction(self):
        self.send('StopFailure')
        self.assertEqual(self.row()['state'], 'needsInput')
        self.send('SessionStart', source='compact')
        self.assertEqual(self.row()['state'], 'needsInput')
        self.send('Stop')
        self.send('SessionStart', source='compact')
        self.assertEqual(self.row()['state'], 'idle')
        self.send('UserPromptSubmit')
        self.send('SessionStart', source='compact')
        self.assertEqual(self.row()['state'], 'working')

    def test_out_of_order_events(self):
        bridge.record('Stop', {'session_id': 'example'}, self.identity, stamp=200)
        bridge.record('UserPromptSubmit', {'session_id': 'example'}, self.identity, stamp=100)
        self.assertEqual(self.row()['state'], 'idle')

    def transcript(self):
        path = self.home / 'projects/project/example.jsonl'
        path.parent.mkdir(parents=True)
        items = [
            {'type': 'user', 'cwd': '/tmp/project', 'message': {'content': 'Build a telescope'}},
            {'type': 'assistant', 'message': {'content': [{'type': 'thinking', 'thinking': 'hidden'}, {'type': 'text', 'text': 'Lens installed'}]}},
            {'type': 'user', 'message': {'content': [{'type': 'tool_result', 'content': 'private tool output'}]}},
            {'type': 'custom-title', 'customTitle': 'Observatory'},
        ]
        path.write_text(''.join(json.dumps(item) + '\n' for item in items) + '{partial')
        return path

    def test_history_unknown_state_and_search(self):
        path = self.transcript()
        with patch.object(bridge, 'cli_sessions', return_value=None):
            row = self.row(live=False)
        self.assertEqual(row['title'], 'Observatory')
        self.assertEqual(row['state'], 'disconnected')
        info, messages = bridge.transcript(path)
        self.assertEqual(messages, ['User: Build a telescope', 'Assistant: Lens installed'])
        db = sqlite3.connect(':memory:')
        self.addCleanup(db.close)
        with db:
            initialize(db)
            index_file(db, 'Claude:example', path)
            self.assertTrue(search(db, 'telescope'))
            self.assertFalse(search(db, 'hidden'))

    def test_install_preserves_other_settings_and_hooks(self):
        path = self.home / 'settings.json'
        other = {'matcher': 'Bash', 'hooks': [{'type': 'command', 'command': 'echo unrelated'}]}
        original = {'theme': 'dark', 'permissions': {'deny': ['Bash(rm *)']}, 'hooks': {'PreToolUse': [other]}}
        path.write_text(json.dumps(original))
        bridge.install_hooks()
        bridge.install_hooks()
        config = json.loads(path.read_text())
        self.assertEqual(config['permissions'], original['permissions'])
        self.assertEqual(config['hooks']['PreToolUse'][0], other)
        self.assertEqual(len(config['hooks']['PreToolUse']), 2)
        for event in bridge.EVENTS:
            args = shlex.split(config['hooks'][event][-1]['hooks'][0]['command'])
            self.assertEqual(args[-2:], ['hook', event])
            self.assertIn('-B', args)
        self.assertTrue(list(self.home.glob('settings.runhuddle-backup-*.json')))

    def test_repair_missing_old_app_preserves_other_hooks(self):
        old = self.home / 'Old Applications/RunHuddle.app/Contents/Resources'
        command = shlex.join([str(old / 'python/bin/python3'), '-E', '-s', '-B',
                              str(old / 'bridge/claude_bridge.py'), 'hook', 'SessionEnd'])
        unrelated = {'type': 'command', 'command': 'echo unrelated'}
        path = self.home / 'settings.json'
        path.write_text(json.dumps({'theme': 'dark', 'hooks': {'SessionEnd': [
            {'hooks': [{'type': 'command', 'command': command}, unrelated]}]}}))
        self.assertFalse(old.exists())
        self.assertTrue(bridge.repair_hooks()['repaired'])
        result = json.loads(path.read_text())
        self.assertEqual(result['theme'], 'dark')
        self.assertEqual(result['hooks']['SessionEnd'][0]['hooks'], [unrelated])
        self.assertNotIn(str(old), path.read_text())
        before = path.read_bytes()
        backups = list(self.home.glob('settings.runhuddle-backup-*.json'))
        self.assertFalse(bridge.repair_hooks()['repaired'])
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(list(self.home.glob('settings.runhuddle-backup-*.json')), backups)

    def test_repair_does_not_opt_in_or_override_disabled_hooks(self):
        path = self.home / 'settings.json'
        self.assertFalse(bridge.repair_hooks()['repaired'])
        self.assertFalse(path.exists())
        for config in [{'theme': 'dark'}, {'disableAllHooks': True}]:
            path.write_text(json.dumps(config))
            before = path.read_bytes()
            self.assertFalse(bridge.repair_hooks()['repaired'])
            self.assertEqual(path.read_bytes(), before)
        self.assertFalse(bridge.owned('/usr/bin/python3 -E -s -B /unrelated/claude_bridge.py hook SessionEnd'))

    def test_invalid_settings_are_not_overwritten(self):
        path = self.home / 'settings.json'
        for content in ('{broken', '{"disableAllHooks":true}'):
            path.write_text(content)
            with self.assertRaises(ValueError):
                bridge.install_hooks()
            self.assertEqual(path.read_text(), content)

    def listed(self, status='idle', **kwargs):
        entry = {'sessionId': 'example', 'pid': 42, 'cwd': '/tmp/project', 'name': 'Existing terminal', 'status': status, **kwargs}
        with patch.object(bridge, 'process_info', return_value=(1, 'now', '/bin/claude')), \
             patch.object(bridge.subprocess, 'run', return_value=type('Result', (), {'stdout': 'ttys001'})()):
            return bridge.listed_session(entry)

    def test_listing_maps_live_activity(self):
        for status, state in [('busy', 'working'), ('waiting', 'needsInput'), ('idle', 'idle')]:
            sid, row = self.listed(status)
            self.assertEqual(sid, 'example')
            self.assertEqual(row['state'], state)
            self.assertEqual(row['identity']['tty'], '/dev/ttys001')
        self.assertEqual(self.listed('idle', state='working')[1]['state'], 'working')

    def test_existing_session_overrides_old_saved_hook(self):
        self.send('SessionEnd')
        entry = self.listed('busy')
        with patch.object(bridge, 'cli_sessions', return_value=[{}]), patch.object(bridge, 'listed_session', return_value=entry):
            row = bridge.snapshot()[0]
        self.assertEqual(row['state'], 'working')
        self.assertEqual(row['title'], 'Existing terminal')
        self.assertEqual(row['terminalTTY'], '/dev/ttys001')
        self.assertEqual(self.row(live=False)['state'], 'saved')
        self.assertEqual(self.row(live=True)['state'], 'disconnected')

    def test_discovers_session_without_history_or_hooks(self):
        entry = self.listed('idle')
        with patch.object(bridge, 'cli_sessions', return_value=[{}]), patch.object(bridge, 'listed_session', return_value=entry):
            self.assertEqual(bridge.snapshot()[0]['state'], 'idle')
        self.assertEqual(self.row(live=False)['state'], 'saved')

    def test_detached_interactive_process_does_not_claim_confirmed_work(self):
        entry = {'sessionId': 'example', 'pid': 42, 'kind': 'interactive', 'status': 'busy'}
        with patch.object(bridge, 'process_info', return_value=(1, 'now', '/bin/claude')), \
             patch.object(bridge.subprocess, 'run', return_value=type('Result', (), {'stdout': '??'})()):
            _, row = bridge.listed_session(entry)
            self.assertEqual(row['state'], 'disconnected')
            self.assertIn('reports busy', row['reason'])
            self.assertIn('no controlling terminal', row['reason'])
            entry['kind'] = 'background'
            self.assertEqual(bridge.listed_session(entry)[1]['state'], 'working')

    def test_background_task_notice_does_not_replace_user_preview(self):
        path = self.transcript()
        with path.open('a') as file:
            file.write('\n' + json.dumps({'type': 'user', 'message': {'content':
                '<task-notification><status>stopped</status><summary>Background command stopped</summary></task-notification>'}}) + '\n')
        info, messages = bridge.transcript(path)
        self.assertEqual(info['preview'], 'Build a telescope')
        self.assertFalse(any('task-notification' in item for item in messages))

    def test_listing_rejects_dead_process_and_missing_id(self):
        with patch.object(bridge, 'process_info', return_value=None):
            self.assertIsNone(bridge.listed_session({'sessionId': 'example', 'pid': 42, 'status': 'busy'}))
        self.assertIsNone(bridge.listed_session({'pid': 42, 'status': 'busy'}))

    def test_duplicate_processes_are_not_arbitrarily_selected(self):
        entry = self.listed('idle')
        with patch.object(bridge, 'cli_sessions', return_value=[{}, {}]), patch.object(bridge, 'listed_session', return_value=entry):
            row = bridge.snapshot()[0]
        self.assertEqual(row['state'], 'disconnected')
        self.assertIsNone(row['terminalTTY'])

    def test_malformed_message_is_ignored(self):
        self.assertIsNone(bridge.message({'type': 'user', 'message': 'broken'}))
        self.assertIsNone(bridge.message({'type': 'assistant', 'message': {'content': [{'type': 'text', 'text': None}]}}))

    def test_subagent_transcripts_not_discovered(self):
        path = self.home / 'projects/project/session/subagents/agent-child.jsonl'
        path.parent.mkdir(parents=True)
        path.write_text('{}\n')
        self.assertFalse(bridge.paths())
