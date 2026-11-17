import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { LaunchMenu } from "./LaunchMenu";
import { AgentIcon, Icon, launchOptions } from "./Icons";
import { SplitView } from "./SplitView";
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
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"recent" | "workspaces" | "notes">("recent");
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
  const [pair, setPair] = useState<string[]>([]);
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
  const [sidebar, setSidebar] = useState(true);
  useEffect(() => {
    window.runhuddle
      .snapshot()
      .then((data) => {
        setSnapshot(data);
        const candidates = data.terminals.filter(
          (t) =>
            (!workspace || t.cwd === workspace) && !hiddenTabs.includes(t.id),
        );
        const previous = workspaceSelections[workspace];
        setSelection(
          candidates.some((t) => "terminal:" + t.id === previous)
            ? previous
            : candidates[0]
              ? "terminal:" + candidates[0].id
              : "",
        );
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
  function select(value: string, preserveSplit = false) {
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
    if (!preserveSplit) setPair([]);
    setSelection(value);
    setWorkspaceSelections((old) => ({ ...old, [workspace]: value }));
  }
  function switchWorkspace(folder: string) {
    setPair([]);
    const candidates = snapshot.terminals.filter(
      (t) => (!folder || t.cwd === folder) && !hiddenTabs.includes(t.id),
    );
    const previous = workspaceSelections[folder];
    setWorkspace(folder);
    setSelection(
      candidates.some((t) => "terminal:" + t.id === previous)
        ? previous
        : candidates[0]
          ? "terminal:" + candidates[0].id
          : "",
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
    setPair([]);
    setSelection("terminal:" + t.id);
    setWorkspaceSelections((old) => ({ ...old, [cwd]: "terminal:" + t.id }));
    setLastUsed(agent);
    setLastFolder(cwd);
    localStorage.setItem("lastLaunchType", JSON.stringify(agent));
    localStorage.setItem("lastLaunchFolder", JSON.stringify(cwd));
  }
  function openBeside(t: TerminalInfo) {
    setHiddenTabs((old) => old.filter((id) => id !== t.id));
    if (!shown || shown.id === t.id) return;
    setPair([shown.id, t.id]);
    setSelection("terminal:" + t.id);
    setWorkspaceSelections((old) => ({
      ...old,
      [workspace]: "terminal:" + t.id,
    }));
  }
  function hideTab(t: TerminalInfo) {
    const remaining = terminals.filter((x) => x.id !== t.id);
    const other = pair.find((id) => id !== t.id);
    setHiddenTabs((old) => [...old, t.id]);
    setPair([]);
    if (shown?.id === t.id)
      select(
        other
          ? "terminal:" + other
          : remaining[0]
            ? "terminal:" + remaining[0].id
            : "",
      );
  }
  async function close(t: TerminalInfo) {
    try {
      if (await window.runhuddle.close(t.id)) {
        setPair([]);
        const index = terminals.findIndex((x) => x.id === t.id);
        const next = terminals[index + 1] || terminals[index - 1];
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
  function renderTerminal(t: TerminalInfo) {
    return (
      <section
        key={t.id}
        className={
          "terminal-pane " + (shown?.id === t.id ? "focused-pane" : "")
        }
        aria-label={`${terminalTitle(t)} pane`}
        onPointerDown={() => {
          if (shown?.id !== t.id) select("terminal:" + t.id, true);
        }}
        onFocusCapture={() => {
          if (shown?.id !== t.id) select("terminal:" + t.id, true);
        }}
      >
        <div className="pane-heading">
          <AgentIcon agent={t.agent} />
          <span>
            {pair.length === 2
              ? pair[0] === t.id
                ? "Left · "
                : "Right · "
              : ""}
            {terminalTitle(t)}
          </span>
          {pair.length === 2 && (
            <button
              onClick={() => {
                select("terminal:" + t.id);
                setPair([]);
              }}
            >
              Show only this
            </button>
          )}
          {t.agent !== "shell" && (
            <button onClick={() => close(t)}>
              {t.exited ? "Remove session" : "End session"}
            </button>
          )}
        </div>
        <div className="pane-body">
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
        </div>
      </section>
    );
  }
  return (
    <div className={"app " + (!sidebar ? "collapsed" : "")}>
      {launcher && (
        <LaunchMenu
          cwd={launchFolder}
          projects={projects}
          lastUsed={lastUsed}
          onLaunch={create}
          onDismiss={() => setLauncher(false)}
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
                  className={"workspace-row " + (!workspace ? "selected" : "")}
                  onClick={() => {
                    switchWorkspace("");
                  }}
                >
                  All workspaces <small>{projects.length} folders</small>
                </button>
                {projects
                  .filter((p) => p.toLowerCase().includes(query.toLowerCase()))
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
                {scope === "all" && (
                  <>
                    <div className="section-label">OPEN IN PREVIEW</div>
                    {workspaceTerminals
                      .filter(
                        (t) =>
                          !t.sessionID ||
                          !snapshot.sessions.some(
                            (s) =>
                              s.sessionID === t.sessionID &&
                              s.provider.toLowerCase() === t.agent,
                          ),
                      )
                      .filter((t) =>
                        [terminalTitle(t), t.cwd, t.agent]
                          .join(" ")
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                      )
                      .map((t) => (
                        <div key={t.id} className="live-row">
                          <button
                            className={
                              "session-row " +
                              (shown?.id === t.id ? "selected" : "")
                            }
                            onClick={() => select("terminal:" + t.id)}
                          >
                            <div className="row-top">
                              <span>{name(t.cwd)}</span>
                              <span className="provider">
                                {t.agent === "shell"
                                  ? "Terminal"
                                  : launchOptions.find((o) => o.id === t.agent)
                                      ?.name}
                              </span>
                            </div>
                            <strong>{terminalTitle(t)}</strong>
                            <small>
                              {t.exited
                                ? "Exited"
                                : t.agent === "shell"
                                  ? "Shell open"
                                  : "Session open"}
                              {hiddenTabs.includes(t.id) ? " · Tab closed" : ""}
                            </small>
                          </button>
                        </div>
                      ))}
                  </>
                )}
                <div className="section-label">
                  SESSIONS <span>{sessions.length}</span>
                </div>
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
                      <span className={"dot " + s.state} />
                      {labels[s.state] || s.state}
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
        {shown && (
          <div className="layout-controls">
            <span>
              {pair.length === 2 ? "Side by side · 2 panes" : "Single view"}
            </span>
            {pair.length === 2 && (
              <button onClick={() => setPair([])}>Single view</button>
            )}
            <select
              aria-label="Split view with"
              value=""
              disabled={workspaceTerminals.filter((t) => !t.exited).length < 2}
              onChange={(e) => {
                const target = workspaceTerminals.find(
                  (t) => t.id === e.target.value,
                );
                if (target) openBeside(target);
              }}
            >
              <option value="">
                {pair.length === 2 ? "Compare with…" : "Split view…"}
              </option>
              {workspaceTerminals
                .filter((t) => t.id !== shown.id && !t.exited)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.agent === "shell" ? "Terminal" : t.agent} ·{" "}
                    {terminalTitle(t)}
                  </option>
                ))}
            </select>
          </div>
        )}
        <div className="tabbar" role="tablist" aria-label="Open tabs">
          {terminals.map((t) => (
            <div
              key={t.id}
              className={
                "terminal-tab " + (shown?.id === t.id ? "selected" : "")
              }
            >
              <button
                role="tab"
                aria-selected={shown?.id === t.id}
                title={`${t.agent === "shell" ? "Terminal" : t.agent} · ${t.cwd}`}
                onClick={() => select("terminal:" + t.id)}
              >
                <AgentIcon agent={t.agent} />
                <span className="tab-title">
                  {pair.includes(t.id) && (
                    <span className="pane-badge">
                      {pair[0] === t.id ? "Left" : "Right"}
                    </span>
                  )}
                  {terminalTitle(t)}
                  {t.exited ? " · Exited" : ""}
                </span>
              </button>
              <button
                aria-label={`Close ${terminalTitle(t)}`}
                onClick={() => (t.agent === "shell" ? close(t) : hideTab(t))}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
          {!terminals.length && (
            <span className="tab-empty">
              Your open sessions and terminals appear here
            </span>
          )}
        </div>
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
        <div className="stage">
          {shown &&
            (pair.length === 2 &&
            pair.every((id) => terminals.some((t) => t.id === id)) ? (
              <SplitView>
                {pair.map((id) =>
                  renderTerminal(terminals.find((t) => t.id === id)!),
                )}
              </SplitView>
            ) : (
              renderTerminal(shown)
            ))}
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
                  onClick={async () => {
                    setResuming(true);
                    try {
                      const t = await window.runhuddle.resume(
                        session.provider,
                        session.sessionID,
                      );
                      if (t) {
                        setSnapshot((old) => ({
                          ...old,
                          terminals: [
                            ...old.terminals.filter((x) => x.id !== t.id),
                            t,
                          ],
                        }));
                        setWorkspace(t.cwd);
                        setHiddenTabs((old) => old.filter((id) => id !== t.id));
                        setSelection("terminal:" + t.id);
                        setPair([]);
                      }
                    } catch (e) {
                      setError(String(e));
                    } finally {
                      setResuming(false);
                    }
                  }}
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
                      Already open in a terminal from the earlier preview? Link
                      it once so this entry focuses that terminal.
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
                  {workspace ? name(workspace) : "Pick up where you left off."}
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
        <footer className="statusbar">
          <span>{shown ? shown.cwd : workspace || "All workspaces"}</span>
          <span>
            {shown?.exited
              ? `Exited (${shown.exitCode})`
              : "Terminals stay running when you close the preview"}
          </span>
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
