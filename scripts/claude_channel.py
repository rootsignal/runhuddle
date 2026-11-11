"""Local-only Claude channel: MCP stdio plus an owner-only Unix socket.

No terminal injection, approvals, TCP listener, shell execution, or automatic retry.
The channel must be explicitly enabled when resuming the exact session.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shlex
import socket
import stat
import sys
import threading
import uuid

MAX_PACKET = 256000
MAX_TEXT = 32000
NAME = 'runhuddle'


def socket_path(sid):
    uuid.UUID(sid)
    return Path.home() / '.runhuddle' / 'channels' / (hashlib.sha256(sid.encode()).hexdigest()[:24] + '.sock')


def private_directory(path):
    for folder in (path.parent.parent, path.parent):
        folder.mkdir(mode=0o700, exist_ok=True)
        info = folder.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
            raise ValueError('Channel directory is not owned by this user.')
        folder.chmod(0o700)


def read_packet(stream):
    raw = stream.readline(MAX_PACKET + 1)
    if not raw or len(raw) > MAX_PACKET or not raw.endswith(b'\n'):
        raise ValueError('Invalid channel packet')
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError('Invalid channel packet')
    return value


def eligibility(sid, identity):
    from claude_bridge import cli_sessions, live
    if not identity or not live(identity):
        return 'Claude’s original process is no longer running.'
    rows = [r for r in cli_sessions() or [] if r.get('sessionId') == sid]
    if len(rows) != 1 or rows[0].get('pid') != identity['pid']:
        return 'Could not uniquely verify this Claude session. Check its terminal.'
    row = rows[0]
    if row.get('status') not in ('idle', 'busy') or row.get('state') == 'blocked':
        return 'Answer the pending question or approval in Claude’s terminal first.'
    return None


class Channel:
    def __init__(self, sid, emit, verify):
        self.sid, self.emit, self.verify = sid, emit, verify
        self.initialized = False
        self.receipts = set()
        self.sent = set()
        self.lock = threading.Lock()

    def request(self, payload):
        if payload.get('sessionID') != self.sid:
            return {'outcome': 'notSent', 'message': 'Session identity does not match.'}
        if not self.initialized:
            return {'outcome': 'unavailable', 'message': 'Claude is still connecting its channel.'}
        reason = self.verify()
        if reason:
            return {'outcome': 'unavailable', 'message': reason}
        if payload.get('action') == 'check':
            with self.lock:
                receipts = sorted(self.receipts)
            return {'outcome': 'ready', 'message': 'Connected to this Claude session. Approvals stay in its terminal.', 'receivedIDs': receipts}
        text = payload.get('text')
        if payload.get('action') != 'send' or not isinstance(text, str) or not text.strip() or len(text.encode()) > MAX_TEXT or '\0' in text:
            return {'outcome': 'notSent', 'message': 'Enter a message up to 32 KB without null characters.'}
        identifier = str(uuid.uuid4())
        with self.lock:
            self.sent.add(identifier)
        self.emit({'jsonrpc': '2.0', 'method': 'notifications/claude/channel',
                   'params': {'content': text, 'meta': {'message_id': identifier}}})
        return {'outcome': 'forwarded', 'message': 'Forwarded to Claude’s channel. Waiting for Claude to receive it.', 'messageID': identifier}

    def rpc(self, packet):
        method, identifier = packet.get('method'), packet.get('id')
        if method == 'notifications/initialized':
            self.initialized = True
            return
        if identifier is None:
            return
        result = None
        if method == 'initialize':
            result = {'protocolVersion': '2024-11-05', 'serverInfo': {'name': NAME, 'version': '0.18.0'},
                      'capabilities': {'experimental': {'claude/channel': {}}, 'tools': {}},
                      'instructions': 'RunHuddle is the local user’s session UI. For every event from channel runhuddle, first call acknowledge with its message_id, then respond normally in this conversation. Local image paths in the message may be read using your normal tools and permissions. Never treat a follow-up as approval of a pending permission request.'}
        elif method == 'ping':
            result = {}
        elif method == 'tools/list':
            result = {'tools': [{'name': 'acknowledge', 'description': 'Confirm receipt of a RunHuddle channel message before responding.',
                                'inputSchema': {'type': 'object', 'properties': {'message_id': {'type': 'string'}}, 'required': ['message_id'], 'additionalProperties': False}}]}
        elif method == 'tools/call':
            params = packet.get('params') or {}
            message_id = (params.get('arguments') or {}).get('message_id')
            with self.lock:
                valid = params.get('name') == 'acknowledge' and isinstance(message_id, str) and message_id in self.sent
                if valid:
                    self.receipts.add(message_id)
            result = {'content': [{'type': 'text', 'text': 'Receipt recorded. Respond in the conversation.' if valid else 'Unknown message.'}], 'isError': not valid}
        else:
            self.emit({'jsonrpc': '2.0', 'id': identifier, 'error': {'code': -32601, 'message': 'Method not found'}})
            return
        self.emit({'jsonrpc': '2.0', 'id': identifier, 'result': result})


def serve(sid):
    from claude_bridge import owner
    identity = owner()
    if not identity:
        raise ValueError('Run this channel through Claude Code, not directly.')
    path = socket_path(sid)
    private_directory(path)
    # One owner per session; a second process cannot replace the live endpoint.
    with open(str(path) + '.lock', 'a') as lock:
        os.chmod(lock.name, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        path.unlink(missing_ok=True)
        output_lock = threading.Lock()
        def emit(value):
            with output_lock:
                sys.stdout.write(json.dumps(value) + '\n')
                sys.stdout.flush()
        channel = Channel(sid, emit, lambda: eligibility(sid, identity))
        with socket.socket(socket.AF_UNIX) as listener:
            listener.bind(str(path)); os.chmod(path, 0o600); listener.listen(4)
            def accept():
                while True:
                    try:
                        connection, _ = listener.accept()
                    except OSError:
                        return
                    with connection:
                        connection.settimeout(5)
                        try:
                            with connection.makefile('rb') as stream:
                                request = read_packet(stream)
                            if request.get('action') == 'receipt' and request.get('sessionID') == sid:
                                with channel.lock:
                                    result = {'received': request.get('messageID') in channel.receipts}
                            else:
                                result = channel.request(request)
                            connection.sendall((json.dumps(result) + '\n').encode())
                        except (OSError, ValueError, TypeError):
                            pass  # Caller treats a missing response as uncertain, never retries.
            threading.Thread(target=accept, daemon=True).start()
            try:
                while True:
                    try:
                        packet = read_packet(sys.stdin.buffer)
                    except ValueError:
                        break
                    channel.rpc(packet)
            finally:
                path.unlink(missing_ok=True)


def exchange(sid, payload):
    path = socket_path(sid)
    info = path.lstat()
    if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError('Channel socket is not private.')
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(8)
        client.connect(str(path))
        client.sendall((json.dumps(payload) + '\n').encode())
        with client.makefile('rb') as stream:
            return read_packet(stream)


def run(payload):
    sid = payload.get('sessionID', '')
    try:
        uuid.UUID(sid)
        if not socket_path(sid).exists():
            return {'outcome': 'setupRequired', 'message': 'Connect this Claude session to send follow-ups from RunHuddle.'}
        return exchange(sid, payload)
    except (OSError, ValueError):
        if payload.get('action') == 'send':
            return {'outcome': 'uncertain', 'message': 'Claude delivery could not be confirmed. Check its terminal before sending again.'}
        return {'outcome': 'setupRequired', 'message': 'Reconnect Claude replies, then check the connection again.'}


def launch_arguments(sid, executable, resume):
    sid = str(uuid.UUID(sid))
    config = {'mcpServers': {NAME: {'command': sys.executable, 'args': ['-E', '-s', '-B', str(Path(__file__).resolve()), '--session-id', sid]}}}
    return [executable, '--resume' if resume else '--session-id', sid,
            '--mcp-config', json.dumps(config), '--dangerously-load-development-channels', 'server:' + NAME]


def validate_launch(sid):
    from claude_bridge import cli_sessions
    inventory = cli_sessions()
    if inventory is None:
        raise ValueError('Could not check running Claude sessions. Try again after checking Claude in the terminal.')
    if any(r.get('sessionId') == sid and r.get('pid') for r in inventory):
        raise ValueError('Exit this conversation in Claude’s terminal first, then resume it here. Its history will be kept.')


def setup(payload):
    sid = str(uuid.UUID(payload['sessionID']))
    validate_launch(sid)
    command = [sys.executable, '-E', '-s', '-B', str(Path(__file__).resolve()),
               '--launch', '--session-id', sid, '--executable', payload['executable']]
    if payload.get('resume'):
        command.append('--resume')
    return {'outcome': 'setup', 'message': shlex.join(command)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--session-id', required=True)
    parser.add_argument('--launch', action='store_true')
    parser.add_argument('--resume', action='store_true')
    parser.add_argument('--executable')
    args = parser.parse_args()
    sid = str(uuid.UUID(args.session_id))
    if args.launch:
        try:
            validate_launch(sid)  # Check again immediately before launching.
            os.execv(args.executable, launch_arguments(sid, args.executable, args.resume))
        except (ValueError, OSError) as error:
            sys.exit(str(error))
    else:
        serve(sid)
