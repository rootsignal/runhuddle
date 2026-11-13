"""Passive Codex event observer: never starts, resumes, or subscribes to threads."""
import json
import os
from pathlib import Path
import time
from websockets.sync.client import unix_connect
from agent_plan import record_codex_plan

METHODS = frozenset(('thread/started', 'thread/status/changed', 'thread/closed',
                     'thread/archived', 'thread/unarchived', 'thread/deleted', 'thread/name/updated'))


def relevant(message):
    return isinstance(message, dict) and 'id' not in message and message.get('method') in METHODS


def observe(connection, emit, should_stop=lambda: False):
    connection.send(json.dumps({'id': 1, 'method': 'initialize', 'params': {
        'clientInfo': {'name': 'runhuddle_observer', 'version': '0.5.3'}}}))
    deadline = time.monotonic() + 10
    while True:
        message = json.loads(connection.recv(timeout=max(.01, deadline - time.monotonic())))
        if message.get('id') == 1:
            if 'error' in message:
                raise RuntimeError('Codex observer initialization failed')
            break
        if time.monotonic() >= deadline:
            raise TimeoutError('Codex observer initialization timed out')
    connection.send(json.dumps({'method': 'initialized'}))
    emit({'type': 'connected'})
    while not should_stop():
        try:
            raw = connection.recv(timeout=15)
        except TimeoutError:
            continue
        message = json.loads(raw)
        if record_codex_plan(message) or relevant(message):
            emit({'type': 'changed'})
        # Never answer approval/tool requests or take control of a thread.


def main():
    home = Path(os.environ.get('CODEX_HOME', Path.home() / '.codex'))
    def emit(message):
        print(json.dumps(message), flush=True)
    delay = 1
    parent = os.getppid()
    while os.getppid() == parent:
        started = time.monotonic()
        try:
            with unix_connect(str(home / 'app-server-control/app-server-control.sock'),
                              uri='ws://localhost/', open_timeout=5, close_timeout=1,
                              max_size=32 * 1024 * 1024) as connection:
                observe(connection, emit, lambda: os.getppid() != parent)
        except (OSError, ValueError, RuntimeError, TimeoutError) as error:
            pass
        except Exception:
            # Protocol/transport failures also reconnect; no session data goes to stderr.
            pass
        emit({'type': 'disconnected'})
        if time.monotonic() - started > 30:
            delay = 1
        if os.getppid() != parent:
            return
        time.sleep(delay)
        delay = min(delay * 2, 30)


if __name__ == '__main__':
    main()
