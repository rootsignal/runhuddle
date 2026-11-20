import { useEffect, useRef, useState, type ReactNode } from "react";
import { AgentIcon, Icon } from "./Icons";
import { SessionHistory } from "./SessionHistory";
import { ReplyExcerpt } from "./AttentionPreview";
import { latestConversationTurn } from "./conversation-turn";
import type { Session } from "./types";

export function ProjectConversationPreview({ row, title, metadata, next, onSave, onOpen, onResume, onReview, onProject, inlineHistory }: {
  row: Session;
  title: string;
  metadata?: string;
  next?: string;
  onSave: (next: string) => void;
  onOpen: () => void;
  onResume: () => Promise<void>;
  onReview?: () => void;
  onProject?: () => void;
  inlineHistory?: boolean;
}) {
  const [turn, setTurn] = useState<(ReturnType<typeof latestConversationTurn> & { unavailable?: boolean }) | null>();
  const [readingHistory, setReadingHistory] = useState(false);
  const [editing, setEditing] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState("");
  const { provider, sessionID, updated } = row;

  useEffect(() => {
    let active = true;
    void window.runhuddle.history(provider, sessionID).then(({ messages, unavailable }) => {
      if (active) setTurn({ ...latestConversationTurn(messages), unavailable });
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
  const nextLabel = next ? "Edit next step" : "Save next step";
  return <section className="dashboard-conversation-preview" aria-label="Conversation preview">
    {metadata ? <div className="dashboard-preview-identity">
      <AgentIcon agent={provider.toLowerCase()} />
      <div><h3>{title}</h3><p className="dashboard-preview-meta">{metadata}</p></div>
    </div> : <h3>{title}</h3>}
    {readingHistory ? <SessionHistory session={row} inline /> : turn === undefined ? <p role="status">Loading conversation…</p>
      : !turn || turn.unavailable ? <p>Transcript unavailable.</p>
      : <dl>
        <div><dt>Last instruction</dt><dd>{turn.instruction || "No instruction recorded."}</dd></div>
        <div><dt>Last agent reply</dt><dd>{turn.reply ? <ReplyExcerpt text={turn.reply} /> : "No reply recorded after the last instruction."}</dd></div>
      </dl>}
    {next && <p><strong>Saved next step</strong><br />{next}</p>}
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
      <button className="primary dashboard-preview-resume" disabled={resuming} onClick={() => void resume()}>
        {inlineHistory && <Icon name={row.terminalId ? "terminal" : "play"} size={17} />}
        {row.terminalId ? "Open live session" : resuming ? "Resuming…" : "Resume session"}
      </button>
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
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function RecentConversationDialog({ children, actions, onBack, onClose }: {
  children: ReactNode;
  actions?: ReactNode;
  onBack: () => void;
  onClose: () => void;
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
      <button className="dashboard-preview-back" autoFocus onClick={onBack}><Icon name="arrow" size={15} /> Back to Recent</button>
      <div className="dashboard-preview-chrome">
        {actions}
        <button className="dashboard-tool-icon" aria-label="Close recent session details" data-tooltip="Close preview" onClick={onClose}>
          <Icon name="close" size={17} />
        </button>
      </div>
    </header>
    {children}
  </dialog>;
}
