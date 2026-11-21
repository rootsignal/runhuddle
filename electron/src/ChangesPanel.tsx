import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { readPosition, savePosition } from "./dashboard-position";
import { Icon } from "./Icons";
import { PreparePullRequest } from "./PreparePullRequest";
import { GitBar } from "./GitBar";
import { DiffReview } from "./DiffReview";
import type { GitBranchAction, GitChanges, GitCheckoutOptions, GitFile, Session } from "./types";
const branchLabel = (ref: string) => ref.replace(/^refs\/(heads|remotes)\//, "");
const comparisonKey = (repo: Pick<GitChanges, "root" | "branch">) => "gitComparison:" + JSON.stringify([repo.root, repo.branch]);

type ChangesPosition = { mode: string; revision: string; file?: Pick<GitFile, "path" | "area">; scrollTop?: number };

export function ChangesPanel({
  cwd,
  onClose,
  inline = false,
  active = true,
  positionKey,
  preferUncommitted = false,
  session,
  onDraftFollowUp,
}: {
  cwd: string;
  onClose: () => void;
  inline?: boolean;
  active?: boolean;
  positionKey?: string;
  preferUncommitted?: boolean;
  session?: Pick<Session, "provider" | "sessionID" | "title">;
  onDraftFollowUp?: (text: string) => boolean;
}) {
  const commitHint = useId();
  const [prRefresh, setPrRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [pullRequestTarget, setPullRequestTarget] = useState<string>();
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  const host = document.getElementById("review-stage");
  const storageKey = positionKey ? "dashboardChanges:" + positionKey : undefined;
  const [initial] = useState(() => storageKey && !preferUncommitted
    ? readPosition<ChangesPosition>(storageKey, { mode: "working", revision: "" })
    : { mode: "working", revision: "" });
  const position = useRef<ChangesPosition>(initial);
  const filePositions = useRef(new Map<string, number>());
  const fileList = useRef<HTMLElement>(null);
  const fileKey = (file: GitFile) => JSON.stringify([mode, data?.comparison?.targetRef, data?.revision ?? revision, file.area, file.path]);
  const [mode, setMode] = useState(initial.mode);
  const [revision, setRevision] = useState(initial.revision);
  function saveChanges(next: ChangesPosition) {
    position.current = next;
    if (storageKey) savePosition(storageKey, next);
  }
  const [entryHunk, setEntryHunk] = useState<"first" | "last">();
  function selectFile(file: GitFile, hunk?: "first" | "last") {
    setEntryHunk(hunk);
    saveChanges({ mode, revision: data?.revision ?? revision, file: { path: file.path, area: file.area }, scrollTop: filePositions.current.get(fileKey(file)) ?? 0 });
    void preview(file);
  }
  const [data, setData] = useState<GitChanges | null>(null);
  const [selected, setSelected] = useState<GitFile | null>(null);
  const selectedRef = useRef<GitFile>(null);
  const [diff, setDiff] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const generation = useRef(0),
    request = useRef(0);
  async function preview(
    file: GitFile,
    version = generation.current,
    commit = data?.revision,
    quiet = false,
    compareRef = data?.comparison?.targetRef,
  ) {
    const token = ++request.current;
    openRef.current = true;
    selectedRef.current = file;
    setOpen(true);
    setSelected(file);
    if (!quiet) { setDiff(""); setReading(true); }
    try {
      const text = await window.runhuddle.gitDiff(
        cwd,
        file.path,
        file.area,
        mode,
        commit,
        compareRef,
      );
      if (version === generation.current && token === request.current)
        setDiff(
          text.length > 512000 || text.split("\n").length > 4000
            ? text.slice(0, 512000).split("\n").slice(0, 4000).join("\n") +
                "\n… Preview truncated. Open the file locally to review the remaining content."
            : text,
        );
    } catch (e) {
      if (version === generation.current && token === request.current)
        setDiff(String(e));
    } finally {
      if (version === generation.current && token === request.current)
        setReading(false);
    }
  }
  async function refresh(keepReview = false, quiet = false) {
    const version = ++generation.current;
    ++request.current;
    if (!quiet) setLoading(true);
    setError("");
    if (!quiet) setDiff("");
    setReading(false);
    if (!cwd) {
      setData(null);
      setSelected(null);
      setLoading(false);
      return;
    }
    try {
      const knownPreference = mode === "compare" && data ? readPosition(comparisonKey(data), "") : "";
      let next = await window.runhuddle.gitChanges(cwd, mode, revision, knownPreference);
      if (version !== generation.current) return;
      const preference = mode === "compare" ? readPosition(comparisonKey(next), "") : "";
      if (preference !== knownPreference) {
        next = await window.runhuddle.gitChanges(cwd, mode, revision, preference);
        if (version !== generation.current) return;
      }
      setData(next);
      window.dispatchEvent(
        new CustomEvent("repository-refreshed", { detail: cwd }),
      );
      const saved = storageKey ? position.current.file : undefined;
      const target = saved ?? selectedRef.current;
      const file = target && (next.files.find((f) => f.path === target.path && f.area === target.area) ??
        (inline && mode === "working" ? next.files.find((f) => f.path === target.path) : undefined));
      if (saved && file && file.area !== saved.area)
        saveChanges({ mode, revision: next.revision ?? revision, file, scrollTop: 0 });
      selectedRef.current = file ?? null;
      setSelected(file || null);
      if (file && (saved || (keepReview && openRef.current))) void preview(file, version, next.revision, inline && quiet && openRef.current, next.comparison?.targetRef);
      if (!file && saved) saveChanges({ mode, revision: next.revision ?? revision });
      if (!file) setOpen(false);
    } catch (e) {
      if (version === generation.current) {
        setError(String(e).replace(/^Error: /, ""));
        setData(null);
        setSelected(null);
      }
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (!storageKey) setRevision("");
    setMessage(""); setActionError(""); setNotice(""); setPullRequestTarget(undefined);
  }, [cwd]);
  useEffect(() => {
    openRef.current = false;
    selectedRef.current = null;
    setOpen(false);
    setData(null);
    setSelected(null);
    void refresh();
    return () => {
      ++generation.current;
      ++request.current;
    };
  }, [cwd, mode, revision]);
  const refreshCurrent = useRef(() => {});
  refreshCurrent.current = () => { void refresh(true, true); };
  const wasActive = useRef(active);
  useEffect(() => {
    if (inline && active && !wasActive.current) refreshCurrent.current();
    wasActive.current = active;
  }, [inline, active]);
  useEffect(() => {
    const unsubscribe = window.runhuddle.onEvent(e => {
      if (e.event === "git" && e.cwd === cwd) refreshCurrent.current();
    });
    const focus = () => refreshCurrent.current();
    window.addEventListener("focus", focus);
    return () => { unsubscribe(); window.removeEventListener("focus", focus); };
  }, [cwd]);
  async function act(action: "stage" | "unstage" | "stage-all" | "unstage-all" | "commit" | "push" | "commit-push", input = "") {
    setBusy(true); setActionError(""); setNotice("");
    try {
      if (action === "commit-push") {
        await window.runhuddle.gitAction(cwd, "commit", input);
        setMessage(""); setNotice("Committed staged changes.");
        try { await window.runhuddle.gitAction(cwd, "push"); setNotice("Committed and pushed."); }
        catch (e) { setActionError("Commit succeeded, but push failed: " + String(e).replace(/^Error: /, "")); }
      } else await window.runhuddle.gitAction(cwd, action, input);
      if (action === "commit") { setMessage(""); setNotice("Committed staged changes."); }
      if (action === "push") setNotice("Push completed.");
      await refresh(true, true);
    } catch(e) { setActionError(String(e).replace(/^Error: /, "")); }
    finally { setBusy(false); }
  }
  async function branchAction(action: GitBranchAction | "push", options: GitCheckoutOptions) {
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      const next = await window.runhuddle.gitAction(cwd, action, options);
      if (action === "switch-branch" || action === "create-branch") {
        filePositions.current.clear();
        saveChanges({ mode: "working", revision: "" });
        setRevision("");
        setMode("working");
        openRef.current = false;
        selectedRef.current = null;
        setOpen(false);
        setSelected(null);
        setData(next);
        setNotice(`Checked out ${next.branch}.`);
        if (mode !== "working") return;
      } else setNotice({
        fetch: "Remote references fetched.",
        pull: "Pull complete.",
        push: "Push complete.",
        publish: `Published ${next.branch}.`,
      }[action]);
      await refresh(true, true);
    } finally { setBusy(false); }
  }
  async function openPullRequest() {
    if (!data) return;
    setActionError("");
    try {
      const preference = readPosition(comparisonKey(data), "");
      const target = (await window.runhuddle.gitChanges(cwd, "compare", "", preference)).comparison?.targetRef;
      if (!target) throw Error("Choose a pull request target in Compare branch.");
      setPullRequestTarget(target);
    } catch (reason) {
      setActionError(String(reason).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""));
    }
  }
  const orderedFiles = data?.files.slice().sort((left, right) =>
    Number(right.area === "staged") - Number(left.area === "staged")) ?? [];
  const fileIndex = selected ? orderedFiles.findIndex((file) => file.path === selected.path && file.area === selected.area) : -1;
  useLayoutEffect(() => {
    if (!inline || !active || fileIndex < 0) return;
    const item = fileList.current?.querySelector<HTMLElement>("[aria-current=true]");
    const panel = item?.closest<HTMLElement>(".changes-panel");
    if (!item || !panel || !panel.getClientRects().length) return;
    const bounds = panel.getBoundingClientRect();
    const row = item.getBoundingClientRect();
    if (row.top < bounds.top) panel.scrollTop += row.top - bounds.top;
    else if (row.bottom > bounds.bottom) panel.scrollTop += row.bottom - bounds.bottom;
  }, [inline, active, fileIndex, selected?.path, selected?.area]);
  const review = open && selected && data && !loading ? (
    <DiffReview inline={inline} active={active} root={data.root} file={selected} diff={diff} loading={reading}
      scrollTop={storageKey ? position.current.scrollTop : undefined}
      onScrollPosition={storageKey ? (scrollTop) => {
        filePositions.current.set(fileKey(selected), scrollTop);
        saveChanges({ ...position.current, scrollTop });
      } : undefined}
      entryHunk={entryHunk}
      onPreviousChangeFile={inline && fileIndex > 0 ? () => selectFile(orderedFiles[fileIndex - 1], "last") : undefined}
      onNextChangeFile={inline && fileIndex >= 0 && fileIndex + 1 < orderedFiles.length ? () => selectFile(orderedFiles[fileIndex + 1], "first") : undefined}
      filePosition={inline && fileIndex >= 0 ? { index: fileIndex + 1, total: orderedFiles.length } : undefined}
      onPreviousFile={inline && fileIndex > 0 ? () => selectFile(orderedFiles[fileIndex - 1]) : undefined}
      onNextFile={inline && fileIndex >= 0 && fileIndex + 1 < orderedFiles.length ? () => selectFile(orderedFiles[fileIndex + 1]) : undefined}
      onClose={() => {
        setEntryHunk(undefined);
        if (storageKey) saveChanges({ mode, revision: data.revision ?? revision });
        openRef.current = false;
        setOpen(false);
        if (inline) requestAnimationFrame(() => fileList.current?.querySelector<HTMLElement>("[aria-current=true]")?.focus());
      }} />
  ) : null;

  const commitForm = data && (
    <form className="commit-form" onSubmit={e => { e.preventDefault(); void act("commit", message); }}>
      <textarea aria-label="Commit message" placeholder="Commit message" value={message} onChange={e => setMessage(e.target.value)} disabled={busy} />
      {!data.files.some(f => f.area === "staged") && <small className="commit-hint" id={commitHint}>Stage files with + before committing.</small>}
      <div className="commit-buttons"><button aria-busy={busy} aria-describedby={!data.files.some(f => f.area === "staged") ? commitHint : undefined} disabled={busy || !message.trim() || !data.files.some(f => f.area === "staged")}>
        {busy ? "Working…" : "Commit staged changes"}
      </button>
      <details className="commit-options">
        <summary aria-label="Commit options">▾</summary>
        <div><button type="button" disabled={busy || !message.trim() || !data.files.some(f => f.area === "staged") || !data.upstream || !!data.behind}
          onClick={e => { e.currentTarget.closest("details")?.removeAttribute("open"); void act("commit-push", message); }}>Commit &amp; Push</button></div>
      </details></div>
      {!inline && <div className="push-action">
        <button type="button" disabled={busy || !data.upstream || !data.ahead || !!data.behind}
        onClick={() => act("push")}>Push{data.ahead ? " (" + data.ahead + ")" : ""}</button>
        <small>{!data.upstream ? "Publish this branch from your terminal to set an upstream." : data.behind ? "Pull or rebase in your terminal before pushing." : data.ahead ? "Push committed changes to " + data.upstream : "No commits to push."}</small>
      </div>}
    </form>
  );
  function showMode(value: string) {
    if (value === mode && !revision) return;
    saveChanges({ mode: value, revision: "" });
    setRevision("");
    setMode(value);
  }

  useEffect(() => {
    if (preferUncommitted) showMode("working");
  }, [preferUncommitted]);

  const scopes = [["working", "Uncommitted"], ["compare", "Compare branch"], ["recent", "Recent commits"]];
  const comparison = data?.comparison;
  const list = <aside className="changes-panel" aria-label="Workspace changes" tabIndex={inline ? 0 : undefined}>
      <header>
        <strong>{inline ? "Files" : "Changes"}{inline && !!data?.files.length && <small className="change-file-total">{data.files.length}</small>}</strong>
        {inline && <select className="changes-review-scope" aria-label="Review scope" value={mode} onChange={(event) => showMode(event.target.value)}>
          {scopes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>}
        <button aria-label="Refresh changes" title={inline ? "Refresh changes" : undefined} disabled={loading || !cwd} onClick={() => { setPrRefresh((value) => value + 1); void refresh(true, inline); }}>
          {inline ? <Icon name="refresh" size={16} /> : "Refresh changes"}
        </button>
        <button aria-label="Close changes" onClick={onClose}>
          <Icon name="close" size={15} />
        </button>
      </header>
      {!inline && actionError && <p role="alert">{actionError}</p>}
      {notice && <p role="status">{notice}</p>}
      {!inline && <div className="review-modes" role="group" aria-label="Review scope">
        {scopes.map(([value, label]) => <button key={value} aria-pressed={mode === value}
          onClick={() => showMode(value)}>{label}</button>)}
      </div>}
      {mode === "recent" && !!data?.commits?.length && (
        <select
          aria-label="Commit to review"
          value={data.revision}
          onChange={(e) => {
            const revision = e.target.value;
            saveChanges({ mode, revision });
            setRevision(revision);
          }}
        >
          {data.commits.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id.slice(0, 7)} · {c.title}
            </option>
          ))}
        </select>
      )}
      {!cwd ? (
        <p>Select a workspace or session to review its repository.</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : loading ? (
        <p role="status">Loading changes…</p>
      ) : (
        data && (
          <>
            <div className="changes-repo">
              <div className="changes-branch-row">
                <strong title={data.root}>{data.branch}</strong>
                {data.upstream && <small title={`Push upstream ${data.upstream}. Counts reflect the last fetch.`}>
                  ↑{data.ahead ?? 0} ↓{data.behind ?? 0}
                </small>}
              </div>
              <details className="changes-repo-details"><summary>Repository details</summary>
                <small title={data.root}>{data.root}</small>
                <small>{data.upstream ? `Push upstream · ${data.upstream}` : "No push upstream configured"}</small>
                {data.upstream && <small>{data.ahead ?? 0} ahead · {data.behind ?? 0} behind at last fetch</small>}
              </details>
              {mode === "compare" && <div className="changes-compare">
                <label>Compare against
                  <select value={comparison?.targetRef ?? ""} onChange={(event) => {
                    savePosition(comparisonKey(data), event.target.value);
                    saveChanges({ mode, revision });
                    selectedRef.current = null;
                    openRef.current = false;
                    setOpen(false);
                    setSelected(null);
                    void refresh();
                  }}>
                    <option value="" disabled>Choose a target branch</option>
                    {comparison?.refs.map((ref) => <option value={ref} key={ref}>{branchLabel(ref)}</option>)}
                  </select>
                </label>
                <small>{comparison?.problem || (data.base && comparison?.targetRef
                  ? `${data.branch} → ${branchLabel(comparison.targetRef)} · Merge base ${data.base.slice(0, 7)}`
                  : "Choose the branch your PR will merge into.")}</small>
                {!!data.uncommittedFiles && <small>{data.uncommittedFiles} {data.uncommittedFiles === 1 ? "file has" : "files have"} uncommitted changes outside this comparison.</small>}
              </div>}
            </div>
            {mode === "working" && (inline ? <details className="changes-commit-controls"><summary>Commit and push</summary>{commitForm}</details> : commitForm)}
            {!data.files.length ? (
              <p role="status">
                {mode === "working"
                  ? inline ? "No uncommitted changes." : "No uncommitted changes. See Recent commits for completed work."
                  : mode === "recent"
                    ? data.commits?.length
                      ? "No file changes in this commit."
                      : "No commits yet."
                    : comparison?.targetRef && !comparison.problem ? "No committed changes since the branches diverged." : "No comparison to show."}
                {inline && mode === "working" && data.branch !== "New repository" && <>
                  {" "}<button type="button" onClick={() => showMode("recent")}>Review latest commit</button>
                </>}
              </p>
            ) : (
              <>
                <nav ref={fileList} className="changed-files" aria-label="Changed files">
                  {(
                    ["staged", "changes", "committed"] as const
                  ).map((area) => {
                    const files = data.files.filter((f) => area === "changes" ? ["unstaged", "untracked"].includes(f.area) : f.area === area);
                    return (
                      files.length > 0 && (
                        <details className="change-group" key={area} open>
                          <summary>
                            <span>{area === "staged" ? "Staged Changes" : area === "changes" ? "Changes" : "Committed"} · {files.length}</span>
                            {mode === "working" && <button type="button" disabled={busy}
                              title={area === "staged" ? "Unstage All Changes" : "Stage All Changes"}
                              aria-label={area === "staged" ? "Unstage All Changes" : "Stage All Changes"}
                              onClick={e => { e.preventDefault(); void act(area === "staged" ? "unstage-all" : "stage-all"); }}>
                              {area === "staged" ? "− Unstage All" : "+ Stage All"}
                            </button>}
                          </summary>
                          {files.map((file) => (
                            <div className="changed-file-row" key={file.path}><button
                              title={
                                file.previous
                                  ? `${file.previous} → ${file.path}`
                                  : file.path
                              }
                              className={
                                selected?.path === file.path &&
                                selected.area === file.area
                                  ? "selected"
                                  : ""
                              }
                              aria-current={selected?.path === file.path && selected.area === file.area ? "true" : undefined}
                              onClick={() => selectFile(file)}
                            >
                              <span className="file-status">{file.status}</span>
                              <span>{file.path}</span>
                              {file.additions !== undefined && file.deletions !== undefined &&
                                <span className="change-line-count" aria-label={`${file.additions} additions, ${file.deletions} deletions`}>
                                  <span>+{file.additions}</span><span>−{file.deletions}</span>
                                </span>}
                            </button>
                            {mode === "working" && <button disabled={busy}
                              aria-label={(area === "staged" ? "Unstage " : "Stage ") + file.path}
                              onClick={() => act(area === "staged" ? "unstage" : "stage", file.path)}>
                              {area === "staged" ? "−" : "+"}
                            </button>}</div>
                          ))}
                        </details>
                      )
                    );
                  })}
                </nav>
              </>
            )}

          </>
        )
      )}
    </aside>;

  if (inline) return <div className="changes-review-shell">
    <div className="changes-review-layout" data-review-open={!!review}>
      {list}
      <div className="changes-review-detail">
        {review ?? <div className="changes-review-empty">
          <Icon name="changes" size={25} />
          <p>{data?.files.length ? "Select a changed file to review its diff." : "File diff"}</p>
        </div>}
      </div>
    </div>
    {actionError && <p role="alert" className="changes-git-error">{actionError}</p>}
    {active && pullRequestTarget && <PreparePullRequest cwd={cwd} targetRef={pullRequestTarget} session={session} onClose={() => setPullRequestTarget(undefined)} />}
    {data && <GitBar cwd={cwd} data={data} busy={busy} active={active} prRefresh={prRefresh}
      compareTarget={data.comparison?.targetRef || readPosition(comparisonKey(data), "")}
      onAction={branchAction} onOpenPullRequest={() => void openPullRequest()} onDraft={onDraftFollowUp} />}
  </div>;
  return <>
    {list}
    {review && host && createPortal(review, host)}
  </>;
}
