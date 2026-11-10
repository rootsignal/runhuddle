import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from bundle_runtime import download


class DownloadTests(unittest.TestCase):
    def test_verified_atomic_download(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'cached.tar.gz'
            def curl(args, **kwargs):
                self.assertEqual(args[0:2], ['/usr/bin/curl', '--disable'])
                self.assertNotIn('--insecure', args)
                self.assertEqual(args[args.index('--proto-redir') + 1], '=https')
                Path(args[args.index('--output') + 1]).write_bytes(b'verified')
            with patch('bundle_runtime.subprocess.run', side_effect=curl):
                download('https://example.com/archive', target, hashlib.sha256(b'verified').hexdigest())
            self.assertEqual(target.read_bytes(), b'verified')
            self.assertEqual(list(Path(folder).iterdir()), [target])

    def test_failed_or_corrupt_download_preserves_cache(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'cache'
            target.write_bytes(b'original')
            def corrupt(args, **kwargs):
                Path(args[args.index('--output') + 1]).write_bytes(b'bad')
            with patch('bundle_runtime.subprocess.run', side_effect=corrupt):
                with self.assertRaises(RuntimeError):
                    download('https://example.com/archive', target, '0' * 64)
            with patch('bundle_runtime.subprocess.run', side_effect=subprocess.CalledProcessError(60, 'curl')):
                with self.assertRaises(subprocess.CalledProcessError):
                    download('https://example.com/archive', target)
            self.assertEqual(target.read_bytes(), b'original')
            self.assertEqual(list(Path(folder).iterdir()), [target])

    def test_plain_http_rejected(self):
        with self.assertRaises(ValueError):
            download('http://example.com/file', Path('/unused'))
