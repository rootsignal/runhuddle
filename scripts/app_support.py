"""RunHuddle storage location and non-destructive migration from older builds."""
from pathlib import Path
import fcntl
import os
import subprocess


def support_directory():
    return Path.home() / 'Library/Application Support/RunHuddle'


def migrate_storage(parent=None):
    parent = Path(parent) if parent is not None else support_directory().parent
    destination = parent / 'RunHuddle'
    legacy = parent / 'Agent Session Manager'
    if destination.is_symlink() or legacy.is_symlink():
        raise RuntimeError('Storage migration requires real directories, not symbolic links.')
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (destination / '.storage-migration.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if not legacy.exists():
            return destination
        entries = list(legacy.iterdir())
        if any(os.path.lexists(destination / item.name) for item in entries):
            raise RuntimeError('Storage migration found conflicting files. Existing data was left untouched.')
        # SQLite WAL and SHM files must move with the database after its writers exit.
        result = subprocess.run(['/usr/sbin/lsof', '-t', '+D', str(legacy)],
                                capture_output=True, text=True, timeout=15)
        if result.stdout.strip() or result.returncode not in (0, 1) or result.stderr.strip():
            raise RuntimeError('Close the older RunHuddle app and its tracking processes, then reopen RunHuddle to migrate local storage.')
        for item in entries:
            item.rename(destination / item.name)
        legacy.rmdir()  # Never recursively remove user data.
    return destination


def prepare_storage(path):
    path = Path(path)
    if path.parent == support_directory():
        migrate_storage()
    else:
        # Explicit provider/cache overrides retain their existing behavior.
        path.parent.mkdir(parents=True, exist_ok=True)


if __name__ == '__main__':
    try:
        print(migrate_storage())
    except Exception as error:
        import sys
        print(str(error), file=sys.stderr)
        sys.exit(1)
