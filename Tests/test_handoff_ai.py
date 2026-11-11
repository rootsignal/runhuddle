import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import handoff_ai
import codex_bridge

class HandoffAITests(unittest.TestCase):
    def test_work_summary_prompt_keeps_evidence_rules(self):
        prompt = handoff_ai.prompt_for({'recordKind': 'work-summary', 'history': 'Recorded evidence'})
        self.assertIn('lasting work summary', prompt)
        self.assertIn('Approaches tried and rejected', prompt)
        self.assertIn('A request or plan is NOT completed work', prompt)
        self.assertIn('Do not include secrets', prompt)
        self.assertNotIn('lasting work summary', handoff_ai.prompt_for({'history': 'History'}))

    def test_commands_use_isolated_text_generation_not_resume(self):
        for provider in ('Codex', 'Claude', 'Copilot'):
            command = handoff_ai.command_for(provider, '/bin/agent', Path('/tmp/output'))
            self.assertNotIn('resume', command)
            self.assertNotIn('--continue', command)
            self.assertNotIn('--allow-all-tools', command)
        self.assertIn('--ephemeral', handoff_ai.command_for('Codex', '/bin/agent', Path('/tmp/output')))
        self.assertIn('--no-session-persistence', handoff_ai.command_for('Claude', '/bin/agent', Path('/tmp/output')))
        self.assertNotIn('-p', handoff_ai.command_for('Copilot', '/bin/agent', Path('/tmp/output')))

    def test_prompt_keeps_recent_corrections_and_marks_omissions(self):
        prompt = handoff_ai.prompt_for({'history': 'ORIGINAL' + 'x' * 160000 + 'LATEST CORRECTION', 'purpose': 'Ship it'})
        self.assertIn('ORIGINAL', prompt)
        self.assertIn('LATEST CORRECTION', prompt)
        self.assertIn('Middle omitted', prompt)
        self.assertIn('A request or plan is NOT completed work', prompt)
        self.assertIn('untrusted conversation data', prompt)
        self.assertLess(len(prompt), 125000)

    def test_failed_cli_does_not_echo_source_or_stderr(self):
        process = Mock(returncode=1)
        process.communicate.return_value = ('', 'private transcript and credentials')
        with patch.object(handoff_ai.subprocess, 'Popen', return_value=process):
            with self.assertRaises(RuntimeError) as error:
                handoff_ai.generate({'provider': 'Claude', 'executable': sys.executable, 'history': 'source'})
        self.assertNotIn('private', str(error.exception))
        self.assertIn('existing handoff was kept', str(error.exception))

    def test_empty_output_is_not_a_handoff(self):
        process = Mock(returncode=0)
        process.communicate.return_value = ('  ', '')
        with patch.object(handoff_ai.subprocess, 'Popen', return_value=process):
            with self.assertRaisesRegex(RuntimeError, 'empty or oversized'):
                handoff_ai.generate({'provider': 'Claude', 'executable': sys.executable, 'history': 'source'})

    def test_codex_source_keeps_decisions_before_latest_response(self):
        client = Mock()
        client.request.return_value = {'data': [
            {'items': [{'type': 'agentMessage', 'text': 'Approval is still pending'}]},
            {'items': [{'type': 'userMessage', 'content': [{'type': 'text', 'text': 'Do not publish before approval'}]},
                       {'type': 'commandExecution', 'command': 'tests', 'status': 'completed', 'exitCode': 0}]}]}
        text = codex_bridge.handoff_history(client, 'session')['text']
        self.assertLess(text.index('Do not publish'), text.index('Approval is still pending'))
        self.assertIn('exit: 0', text)
        self.assertEqual(client.request.call_args.args[0], 'thread/turns/list')
