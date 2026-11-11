#!/usr/bin/env python3
"""RunHuddle Claude observer. Never approves tools or injects context."""
from compaction_count import read_compactions
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import shlex
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from copilot_bridge import events, process_info
from attention_request import request as attention_request

HOME = Path(os.environ.get('CLAUDE_CONFIG_DIR', Path.home() / '.claude'))
STATE = Path(os.environ.get('SESSION_TRACKER_CLAUDE_STATE', Path.home() / 'Library/Application Support/Agent Session Manager/claude.sqlite'))
EVENTS = ('SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse',
          'PostToolUseFailure', 'Notification', 'Stop', 'StopFailure', 'SessionEnd', 'Elicitation', 'ElicitationResult')


@contextmanager
def database():
    STATE.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(STATE, timeout=1)
    db.execute('CREATE TABLE IF NOT EXISTS states (id TEXT PRIMARY KEY, timestamp REAL, data TEXT)')
    db.execute('CREATE TABLE IF NOT EXISTS discovered (id TEXT PRIMARY KEY, data TEXT)')
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
    compact = event == 'SessionStart' and payload.get('source') == 'compact'
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
        previous = dict(data)
        if compact and (not old or old[0] != stamp):
            data['compactionCount'] = data.get('compactionCount', 0) + 1
        if compact:
            state = data.get('state', 'disconnected')
        pending = data.get('pending', {})
        details = data.get('pendingDetails', {})
        key = payload.get('tool_use_id') or payload.get('elicitation_id') or 'prompt'
        if state == 'needsInput' and event != 'StopFailure':
            pending[key] = event
            details[key] = attention_request(event, payload, details.get(key, {}).get('since', stamp))
        elif event in ('PostToolUse', 'PostToolUseFailure', 'ElicitationResult'):
            pending.pop(key, None)
            pending.pop('prompt', None)
            details.pop(key, None); details.pop('prompt', None)
        elif not compact and event in ('SessionStart', 'UserPromptSubmit', 'Stop', 'StopFailure', 'SessionEnd'):
            pending = {}; details = {}
        if pending and state in ('working', 'idle'):
            state = 'needsInput'
        data['pending'] = pending
        data['pendingDetails'] = details
        if state == 'needsInput':
            data['attention'] = next(iter(details.values()), None) or (data.get('attention') if compact else None) or attention_request(event, payload, stamp)
        else:
            data.pop('attention', None)
        data.update(state=state, updated=stamp, reason='Claude: ' + event, identity=identity)
        for key in ('cwd', 'transcript_path'):
            if isinstance(payload.get(key), str):
                data[key] = payload[key]
        if isinstance(payload.get('prompt'), str):
            data['preview'] = payload['prompt'][:2000]
            data.setdefault('title', payload['prompt'].splitlines()[0][:100] if payload['prompt'] else 'Claude session')
        db.execute('INSERT OR REPLACE INTO states VALUES (?,?,?)', (sid, stamp, json.dumps(data)))
    # Signal only after commit. Snapshots never touch this file, preventing refresh loops.
    try:
        if any(previous.get(key) != data.get(key) for key in ('state', 'cwd', 'preview', 'identity', 'attention', 'compactionCount')):
            Path(str(STATE) + '.signal').touch(mode=0o600)
    except OSError:
        pass  # The durable hook record remains available to reconciliation.



def message(event):
    if event.get('isSidechain') or event.get('isMeta') or event.get('type') not in ('user', 'assistant'):
        return None
    data = event.get('message')
    if not isinstance(data, dict):
        return None
    body = data.get('content')
    if isinstance(body, list):
        body = '\n'.join(p.get('text', '') for p in body if isinstance(p, dict) and p.get('type') == 'text' and isinstance(p.get('text'), str))
    if isinstance(body, str) and event['type'] == 'user' and body.lstrip().startswith('<task-notification>'):
        return None  # Internal background-task notices are not the user's request.
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


def cli_sessions():
    candidates = [Path.home() / '.local/bin/claude', Path('/opt/homebrew/bin/claude'),
                  Path('/usr/local/bin/claude'), Path.home() / '.npm-global/bin/claude']
    on_path = shutil.which('claude')
    if on_path:
        candidates.append(Path(on_path))
    executable = next((p for p in candidates if p.is_file() and os.access(p, os.X_OK)), None)
    if not executable:
        return None
    try:
        result = subprocess.run([str(executable), 'agents', '--json', '--all'], stdin=subprocess.DEVNULL,
                                capture_output=True, text=True, timeout=4, cwd=Path.home())
        if result.returncode:
            return None
        value = json.loads(result.stdout)
        if not isinstance(value, list):
            return None
        return [row for row in value if isinstance(row, dict)]
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None


def listed_session(entry):
    sid = entry.get('sessionId')
    if not isinstance(sid, str) or not sid or Path(sid).name != sid:
        return None
    data = {'source': 'listing', 'updated': time.time()}
    for source, target in [('cwd', 'cwd'), ('name', 'title')]:
        if isinstance(entry.get(source), str) and entry[source]:
            data[target] = entry[source]
    pid = entry.get('pid')
    if pid is not None and (not isinstance(pid, int) or isinstance(pid, bool) or pid <= 1):
        return None
    if isinstance(pid, int) and not isinstance(pid, bool) and pid > 1:
        before = process_info(pid)
        if not before or not is_claude(before[2], pid):
            return None
        tty = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'tty='], capture_output=True, text=True, timeout=1).stdout.strip()
        if process_info(pid) != before:
            return None
        data['identity'] = {'pid': pid, 'start': before[1], 'tty': '/dev/' + tty if tty and tty != '??' else ''}
        # Background state can describe work between turns; waiting takes priority.
        if entry.get('status') == 'waiting' or entry.get('state') == 'blocked':
            state = 'needsInput'
        elif entry.get('status') == 'busy' or entry.get('state') == 'working':
            state = 'working'
        elif entry.get('status') == 'idle' or entry.get('state') == 'done':
            state = 'idle'
        else:
            state = 'disconnected'
        detail = entry.get('waitingFor') if isinstance(entry.get('waitingFor'), str) else ''
        reported = entry.get('status') or entry.get('state') or 'unknown'
        reason = f'Claude reports {reported} · process {pid}'
        if data['identity']['tty']:
            reason += ' · ' + data['identity']['tty']
        else:
            reason += ' · no controlling terminal'
            if entry.get('kind') == 'interactive':
                state = 'disconnected'
                reason += '. Current interactive activity cannot be confirmed.'
        data.update(state=state, reason=reason + (': ' + detail if detail else ''))
    elif entry.get('state') in ('done', 'failed', 'stopped'):
        data.update(state='saved', reason='Claude reports a completed or stopped background session.')
    else:
        return None
    return sid, data


def snapshot():
    with database() as db:
        hooks = {sid: json.loads(data) for sid, data in db.execute('SELECT id,data FROM states')}
        observed = {sid: json.loads(data) for sid, data in db.execute('SELECT id,data FROM discovered')}
    listing = {}
    inventory = cli_sessions()
    for entry in inventory or []:
        try:
            result = listed_session(entry)
            if result:
                sid, data = result
                # Avoid choosing arbitrarily when the same conversation is open twice.
                if sid in listing:
                    data.update(state='disconnected', reason='This Claude conversation is open in multiple processes.', identity=None)
                previous = observed.get(sid, {})
                if all(data.get(key) == previous.get(key) for key in ('state', 'identity', 'title', 'cwd', 'reason')):
                    data['updated'] = previous.get('updated', data['updated'])
                listing[sid] = data
        except (OSError, ValueError, subprocess.TimeoutExpired):
            continue
    if listing:
        with database() as db:
            for sid, data in listing.items():
                db.execute('INSERT OR REPLACE INTO discovered VALUES (?,?)', (sid, json.dumps(data)))
    files, rows = paths(), []
    for sid in sorted(hooks.keys() | files.keys() | listing.keys() | observed.keys()):
        latest = max([hooks.get(sid, {}), observed.get(sid, {})], key=lambda d: d.get('updated', 0))
        data = dict(latest)
        path = files.get(sid)
        if path:
            try:
                info, _ = transcript(path)
                data.update(info)
                data['updated'] = max(data.get('updated', 0), path.stat().st_mtime)
            except FileNotFoundError:
                continue
        if sid in listing:
            updated = data.get('updated', 0)
            data.update(listing[sid])
            data['updated'] = max(updated, data['updated'])
            state, reason = data['state'], data['reason']
        elif data.get('state') == 'saved':
            state, reason = 'saved', 'Claude session ended.'
        elif live(data.get('identity')):
            if latest.get('source') == 'listing':
                # A previous CLI observation is evidence of a process, not current activity.
                state, reason = 'disconnected', 'Claude process is open, but its current activity could not be refreshed.'
            else:
                state, reason = data.get('state', 'disconnected'), data.get('reason', '')
        elif data.get('identity'):
            state, reason = 'saved', 'The tracked Claude process has exited.'
        elif inventory is not None:
            state, reason = 'saved', 'Not listed by Claude as a running session.'
        else:
            state, reason = 'disconnected', 'History found; live status unknown. This Claude version may need tracking hooks loaded in the session.'
        # Never attach a request from an earlier process or an already-resolved
        # wait to a newer live-list observation.
        if sid in listing:
            hook = hooks.get(sid, {})
            prior = observed.get(sid, {})
            compatible = hook.get('state') == 'needsInput' and hook.get('identity') == data.get('identity')
            resolved_after_hook = prior.get('state') != 'needsInput' and prior.get('updated', 0) > hook.get('updated', 0)
            data['attention'] = hook.get('attention') if compatible and not resolved_after_hook else None
        identity = data.get('identity')
        cwd = data.get('cwd', '')
        compactions = read_compactions(path, 'Claude')
        hook_count = hooks.get(sid, {}).get('compactionCount', 0)
        if hook_count > (compactions or {}).get('count', 0):
            compactions = {'count': hook_count, 'source': 'Claude compaction hooks observed since tracking was enabled'}
        rows.append(dict(provider='Claude', sessionID=sid, title=data.get('title', 'Claude session'), cwd=cwd,
                         project=Path(cwd).name if cwd else 'Unknown project', branch=data.get('branch', ''),
                         preview=data.get('preview', ''), state=state, reason=reason, updated=data.get('updated', 0),
                         compactions=compactions, attention=data.get('attention') if state == 'needsInput' else None, simulated=False, agentPID=(identity or {}).get('pid') if state in ('idle', 'working', 'needsInput') else None, terminalTTY=(identity or {}).get('tty') if state not in ('saved', 'disconnected') else None))
    return rows


def owned(command):
    try:
        args = shlex.split(command)
        if not (len(args) == 7 and args[1:4] == ['-E', '-s', '-B'] and args[5] == 'hook' and args[6] in EVENTS):
            return False
        script = Path(args[4])
        # Old app copies may already be deleted. Recognize our exact bundle layout
        # and paired interpreter without needing to read a file that no longer exists.
        if script.parts[-4:] == ('Contents', 'Resources', 'bridge', 'claude_bridge.py'):
            app = script.parents[3]
            if app.name == 'RunHuddle.app' and Path(args[0]) == app / 'Contents/Resources/python/bin/python3':
                return True
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


def repair_hooks():
    path = HOME / 'settings.json'
    if not path.exists():
        return {'repaired': False}
    config = json.loads(path.read_text())
    if config.get('disableAllHooks'):
        return {'repaired': False}
    hooks = config.get('hooks', {})
    if not isinstance(hooks, dict):
        raise ValueError('Claude hooks settings are not an object; no changes made.')
    found, stale = False, False
    for event in EVENTS:
        expected = [sys.executable, '-E', '-s', '-B', str(Path(__file__).resolve()), 'hook', event]
        owned_commands = [h['command'] for group in hooks.get(event, []) for h in group.get('hooks', [])
                          if owned(h.get('command'))]
        if owned_commands:
            found = True
            stale |= len(owned_commands) != 1 or any(shlex.split(c) != expected for c in owned_commands)
    if found and stale:
        install_hooks()
        return {'repaired': True}
    return {'repaired': False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['snapshot', 'history', 'handoff-context', 'hook', 'install-hooks', 'repair-hooks'])
    parser.add_argument('argument', nargs='?')
    args = parser.parse_args()
    if args.command == 'hook':
        stamp = time.time()
        try:
            record(args.argument, json.loads(sys.stdin.read(10 * 1024 * 1024)), owner(), stamp)
        except Exception:
            pass
    elif args.command == 'repair-hooks':
        print(json.dumps(repair_hooks()))
    elif args.command == 'install-hooks':
        print(install_hooks())
    elif args.command == 'snapshot':
        print(json.dumps(snapshot()))
    else:
        path = paths().get(args.argument)
        if path is None:
            raise ValueError('Claude transcript is not available yet.')
        _, messages = transcript(path)
        print(json.dumps({'text': 'Recent recorded messages (may be incomplete):\n\n' + '\n\n'.join((messages[:4] + ['[Intervening messages omitted]'] + messages[-80:]) if args.command == 'handoff-context' and len(messages) > 84 else messages if args.command == 'handoff-context' else messages[-12:]),
                          'latestRequest': next((m[6:] for m in reversed(messages) if m.startswith('User: ')), None),
                          'latestResponse': next((m[11:] for m in reversed(messages) if m.startswith('Assistant: ')), None)}))


if __name__ == '__main__':
    main()
