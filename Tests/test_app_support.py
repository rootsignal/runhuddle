import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import app_support


class StorageMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.parent = Path(self.temp.name)
        self.old = self.parent / 'Agent Session Manager'
        self.new = self.parent / 'RunHuddle'

    def test_fresh_install_and_repeated_start(self):
        self.assertEqual(app_support.migrate_storage(self.parent), self.new)
        self.assertEqual(app_support.migrate_storage(self.parent), self.new)
        self.assertFalse(self.old.exists())

    def test_merges_without_touching_terminals_or_attachments(self):
        self.old.mkdir(); self.new.mkdir()
        (self.new / 'Terminal Attachments').mkdir()
        (self.new / 'terminals.json').write_text('terminal-state')
        db = sqlite3.connect(self.old / 'sessions.sqlite')
        db.execute('CREATE TABLE notes (body TEXT)')
        db.execute("INSERT INTO notes VALUES ('keep me')")
        db.commit(); db.close()
        app_support.migrate_storage(self.parent)
        self.assertFalse(self.old.exists())
        with sqlite3.connect(self.new / 'sessions.sqlite') as db:
            self.assertEqual(db.execute('SELECT body FROM notes').fetchone()[0], 'keep me')
        self.assertEqual((self.new / 'terminals.json').read_text(), 'terminal-state')
        self.assertTrue((self.new / 'Terminal Attachments').is_dir())

    def test_conflict_moves_nothing(self):
        self.old.mkdir(); self.new.mkdir()
        (self.old / 'sessions.sqlite').write_text('old')
        (self.old / 'notes').write_text('keep')
        (self.new / 'sessions.sqlite').write_text('new')
        with self.assertRaisesRegex(RuntimeError, 'conflicting'):
            app_support.migrate_storage(self.parent)
        self.assertEqual((self.old / 'notes').read_text(), 'keep')
        self.assertEqual((self.new / 'sessions.sqlite').read_text(), 'new')

    def test_open_database_blocks_migration(self):
        self.old.mkdir()
        db = sqlite3.connect(self.old / 'sessions.sqlite')
        try:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('CREATE TABLE notes (body TEXT)')
            db.commit()
            with self.assertRaisesRegex(RuntimeError, 'Close the older'):
                app_support.migrate_storage(self.parent)
            self.assertTrue((self.old / 'sessions.sqlite').exists())
            self.assertFalse((self.new / 'sessions.sqlite').exists())
        finally:
            db.close()
        app_support.migrate_storage(self.parent)

    def test_inspection_failure_leaves_data_alone(self):
        self.old.mkdir(); (self.old / 'notes').write_text('keep')
        with patch('app_support.subprocess.run', return_value=subprocess.CompletedProcess([], 1, '', 'permission denied')):
            with self.assertRaises(RuntimeError):
                app_support.migrate_storage(self.parent)
        self.assertEqual((self.old / 'notes').read_text(), 'keep')

    def test_override_does_not_migrate_real_storage(self):
        with patch('app_support.migrate_storage') as migration:
            app_support.prepare_storage(self.parent / 'custom' / 'cache.sqlite')
        migration.assert_not_called()
        self.assertTrue((self.parent / 'custom').is_dir())


if __name__ == '__main__':
    unittest.main()
