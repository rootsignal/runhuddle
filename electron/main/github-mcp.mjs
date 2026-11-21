import { stripVTControlCharacters } from "node:util";

const endpoint = "https://api.githubcopilot.com/mcp/";
const protocol = "2025-06-18";

async function rpcResponse(response, id) {
  const reader = response.body?.getReader();
  if (!reader) throw Error("GitHub MCP returned an empty response.");
  const decoder = new TextDecoder();
  const stream = response.headers.get("content-type")?.includes("text/event-stream");
  let buffer = "", bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024) throw Error("GitHub MCP returned too much data.");
      buffer += decoder.decode(value, { stream: true });
      if (stream) {
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop();
        for (const event of events) {
          const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
          if (!data) continue;
          const message = JSON.parse(data);
          if (message.id === id) return message;
        }
      }
    }
    if (!stream) {
      const message = JSON.parse(buffer + decoder.decode());
      if (message.id === id) return message;
    }
    throw Error("GitHub MCP returned no matching response.");
  } finally {
    void reader.cancel().catch(() => {});
  }
}

async function connect(token, fetcher, toolset = "pull_requests") {
  const headers = {
    Authorization: "Bearer " + token,
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    "X-MCP-Readonly": "true",
    "X-MCP-Toolsets": toolset,
  };
  let requestID = 0;
  async function request(method, params, notification = false) {
    const id = notification ? undefined : ++requestID;
    const response = await fetcher(endpoint, {
      method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(12000),
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    }).catch(() => { throw Error("Couldn’t connect to GitHub MCP."); });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      if ([401, 403].includes(response.status)) throw Error("GitHub denied access. Check the token and repository permissions in Integrations → GitHub MCP.");
      throw Error(`GitHub MCP returned HTTP ${response.status}.`);
    }
    if (method === "initialize") {
      const session = response.headers.get("mcp-session-id");
      if (session) headers["Mcp-Session-Id"] = session;
    }
    if (notification) {
      void response.body?.cancel().catch(() => {});
      return;
    }
    const message = await rpcResponse(response, id);
    if (message.error) throw Error("GitHub MCP couldn’t complete the request.");
    return message.result;
  }
  const info = await request("initialize", { protocolVersion: protocol, capabilities: {}, clientInfo: { name: "RunHuddle", version: "1" } });
  if (!["2025-03-26", protocol, "2025-11-25"].includes(info?.protocolVersion))
    throw Error("GitHub MCP returned an unsupported protocol version.");
  headers["MCP-Protocol-Version"] = info.protocolVersion;
  await request("notifications/initialized", undefined, true);
  return async (name, args) => {
    const result = await request("tools/call", { name, arguments: args });
    if (!result || result.isError) throw Error("GitHub could not read this PR resource.");
    const text = result.content?.find((item) => item.type === "text")?.text;
    return result.structuredContent?.result ?? result.structuredContent ?? JSON.parse(text ?? "null");
  };
}

const rows = (value, ...keys) => Array.isArray(value) ? value
  : keys.map((key) => value?.[key]).find(Array.isArray) ?? [];
const clip = (value, limit = 500) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const webURL = (value) => {
  const url = typeof value === "string" ? URL.parse(value) : null;
  return url?.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
};

export async function githubMcpAccount(token, fetcher = fetch) {
  const call = await connect(token, fetcher, "context");
  const account = await call("get_me", {});
  const login = clip(account?.login);
  if (!login) throw Error("GitHub MCP could not verify your account.");
  return login;
}

function failureExcerpt(log) {
  if (typeof log !== "string") return [];
  const errors = new Set();
  const specific = new Set();
  for (const entry of log.split(/\r?\n/)) {
    const line = stripVTControlCharacters(entry).replace(/^\uFEFF?\d{4}-\d\d-\d\dT\S+\s+/, "")
      .replace(/^\uFEFF/, "").replace(/[\p{Cc}\p{Cf}]/gu, " ").trim();
    if (!/^(?:##\[error\]|npm (?:ERR!|error)(?:\s|$)|Error:|fatal:)/i.test(line)) continue;
    const message = line.replace(/^##\[error\]\s*/i, "").trim();
    if (!message || /^(?:Process completed with exit code|npm (?:ERR!|error)(?:$|\s+(?:code\s|usage:|options:|clean install a project|--)))/i.test(message)) continue;
    const safe = message.replace(/(?:github_pat_|gh[pousr]_)[a-z0-9_]+/gi, "[redacted]")
      .replace(/\b(?:Bearer|Basic)\s+[a-z0-9+/_.=-]+/gi, "[redacted]")
      .replace(/\b([\w.-]*(?:token|password|secret|api[_-]?key)[\w.-]*)(\s*[:=]\s*).*$/gi, "$1$2[redacted]");
    const lines = /^npm (?:ERR!|error)\s+(?:Missing|Invalid):/i.test(safe) ? specific : errors;
    lines.add(clip(safe, 220));
  }
  return [...specific, ...errors].slice(0, 3);
}

export async function githubActionsFailure(token, { owner, repo }, jobURL, fetcher = fetch) {
  const url = webURL(jobURL);
  const match = url && /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)\/job\/(\d+)(?:[?#].*)?$/i.exec(url);
  if (!match || match[1].toLowerCase() !== owner.toLowerCase() || match[2].toLowerCase() !== repo.toLowerCase()
    || !Number.isSafeInteger(Number(match[4])) || Number(match[4]) <= 0)
    throw Error("This check does not link to a GitHub Actions job in the current repository.");
  const [, , , runId, jobId] = match;
  const call = await connect(token, fetcher, "actions");
  const [jobResult, logResult] = await Promise.allSettled([
    call("actions_get", { owner, repo, method: "get_workflow_job", resource_id: jobId }),
    call("get_job_logs", { owner, repo, job_id: Number(jobId), return_content: true, tail_lines: 180 }),
  ]);
  const job = jobResult.status === "fulfilled" ? jobResult.value?.job ?? jobResult.value : undefined;
  if (String(job?.id) !== jobId || String(job?.run_id) !== runId)
    throw Error("GitHub could not verify this job. Check that your token has Actions read access for this repository.");
  const log = logResult.status === "fulfilled" ? logResult.value : undefined;
  const excerpt = failureExcerpt(log?.logs_content);
  const step = rows(job.steps).find((item) => item.conclusion === "failure" || item.conclusion === "timed_out");
  return { workflow: clip(job.workflow_name, 120), job: clip(job.name, 120),
    step: clip(step?.name, 120), excerpt, logsUnavailable: typeof log?.logs_content !== "string" };
}

export async function githubPullRequest(token, { owner, repo, head, target }, fetcher = fetch) {
  const call = await connect(token, fetcher);
  const list = await call("list_pull_requests", { owner, repo, head: owner + ":" + head, state: "open", perPage: 15 });
  const listed = Array.isArray(list) ? list : list?.pull_requests ?? list?.pullRequests ?? list?.items;
  if (!Array.isArray(listed)) throw Error("GitHub MCP returned an unexpected pull request list.");
  const candidates = listed
    .filter((item) => Number.isSafeInteger(item?.number) && item.number > 0 &&
      (!item.head?.ref || item.head.ref === head));
  const pr = candidates.find((item) => target && item.base?.ref === target) ?? candidates[0];
  if (!pr) return null;
  const baseURL = `https://github.com/${owner}/${repo}/pull/${pr.number}`;
  const methods = ["get_check_runs", "get_status", "get_reviews", "get_review_comments"];
  const results = await Promise.allSettled(methods.map((method) => call("pull_request_read", {
    owner, repo, pullNumber: pr.number, method, perPage: method === "get_review_comments" ? 10 : 30,
  })));
  const [runs, status, reviews, threads] = results.map((result) => result.status === "fulfilled" ? result.value : null);
  const checks = [
    ...rows(runs?.check_runs ?? runs?.checkRuns ?? runs, "check_runs", "checkRuns", "checks").map((check) => ({
      name: clip(check.name), state: clip(check.conclusion || check.status), url: webURL(check.details_url || check.html_url),
      updatedAt: clip(check.completed_at || check.started_at),
    })),
    ...rows(status?.status ?? status, "statuses").map((check) => ({
      name: clip(check.context), state: clip(check.state), url: webURL(check.target_url),
    })),
  ].filter((check) => check.name && check.state).slice(0, 30);
  const latest = new Map();
  for (const review of rows(reviews, "reviews")) {
    const author = clip(review.user?.login || review.author?.login);
    const state = clip(review.state).toUpperCase();
    if (author && ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(state))
      latest.set(author, { state, text: clip(review.body), url: webURL(review.html_url) });
  }
  const requested = [...latest.entries()].filter(([, review]) => review.state === "CHANGES_REQUESTED");
  const feedback = requested.filter(([, review]) => review.text).map(([author, review]) =>
    ({ author, text: review.text, url: review.url }));
  const threadData = threads?.review_threads ?? threads?.reviewThreads ?? threads;
  for (const thread of rows(threadData, "review_threads", "threads", "nodes")) {
    if ((thread.is_resolved ?? thread.isResolved) !== false || thread.is_outdated || thread.isOutdated) continue;
    for (const item of rows(thread.comments, "nodes").slice(0, 2)) {
      const text = clip(item.body);
      if (text) feedback.push({ author: clip(item.author?.login || item.author || item.user?.login), text,
        path: clip(item.path), line: Number.isSafeInteger(item.line) ? item.line : undefined, url: webURL(item.html_url || item.url) });
    }
  }
  const review = pr.draft ? "Draft" : requested.length ? "Changes requested"
    : [...latest.values()].some((item) => item.state === "APPROVED") ? "Approved"
      : pr.requested_reviewers?.length || pr.requested_teams?.length ? "Awaiting review" : "Open";
  const combinedState = status?.status?.state ?? status?.state;
  const statuses = rows(status?.status ?? status, "statuses");
  const states = checks.map(({ state }) => state);
  if (statuses.length && combinedState) states.push(combinedState);
  const failing = ["failure", "error", "timed_out", "action_required", "cancelled", "startup_failure", "stale"];
  const pending = ["pending", "in_progress", "queued", "requested", "waiting"];
  const passing = ["success", "neutral", "skipped"];
  let checksState = "No check status";
  if (states.some((state) => failing.includes(state))) checksState = "Checks failed";
  else if (states.some((state) => pending.includes(state))) checksState = "Checks pending";
  else if (runs === null || status === null) checksState = "Checks unavailable";
  else if (states.length && states.every((state) => passing.includes(state))) checksState = "Checks passed";
  return { number: pr.number, title: clip(pr.title), head, target: clip(pr.base?.ref), url: baseURL, review,
    checksState, checks, feedback: feedback.slice(0, 12), partial: results.some((result) => result.status === "rejected") };
}
