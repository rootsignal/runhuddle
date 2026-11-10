#!/usr/bin/env python3
"""Read-only Copilot transcript adapter; hooks write only tracker-owned state."""
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import yaml

HOME = Path(os.environ.get('COPILOT_HOME', Path.home() / '.copilot'))
STATE = Path(os.environ.get('SESSION_TRACKER_COPILOT_STATE', Path.home() / 'Library/Application Support/Agent Session Manager/copilot.sqlite'))
EVENTS = ('sessionStart', 'userPromptSubmitted', 'postToolUse', 'postToolUseFailure', 'agentStop', 'sessionEnd', 'notification', 'errorOccurred')


@contextmanager
def database():
    STATE.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(STATE, timeout=2)
    db.execute('CREATE TABLE IF NOT EXISTS states (id TEXT PRIMARY KEY, timestamp REAL, data TEXT)')
    os.chmod(STATE, 0o600)
    try:
        with db:
            yield db
    finally:
        db.close()


def process_info(pid):
    result = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'ppid=,lstart=,comm='], capture_output=True, text=True, timeout=1)
    parts = result.stdout.strip().split(None, 6)
    if len(parts) != 7:
        return None
    return int(parts[0]), ' '.join(parts[1:6]), parts[6]


def owner():
    pid = os.getppid()
    for _ in range(12):
        info = process_info(pid)
        if not info:
            break
        parent, start, command = info
        if Path(command).name in ('copilot', 'copilot-cli'):
            tty = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'tty='], capture_output=True, text=True, timeout=1).stdout.strip()
            return {'pid': pid, 'start': start, 'tty': '/dev/' + tty if tty and tty != '??' else ''}
        if parent <= 1:
            break
        pid = parent
    return None


def live(identity):
    if not identity:
        return False
    info = process_info(identity['pid'])
    return bool(info and info[1] == identity['start'] and Path(info[2]).name in ('copilot', 'copilot-cli'))


def record(event, payload, identity=None):
    if payload.get('agentId') or payload.get('parentAgentId'):
        return
    sid = payload.get('sessionId')
    if not isinstance(sid, str) or not sid:
        return
    states = {'sessionStart': 'working' if payload.get('initialPrompt') else 'idle', 'userPromptSubmitted': 'working',
              'postToolUse': 'working', 'postToolUseFailure': 'working', 'agentStop': 'idle', 'sessionEnd': 'saved', 'errorOccurred': 'disconnected'}
    state = states.get(event)
    if event == 'notification' and payload.get('notification_type') in ('permission_prompt', 'elicitation_dialog'):
        state = 'needsInput'
    if not state:
        return
    stamp = float(payload['timestamp']) / 1000
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        old = db.execute('SELECT timestamp,data FROM states WHERE id=?', (sid,)).fetchone()
        if old and old[0] > stamp:
            return
        data = json.loads(old[1]) if old else {}
        data.update(state=state, updated=stamp, reason='Copilot: ' + event, identity=identity or data.get('identity'))
        if payload.get('cwd'):
            data['cwd'] = payload['cwd']
        prompt = payload.get('prompt') or payload.get('initialPrompt')
        if isinstance(prompt, str) and prompt:
            data['preview'] = prompt[:2000]
            data.setdefault('title', prompt.splitlines()[0][:100])
        db.execute('INSERT OR REPLACE INTO states VALUES (?,?,?)', (sid, stamp, json.dumps(data)))


def events(path):
    # Bound each read: initial context plus recent continuation context.
    with path.open('rb') as file:
        size = path.stat().st_size
        head = file.read(256 * 1024)
        if size > len(head):
            file.seek(max(len(head), size - 1024 * 1024))
            file.readline()  # discard a possibly partial line
            head += b'\n' + file.read(1024 * 1024)
    for line in head.splitlines():
        try:
            value = json.loads(line)
            if isinstance(value, dict):
                yield value
        except (ValueError, UnicodeDecodeError):
            continue


def transcript(path):
    info, messages = {}, []
    for event in events(path):
        data = event.get('data') or {}
        kind = event.get('type')
        if kind == 'session.start':
            info.update(data.get('context') or {})
        elif kind == 'session.context_changed':
            info.update(data)
        elif kind == 'session.title_changed':
            info['title'] = data.get('title', '')
        elif kind in ('user.message', 'assistant.message'):
            content = data.get('content')
            if isinstance(content, str) and content:
                messages.append(kind.split('.')[0].capitalize() + ': ' + content[:12000])
                if kind == 'user.message':
                    info.setdefault('title', content.splitlines()[0][:100])
                    info['preview'] = content[:2000]
    return info, messages


def workspace(folder):
    try:
        path = folder / 'workspace.yaml'
        with path.open() as file:
            value = yaml.safe_load(file.read(64 * 1024))
        if not isinstance(value, dict) or value.get('id') != folder.name:
            return {}
        result = {key: value[key] for key in ('cwd', 'branch') if isinstance(value.get(key), str)}
        result['updated'] = path.stat().st_mtime
        return result
    except (OSError, ValueError, yaml.YAMLError):
        return {}


def has_open_cli(folder):
    # A leftover lock filename alone does not prove a live session. Confirm that
    # the Copilot PID actually holds this session's file open; do not acquire it.
    for hold in folder.glob('inuse.*.hold'):
        try:
            pid = int(hold.name.split('.')[1])
            before = process_info(pid)
            if not before or Path(before[2]).name not in ('copilot', 'copilot-cli'):
                continue
            result = subprocess.run(['/usr/sbin/lsof', '-a', '-p', str(pid), '-F', 'n', str(hold)],
                                    capture_output=True, text=True, timeout=2)
            if 'n' + str(hold) in result.stdout.splitlines() and process_info(pid) == before:
                return True
        except (OSError, ValueError, subprocess.TimeoutExpired):
            continue
    return False


def snapshot():
    with database() as db:
        hooks = {sid: json.loads(data) for sid, data in db.execute('SELECT id,data FROM states')}
    paths = {path.parent.name: path for path in (HOME / 'session-state').glob('*/events.jsonl')}
    folders = {path.parent.name: path.parent for path in (HOME / 'session-state').glob('*/workspace.yaml')}
    rows = []
    for sid in sorted(hooks.keys() | paths.keys() | folders.keys()):
        data = workspace(folders[sid]) if sid in folders else {}
        data.update(hooks.get(sid, {}))
        path = paths.get(sid)
        if path:
            try:
                info, _ = transcript(path)
                data.update({k: v for k, v in info.items() if k in ('cwd', 'branch', 'title', 'preview') and v})
                data['updated'] = max(data.get('updated', 0), path.stat().st_mtime)
            except FileNotFoundError:
                continue
        state = data.get('state', 'saved')
        if not live(data.get('identity')):
            state = 'saved'
            if sid in folders and has_open_cli(folders[sid]):
                state = 'disconnected'
                data['reason'] = 'Copilot CLI is open; live activity has not been confirmed by tracker hooks.'
        cwd = data.get('cwd', '')
        rows.append(dict(provider='Copilot', sessionID=sid, title=data.get('title', 'Copilot session'), cwd=cwd,
                         project=Path(cwd).name if cwd else 'Unknown project', branch=data.get('branch', ''),
                         preview=data.get('preview', ''), state=state, reason=data.get('reason', '') if state != 'saved' else 'Saved session; live activity is not confirmed.',
                         updated=data.get('updated', 0), simulated=False,
                         terminalTTY=(data.get('identity') or {}).get('tty') if state not in ('saved', 'disconnected') else None))
    return rows


def owned_hook(entry, event):
    args = entry.get('args', [])
    while args and args[0] in ('-E', '-s', '-B'):
        args = args[1:]
    if entry.get('type') != 'command' or len(args) != 3 or args[1:] != ['hook', event]:
        return False
    script = Path(args[0])
    if script == Path(__file__).resolve():
        return True
    # Recognize the original source installer, while refusing unrelated collectors.
    try:
        return script.name == 'copilot_bridge.py' and '"""Read-only Copilot transcript adapter; hooks write only tracker-owned state."""' in script.read_text()[:200]
    except OSError:
        return False


def install_hooks():
    path = HOME / 'hooks/agent-session-manager.json'
    config = {'version': 1, 'hooks': {event: [{'type': 'command', 'exec': sys.executable,
              'args': ['-E', '-s', '-B', str(Path(__file__).resolve()), 'hook', event], 'timeoutSec': 5}] for event in EVENTS}}
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        old = json.loads(path.read_text())
        groups = old.get('hooks', {})
        if not groups or any(event not in EVENTS or not entries or
                            any(not owned_hook(entry, event) for entry in entries)
                            for event, entries in groups.items()):
            raise RuntimeError('Existing hooks are not owned by this tracker: ' + str(path))
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as file:
        temporary = Path(file.name)
        file.write(json.dumps(config, indent=2) + '\n')
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return path


def diagnostics():
    configured = False
    try:
        config = json.loads((HOME / 'hooks/agent-session-manager.json').read_text())
        configured = all(any(entry.get('exec') == sys.executable and
                            entry.get('args') == ['-E', '-s', '-B', str(Path(__file__).resolve()), 'hook', event]
                            for entry in config.get('hooks', {}).get(event, [])) for event in EVENTS)
    except (OSError, ValueError, TypeError):
        pass
    with database() as db:
        last = db.execute('SELECT MAX(timestamp) FROM states').fetchone()[0]
    return {'configured': configured, 'lastEvent': last}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['snapshot', 'history', 'hook', 'install-hooks', 'diagnostics'])
    parser.add_argument('argument', nargs='?')
    args = parser.parse_args()
    if args.command == 'hook':
        # Observational hooks must never block an agent or emit decision/context JSON.
        try:
            record(args.argument, json.loads(sys.stdin.read(10 * 1024 * 1024)), owner())
        except Exception:
            pass
        return
    if args.command == 'install-hooks':
        print(install_hooks())
    elif args.command == 'diagnostics':
        print(json.dumps(diagnostics()))
    elif args.command == 'snapshot':
        print(json.dumps(snapshot()))
    else:
        sid = args.argument or ''
        if not sid or Path(sid).name != sid or sid in ('.', '..'):
            raise ValueError('Invalid session ID')
        folder = HOME / 'session-state' / sid
        if not (folder / 'events.jsonl').exists() and workspace(folder):
            print(json.dumps({'text': 'No conversation has been recorded for this session yet.'}))
            return
        _, messages = transcript(folder / 'events.jsonl')
        print(json.dumps({'text': 'Recent recorded messages (may be incomplete):\n\n' + '\n\n'.join(messages[-12:]),
                          'latestRequest': next((m[6:] for m in reversed(messages) if m.startswith('User: ')), None),
                          'latestResponse': next((m[11:] for m in reversed(messages) if m.startswith('Assistant: ')), None)}))


if __name__ == '__main__':
    main()
