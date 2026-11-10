"""Best-effort, bounded read of Codex's last reported context usage."""
import json
from pathlib import Path


def read_context(path):
    if not path:
        return None
    try:
        with Path(path).open('rb') as file:
            size = file.seek(0, 2)
            start = max(0, size - 2 * 1024 * 1024)
            file.seek(start)
            if start:
                file.readline()
            lines = file.read(2 * 1024 * 1024).splitlines()
        for line in reversed(lines):
            try:
                event = json.loads(line)
            except (ValueError, UnicodeDecodeError):
                continue
            if not isinstance(event, dict):
                continue
            payload = event.get('payload') or {}
            if not isinstance(payload, dict):
                continue
            # A pre-compaction reading no longer describes the current context.
            if event.get('type') == 'compacted' or payload.get('type') == 'context_compacted':
                return None
            if event.get('type') != 'event_msg' or payload.get('type') != 'token_count':
                continue
            info = payload.get('info') or {}
            if not isinstance(info, dict):
                return None
            last = info.get('last_token_usage') or {}
            if not isinstance(last, dict):
                return None
            used, limit = last.get('total_tokens'), info.get('model_context_window')
            if type(used) is not int or type(limit) is not int or used < 0 or limit <= 0:
                return None
            return {'used': used, 'limit': limit, 'reportedAt': event.get('timestamp') or '', 'source': 'Codex last reported usage'}
    except (OSError, ValueError, TypeError):
        pass
    return None
