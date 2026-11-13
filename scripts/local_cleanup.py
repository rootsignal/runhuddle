"""Review and revalidate local history targets. Moving files to Trash is performed by the Mac app."""
import argparse
import hashlib
import json
from pathlib import Path
from app_support import prepare_storage
import sqlite3
import stat
import claude_bridge
import copilot_bridge


def targets(provider, sid):
    if not sid or Path(sid).name != sid or sid in ('.', '..'):
        raise ValueError('Invalid session ID')
    if provider == 'Claude':
        root = claude_bridge.HOME / 'projects'
        transcript = claude_bridge.paths().get(sid)
        if transcript is None:
            # Closed hook-only sessions may never create a transcript. Include any
            # companion directories so they are still reviewed and validated.
            paths = sorted(project / sid for project in root.glob('*')
                           if (project / sid).exists() or (project / sid).is_symlink())
        else:
            paths = [transcript, transcript.with_suffix('')]
    elif provider == 'Copilot':
        root = copilot_bridge.HOME / 'session-state'
        paths = [root / sid]
    else:
        raise ValueError('Unsupported history provider')
    return root, [p for p in paths if p.exists() or p.is_symlink()]


def fingerprint(root, paths):
    manifest = []
    for target in paths:
        if target.is_symlink() or not target.resolve().is_relative_to(root.resolve()) or target.resolve() == root.resolve():
            raise ValueError('History target is a symlink or outside the expected session directory.')
        entries = [target] + (sorted(target.rglob('*')) if target.is_dir() else [])
        for path in entries:
            info = path.lstat()
            if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
                raise ValueError('History contains a symlink or special file; automatic removal is unavailable.')
            manifest.append([str(path), info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns])
    return hashlib.sha256(json.dumps(manifest).encode()).hexdigest()


def plan(provider, sid):
    adapter = claude_bridge if provider == 'Claude' else copilot_bridge if provider == 'Copilot' else None
    if adapter is None:
        raise ValueError('Unsupported provider')
    row = next((row for row in adapter.snapshot() if row['sessionID'] == sid), None)
    if not row or row['state'] != 'saved':
        raise ValueError('Session must be confirmed closed before its history can be moved to Trash.')
    if provider == 'Copilot' and copilot_bridge.has_open_cli(copilot_bridge.HOME / 'session-state' / sid):
        raise ValueError('Copilot still has this session open.')
    root, paths = targets(provider, sid)
    if not paths and provider != 'Claude':
        raise ValueError('No session history files were found.')
    return {'provider': provider, 'sessionID': sid, 'paths': [str(p) for p in paths], 'fingerprint': fingerprint(root, paths)}


def forget(provider, sid):
    adapter = claude_bridge if provider == 'Claude' else copilot_bridge if provider == 'Copilot' else None
    # Only tracker-owned caches are removed, never provider indexes or repository files.
    if adapter is not None:
        with adapter.database() as db:
            db.execute('DELETE FROM states WHERE id=?', (sid,))
            if provider == 'Claude':
                db.execute('DELETE FROM discovered WHERE id=?', (sid,))
    index = Path.home() / 'Library/Application Support/RunHuddle/history-search.sqlite'
    prepare_storage(index)
    if index.exists():
        db = sqlite3.connect(index, timeout=5)
        try:
            with db:
                db.execute('DELETE FROM messages WHERE session=?', (provider + ':' + sid,))
                db.execute('DELETE FROM files WHERE id=?', (provider + ':' + sid,))
        finally:
            db.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['plan', 'validate', 'forget'])
    parser.add_argument('provider', choices=['Claude', 'Copilot', 'Codex'])
    parser.add_argument('session_id')
    parser.add_argument('--expected')
    args = parser.parse_args()
    if args.command == 'forget':
        forget(args.provider, args.session_id)
        print('{}')
    else:
        result = plan(args.provider, args.session_id)
        if args.command == 'validate' and result['fingerprint'] != args.expected:
            raise ValueError('History changed since review. Review a new cleanup plan.')
        print(json.dumps(result))


if __name__ == '__main__':
    main()
