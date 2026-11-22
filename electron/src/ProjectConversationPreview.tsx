import { useEffect, useRef, useState, type ReactNode } from "react";
import { AgentIcon, Icon } from "./Icons";
import { SessionRecap } from "./SessionRecap";
import { SessionHistory } from "./SessionHistory";
import { ReplyExcerpt } from "./AttentionPreview";
import { latestConversationTurn } from "./conversation-turn";
import type { HistoryAnchor, Session, SessionRecap as Recap } from "./types";

export function ProjectConversationPreview({ row, connected, title, metadata, next, onSave, onOpen, onResume, onReview, onProject, inlineHistory, anchor, onSaveExcerpt, linkedSessions, recap }: {
  row: Session;
  connected: boolean;
  title: string;
  metadata?: string;
  next?: string;
  onSave: (next: string) => void;
  onOpen: () => void;
  onResume: () => Promise<void>;
  onReview?: () => void;
  onProject?: () => void;
  inlineHistory?: boolean;
  anchor?: HistoryAnchor;
  onSaveExcerpt?: (text: string) => void;
  linkedSessions?: ReactNode;
  recap?: Recap;
}) {
  const [turn, setTurn] = useState<(ReturnType<typeof latestConversationTurn> & { unavailable?: boolean }) | null>();
  const [recapMessages, setRecapMessages] = useState<{ role: string; text: string }[]>([]);
  const [readingHistory, setReadingHistory] = useState(!!anchor);
  const [match, setMatch] = useState(anchor);
  const [editing, setEditing] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState("");
  const { provider, sessionID, updated } = row;

  useEffect(() => {
    let active = true;
    void window.runhuddle.history(provider, sessionID).then(({ messages, unavailable }) => {
      if (active) {
        setTurn({ ...latestConversationTurn(messages), unavailable });
        setRecapMessages([
          messages.findLast((message) => message.role === "user"),
          messages.findLast((message) => message.role === "assistant"),
        ].filter((message) => !!message));
      }
    }, () => {
      if (active) setTurn(null);
    });
    return () => { active = false; };
  }, [provider, sessionID, updated]);

  async function resume() {
    setResuming(true);
    setError("");
    try {
      await onResume();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setResuming(false);
    }
  }

  const historyLabel = readingHistory ? "Back to summary" : inlineHistory ? "Read conversation" : "Open full conversation";
  const suggestedNext = recap && recap.sourceUpdated >= updated ? recap.next : "";
  const nextLabel = next ? "Edit next step" : "Save next step";
  return <section className="dashboard-conversation-preview" aria-label="Conversation preview">
    <div className="dashboard-preview-heading">
      {metadata ? <div className="dashboard-preview-identity">
        <AgentIcon agent={provider.toLowerCase()} />
        <div><h3>{title}</h3><p className="dashboard-preview-meta">{metadata}</p></div>
      </div> : <h3>{title}</h3>}
      <button className="primary dashboard-preview-resume" disabled={resuming || !connected} onClick={() => void resume()}>
        {inlineHistory && <Icon name={row.terminalId ? "terminal" : "play"} size={17} />}
        {row.terminalId ? "Open live session" : resuming ? "Resuming…" : "Resume session"}
      </button>
    </div>
    {error && <p role="alert">{error}</p>}
    {!connected && <p role="status">Reconnect the terminal service to {row.terminalId ? "open" : "resume"} this session. You can still read its conversation.</p>}
    {onReview && <p className="dashboard-review-reason"><Icon name="inbox" size={15} /> Agent finished a turn · Ready for review</p>}
    {(next || (onReview && !suggestedNext)) && <p className="dashboard-preview-next">
      <strong>{next ? "Saved next step" : "Next action"}</strong>
      <br />{next || "Review the agent’s reply"}
    </p>}
    {readingHistory ? <SessionHistory session={row} inline onSaveExcerpt={onSaveExcerpt} anchor={match} onLatest={() => setMatch(undefined)} /> : turn === undefined ? <p role="status">Loading conversation…</p>
      : !turn || turn.unavailable ? <p>Transcript unavailable.</p>
      : <dl>
        <div><dt>Last instruction</dt><dd>{turn.instruction || "No instruction recorded."}</dd></div>
        <div><dt>Last agent reply</dt><dd>{turn.reply ? <ReplyExcerpt text={turn.reply} /> : "No reply recorded after the last instruction."}</dd></div>
      </dl>}
    {(recap || recapMessages.length > 0) && <details className="dashboard-conversation-recap" open={onReview && recap && recap.sourceUpdated >= updated ? true : undefined}>
      <summary>Recap</summary>
      <SessionRecap session={row} messages={recapMessages} recap={recap} loading={turn === undefined} showExcerpts={false} />
    </details>}
    {linkedSessions}
    {editing && <form onSubmit={(event) => {
      event.preventDefault();
      onSave(String(new FormData(event.currentTarget).get("next") ?? "").trim());
      setEditing(false);
    }}>
      <label>Next step<textarea name="next" maxLength={300} defaultValue={next} autoFocus /></label>
      <button type="submit">Save next step</button>
      <button type="button" onClick={() => setEditing(false)}>Cancel</button>
    </form>}
    <footer>
      <div className="dashboard-preview-tools" role="group" aria-label="Conversation actions">
        {turn && !turn.unavailable && <button className={inlineHistory ? "dashboard-tool-icon" : undefined}
          aria-label={historyLabel} data-tooltip={inlineHistory ? historyLabel : undefined}
          onClick={inlineHistory ? () => setReadingHistory(!readingHistory) : onOpen}>
          {inlineHistory ? <Icon name={readingHistory ? "history" : "notes"} size={17} /> : historyLabel}
        </button>}
        {onProject && <button className="dashboard-tool-icon" aria-label="View project" data-tooltip="View project" onClick={onProject}>
          <Icon name="folder" size={17} />
        </button>}
        {!editing && <button className={inlineHistory ? "dashboard-tool-icon" : undefined}
          aria-label={nextLabel} data-tooltip={inlineHistory ? nextLabel : undefined} onClick={() => setEditing(true)}>
          {inlineHistory ? <Icon name="pencil" size={17} /> : nextLabel}
        </button>}
        {onReview && <button className={inlineHistory ? "dashboard-tool-icon" : undefined}
          aria-label="Mark reviewed" data-tooltip={inlineHistory ? "Mark reviewed" : undefined} onClick={onReview}>
          {inlineHistory ? <Icon name="check" size={17} /> : "Mark reviewed"}
        </button>}
      </div>
    </footer>
  </section>;
}

export function RecentConversationDialog({ children, actions, onBack, backLabel = "Back to Recent" }: {
  children: ReactNode;
  actions?: ReactNode;
  backLabel?: string;
  onBack: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="appearance-dialog dashboard-recent-preview" aria-label="Recent session details"
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onBack(); }}>
    <header>
      <button className="dashboard-preview-back" autoFocus onClick={onBack}><Icon name="arrow" size={15} /> {backLabel}</button>
      <div className="dashboard-preview-chrome">
        {actions}
        <button className="dashboard-tool-icon" aria-label="Close recent session details" data-tooltip="Close preview" onClick={onBack}>
          <Icon name="close" size={17} />
        </button>
      </div>
    </header>
    {children}
  </dialog>;
}
