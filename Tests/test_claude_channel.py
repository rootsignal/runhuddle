import io
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import claude_channel as channel
import claude_bridge
import session_reply

SID = '6ff1544c-25da-49e8-b214-d53360ca7c10'
OTHER = 'ca1fa508-d92f-4c1d-a32c-697a29177dc7'


class ChannelTests(unittest.TestCase):
    def setUp(self):
        self.output = []
        self.channel = channel.Channel(SID, self.output.append, lambda: None)
        self.channel.initialized = True

    def test_forwarding_is_not_a_receipt(self):
        text = 'Look at /tmp/image.png\n$(touch NEVER) `echo literal`'
        result = self.channel.request({'action': 'send', 'sessionID': SID, 'text': text})
        self.assertEqual(result['outcome'], 'forwarded')
        self.assertEqual(self.output[0]['params']['content'], text)
        self.assertEqual(self.channel.request({'action': 'check', 'sessionID': SID})['receivedIDs'], [])
        self.channel.rpc({'id': 7, 'method': 'tools/call', 'params': {'name': 'acknowledge', 'arguments': {'message_id': result['messageID']}}})
        self.assertFalse(self.output[-1]['result']['isError'])
        self.assertEqual(self.channel.request({'action': 'check', 'sessionID': SID})['receivedIDs'], [result['messageID']])

    def test_wrong_session_invalid_text_and_uninitialized_never_emit(self):
        for payload in [dict(action='send', sessionID=OTHER, text='hi'),
                        dict(action='send', sessionID=SID, text=''),
                        dict(action='send', sessionID=SID, text='x' * 32001),
                        dict(action='send', sessionID=SID, text='a\0b'),
                        dict(action='bad', sessionID=SID, text='hi')]:
            self.assertEqual(self.channel.request(payload)['outcome'], 'notSent')
        self.channel.initialized = False
        self.assertEqual(self.channel.request(dict(action='send', sessionID=SID, text='hi'))['outcome'], 'unavailable')
        self.assertEqual(self.output, [])

    def test_approval_or_dead_session_never_emits(self):
        self.channel.verify = lambda: 'Answer in terminal'
        self.assertEqual(self.channel.request(dict(action='send', sessionID=SID, text='hi'))['outcome'], 'unavailable')
        self.assertEqual(self.output, [])

    def test_eligibility_checks_exact_process_and_ambiguity(self):
        identity = dict(pid=42, start='today')
        row = dict(sessionId=SID, pid=42, status='idle')
        with patch.object(claude_bridge, 'live', return_value=True), patch.object(claude_bridge, 'cli_sessions', return_value=[row]):
            self.assertIsNone(channel.eligibility(SID, identity))
            self.assertIsNotNone(channel.eligibility(OTHER, identity))
            for updates in [dict(pid=43), dict(status='waiting'), dict(state='blocked')]:
                with patch.object(claude_bridge, 'cli_sessions', return_value=[dict(row, **updates)]):
                    self.assertIsNotNone(channel.eligibility(SID, identity))
            with patch.object(claude_bridge, 'cli_sessions', return_value=[row, row]):
                self.assertIsNotNone(channel.eligibility(SID, identity))
        with patch.object(claude_bridge, 'live', return_value=False):
            self.assertIsNotNone(channel.eligibility(SID, identity))

    def test_launch_never_duplicates_existing_process(self):
        with patch.object(claude_bridge, 'cli_sessions', return_value=[dict(sessionId=SID, pid=42)]):
            with self.assertRaises(ValueError): channel.validate_launch(SID)
            channel.validate_launch(OTHER)
        with patch.object(claude_bridge, 'cli_sessions', return_value=None):
            with self.assertRaises(ValueError): channel.validate_launch(SID)

    def test_launch_arguments_preserve_session_and_do_not_skip_permissions(self):
        for resume in [True, False]:
            args = channel.launch_arguments(SID, '/some path/claude', resume)
            self.assertEqual(args[1:3], ['--resume' if resume else '--session-id', SID])
            self.assertNotIn('--dangerously-skip-permissions', args)
            config = json.loads(args[args.index('--mcp-config') + 1])
            self.assertEqual(config['mcpServers']['runhuddle']['args'][-1], SID)
        with patch.object(claude_bridge, 'cli_sessions', return_value=[]):
            result = channel.setup(dict(sessionID=SID, executable="/a'b/claude", resume=True))
            self.assertEqual(shlex.split(result['message'])[-3:], ['--executable', "/a'b/claude", '--resume'])

    def test_transport_failure_never_claims_delivery_or_retries(self):
        with patch.object(Path, 'exists', return_value=True), patch.object(channel, 'exchange', side_effect=TimeoutError) as exchange:
            result = channel.run(dict(action='send', sessionID=SID, text='hello'))
            self.assertEqual(result['outcome'], 'uncertain')
            self.assertEqual(exchange.call_count, 1)

    def test_missing_channel_has_setup_state(self):
        with patch.object(Path, 'exists', return_value=False):
            self.assertEqual(channel.run(dict(action='check', sessionID=SID))['outcome'], 'setupRequired')

    def test_channel_history_is_visible_and_matches_sent_text(self):
        message = {'type': 'user', 'isMeta': True, 'message': {'content': '<channel source="runhuddle" message_id="abc">\nLook at /tmp/image.png\n</channel>'}}
        self.assertEqual(claude_bridge.message(message), ('user', 'Look at /tmp/image.png'))
        message['message']['content'] = '<channel source="other">\nNot our message\n</channel>'
        self.assertIsNone(claude_bridge.message(message))

    def test_packets_are_bounded(self):
        for raw in [b'{}', b'[]\n', b'x' * (channel.MAX_PACKET + 1)]:
            with self.assertRaises(ValueError): channel.read_packet(io.BytesIO(raw))

    def test_stdio_and_private_socket_end_to_end(self):
        with tempfile.TemporaryDirectory(prefix='rh-channel-', dir='/tmp') as home:
            script = ('import sys; sys.path.insert(0, sys.argv[1]); import claude_bridge, claude_channel; '
                      'claude_bridge.owner=lambda: {"pid": 42}; claude_channel.eligibility=lambda *a: None; '
                      'claude_channel.serve(sys.argv[2])')
            env = dict(os.environ, HOME=home)
            proc = subprocess.Popen([sys.executable, '-c', script, str(Path(channel.__file__).parent), SID],
                                    env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                with patch.dict(os.environ, HOME=home):
                    path = channel.socket_path(SID)
                    for _ in range(100):
                        if path.exists(): break
                        time.sleep(.02)
                    self.assertTrue(path.exists())
                    self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                    self.assertEqual(path.parent.stat().st_mode & 0o777, 0o700)
                    def rpc(value):
                        proc.stdin.write((json.dumps(value) + '\n').encode()); proc.stdin.flush()
                    rpc(dict(jsonrpc='2.0', id=1, method='initialize', params={'protocolVersion': '2025-03-26'}))
                    reply = json.loads(proc.stdout.readline())
                    self.assertIn('claude/channel', reply['result']['capabilities']['experimental'])
                    rpc(dict(jsonrpc='2.0', method='notifications/initialized'))
                    for _ in range(100):
                        result = channel.run(dict(action='check', sessionID=SID))
                        if result['outcome'] == 'ready': break
                        time.sleep(.01)
                    self.assertEqual(result['outcome'], 'ready')
                    result = session_reply.run(dict(provider='Claude', action='send', sessionID=SID, executable='/bin/unused', text='Integration test'))
                    self.assertEqual(result['outcome'], 'forwarded')
                    notification = json.loads(proc.stdout.readline())
                    self.assertEqual(notification['method'], 'notifications/claude/channel')
                    rpc(dict(jsonrpc='2.0', id=2, method='tools/call', params={'name': 'acknowledge', 'arguments': {'message_id': result['messageID']}}))
                    self.assertFalse(json.loads(proc.stdout.readline())['result']['isError'])
                    self.assertEqual(channel.run(dict(action='check', sessionID=SID))['receivedIDs'], [result['messageID']])
                    proc.stdin.close(); proc.wait(timeout=5)
                    self.assertFalse(path.exists())
                    self.assertEqual(proc.returncode, 0, proc.stderr.read().decode())
            finally:
                if proc.poll() is None: proc.kill(); proc.wait()
                for pipe in (proc.stdin, proc.stdout, proc.stderr):
                    pipe.close()


if __name__ == '__main__':
    unittest.main()
