import { useState } from "react";
import { Icon } from "./Icons";
import type { Session } from "./types";

export type CleanupSuggestion = {
  id: string;
  label: string;
  reason: string;
  sessions: { id: string; title: string; row: Session }[];
};

export function DashboardCleanup({ suggestions, onOpen, onCleanup }: {
  suggestions: CleanupSuggestion[];
  onOpen: (row: Session) => void;
  onCleanup: (ids: string[], hide: boolean) => Promise<string[]>;
}) {
  const [expanded, setExpanded] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [undo, setUndo] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const total = suggestions.reduce((sum, group) => sum + group.sessions.length, 0);

  async function apply(ids: string[], hide: boolean) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const changed = await onCleanup(ids, hide);
      setUndo(hide ? changed : []);
      setMessage(changed.length
        ? `${hide ? "Hid" : "Restored"} ${changed.length} ${changed.length === 1 ? "session" : "sessions"}.`
        : "History is already up to date.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  if (!total && !message && !error) return null;
  return (
    <section className="dashboard-cleanup" aria-label="Cleanup suggestions">
      <div className="dashboard-cleanup-heading">
        <Icon name="changes" size={19} />
        <h3>Cleanup suggestions</h3>
        {total > 0 && <span>{total} to review</span>}
      </div>
      {suggestions.map((group) => {
        const open = expanded === group.id;
        const selected = group.sessions.filter(({ id }) => !excluded.has(id));
        return (
          <div className="dashboard-cleanup-group" key={group.id}>
            <button className="dashboard-cleanup-toggle" aria-expanded={open} aria-controls={`cleanup-${group.id}`}
              onClick={() => {
                setExpanded(open ? "" : group.id);
                setExcluded(new Set());
              }}>
              <span><strong>{group.label}</strong><small>{group.reason}</small></span>
              <span>{group.sessions.length} <Icon name="chevron" size={15} /></span>
            </button>
            <div id={`cleanup-${group.id}`} hidden={!open}>
              {open && <>
                <ul>
                  {group.sessions.map(({ id, title, row }) => (
                    <li key={id}>
                      <input type="checkbox" checked={!excluded.has(id)} aria-label={`Select ${title}`} disabled={busy}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setExcluded((previous) => {
                            const next = new Set(previous);
                            if (checked) next.delete(id);
                            else next.add(id);
                            return next;
                          });
                        }} />
                      <button onClick={() => onOpen(row)} title={title}>
                        <strong>{title}</strong>
                        <small>{row.project} · {row.provider}{row.updated > 0 && ` · ${new Date(row.updated * 1000).toLocaleDateString()}`}</small>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="dashboard-cleanup-actions">
                  <p>Hidden sessions can be restored from the Projects menu.</p>
                  <button className="primary" disabled={busy || !selected.length}
                    onClick={() => void apply(selected.map(({ id }) => id), true)}>
                    Hide {selected.length} {selected.length === 1 ? "session" : "sessions"}
                  </button>
                </div>
              </>}
            </div>
          </div>
        );
      })}
      {(message || error) && (
        <div className="dashboard-cleanup-feedback">
          {error && <p role="alert">{error}</p>}
          {message && <p role="status">{message}</p>}
          {undo.length > 0 && <button disabled={busy} onClick={() => void apply(undo, false)}>Undo</button>}
        </div>
      )}
    </section>
  );
}
