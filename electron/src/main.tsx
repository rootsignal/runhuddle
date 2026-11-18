import { useDismissMenus } from "./useDismissMenus";
import { UsageControls } from "./UsageControls";
import { ScreenshotPopup } from "./ScreenshotPopup";
import { EditorButton } from "./EditorButton";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AppearanceContext,
  loadAppearance,
  TerminalAppearance,
} from "./TerminalAppearance";
import { matchesNote, WorkspaceTools } from "./WorkspaceTools";
import { NoteEditor } from "./NoteEditor";
import { LaunchMenu } from "./LaunchMenu";
import { AgentIcon, Icon, launchOptions } from "./Icons";
import { SessionHistory } from "./SessionHistory";
import { CompanionShell } from "./CompanionShell";
import { TerminalContext } from "./TerminalContext";
import { TerminalWorkspace } from "./TerminalWorkspace";
import { TerminalPane } from "./Terminal";
import type { NoteDraft, Snapshot, Session, TerminalInfo } from "./types";
import "./style.css";
import logo from "../assets/icon.png";
const key = (s: Session) => s.provider + ":" + s.sessionID;
const name = (p: string) => p.split(/[\\/]/).filter(Boolean).at(-1) || p;
const labels: Record<string, string> = {
  working: "Working",
  idle: "Idle",
  needsInput: "Needs input",
  saved: "Previous session",
  disconnected: "Activity unavailable",
  archived: "Archived",
};
function sessionRows(data: Snapshot, connected: boolean) {
  const liveIDs = new Set(data.terminals.filter((t) => !t.exited).map((t) => t.id));
  const liveSessions = new Map(data.terminals.flatMap((t) => {
    const provider = launchOptions.find((option) => option.id === t.agent)?.name;
    return provider && t.sessionID && !t.exited
      ? [[provider + ":" + t.sessionID, { provider, terminal: t }] as const]
      : [];
  }));
  const rows = new Map(data.sessions.map((row) => {
    const terminalId = row.terminalId && liveIDs.has(row.terminalId)
      ? row.terminalId
      : liveSessions.get(key(row))?.terminal.id;
    return [key(row), {
      ...row,
      terminalId,
      state: terminalId && (!connected || terminalId !== row.terminalId) ? "disconnected" : row.state,
    }] as const;
  }));
  for (const [id, { provider, terminal: t }] of liveSessions) {
    if (rows.has(id)) continue;
    rows.set(id, {
      provider, sessionID: t.sessionID!, terminalId: t.id,
      cwd: t.cwd, project: name(t.cwd), title: provider + " session",
      preview: "", state: "disconnected", updated: 0,
    });
  }
  return [...rows.values()];
}
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
    data.sessions.some((s) => "session:" + key(s) === previous) ||
    data.notes.some(
      (n) => "note:" + n.id === previous,
    )
  )
    return previous;
  const candidates = data.terminals.filter((t) => !hidden.includes(t.id));
  if (candidates.some((t) => "terminal:" + t.id === previous)) return previous;
  const fallback =
    candidates.find((t) => !t.exited && t.cwd === folder) ||
    candidates.find((t) => !t.exited) ||
    candidates.find((t) => t.cwd === folder) ||
    candidates[0];
  return fallback ? "terminal:" + fallback.id : "";
}
function recency(updated: number) {
  const date = new Date(updated * 1000),
    today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const week = new Date(today);
  week.setDate(week.getDate() - 7);
  return date >= today
    ? "Today"
    : date >= yesterday
      ? "Yesterday"
      : date >= week
        ? "Past week"
        : "Earlier";
}
function App() {
  useDismissMenus();
  const [noteDraft, setNoteDraft] = useState<NoteDraft>();
  const [showNotes, setShowNotes] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot>({
    sessions: [],
    notes: [],
    pinned: [],
    readAt: null,
    storeError: null,
    terminals: [],
    home: "",
  });
  const [companions, setCompanions] = useState<Record<string, string>>(() =>
    readSetting("companionShells", {}),
  );
  const [visibleShells, setVisibleShells] = useState<string[]>(() =>
    readSetting("visibleShells", []),
  );
  const openingShells = useRef(new Set<string>());
  useEffect(() => {
    localStorage.setItem("companionShells", JSON.stringify(companions));
  }, [companions]);
  useEffect(() => {
    localStorage.setItem("visibleShells", JSON.stringify(visibleShells));
  }, [visibleShells]);
  const [tabHost, setTabHost] = useState<HTMLDivElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [connection, setConnection] = useState("connected");
  const [error, setError] = useState("");
  const [appearance, setAppearance] = useState(loadAppearance);
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
    readSetting<string>("sidebarMode", "recent") === "workspaces"
      ? "workspaces"
      : "recent",
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
  const [tabReplacement, setTabReplacement] = useState<{ from: string; to: string }>();

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
          restoredSelection(data, workspace, workspaceSelections[workspace], [
            ...hiddenTabs,
            ...Object.entries(companions)
              .filter(([owner]) => data.terminals.some((t) => t.id === owner))
              .map(([, id]) => id),
          ]),
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
          ...snapshot.notes.map((n) => n.project),
        ]),
      ]
        .filter(Boolean)
        .sort((a, b) => name(a).localeCompare(name(b))),
    [folders, snapshot.sessions, snapshot.terminals, snapshot.notes],
  );
  const allSessions = useMemo(
    () => sessionRows(snapshot, connection === "connected"),
    [snapshot.sessions, snapshot.terminals, connection],
  );
  const sessions = useMemo(
    () =>
      allSessions
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
        .sort((a, b) => Number(!!b.terminalId) - Number(!!a.terminalId) || b.updated - a.updated),
    [allSessions, snapshot.pinned, workspace, scope, query],
  );
  const workspaceTerminals = snapshot.terminals.filter(
    (t) => !workspace || t.cwd === workspace,
  );
  const companionIDs = new Set(
    Object.entries(companions)
      .filter(([owner]) => snapshot.terminals.some((t) => t.id === owner))
      .map(([, id]) => id),
  );
  const terminals = snapshot.terminals.filter(
    (t) => !hiddenTabs.includes(t.id) && !companionIDs.has(t.id),
  );
  const session = allSessions.find(
    (s) => "session:" + key(s) === selection,
  );
  const note = snapshot.notes.find((n) => "note:" + n.id === selection);
  const noteSource = note?.sourceSessionID ? allSessions.find(
    (row) => row.sessionID === note.sourceSessionID && row.provider === note.sourceProvider,
  ) : undefined;
  const foundNotes = useMemo(() => query.trim() ? snapshot.notes.filter(
    (item) => (!workspace || item.project === workspace) && matchesNote(item, query),
  ) : [], [query, snapshot.notes, workspace]);
  const terminal = snapshot.terminals.find(
    (t) => "terminal:" + t.id === selection,
  );
  const shown = terminal;
  const shownSession = allSessions.find((row) => row.terminalId === shown?.id);
  function select(value: string) {
    if (value.startsWith("session:")) {
      const row = allSessions.find((s) => "session:" + key(s) === value);
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
    setMode("recent");
    setScope("all");
    setQuery("");
    if (workspace && workspace !== cwd) setWorkspace(cwd);

    setSelection("terminal:" + t.id);
    setWorkspaceSelections((old) => ({ ...old, [cwd]: "terminal:" + t.id }));
    setLastUsed(agent);
    setLastFolder(cwd);
    localStorage.setItem("lastLaunchType", JSON.stringify(agent));
    localStorage.setItem("lastLaunchFolder", JSON.stringify(cwd));
    return t;
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
    shown?.cwd || session?.cwd || note?.project || workspace || lastFolder;
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
          <AgentIcon agent={t.agent} />
          <strong title={`${terminalTitle(t)}\n${t.cwd}\n${location(t.id)}`}>
            {terminalTitle(t)}
          </strong>
          <span
            className={
              "dot " + (t.exited || t.agent !== "shell" ? "saved" : "idle")
            }
            title={
              t.exited
                ? "Ended"
                : t.agent === "shell"
                  ? "Terminal open"
                  : "Terminal open · agent activity not linked"
            }
          />
        </button>
        <details className="row-menu">
          <summary aria-label={`Actions for ${terminalTitle(t)}`}>•••</summary>
          <div>
            <button onClick={() => close(t)}>
              {t.agent === "shell" ? "Close terminal" : "End session"}
            </button>
          </div>
        </details>
      </div>
    );
  }
  const unlinkedAgents = workspaceTerminals.filter(
    (t) =>
      t.agent !== "shell" &&
      !allSessions.some(
        (s) =>
          s.sessionID === t.sessionID && s.provider.toLowerCase() === t.agent,
      ),
  );
  const matchesTerminal = (t: TerminalInfo) =>
    [terminalTitle(t), t.cwd, t.agent]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase());
  const openUnlinked = scope === "all"
    ? unlinkedAgents.filter((t) => !t.exited && matchesTerminal(t))
    : [];
  async function resumeSession(
    provider: string,
    sessionID: string,
    previous?: string,
  ) {
    setResuming(true);
    try {
      const t = await window.runhuddle.resume(provider, sessionID);
      if (t) {
        if (previous && previous !== t.id) {
          setTabReplacement({ from: previous, to: t.id });
          setHiddenTabs((old) => [...old, previous]);
        }
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
  async function openCompanion(t: TerminalInfo) {
    setVisibleShells((old) => [...new Set([...old, t.id])]);
    const existing = snapshot.terminals.find((x) => x.id === companions[t.id]);
    if (existing && !existing.exited && !existing.unavailable) return;
    if (openingShells.current.has(t.id)) return;
    openingShells.current.add(t.id);
    try {
      const shell = await window.runhuddle.create(t.cwd, "shell");
      setCompanions((old) => ({ ...old, [t.id]: shell.id }));
      setSnapshot((old) => ({
        ...old,
        terminals: [...old.terminals.filter((x) => x.id !== shell.id), shell],
      }));
      if (existing) await window.runhuddle.close(existing.id);
    } catch (e) {
      setError(String(e));
      setVisibleShells((old) => old.filter((id) => id !== t.id));
    } finally {
      openingShells.current.delete(t.id);
    }
  }
  function renderSessionToolbar(t: TerminalInfo) {
    return (
      <div
        className="pane-heading session-toolbar"
        aria-label="Active session toolbar"
      >
        <TerminalContext cwd={t.cwd} />
        <button
          aria-pressed={visibleShells.includes(t.id)}
          onClick={() =>
            visibleShells.includes(t.id)
              ? setVisibleShells((old) => old.filter((id) => id !== t.id))
              : openCompanion(t)
          }
        >
          Shell
        </button>
        <EditorButton target={t.cwd} />
        {t.agent !== "shell" && <UsageControls
          source={snapshot.sessions.find(s => s.sessionID === t.sessionID && s.provider.toLowerCase() === t.agent) ||
            { provider: t.agent === "codex" ? "Codex" : t.agent === "claude" ? "Claude" : "Copilot", sessionID: t.sessionID || "", title: t.title, cwd: t.cwd, project: t.cwd, preview: "", state: "disconnected", updated: 0 }}
          onCreate={create} />}
        <details className="folder-actions">
          <summary aria-label="Session actions">•••</summary>
          <div>
            {shownSession && (
              <button onClick={() => setSelection("session:" + key(shownSession))}>
                View conversation
              </button>
            )}
            <button
              onClick={() =>
                window.runhuddle
                  .openFolder(t.cwd, "folder")
                  .catch((e) => setError(String(e)))
              }
            >
              Show folder
            </button>
            <button
              onClick={() => {
                setLaunchKind("all");
                setLauncher(true);
              }}
            >
              New session in this folder
            </button>
          </div>
        </details>
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
                  launchOptions.find((o) => o.id === t.agent)?.name || t.agent,
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
    );
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
        <CompanionShell
          owner={t}
          terminal={snapshot.terminals.find((x) => x.id === companions[t.id])}
          visible={visibleShells.includes(t.id)}
          connected={connection === "connected"}
          onHide={() =>
            setVisibleShells((old) => old.filter((id) => id !== t.id))
          }
          onCreate={() => openCompanion(t)}
          onError={setError}
          onEnd={async () => {
            try {
              const id = companions[t.id];
              if (id && (await window.runhuddle.close(id))) {
                setVisibleShells((old) => old.filter((x) => x !== t.id));
                setCompanions((old) => {
                  const next = { ...old };
                  delete next[t.id];
                  return next;
                });
              }
            } catch (e) {
              setError(String(e));
            }
          }}
        >
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
                        setTabReplacement({ from: t.id, to: replacement.id });
                        setHiddenTabs((old) => [...old, t.id]);
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
                    Use Resume session above to reopen the recorded
                    conversation.
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
        </CompanionShell>
      </section>
    );
  }
  const tabControls = (
    <>
      <button
        title={sidebar ? "Hide sidebar" : "Show sidebar"}
        onClick={() => setSidebar(!sidebar)}
      >
        <Icon name="sidebar" />
      </button>
      <button
        aria-label="New session or terminal"
        title="New session or terminal (⌘T)"
        onClick={() => setLauncher(true)}
      >
        <Icon name="plus" size={16} />
      </button>
    </>
  );
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
        {noteDraft && (
          <NoteEditor initial={noteDraft} projects={projects}
            onCancel={() => setNoteDraft(undefined)}
            onSaved={(saved) => {
              setSnapshot((old) => ({
                ...old,
                notes: [saved, ...old.notes.filter((item) => item.id !== saved.id)],
              }));
              setShowNotes((old) => old + 1);
              if (!noteDraft.source) select("note:" + saved.id);
              setNoteDraft(undefined);
            }} />
        )}
        {sidebar && (
          <aside className="session-sidebar">
            <header className="brand">
              <img className="brand-mark" src={logo} alt="" />
              <strong>RunHuddle</strong>
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
                Projects
              </button>
            </nav>
            {mode === "recent" && (
              <div className="sidebar-filter-line">
                <select
                  aria-label="Session filter"
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                >
                  <option value="all">All sessions</option>
                  <option value="pinned">Pinned</option>
                  <option value="archived">Archived</option>
                </select>
                {workspace && (
                  <button
                    className="project-chip"
                    title={workspace + " · clear project filter"}
                    onClick={() => switchWorkspace("")}
                    aria-label="All projects"
                  >
                    {name(workspace)} ×
                  </button>
                )}
              </div>
            )}
            <div className="sidebar-list">
              {mode === "workspaces" ? (
                <>
                  <div className="section-label">
                    PROJECT FOLDERS{" "}
                    <button
                      title="Add project folder"
                      onClick={chooseWorkspace}
                    >
                      +
                    </button>
                  </div>
                  {projects
                    .filter((p) =>
                      [
                        p,
                        ...allSessions
                          .filter((s) => s.cwd === p)
                          .map((s) => s.title),
                      ]
                        .join(" ")
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                    )
                    .map((p) => {
                      const rows = allSessions.filter(
                        (s) =>
                          s.cwd === p &&
                          s.state !== "archived" &&
                          (!query ||
                            p.toLowerCase().includes(query.toLowerCase()) ||
                            s.title
                              .toLowerCase()
                              .includes(query.toLowerCase())),
                      );
                      return (
                        <details
                          className="project-group"
                          key={p}
                          open={workspace === p || !!query || undefined}
                        >
                          <summary title={p}>
                            <Icon name="folder" />
                            <strong>{name(p)}</strong>
                            <small>{rows.length}</small>
                          </summary>
                          <div className="project-actions">
                            <button
                              onClick={() => {
                                switchWorkspace(p);
                                setLaunchKind("ai");
                                setLauncher(true);
                              }}
                            >
                              New session
                            </button>
                            <button
                              onClick={() => {
                                switchWorkspace(p);
                                setMode("recent");
                              }}
                            >
                              View all
                            </button>
                          </div>
                          {rows.map((s) => (
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
                              <AgentIcon agent={s.provider.toLowerCase()} />
                              <strong title={s.preview}>{s.title}</strong>
                              <span
                                className={
                                  "dot " + (s.terminalId ? s.state : "saved")
                                }
                                title={s.terminalId ? labels[s.state] : "Recorded session"}
                              />
                            </button>
                          ))}
                          {!rows.length && (
                            <p className="empty-small">
                              No recorded sessions in this folder.
                            </p>
                          )}
                        </details>
                      );
                    })}
                </>
              ) : (
                <>
                  {openUnlinked.length > 0 && (
                    <section aria-label="Open now" className="unlinked-sessions">
                      <div className="recency-label">Open now</div>
                      {openUnlinked.map(liveRow)}
                    </section>
                  )}
                  {sessions.map((s, index) => {
                    const group = (row: Session) => row.terminalId ? "Open now" : recency(row.updated);
                    return (
                    <React.Fragment key={key(s)}>
                      {(index === 0
                        ? !s.terminalId || !openUnlinked.length
                        : group(s) !== group(sessions[index - 1])) && (
                        <div className="recency-label">
                          {group(s)}
                        </div>
                      )}
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
                        <AgentIcon agent={s.provider.toLowerCase()} />
                        <strong title={[s.title, s.cwd, location(s.terminalId), s.preview].filter(Boolean).join("\n")}>
                          {s.title}
                        </strong>
                        <span
                          className={
                            "dot " + (s.terminalId ? s.state : "saved")
                          }
                          title={
                            s.terminalId
                              ? labels[s.state] || s.state
                              : "Recorded session"
                          }
                        />
                        {s.terminalId && s.state === "needsInput" && (
                          <span className="row-age">Needs input</span>
                        )}
                        {!s.terminalId && <span
                          className="row-age"
                          title={new Date(s.updated * 1000).toLocaleString()}
                        >
                          {new Date(s.updated * 1000).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric" },
                          )}
                        </span>}
                      </button>
                    </React.Fragment>
                    );
                  })}
                  {scope === "all" && unlinkedAgents.some((t) => t.exited && matchesTerminal(t)) && (
                    <section aria-label="Ended terminals" className="unlinked-sessions">
                      <div className="recency-label">Ended terminals</div>
                      {unlinkedAgents.filter((t) => t.exited && matchesTerminal(t)).map(liveRow)}
                    </section>
                  )}
                  {!sessions.length && (
                    <p className="empty-small">
                      No sessions match these filters.
                    </p>
                  )}
                  {scope === "all" &&
                    workspaceTerminals.some(
                      (t) =>
                        t.agent === "shell" &&
                        !companionIDs.has(t.id) &&
                        matchesTerminal(t),
                    ) && (
                      <>
                        <div className="section-label">TERMINALS</div>
                        {workspaceTerminals
                          .filter(
                            (t) =>
                              t.agent === "shell" &&
                              !companionIDs.has(t.id) &&
                              matchesTerminal(t),
                          )
                          .map(liveRow)}
                      </>
                    )}
                </>
              )}
              {foundNotes.length > 0 && (
                <section aria-label="Matching notes">
                  <div className="recency-label">Notes</div>
                  {foundNotes.map((item) => (
                    <button key={item.id} className={"session-row " + (note?.id === item.id ? "selected" : "")}
                      onClick={() => select("note:" + item.id)}>
                      <Icon name="notes" size={15} />
                      <strong>{item.title}</strong>
                    </button>
                  ))}
                </section>
              )}
            </div>
            <footer className="sidebar-foot">
              <button
                className="new-shell"
                onClick={() => {
                  setLaunchKind("shell");
                  setLauncher(true);
                }}
              >
                <Icon name="terminal" size={15} /> New terminal
              </button>
              <small>
                {allSessions.length} sessions · {projects.length} projects
              </small>
            </footer>
          </aside>
        )}
        <main>
          {!shown && <div className="empty-tabbar">{tabControls}</div>}
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
          <div
            className="main-tabs"
            ref={setTabHost}
            style={{ display: shown ? "flex" : "none" }}
            aria-label="Open sessions"
          />
          {shown && renderSessionToolbar(shown)}
          <div className="review-layout">
            <div className="stage" id="review-stage">
              {loaded && terminals.length > 0 && (
                <div
                  className="workspace-surface"
                  style={{ display: shown ? "flex" : "none" }}
                >
                  <TerminalWorkspace
                    workspace=""
                    controls={tabControls}
                    tabHost={tabHost}
                    terminals={terminals}
                    replacement={tabReplacement}
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
                  <article className="document session-document">
                    <small className="eyebrow">
                      CONVERSATION · {session.provider}
                    </small>
                    <h1>{session.title}</h1>
                    <p className="muted">{session.cwd}</p>
                    <button
                      className="primary document-action"
                      disabled={resuming}
                      onClick={() => session.terminalId
                        ? select("terminal:" + session.terminalId)
                        : resumeSession(session.provider, session.sessionID)}
                    >
                      {session.terminalId ? "Back to terminal" : resuming ? "Resuming…" : "Resume session"}
                    </button>
                    <details className="document-more">
                      <summary>More actions</summary>
                      <div>
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
                      </div>
                    </details>
                    {snapshot.terminals.some(
                      (t) =>
                        t.legacy &&
                        !t.exited &&
                        t.agent === session.provider.toLowerCase() &&
                        t.cwd === session.cwd,
                    ) && (
                      <details className="legacy-link">
                        <summary>Link an older preview terminal…</summary>
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
                      </details>
                    )}
                    <SessionHistory key={key(session)} session={session}
                      onSaveExcerpt={(text) => setNoteDraft({
                        title: session.title.slice(0, 120),
                        text,
                        project: session.cwd,
                        source: { provider: session.provider, sessionID: session.sessionID },
                      })} />
                  </article>
                ) : note ? (
                  <article className="document note-document">
                    <small className="eyebrow">
                      {note.sourceProvider ? "NOTE · " + note.sourceProvider : "NOTE"}
                    </small>
                    <h1>{note.title}</h1>
                    {note.project && <p className="muted">{note.project}</p>}
                    <div className="note-actions">
                      <button className="primary" onClick={() => setNoteDraft({
                        id: note.id, title: note.title, text: note.text, project: note.project,
                      })}>
                        Edit note
                      </button>
                      <button
                        onClick={() =>
                          window.runhuddle
                            .noteAction(note.id, "copy")
                            .catch((e) => setError(String(e)))
                        }
                      >
                        Copy note
                      </button>
                      <button
                        onClick={() =>
                          window.runhuddle
                            .noteAction(note.id, "export")
                            .catch((e) => setError(String(e)))
                        }
                      >
                        Export Markdown…
                      </button>
                      {noteSource && (
                        <button onClick={() => setSelection("session:" + key(noteSource))}>
                          View source conversation
                        </button>
                      )}
                    </div>
                    <div className="note-content preserve">{note.text}</div>
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
                      Browse recent sessions or projects,
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
                    <div className="welcome-recents">
                      {snapshot.sessions
                        .filter(
                          (s) =>
                            s.state !== "archived" &&
                            (!workspace || s.cwd === workspace),
                        )
                        .slice(0, 4)
                        .map((s) => (
                          <button
                            key={key(s)}
                            onClick={() => select("session:" + key(s))}
                          >
                            <AgentIcon agent={s.provider.toLowerCase()} />
                            <span>
                              <strong>{s.title}</strong>
                              <small>
                                {s.project || name(s.cwd)} · {s.provider}
                              </small>
                            </span>
                            <Icon name="arrow" size={16} />
                          </button>
                        ))}
                    </div>
                    <div className="welcome-details">
                      <span>⌘T / Ctrl+Shift+T to start something new</span>
                    </div>
                  </section>
                ))}
            </div>
            <WorkspaceTools
              notes={snapshot.notes}
              selection={selection}
              onSelectNote={(id) => select("note:" + id)}
              onNewNote={() => setNoteDraft({
                title: "", text: "", project: shown?.cwd || session?.cwd || note?.project || workspace,
              })}
              showNotes={showNotes}
              cwd={
                shown?.cwd || session?.cwd || note?.project || workspace || ""
              }
            />
          </div>
          <ScreenshotPopup target={
            shown && shown.agent !== "shell" && !shown.exited && connection === "connected"
              ? {
                  id: shown.id,
                  title: terminalTitle(shown),
                  busy: ["working", "needsInput"].includes(shownSession?.state || ""),
                }
              : undefined
          } />
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
