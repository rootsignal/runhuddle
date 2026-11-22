import { useState } from "react";
import { Icon } from "./Icons";
import { readPosition, savePosition } from "./dashboard-position";
import { TerminalPane } from "./Terminal";
import type { TerminalInfo } from "./types";

export function DashboardShell({ project, terminal, visible, connected, opening, error, compactPrompt, compactShell, terminalServiceUpdate, onCompactPrompt, onHide, onStart, onEnd }: {
  project: string;
  terminal?: TerminalInfo;
  visible: boolean;
  connected: boolean;
  opening: boolean;
  error: string;
  compactPrompt: boolean;
  compactShell: boolean | null;
  terminalServiceUpdate: boolean;
  onCompactPrompt: (enabled: boolean) => void;
  onHide: () => void;
  onStart: () => void;
  onEnd: (id: string) => Promise<void>;
}) {
  const clamp = (value: number) => Math.max(25, Math.min(60, value));
  const [size, setSize] = useState(() => clamp(readPosition("dashboardShellHeight", 36)));
  const [terminalError, setTerminalError] = useState("");
  const [closing, setClosing] = useState(false);
  async function stop(action: () => Promise<void>) {
    setClosing(true);
    setTerminalError("");
    try {
      await action();
    } catch (error) {
      setTerminalError((error instanceof Error ? error.message : String(error))
        .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""));
    } finally {
      setClosing(false);
    }
  }
  const [location, setLocation] = useState<{ id: string; path: string }>();
  const cwd = terminal && location?.id === terminal.id ? location.path : undefined;
  function resize(value: number) {
    const next = clamp(Math.round(value));
    setSize(next);
    savePosition("dashboardShellHeight", next);
  }

  return <section className="dashboard-shell" aria-label="Dashboard shell" hidden={!visible}
    style={{ flexBasis: `${size}%` }}>
    <div className="dashboard-shell-divider" role="separator" tabIndex={0}
      aria-label="Resize dashboard shell" aria-orientation="horizontal" aria-valuemin={25}
      aria-valuemax={60} aria-valuenow={size}
      onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const detail = event.currentTarget.parentElement?.parentElement?.getBoundingClientRect();
        if (detail?.height) resize((detail.bottom - event.clientY) / detail.height * 100);
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        resize(size + (event.key === "ArrowUp" ? 5 : -5));
      }} />
    <header>
      <strong title="A separate shell beside the agent session"><Icon name="terminal" size={15} /> Dashboard shell</strong>
      {terminal && <span title={cwd || terminal.cwd}>{cwd || `Started in ${terminal.cwd}`}</span>}
      {compactShell === true && <label title="Applies when you start a fresh shell.">
        <input type="checkbox" checked={compactPrompt} disabled={opening}
          onChange={(event) => onCompactPrompt(event.currentTarget.checked)} /> Compact prompt
      </label>}
      <button disabled={!connected || opening || closing} title={`Start a new shell in ${project}`}
        onClick={() => { setTerminalError(""); onStart(); }}>Start shell here</button>
      {terminal && <button className="end-shell" title="Stop this shell and its running commands" disabled={!connected || opening || closing}
        onClick={() => void stop(() => onEnd(terminal.id))}>End shell…</button>}
      <button onClick={onHide} title="Keep this shell running in the background">Hide shell</button>
    </header>
    {visible && (terminalServiceUpdate || compactShell === false) && <div className="dashboard-shell-hint">
      {terminalServiceUpdate ? <>
        <span>{compactShell ? "A terminal service update is available." : "Compact prompt requires the terminal service update."}</span>
        <button disabled={!connected || opening || closing}
          onClick={() => void stop(() => window.runhuddle.updateTerminalService())}>Stop all terminals and update…</button>
      </> : <span>Compact prompt requires Bash on this system.</span>}
    </div>}
    {visible && (error || terminalError) && <p role="alert">{error || terminalError}</p>}
    <div className="dashboard-terminal-surface">
      {terminal && connected ? <TerminalPane key={terminal.id} id={terminal.id}
        visible={visible} focused={visible} onTitle={() => {}} onError={setTerminalError}
        onDirectory={(path) => setLocation((previous) =>
          previous?.id === terminal.id && previous.path === path ? previous : { id: terminal.id, path })} />
        : !connected ? <p role="status">Terminal connection interrupted.</p>
          : opening ? <p role="status">Opening shell…</p>
            : <p>The next shell starts in {project}.</p>}
    </div>
  </section>;
}
