#!/usr/bin/env python3
"""Local FTS index of recorded user/assistant messages. Never sends model requests."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from app_support import prepare_storage
import re
import sqlite3
from codex_bridge import Client, list_rows
from copilot_bridge import HOME as COPILOT_HOME
from claude_bridge import paths as claude_paths, message as claude_message

INDEX = Path.home() / 'Library/Application Support/RunHuddle/history-search.sqlite'


def initialize(db):
    db.execute('CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, path TEXT, inode INTEGER, offset INTEGER, stamp INTEGER, prefix TEXT)')
    db.execute('CREATE VIRTUAL TABLE IF NOT EXISTS messages USING fts5(session UNINDEXED, role UNINDEXED, body, tokenize="unicode61")')


def message(event, provider):
    if not isinstance(event, dict):
        return None
    if provider == 'Claude':
        return claude_message(event)
    if provider == 'Codex':
        data = event.get('payload')
        if event.get('type') != 'response_item' or not isinstance(data, dict) or data.get('type') != 'message':
            return None
        role = data.get('role')
        parts = data.get('content') or []
        body = '\n'.join(p.get('text', '') for p in parts if isinstance(p, dict) and isinstance(p.get('text'), str))
    else:
        kind = event.get('type')
        if kind not in ('user.message', 'assistant.message'):
            return None
        role = kind.split('.')[0]
        data = event.get('data') or {}
        body = data.get('content') if isinstance(data, dict) else None
    if role in ('user', 'assistant') and isinstance(body, str) and body.strip():
        return role, body
    return None


def index_file(db, identifier, path):
    provider = identifier.split(':', 1)[0]
    stat = path.stat()
    old = db.execute('SELECT path,inode,offset,stamp,prefix FROM files WHERE id=?', (identifier,)).fetchone()
    if old and old[0] == str(path) and old[1] == stat.st_ino and old[2] == stat.st_size and old[3] == stat.st_mtime_ns:
        return
    with path.open('rb') as file:
        prefix = hashlib.sha256(file.read(min(512, old[2] if old else 512))).hexdigest()
        append = old and old[0] == str(path) and old[1] == stat.st_ino and old[2] < stat.st_size and old[4] == prefix
        offset = old[2] if append else 0
        if not append:
            db.execute('DELETE FROM messages WHERE session=?', (identifier,))
        file.seek(offset)
        while True:
            # A growing final line is left for the next refresh.
            line = file.readline()
            if not line or not line.endswith(b'\n'):
                break
            offset = file.tell()
            try:
                item = message(json.loads(line), provider)
            except (ValueError, UnicodeDecodeError):
                continue
            if item:
                db.execute('INSERT INTO messages(session,role,body) VALUES (?,?,?)', (identifier, *item))
        file.seek(0)
        prefix = hashlib.sha256(file.read(min(512, offset))).hexdigest()
    db.execute('INSERT OR REPLACE INTO files VALUES (?,?,?,?,?,?)',
               (identifier, str(path), stat.st_ino, offset, stat.st_mtime_ns, prefix))


def search(db, query):
    words = re.findall(r'\w+', query, flags=re.UNICODE)[:20]
    if not words:
        return []
    expression = ' AND '.join('"' + word + '"' for word in words)
    rows = db.execute("SELECT session,role,snippet(messages,2,'[',']',' … ',36),bm25(messages) FROM messages WHERE messages MATCH ? ORDER BY bm25(messages) LIMIT 1000", (expression,))
    results, seen = [], set()
    for sid, role, excerpt, _ in rows:
        if sid not in seen:
            results.append({'id': sid, 'role': role, 'excerpt': excerpt})
            seen.add(sid)
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['search'])
    parser.add_argument('query')
    args = parser.parse_args()
    sources, complete, warnings = {}, set(), []
    try:
        with Client() as client:
            rows = list_rows(client) + list_rows(client, archived=True, include_children=True)
        sources.update({'Codex:' + row['id']: Path(row['path']) for row in rows if row.get('path')})
        complete.add('Codex')
    except Exception:
        warnings.append('Codex unavailable; searching its cached history.')
    sources.update({'Copilot:' + p.parent.name: p for p in (COPILOT_HOME / 'session-state').glob('*/events.jsonl')})
    complete.add('Copilot')
    sources.update({'Claude:' + sid: path for sid, path in claude_paths().items()})
    complete.add('Claude')
    prepare_storage(INDEX)
    with sqlite3.connect(INDEX, timeout=10) as db:
        initialize(db)
        os.chmod(INDEX, 0o600)
        for identifier, path in sources.items():
            try:
                with db:
                    index_file(db, identifier, path)
            except (OSError, ValueError):
                warnings.append('Some transcripts could not be refreshed; cached results may be incomplete.')
        for (sid,) in db.execute('SELECT id FROM files').fetchall():
            if sid.split(':', 1)[0] in complete and sid not in sources:
                db.execute('DELETE FROM messages WHERE session=?', (sid,))
                db.execute('DELETE FROM files WHERE id=?', (sid,))
        count = db.execute('SELECT COUNT(*) FROM files').fetchone()[0]
        print(json.dumps({'matches': search(db, args.query), 'indexedSessions': count, 'warning': ' '.join(dict.fromkeys(warnings))}))


if __name__ == '__main__':
    main()
