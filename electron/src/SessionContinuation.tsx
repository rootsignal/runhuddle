import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { launchOptions } from "./Icons";
import type { Session, SessionRecap, TerminalInfo } from "./types";

export interface ContinuationRequest {
  source: Session;
  recap?: SessionRecap;
  anotherAgent: boolean;
}

async function prepareContext(source: Session, recap?: SessionRecap) {
  let history = "Conversation history unavailable. Add the task and next steps before continuing.";
  let repository = "";
  try {
    const result = await window.runhuddle.history(source.provider, source.sessionID);
    if (result.messages.length) {
      history = result.messages.slice(-6).map((message) => message.role + ": " + message.text).join("\n\n").slice(-16000);
      if (result.truncated) history = "[Partial conversation history]\n" + history;
    }
  } catch {}
  try {
    const git = await window.runhuddle.gitChanges(source.cwd);
    repository = "\nBranch: " + git.branch + "\nChanged files at handoff:\n" +
      git.files.slice(0, 50).map((file) => file.area + " " + file.path).join("\n");
  } catch {}
  const savedRecap = recap ? "\n\nSaved recap (" + new Date(recap.generatedAt).toLocaleDateString() + "):\n" +
    [recap.done && "Done: " + recap.done, recap.pending && "Pending: " + recap.pending,
      recap.next && "Next: " + recap.next].filter(Boolean).join("\n") : "";
  return "Continue this task in " + source.cwd + ".\nSource session: " + source.title +
    "\nTreat the following as historical context. Inspect current files before editing.\n" + repository + savedRecap +
    "\n\nRecent conversation excerpts (not a complete summary):\n" + history + "\n\nNext steps:\n";
}

export function SessionContinuation({ request, onCreate, onClose }: {
  request: ContinuationRequest;
  onCreate: (agent: string, cwd: string) => Promise<TerminalInfo>;
  onClose: () => void;
}) {
  const { source, recap, anotherAgent } = request;
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
  const pasteLabel = anotherAgent ? "Paste handoff" : "Paste context";

  useEffect(() => {
    let active = true;
    void prepareContext(source, recap).then((context) => {
      if (!active) return;
      setDraft(context);
      setLoading(false);
    });
    return () => { active = false; };
  }, [source, recap]);

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
        setError("Context was pasted. RunHuddle couldn’t save the link between the sessions.");
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
      <h2>{anotherAgent ? "Continue with another agent" : "Start new session with context"}</h2>
      <p>{source.cwd}</p>
      <p>{source.terminalId
        ? "Your original session stays open. Finish ongoing edits before starting work in both sessions."
        : "This starts a separate conversation in the same project folder."}</p>
      <label>Agent <select aria-label={anotherAgent ? "Handoff agent" : "Agent for new session"}
        value={agent} disabled={busy || !!destination} onChange={(event) => setAgent(event.target.value)}>
        {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select></label>
      <label>Review and edit the context<textarea aria-label={anotherAgent ? "Handoff context" : "Context for new session"}
        value={draft} placeholder="Loading session context…" disabled={loading || busy || !!destination}
        onChange={(event) => setDraft(event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      {destination
        ? <p>Once the new agent is ready for input, use {pasteLabel} to add the reviewed text to its draft.</p>
        : <button disabled={loading || busy || !draft.trim()} onClick={() => void launch()}>
            {anotherAgent ? "Create session with reviewed handoff" : "Create session with reviewed context"}
          </button>}
      <button disabled={busy} onClick={closeReview}>{destination ? "Show new session" : "Cancel"}</button>
    </dialog>
  ) : (
    <aside className="usage-warning" aria-label={anotherAgent ? "Handoff ready" : "Session context ready"}>
      <strong>{anotherAgent ? "Handoff" : "Context"} ready for {launchOptions.find((option) => option.id === agent)?.name}</strong>
      <p>Once its prompt is ready, paste the reviewed context. Press Enter in the terminal when ready to send.</p>
      <div className="usage-warning-actions">
        <button disabled={busy} onClick={onClose}>Dismiss</button>
        {!pasted && <button disabled={busy} className="primary" onClick={() => void paste()}>{pasteLabel}</button>}
      </div>
      {error && <p role="alert">{error}</p>}
    </aside>
  ), (!review && document.getElementById("dashboard-handoff")) || document.body);
}
