"""Read explicit agent checklists. Never infer progress from prose or run agent tools."""
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
from app_support import prepare_storage
import sqlite3

CACHE = Path(os.environ.get('RUNHUDDLE_PLAN_CACHE', Path.home() / 'Library/Application Support/RunHuddle/plans.sqlite'))
STATUSES = {'pending': 'pending', 'in_progress': 'inProgress', 'inProgress': 'inProgress', 'completed': 'completed', 'blocked': 'blocked'}
MAX_STEPS = 200


def normalize(items, source, stamp, text_key='step'):
    if not isinstance(items, list) or len(items) > MAX_STEPS:
        return None
    steps = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            return None
        raw_status = item.get('status')
        text, status = item.get(text_key), STATUSES.get(raw_status) if isinstance(raw_status, str) else None
        if not isinstance(text, str) or not text.strip() or not status:
            return None
        steps.append({'id': str(item.get('id', index)), 'text': text.strip()[:1000], 'status': status})
    return {'steps': steps, 'source': source, 'reportedAt': stamp if isinstance(stamp, str) else '', 'newerRequest': False}


def apply_event(state, event, provider):
    if not isinstance(event, dict) or event.get('isSidechain') or event.get('agentId'):
        return
    stamp = event.get('timestamp', '')
    payload = event.get('payload') or {}
    if provider == 'Codex':
        if not isinstance(payload, dict):
            return
        if event.get('type') == 'event_msg' and payload.get('type') == 'user_message':
            if state.get('result'): state['result']['newerRequest'] = True
        if event.get('type') == 'event_msg' and payload.get('type') == 'plan_update':
            result = normalize(payload.get('plan'), 'Codex plan', stamp)
            if result is not None: state['result'] = result
        if event.get('type') != 'response_item':
            return
        if payload.get('type') == 'function_call' and payload.get('name') == 'update_plan':
            try: args = json.loads(payload.get('arguments', ''))
            except (ValueError, TypeError): return
            if isinstance(args, dict):
                result = normalize(args.get('plan'), 'Codex plan', stamp)
                if result is not None and isinstance(payload.get('call_id'), str):
                    state.setdefault('pending', {})[payload['call_id']] = result
        elif payload.get('type') == 'function_call_output':
            result = state.setdefault('pending', {}).pop(payload.get('call_id'), None)
            # The native update_plan handler's successful acknowledgment.
            if result is not None and payload.get('output') == 'Plan updated':
                result['reportedAt'] = stamp
                state['result'] = result
    elif provider == 'Claude':
        message = event.get('message') or {}
        blocks = message.get('content') if isinstance(message, dict) else None
        if event.get('type') == 'user' and (isinstance(blocks, str) or isinstance(blocks, list) and any(isinstance(b, dict) and b.get('type') == 'text' for b in blocks)):
            if state.get('result'): state['result']['newerRequest'] = True
        if not isinstance(blocks, list): return
        for block in blocks:
            if not isinstance(block, dict): continue
            if event.get('type') == 'assistant' and block.get('type') == 'tool_use' and block.get('name') == 'TodoWrite':
                args = block.get('input') or {}
                if not isinstance(args, dict): continue
                result = normalize(args.get('todos'), 'Claude checklist', stamp, 'content')
                if result is not None and isinstance(block.get('id'), str):
                    state.setdefault('pending', {})[block['id']] = result
            elif event.get('type') == 'user' and block.get('type') == 'tool_result':
                result = state.setdefault('pending', {}).pop(block.get('tool_use_id'), None)
                if result is not None and not block.get('is_error', False):
                    result['reportedAt'] = stamp
                    state['result'] = result
    # Bound unresolved calls when transcripts omit results.
    if len(state.get('pending', {})) > 32:
        state['pending'] = dict(list(state['pending'].items())[-32:])


def read_plan(path, provider, include_empty=False):
    if not path or provider not in ('Codex', 'Claude'): return None
    try:
        path = Path(path)
        with path.open('rb') as file:
            stat = os.fstat(file.fileno())
            signature = [stat.st_dev, stat.st_ino, hashlib.sha256(file.read(min(stat.st_size, 256))).hexdigest()]
            prepare_storage(CACHE)
            with closing(sqlite3.connect(CACHE, timeout=.2)) as db, db:
                os.chmod(CACHE, 0o600)
                db.execute('CREATE TABLE IF NOT EXISTS plans (key TEXT PRIMARY KEY, data TEXT NOT NULL)')
                key = provider + ':' + str(path)
                old = db.execute('SELECT data FROM plans WHERE key=?', (key,)).fetchone()
                saved = json.loads(old[0]) if old else {}
                valid = saved.get('signature') == signature and saved.get('offset', 0) <= stat.st_size
                if saved.get('size') == stat.st_size and saved.get('mtime') != stat.st_mtime_ns: valid = False
                if valid and saved.get('size') == stat.st_size and saved.get('mtime') == stat.st_mtime_ns and saved.get('complete'):
                    result = saved.get('result')
                    return result if result and (include_empty or result['steps']) else None
                state = saved if valid else {'offset': 0, 'pending': {}, 'result': None}
                file.seek(state['offset'])
                budget_end = state['offset'] + 16 * 1024 * 1024
                while file.tell() < budget_end:
                    line = file.readline(2 * 1024 * 1024)
                    if not line: break
                    if not line.endswith(b'\n'):
                        if len(line) == 2 * 1024 * 1024:
                            # Ignore oversized events rather than parsing their suffix as JSON.
                            while line and not line.endswith(b'\n'): line = file.readline(2 * 1024 * 1024)
                            if not line.endswith(b'\n'): break
                        else: break
                        state['offset'] = file.tell()
                        continue
                    state['offset'] = file.tell()
                    try: apply_event(state, json.loads(line), provider)
                    except (ValueError, TypeError, AttributeError): continue
                state.update(signature=signature, size=stat.st_size, mtime=stat.st_mtime_ns, complete=file.tell() >= stat.st_size)
                db.execute('INSERT OR REPLACE INTO plans VALUES (?,?)', (key, json.dumps(state)))
                result = state.get('result') if state['complete'] else None
                return result if result and (include_empty or result['steps']) else None
    except (OSError, ValueError, TypeError, sqlite3.Error):
        return None


def read_claude_tasks(home, session_id):
    """Only the exact session's task store; never guess a shared/team task-list ID."""
    if not isinstance(session_id, str) or not session_id or Path(session_id).name != session_id or session_id in ('.', '..'): return None
    folder = Path(home) / 'tasks' / session_id
    try:
        if not folder.is_dir(): return None
        paths = sorted(folder.glob('*.json'))
        if not paths or len(paths) > MAX_STEPS: return None
        items, latest = [], 0
        for path in paths:
            stat = path.stat()
            if stat.st_size > 128 * 1024: return None
            item = json.loads(path.read_text())
            if not isinstance(item, dict): return None
            if item.get('status') == 'deleted': continue
            items.append(item); latest = max(latest, stat.st_mtime)
        result = normalize(items, 'Claude session tasks', datetime.fromtimestamp(latest, timezone.utc).isoformat(), 'subject')
        return result if result and result['steps'] else None
    except (OSError, ValueError, TypeError): return None


def record_codex_plan(message):
    """Persist only an actual plan notification received by the passive observer."""
    if not isinstance(message, dict) or 'id' in message: return False
    if message.get('method') not in ('turn/plan/updated', 'turn/started'): return False
    params = message.get('params') or {}
    if not isinstance(params, dict) or not isinstance(params.get('threadId'), str): return False
    if message['method'] == 'turn/started':
        try:
            if not CACHE.exists(): return False
            with closing(sqlite3.connect(CACHE, timeout=.2)) as db, db:
                row = db.execute('SELECT data FROM live_plans WHERE id=?', (params['threadId'],)).fetchone()
                if not row: return False
                result = json.loads(row[0]); result['newerRequest'] = True
                db.execute('UPDATE live_plans SET data=? WHERE id=?', (json.dumps(result), params['threadId']))
            return True
        except (OSError, ValueError, sqlite3.Error): return False
    result = normalize(params.get('plan'), 'Codex plan', datetime.now(timezone.utc).isoformat())
    if result is None: return False
    try:
        prepare_storage(CACHE)
        with closing(sqlite3.connect(CACHE, timeout=.2)) as db, db:
            os.chmod(CACHE, 0o600)
            db.execute('CREATE TABLE IF NOT EXISTS live_plans (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
            db.execute('INSERT OR REPLACE INTO live_plans VALUES (?,?)', (params['threadId'], json.dumps(result)))
        return True
    except (OSError, sqlite3.Error): return False


def read_codex_plan(path, session_id):
    recorded = read_plan(path, 'Codex', include_empty=True)
    live = None
    try:
        if CACHE.exists():
            with closing(sqlite3.connect(CACHE, timeout=.2)) as db:
                row = db.execute('SELECT data FROM live_plans WHERE id=?', (session_id,)).fetchone()
                live = json.loads(row[0]) if row else None
    except (OSError, ValueError, sqlite3.Error): pass
    def stamp(plan):
        try: return datetime.fromisoformat(plan.get('reportedAt', '').replace('Z', '+00:00')).timestamp()
        except (ValueError, TypeError): return 0
    result = max((p for p in (recorded, live) if p is not None), key=stamp, default=None)
    return result if result and result['steps'] else None


def read_copilot_tasks(home, session_id, latest_request=None):
    """Read only the exact CLI session's todos table, never execute agent SQL."""
    if not isinstance(session_id, str) or not session_id or Path(session_id).name != session_id or session_id in ('.', '..'): return None
    path = Path(home) / 'session-state' / session_id / 'session.db'
    try:
        with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=.1)) as db:
            db.execute('PRAGMA query_only=ON')
            db.execute('PRAGMA trusted_schema=OFF')
            db.set_progress_handler(lambda: 1, 100000)
            rows = db.execute('SELECT id, title, status, updated_at FROM todos ORDER BY created_at, rowid LIMIT ?', (MAX_STEPS + 1,)).fetchall()
        if not rows or len(rows) > MAX_STEPS: return None
        statuses = {'pending': 'pending', 'in_progress': 'inProgress', 'done': 'completed', 'blocked': 'blocked'}
        items, stamps = [], []
        for identity, title, status, updated in rows:
            if status not in statuses: return None
            items.append({'id': identity, 'step': title, 'status': statuses[status]})
            if isinstance(updated, str):
                try:
                    date = datetime.fromisoformat(updated.replace('Z', '+00:00'))
                    stamps.append(date.replace(tzinfo=timezone.utc) if date.tzinfo is None else date)
                except ValueError: pass
        stamp = max(stamps).isoformat() if stamps else ''
        result = normalize(items, 'Copilot session tasks', stamp)
        if result and latest_request and stamp:
            try: result['newerRequest'] = datetime.fromisoformat(latest_request.replace('Z', '+00:00')) > max(stamps)
            except (ValueError, TypeError): pass
        return result
    except (OSError, ValueError, TypeError, sqlite3.Error): return None
