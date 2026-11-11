import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from session_storage import transcript_storage


class SessionStorageTests(unittest.TestCase):
    def test_sizes_identity_and_growth(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'events.jsonl'
            path.write_bytes(b'hello')
            info = transcript_storage(path)
            self.assertEqual(info['bytes'], 5)
            self.assertEqual(info['allocatedBytes'], path.stat().st_blocks * 512)
            alias = Path(folder) / 'alias'
            alias.hardlink_to(path)
            self.assertEqual(info['fileID'], transcript_storage(alias)['fileID'])
            path.write_bytes(b'hello world')
            self.assertEqual(transcript_storage(path)['bytes'], 11)
            path.unlink()
            self.assertIsNone(transcript_storage(path))

    def test_unavailable_and_empty(self):
        self.assertIsNone(transcript_storage(None))
        with tempfile.TemporaryDirectory() as folder:
            self.assertIsNone(transcript_storage(folder))
            path = Path(folder) / 'empty'
            path.touch()
            self.assertEqual(transcript_storage(path)['bytes'], 0)
