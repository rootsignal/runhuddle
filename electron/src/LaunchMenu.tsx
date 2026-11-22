import { useEffect, useRef, useState } from "react";
import { AgentIcon, Icon, launchOptions } from "./Icons";
const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).at(-1) || p;
export function LaunchMenu({
  cwd,
  projects,
  lastUsed,
  onLaunch,
  onDismiss,
}: {
  cwd: string;
  projects: string[];
  lastUsed: string;
  onLaunch: (agent: string, cwd: string, name: string) => Promise<unknown>;
  onDismiss: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [sessionName, setSessionName] = useState("");
  const [folder, setFolder] = useState(cwd);
  const [starting, setStarting] = useState<string>();
  const busy = !!starting;
  const [error, setError] = useState("");
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    node.querySelector("select")?.focus();
    return () => node.close();
  }, []);
  async function chooseFolder() {
    try {
      const result = await window.runhuddle.chooseFolder();
      if (result) setFolder(result);
    } catch (e) {
      setError(String(e));
    }
  }
  async function launch(agent: string) {
    if (!folder || busy) return;
    setStarting(agent);
    setError("");
    try {
      await onLaunch(agent, folder, agent === "shell" ? "" : sessionName.trim());
      onDismiss();
    } catch (e) {
      setError(String(e));
    } finally {
      setStarting(undefined);
    }
  }
  const folders = [...new Set([folder, ...projects])].filter(Boolean);
  const agents = launchOptions.filter(({ id }) => id !== "shell");
  const previousAgent = agents.find(({ id }) => id === lastUsed);
  const orderedAgents = previousAgent ? [previousAgent, ...agents.filter(({ id }) => id !== lastUsed)] : agents;
  function renderChoice(option: (typeof launchOptions)[number]) {
    const terminal = option.id === "shell";
    return <button key={option.id} type="button" className="launch-choice" data-recent={previousAgent?.id === option.id}
      aria-label={`Start ${option.label}`} disabled={busy || !folder} onClick={() => void launch(option.id)}>
      <AgentIcon agent={option.id} />
      <span className="launch-choice-label">
        <strong>{option.label}</strong>
        {terminal && <small>{option.detail}</small>}
      </span>
      {previousAgent?.id === option.id && <span className="last-used">Last used</span>}
      <Icon name="arrow" size={16} />
    </button>;
  }
  return (
    <dialog
      ref={dialog}
      className="launch-menu"
      aria-label="New session or terminal"
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!busy) onDismiss();
      }}
      onClick={(e) => {
        if (e.target === dialog.current && !busy) onDismiss();
      }}
    >
      <div className="launch-heading">
        <h2>New session or terminal</h2>
        <button aria-label="Close launcher" disabled={busy} onClick={onDismiss}>
          <Icon name="close" />
        </button>
      </div>
      <div className="launch-destination">
        <label htmlFor="launch-folder">Project folder</label>
        <div>
          <Icon name="folder" />
          <select
            id="launch-folder"
            aria-label="Launch folder"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            disabled={busy}
          >
            <option value="">Choose a folder…</option>
            {folders.map((p) => (
              <option key={p} value={p}>
                {basename(p)}
              </option>
            ))}
          </select>
          <button disabled={busy} onClick={chooseFolder}>
            Browse…
          </button>
        </div>
        {folder && <p title={folder}>{folder}</p>}
      </div>
      <section className="launch-agent-section" aria-labelledby="launch-agent-heading">
        <h3 id="launch-agent-heading">AI session</h3>
        <div className="session-name-field">
          <label htmlFor="launch-session-name">Session name <small>Optional</small></label>
          <input id="launch-session-name" value={sessionName} maxLength={100} placeholder="Automatic title"
            aria-describedby="launch-session-name-help" disabled={busy} onChange={(event) => setSessionName(event.target.value)} />
          <small id="launch-session-name-help">Enter a fixed name or leave blank for an automatic title.</small>
        </div>
        <div className="launch-choices">{orderedAgents.map(renderChoice)}</div>
      </section>
      <section className="launch-shell-section" aria-label="Plain terminal">
        {launchOptions.filter(({ id }) => id === "shell").map(renderChoice)}
      </section>
      {error && (
        <p className="launch-error" role="alert">
          {error}
        </p>
      )}
      {starting && <p className="launch-progress" role="status">Starting {launchOptions.find(({ id }) => id === starting)?.label}…</p>}
    </dialog>
  );
}
