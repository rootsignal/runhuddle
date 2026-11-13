import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from codex_bridge import cleanup_plan, cleanup_plan_after_close, apply_cleanup, snapshot
from unittest.mock import patch


def row(identifier, parent=None, state="notLoaded"):
    return {"id": identifier, "name": identifier, "parentThreadId": parent, "status": {"type": state}}


class FakeClient:
    def __init__(self, active=(), archived=(), loaded=()):
        self.active, self.archived, self.loaded = list(active), list(archived), list(loaded)
        self.mutations = []
    def request(self, method, params):
        if method == "thread/list":
            return {"data": self.archived if params.get("archived") else self.active}
        if method == "thread/loaded/list": return {"data": self.loaded}
        self.mutations.append((method, params))
        return {}


class CleanupTests(unittest.TestCase):
    def test_wait_for_close_rechecks_without_mutating(self):
        client = FakeClient([row("review", state="idle")], loaded=["review"])
        def closed(_):
            client.active = [row("review")]
            client.loaded = []
        with patch("codex_bridge.time.sleep", side_effect=closed):
            plan = cleanup_plan_after_close(client, "archive", "review", attempts=2)
        self.assertEqual(plan["threadID"], "review")
        self.assertEqual(client.mutations, [])

    def test_wait_covers_codex_sixty_second_unload_grace(self):
        client = FakeClient([row("review", state="idle")], loaded=["review"])
        elapsed = 0
        def advance(seconds):
            nonlocal elapsed
            elapsed += seconds
            if elapsed >= 60:
                client.active = [row("review")]
                client.loaded = []
        with patch("codex_bridge.time.sleep", side_effect=advance):
            plan = cleanup_plan_after_close(client, "archive", "review")
        self.assertEqual(elapsed, 60)
        self.assertEqual(plan["threadID"], "review")
        self.assertEqual(client.mutations, [])

    def test_wait_does_not_bypass_loaded_child_or_unknown_state(self):
        for state in ("idle", "active", "unknown"):
            client = FakeClient([row("review"), row("child", "review", state)])
            with patch("codex_bridge.time.sleep"), self.assertRaisesRegex(ValueError, "Nothing was archived"):
                cleanup_plan_after_close(client, "archive", "review", attempts=2)
            self.assertEqual(client.mutations, [])

    def test_plan_lists_descendants_but_does_not_mutate(self):
        client = FakeClient([row("parent"), row("child", "parent"), row("grandchild", "child"), row("other")])
        plan = cleanup_plan(client, "archive", "parent")
        self.assertEqual({r["id"] for r in plan["affected"]}, {"parent", "child", "grandchild"})
        self.assertEqual(client.mutations, [])

    def test_loaded_child_prevents_archive(self):
        client = FakeClient([row("parent"), row("child", "parent", "idle")])
        with self.assertRaises(ValueError): cleanup_plan(client, "archive", "parent")
        self.assertEqual(client.mutations, [])

    def test_unknown_status_prevents_mutation(self):
        client = FakeClient([{"id": "parent"}])
        with self.assertRaises(ValueError): apply_cleanup(client, "archive", "parent", ["parent"])
        self.assertFalse(client.mutations)

    def test_delete_requires_archived_root_and_children(self):
        for client in [FakeClient([row("parent")]), FakeClient([row("child", "parent")], [row("parent")])]:
            with self.assertRaises(ValueError): cleanup_plan(client, "delete", "parent")
            self.assertFalse(client.mutations)

    def test_changed_scope_prevents_mutation(self):
        client = FakeClient(archived=[row("parent"), row("new-child", "parent")])
        with self.assertRaises(ValueError): apply_cleanup(client, "delete", "parent", ["parent"])
        self.assertFalse(client.mutations)

    def test_delete_calls_only_provider_api_after_revalidation(self):
        client = FakeClient(archived=[row("parent"), row("child", "parent")])
        apply_cleanup(client, "delete", "parent", ["parent", "child"])
        self.assertEqual(client.mutations, [("thread/delete", {"threadId": "parent"})])

    def test_restore_affects_only_selected_root(self):
        client = FakeClient(archived=[row("parent"), row("child", "parent")])
        plan = apply_cleanup(client, "restore", "parent", ["parent"])
        self.assertEqual(len(plan["affected"]), 1)
        self.assertEqual(client.mutations, [("thread/unarchive", {"threadId": "parent"})])

    def test_combined_plan_is_read_only_and_lists_descendants(self):
        client = FakeClient([row("parent"), row("child", "parent")])
        plan = cleanup_plan(client, "archive-delete", "parent")
        self.assertEqual({r["id"] for r in plan["affected"]}, {"parent", "child"})
        self.assertEqual(client.mutations, [])

    def test_combined_archives_then_revalidates_before_delete(self):
        class ArchivingClient(FakeClient):
            def request(self, method, params):
                result = super().request(method, params)
                if method == "thread/archive":
                    self.archived += self.active
                    self.active = []
                return result
        client = ArchivingClient([row("parent"), row("child", "parent")])
        apply_cleanup(client, "archive-delete", "parent", ["parent", "child"])
        self.assertEqual([m[0] for m in client.mutations], ["thread/archive", "thread/delete"])

    def test_combined_does_not_delete_if_scope_changes_after_archive(self):
        class ChangingClient(FakeClient):
            def request(self, method, params):
                result = super().request(method, params)
                if method == "thread/archive":
                    self.archived = self.active + [row("unreviewed", "parent")]
                    self.active = []
                return result
        client = ChangingClient([row("parent")])
        with self.assertRaises(ValueError):
            apply_cleanup(client, "archive-delete", "parent", ["parent"])
        self.assertEqual([m[0] for m in client.mutations], ["thread/archive"])

    def test_combined_skips_archive_for_archived_history_and_rejects_live(self):
        client = FakeClient(archived=[row("parent")])
        apply_cleanup(client, "archive-delete", "parent", ["parent"])
        self.assertEqual([m[0] for m in client.mutations], ["thread/delete"])
        busy = FakeClient([row("parent", state="idle")], loaded=["parent"])
        with self.assertRaises(ValueError):
            apply_cleanup(busy, "archive-delete", "parent", ["parent"])
        self.assertEqual(busy.mutations, [])

    def test_archived_snapshot_has_archived_status(self):
        self.assertEqual(snapshot(FakeClient(archived=[row("parent")]), archived=True)[0]["state"], "archived")


if __name__ == "__main__": unittest.main()
