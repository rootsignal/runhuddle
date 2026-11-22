import { useEffect, useRef, useState } from "react";
import type { HiddenHistory, Session } from "./types";

type HistoryItem = { kind: keyof HiddenHistory; id: string; title: string };

export function HiddenHistoryDialog({ hidden, sessions, names, onVisibilityChange, onClose }: {
  hidden: HiddenHistory;
  sessions: Session[];
  names: Record<string, { name: string }>;
  onVisibilityChange: (kind: keyof HiddenHistory, id: string, hide: boolean) => Promise<string[]>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [undo, setUndo] = useState<HistoryItem>();
  const feedback = useRef<HTMLDivElement>(null);

  async function changeVisibility(item: HistoryItem, hide: boolean) {
    setBusy(true);
    setError("");
    try {
      const changed = await onVisibilityChange(item.kind, item.id, hide);
      setUndo(!hide && changed.length ? item : undefined);
      setMessage(changed.length ? `${hide ? "Hidden from history" : "Restored"} · ${item.title}` : "History is already up to date.");
      requestAnimationFrame(() => feedback.current?.focus());
    } catch (reason) {
      const text = reason instanceof Error ? reason.message : String(reason);
      setError(text.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  const recordedSessions = new Map(sessions.map((row) => [row.provider + ":" + row.sessionID, row]));
  const search = query.trim().toLowerCase();
  const matchingSessions = hidden.sessions.filter((id) => {
    const row = recordedSessions.get(id);
    return [names[id]?.name, row?.title, row?.cwd, row?.provider, id].join(" ").toLowerCase().includes(search);
  });
  return (
    <dialog ref={dialog} className="appearance-dialog hidden-history" aria-labelledby="hidden-history-heading"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <header>
        <h2 id="hidden-history-heading">Hidden projects and sessions</h2>
        <button aria-label="Close hidden history" disabled={busy} onClick={onClose}>×</button>
      </header>
      <p>Restore a project or session to make it visible again.</p>
      {(message || error) && <div ref={feedback} tabIndex={-1} className="dashboard-cleanup-feedback">
        {message && <p role="status">{message}</p>}
        {undo && <button disabled={busy} onClick={() => void changeVisibility(undo, true)}>Undo</button>}
        {error && <p role="alert">{error}</p>}
      </div>}
      {!hidden.projects.length && !hidden.sessions.length && <p>No hidden projects or sessions.</p>}
      {hidden.projects.length > 0 && (
        <section aria-label="Hidden projects">
          <h3>Projects ({hidden.projects.length})</h3>
          <ul>
            {hidden.projects.map((folder) => (
              <li key={folder}>
                <span title={folder}>{folder}</span>
                <button disabled={busy} onClick={() => void changeVisibility({ kind: "projects", id: folder, title: folder }, false)}>
                  Restore project
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {hidden.sessions.length > 0 && (
        <section aria-label="Hidden sessions">
          <h3>Sessions ({hidden.sessions.length})</h3>
          <input type="search" aria-label="Find hidden sessions" placeholder="Find hidden sessions"
            value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
          {!matchingSessions.length && <p>No matching hidden sessions.</p>}
          <ul>
            {matchingSessions.map((id) => {
              const row = recordedSessions.get(id);
              const title = names[id]?.name || row?.title || id;
              return (
                <li key={id}>
                  <span title={row?.cwd}>{row ? row.provider + " · " + title : title}</span>
                  <button disabled={busy} onClick={() => void changeVisibility({ kind: "sessions", id, title }, false)}>
                    Restore session
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </dialog>
  );
}
