"""Explicit text follow-ups through Codex's supported queue command. Never types into a terminal."""
import json
import re
import subprocess
import sys
import uuid
from codex_bridge import Client

MAX_BYTES = 32000
MAX_PAYLOAD_BYTES = 256000


def eligibility(client, sid):
    uuid.UUID(sid)  # Never accept a display name: names need not be unique.
    if sid not in client.request('thread/loaded/list', {}).get('data', []):
        return 'Open this session in Codex before sending a follow-up.'
    thread = client.request('thread/read', {'threadId': sid, 'includeTurns': False})['thread']
    if thread.get('id') != sid:
        return 'The session could not be verified. Refresh and try again.'
    status = thread.get('status') or {}
    if status.get('type') not in ('idle', 'active'):
        return 'This session is not available for replies.'
    if status.get('activeFlags'):
        return 'Answer the pending question or approval in the terminal first.'
    return None


def run(payload, client_factory=Client, runner=subprocess.run):
    sid, executable = payload['sessionID'], payload['executable']
    text = payload.get('text', '')
    sending = payload.get('action') == 'send'
    if payload.get('provider') == 'Copilot':
        import copilot_reply
        return copilot_reply.run(payload)
    if payload.get('provider') == 'Claude':
        import claude_channel
        if payload.get('action') == 'setup':
            try:
                return claude_channel.setup(payload)
            except (ValueError, OSError) as error:
                return {'outcome': 'unavailable', 'message': str(error)}
        return claude_channel.run(payload)
    if payload.get('provider') != 'Codex':
        return {'outcome': 'unavailable', 'message': 'Inline replies are currently available for Codex only.'}
    if sending and (not isinstance(text, str) or not text.strip() or len(text.encode()) > MAX_BYTES or '\0' in text):
        return {'outcome': 'notSent', 'message': 'Enter a message up to 32 KB without null characters.'}
    try:
        help_result = runner([executable, 'queue', '--help'], capture_output=True, text=True, timeout=8)
        if help_result.returncode or '--thread' not in help_result.stdout or '--message' not in help_result.stdout:
            return {'outcome': 'unavailable', 'message': 'Update Codex to a version that supports queued messages.'}
        with client_factory() as client:
            reason = eligibility(client, sid)
        if reason:
            return {'outcome': 'unavailable', 'message': reason}
    except Exception:
        return {'outcome': 'unavailable', 'message': 'Could not verify the Codex connection. No message was sent.'}
    if not sending:
        return {'outcome': 'ready', 'message': 'Text follow-ups use this session’s Codex model and permissions.'}
    try:
        result = runner([executable, 'queue', '--thread', sid, '--message', text],
                        capture_output=True, text=True, timeout=20)
        # A successful process alone is not delivery confirmation. Verify its exact target receipt.
        receipt = re.fullmatch(r'Queued message ([0-9a-f-]+) for thread ' + re.escape(sid) + r'\.', result.stdout.strip())
        if result.returncode == 0 and receipt:
            return {'outcome': 'queued', 'message': 'Queued in Codex. It will run when this session is ready.', 'messageID': receipt.group(1)}
    except Exception:
        pass
    return {'outcome': 'uncertain', 'message': 'Delivery could not be confirmed. Check the terminal before sending again; this message may already be queued.'}


def main():
    try:
        raw = sys.stdin.buffer.read(MAX_PAYLOAD_BYTES + 1)
        if len(raw) > MAX_PAYLOAD_BYTES:
            raise ValueError("Oversized request")
        payload = json.loads(raw)
    except (ValueError, UnicodeError):
        print(json.dumps({"outcome": "notSent", "message": "Invalid reply request. No message was sent."}))
        return
    print(json.dumps(run(payload)))


if __name__ == '__main__':
    main()
