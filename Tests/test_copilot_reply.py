import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import copilot_reply as reply
SID = 'f969eaa9-9a38-4d55-ad10-5de07c5b4149'
class CopilotReplyTests(unittest.TestCase):
    def test_install_idempotent_and_preserves_foreign_file(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(reply, 'HOME', Path(temp)):
            self.assertEqual(reply.install()['outcome'], 'installed')
            self.assertEqual(reply.install()['outcome'], 'installed')
            file = Path(temp) / 'extensions/runhuddle-replies/bridge.mjs'
            file.write_text('foreign content')
            with self.assertRaises(ValueError): reply.install()
            self.assertEqual(file.read_text(), 'foreign content')
    def test_duplicate_connection_never_sends(self):
        with patch.object(reply, 'candidates', return_value=[('a', {}), ('b', {})]), patch.object(reply, 'exchange') as send:
            self.assertEqual(reply.run({'sessionID': SID, 'action':'send'})['outcome'], 'unavailable')
            send.assert_not_called()
    def test_unconfirmed_send_never_retries(self):
        status = {'outcome':'ready', 'ownerPID':123, 'extensionPID':124}
        with patch.object(reply, 'candidates', return_value=[('a',status)]), patch('copilot_bridge.snapshot', return_value=[{'sessionID':SID,'state':'idle','agentPID':123}]), patch.object(reply, 'exchange', side_effect=OSError()) as send:
            self.assertEqual(reply.run({'sessionID':SID,'action':'send','text':'hi'})['outcome'], 'uncertain')
            self.assertEqual(send.call_count,1)
    def test_identity_requires_exact_process_parent_and_session(self):
        result={'sessionID':SID,'protocol':1,'ownerPID':123,'extensionPID':124}
        with patch.object(reply,'process_info',side_effect=lambda pid: (123,'start','node') if pid==124 else (1,'start','/opt/homebrew/bin/copilot')):
            self.assertTrue(reply.identity_valid(result,SID))
            self.assertFalse(reply.identity_valid(result,'other'))
        with patch.object(reply,'process_info',return_value=(999,'start','node')):
            self.assertFalse(reply.identity_valid(result,SID))
    def test_new_launch_installs_and_quotes_exact_session(self):
        import shlex
        with patch.object(reply, 'install') as install:
            result=reply.prepare_launch({'sessionID':SID,'executable':sys.executable,'resume':False})
            self.assertEqual(shlex.split(result['message']),[sys.executable,'--experimental','--session-id',SID])
            install.assert_called_once()
    def test_reconnect_never_stops_busy_session(self):
        with patch.object(reply,'install'), patch('copilot_bridge.snapshot',return_value=[{'sessionID':SID,'state':'working'}]), patch.object(reply.os,'kill') as kill:
            with self.assertRaises(ValueError): reply.prepare_launch({'sessionID':SID,'executable':sys.executable,'resume':True})
            kill.assert_not_called()
    def test_saved_reconnect_preserves_id_without_killing(self):
        with patch.object(reply,'install'), patch('copilot_bridge.snapshot',return_value=[{'sessionID':SID,'state':'saved'}]), patch.object(reply.os,'kill') as kill:
            result=reply.prepare_launch({'sessionID':SID,'executable':sys.executable,'resume':True})
            self.assertIn(SID,result['message']);kill.assert_not_called()
    def test_idle_reconnect_stops_only_verified_pid_then_resumes(self):
        import json
        from contextlib import contextmanager
        from unittest.mock import Mock
        identity={'pid':123,'start':'original'}
        db=Mock();db.execute.return_value.fetchone.return_value=(json.dumps({'identity':identity}),)
        @contextmanager
        def database(): yield db
        with patch.object(reply,'install'), patch('copilot_bridge.snapshot',return_value=[{'sessionID':SID,'state':'idle','agentPID':123}]), patch('copilot_bridge.database',database), patch('copilot_bridge.live',return_value=True), patch.object(reply,'process_info',side_effect=[(1,'original','copilot'),None]), patch.object(reply.os,'kill') as kill:
            result=reply.prepare_launch({'sessionID':SID,'executable':sys.executable,'resume':True})
            kill.assert_called_once_with(123,reply.signal.SIGTERM)
            self.assertEqual(result['outcome'],'setup');self.assertIn(SID,result['message'])
