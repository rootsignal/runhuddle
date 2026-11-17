import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AppearanceContext,
  loadAppearance,
  TerminalAppearance,
} from "./TerminalAppearance";
import { ChangesPanel } from "./ChangesPanel";
import { LaunchMenu } from "./LaunchMenu";
import { AgentIcon, Icon, launchOptions } from "./Icons";
import { TerminalWorkspace } from "./TerminalWorkspace";
import { TerminalPane } from "./Terminal";
import type { Snapshot, Session, TerminalInfo } from "./types";
import "./style.css";
import logo from "../assets/icon.png";
const key = (s: Session) => s.provider + ":" + s.sessionID;
const name = (p: string) => p.split(/[\\/]/).filter(Boolean).at(-1) || p;
const labels: Record<string, string> = {
  working: "Working",
  idle: "Idle",
  needsInput: "Needs input",
  saved: "Previous session",
  disconnected: "Unknown",
  archived: "Archived",
};
function readSetting<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function restoredSelection(
  data: Snapshot,
  folder: string,
  previous: string,
  hidden: string[],
) {
  if (
    data.sessions.some(
      (s) => "session:" + key(s) === previous && (!folder || s.cwd === folder),
    ) ||
    data.notes.some(
      (n) => "note:" + n.id === previous && (!folder || n.project === folder),
    )
  )
    return previous;
  const candidates = data.terminals.filter(
    (t) => (!folder || t.cwd === folder) && !hidden.includes(t.id),
  );
  return candidates.some((t) => "terminal:" + t.id === previous)
    ? previous
    : candidates[0]
      ? "terminal:" + candidates[0].id
      : "";
}
function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>({
    sessions: [],
    notes: [],
    pinned: [],
    readAt: null,
    storeError: null,
    terminals: [],
    home: "",
  });
  const [loaded, setLoaded] = useState(false);
  const [connection, setConnection] = useState("connected");
  const [error, setError] = useState("");
  const [appearance, setAppearance] = useState(loadAppearance);
  const [changesOpen, setChangesOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [layoutInfo, setLayoutInfo] = useState<{
    locations: Record<string, string>;
    focused: string;
  }>({ locations: {}, focused: "Pane 1" });
  useEffect(() => {
    localStorage.setItem("terminalAppearance", JSON.stringify(appearance));
  }, [appearance]);
  const [launchKind, setLaunchKind] = useState<"all" | "ai" | "shell">("all");
  const [mode, setMode] = useState<"recent" | "workspaces" | "notes">(() =>
    readSetting("sidebarMode", "recent"),
  );
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [workspace, setWorkspace] = useState(() =>
    readSetting("workspace", ""),
  );
  const [folders, setFolders] = useState<string[]>(() =>
    readSetting("folders", []),
  );
  const [selection, setSelection] = useState("");
  const [linkTarget, setLinkTarget] = useState("");
  const [resuming, setResuming] = useState(false);

  const [hiddenTabs, setHiddenTabs] = useState<string[]>(() =>
    readSetting("hiddenTabs", []),
  );
  useEffect(() => {
    localStorage.setItem("hiddenTabs", JSON.stringify(hiddenTabs));
  }, [hiddenTabs]);
  const [launcher, setLauncher] = useState(false);
  const [lastUsed, setLastUsed] = useState(() =>
    readSetting("lastLaunchType", ""),
  );
  const [lastFolder, setLastFolder] = useState(() =>
    readSetting("lastLaunchFolder", ""),
  );
  const [titles, setTitles] = useState<Record<string, string>>(() =>
    readSetting("terminalTitles", {}),
  );
  const [workspaceSelections, setWorkspaceSelections] = useState<
    Record<string, string>
  >(() => readSetting("workspaceSelections", {}));
  const [sidebar, setSidebar] = useState(() =>
    readSetting("sidebarVisible", true),
  );
  useEffect(() => {
    localStorage.setItem("sidebarMode", JSON.stringify(mode));
  }, [mode]);
  useEffect(() => {
    localStorage.setItem("sidebarVisible", JSON.stringify(sidebar));
  }, [sidebar]);
  useEffect(() => {
    if (loaded)
      setWorkspaceSelections((old) =>
        old[workspace] === selection ? old : { ...old, [workspace]: selection },
      );
  }, [loaded, workspace, selection]);
  useEffect(() => {
    window.runhuddle
      .snapshot()
      .then((data) => {
        setSnapshot(data);
        setConnection(data.connection || "connected");
        setSelection(
          restoredSelection(
            data,
            workspace,
            workspaceSelections[workspace],
            hiddenTabs,
          ),
        );
        setLoaded(true);
      })
      .catch((e) => setError(String(e)));
    return window.runhuddle.onEvent((event) => {
      if (event.event === "terminals")
        setSnapshot((previous) => ({
          ...previous,
          terminals: event.terminals,
        }));
      if (event.event === "store")
        setSnapshot((previous) => ({ ...previous, ...event }));
      if (event.event === "connection") setConnection(event.state);
      if (event.event === "error") setError(event.message);
    });
  }, []);
  useEffect(() => {
    localStorage.setItem("workspace", JSON.stringify(workspace));
  }, [workspace]);
  useEffect(() => {
    localStorage.setItem("folders", JSON.stringify(folders));
  }, [folders]);
  useEffect(() => {
    localStorage.setItem("terminalTitles", JSON.stringify(titles));
  }, [titles]);
  useEffect(() => {
    localStorage.setItem(
      "workspaceSelections",
      JSON.stringify(workspaceSelections),
    );
  }, [workspaceSelections]);
  useEffect(() => {
    function shortcuts(event: KeyboardEvent) {
      if (!(event.metaKey || (event.ctrlKey && event.shiftKey)) || event.altKey)
        return;
      if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        setLauncher(true);
      }
      if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        setSidebar((old) => !old);
      }
    }
    document.addEventListener("keydown", shortcuts);
    return () => document.removeEventListener("keydown", shortcuts);
  }, []);
  const projects = useMemo(
    () =>
      [
        ...new Set([
          ...folders,
          ...snapshot.sessions.map((s) => s.cwd),
          ...snapshot.terminals.map((t) => t.cwd),
        ]),
      ]
        .filter(Boolean)
        .sort((a, b) => name(a).localeCompare(name(b))),
    [folders, snapshot.sessions, snapshot.terminals],
  );
  const sessions = useMemo(
    () =>
      snapshot.sessions
        .filter(
          (s) =>
            (!workspace || s.cwd === workspace) &&
            (scope === "all"
              ? s.state !== "archived"
              : scope === "pinned"
                ? snapshot.pinned.includes(key(s))
                : s.state === "archived") &&
            [s.title, s.project, s.cwd, s.preview, s.provider]
              .join(" ")
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .sort((a, b) => b.updated - a.updated),
    [snapshot.sessions, snapshot.pinned, workspace, scope, query],
  );
  const workspaceTerminals = snapshot.terminals.filter(
    (t) => !workspace || t.cwd === workspace,
  );
  const terminals = workspaceTerminals.filter(
    (t) => !hiddenTabs.includes(t.id),
  );
  const session = snapshot.sessions.find(
    (s) => "session:" + key(s) === selection,
  );
  const note = snapshot.notes.find((n) => "note:" + n.id === selection);
  const terminal = snapshot.terminals.find(
    (t) => "terminal:" + t.id === selection,
  );
  const shown =
    terminal && (!workspace || terminal.cwd === workspace)
      ? terminal
      : undefined;
  function select(value: string) {
    if (value.startsWith("session:")) {
      const row = snapshot.sessions.find((s) => "session:" + key(s) === value);
      if (
        row?.terminalId &&
        snapshot.terminals.some((t) => t.id === row.terminalId && !t.exited)
      )
        value = "terminal:" + row.terminalId;
    }

    const id = value.startsWith("terminal:") ? value.slice(9) : "";
    if (id) {
      setHiddenTabs((old) => old.filter((x) => x !== id));
    }

    setSelection(value);
    setWorkspaceSelections((old) => ({ ...old, [workspace]: value }));
  }
  function switchWorkspace(folder: string) {
    setWorkspace(folder);
    setSelection(
      restoredSelection(
        snapshot,
        folder,
        workspaceSelections[folder],
        hiddenTabs,
      ),
    );
  }
  async function chooseWorkspace() {
    try {
      const folder = await window.runhuddle.chooseFolder();
      if (folder) {
        setFolders((old) => [...new Set([...old, folder])]);
        switchWorkspace(folder);
      }
    } catch (e) {
      setError(String(e));
    }
  }
  async function create(agent: string, cwd: string) {
    const t = await window.runhuddle.create(cwd, agent);
    setSnapshot((old) => ({
      ...old,
      terminals: [...old.terminals.filter((x) => x.id !== t.id), t],
    }));
    setWorkspace(cwd);
    setMode("recent");
    setScope("all");
    setQuery("");

    setSelection("terminal:" + t.id);
    setWorkspaceSelections((old) => ({ ...old, [cwd]: "terminal:" + t.id }));
    setLastUsed(agent);
    setLastFolder(cwd);
    localStorage.setItem("lastLaunchType", JSON.stringify(agent));
    localStorage.setItem("lastLaunchFolder", JSON.stringify(cwd));
  }
  function hideTab(t: TerminalInfo, next?: string) {
    const remaining = terminals.filter((x) => x.id !== t.id);

    setHiddenTabs((old) => [...old, t.id]);

    if (shown?.id === t.id)
      select(
        next
          ? "terminal:" + next
          : remaining[0]
            ? "terminal:" + remaining[0].id
            : "",
      );
  }
  async function close(t: TerminalInfo, preferred?: string) {
    try {
      if (await window.runhuddle.close(t.id)) {
        const index = terminals.findIndex((x) => x.id === t.id);
        const next =
          terminals.find((x) => x.id === preferred) ||
          terminals[index + 1] ||
          terminals[index - 1];
        setSnapshot((old) => ({
          ...old,
          terminals: old.terminals.filter((x) => x.id !== t.id),
        }));
        if (selection === "terminal:" + t.id)
          setSelection(
            t.sessionID
              ? "session:" +
                  (launchOptions.find((o) => o.id === t.agent)?.name ||
                    t.agent) +
                  ":" +
                  t.sessionID
              : next
                ? "terminal:" + next.id
                : "",
          );
      }
    } catch (e) {
      setError(String(e));
    }
  }
  const launchFolder =
    workspace || shown?.cwd || session?.cwd || note?.project || lastFolder;
  function terminalTitle(t: TerminalInfo) {
    if (t.agent !== "shell")
      return (
        snapshot.sessions.find(
          (s) =>
            s.sessionID === t.sessionID && s.provider.toLowerCase() === t.agent,
        )?.title ||
        titles[t.id] ||
        `New ${launchOptions.find((o) => o.id === t.agent)?.name || t.agent} session`
      );
    const peers = snapshot.terminals.filter(
      (x) => x.agent === "shell" && x.cwd === t.cwd,
    );
    return name(t.cwd) + (peers.length > 1 ? ` · ${peers.indexOf(t) + 1}` : "");
  }
  function location(id?: string) {
    if (!id) return "";
    if (hiddenTabs.includes(id)) return "Tab closed · Open from sidebar";
    const placement = layoutInfo.locations[id] || "Opening tab…";
    return shown ? placement : placement.replace(" · Visible", "");
  }
  function liveRow(t: TerminalInfo) {
    return (
      <div key={t.id} className="live-row">
        <button
          className={"session-row " + (shown?.id === t.id ? "selected" : "")}
          onClick={() => select("terminal:" + t.id)}
        >
          <div className="row-top">
            <span>{name(t.cwd)}</span>
            <span className="provider">
              {t.agent === "shell"
                ? "Terminal"
                : launchOptions.find((o) => o.id === t.agent)?.name}
            </span>
          </div>
          <strong>{terminalTitle(t)}</strong>
          <small>
            {t.unavailable
              ? "Unavailable"
              : t.exited
                ? "Exited"
                : t.agent === "shell"
                  ? "Shell open"
                  : "Session open · Status unknown"}
          </small>
          <small className="pane-location">{location(t.id)}</small>
        </button>
        {hiddenTabs.includes(t.id) && (
          <button className="stop-action" onClick={() => close(t)}>
            {t.agent === "shell" ? "Close terminal" : "End session"}
          </button>
        )}
      </div>
    );
  }
  const unlinkedAgents = workspaceTerminals.filter(
    (t) =>
      t.agent !== "shell" &&
      !snapshot.sessions.some(
        (s) =>
          s.sessionID === t.sessionID && s.provider.toLowerCase() === t.agent,
      ),
  );
  const matchesTerminal = (t: TerminalInfo) =>
    [terminalTitle(t), t.cwd, t.agent]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase());
  async function resumeSession(
    provider: string,
    sessionID: string,
    previous?: string,
  ) {
    setResuming(true);
    try {
      const t = await window.runhuddle.resume(provider, sessionID);
      if (t) {
        if (previous && previous !== t.id)
          setHiddenTabs((old) => [...old, previous]);
        setSnapshot((old) => ({
          ...old,
          terminals: [...old.terminals.filter((x) => x.id !== t.id), t],
        }));
        setHiddenTabs((old) => old.filter((id) => id !== t.id));
        setSelection("terminal:" + t.id);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setResuming(false);
    }
  }
  function renderTerminal(t: TerminalInfo) {
    return (
      <section
        key={t.id}
        className={
          "terminal-pane " + (shown?.id === t.id ? "focused-pane" : "")
        }
        aria-label={`${terminalTitle(t)} pane`}
        onPointerDown={() => {
          if (shown?.id !== t.id) select("terminal:" + t.id);
        }}
        onFocusCapture={() => {
          if (shown?.id !== t.id) select("terminal:" + t.id);
        }}
      >
        {t.agent !== "shell" && (
          <div className="pane-heading">
            <AgentIcon agent={t.agent} />
            <span>{terminalTitle(t)}</span>
            {t.exited && t.sessionID && (
              <>
                <small>
                  {t.unavailable
                    ? "Terminal unavailable"
                    : t.exitCode
                      ? `Exited with code ${t.exitCode}`
                      : "Session ended"}
                </small>
                <button
                  disabled={resuming}
                  onClick={() =>
                    resumeSession(
                      launchOptions.find((o) => o.id === t.agent)?.name ||
                        t.agent,
                      t.sessionID!,
                      t.id,
                    )
                  }
                >
                  {resuming ? "Resuming…" : "Resume session"}
                </button>
              </>
            )}
            {t.agent !== "shell" && (
              <button onClick={() => close(t)}>
                {t.exited ? "Remove session" : "End session"}
              </button>
            )}
          </div>
        )}
        <div className="pane-body">
          {t.unavailable ? (
            <div className="document" role="status">
              <h2>Terminal unavailable</h2>
              <p>
                The terminal process is no longer connected. Its pane position
                has been kept.
              </p>
              {t.agent === "shell" ? (
                <button
                  onClick={async () => {
                    try {
                      const replacement = await window.runhuddle.create(
                        t.cwd,
                        "shell",
                      );
                      setSnapshot((old) => ({
                        ...old,
                        terminals: [
                          ...old.terminals.filter(
                            (x) => x.id !== replacement.id,
                          ),
                          replacement,
                        ],
                      }));
                      setSelection("terminal:" + replacement.id);
                      await window.runhuddle.close(t.id);
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  Open new terminal here
                </button>
              ) : (
                <p>
                  Use Resume session above to reopen the recorded conversation.
                </p>
              )}
              <button onClick={() => close(t)}>Remove unavailable tab</button>
            </div>
          ) : connection !== "connected" ? (
            <div className="document" role="status">
              Terminal connection interrupted. Reconnecting…
            </div>
          ) : (
            <TerminalPane
              id={t.id}
              visible={true}
              focused={shown?.id === t.id}
              onError={setError}
              onTitle={(title) => {
                if (t.sessionID && title.trim())
                  window.runhuddle.title(t.id, title).catch(() => {});
                if (t.agent !== "shell" && title.trim())
                  setTitles((old) =>
                    old[t.id] === title
                      ? old
                      : { ...old, [t.id]: title.slice(0, 120) },
                  );
              }}
            />
          )}
        </div>
      </section>
    );
  }
  return (
    <AppearanceContext.Provider value={appearance}>
      <div className={"app " + (!sidebar ? "collapsed" : "")}>
        {appearanceOpen && (
          <TerminalAppearance
            value={appearance}
            onChange={setAppearance}
            onDismiss={() => setAppearanceOpen(false)}
          />
        )}
        {launcher && (
          <LaunchMenu
            cwd={launchFolder}
            projects={projects}
            lastUsed={lastUsed}
            kind={launchKind}
            pane={layoutInfo.focused}
            onLaunch={create}
            onDismiss={() => {
              setLauncher(false);
              setLaunchKind("all");
            }}
          />
        )}
        {sidebar && (
          <aside>
            <header className="brand">
              <img className="brand-mark" src={logo} alt="" />
              <strong>RunHuddle</strong>
              <span className="badge">PREVIEW</span>
            </header>
            <div className="search">
              <input
                type="search"
                aria-label="Search sessions and notes"
                placeholder="Search sessions and notes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <nav className="modes" aria-label="Browse">
              <button
                className={mode === "recent" ? "selected" : ""}
                onClick={() => setMode("recent")}
              >
                Recent
              </button>
              <button
                className={mode === "workspaces" ? "selected" : ""}
                onClick={() => setMode("workspaces")}
              >
                Workspaces
              </button>
              <button
                className={mode === "notes" ? "selected" : ""}
                onClick={() => setMode("notes")}
              >
                Notes
              </button>
            </nav>
            {mode === "recent" && (
              <div className="filters" aria-label="Session filter">
                {["all", "pinned", "archived"].map((s) => (
                  <button
                    key={s}
                    className={scope === s ? "selected" : ""}
                    onClick={() => setScope(s)}
                  >
                    {s[0].toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            )}
            <div className="sidebar-list">
              {mode === "workspaces" ? (
                <>
                  <div className="section-label">
                    PROJECT FOLDERS{" "}
                    <button
                      title="Add workspace folder"
                      onClick={chooseWorkspace}
                    >
                      +
                    </button>
                  </div>
                  <button
                    className={
                      "workspace-row " + (!workspace ? "selected" : "")
                    }
                    onClick={() => {
                      switchWorkspace("");
                    }}
                  >
                    All workspaces <small>{projects.length} folders</small>
                  </button>
                  {projects
                    .filter((p) =>
                      p.toLowerCase().includes(query.toLowerCase()),
                    )
                    .map((p) => (
                      <button
                        key={p}
                        className={
                          "workspace-row " + (workspace === p ? "selected" : "")
                        }
                        onClick={() => {
                          switchWorkspace(p);
                          setMode("recent");
                        }}
                      >
                        <span className="workspace-name">
                          <Icon name="folder" /> {name(p)}
                        </span>
                        <small title={p}>{p}</small>
                        <small>
                          {snapshot.sessions.filter((s) => s.cwd === p).length}{" "}
                          sessions ·{" "}
                          {snapshot.terminals.filter((t) => t.cwd === p).length}{" "}
                          terminals
                        </small>
                      </button>
                    ))}
                </>
              ) : mode === "notes" ? (
                <>
                  {snapshot.notes
                    .filter(
                      (n) =>
                        (!workspace || n.project === workspace) &&
                        [n.title, n.text]
                          .join(" ")
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                    )
                    .map((n) => (
                      <button
                        className={
                          "session-row " +
                          (selection === "note:" + n.id ? "selected" : "")
                        }
                        key={n.id}
                        onClick={() => select("note:" + n.id)}
                      >
                        <small>{name(n.project)}</small>
                        <strong>{n.title}</strong>
                        <small>{n.sourceProvider} · Saved note</small>
                      </button>
                    ))}
                  {!snapshot.notes.length && (
                    <p className="empty-small">
                      Your saved RunHuddle notes will appear here.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="section-label">
                    AI SESSIONS{" "}
                    <span>
                      {sessions.length +
                        (scope === "all"
                          ? unlinkedAgents.filter(matchesTerminal).length
                          : 0)}
                    </span>
                    <button
                      aria-label="New AI session"
                      onClick={() => {
                        setLaunchKind("ai");
                        setLauncher(true);
                      }}
                    >
                      +
                    </button>
                  </div>
                  {scope === "all" &&
                    unlinkedAgents.filter(matchesTerminal).map(liveRow)}
                  {sessions.map((s) => (
                    <button
                      className={
                        "session-row " +
                        (selection === "session:" + key(s) ||
                        (s.terminalId && shown?.id === s.terminalId)
                          ? "selected"
                          : "")
                      }
                      key={key(s)}
                      onClick={() => select("session:" + key(s))}
                    >
                      <div className="row-top">
                        <span>{s.project || name(s.cwd)}</span>
                        <span className="provider">{s.provider}</span>
                      </div>
                      <strong>{s.title}</strong>
                      <p>{s.preview || "No recorded preview"}</p>
                      <small>
                        <span
                          className={
                            "dot " + (s.terminalId ? s.state : "saved")
                          }
                        />
                        {s.terminalId
                          ? snapshot.terminals.find(
                              (t) => t.id === s.terminalId,
                            )?.exited
                            ? "Previous session"
                            : labels[s.state] || s.state
                          : `Recorded · ${labels[s.state] || s.state}`}
                        {s.terminalId && (
                          <span className="pane-location">
                            {location(s.terminalId)}
                          </span>
                        )}
                        <span className="date">
                          {new Date(s.updated * 1000).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric" },
                          )}
                        </span>
                      </small>
                    </button>
                  ))}
                  {!sessions.length && (
                    <p className="empty-small">
                      No sessions match these filters.
                    </p>
                  )}
                  {scope === "all" && (
                    <>
                      <div className="section-label">
                        TERMINALS{" "}
                        <span>
                          {
                            workspaceTerminals.filter(
                              (t) => t.agent === "shell",
                            ).length
                          }
                        </span>
                        <button
                          aria-label="New terminal"
                          onClick={() => {
                            setLaunchKind("shell");
                            setLauncher(true);
                          }}
                        >
                          +
                        </button>
                      </div>
                      {workspaceTerminals
                        .filter(
                          (t) => t.agent === "shell" && matchesTerminal(t),
                        )
                        .map(liveRow)}
                      {!workspaceTerminals.some((t) => t.agent === "shell") && (
                        <p className="empty-small">
                          Shells for commands and dev servers.
                        </p>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
            <footer className="sidebar-foot">
              Sessions and local history
              <br />
              <span>Imported status may be out of date.</span>
            </footer>
          </aside>
        )}
        <main>
          <header className="workspace-header">
            <button
              title={sidebar ? "Hide sidebar" : "Show sidebar"}
              onClick={() => setSidebar(!sidebar)}
            >
              <Icon name="sidebar" />
            </button>
            <div className="workspace-picker">
              <small>WORKSPACE</small>
              <select
                aria-label="Workspace"
                value={workspace}
                onChange={(e) => {
                  switchWorkspace(e.target.value);
                }}
              >
                <option value="">All workspaces</option>
                {projects.map((p) => (
                  <option value={p} key={p}>
                    {name(p)}
                  </option>
                ))}
              </select>
            </div>
            <button
              aria-pressed={changesOpen}
              onClick={() => setChangesOpen(!changesOpen)}
            >
              Changes
            </button>
            <button className="subtle" onClick={chooseWorkspace}>
              Open folder…
            </button>
            <button
              className="primary new-button"
              aria-label="New session or terminal"
              onClick={() => setLauncher(true)}
            >
              <Icon name="plus" size={16} />
              New…
              <Icon name="chevron" size={14} />
            </button>
          </header>
          {connection !== "connected" && (
            <div className="error" role="status">
              {connection === "reconnecting"
                ? "Reconnecting to terminals…"
                : "Terminal connection unavailable."}
              {connection === "disconnected" && (
                <button
                  onClick={() =>
                    window.runhuddle
                      .reconnect()
                      .catch((e) => setError(String(e)))
                  }
                >
                  Retry connection
                </button>
              )}
            </div>
          )}
          {(error || snapshot.storeError) && (
            <div role="alert" className="error">
              {error || snapshot.storeError}
              <button
                aria-label="Dismiss error"
                onClick={() => {
                  setError("");
                  setSnapshot((old) => ({ ...old, storeError: null }));
                }}
              >
                ×
              </button>
            </div>
          )}
          <div className="review-layout">
            <div className="stage">
              {terminals.length > 0 && (
                <div
                  className="workspace-surface"
                  style={{ display: shown ? "flex" : "none" }}
                >
                  <TerminalWorkspace
                    key={workspace}
                    workspace={workspace}
                    terminals={terminals}
                    selected={shown?.id || ""}
                    title={terminalTitle}
                    onSelect={(id) => select("terminal:" + id)}
                    onClose={hideTab}
                    onEnd={close}
                    onLayout={setLayoutInfo}
                    render={renderTerminal}
                  />
                </div>
              )}
              {!shown &&
                (session ? (
                  <article className="document">
                    <small className="eyebrow">
                      RECORDED SESSION · {session.provider}
                    </small>
                    <h1>{session.title}</h1>
                    <p className="muted">{session.cwd}</p>
                    <button
                      className="primary document-action"
                      disabled={resuming}
                      onClick={() =>
                        resumeSession(session.provider, session.sessionID)
                      }
                    >
                      {resuming ? "Resuming…" : "Resume session"}
                    </button>
                    <button
                      className="secondary document-action"
                      onClick={async () => {
                        try {
                          await window.runhuddle.archive(
                            session.provider,
                            session.sessionID,
                            session.state !== "archived",
                          );
                        } catch (e) {
                          setError(String(e));
                        }
                      }}
                    >
                      {session.state === "archived"
                        ? "Restore from archive"
                        : "Archive in RunHuddle"}
                    </button>
                    <button
                      className="secondary document-action"
                      onClick={() => setLauncher(true)}
                    >
                      <Icon name="plus" size={15} />
                      New session in this folder
                    </button>
                    <div className="notice">
                      {session.terminalId
                        ? "This conversation is open in a preview terminal."
                        : "Resume continues this conversation with its existing context. Archiving organizes history; it does not delete the provider’s conversation."}
                    </div>
                    {snapshot.terminals.some(
                      (t) =>
                        t.legacy &&
                        !t.exited &&
                        t.agent === session.provider.toLowerCase() &&
                        t.cwd === session.cwd,
                    ) && (
                      <div className="notice">
                        <p>
                          Already open in a terminal from the earlier preview?
                          Link it once so this entry focuses that terminal.
                        </p>
                        <select
                          aria-label="Existing preview terminal"
                          value={linkTarget}
                          onChange={(e) => setLinkTarget(e.target.value)}
                        >
                          <option value="">Choose its terminal…</option>
                          {snapshot.terminals
                            .filter(
                              (t) =>
                                t.legacy &&
                                !t.exited &&
                                t.agent === session.provider.toLowerCase() &&
                                t.cwd === session.cwd,
                            )
                            .map((t) => (
                              <option key={t.id} value={t.id}>
                                {terminalTitle(t)}
                              </option>
                            ))}
                        </select>
                        <button
                          disabled={!linkTarget}
                          onClick={async () => {
                            try {
                              await window.runhuddle.link(
                                session.provider,
                                session.sessionID,
                                linkTarget,
                              );
                              setSelection("terminal:" + linkTarget);
                              setHiddenTabs((old) =>
                                old.filter((id) => id !== linkTarget),
                              );
                              setLinkTarget("");
                            } catch (e) {
                              setError(String(e));
                            }
                          }}
                        >
                          Link this terminal
                        </button>
                      </div>
                    )}
                    <h3>Last recorded message</h3>
                    <p className="preserve">
                      {session.preview || "No recorded message"}
                    </p>
                  </article>
                ) : note ? (
                  <article className="document">
                    <small className="eyebrow">
                      SAVED NOTE · {note.sourceProvider}
                    </small>
                    <h1>{note.title}</h1>
                    <p className="muted">{note.project}</p>
                    <div className="preserve">{note.text}</div>
                  </article>
                ) : (
                  <section className="welcome">
                    <img className="hero-mark" src={logo} alt="" />
                    <small className="eyebrow">
                      {workspace ? "WORKSPACE" : "WELCOME BACK"}
                    </small>
                    <h1>
                      {workspace
                        ? name(workspace)
                        : "Pick up where you left off."}
                    </h1>
                    <p>
                      Browse recent sessions, open a workspace,
                      <br />
                      or start a new AI session or terminal.
                    </p>
                    <button
                      className="primary new-button"
                      onClick={() => setLauncher(true)}
                    >
                      <Icon name="plus" size={16} />
                      New session or terminal
                    </button>
                    <div className="welcome-details">
                      <span>⌘T / Ctrl+Shift+T to start something new</span>
                    </div>
                  </section>
                ))}
            </div>
            {changesOpen && (
              <ChangesPanel
                cwd={
                  workspace || shown?.cwd || session?.cwd || note?.project || ""
                }
                onClose={() => setChangesOpen(false)}
              />
            )}
          </div>
          <footer className="statusbar">
            <button onClick={() => setAppearanceOpen(true)}>
              Terminal appearance…
            </button>
            <span>{shown ? shown.cwd : workspace || "All workspaces"}</span>
            <span>
              {shown?.exited
                ? `Exited (${shown.exitCode})`
                : "Terminals stay running when you close the preview"}
            </span>
          </footer>
        </main>
      </div>
    </AppearanceContext.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
