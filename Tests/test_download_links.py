import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('download_links', ROOT / 'scripts/update-download-links.py')
links = importlib.util.module_from_spec(spec)
spec.loader.exec_module(links)


class DownloadLinksTests(unittest.TestCase):
    def test_releases_link_survives_new_versions(self):
        original_root = links.ROOT
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            links.ROOT = root
            (root / 'docs').mkdir()
            for name in ['README.md', 'docs/GETTING_STARTED.md']:
                (root / name).write_text(f'Before\n{links.START}\nold\n{links.END}\nAfter\n')
            try:
                for version in ['0.36.1', '1.0.0']:
                    feed = root / 'feed.xml'
                    feed.write_text(f'<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><item><sparkle:shortVersionString>{version}</sparkle:shortVersionString><enclosure url="https://github.com/rootsignal/runhuddle/releases/download/v{version}/RunHuddle-{version}-arm64.dmg"/></item></channel></rss>')
                    links.update(feed)
                    for name in ['README.md', 'docs/GETTING_STARTED.md']:
                        text = (root / name).read_text()
                        self.assertIn('(https://runhuddle.rootsignal.io/download)', text)
                        self.assertNotIn('/releases/download/', text)
                        self.assertTrue(text.startswith('Before\n'))
                        self.assertTrue(text.endswith('After\n'))
                before = (root / 'README.md').read_text()
                feed.write_text(feed.read_text().replace('https://github.com/rootsignal/runhuddle/releases/download/', 'https://example.invalid/'))
                with self.assertRaises(ValueError):
                    links.update(feed)
                self.assertEqual(before, (root / 'README.md').read_text())
            finally:
                links.ROOT = original_root


if __name__ == '__main__':
    unittest.main()
