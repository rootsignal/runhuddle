"""Install and contact RunHuddle's Copilot extension. No terminal injection."""
import hashlib
import json
import os
from pathlib import Path
import socket
import signal
import time
import shlex
import stat
import tempfile
import uuid
from copilot_bridge import HOME, process_info

FILES = {'extension.mjs': 'copilot_extension.mjs', 'bridge.mjs': 'copilot_extension_core.mjs'}
MARKER = '// RunHuddle'


def install():
    folder = HOME / 'extensions' / 'runhuddle-replies'
    folder.mkdir(parents=True, exist_ok=True)
    if folder.is_symlink():
        raise ValueError('The RunHuddle extension directory is a symlink; no files changed.')
    contents = {name: (Path(__file__).parent / source).read_bytes() for name, source in FILES.items()}
    for name in contents:
        target = folder / name
        if target.exists() and (target.is_symlink() or not target.read_text().startswith(MARKER)):
            raise ValueError('An unrelated extension already uses this folder; no files changed.')
    for name, content in contents.items():
        target = folder / name
        if target.exists() and target.read_bytes() == content:
            continue
        with tempfile.NamedTemporaryFile(dir=folder, delete=False) as file:
            file.write(content)
            temporary = Path(file.name)
        try:
            temporary.chmod(0o600)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    return {'outcome': 'installed', 'message': 'Extension installed. In Copilot, run /experimental on to enable extension loading, then check /extensions manage for runhuddle-replies.'}


def exchange(path, payload):
    info = path.lstat()
    if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError('The Copilot connection is not private.')
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(12 if payload.get('action') == 'send' else 3)
        client.connect(str(path))
        client.sendall((json.dumps(payload) + '\n').encode())
        with client.makefile('rb') as stream:
            raw = stream.readline(256001)
        if len(raw) > 256000 or not raw.endswith(b'\n'):
            raise ValueError('Invalid connection response.')
        result = json.loads(raw)
        if not isinstance(result, dict):
            raise ValueError('Invalid connection response.')
        return result


def identity_valid(result, sid):
    if result.get('sessionID') != sid or result.get('protocol') != 1:
        return False
    child, parent = result.get('extensionPID'), result.get('ownerPID')
    if not all(isinstance(pid, int) and not isinstance(pid, bool) and pid > 1 for pid in (child, parent)):
        return False
    child_info, parent_info = process_info(child), process_info(parent)
    return bool(child_info and parent_info and child_info[0] == parent and Path(parent_info[2]).name in ('copilot', 'copilot-cli'))


def candidates(sid):
    prefix = hashlib.sha256(sid.encode()).hexdigest()[:24]
    found = []
    for path in (Path.home() / '.runhuddle/copilot').glob(prefix + '-*.sock'):
        try:
            status = exchange(path, {'action': 'check', 'sessionID': sid})
            if identity_valid(status, sid):
                found.append((path, status))
        except (OSError, ValueError):
            continue
    return found


def prepare_launch(payload):
    sid = payload.get('sessionID', '')
    uuid.UUID(sid)
    executable = payload.get('executable', '')
    if not Path(executable).is_file() or not os.access(executable, os.X_OK):
        raise ValueError('Copilot executable is not available.')
    install()
    if payload.get('resume'):
        from copilot_bridge import snapshot, database, live
        row = next((row for row in snapshot() if row['sessionID'] == sid), None)
        if row and row['state'] not in ('idle', 'saved'):
            raise ValueError('Wait until Copilot is idle or finish its pending approval before reconnecting.')
        if row and row['state'] == 'idle':
            with database() as db:
                record = db.execute('SELECT data FROM states WHERE id=?', (sid,)).fetchone()
            identity = json.loads(record[0]).get('identity') if record else None
            if not identity or identity.get('pid') != row.get('agentPID') or not live(identity):
                raise ValueError('Could not verify this Copilot process. Exit it in the terminal, then reconnect.')
            pid = identity['pid']
            before = process_info(pid)
            if not before or before[1] != identity['start']:
                raise ValueError('Copilot changed before reconnecting. Refresh and try again.')
            # Graceful shutdown only; never terminate a busy or unverified session.
            os.kill(pid, signal.SIGTERM)
            for _ in range(50):
                if process_info(pid) != before:
                    break
                time.sleep(0.1)
            else:
                raise ValueError('Copilot is still closing. No new session was opened; try again shortly.')
    command = shlex.join([executable, '--experimental', '--session-id', sid])
    return {'outcome': 'setup', 'message': command}


def run(payload):
    if payload.get('action') == 'setup':
        try:
            return prepare_launch(payload)
        except (OSError, ValueError) as error:
            return {'outcome': 'unavailable', 'message': str(error)}
    if payload.get('action') == 'install':
        try:
            return install()
        except (OSError, ValueError) as error:
            return {'outcome': 'unavailable', 'message': str(error)}
    sid = payload.get('sessionID', '')
    try:
        uuid.UUID(sid)
    except (ValueError, TypeError, AttributeError):
        return {'outcome': 'unavailable', 'message': 'Invalid Copilot session identity.'}
    connections = candidates(sid)
    if not connections:
        return {'outcome': 'setupRequired', 'message': 'No reply connection yet. After installing the extension, run /experimental on in Copilot, then check /extensions manage for runhuddle-replies.'}
    if len(connections) != 1:
        return {'outcome': 'unavailable', 'message': 'This conversation has more than one Copilot connection. Close the duplicate before sending.'}
    path, status = connections[0]
    if status.get('outcome') != 'ready' or payload.get('action') != 'send':
        return status
    # Check hook identity as well as the connected extension. A follow-up never
    # substitutes for an outstanding question or permission dialog.
    from copilot_bridge import snapshot
    row = next((row for row in snapshot() if row['sessionID'] == sid), None)
    if not row or row['state'] not in ('idle', 'working') or row.get('agentPID') != status['ownerPID']:
        return {'outcome': 'unavailable', 'message': 'Copilot activity is not ready for replies. Check the session in its terminal.'}
    try:
        response = exchange(path, payload)
        if identity_valid(response, sid) and response.get('extensionPID') == status['extensionPID'] and response.get('ownerPID') == status['ownerPID']:
            return response
    except (OSError, ValueError):
        pass
    return {'outcome': 'uncertain', 'message': 'Copilot delivery could not be confirmed. Check its terminal before sending again.'}
