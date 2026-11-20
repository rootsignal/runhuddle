import type { InboxEntry } from "./types";
import { AgentIcon } from "./Icons";

export function Inbox({
  entries,
  onAction,
  onClose,
}: {
  entries: InboxEntry[];
  onAction: (id: string, action: "open" | "dismiss") => void;
  onClose: () => void;
}) {
  const groups = [
    { kind: "input", label: "Needs input" },
    { kind: "completion", label: "Ready for review" },
  ];
  return (
    <section className="inbox-panel" aria-label="Session Inbox">
      <header>
        <strong>Inbox</strong>
        <button aria-label="Close Inbox" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="inbox-list">
        {!entries.length && (
          <p className="empty-small">You’re all caught up.</p>
        )}
        {groups.map(({ kind, label }) => {
          const rows = entries.filter((row) => row.kind === kind);
          return rows.length ? (
            <section key={kind} aria-label={label}>
              <div className="recency-label">{label}</div>
              {rows.map((row) => (
                <div className="inbox-row" key={row.id}>
                  <button
                    className="inbox-open"
                    aria-label={`Open ${row.body} (${row.provider})`}
                    onClick={() => onAction(row.id, "open")}
                    title={row.body}
                  >
                    <AgentIcon agent={row.provider.toLowerCase()} />
                    <div>
                      <strong>{row.body}</strong>
                      <small>{row.provider}</small>
                    </div>
                  </button>
                  {kind === "completion" && (
                    <button
                      aria-label={`Mark ${row.body} reviewed`}
                      title="Mark reviewed"
                      onClick={() => onAction(row.id, "dismiss")}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </section>
          ) : null;
        })}
      </div>
    </section>
  );
}
