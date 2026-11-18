import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Session, UsageInfo } from "./types";

export function UsageControls({ source, handoffOpen, onHandoff }: {
  source: Session;
  handoffOpen: boolean;
  onHandoff: () => void;
}) {
  const provider = source.provider.toLowerCase();
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("usageDismissed") || "{}"); } catch { return {}; }
  });
  const usageMenu = useRef<HTMLDetailsElement>(null);
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
  function handoff() {
    if (usageMenu.current) usageMenu.current.open = false;
    onHandoff();
  }
  const popup = low && !dismissed[warningKey] && !handoffOpen;
  function later() {
    const next = { ...dismissed, [warningKey]: true };
    setDismissed(next); localStorage.setItem("usageDismissed", JSON.stringify(next));
  }
  return <>
    <details ref={usageMenu} className="usage-menu editor-menu">
      <summary data-tour-anchor="handoff" aria-label="Agent usage">{source.provider} usage{low ? " · " + low.remaining + "% left" : ""}</summary>
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
  </>;
}
