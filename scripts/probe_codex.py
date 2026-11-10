#!/usr/bin/env python3
"""Read-only compatibility probe; never starts/resumes a thread or sends a turn."""
import collections
import json
import os
from pathlib import Path
import time
from websockets.sync.client import unix_connect


def main():
    codex_home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
    connection = unix_connect(
        str(codex_home / "app-server-control/app-server-control.sock"),
        uri="ws://localhost/", open_timeout=10, legacy=True,
    )

    def send(message):
        connection.send(json.dumps(message))

    def request(identifier, method, params):
        send({"id": identifier, "method": method, "params": params})
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            message = json.loads(connection.recv(timeout=max(0.01, deadline-time.monotonic())))
            if message.get("id") == identifier:
                if "error" in message:
                    raise RuntimeError(f"{method}: {message['error']}")
                return message.get("result")
        raise TimeoutError(method)

    try:
        initialized = request(1, "initialize", {
            "clientInfo": {"name": "session_manager_probe", "version": "0.1.0"},
            "capabilities": {"experimentalApi": False},
        })
        send({"method": "initialized"})
        loaded = request(2, "thread/loaded/list", {})
        history = request(3, "thread/list", {"limit": 100})
        rows = history.get("data", [])
        states = collections.Counter(row.get("status", {}).get("type", "missing") for row in rows)
        print(json.dumps({
            "connected": True,
            "serverInfoFields": sorted(initialized.keys()),
            "loadedThreads": len(loaded.get("data", [])),
            "historyFirstPage": len(rows),
            "hasMoreHistory": bool(history.get("nextCursor")),
            "runtimeStates": dict(states),
            "threadsWithWorkingDirectory": sum(bool(row.get("cwd")) for row in rows),
            "threadFields": sorted(rows[0].keys()) if rows else [],
        }, indent=2))
    finally:
        connection.close()


if __name__ == "__main__":
    main()
