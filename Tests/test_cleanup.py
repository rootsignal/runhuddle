import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from codex_bridge import cleanup_plan, apply_cleanup, snapshot


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

    def test_archived_snapshot_has_archived_status(self):
        self.assertEqual(snapshot(FakeClient(archived=[row("parent")]), archived=True)[0]["state"], "archived")


if __name__ == "__main__": unittest.main()
