import sys
import subprocess
import unittest
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from session_reply import run

SID = '11111111-1111-4111-8111-111111111111'
class Client:
    def __init__(self, state='idle', flags=None, loaded=True, identity=SID):
        self.state, self.flags, self.loaded, self.identity = state, flags or [], loaded, identity
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def request(self, method, args):
        if method == 'thread/loaded/list': return {'data': [SID] if self.loaded else []}
        return {'thread': {'id': self.identity, 'status': {'type': self.state, 'activeFlags': self.flags}}}

class ReplyTests(unittest.TestCase):
    def perform(self, client=None, text='hello', provider='Codex', receipt=None, error=None, action='send', help_text='--thread --message'):
        calls = []
        def runner(argv, **kwargs):
            calls.append(argv)
            if argv[-1] == '--help': return SimpleNamespace(returncode=0, stdout=help_text)
            if error: raise error
            return SimpleNamespace(returncode=0, stdout=receipt if receipt is not None else f'Queued message aaaa-bbbb for thread {SID}.')
        result = run({'sessionID': SID, 'executable': '/codex', 'text': text, 'provider': provider, 'action': action}, lambda: client or Client(), runner)
        return result, calls
    def test_exact_session_and_literal_text(self):
        text = "$(touch nope)\n'hello' & 🚀"
        result, calls = self.perform(text=text)
        self.assertEqual(result['outcome'], 'queued')
        self.assertEqual(calls[-1], ['/codex', 'queue', '--thread', SID, '--message', text])
    def test_check_never_sends(self):
        result, calls = self.perform(action='check')
        self.assertEqual(result['outcome'], 'ready'); self.assertEqual(len(calls), 1)
    def test_working_can_queue(self):
        self.assertEqual(self.perform(client=Client(state='active'))[0]['outcome'], 'queued')
    def test_pending_requests_and_unloaded_or_wrong_session_never_send(self):
        for client in [Client(flags=['waitingOnApproval']), Client(flags=['waitingOnUserInput']), Client(loaded=False), Client(identity='other'), Client(state='notLoaded')]:
            result, calls = self.perform(client=client)
            self.assertEqual(result['outcome'], 'unavailable'); self.assertEqual(len(calls), 1)
    def test_unsupported_agent_or_message_never_launches(self):
        for args in [{'provider':'Claude'}, {'provider':'Copilot'}, {'text':' '}, {'text':'\0'}, {'text':'🚀'*8001}]:
            result, calls = self.perform(**args)
            self.assertNotEqual(result['outcome'], 'queued'); self.assertEqual(calls, [])
    def test_old_cli_never_sends(self):
        result, calls = self.perform(help_text='unknown command')
        self.assertEqual(result['outcome'], 'unavailable'); self.assertEqual(len(calls), 1)
    def test_bad_receipts_are_uncertain_and_never_retry(self):
        for receipt in ['', 'ok', 'Queued message abc for thread other.']:
            result, calls = self.perform(receipt=receipt)
            self.assertEqual(result['outcome'], 'uncertain'); self.assertEqual(len(calls), 2)
    def test_timeout_is_uncertain_and_never_retry(self):
        result, calls = self.perform(error=subprocess.TimeoutExpired('queue',20))
        self.assertEqual(result['outcome'], 'uncertain'); self.assertEqual(len(calls), 2)
