import { useEffect, useRef, useState } from "react";
import { readPosition, savePosition } from "./dashboard-position";
import { latestConversationTurn } from "./conversation-turn";
import type { Session } from "./types";

const sessionKey = (row: Session) => row.provider + ":" + row.sessionID;

export function ProjectSessionReview({ project, rows, details, protectedIds, onClose, onOpen, onEdit, onHideHistory }: {
  project: string;
  rows: Session[];
  details: Record<string, { name: string; next: string }>;
  protectedIds: ReadonlySet<string>;
  onClose: () => void;
  onOpen: (row: Session) => void;
  onEdit: (id: string, details: { name: string; next: string }) => void;
  onHideHistory: (ids: string[], hide: boolean) => Promise<string[]>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [kept, setKept] = useState(() => readPosition<Record<string, number>>("dashboardReviewedSessions", {}));
  const [skipped, setSkipped] = useState<string[]>([]);
  const [hiddenDuringReview, setHiddenDuringReview] = useState<string[]>([]);
  const [undo, setUndo] = useState<{ id: string; title: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState<{ id: string; instruction?: string; reply?: string; failed?: boolean; unavailable?: boolean }>();
  const remaining = rows.filter((row) => {
    const id = sessionKey(row);
    return kept[id] !== row.updated && !skipped.includes(id) && !hiddenDuringReview.includes(id);
  }).sort((a, b) => a.updated - b.updated);
  const current = remaining[0];
  const id = current ? sessionKey(current) : "";
  const provider = current?.provider;
  const sessionId = current?.sessionID;
  const title = current ? details[id]?.name || current.title : "";

  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);
  useEffect(() => savePosition("dashboardReviewedSessions", kept), [kept]);
  useEffect(() => {
    if (!provider || !sessionId) return;
    let active = true;
    void window.runhuddle.history(provider, sessionId).then(({ messages, unavailable }) => {
      if (active) setPreview({ id, ...latestConversationTurn(messages), unavailable });
    }, () => {
      if (active) setPreview({ id, failed: true });
    });
    return () => { active = false; };
  }, [id, provider, sessionId]);

  function keep() {
    if (!current) return;
    setError("");
    setEditing(false);
    setKept((old) => ({ ...old, [id]: current.updated }));
  }

  async function changeHistoryVisibility(target: { id: string; title: string }, hide: boolean) {
    setBusy(true);
    setError("");
    try {
      await onHideHistory([target.id], hide);
      setHiddenDuringReview((old) => hide ? [...old, target.id] : old.filter((entry) => entry !== target.id));
      setUndo(hide ? target : undefined);
      setEditing(false);
    } catch (reason) {
      setError((reason instanceof Error ? reason.message : String(reason))
        .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""));
    } finally {
      setBusy(false);
    }
  }

  const shownPreview = preview?.id === id ? preview : undefined;
  return <dialog ref={dialog} className="appearance-dialog project-session-review" aria-labelledby="project-review-title"
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }}>
    <header>
      <div><h2 id="project-review-title">Review saved sessions</h2><small>{project}</small></div>
      <button aria-label="Close session review" disabled={busy} onClick={onClose}>×</button>
    </header>
    <p role="status">{remaining.length ? `${remaining.length} left to review` : skipped.length ? "Review complete for now. Skipped sessions will be available next time." : "You’re caught up."}</p>
    {current && <article key={id}>
      <h3>{title}</h3>
      <small>{current.provider}{current.updated > 0 && ` · ${new Date(current.updated * 1000).toLocaleDateString()}`}</small>
      {shownPreview?.failed ? <p role="alert">Couldn’t read this conversation.</p>
        : !shownPreview ? <p role="status">Loading conversation…</p>
          : shownPreview.unavailable ? <p>Transcript unavailable. The session title and saved details are still available.</p>
          : <dl>
            <dt>Last instruction</dt><dd>{shownPreview.instruction || "No instruction recorded."}</dd>
            <dt>Last agent reply</dt><dd>{shownPreview.reply || "No reply recorded after the last instruction."}</dd>
          </dl>}
      {details[id]?.next && <p><strong>Saved next step</strong><br />{details[id].next}</p>}
      {!shownPreview?.unavailable && <button disabled={busy} onClick={() => onOpen(current)}>Open full conversation</button>}
      {editing ? <form onSubmit={(event) => {
        event.preventDefault();
        const next = String(new FormData(event.currentTarget).get("next") ?? "").trim();
        if (!next) return;
        onEdit(id, { name: details[id]?.name ?? "", next });
        keep();
      }}>
        <label>Next step<textarea name="next" required maxLength={300} defaultValue={details[id]?.next} /></label>
        <button className="primary">Save and keep</button>
        <button type="button" onClick={() => setEditing(false)}>Cancel</button>
      </form> : <footer>
        <button className="primary" disabled={busy} onClick={keep}>Keep</button>
        <button disabled={busy || protectedIds.has(id) || !!details[id]?.next}
          title={protectedIds.has(id) || details[id]?.next ? "This conversation is pinned, linked, or has follow-up work." : undefined}
          onClick={() => void changeHistoryVisibility({ id, title }, true)}>Hide from history</button>
        <button disabled={busy} onClick={() => setEditing(true)}>Save next step</button>
        <button disabled={busy} onClick={() => {
          setError("");
          setSkipped((old) => [...old, id]);
        }}>Skip</button>
      </footer>}
    </article>}
    {error && <p role="alert">{error}</p>}
    {undo && <div className="project-review-undo">
      <span>Hidden from history · {undo.title}</span>
      <button disabled={busy} onClick={() => void changeHistoryVisibility(undo, false)}>Undo hide</button>
    </div>}
  </dialog>;
}
