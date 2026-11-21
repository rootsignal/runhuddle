import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AgentIcon, Icon } from "./Icons";
import { TerminalPane } from "./Terminal";
import type { AppCommand, DashboardRequest, KeyboardBindings, Session, TerminalInfo } from "./types";

export const defaultBindings: KeyboardBindings = { palette: "CmdOrCtrl+P", terminal: "CmdOrCtrl+T" };
const isMac = /Mac/i.test(navigator.platform);
export const bindingText = (binding: string) => isMac
  ? binding.replace("CmdOrCtrl+", "⌘").replace("Ctrl+", "⌃").replace("Alt+", "⌥").replace("Shift+", "⇧")
  : binding.replace("CmdOrCtrl", "Ctrl");

export function bindingForEvent(event: Pick<KeyboardEvent, "code" | "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">) {
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3)
    : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5) : event.key.toUpperCase();
  const command = isMac ? event.metaKey : event.ctrlKey;
  if (!/^(?:[A-Z0-9]|F[1-9]|F1[0-2])$/.test(key) ||
      (!command && !event.ctrlKey && !event.altKey) || (isMac && command && event.ctrlKey) ||
      (!isMac && event.metaKey)) return "";
  return [command ? "CmdOrCtrl" : event.ctrlKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : "", key].filter(Boolean).join("+");
}

function Overlay({ label, className, children, onClose }: {
  label: string; className: string; children: ReactNode; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const node = dialog.current!;
    const previousFocus = document.activeElement;
    node.showModal();
    return () => {
      node.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} aria-label={label} className={`appearance-dialog ${className}`}
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
    {children}
  </dialog>;
}

type PaletteChoice = {
  id: string;
  label: string;
  hint?: string;
  search?: string;
  icon: Parameters<typeof Icon>[0]["name"];
  provider?: string;
  action: AppCommand | DashboardRequest;
};

export function CommandPalette({ bindings, projects, sessions, onChoose, onClose }: {
  bindings: KeyboardBindings;
  projects: string[];
  sessions: Session[];
  onChoose: (action: PaletteChoice["action"]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const commands: PaletteChoice[] = [
    { id: "new", label: "New session", hint: bindingText("CmdOrCtrl+N"), icon: "plus", action: "new-session" },
    { id: "terminal", label: "Quick Terminal", hint: bindingText(bindings.terminal), icon: "terminal", action: "quick-terminal" },
    { id: "browser", label: "Open Browser", icon: "browser", action: "open-browser" },
    { id: "projects", label: "Browse projects", icon: "folder", action: "projects" },
    { id: "recent", label: "Recent sessions", icon: "history", action: "recent" },
    { id: "review", label: "Next review", icon: "inbox", action: "next-review" },
    { id: "attention", label: "Next attention", hint: bindingText("Alt+Shift+→"), icon: "attention", action: "next-attention" },
    { id: "return", label: "Return to interrupted session", hint: bindingText("Alt+Shift+←"), icon: "arrow", action: "return-session" },
    { id: "dashboard", label: "Project dashboard", icon: "activity", action: "dashboard" },
    { id: "workspace", label: "Open workspace", icon: "open-workspace", action: "workspace" },
    { id: "github-mcp", label: "Connect or manage GitHub MCP", icon: "branch", action: "mcp-settings" },
    { id: "shortcuts", label: "Keyboard shortcuts", icon: "pencil", action: "keyboard-shortcuts" },
  ];
  const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) || path;
  const terms = query.trim().replace(/^>\s*/, "").toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (row: PaletteChoice) =>
    terms.every((term) => [row.label, row.search, row.provider].join(" ").toLowerCase().includes(term));
  const matchingCommands = commands.filter(matches);
  const commandsOnly = query.trimStart().startsWith(">");
  const sessionRows = !commandsOnly ? [...sessions]
    .sort((a, b) => Number(!!b.terminalId) - Number(!!a.terminalId) || b.updated - a.updated)
    .map((row): PaletteChoice => ({
      id: "session:" + row.provider + ":" + row.sessionID, label: row.title, hint: folderName(row.cwd),
      search: row.cwd, provider: row.provider, icon: "notes",
      action: { command: "open-session", session: row.provider + ":" + row.sessionID },
    })).filter(matches).slice(0, terms.length ? 12 : 4) : [];
  const projectRows = !commandsOnly && terms.length ? projects.map((folder): PaletteChoice => ({
    id: "project:" + folder, label: folderName(folder), search: folder, hint: "Project", icon: "folder",
    action: { command: "open-project", folder },
  })).filter(matches).slice(0, 8) : [];
  const results = [...matchingCommands, ...sessionRows, ...projectRows];
  const active = Math.min(selection, Math.max(0, results.length - 1));
  function move(step: number) {
    if (!results.length) return;
    const index = (active + step + results.length) % results.length;
    setSelection(index);
    list.current?.querySelectorAll("button")[index]?.scrollIntoView({ block: "nearest" });
  }
  return <Overlay label="Command Palette" className="command-palette" onClose={onClose}>
    <div className="command-palette-search">
      <Icon name="search" size={18} />
      <input autoFocus aria-label="Search commands, sessions, and projects" placeholder="Search sessions, projects, and commands"
        value={query} onChange={(event) => { setQuery(event.target.value); setSelection(0); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            move(event.key === "ArrowDown" ? 1 : -1);
          } else if (event.key === "Enter" && results[active]) {
            event.preventDefault();
            onChoose(results[active].action);
          }
        }} />
      <button aria-label="Close Command Palette" onClick={onClose}><Icon name="close" size={17} /></button>
    </div>
    <div ref={list} className="command-palette-results">
      {results.map((row, index) => <button key={row.id} data-active={index === active} onClick={() => onChoose(row.action)}>
        {row.provider ? <AgentIcon agent={row.provider.toLowerCase()} /> : <Icon name={row.icon} size={17} />}
        <span>{row.label}</span>{row.hint && <small>{row.hint}</small>}
      </button>)}
      {!results.length && <p>No matches.</p>}
    </div>
    <footer><span><kbd>↑</kbd> <kbd>↓</kbd> Navigate</span><span><kbd>↵</kbd> Open</span><span><kbd>&gt;</kbd> Commands only</span></footer>
  </Overlay>;
}

export function KeyboardShortcutSettings({ bindings, onSave, onClose }: {
  bindings: KeyboardBindings;
  onSave: (bindings: KeyboardBindings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(bindings);
  const [recording, setRecording] = useState<keyof KeyboardBindings>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void window.runhuddle.recordKeyboardShortcuts(true);
    return () => { void window.runhuddle.recordKeyboardShortcuts(false); };
  }, []);
  async function save() {
    setSaving(true);
    setError("");
    try {
      onSave(await window.runhuddle.saveKeyboardShortcuts(draft));
    } catch (reason) {
      setError(String(reason).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""));
    } finally {
      setSaving(false);
    }
  }
  return <Overlay label="Keyboard Shortcuts" className="keyboard-shortcuts" onClose={onClose}>
    <header><h2>Keyboard Shortcuts</h2><button autoFocus aria-label="Close keyboard shortcuts" onClick={onClose}><Icon name="close" /></button></header>
    {([["palette", "Command Palette"], ["terminal", "Quick Terminal"]] as const).map(([id, label]) => <div key={id} className="keyboard-shortcut-row">
      <span>{label}</span><kbd>{bindingText(draft[id])}</kbd>
      {recording === id
        ? <input autoFocus readOnly aria-label={`Record shortcut for ${label}`} placeholder="Press a shortcut"
          onBlur={() => setRecording(undefined)}
          onKeyDown={(event) => {
            if (event.key === "Escape" || event.key === "Tab") return;
            event.preventDefault();
            const shortcut = bindingForEvent(event);
            if (!shortcut) return;
            setDraft((old) => ({ ...old, [id]: shortcut }));
            setError("");
            setRecording(undefined);
          }} />
        : <button className="secondary" aria-label={`Record shortcut for ${label}`} onClick={() => setRecording(id)}>Record</button>}
    </div>)}
    {error && <p role="alert">{error}</p>}
    <footer>
      <button onClick={() => { setDraft(defaultBindings); setError(""); }}>Reset to defaults</button>
      <button className="primary" disabled={saving || !!recording} onClick={() => void save()}>Save shortcuts</button>
    </footer>
  </Overlay>;
}

export function QuickTerminal({ terminal, cwd, connected, animate, onAnimate, onStart, onEnd, onClose }: {
  terminal?: TerminalInfo;
  cwd: string;
  connected: boolean;
  animate: boolean;
  onAnimate: (enabled: boolean) => void;
  onStart: () => Promise<void>;
  onEnd: (id: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [directory, setDirectory] = useState("");
  const attempted = useRef(false);
  const animateOnOpen = useRef(animate);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(String(reason).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (terminal) { attempted.current = true; return; }
    if (!connected || !cwd || attempted.current) return;
    attempted.current = true;
    void run(onStart);
  }, [connected, terminal, cwd, onStart]);
  return <Overlay label="Quick Terminal" className={`quick-terminal-overlay${animate && animateOnOpen.current ? " quick-terminal-animated" : ""}`} onClose={onClose}>
    <header>
      <Icon name="terminal" size={18} />
      <div><h2>Quick Terminal</h2><small title={directory || terminal?.cwd || cwd}>{directory || terminal?.cwd || cwd}</small></div>
      {terminal && <button disabled={busy} onClick={() => {
        void run(async () => { if (await onEnd(terminal.id)) setDirectory(""); });
      }}>End shell…</button>}
      <button className="dashboard-tool-icon quick-terminal-motion" aria-label="Animate Quick Terminal"
        aria-pressed={animate} data-tooltip={animate ? "Disable entrance animation" : "Enable entrance animation"}
        onClick={() => onAnimate(!animate)}><Icon name="activity" size={17} /></button>
      <button autoFocus aria-label="Dismiss Quick Terminal" onClick={onClose}><Icon name="close" size={18} /></button>
    </header>
    {error && <p role="alert">{error}</p>}
    <div className="quick-terminal-surface">
      {terminal && connected ? <TerminalPane key={terminal.id} id={terminal.id} visible focused
        onTitle={() => {}} onDirectory={setDirectory} onError={setError} />
        : !connected ? <p role="status">Terminal connection interrupted.</p>
          : busy ? <p role="status">Opening shell…</p>
            : <button className="primary" disabled={!cwd} onClick={() => void run(onStart)}>Start shell</button>}
    </div>
  </Overlay>;
}
