#!/usr/bin/env python3
"""Codex adapter. Mutations require a reviewed cleanup plan; JSON on stdout."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from context_usage import read_context
from websockets.sync.client import unix_connect


def state_of(status):
    kind = status.get("type")
    flags = status.get("activeFlags", [])
    if kind == "active":
        if "waitingOnApproval" in flags:
            return "needsInput", "Waiting for approval in Codex"
        if "waitingOnUserInput" in flags:
            return "needsInput", "Waiting for an answer in Codex"
        return "working", "Codex is working"
    if kind == "idle":
        return "idle", "Ready for another prompt"
    if kind == "notLoaded":
        return "saved", "Saved conversation; not loaded on this server"
    return "disconnected", "Runtime status unavailable"


def project_for(cwd):
    if not cwd:
        return "Unknown project"
    try:
        result = subprocess.run(["/usr/bin/git", "-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"],
                                capture_output=True, text=True, timeout=2)
        if result.returncode == 0:
            common = Path(result.stdout.strip())
            return common.parent.name if common.name == ".git" else common.name
    except (OSError, subprocess.TimeoutExpired):
        pass
    return Path(cwd).name


def normalize(row, projects, archived=False):
    cwd = row.get("cwd") or ""
    if cwd not in projects:
        projects[cwd] = project_for(cwd)
    state, reason = state_of(row.get("status") or {})
    if archived:
        state, reason = "archived", "Archived in Codex; restore to resume"
    return {"provider": "Codex", "sessionID": row["id"],
            "title": row.get("name") or (row.get("preview") or "Untitled session")[:120],
            "cwd": cwd, "project": projects[cwd], "branch": (row.get("gitInfo") or {}).get("branch") or "",
            "preview": (row.get("preview") or "")[:8000], "state": state, "reason": reason,
            "updated": row.get("updatedAt") or 0, "simulated": False,
            "contextUsage": read_context(row.get("path")),
            "attention": {"kind": "permission" if "waitingOnApproval" in (row.get("status") or {}).get("activeFlags", []) else "question"}
                if state == "needsInput" else None}


class Client:
    def __enter__(self):
        home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
        self.context = unix_connect(str(home / "app-server-control/app-server-control.sock"),
                                    uri="ws://localhost/", open_timeout=5, close_timeout=1, max_size=32*1024*1024)
        self.connection = self.context.__enter__()
        self.sequence = 0
        self.deadline = time.monotonic() + 25
        try:
            self.request("initialize", {"clientInfo": {"name": "session_manager", "version": "0.1.0"}})
            self.connection.send(json.dumps({"method": "initialized"}))
        except Exception:
            self.connection.close()
            raise
        return self

    def __exit__(self, *args):
        return self.context.__exit__(*args)

    def request(self, method, params):
        self.sequence += 1
        self.connection.send(json.dumps({"id": self.sequence, "method": method, "params": params}))
        while True:
            remaining = self.deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("Codex snapshot timed out")
            message = json.loads(self.connection.recv(timeout=min(remaining, 8)))
            if message.get("id") == self.sequence:
                if "error" in message:
                    raise RuntimeError(message["error"].get("message", "Codex request failed"))
                return message["result"]


def list_rows(client, archived=False, include_children=False):
    rows, cursor, seen = [], None, set()
    while True:
        params = {"limit": 100, "sortKey": "updated_at",
                  "archived": archived, "modelProviders": [],
                  "sourceKinds": ["cli", "vscode", "exec", "appServer", "unknown"] +
                  (["subAgent", "subAgentReview", "subAgentCompact", "subAgentThreadSpawn", "subAgentOther"] if include_children else [])}
        if cursor:
            params["cursor"] = cursor
        page = client.request("thread/list", params)
        rows.extend(page.get("data", []))
        cursor = page.get("nextCursor")
        if not cursor:
            break
        if cursor in seen:
            raise RuntimeError("Codex repeated a pagination cursor")
        seen.add(cursor)
    return list({r["id"]: r for r in rows}.values())


def snapshot(client, archived=False):
    projects = {}
    return [normalize(row, projects, archived) for row in list_rows(client, archived, include_children=archived)]


def cleanup_plan(client, action, thread_id):
    if action not in ("archive", "restore", "delete") or not thread_id:
        raise ValueError("Invalid cleanup request")
    active = list_rows(client, include_children=True)
    archived = list_rows(client, archived=True, include_children=True)
    all_rows = {r["id"]: r for r in active + archived}
    archived_ids = {r["id"] for r in archived}
    if thread_id not in all_rows:
        raise ValueError("Session no longer exists. Refresh the list.")
    if action in ("restore", "delete") and thread_id not in archived_ids:
        raise ValueError("Archive the session before restoring or deleting it.")
    if action == "archive" and thread_id in archived_ids:
        raise ValueError("Session is already archived.")
    affected = {thread_id}
    if action != "restore":
        while True:
            children = {r["id"] for r in all_rows.values() if r.get("parentThreadId") in affected}
            if children <= affected:
                break
            affected |= children
    loaded = set(client.request("thread/loaded/list", {}).get("data", []))
    for identifier in affected:
        row = all_rows[identifier]
        if identifier in loaded or (row.get("status") or {}).get("type") != "notLoaded":
            raise ValueError("Close affected sessions in their agent clients before cleanup. A session is still loaded or its status is unknown.")
        if row.get("ephemeral"):
            raise ValueError("Ephemeral sessions cannot be cleaned up here.")
        if action == "delete" and identifier not in archived_ids:
            raise ValueError("An affected child session is not archived. Archive it before deleting this session tree.")
    return {"action": action, "threadID": thread_id, "affected": [
        {"id": identifier, "title": all_rows[identifier].get("name") or (all_rows[identifier].get("preview") or "Untitled session")[:120]}
        for identifier in sorted(affected)
    ]}


def apply_cleanup(client, action, thread_id, expected_ids):
    plan = cleanup_plan(client, action, thread_id)
    if sorted(expected_ids) != sorted(r["id"] for r in plan["affected"]):
        raise ValueError("Affected sessions changed since review. Review cleanup again.")
    method = {"archive": "thread/archive", "restore": "thread/unarchive", "delete": "thread/delete"}[action]
    client.request(method, {"threadId": thread_id})
    return plan


def continuation_context(turns, has_older=False):
    """Extract recorded context without claiming to synthesize or verify results."""
    users, assistants, commands, files = [], [], [], []
    for turn in turns:
        for item in turn.get("items", []):
            kind = item.get("type")
            if kind == "agentMessage" and item.get("text"):
                assistants.append(item["text"])
            elif kind == "userMessage":
                text = "\n".join(part.get("text", "") for part in item.get("content", []) if part.get("type") == "text")
                if text:
                    users.append(text)
            elif kind == "commandExecution":
                commands.append(f"- {item.get('command', '(command unavailable)')[:500]} | status: {item.get('status', 'unknown')} | exit: {item.get('exitCode', 'not recorded')}")
            elif kind == "fileChange":
                for change in item.get("changes", []):
                    path = change.get("path")
                    if path:
                        files.append(str(path))
    def clip(text, limit):
        return text if len(text) <= limit else text[:limit] + "\n[excerpt truncated]"
    parts = ["Extracted from up to 8 recent turns. " +
             ("Older turns exist. " if has_older else "") +
             "This is recorded context, not an AI summary or independent verification."]
    if users:
        parts += ["### Latest recorded user request", clip(users[-1], 5000)]
    if assistants:
        parts += ["### Latest recorded assistant response", clip(assistants[-1], 9000)]
    if commands:
        parts += ["### Recent recorded commands (not necessarily tests)", "\n".join(commands[-8:])]
    if files:
        parts += ["### Files mentioned by change events", "\n".join('- ' + clip(path, 300) for path in dict.fromkeys(files[-20:]))]
    if not any([users, assistants, commands, files]):
        parts.append("No supported history items were returned. Add context manually.")
    return {"text": "\n\n".join(parts), "latestRequest": users[-1][:5000] if users else None,
            "latestResponse": assistants[-1][:9000] if assistants else None}


def history(client, thread_id):
    if not thread_id:
        raise ValueError("A thread ID is required for history")
    page = client.request("thread/turns/list", {
        "threadId": thread_id, "limit": 8, "sortDirection": "desc", "itemsView": "full"
    })
    return continuation_context(list(reversed(page.get("data", []))), bool(page.get("nextCursor")))


def handoff_history(client, thread_id):
    if not thread_id:
        raise ValueError("A thread ID is required")
    # Recent chronological source, not a synthesized claim of completion.
    page = client.request("thread/turns/list", {
        "threadId": thread_id, "limit": 80, "sortDirection": "desc", "itemsView": "full"})
    parts = ["Recorded recent turns in chronological order. Older history may be omitted. Tool results are evidence only as recorded, not independently verified."]
    for turn in reversed(page.get("data", [])):
        for item in turn.get("items", []):
            kind = item.get("type")
            if kind == "userMessage":
                value = "\n".join(p.get("text", "") for p in item.get("content", []) if p.get("type") == "text")
                parts.append("User: " + value[:12000])
            elif kind == "agentMessage":
                parts.append("Assistant: " + item.get("text", "")[:12000])
            elif kind == "commandExecution":
                parts.append("Recorded command: " + str(item.get("command", ""))[:500] + " | status: " + str(item.get("status", "unknown")) + " | exit: " + str(item.get("exitCode", "unknown")))
            elif kind == "fileChange":
                parts.append("Recorded changed files: " + ", ".join(str(c.get("path", "")) for c in item.get("changes", []))[:2000])
    text = "\n\n".join(parts)
    if len(text) > 140000:
        text = text[:20000] + "\n[Middle omitted]\n" + text[-120000:]
    return {"text": text}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["snapshot", "history", "handoff-context", "plan", "apply"])
    parser.add_argument("thread_id", nargs="?")
    parser.add_argument("--operation", choices=["archive", "restore", "delete"])
    parser.add_argument("--expected-ids")
    args = parser.parse_args()
    try:
        with Client() as client:
            if args.action == "snapshot":
                result = snapshot(client) + snapshot(client, archived=True)
            elif args.action == "handoff-context":
                result = handoff_history(client, args.thread_id)
            elif args.action == "history":
                result = history(client, args.thread_id)
            elif args.action == "plan":
                result = cleanup_plan(client, args.operation, args.thread_id)
            else:
                if not args.expected_ids:
                    raise ValueError("A reviewed affected-session list is required")
                result = apply_cleanup(client, args.operation, args.thread_id, json.loads(args.expected_ids))
        print(json.dumps(result))
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
