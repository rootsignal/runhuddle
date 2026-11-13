import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import local_cleanup as cleanup
import claude_bridge


class LocalCleanupTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.history = self.root / 'projects/repo/example.jsonl'
        self.history.parent.mkdir(parents=True)
        self.history.write_text('{"type":"user","message":{"content":"hello"}}\n')
        patcher = patch.multiple(claude_bridge, HOME=self.root, STATE=self.root / 'tracker.sqlite')
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_confirmed_closed_and_changed_history(self):
        with patch.object(claude_bridge, 'cli_sessions', return_value=[]):
            first = cleanup.plan('Claude', 'example')
            self.assertEqual(first['paths'], [str(self.history)])
            self.history.write_text(self.history.read_text() + '{}\n')
            self.assertNotEqual(first['fingerprint'], cleanup.plan('Claude', 'example')['fingerprint'])
        self.assertTrue(self.history.exists())  # review never removes history

    def test_closed_tracking_entry_without_transcript(self):
        self.history.unlink()
        with patch.object(claude_bridge, 'snapshot', return_value=[{'sessionID': 'example', 'state': 'saved'}]):
            empty = cleanup.plan('Claude', 'example')
            self.assertEqual(empty['paths'], [])
            # A transcript appearing after review must invalidate the plan.
            self.history.write_text('{}\n')
            self.assertNotEqual(empty['fingerprint'], cleanup.plan('Claude', 'example')['fingerprint'])

    def test_missing_transcript_still_reviews_companion_directory(self):
        self.history.unlink()
        companion = self.history.with_suffix('')
        companion.mkdir()
        (companion / 'child.jsonl').write_text('{}\n')
        with patch.object(claude_bridge, 'snapshot', return_value=[{'sessionID': 'example', 'state': 'saved'}]):
            self.assertEqual(cleanup.plan('Claude', 'example')['paths'], [str(companion)])

    def test_unknown_or_running_cannot_be_removed(self):
        with patch.object(claude_bridge, 'cli_sessions', return_value=None):
            with self.assertRaises(ValueError):
                cleanup.plan('Claude', 'example')
        with patch.object(claude_bridge, 'snapshot', return_value=[{'sessionID': 'example', 'state': 'idle'}]):
            with self.assertRaises(ValueError):
                cleanup.plan('Claude', 'example')

    def test_symlinks_and_outside_files_rejected(self):
        outside = self.root / 'repository.txt'
        outside.write_text('keep')
        with self.assertRaises(ValueError):
            cleanup.fingerprint(self.history.parent, [outside])
        link = self.history.parent / 'link'
        link.symlink_to(outside)
        with self.assertRaises(ValueError):
            cleanup.fingerprint(self.history.parent, [link])
        with self.assertRaises(ValueError):
            cleanup.targets('Copilot', '../repo')
        self.assertEqual(outside.read_text(), 'keep')
