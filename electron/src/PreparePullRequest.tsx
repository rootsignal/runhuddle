import { useEffect, useRef, useState } from "react";
import recapModels from "../main/recap-models.json";
import { Icon } from "./Icons";
import type { GitPullRequestDraft, Session } from "./types";

const errorText = (error: unknown) => String(error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");

export function PullRequestRoute({ head, target }: { head: string; target: string }) {
  return <div className="pull-request-route">
    <Icon name="branch" size={16} />
    <div><small>Source → Base</small><strong>{head} → {target}</strong></div>
  </div>;
}

export function PreparePullRequest({ cwd, targetRef, session, onClose }: {
  cwd: string;
  targetRef: string;
  session?: Pick<Session, "provider" | "sessionID" | "title">;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<GitPullRequestDraft>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const [agents, setAgents] = useState<string[]>();
  const [agent, setAgent] = useState("");
  const [includeHistory, setIncludeHistory] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);
  const generation = useRef(0);
  const running = useRef(false);
  useEffect(() => {
    const modal = dialog.current!;
    modal.showModal();
    let active = true;
    void window.runhuddle.prepareGitPullRequest(cwd, targetRef).then((value) => {
      if (active) setDraft(value);
    }, (reason) => {
      if (active) setError(errorText(reason));
    });
    void window.runhuddle.installedReviewAgents().then((choices) => {
      if (!active) return;
      setAgents(choices);
      const preferred = localStorage.getItem("recapAgent");
      setAgent(preferred && choices.includes(preferred) ? preferred : choices[0] || "");
    }, () => { if (active) setAgents([]); });
    return () => {
      active = false;
      ++generation.current;
      if (running.current) void window.runhuddle.cancelGitPullRequestDraft(cwd, targetRef).catch(() => {});
      running.current = false;
      modal.close();
    };
  }, [cwd, targetRef]);

  async function generate() {
    if (!draft || !agent || running.current || busy) return;
    running.current = true;
    const ticket = ++generation.current;
    setGenerating(true);
    setError("");
    try {
      const result = await window.runhuddle.draftGitPullRequest(cwd, targetRef, agent, includeHistory && session
        ? { provider: session.provider, sessionID: session.sessionID } : undefined);
      if (generation.current === ticket) { setDraft({ ...draft, ...result }); setGenerated(true); }
    } catch (reason) {
      if (generation.current === ticket) setError(errorText(reason));
    } finally {
      if (generation.current === ticket) {
        running.current = false;
        setGenerating(false);
      }
    }
  }

  async function cancelDraft() {
    try {
      await window.runhuddle.cancelGitPullRequestDraft(cwd, targetRef);
      ++generation.current;
      running.current = false;
      setGenerating(false);
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  async function open() {
    if (!draft || busy || running.current) return;
    setBusy(true);
    setOpened(false);
    setError("");
    try {
      await window.runhuddle.openGitPullRequest(cwd, targetRef, {
        head: draft.head, title: draft.title, body: draft.body,
      });
      setOpened(true);
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return <dialog ref={dialog} className="appearance-dialog prepare-pr-dialog" aria-label="Prepare pull request"
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
    <header>
      <h2>Prepare pull request</h2>
      <button type="button" autoFocus aria-label="Close pull request draft" onClick={onClose}><Icon name="close" size={18} /></button>
    </header>
    {error && <p role="alert">{error}</p>}
    {!draft ? !error && <p role="status">Reading published changes…</p> : <form onSubmit={(event) => {
      event.preventDefault();
      void open();
    }}>
      <PullRequestRoute head={draft.head} target={draft.target} />
      {draft.unpublished > 0 && <p className="prepare-pr-note">{draft.unpublished} {draft.unpublished === 1 ? "local commit is" : "local commits are"} outside the published branch.</p>}
      <details className="prepare-pr-generate">
        <summary>Draft with an agent</summary>
        <div>
          {!!agents?.length && <select aria-label="Drafting agent" value={agent} disabled={generating || busy}
            onChange={(event) => setAgent(event.target.value)}>
            {agents.map((name) => <option key={name} value={name}>{recapModels[name as keyof typeof recapModels]?.agent ?? name}</option>)}
          </select>}
          {generating ? <><span role="status">Reading the diff…</span>
            <button type="button" onClick={() => void cancelDraft()}>Cancel drafting</button></>
            : !!agents?.length && <button type="button" className="secondary" disabled={busy || !agent} onClick={() => void generate()}>{generated ? "Regenerate summary" : "Generate PR summary"}</button>}
        </div>
        {session && !!agents?.length && <label className="prepare-pr-include-history">
          <input type="checkbox" checked={includeHistory} disabled={busy || generating} onChange={(event) => setIncludeHistory(event.target.checked)} />
          Include recent context from this session
        </label>}
        <small>{agents?.length ? "Sends published diff excerpts and any selected session context to the agent. The result replaces the draft below."
          : agents ? "An installed Codex, Claude, or Copilot CLI can draft a description from the diff." : "Checking for drafting agents…"}</small>
      </details>
      <section className="prepare-pr-editor" aria-label="Review draft">
        <h3>Review draft</h3>
        <label>Title<input value={draft.title} maxLength={256} required disabled={generating}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label>Description <small>{draft.templatePath ? `Uses ${draft.templatePath}` : generated ? "Markdown" : "Starter draft"}</small>
          <textarea value={draft.body} rows={13} disabled={generating} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
        </label>
      </section>
      {opened && <p className="prepare-pr-note" role="status">Draft opened in GitHub.</p>}
      <footer>
        <small>Review and create the pull request in GitHub.</small>
        <button type="button" onClick={onClose}>Close</button>
        <button className="primary" disabled={busy || generating || !draft.title.trim()}>{busy ? "Opening…" : "Open in GitHub"}</button>
      </footer>
    </form>}
  </dialog>;
}
