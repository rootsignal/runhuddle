import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AgentIcon, Icon, launchOptions } from "./Icons";
import type { Session, SessionRecap, TerminalInfo } from "./types";

export interface ContinuationRequest {
  source: Session;
  recap?: SessionRecap;
  nextStep?: string;
  anotherAgent: boolean;
}

function excerpt(text: string, limit: number) {
  return text.length <= limit ? text : text.slice(0, limit - 1).trimEnd() + "…";
}

async function prepareContext(source: Session, recap?: SessionRecap, nextStep?: string) {
  const [history, git] = await Promise.all([
    window.runhuddle.handoffHistory(source.provider, source.sessionID)
      .catch(() => window.runhuddle.history(source.provider, source.sessionID)).catch(() => undefined),
    window.runhuddle.gitChanges(source.cwd).catch(() => undefined),
  ]);
  const messages = history?.messages ?? [];
  const latestRequest = messages.findLastIndex((message) => message.role === "user");
  const request = messages[latestRequest]?.text.trim();
  const beforeRequest = messages.slice(0, Math.max(0, latestRequest));
  const previousRequest = beforeRequest.findLastIndex((message) => message.role === "user");
  const previousUpdate = beforeRequest.slice(previousRequest + 1).findLast((message) => message.role === "assistant");
  const latestUpdate = messages.slice(latestRequest + 1).findLast((message) => message.role === "assistant");
  const savedNext = nextStep?.trim();
  const recapLines = recap && [
    recap.done && "Done: " + recap.done,
    recap.pending && "Pending: " + recap.pending,
    recap.next && "Suggested next step: " + recap.next,
  ].filter(Boolean);
  const sections = [
    "Continue the work in " + source.cwd + ".\nSource session: " + source.title +
      "\nUse the recorded excerpts as context. Verify current state before editing.",
    history && "compactionSummary" in history && typeof history.compactionSummary === "string"
      ? source.provider + " compaction summary\n" + history.compactionSummary : undefined,
    request ? "Current request\n" + excerpt(request, 3000) : undefined,
    previousRequest >= 0 ? "Previous request and response\n" +
      "User: " + excerpt(beforeRequest[previousRequest].text, 1500) +
      (previousUpdate ? "\nAgent: " + excerpt(previousUpdate.text, 3500) : "") : undefined,
    latestUpdate ? "Latest recorded agent update\n" + excerpt(latestUpdate.text, 3500) : undefined,
    recap && recapLines?.length ? "Saved recap (" + new Date(recap.generatedAt).toLocaleDateString() + ")\n" + recapLines.join("\n") : undefined,
    "Next step\n" + (savedNext
      ? "Saved by the user: " + savedNext
      : request
        ? "Check which parts of the current request are complete, then handle the remaining work. Ask for clarification if the excerpts leave the next action unclear."
        : "Confirm the goal and next action before making changes."),
    git ? "Checkout at handoff\nBranch: " + git.branch + (git.files.length
      ? "\nChanged files:\n" + git.files.slice(0, 25).map((file) => file.area + " " + file.path).join("\n") +
        (git.files.length > 25 ? "\n" + (git.files.length - 25) + " more changed files" : "")
      : "\nWorking tree is clean.") : undefined,
    history?.truncated ? "The recorded context covers only the end of the conversation." :
      !messages.length ? "Conversation history is unavailable." : undefined,
  ];
  return sections.filter(Boolean).join("\n\n");
}

export function SessionContinuation({ request, onCreate, onClose }: {
  request: ContinuationRequest;
  onCreate: (agent: string, cwd: string) => Promise<TerminalInfo>;
  onClose: () => void;
}) {
  const { source, recap, nextStep, anotherAgent } = request;
  const currentAgent = source.provider.toLowerCase();
  const options = launchOptions.filter((option) => option.id !== "shell" && (!anotherAgent || option.id !== currentAgent));
  const [agent, setAgent] = useState(anotherAgent
    ? currentAgent === "claude" ? "codex" : "claude"
    : options.find((option) => option.id === currentAgent)?.id ?? options[0].id);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState(true);
  const [pasted, setPasted] = useState(false);
  const [destination, setDestination] = useState<TerminalInfo>();
  const dialog = useRef<HTMLDialogElement>(null);
  const agentName = options.find((option) => option.id === agent)?.name;

  useEffect(() => {
    let active = true;
    void prepareContext(source, recap, nextStep).then((context) => {
      if (!active) return;
      setDraft(context);
      setLoading(false);
    });
    return () => { active = false; };
  }, [source, recap, nextStep]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => element.close();
  }, [review]);

  async function launch() {
    setBusy(true);
    setError("");
    try {
      setDestination(await onCreate(agent, source.cwd));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  function closeReview() {
    if (destination) setReview(false);
    else onClose();
  }
  async function paste() {
    if (!destination || busy) return;
    setBusy(true);
    setError("");
    try {
      await window.runhuddle.write(destination.id, "\x1b[200~" + draft.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "") + "\x1b[201~");
    } catch (reason) {
      setError(String(reason));
      setBusy(false);
      return;
    }
    const provider = launchOptions.find((option) => option.id === destination.agent)?.name;
    if (source.sessionID && destination.sessionID && provider) {
      try {
        const recorded = await window.runhuddle.recordSessionContinuation(
          { provider: source.provider, sessionID: source.sessionID },
          { provider, sessionID: destination.sessionID }, destination.title);
        if (!recorded) throw Error("Session link unavailable");
      } catch {
        setError("The briefing was pasted. RunHuddle couldn’t save the link between the sessions.");
        setBusy(false);
        setPasted(true);
        return;
      }
    }
    onClose();
  }
  return createPortal(review ? (
    <dialog ref={dialog} className="handoff-review"
      aria-label={anotherAgent ? "Review agent handoff" : "Start new session with context"}
      onCancel={(event) => { event.preventDefault(); if (!busy) closeReview(); }}>
      <header>
        <h2>{anotherAgent ? "Continue with another agent" : "Start new session with context"}</h2>
        <button type="button" disabled={busy} aria-label="Close handoff review" onClick={closeReview}><Icon name="close" size={17} /></button>
      </header>
      <div className="handoff-route">
        <section aria-label="Source session">
          <small>From</small>
          <div><AgentIcon agent={currentAgent} /><strong>{source.title}</strong></div>
          <p>{source.provider} · {source.terminalId ? "Live session" : "Saved conversation"}</p>
        </section>
        <section aria-label="Destination session">
          <small>To</small>
          <label>New session with <select aria-label={anotherAgent ? "Handoff agent" : "Agent for new session"}
            value={agent} disabled={busy || !!destination} onChange={(event) => setAgent(event.target.value)}>
            {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select></label>
          <p title={source.cwd}>{source.cwd}</p>
        </section>
      </div>
      {source.terminalId && <p>Your original session stays open.</p>}
      <label className="handoff-briefing">Briefing
        <textarea aria-label={anotherAgent ? "Handoff context" : "Context for new session"}
          aria-describedby="handoff-briefing-help" value={draft} placeholder="Loading session context…"
          disabled={loading || busy} readOnly={!!destination} onChange={(event) => setDraft(event.target.value)} />
      </label>
      <p id="handoff-briefing-help">{destination
        ? "Session created. Open its terminal, then paste the briefing when the prompt is ready."
        : "Review or edit the text above. Creating the session leaves the briefing here for you to paste."}</p>
      {error && <p role="alert">{error}</p>}
      <footer>
        {!destination && <button disabled={busy} onClick={closeReview}>Cancel</button>}
        {destination
          ? <button className="primary" onClick={closeReview}>Show new session</button>
          : <button className="primary" disabled={loading || busy || !draft.trim()} onClick={() => void launch()}>
              {busy ? "Creating session…" : `Create ${agentName} session`}
            </button>}
      </footer>
    </dialog>
  ) : (
    <aside className="usage-warning" aria-label={anotherAgent ? "Handoff ready" : "Session context ready"}>
      <strong>Briefing ready for the new {agentName} session</strong>
      <p>From {source.title}</p>
      <p>{pasted ? "Press Enter in the agent terminal to send the briefing."
        : "When the agent prompt is ready, paste the briefing, then press Enter in the terminal to send it."}</p>
      <div className="usage-warning-actions">
        <button disabled={busy} onClick={onClose}>Dismiss</button>
        {!pasted && <button disabled={busy} className="primary" onClick={() => void paste()}>Paste briefing</button>}
      </div>
      {error && <p role="alert">{error}</p>}
    </aside>
  ), (!review && document.getElementById("dashboard-handoff")) || document.body);
}
