import assert from "node:assert/strict";
import test from "node:test";
import { githubActionsFailure, githubPullRequest } from "../main/github-mcp.mjs";

test("GitHub MCP reads a matching open PR, check results, and unresolved feedback", async () => {
  const requests = [];
  const pr = (number, ref) => ({ number, title: "Retain review position", head: { ref: "feature" }, base: { ref } });
  const data = {
    get_check_runs: { check_runs: [{ name: "Build", status: "completed", conclusion: "failure" }] },
    get_status: { state: "pending", statuses: [] },
    get_reviews: [{ user: { login: "reviewer" }, state: "CHANGES_REQUESTED", body: "Add a test." }],
    get_review_comments: { review_threads: [
      { is_resolved: false, comments: [{ author: "reviewer", body: "Cover resize.", path: "fixture.txt", line: 7,
        html_url: "https://github.com/example/demo/pull/42#discussion_r7" }] },
      { is_resolved: true, comments: [{ body: "Resolved comment" }] },
    ] },
  };
  const fetcher = async (url, request) => {
    assert.equal(url, "https://api.githubcopilot.com/mcp/");
    assert.equal(request.headers["X-MCP-Readonly"], "true");
    assert.equal(request.redirect, "error");
    const { id, method, params } = JSON.parse(request.body);
    if (method === "initialize") {
      return new Response(`data: ${JSON.stringify({ id, result: { protocolVersion: "2025-06-18" } })}\n\n`, {
        headers: { "Content-Type": "text/event-stream", "Mcp-Session-Id": "fixture" },
      });
    }
    assert.equal(request.headers["Mcp-Session-Id"], "fixture");
    if (method === "notifications/initialized") return new Response(null, { status: 202 });
    assert.equal(method, "tools/call");
    const { name, arguments: args } = params;
    requests.push(name);
    if (name === "list_pull_requests") {
      assert.equal(args.head, "example:feature");
      assert.equal(args.state, "open");
      return Response.json({ id, result: { content: [{ type: "text", text: JSON.stringify([pr(9, "main"), pr(42, "develop")]) }] } });
    }
    assert.equal(name, "pull_request_read");
    assert.equal(args.pullNumber, 42);
    assert.ok(Object.hasOwn(data, args.method));
    return Response.json({ id, result: { structuredContent: data[args.method] } });
  };

  const result = await githubPullRequest("fixture", { owner: "example", repo: "demo", head: "feature", target: "develop" }, fetcher);
  assert.equal(requests.length, 5);
  assert.equal(result.number, 42);
  assert.equal(result.target, "develop");
  assert.equal(result.checksState, "Checks failed");
  assert.equal(result.review, "Changes requested");
  assert.equal(result.partial, false);
  assert.deepEqual(result.feedback.map(({ text }) => text), ["Add a test.", "Cover resize."]);
  assert.equal(result.feedback[1].url, "https://github.com/example/demo/pull/42#discussion_r7");
});

test("Actions failure reads only the linked job and returns a bounded error excerpt", async () => {
  const repo = { owner: "example", repo: "demo" };
  const url = "https://github.com/example/demo/actions/runs/123/job/456";
  const calls = [];
  const fetcher = async (_url, request) => {
    const { id, method, params } = JSON.parse(request.body);
    assert.equal(request.headers["X-MCP-Readonly"], "true");
    assert.equal(request.headers["X-MCP-Toolsets"], "actions");
    if (method === "initialize") return Response.json({ id, result: { protocolVersion: "2025-06-18" } });
    if (method === "notifications/initialized") return new Response(null, { status: 202 });
    calls.push(params);
    const data = params.name === "actions_get" ? {
      job: { id: 456, run_id: 123, workflow_name: "Electron CI", name: "test (macOS)",
        steps: [{ name: "Run npm ci", conclusion: "failure" }] },
    } : {
      logs_content: [
        "2026-11-21T02:00:00.000Z ##[group]Run npm ci",
        "npm error code EUSAGE",
        "npm error",
        "\u001b[31m2026-11-21T02:00:00.000Z npm error Missing: @emnapi/core from lock file\u001b[0m",
        "npm ERR! Missing: @emnapi/runtime from lock file",
        "##[error]Authorization: Bearer github_pat_fixture_token",
        "##[error]Process completed with exit code 1.",
        "##[error]Additional error outside the excerpt limit.",
      ].join("\n"),
    };
    return Response.json({ id, result: { content: [{ type: "text", text: JSON.stringify(data) }] } });
  };
  await assert.rejects(githubActionsFailure("fixture", repo, url.replace("/demo/", "/other/"), fetcher), /current repository/);
  assert.equal(calls.length, 0);
  const result = await githubActionsFailure("fixture", repo, url, fetcher);
  assert.deepEqual(calls, [
    { name: "actions_get", arguments: { ...repo, method: "get_workflow_job", resource_id: "456" } },
    { name: "get_job_logs", arguments: { ...repo, job_id: 456, return_content: true, tail_lines: 180 } },
  ]);
  assert.deepEqual(result, {
    workflow: "Electron CI", job: "test (macOS)", step: "Run npm ci", logsUnavailable: false,
    excerpt: ["npm error Missing: @emnapi/core from lock file", "npm ERR! Missing: @emnapi/runtime from lock file",
      "Authorization: Bearer [redacted]"],
  });
});
