import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
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
  const [agent, setAgent] = useState("shell");
  const [busy, setBusy] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  useEffect(() => {
    window.runhuddle
      .snapshot()
      .then((data) => {
        setSnapshot(data);
        if (data.terminals.length)
          setSelection("terminal:" + data.terminals[0].id);
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
  const terminals = snapshot.terminals.filter(
    (t) => !workspace || t.cwd === workspace,
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
  async function chooseWorkspace() {
    try {
      const folder = await window.runhuddle.chooseFolder();
      if (folder) {
        setFolders((old) => [...new Set([...old, folder])]);
        setWorkspace(folder);
        setSelection("");
      }
    } catch (e) {
      setError(String(e));
    }
  }
  async function create() {
    setBusy(true);
    try {
      const cwd = workspace || (await window.runhuddle.chooseFolder());
      if (!cwd) return;
      const t = await window.runhuddle.create(cwd, agent);
      setSnapshot((old) => ({
        ...old,
        terminals: [...old.terminals.filter((x) => x.id !== t.id), t],
      }));
      setWorkspace(cwd);
      setSelection("terminal:" + t.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function close(t: TerminalInfo) {
    try {
      if (await window.runhuddle.close(t.id)) {
        setSnapshot((old) => ({
          ...old,
          terminals: old.terminals.filter((x) => x.id !== t.id),
        }));
        if (selection === "terminal:" + t.id) setSelection("");
      }
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <div className={"app " + (!sidebar ? "collapsed" : "")}>
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
                    setWorkspace("");
                    setSelection("");
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
                        setWorkspace(p);
                        setSelection("");
                        setMode("recent");
                      }}
                    >
                      <span>▱ {name(p)}</span>
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
                      onClick={() => setSelection("note:" + n.id)}
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
                  RECENT SESSIONS <span>{sessions.length}</span>
                </div>
                {sessions.map((s) => (
                  <button
                    className={
                      "session-row " +
                      (selection === "session:" + key(s) ? "selected" : "")
                    }
                    key={key(s)}
                    onClick={() => setSelection("session:" + key(s))}
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
            Native app snapshot · read only
            <br />
            <span>Live agent status is coming next.</span>
          </footer>
        </aside>
      )}
      <main>
        <header className="workspace-header">
          <button
            title={sidebar ? "Hide sidebar" : "Show sidebar"}
            onClick={() => setSidebar(!sidebar)}
          >
            ☰
          </button>
          <div className="workspace-picker">
            <small>WORKSPACE</small>
            <select
              aria-label="Workspace"
              value={workspace}
              onChange={(e) => {
                setWorkspace(e.target.value);
                setSelection("");
              }}
            >
              <option value="">All workspaces</option>
              {projects.map((p) => (
                <option value={p} key={p}>
                  {name(p)} — {p}
                </option>
              ))}
            </select>
          </div>
          <button className="subtle" onClick={chooseWorkspace}>
            Open folder…
          </button>
          <div className="launch">
            <select
              aria-label="New terminal type"
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
            >
              <option value="shell">Shell</option>
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
              <option value="copilot">Copilot</option>
            </select>
            <button className="primary" disabled={busy} onClick={create}>
              ＋ {busy ? "Opening…" : "New terminal"}
            </button>
          </div>
        </header>
        <div className="tabbar" role="tablist" aria-label="Workspace terminals">
          {terminals.map((t, i) => (
            <div
              key={t.id}
              className={
                "terminal-tab " + (shown?.id === t.id ? "selected" : "")
              }
            >
              <button
                role="tab"
                aria-selected={shown?.id === t.id}
                title={t.cwd}
                onClick={() => setSelection("terminal:" + t.id)}
              >
                <span>⌘</span>
                <span className="tab-title">
                  {t.agent === "shell" ? name(t.cwd) : t.agent} {i + 1}
                  {t.exited ? " · Exited" : ""}
                </span>
              </button>
              <button
                aria-label={`Close terminal ${i + 1}`}
                onClick={() => close(t)}
              >
                ×
              </button>
            </div>
          ))}
          {!terminals.length && (
            <span className="tab-empty">Terminals for this workspace</span>
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
          {shown && (
            <TerminalPane
              key={shown.id}
              id={shown.id}
              visible={true}
              onError={setError}
            />
          )}
          {!shown &&
            (session ? (
              <article className="document">
                <small className="eyebrow">
                  RECORDED SESSION · {session.provider}
                </small>
                <h1>{session.title}</h1>
                <p className="muted">{session.cwd}</p>
                <div className="notice">
                  This is the last saved preview from the native app. Live
                  monitoring and resuming existing sessions are not connected in
                  this preview yet.
                </div>
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
                <small className="eyebrow">YOUR WORK, IN ONE PLACE</small>
                <h1>
                  {workspace ? name(workspace) : "Pick up where you left off."}
                </h1>
                <p>
                  Browse recent sessions, open a workspace,
                  <br />
                  or start a terminal in your project.
                </p>
                <button className="primary" onClick={create} disabled={busy}>
                  ＋ Open a terminal
                </button>
                <div className="welcome-details">
                  <span>Persistent terminals</span>
                  <span>Claude · Codex · Copilot</span>
                  <span>Saved project notes</span>
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
