"""Count observed compaction events incrementally; never infer from token drops.

Cache holds offsets/counts only. A replaced/truncated transcript resets the scan.
Counts describe available records, not guaranteed lifetime totals.
"""
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3

CACHE = Path(os.environ.get('RUNHUDDLE_COMPACTION_CACHE', Path.home() / 'Library/Application Support/Agent Session Manager/compactions.sqlite'))


def marker(event, provider):
    if not isinstance(event, dict):
        return None
    payload = event.get('payload') or {}
    if provider == 'Codex':
        if event.get('type') == 'compacted':
            return 'primary'
        if isinstance(payload, dict) and payload.get('type') == 'context_compacted':
            return 'fallback'
    if provider == 'Claude' and event.get('type') == 'system' and event.get('subtype') == 'compact_boundary':
        return 'primary'
    data = event.get('data') or {}
    if provider == 'Copilot' and event.get('type') == 'session.compaction_complete' and isinstance(data, dict) and data.get('success') is True:
        return 'primary'
    return None


def read_compactions(path, provider):
    if not path:
        return None
    try:
        path = Path(path)
        with path.open('rb') as file:
            stat = os.fstat(file.fileno())
            head = file.read(min(stat.st_size, 256))
            signature = [stat.st_dev, stat.st_ino, hashlib.sha256(head).hexdigest()]
            CACHE.parent.mkdir(parents=True, exist_ok=True)
            with closing(sqlite3.connect(CACHE, timeout=0.2)) as db, db:
                db.execute('CREATE TABLE IF NOT EXISTS counts (key TEXT PRIMARY KEY, data TEXT NOT NULL)')
                key = provider + ':' + str(path)
                old = db.execute('SELECT data FROM counts WHERE key=?', (key,)).fetchone()
                saved = json.loads(old[0]) if old else {}
                valid = saved.get('signature') == signature and saved.get('offset', 0) <= stat.st_size
                if valid and saved.get('size') == stat.st_size and saved.get('mtime') == stat.st_mtime_ns:
                    return saved['result']
                # Same-size rewrites cannot be treated as appends.
                if saved.get('size') == stat.st_size and saved.get('mtime') != stat.st_mtime_ns:
                    valid = False
                offset = saved.get('offset', 0) if valid else 0
                primary = saved.get('primary', 0) if valid else 0
                fallback = saved.get('fallback', 0) if valid else 0
                file.seek(offset)
                while True:
                    line = file.readline()
                    if not line or not line.endswith(b'\n'):
                        break  # Leave a partially written event for the next scan.
                    offset = file.tell()
                    try:
                        kind = marker(json.loads(line), provider)
                    except (ValueError, UnicodeDecodeError):
                        continue
                    primary += kind == 'primary'
                    fallback += kind == 'fallback'
                # Codex can record both representations of the same compaction.
                count = primary if primary else fallback
                result = {'count': count, 'source': provider + ' recorded compaction events; available history only'}
                saved = dict(signature=signature, offset=offset, size=stat.st_size, mtime=stat.st_mtime_ns,
                             primary=primary, fallback=fallback, result=result)
                db.execute('INSERT OR REPLACE INTO counts VALUES (?,?)', (key, json.dumps(saved)))
                return result
    except (OSError, ValueError, sqlite3.Error):
        return None
