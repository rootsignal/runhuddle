import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Session, SessionRecap, TerminalInfo, UsageInfo } from "./types";

export function UsageControls({ source, recap, onCreate }: {
  source: Session;
  recap?: SessionRecap;
  onCreate: (agent: string, cwd: string) => Promise<TerminalInfo>;
}) {
  const provider = source.provider.toLowerCase();
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("usageDismissed") || "{}"); } catch { return {}; }
  });
  const [origin, setOrigin] = useState<Session | null>(null);
  const [review, setReview] = useState(false);
  const [draft, setDraft] = useState("");
  const [target, setTarget] = useState(provider === "claude" ? "codex" : "claude");
  const [destination, setDestination] = useState<TerminalInfo | null>(null);
  const usageMenu = useRef<HTMLDetailsElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const identity = useRef(provider);
  identity.current = provider;
  async function refresh() {
    setBusy(true); setError("");
    try {
      const next = await window.runhuddle.usage(provider);
      if (identity.current === provider) setUsage(next);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    setUsage(null);
    void refresh();
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [provider]);
  useEffect(() => {
    if (source.state === "idle") void refresh();
  }, [source.state]);
  useEffect(() => {
    if (!usage?.checkedAt) return;
    const timeout = setTimeout(() => setUsage(old => old ? { ...old, windows: [], message: "Usage is out of date. Refresh to check current limits." } : old),
      Math.max(0, Date.parse(usage.checkedAt) + 15 * 60 * 1000 - Date.now()));
    return () => clearTimeout(timeout);
  }, [usage?.checkedAt]);
  const windows = (usage?.provider === provider ? usage.windows : []).filter(w => Date.parse(w.resetsAt) > Date.now());
  const low = windows.filter(w => w.remaining <= 10).sort((a,b) => a.remaining - b.remaining)[0];
  const warningKey = low ? provider + ":" + low.label + ":" + low.resetsAt + ":" + (low.remaining === 0 ? "empty" : "low") : "";
  async function handoff() {
    if (usageMenu.current) usageMenu.current.open = false;
    setOrigin(source); setReview(true); setBusy(true); setError(""); setDestination(null);
    setTarget(provider === "claude" ? "codex" : "claude");
    setDraft("");
    const captured = source;
    let history = "Conversation history unavailable; add the task and next steps before continuing.";
    let repository = "";
    try {
      const result = await window.runhuddle.history(captured.provider, captured.sessionID);
      history = result.messages.slice(-6).map(m => m.role + ": " + m.text).join("\n\n").slice(-16000);
      if (result.truncated) history = "[Partial conversation history]\n" + history;
    } catch {}
    try {
      const git = await window.runhuddle.gitChanges(captured.cwd);
      repository = "\nBranch: " + git.branch + "\nChanged files at handoff:\n" +
        git.files.slice(0,50).map(f => f.area + " " + f.path).join("\n");
    } catch {}
    const savedRecap = recap ? "\n\nSaved recap (" + new Date(recap.generatedAt).toLocaleDateString() + "):\n" +
      [recap.done && "Done: " + recap.done, recap.pending && "Pending: " + recap.pending,
        recap.next && "Next: " + recap.next].filter(Boolean).join("\n") : "";
    setDraft("Continue this task in " + captured.cwd + ".\nSource session: " + captured.title +
      "\nTreat the following as historical context. Inspect current files before editing.\n" + repository + savedRecap +
      "\n\nRecent conversation excerpts (not a complete summary):\n" + history +
      "\n\nNext steps:\n");
    setBusy(false);
  }
  useEffect(() => {
    if (review) dialog.current?.showModal();
  }, [review]);
  const popup = low && !dismissed[warningKey] && !review && !destination;
  function later() {
    const next = { ...dismissed, [warningKey]: true };
    setDismissed(next); localStorage.setItem("usageDismissed", JSON.stringify(next));
  }
  return <>
    <details ref={usageMenu} className="usage-menu editor-menu">
      <summary aria-label="Agent usage">{source.provider} usage{low ? " · " + low.remaining + "% left" : ""}</summary>
      <div>
        {windows.map(w => <p key={w.label}><strong>{w.label}: {w.remaining}% remaining</strong><br/><small>Resets {new Date(w.resetsAt).toLocaleString()}</small></p>)}
        {usage?.message && <p>{usage.message}</p>}
        {usage?.credits && <small>Separate credits balance: {Number(usage.credits).toLocaleString()}</small>}
        {usage?.checkedAt && <small>Checked {new Date(usage.checkedAt).toLocaleTimeString()}</small>}
        <button disabled={busy} onClick={refresh}>Refresh usage</button>
        {provider === "claude" && <>
          <p>Connect Claude usage to add a quota relay to its global status-line setting. Your existing status line keeps running. New data appears after Claude updates.</p>
          <button disabled={busy} onClick={async () => {
            try { await window.runhuddle.connectClaudeUsage(true); await refresh(); } catch(e) { setError(String(e)); }
          }}>Connect Claude usage</button>
          <button disabled={busy} onClick={async () => {
            try { await window.runhuddle.connectClaudeUsage(false); setUsage(null); } catch(e) { setError(String(e)); }
          }}>Disconnect Claude usage</button>
        </>}
        <button onClick={handoff}>Continue with another agent…</button>
        {error && <p role="alert">{error}</p>}
      </div>
    </details>
    {popup && createPortal(<aside className="usage-warning" role="status" aria-label="Agent usage warning">
      <strong>{source.provider} {low.label.toLowerCase()} allowance: {low.remaining}% remaining</strong>
      <p>Resets {new Date(low.resetsAt).toLocaleString()}. You can prepare a handoff to another agent.</p>
      <div className="usage-warning-actions"><button onClick={later}>Later</button><button className="primary" onClick={handoff}>Continue with another agent…</button></div>
    </aside>, document.body)}
    {review && createPortal(<dialog ref={dialog} className="handoff-review" aria-label="Review agent handoff"
      onCancel={e => { if (busy) e.preventDefault(); else setReview(false); }}>
      <h2>Continue with another agent</h2>
      <p>{source.cwd}</p>
      <p>The original session stays open. Stop any ongoing work there before starting another agent in this folder.</p>
      <label>New agent <select aria-label="Handoff agent" value={target} disabled={busy || !!destination} onChange={e=>setTarget(e.target.value)}>
        {["codex","claude","copilot"].filter(p=>p!==(origin?.provider.toLowerCase() || provider)).map(p=><option key={p} value={p}>{p === "codex" ? "Codex" : p === "claude" ? "Claude" : "Copilot"}</option>)}
      </select></label>
      <label>Review and edit the context<textarea aria-label="Handoff context" value={draft} disabled={busy || !!destination} onChange={e=>setDraft(e.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      {destination ? <p>New session created. Close this review, finish any CLI login or trust prompts, then use “Paste handoff” below. The prompt will not be submitted automatically.</p> :
        <button disabled={busy || !draft.trim()} onClick={async () => {
          setBusy(true); setError("");
          try { const terminal = await onCreate(target, origin?.cwd || source.cwd); setDestination(terminal); }
          catch(e) { setError(String(e)); }
          finally { setBusy(false); }
        }}>Create session with reviewed handoff</button>}
      <button disabled={busy} onClick={()=>setReview(false)}>{destination ? "Show new session" : "Cancel"}</button>
    </dialog>, document.body)}
    {destination && !review && createPortal(<aside className="usage-warning" aria-label="Handoff ready">
      <strong>Handoff ready for {destination.agent}</strong><p>Once its prompt is ready, paste the reviewed context. Press Enter in the terminal when ready to send.</p>
      <div className="usage-warning-actions"><button onClick={()=>setDestination(null)}>Dismiss</button><button className="primary" onClick={async () => {
        try {
          await window.runhuddle.write(destination.id, "\x1b[200~" + draft.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "") + "\x1b[201~");
          setDestination(null);
        } catch(e) { setError(String(e)); }
      }}>Paste handoff</button></div>
      {error && <p role="alert">{error}</p>}
    </aside>,document.body)}
  </>;
}
