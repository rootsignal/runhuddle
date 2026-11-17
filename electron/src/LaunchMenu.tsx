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
  onLaunch: (agent: string, cwd: string) => Promise<void>;
  onDismiss: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [folder, setFolder] = useState(cwd);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    node
      .querySelector<HTMLButtonElement>(`[data-agent="${lastUsed || "codex"}"]`)
      ?.focus();
    return () => node.close();
  }, [lastUsed]);
  async function chooseFolder() {
    try {
      const result = await window.runhuddle.chooseFolder();
      if (result) setFolder(result);
    } catch (e) {
      setError(String(e));
    }
  }
  async function launch(agent: string) {
    setBusy(true);
    setError("");
    try {
      const destination = folder || (await window.runhuddle.chooseFolder());
      if (!destination) return;
      setFolder(destination);
      await onLaunch(agent, destination);
      onDismiss();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const folders = [...new Set([folder, ...projects])].filter(Boolean);
  return (
    <dialog
      ref={dialog}
      className="launch-menu"
      aria-label="New session or terminal"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onDismiss();
      }}
      onClick={(e) => {
        if (e.target === dialog.current && !busy) onDismiss();
      }}
    >
      <div className="launch-heading">
        <div>
          <h2>Start something new</h2>
          <p>An AI conversation or a plain terminal.</p>
        </div>
        <button aria-label="Close launcher" disabled={busy} onClick={onDismiss}>
          <Icon name="close" />
        </button>
      </div>
      <div className="launch-destination">
        <label htmlFor="launch-folder">WORKSPACE</label>
        <div>
          <Icon name="folder" />
          <select
            id="launch-folder"
            aria-label="Launch workspace"
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
        <p title={folder}>{folder || "Choose a folder before starting."}</p>
      </div>
      <div className="launch-choices">
        {launchOptions.map((option) => (
          <button
            key={option.id}
            data-agent={option.id}
            className="launch-choice"
            aria-label={`Start ${option.label}`}
            disabled={busy}
            onClick={() => launch(option.id)}
          >
            <AgentIcon agent={option.id} />
            <span>
              <strong>{option.label}</strong>
              <small>{option.detail}</small>
            </span>
            {lastUsed === option.id && (
              <span className="last-used">Last used</span>
            )}
            <Icon name="arrow" size={16} />
          </button>
        ))}
      </div>
      {error && (
        <p className="launch-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        {busy
          ? "Starting…"
          : "Uses your installed agent CLI and existing login."}
      </footer>
    </dialog>
  );
}
