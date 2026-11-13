import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from codex_bridge import state_of, snapshot, history, continuation_context, handoff_origin


class BridgeTests(unittest.TestCase):
    def test_handoff_origin_uses_initial_user_message_not_recent_replies(self):
        class Client:
            def request(self, method, params):
                assert method == "thread/turns/list"
                assert params["sortDirection"] == "asc" and params["limit"] == 1
                return {"data": [{"items": [
                    {"type": "agentMessage", "text": "not the source"},
                    {"type": "userMessage", "content": [{"type": "text", "text": "Original handoff"}]},
                    {"type": "userMessage", "content": [{"type": "text", "text": "Later message"}]}
                ]}]}
        self.assertEqual(handoff_origin(Client(), "thread"), {"text": "Original handoff"})

    def test_history_uses_recent_paginated_turns_in_chronological_order(self):
        class Client:
            def request(self, method, params):
                assert method == "thread/turns/list"
                assert params["limit"] == 8 and params["itemsView"] == "full"
                return {"data": [
                    {"items": [{"type": "userMessage", "content": [{"type": "text", "text": "Latest request"}]}]},
                    {"items": [{"type": "userMessage", "content": [{"type": "text", "text": "Old request"}]}]}
                ], "nextCursor": "older"}
        result = history(Client(), "thread")["text"]
        self.assertIn("Latest request", result)
        self.assertNotIn("Old request", result)
        self.assertIn("Older turns exist", result)

    def test_handoff_preserves_failure_and_truncates_large_text(self):
        result = continuation_context([{"items": [
            {"type": "agentMessage", "text": "x" * 12000},
            {"type": "commandExecution", "command": "test-command", "status": "failed", "exitCode": 1},
            {"type": "fileChange", "changes": [{"path": "/tmp/file"}]}
        ]}])["text"]
        self.assertIn("status: failed | exit: 1", result)
        self.assertIn("[excerpt truncated]", result)
        self.assertIn("/tmp/file", result)
        self.assertLess(len(result), 11000)

    def test_conversation_preserves_roles_order_and_identity(self):
        result = continuation_context([{"items": [
            {"id": "u1", "type": "userMessage", "content": [{"type": "text", "text": "Question"}]},
            {"id": "a1", "type": "agentMessage", "text": "Answer"},
            {"id": "tool", "type": "commandExecution", "command": "echo hi"},
            {"id": "u2", "type": "userMessage", "content": [{"type": "text", "text": "Next question"}]}
        ]}])
        self.assertEqual([(m['id'], m['role'], m['text']) for m in result['messages']],
                         [('u1', 'user', 'Question'), ('a1', 'assistant', 'Answer'), ('u2', 'user', 'Next question')])

    def test_waiting_takes_precedence(self):
        self.assertEqual(state_of({"type": "active", "activeFlags": ["waitingOnApproval"]})[0], "needsInput")
        self.assertEqual(state_of({"type": "active", "activeFlags": ["waitingOnUserInput"]})[0], "needsInput")
        self.assertEqual(state_of({"type": "active", "activeFlags": []})[0], "working")

    def test_unknown_is_not_idle(self):
        self.assertEqual(state_of({})[0], "disconnected")
        self.assertEqual(state_of({"type": "notLoaded"})[0], "saved")

    def test_pagination_and_deduplication(self):
        class Client:
            def __init__(self): self.calls = []
            def request(self, method, params):
                self.calls.append(params)
                if len(self.calls) == 1:
                    return {"data": [{"id": "a"}], "nextCursor": "next"}
                return {"data": [{"id": "a"}, {"id": "b"}], "nextCursor": None}
        client = Client()
        rows = snapshot(client)
        self.assertEqual([row["sessionID"] for row in rows], ["a", "b"])
        self.assertEqual(client.calls[1]["cursor"], "next")

    def test_repeated_cursor_rejected(self):
        class Client:
            def request(self, method, params): return {"data": [], "nextCursor": "same"}
        with self.assertRaises(RuntimeError): snapshot(Client())


if __name__ == "__main__": unittest.main()
