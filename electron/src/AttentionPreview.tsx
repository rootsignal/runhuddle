import { Icon } from "./Icons";
import { TurnChangedFiles } from "./TurnChanges";
import { ReplyReferences } from "./ReplyReferences";
import type { TerminalPermissionPrompt } from "./TerminalPermission";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import type { InboxEntry, InboxPreview, PreviewTurn, Session, SessionRecap, TurnChanges } from "./types";

function previewInline(text: string, linksAsLabels = false) {
  const display = linksAsLabels ? text.replace(/\[([^\]\n]+)\]\((?:<[^>\n]+>|[^\s)]+)\)/g, "$1") : text;
  return display.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part, index) => {
    if (index % 2 === 0) return part;
    return part.startsWith("`")
      ? <code key={index}>{part.slice(1, -1)}</code>
      : <strong key={index}>{part.slice(2, -2)}</strong>;
  });
}

const MarkdownReply = lazy(() => import("./MarkdownFile"));

export function ReplyExcerpt({ text, linksAsLabels = false, onFileReference }: {
  text: string; linksAsLabels?: boolean; onFileReference?: (file: string) => void;
}) {
  return <div className="dashboard-review-excerpt"><Suspense fallback={<p role="status">Formatting reply…</p>}>
    <MarkdownReply text={text} reply linksAsLabels={linksAsLabels} onFileReference={onFileReference} />
  </Suspense></div>;
}

function turnSummary(text?: string) {
  return text?.replace(/\[([^\]\n]+)\]\((?:<[^>\n]+>|[^\s)]+)\)/g, "$1")
    .replace(/(?:\*\*|`)/g, "").replace(/\s+/g, " ").trim();
}

function TurnRow({ turn, latest, selected, status, onSelect }: {
  turn: PreviewTurn; latest?: boolean; selected: boolean; status?: string; onSelect: () => void;
}) {
  const time = turn.instructionAt ? new Date(turn.instructionAt) : undefined;
  const stamp = time && Number.isFinite(time.getTime()) ? time : undefined;
  const instruction = turnSummary(turn.instruction) || (turn.screenshots ? "Screenshot prompt" : "Instruction unavailable");
  const summary = turnSummary(turn.update || turn.answer);
  return <li><button type="button" aria-current={selected ? "true" : undefined} onClick={onSelect}>
    <span className="dashboard-turn-marker"><span /></span>
    <span className="dashboard-turn-row-content">
      <span className="dashboard-turn-row-meta">
        {latest && <span className="dashboard-turn-latest">Latest</span>}
        {stamp && <time dateTime={stamp.toISOString()} title={stamp.toLocaleString()}>
          {stamp.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </time>}
      </span>
      <strong>{instruction}</strong>
      {!selected && summary && <span className="dashboard-turn-summary">{summary}</span>}
      {status && <span className="dashboard-turn-status">{status}</span>}
    </span>
  </button></li>;
}

export const previewSections = {
  turns: "Recent turns",
  uncommitted: "Uncommitted",
  changes: "Turn changes",
  references: "File and link references",
};
export type PreviewSection = keyof typeof previewSections;

type QuickReply = { label: string; draft: string };
export type QuickReplies = { id: string; replies: QuickReply[] };

function quickReplyLabel(text: string) {
  return text.length <= 64 ? text : text.slice(0, 63).replace(/\s+\S*$/, "") + "…";
}

function quickRepliesFor(reply: string): QuickReply[] {
  const statements = reply.split(/\n+|(?<=[.!?])\s+/).reverse();
  for (const statement of statements) {
    const text = statement.trim().replace(/\*\*|__/g, "").replace(/^(?:#{1,6}|[-*])\s+/, "");
    const step = (text.match(/^(?:next(?: steps?| up)?|up next)(?:\s*[:–—]\s*|\s+(?:is|are)\s+)(.+)$/i)?.[1] ??
      text.match(/^(.+?)\s+(?:is|are) next[.!]?$/i)?.[1])?.replace(/[.!]$/, "").trim();
    if (step && step.length >= 5 && step.length <= 185)
      return [{
        label: /^next step\s*:/i.test(text) ? "Use next step" : quickReplyLabel(step),
        draft: `Please proceed with the next step you proposed: ${step}.`,
      }];
    const remaining = text.match(/^(.+?)\s+(?:is|are) still (?:open|pending|outstanding)[.!]?$/i)?.[1]?.trim();
    if (remaining && remaining.length >= 5 && remaining.length <= 72)
      return [{ label: remaining, draft: `Please continue with the remaining work: ${remaining}.` }];
  }
  return statements.reverse().flatMap((statement) => {
    const text = statement.trim().replace(/\*\*|__/g, "").replace(/^(?:#{1,6}|[-*])\s+/, "");
    const proposed = text.match(/^(?:(For .+?),\s+)?I(?:['’]d| would)\s+(?:(?:recommend|suggest)\s+)?((?:add|build|change|check|fix|keep|make|move|put|remove|show|test|update|verify)\b.+)[.!]$/i);
    if (!proposed) return [];
    const [, condition, action] = proposed;
    const draft = condition ? `${condition}, please ${action}.` : `Please ${action}.`;
    if (draft.length > 240) return [];
    const label = action[0].toUpperCase() + action.slice(1);
    return [{ label: quickReplyLabel(label), draft }];
  }).slice(0, 2);
}

export function AttentionPreview({ enabled = true, id, kind, recap, updated, liveSession, permission, liveState, submitted, compactTurns, followUpQueued, checkoutSummary, turnChanges, hiddenSections, reviewID, onReview, onFileReference, onBrowserReference, onReadHistory, onOpenTerminal, onStartHandoff, onQuickReplies, aiQuickReplies = false }: {
  enabled?: boolean;
  id: string;
  kind: InboxEntry["kind"];
  recap?: SessionRecap;
  updated?: number;
  permission?: TerminalPermissionPrompt;
  liveState?: string;
  compactTurns?: boolean;
  checkoutSummary?: ReactNode;
  hiddenSections?: Partial<Record<PreviewSection, boolean>>;
  turnChanges?: TurnChanges[];
  followUpQueued?: boolean;
  reviewID?: string;
  onReview?: (id: string) => void;
  submitted?: { text: string; at: number; screenshots?: number };
  onReadHistory?: () => void;
  onOpenTerminal?: () => void;
  onStartHandoff?: () => void;
  aiQuickReplies?: boolean;
  onQuickReplies?: (value: QuickReplies | undefined) => void;
  onFileReference?: (file: string) => void;
  onBrowserReference?: (url: string) => Promise<void>;
  liveSession?: Pick<Session, "provider" | "sessionID" | "terminalId">;
}) {
  const [selectedTurn, setSelectedTurn] = useState<string>();
  const [preview, setPreview] = useState<InboxPreview>();
  const [loadedReview, setLoadedReview] = useState<string>();
  const acknowledgedReview = useRef<string>(undefined);
  const [failed, setFailed] = useState(false);
  const { provider, sessionID, terminalId } = liveSession ?? {};
  const hasPermission = Boolean(permission);
  useEffect(() => {
    if (!enabled || (hasPermission && !terminalId)) return;
    let active = true;
    let reading = false;
    async function refresh() {
      if (reading) return;
      reading = true;
      try {
        const result = await (provider && sessionID && terminalId
          ? window.runhuddle.liveSessionPreview(provider, sessionID, terminalId)
          : window.runhuddle.inboxPreview(id));
        if (active) {
          setPreview(result);
          setLoadedReview(reviewID);
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      } finally {
        reading = false;
      }
    }
    void refresh();
    const timer = terminalId ? setInterval(refresh, 1200) : undefined;
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id, provider, sessionID, terminalId, kind, hasPermission, enabled, reviewID]);
  const currentRecap = kind === "completion" && recap && updated !== undefined && recap.sourceUpdated >= updated
    ? recap : undefined;
  const waitingForTranscript = !!submitted && preview?.instruction !== submitted.text &&
    (preview?.instructionAt ?? 0) < submitted.at;
  const context = liveSession && preview?.context;
  const started = context && context.startedAt !== undefined ? new Date(context.startedAt) : undefined;
  const minutesOld = started ? Math.max(0, Math.floor((Date.now() - +started) / 60000)) : 0;
  const ageUnit = minutesOld >= 1440 ? "day" : minutesOld >= 60 ? "hour" : "minute";
  const age = minutesOld < 1 ? "just now" : new Intl.RelativeTimeFormat().format(
    -Math.floor(minutesOld / (ageUnit === "day" ? 1440 : ageUnit === "hour" ? 60 : 1)), ageUnit);
  const recent = preview?.recentTurns ?? [];
  const olderTurns = (waitingForTranscript ? recent : recent.slice(0, -1)).slice(-4).reverse().map((turn, index, turns) => {
    const same = (other: typeof turn) => other.instructionAt === turn.instructionAt && other.instruction === turn.instruction;
    return { ...turn, key: JSON.stringify([turn.instructionAt, turn.instruction, turns.slice(index + 1).filter(same).length]) };
  });
  const olderIndex = selectedTurn ? olderTurns.findIndex((turn) => turn.key === selectedTurn) : -1;
  const previous = olderTurns[olderIndex + 1];
  const historical = olderTurns[olderIndex];
  const shown = historical ?? preview;
  const waiting = waitingForTranscript && !historical;
  const screenshotCount = waiting ? submitted?.screenshots : shown?.screenshots;
  const changed = !waiting && turnChanges?.find((item) => item.instructionAt === shown?.instructionAt);
  const answer = waiting ? undefined : shown?.answer;
  const replyForSuggestions = enabled && !failed && !historical && !waiting && kind === "completion"
    ? (preview?.answer || preview?.update)?.trim() : undefined;
  const suggestionInstruction = preview?.instruction ?? "";
  useEffect(() => {
    if (!onQuickReplies) return;
    if (!replyForSuggestions) {
      onQuickReplies(undefined);
      return;
    }
    const fallback = quickRepliesFor(replyForSuggestions);
    onQuickReplies(fallback.length ? { id, replies: fallback } : undefined);
    if (!aiQuickReplies || !provider || !sessionID || !terminalId) return;
    let active = true;
    void window.runhuddle.suggestQuickReplies(provider, sessionID, terminalId, suggestionInstruction, replyForSuggestions)
      .then((suggestions) => {
        if (!active || !suggestions.length) return;
        const seen = new Set(fallback.map(({ label }) => label.toLowerCase()));
        const replies = [...fallback, ...suggestions.filter(({ label }) => !seen.has(label.toLowerCase()))].slice(0, 3);
        onQuickReplies({ id, replies });
      }).catch(() => {});
    return () => { active = false; };
  }, [aiQuickReplies, id, onQuickReplies, provider, replyForSuggestions, sessionID, suggestionInstruction, terminalId]);
  const update = waiting ? undefined : (historical ? undefined : currentRecap?.done) || shown?.update || shown?.answer?.slice(0, 280);
  useEffect(() => {
    if (historical || !enabled || !reviewID || loadedReview !== reviewID || !update || failed) return;
    function acknowledgeVisibleReview() {
      if (!reviewID || acknowledgedReview.current === reviewID ||
          document.visibilityState !== "visible" || !document.hasFocus()) return;
      acknowledgedReview.current = reviewID;
      onReview?.(reviewID);
    }
    acknowledgeVisibleReview();
    window.addEventListener("focus", acknowledgeVisibleReview);
    document.addEventListener("visibilitychange", acknowledgeVisibleReview);
    return () => {
      window.removeEventListener("focus", acknowledgeVisibleReview);
      document.removeEventListener("visibilitychange", acknowledgeVisibleReview);
    };
  }, [historical?.key, enabled, reviewID, loadedReview, update, failed, onReview]);
  const pending = waitingForTranscript ? undefined : currentRecap?.pending || currentRecap?.next;
  const questions = kind === "input" ? preview?.questions : undefined;
  const choices = permission ? [{ text: permission.question, choices: permission.choices }] : questions;
  const action = historical ? undefined : permission ? "The agent is waiting for you to choose an option."
    : kind === "input" ? "The agent is waiting for your reply."
    : liveState === "working" ? undefined
    : pending || ((!liveSession || reviewID) && update ? "Review the agent’s update." : undefined);
  const latestTurn = waitingForTranscript
    ? { instruction: submitted?.text, instructionAt: submitted?.at, screenshots: submitted?.screenshots }
    : preview;
  const showTimeline = !hiddenSections?.turns && !!liveSession && !!latestTurn && (olderTurns.length > 0 || !!followUpQueued);
  const latestStatus = followUpQueued ? "Follow-up queued" : liveState === "working" ? "Working" : undefined;
  return <div className="dashboard-preview-layout" data-timeline={showTimeline && !compactTurns} data-compact={!!compactTurns}>
    <div className="dashboard-preview-body">
      <div className="dashboard-review-preview dashboard-briefing">
        {liveSession && olderTurns.length > 0 && <nav className="dashboard-turn-navigation" aria-label="Recent turn controls">
          <span aria-live="polite">{historical
            ? <>Turn {olderTurns.length - olderIndex} of {olderTurns.length + 1}{historical.instructionAt && <> · <time
              dateTime={new Date(historical.instructionAt).toISOString()}>{new Date(historical.instructionAt).toLocaleString()}</time></>}</>
            : "Latest"}</span>
          {historical && <button type="button" onClick={() => setSelectedTurn(undefined)}>Back to latest</button>}
          <button type="button" className="dashboard-tool-icon turn-older" aria-label="Previous turn" data-tooltip="Previous turn"
            disabled={!previous} onClick={() => setSelectedTurn(previous?.key)}><Icon name="chevron" size={18} /></button>
          <button type="button" className="dashboard-tool-icon turn-newer" aria-label="Next turn" data-tooltip="Next turn"
            disabled={!historical} onClick={() => setSelectedTurn(olderTurns[olderIndex - 1]?.key)}><Icon name="chevron" size={18} /></button>
        </nav>}
        <dl>
          <div className="dashboard-briefing-instruction">
            <dt>{liveSession && <Icon name="notes" size={14} />}Your instruction</dt>
            <dd><span>{waiting ? submitted?.text : shown?.instruction ? previewInline(shown.instruction)
              : shown?.screenshots ? null : !preview && !failed ? "Loading instruction…" : "No instruction available in the transcript."}</span>
              {!!screenshotCount && <span className="dashboard-briefing-attachment">
                {screenshotCount} {screenshotCount === 1 ? "screenshot" : "screenshots"} attached
              </span>}
            </dd>
          </div>
          <div className="dashboard-briefing-update">
            <dt>{liveSession && <Icon name="activity" size={15} />}Agent update</dt>
            <dd>{liveSession && answer ? <>
              <ReplyExcerpt text={answer + (shown?.truncated ? "…" : "")} onFileReference={onFileReference}
                linksAsLabels={!hiddenSections?.references && !!onFileReference && !!onBrowserReference} />
              {shown?.truncated && <p className="dashboard-reply-truncated">{onReadHistory
                ? <button type="button" onClick={onReadHistory}>Read conversation history</button>
                : "Open the session to read the rest."}</p>}
            </> : update ? previewInline(update) : waiting ? "Waiting for the agent’s next recorded update." : failed ? "Couldn’t load the update."
              : preview ? "No reply recorded for this turn yet." : permission ? "Waiting for permission." : "Loading preview…"}</dd>
          </div>
          {action && <div className="dashboard-briefing-action" data-input={kind === "input"}>
            <dt>{permission ? "Permission required" : "What needs you"}</dt>
            <dd>
              {!!choices?.length && <ul>{choices.map(({ text, choices: options }) => (
                <li key={text}>{text}{options.length > 0 && <ul aria-label={permission ? "Permission choices" : "Offered choices"}>
                  {options.map((option, index) => <li key={index}>{option}</li>)}
                </ul>}</li>
              ))}</ul>}
              {action}
              {(permission || kind === "input") && onOpenTerminal && <button type="button" className="secondary"
                onClick={onOpenTerminal}>{permission ? "Review permission in terminal" : "Answer in terminal"}</button>}
            </dd>
          </div>}
        </dl>
        {!liveSession && answer && (answer !== update || preview?.truncated) && <details>
          <summary>Read full reply</summary>
          <ReplyExcerpt text={answer + (preview?.truncated ? "…" : "")} />
          {preview?.truncated && <p>Open the session to read the rest.</p>}
        </details>}
      </div>
      {context && <div className="dashboard-session-context" aria-label="Session context">
        <span>{started && <>Started <time dateTime={started.toISOString()} title={started.toLocaleString()}>{age}</time> · </>}
          {context.compactions} context {context.compactions === 1 ? "compaction" : "compactions"}</span>
        {context.compactions >= 2 && onStartHandoff &&
          <button type="button" onClick={onStartHandoff}>Start fresh with a handoff…</button>}
      </div>}
      {!hiddenSections?.changes && changed && <TurnChangedFiles key={changed.instructionAt} changes={changed} />}
      {!hiddenSections?.references && answer && onFileReference && onBrowserReference && <ReplyReferences key={answer}
        answer={answer} onFile={onFileReference} onBrowser={onBrowserReference} />}
    </div>
    <div className="dashboard-preview-sidebar">
      {!hiddenSections?.uncommitted && checkoutSummary}
      {showTimeline && !compactTurns && <nav className="dashboard-turn-timeline" aria-label="Recent turns">
        <h3><Icon name="history" size={16} />Recent turns</h3>
        <ol>
          <TurnRow turn={latestTurn} latest selected={!historical} status={latestStatus} onSelect={() => setSelectedTurn(undefined)} />
          {olderTurns.map((turn) => <TurnRow key={turn.key} turn={turn} selected={historical?.key === turn.key}
            onSelect={() => setSelectedTurn(turn.key)} />)}
        </ol>
      </nav>}
    </div>
  </div>;
}
