#!/usr/bin/env python3
"""RunHuddle Claude observer. Never approves tools or injects context."""
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import shlex
import sqlite3
import subprocess
import sys
import tempfile
import time
from copilot_bridge import events, process_info

HOME = Path(os.environ.get('CLAUDE_CONFIG_DIR', Path.home() / '.claude'))
STATE = Path(os.environ.get('SESSION_TRACKER_CLAUDE_STATE', Path.home() / 'Library/Application Support/Agent Session Manager/claude.sqlite'))
EVENTS = ('SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse',
          'PostToolUseFailure', 'Notification', 'Stop', 'StopFailure', 'SessionEnd', 'Elicitation', 'ElicitationResult')


@contextmanager
def database():
    STATE.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(STATE, timeout=1)
    db.execute('CREATE TABLE IF NOT EXISTS states (id TEXT PRIMARY KEY, timestamp REAL, data TEXT)')
    os.chmod(STATE, 0o600)
    try:
        with db:
            yield db
    finally:
        db.close()


def is_claude(command, pid=None):
    # Native installs may report a version-named executable under .local/share/claude.
    if Path(command).name == 'claude' or '/claude/versions/' in command:
        return True
    if pid and Path(command).name in ('node', 'bun'):
        args = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'args='], capture_output=True, text=True, timeout=1).stdout
        return any(arg.endswith('/@anthropic-ai/claude-code/cli.js') for arg in shlex.split(args)[:3])
    return False


def owner():
    pid = os.getppid()
    for _ in range(12):
        info = process_info(pid)
        if not info:
            break
        parent, start, command = info
        if is_claude(command, pid):
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
    return bool(info and info[1] == identity['start'] and is_claude(info[2], identity['pid']))


def record(event, payload, identity=None, stamp=None):
    if payload.get('agent_id') or payload.get('agent_transcript_path'):
        return
    sid = payload.get('session_id')
    if not isinstance(sid, str) or not sid or Path(sid).name != sid:
        return
    state = {'SessionStart': 'idle', 'UserPromptSubmit': 'working', 'PreToolUse': 'working',
             'PermissionRequest': 'needsInput', 'PostToolUse': 'working', 'PostToolUseFailure': 'working',
             'Stop': 'idle', 'StopFailure': 'needsInput', 'SessionEnd': 'saved',
             'Elicitation': 'needsInput', 'ElicitationResult': 'working'}.get(event)
    if event == 'SessionStart' and payload.get('source') == 'compact':
        state = 'working'
    if event == 'PreToolUse' and payload.get('tool_name') == 'AskUserQuestion':
        state = 'needsInput'
    if event == 'Notification':
        state = {'permission_prompt': 'needsInput', 'elicitation_dialog': 'needsInput',
                 'idle_prompt': 'idle'}.get(payload.get('notification_type'))
    if not state:
        return
    stamp = time.time() if stamp is None else stamp
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        old = db.execute('SELECT timestamp,data FROM states WHERE id=?', (sid,)).fetchone()
        if old and old[0] > stamp:
            return
        data = json.loads(old[1]) if old else {}
        pending = data.get('pending', {})
        key = payload.get('tool_use_id') or payload.get('elicitation_id') or 'prompt'
        if state == 'needsInput' and event != 'StopFailure':
            pending[key] = event
        elif event in ('PostToolUse', 'PostToolUseFailure', 'ElicitationResult'):
            pending.pop(key, None)
            pending.pop('prompt', None)
        elif event in ('SessionStart', 'UserPromptSubmit', 'Stop', 'StopFailure', 'SessionEnd'):
            pending = {}
        if pending and state in ('working', 'idle'):
            state = 'needsInput'
        data['pending'] = pending
        data.update(state=state, updated=stamp, reason='Claude: ' + event, identity=identity)
        for key in ('cwd', 'transcript_path'):
            if isinstance(payload.get(key), str):
                data[key] = payload[key]
        if isinstance(payload.get('prompt'), str):
            data['preview'] = payload['prompt'][:2000]
            data.setdefault('title', payload['prompt'].splitlines()[0][:100] if payload['prompt'] else 'Claude session')
        db.execute('INSERT OR REPLACE INTO states VALUES (?,?,?)', (sid, stamp, json.dumps(data)))


def message(event):
    if event.get('isSidechain') or event.get('isMeta') or event.get('type') not in ('user', 'assistant'):
        return None
    data = event.get('message')
    if not isinstance(data, dict):
        return None
    body = data.get('content')
    if isinstance(body, list):
        body = '\n'.join(p.get('text', '') for p in body if isinstance(p, dict) and p.get('type') == 'text' and isinstance(p.get('text'), str))
    return (event['type'], body) if isinstance(body, str) and body.strip() else None


def paths():
    return {p.stem: p for p in (HOME / 'projects').glob('*/*.jsonl') if not p.name.startswith('agent-')}


def transcript(path):
    info, messages = {}, []
    for event in events(path):
        if event.get('isSidechain'):
            continue
        if isinstance(event.get('cwd'), str) and event['cwd']:
            info['cwd'] = event['cwd']
        if isinstance(event.get('gitBranch'), str) and event['gitBranch']:
            info['branch'] = event['gitBranch']
        if event.get('type') == 'custom-title' and isinstance(event.get('customTitle'), str):
            info['title'] = event['customTitle']
        item = message(event)
        if item:
            role, text = item
            messages.append(role.capitalize() + ': ' + text[:12000])
            if role == 'user':
                info.setdefault('title', text.splitlines()[0][:100])
                info['preview'] = text[:2000]
    return info, messages


def snapshot():
    with database() as db:
        hooks = {sid: json.loads(data) for sid, data in db.execute('SELECT id,data FROM states')}
    files, rows = paths(), []
    for sid in sorted(hooks.keys() | files.keys()):
        data = dict(hooks.get(sid, {}))
        path = files.get(sid)
        if path:
            try:
                info, _ = transcript(path)
                data.update(info)
                data['updated'] = max(data.get('updated', 0), path.stat().st_mtime)
            except FileNotFoundError:
                continue
        identity = data.get('identity')
        if data.get('state') == 'saved':
            state, reason = 'saved', 'Claude session ended.'
        elif live(identity):
            state, reason = data.get('state', 'disconnected'), data.get('reason', '')
        elif identity:
            state, reason = 'saved', 'The tracked Claude process has exited.'
        else:
            state, reason = 'disconnected', 'History found; live status unknown. Enable Claude tracking and restart or resume the CLI session.'
        cwd = data.get('cwd', '')
        rows.append(dict(provider='Claude', sessionID=sid, title=data.get('title', 'Claude session'), cwd=cwd,
                         project=Path(cwd).name if cwd else 'Unknown project', branch=data.get('branch', ''),
                         preview=data.get('preview', ''), state=state, reason=reason, updated=data.get('updated', 0),
                         simulated=False, terminalTTY=(identity or {}).get('tty') if state not in ('saved', 'disconnected') else None))
    return rows


def owned(command):
    try:
        args = shlex.split(command)
        if not (len(args) == 7 and args[1:4] == ['-E', '-s', '-B'] and args[5] == 'hook' and args[6] in EVENTS):
            return False
        script = Path(args[4])
        return script == Path(__file__).resolve() or (script.name == 'claude_bridge.py' and
            'RunHuddle Claude observer. Never approves tools or injects context.' in script.read_text()[:200])
    except (ValueError, TypeError, OSError):
        return False


def install_hooks():
    path = HOME / 'settings.json'
    HOME.mkdir(parents=True, exist_ok=True)
    before = path.read_bytes() if path.exists() else None
    config = json.loads(before) if before else {}
    if config.get('disableAllHooks'):
        raise ValueError('Claude has disableAllHooks enabled. Enable hooks in Claude settings before connecting RunHuddle.')
    hooks = config.setdefault('hooks', {})
    if not isinstance(hooks, dict):
        raise ValueError('Claude hooks settings are not an object; no changes made.')
    for event in EVENTS:
        groups = hooks.setdefault(event, [])
        remaining = []
        for group in groups:
            kept = [h for h in group.get('hooks', []) if not owned(h.get('command'))]
            if kept or not group.get('hooks'):
                remaining.append({**group, 'hooks': kept})
        command = shlex.join([sys.executable, '-E', '-s', '-B', str(Path(__file__).resolve()), 'hook', event])
        remaining.append({'hooks': [{'type': 'command', 'command': command, 'timeout': 3}]})
        hooks[event] = remaining
    with tempfile.NamedTemporaryFile(mode='w', dir=HOME, delete=False) as file:
        temporary = Path(file.name)
        json.dump(config, file, indent=2)
        file.write('\n')
    try:
        if (path.read_bytes() if path.exists() else None) != before:
            raise RuntimeError('Claude settings changed during setup; retry.')
        if before is not None:
            backup = HOME / ('settings.runhuddle-backup-' + str(time.time_ns()) + '.json')
            backup.write_bytes(before)
            backup.chmod(0o600)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['snapshot', 'history', 'hook', 'install-hooks'])
    parser.add_argument('argument', nargs='?')
    args = parser.parse_args()
    if args.command == 'hook':
        stamp = time.time()
        try:
            record(args.argument, json.loads(sys.stdin.read(10 * 1024 * 1024)), owner(), stamp)
        except Exception:
            pass
    elif args.command == 'install-hooks':
        print(install_hooks())
    elif args.command == 'snapshot':
        print(json.dumps(snapshot()))
    else:
        path = paths().get(args.argument)
        if path is None:
            raise ValueError('Claude transcript is not available yet.')
        _, messages = transcript(path)
        print(json.dumps({'text': 'Recent recorded messages (may be incomplete):\n\n' + '\n\n'.join(messages[-12:]),
                          'latestRequest': next((m[6:] for m in reversed(messages) if m.startswith('User: ')), None),
                          'latestResponse': next((m[11:] for m in reversed(messages) if m.startswith('Assistant: ')), None)}))


if __name__ == '__main__':
    main()
