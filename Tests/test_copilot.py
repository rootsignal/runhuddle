import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('copilot_bridge', Path(__file__).resolve().parents[1] / 'scripts/copilot_bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class CopilotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.patch = patch.multiple(bridge, HOME=self.home, STATE=self.home / 'tracker.sqlite')
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_install_hooks_migrates_legacy_and_disables_bytecode(self):
        legacy = self.home / 'old checkout/copilot_bridge.py'
        legacy.parent.mkdir()
        legacy.write_text(Path(bridge.__file__).read_text())
        path = self.home / 'hooks/agent-session-manager.json'
        path.parent.mkdir()
        path.write_text(json.dumps({'version': 1, 'hooks': {'agentStop': [
            {'type': 'command', 'exec': '/old/python', 'args': [str(legacy), 'hook', 'agentStop']} ]}}))
        bridge.install_hooks()
        config = json.loads(path.read_text())
        for event, entries in config['hooks'].items():
            self.assertEqual(entries[0]['args'], ['-E', '-s', '-B', str(Path(bridge.__file__).resolve()), 'hook', event])
        bridge.install_hooks()  # Reinstallation is safe.

    def test_install_hooks_preserves_unrelated_collector(self):
        path = self.home / 'hooks/agent-session-manager.json'
        path.parent.mkdir()
        original = json.dumps({'version': 1, 'hooks': {'agentStop': [
            {'type': 'command', 'exec': '/bin/echo', 'args': ['hello']} ]}})
        path.write_text(original)
        with self.assertRaises(RuntimeError):
            bridge.install_hooks()
        self.assertEqual(path.read_text(), original)

    def send(self, event, timestamp=1000, **kwargs):
        bridge.record(event, dict(sessionId='example', timestamp=timestamp, cwd='/tmp/project', **kwargs), {'pid': 123, 'start': 'now'})

    def row(self):
        with patch.object(bridge, 'live', return_value=True):
            return bridge.snapshot()[0]

    def test_diagnostics_distinguishes_configuration_from_received_events(self):
        self.assertEqual(bridge.diagnostics(), {'configured': False, 'lastEvent': None})
        bridge.install_hooks()
        self.assertEqual(bridge.diagnostics(), {'configured': True, 'lastEvent': None})
        self.send('sessionStart', 5000)
        self.assertEqual(bridge.diagnostics(), {'configured': True, 'lastEvent': 5.0})

    def test_lifecycle_and_actual_permission(self):
        self.send('userPromptSubmitted', prompt='Implement feature')
        self.assertEqual(self.row()['state'], 'working')
        self.send('permissionRequest', 2000)
        self.assertEqual(self.row()['state'], 'working')
        self.send('notification', 3000, notification_type='permission_prompt')
        self.assertEqual(self.row()['state'], 'needsInput')
        self.send('postToolUse', 4000)
        self.assertEqual(self.row()['state'], 'working')
        self.send('agentStop', 5000)
        self.assertEqual(self.row()['state'], 'idle')
        self.send('sessionEnd', 6000)
        self.assertEqual(self.row()['state'], 'saved')

    def test_subagent_and_background_notifications_do_not_stop_parent(self):
        self.send('userPromptSubmitted')
        self.send('agentStop', 2000, agentId='child')
        self.send('notification', 3000, notification_type='agent_idle')
        self.assertEqual(self.row()['state'], 'working')

    def test_out_of_order_notification_ignored(self):
        self.send('agentStop', 5000)
        self.send('notification', 2000, notification_type='elicitation_dialog')
        self.assertEqual(self.row()['state'], 'idle')

    def test_closed_or_rebooted_process_is_saved(self):
        self.send('userPromptSubmitted')
        with patch.object(bridge, 'live', return_value=False):
            self.assertEqual(bridge.snapshot()[0]['state'], 'saved')

    def test_pid_reuse_is_not_live(self):
        with patch.object(bridge, 'process_info', return_value=(1, 'different start', '/bin/copilot')):
            self.assertFalse(bridge.live({'pid': 123, 'start': 'old start'}))

    def test_transcript_discovery_and_history(self):
        folder = self.home / 'session-state' / 'saved-id'
        folder.mkdir(parents=True)
        entries = [dict(type='session.start', data={'context': {'cwd': '/work/repo', 'branch': 'feature'}}),
                   dict(type='user.message', data={'content': 'Fix the issue'}),
                   dict(type='assistant.message', data={'content': 'Changed the parser'})]
        path = folder / 'events.jsonl'
        path.write_text('\n'.join(json.dumps(e) for e in entries) + '\n{partial')
        row = bridge.snapshot()[0]
        self.assertEqual((row['provider'], row['project'], row['branch'], row['state']), ('Copilot', 'repo', 'feature', 'saved'))
        self.assertEqual(row['title'], 'Fix the issue')
        self.assertIn('Assistant: Changed the parser', bridge.transcript(path)[1])

    def test_empty_open_session_is_discovered_without_claiming_idle(self):
        folder = self.home / 'session-state' / 'empty'
        folder.mkdir(parents=True)
        (folder / 'workspace.yaml').write_text('id: empty\ncwd: /work/project\nbranch: main\n')
        with patch.object(bridge, 'has_open_cli', return_value=True):
            row = bridge.snapshot()[0]
        self.assertEqual(row['project'], 'project')
        self.assertEqual(row['state'], 'disconnected')
        self.assertIn('CLI is open', row['reason'])
        with patch.object(bridge, 'has_open_cli', return_value=False):
            self.assertEqual(bridge.snapshot()[0]['state'], 'saved')

    def test_abandoned_hold_file_is_not_a_live_session(self):
        folder = self.home / 'session-state' / 'empty'
        folder.mkdir(parents=True)
        (folder / 'inuse.123.hold').touch()
        with patch.object(bridge, 'process_info', return_value=None):
            self.assertFalse(bridge.has_open_cli(folder))

    def test_workspace_identity_must_match_folder(self):
        folder = self.home / 'session-state' / 'empty'
        folder.mkdir(parents=True)
        (folder / 'workspace.yaml').write_text('id: another\ncwd: /wrong/project\n')
        self.assertEqual(bridge.workspace(folder), {})

    def test_hook_title_survives_status_events(self):
        self.send('userPromptSubmitted', prompt='A task')
        self.send('agentStop', 2000)
        self.assertEqual(self.row()['title'], 'A task')


if __name__ == '__main__':
    unittest.main()
