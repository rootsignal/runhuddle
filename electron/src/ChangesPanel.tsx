import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { readPosition, savePosition } from "./dashboard-position";
import { DiffReview } from "./DiffReview";
import type { GitChanges, GitFile } from "./types";
type ChangesPosition = { mode: string; revision: string; file?: Pick<GitFile, "path" | "area">; scrollTop?: number };

export function ChangesPanel({
  cwd,
  onClose,
  inline = false,
  active = true,
  positionKey,
}: {
  cwd: string;
  onClose: () => void;
  inline?: boolean;
  active?: boolean;
  positionKey?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  const host = document.getElementById("review-stage");
  const storageKey = positionKey ? "dashboardChanges:" + positionKey : undefined;
  const [initial] = useState(() => storageKey
    ? readPosition<ChangesPosition>(storageKey, { mode: "working", revision: "" })
    : { mode: "working", revision: "" });
  const position = useRef<ChangesPosition>(initial);
  const [mode, setMode] = useState(initial.mode);
  const [revision, setRevision] = useState(initial.revision);
  function saveChanges(next: ChangesPosition) {
    position.current = next;
    if (storageKey) savePosition(storageKey, next);
  }
  function selectFile(file: GitFile) {
    saveChanges({ mode, revision: data?.revision ?? revision, file: { path: file.path, area: file.area }, scrollTop: 0 });
    void preview(file);
  }
  const [data, setData] = useState<GitChanges | null>(null);
  const [selected, setSelected] = useState<GitFile | null>(null);
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
  ) {
    const token = ++request.current;
    setOpen(true);
    setSelected(file);
    setDiff("");
    setReading(true);
    try {
      const text = await window.runhuddle.gitDiff(
        cwd,
        file.path,
        file.area,
        mode,
        commit,
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
      const next = await window.runhuddle.gitChanges(cwd, mode, revision);
      if (version !== generation.current) return;
      setData(next);
      window.dispatchEvent(
        new CustomEvent("repository-refreshed", { detail: cwd }),
      );
      const saved = storageKey ? position.current.file : undefined;
      const target = saved ?? selected;
      const file = target && next.files.find((f) => f.path === target.path && f.area === target.area);
      setSelected(file || null);
      if (file && (saved || (keepReview && openRef.current))) void preview(file, version, next.revision);
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
    setMessage(""); setActionError(""); setNotice("");
  }, [cwd]);
  useEffect(() => {
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
  const review = open && selected && data && !loading ? (
    <DiffReview inline={inline} active={active} root={data.root} file={selected} diff={diff} loading={reading}
      scrollTop={storageKey ? position.current.scrollTop : undefined}
      onScrollPosition={storageKey ? (scrollTop) => saveChanges({ ...position.current, scrollTop }) : undefined}
      onClose={() => {
        if (storageKey) saveChanges({ mode, revision: data.revision ?? revision });
        openRef.current = false;
        setOpen(false);
      }} />
  ) : null;

  return <>
    <aside className="changes-panel" aria-label="Workspace changes" tabIndex={inline ? 0 : undefined} inert={inline && !!review}>
      <header>
        <strong>Changes</strong>
        <button disabled={loading || !cwd} onClick={() => refresh(true)}>
          Refresh changes
        </button>
        <button aria-label="Close changes" onClick={onClose}>
          ×
        </button>
      </header>
      {actionError && <p role="alert">{actionError}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="review-modes" role="group" aria-label="Review scope">
        {[
          ["working", "Uncommitted"],
          ["recent", "Recent commits"],
          ["compare", "vs main"],
        ].map(([value, label]) => (
          <button
            key={value}
            aria-pressed={mode === value}
            onClick={() => {
              if (value === mode && !revision) return;
              saveChanges({ mode: value, revision: "" });
              setRevision("");
              setMode(value);
            }}
          >
            {label}
          </button>
        ))}
      </div>
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
      {mode === "compare" && (
        <small className="review-explanation">
          Committed changes since this branch diverged from main.
        </small>
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
              <strong>{data.branch}</strong>
              <small title={data.root}>{data.root}</small>
              <small>{data.upstream ? data.upstream + " · " + data.ahead + " ahead · " + data.behind + " behind" : "No upstream configured"}</small>
              {data.upstream && <small title="Counts reflect the last fetch.">Remote status · last fetch</small>}

            </div>
            {mode === "working" && <form className="commit-form" onSubmit={e => { e.preventDefault(); void act("commit", message); }}>
              <textarea aria-label="Commit message" placeholder="Commit message" value={message} onChange={e => setMessage(e.target.value)} disabled={busy} />
              {!data.files.some(f => f.area === "staged") && <small className="commit-hint" id="commit-hint">Stage files with + before committing.</small>}
              <div className="commit-buttons"><button aria-busy={busy} aria-describedby={!data.files.some(f => f.area === "staged") ? "commit-hint" : undefined} disabled={busy || !message.trim() || !data.files.some(f => f.area === "staged")}>
                {busy ? "Working…" : "Commit staged changes"}
              </button>
              <details className="commit-options">
                <summary aria-label="Commit options">▾</summary>
                <div><button type="button" disabled={busy || !message.trim() || !data.files.some(f => f.area === "staged") || !data.upstream || !!data.behind}
                  onClick={e => { e.currentTarget.closest("details")?.removeAttribute("open"); void act("commit-push", message); }}>Commit &amp; Push</button></div>
              </details></div>
              <div className="push-action">
                <button type="button" disabled={busy || !data.upstream || !data.ahead || !!data.behind}
                onClick={() => act("push")}>Push{data.ahead ? " (" + data.ahead + ")" : ""}</button>
                <small>{!data.upstream ? "Publish this branch from your terminal to set an upstream." : data.behind ? "Pull or rebase in your terminal before pushing." : data.ahead ? "Push committed changes to " + data.upstream : "No commits to push."}</small>
              </div>
            </form>}
            {!data.files.length ? (
              <p role="status">
                {mode === "working"
                  ? "No uncommitted changes. See Recent commits for completed work."
                  : mode === "recent"
                    ? data.commits?.length
                      ? "No file changes in this commit."
                      : "No commits yet."
                    : "No committed changes since main."}
              </p>
            ) : (
              <>
                <nav className="changed-files" aria-label="Changed files">
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
                              onClick={() => selectFile(file)}
                            >
                              <span className="file-status">{file.status}</span>
                              <span>{file.path}</span>
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
    </aside>
    {review && (inline ? review : host ? createPortal(review, host) : null)}
  </>;
}
