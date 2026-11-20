import { Icon } from "./Icons";
import { ReplyReferences } from "./ReplyReferences";
import type { TerminalPermissionPrompt } from "./TerminalPermission";
import { useEffect, useRef, useState } from "react";
import type { InboxEntry, InboxPreview, Session, SessionRecap } from "./types";

function previewInline(text: string, linksAsLabels = false) {
  const display = linksAsLabels ? text.replace(/\[([^\]\n]+)\]\((?:<[^>\n]+>|[^\s)]+)\)/g, "$1") : text;
  return display.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part, index) => {
    if (index % 2 === 0) return part;
    return part.startsWith("`")
      ? <code key={index}>{part.slice(1, -1)}</code>
      : <strong key={index}>{part.slice(2, -2)}</strong>;
  });
}

export function ReplyExcerpt({ text, linksAsLabels = false }: { text: string; linksAsLabels?: boolean }) {
  const inline = (value: string) => previewInline(value, linksAsLabels);
  const blocks = text.split(/(```[^\n]*\n[\s\S]*?```)/)
    .flatMap((block, index) => index % 2 ? [block] : block.split(/\n[ \t]*\n/))
    .filter((block) => block.trim());
  return <div className="dashboard-review-excerpt">{blocks.map((block, index) => {
    if (block.startsWith("```")) return <pre key={index}><code>{block.replace(/^```[^\n]*\n|\n?```$/g, "")}</code></pre>;
    const heading = /^(#{1,6}) +(.+)$/.exec(block.trim());
    if (heading) return heading[1].length === 1
      ? <h3 key={index}>{inline(heading[2])}</h3>
      : <h4 key={index}>{inline(heading[2])}</h4>;
    const lines = block.trimEnd().split("\n");
    if (lines.every((line) => /^[-*] +/.test(line))) {
      return <ul key={index}>{lines.map((line, item) =>
        <li key={item}>{inline(line.replace(/^[-*] +/, ""))}</li>)}</ul>;
    }
    return <p key={index}>{inline(block)}</p>;
  })}</div>;
}

export function AttentionPreview({ enabled = true, id, kind, recap, updated, liveSession, permission, liveState, submitted, reviewID, onReview, onFileReference, onBrowserReference }: {
  enabled?: boolean;
  id: string;
  kind: InboxEntry["kind"];
  recap?: SessionRecap;
  updated?: number;
  permission?: TerminalPermissionPrompt;
  liveState?: string;
  reviewID?: string;
  onReview?: (id: string) => void;
  submitted?: { text: string; at: number; screenshots?: number };
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
  const answer = waiting ? undefined : shown?.answer;
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
  const action = permission ? "Choose an option in the terminal."
    : kind === "input" ? "Open the terminal to respond."
    : pending || (liveState === "idle" ? "Ready for a follow-up."
      : liveState === "working" ? "The agent is working."
      : liveState ? "Open the terminal to check the agent’s status."
      : "Review the agent’s update.");
  return <>
    <div className="dashboard-review-preview dashboard-briefing">
      {liveSession && olderTurns.length > 0 && <nav className="dashboard-turn-navigation" aria-label="Recent turns">
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
        <div>
          <dt>Your instruction</dt>
          <dd><span>{waiting ? submitted?.text : shown?.instruction ? previewInline(shown.instruction)
            : shown?.screenshots ? null : !preview && !failed ? "Loading instruction…" : "No instruction available in the transcript."}</span>
            {!!screenshotCount && <span className="dashboard-briefing-attachment">
              {screenshotCount} {screenshotCount === 1 ? "screenshot" : "screenshots"} attached
            </span>}
          </dd>
        </div>
        <div>
          <dt>Agent update</dt>
          <dd>{liveSession && answer ? <>
            <ReplyExcerpt text={answer + (shown?.truncated ? "…" : "")} linksAsLabels={!!onFileReference && !!onBrowserReference} />
            {shown?.truncated && <p className="dashboard-reply-truncated">Open in workspace to read the rest.</p>}
          </> : update ? previewInline(update) : waiting ? "Waiting for the agent’s next recorded update." : failed ? "Couldn’t load the update."
            : preview ? "No reply recorded for this turn yet." : permission ? "Waiting for permission." : "Loading preview…"}</dd>
        </div>
        <div>
          <dt>{permission ? "Permission required" : "What needs you"}</dt>
          <dd>
            {!!choices?.length && <ul>{choices.map(({ text, choices: options }) => (
              <li key={text}>{text}{options.length > 0 && <ul aria-label={permission ? "Permission choices" : "Offered choices"}>
                {options.map((option, index) => <li key={index}>{option}</li>)}
              </ul>}</li>
            ))}</ul>}
            {action}
          </dd>
        </div>
      </dl>
      {!liveSession && answer && (answer !== update || preview?.truncated) && <details>
        <summary>Read full reply</summary>
        <ReplyExcerpt text={answer + (preview?.truncated ? "…" : "")} />
        {preview?.truncated && <p>Open the session to read the rest.</p>}
      </details>}
    </div>
    {answer && onFileReference && onBrowserReference && <ReplyReferences key={answer}
      answer={answer} onFile={onFileReference} onBrowser={onBrowserReference} />}
  </>;
}
