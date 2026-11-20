import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProjectReview } from "../main/project-history-review.mjs";

test("project review keeps at most two distinct suggestions anchored to exact excerpts", () => {
  const quote = "Token expiry still needs testing.";
  const evidence = Array.from({ length: 3 }, (_, index) => ({
    session: { provider: "Codex", sessionID: String(index), updated: 42, title: "Security review" },
    messages: [{ text: "Update: " + quote, anchor: { offset: index + 1, textOffset: 3, fingerprint: "a".repeat(24) } }],
  }));
  const picks = [0, 0, 1, 2].map((session) => ({ session, message: 0, quote, next: "Test token expiry." }));
  const suggestions = parseProjectReview(JSON.stringify(picks), evidence);
  assert.deepEqual(suggestions.map(({ source }) => [source.sessionID, source.anchor.offset, source.anchor.textOffset]),
    [["0", 1, 11], ["1", 2, 11]]);
  assert.throws(() => parseProjectReview(JSON.stringify([{ ...picks[0], quote: "An invented source sentence." }]), evidence), /recorded message/);
  assert.deepEqual(parseProjectReview("[]", evidence), []);
  const withLiveContext = [{ ...evidence[0], contextOnly: true }, ...evidence.slice(1)];
  assert.deepEqual(parseProjectReview(JSON.stringify(picks), withLiveContext).map(({ source }) => source.sessionID), ["1", "2"]);
});
