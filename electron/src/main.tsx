import { useDismissMenus } from "./useDismissMenus";
import { UsageControls } from "./UsageControls";
import { HiddenHistoryDialog } from "./HiddenHistoryDialog";
import { ProjectOverview } from "./ProjectOverview";
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
import { AppAccentDialog } from "./AppAccentDialog";
import { GettingStarted } from "./GettingStarted";
import { AgentIcon, Icon, launchOptions } from "./Icons";
import { SessionHistory } from "./SessionHistory";
import { ConversationSearch } from "./ConversationSearch";
import { CompanionShell } from "./CompanionShell";
import { TerminalContext } from "./TerminalContext";
import { TerminalWorkspace } from "./TerminalWorkspace";
import { TerminalPane } from "./Terminal";
import type { HistorySearchResult, NoteDraft, SessionAlert, SessionAlertTarget, Snapshot, Session, TerminalInfo } from "./types";
import "./app-theme.css";
import "./style.css";
import logo from "../assets/icon.png";
const key = (s: Pick<Session, "provider" | "sessionID">) => s.provider + ":" + s.sessionID;
const name = (p: string) => p.split(/[\\/]/).filter(Boolean).at(-1) || p;
const emptyHiddenHistory = { projects: [], sessions: [] };
const terminalSessionKey = (t: TerminalInfo) =>
  `${launchOptions.find((option) => option.id === t.agent)?.name}:${t.sessionID}`;
function openRowMenu(row: Element | null) {
  const menu = row?.querySelector<HTMLDetailsElement>("details.row-menu");
  if (!menu) return;
  row?.closest(".session-sidebar")?.querySelectorAll<HTMLDetailsElement>("details.row-menu[open]").forEach((open) => {
    if (open !== menu) open.open = false;
  });
  menu.open = true;
  menu.querySelector("summary")?.focus();
}
const labels: Record<string, string> = {
  working: "Working",
  idle: "Idle",
  needsInput: "Needs input",
  saved: "Previous session",
  disconnected: "Activity unavailable",
  locked: "In use elsewhere",
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
  hiddenTabs: string[],
) {
  const hidden = data.hidden ?? emptyHiddenHistory;
  if (
    data.sessions.some((s) => (!folder || s.cwd === folder) && !hidden.projects.includes(s.cwd) &&
      !hidden.sessions.includes(key(s)) && "session:" + key(s) === previous) ||
    data.notes.some(
      (n) => (!folder || n.project === folder) && !hidden.projects.includes(n.project) && "note:" + n.id === previous,
    )
  )
    return previous;
  const candidates = data.terminals.filter((t) => (!folder || t.cwd === folder) && !hiddenTabs.includes(t.id) &&
    !hidden.projects.includes(t.cwd) && !hidden.sessions.includes(terminalSessionKey(t)));
  if (candidates.some((t) => "terminal:" + t.id === previous)) return previous;
  const fallback = candidates.find((t) => !t.exited) || candidates[0];
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
  const [customAccentOpen, setCustomAccentOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState<NoteDraft>();
  const [openAlert, setOpenAlert] = useState<SessionAlertTarget>();
  const [sessionAlert, setSessionAlert] = useState<{ key: string; alert: SessionAlert }>();
  const [showNotes, setShowNotes] = useState(0);
  const [showHiddenHistory, setShowHiddenHistory] = useState(false);
  const [overviewFolder, setOverviewFolder] = useState("");
  const [lockedTerminals, setLockedTerminals] = useState<ReadonlySet<string>>(() => new Set());
  function updateConversationLock(id: string, locked: boolean) {
    setLockedTerminals((old) => {
      if (old.has(id) === locked) return old;
      const next = new Set(old);
      if (locked) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  const [showGuide, setShowGuide] = useState(() => {
    const status = localStorage.getItem("gettingStarted");
    return status === "pending" || (!status && localStorage.getItem("sidebarMode") === null);
  });
  useEffect(() => {
    if (showGuide && !localStorage.getItem("gettingStarted"))
      localStorage.setItem("gettingStarted", "pending");
  }, [showGuide]);
  function dismissGuide() {
    localStorage.setItem("gettingStarted", "done");
    setShowGuide(false);
  }
  const [snapshot, setSnapshot] = useState<Snapshot>({
    sessions: [],
    notes: [],
    pinned: [],
    terminals: [],
    home: "",
  });
  const accent = snapshot.accent || "#8fcbd0";
  useEffect(() => {
    document.documentElement.style.setProperty("--app-accent-base", accent);
    document.documentElement.dataset.appTheme = snapshot.appTheme || "system";
  }, [accent, snapshot.appTheme]);
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
  const [launchKind, setLaunchKind] = useState<"all" | "ai">("all");
  const [mode, setMode] = useState<"recent" | "workspaces" | "notes">(() =>
    readSetting<string>("sidebarMode", "recent") === "workspaces"
      ? "workspaces"
      : "recent",
  );
  const [query, setQuery] = useState("");
  const [historyResult, setHistoryResult] = useState<HistorySearchResult>();
  const [scope, setScope] = useState("all");
  const [workspace, setWorkspace] = useState(() =>
    readSetting("workspace", ""),
  );
  const [folders, setFolders] = useState<string[]>(() =>
    readSetting("folders", []),
  );
  const [selection, setSelection] = useState("");
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
        const folder = data.hidden?.projects.includes(workspace) ? "" : workspace;
        if (folder !== workspace) setWorkspace(folder);
        setSnapshot(data);
        if (data.openAlert) setOpenAlert(data.openAlert);
        setConnection(data.connection || "connected");
        setSelection(
          restoredSelection(data, folder, workspaceSelections[folder], [
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
      if (event.event === "terminals") {
        setSnapshot((previous) => ({
          ...previous,
          terminals: event.terminals,
        }));
        setLockedTerminals((previous) => {
          if (!previous.size) return previous;
          const next = new Set(event.terminals.filter((t) => !t.exited && previous.has(t.id)).map((t) => t.id));
          return next.size === previous.size ? previous : next;
        });
      }
      if (event.event === "store")
        setSnapshot((previous) => ({ ...previous, ...event }));
      if (event.event === "recap")
        setSnapshot((previous) => ({
          ...previous,
          recaps: { ...previous.recaps, [event.key]: event.recap },
        }));
      if (event.event === "inbox")
        setSnapshot((previous) => ({ ...previous, inbox: event.entries }));
      if (event.event === "connection") setConnection(event.state);
      if (event.event === "app-theme") setSnapshot((old) => ({ ...old, appTheme: event.theme }));
      if (event.event === "update-download") setSnapshot((old) => ({ ...old, updateDownload: event.download }));
      if (event.event === "app-accent") setSnapshot((old) => ({ ...old, accent: event.accent }));
      if (event.event === "custom-app-accent") setCustomAccentOpen(true);
      if (event.event === "getting-started") setShowGuide(true);
      if (event.event === "error") setError(event.message);
      if (event.event === "open-alert-session") setOpenAlert(event.target);
      if (event.event === "session-alert") setSessionAlert(event);
      if (event.event === "dismiss-session-alert")
        setSessionAlert((old) => old?.key === event.key ? undefined : old);
      if (event.event === "clear-session-alerts") setSessionAlert(undefined);
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
      if (document.querySelector(".getting-started[open]")) return;
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
  const hiddenHistory = snapshot.hidden ?? emptyHiddenHistory;
  const allProjects = useMemo(
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
  const projects = useMemo(() => allProjects.filter((folder) => !hiddenHistory.projects.includes(folder)),
    [allProjects, hiddenHistory]);
  const visibleSessions = useMemo(() => allSessions.filter((row) =>
    !hiddenHistory.projects.includes(row.cwd) && !hiddenHistory.sessions.includes(key(row))), [allSessions, hiddenHistory]);
  const sessions = useMemo(
    () =>
      visibleSessions
        .filter(
          (s) =>
            (!workspace || s.cwd === workspace) &&
            (scope !== "pinned" || snapshot.pinned.includes(key(s))) &&
            [s.title, s.project, s.cwd, s.preview, s.provider]
              .join(" ")
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .sort((a, b) => Number(!!b.terminalId) - Number(!!a.terminalId) || b.updated - a.updated),
    [visibleSessions, snapshot.pinned, workspace, scope, query],
  );
  const workspaceTerminals = snapshot.terminals.filter(
    (t) => (!workspace || t.cwd === workspace) && !hiddenHistory.projects.includes(t.cwd) &&
      !hiddenHistory.sessions.includes(terminalSessionKey(t)),
  );
  const companionIDs = new Set(
    Object.entries(companions)
      .filter(([owner]) => snapshot.terminals.some((t) => t.id === owner))
      .map(([, id]) => id),
  );
  const terminals = workspaceTerminals.filter(
    (t) => !hiddenTabs.includes(t.id) && !companionIDs.has(t.id),
  );
  useEffect(() => {
    if (!terminals.length) setLayoutInfo({ locations: {}, focused: "Pane 1" });
  }, [terminals.length]);
  const session = allSessions.find(
    (s) => "session:" + key(s) === selection,
  );
  const note = snapshot.notes.find((n) => "note:" + n.id === selection);
  const noteSource = note?.sourceSessionID ? allSessions.find(
    (row) => row.sessionID === note.sourceSessionID && row.provider === note.sourceProvider,
  ) : undefined;
  const foundNotes = useMemo(() => query.trim() ? snapshot.notes.filter(
    (item) => (!workspace || item.project === workspace) && !hiddenHistory.projects.includes(item.project) && matchesNote(item, query),
  ) : [], [query, snapshot.notes, workspace, hiddenHistory]);
  const shown = terminals.find(
    (t) => "terminal:" + t.id === selection,
  );
  const shownSession = allSessions.find((row) => row.terminalId === shown?.id);
  const conversationLocked = !!shown && lockedTerminals.has(shown.id);
  const attachmentTarget = shown && shown.agent !== "shell" && !shown.exited && connection === "connected"
    ? {
        id: shown.id, title: terminalTitle(shown), browserTools: shown.browserTools, locked: conversationLocked, canResume: !!shown.sessionID,
        busy: conversationLocked || ["working", "needsInput"].includes(shownSession?.state || ""),
      }
    : undefined;
  const viewedTerminal = shown && !shown.exited && connection === "connected" ? shown.id : null;
  useEffect(() => {
    void window.runhuddle.viewedTerminal(viewedTerminal).catch(() => {});
  }, [viewedTerminal]);
  useEffect(() => {
    if (!loaded || !openAlert) return;
    setHistoryResult(undefined);
    const row = allSessions.find((candidate) =>
      candidate.provider === openAlert.provider && candidate.sessionID === openAlert.sessionID);
    if (!row) {
      setError("This session is no longer available.");
    } else {
      setMode("recent");
      setQuery("");
      setScope("all");
      if (workspace && workspace !== row.cwd) setWorkspace(row.cwd);
      if (row.terminalId) {
        setHiddenTabs((old) => old.filter((id) => id !== row.terminalId));
        setSelection("terminal:" + row.terminalId);
      } else setSelection("session:" + key(row));
    }
    setOpenAlert(undefined);
  }, [loaded, openAlert, allSessions, workspace]);
  function select(value: string, folder = workspace) {
    setHistoryResult(undefined);
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

    if (folder !== workspace) setWorkspace(folder);
    setSelection(value);
  }
  function switchWorkspace(folder: string) {
    if (folder === workspace) return;
    setHistoryResult(undefined);
    setScope("all");
    setWorkspace(folder);
    setSelection(restoredSelection(snapshot, folder, workspaceSelections[folder] ?? selection,
      [...hiddenTabs, ...companionIDs]));
  }
  function focusProject(folder: string) {
    setOverviewFolder("");
    switchWorkspace(folder);
    setMode("recent");
  }
  function newProjectSession(folder: string) {
    setOverviewFolder("");
    switchWorkspace(folder);
    setLaunchKind("ai");
    setLauncher(true);
  }
  async function changeHistoryVisibility(kind: "projects" | "sessions", id: string, hide: boolean) {
    try {
      await window.runhuddle.setHistoryHidden(kind, id, hide);
      if (!hide) return;
      if (kind === "projects" && workspace === id) switchWorkspace("");
      if (kind === "projects" ? [session?.cwd, note?.project, shown?.cwd].includes(id) : session && key(session) === id) {
        setHistoryResult(undefined);
        setSelection("");
      }
    } catch (error) { setError(String(error)); }
  }
  async function chooseWorkspace() {
    try {
      const folder = await window.runhuddle.chooseFolder();
      if (folder) {
        if (hiddenHistory.projects.includes(folder)) await window.runhuddle.setHistoryHidden("projects", folder, false);
        setFolders((old) => [...new Set([...old, folder])]);
        switchWorkspace(folder);
      }
    } catch (e) {
      setError(String(e));
    }
  }
  async function create(agent: string, cwd: string) {
    if (hiddenHistory.projects.includes(cwd)) await window.runhuddle.setHistoryHidden("projects", cwd, false);
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
  function sidebarState(s: Session) {
    if (!s.terminalId) return "saved";
    return lockedTerminals.has(s.terminalId) ? "locked" : s.state;
  }
  const terminalsById = useMemo(() => new Map(snapshot.terminals.map((terminal) => [terminal.id, terminal])), [snapshot.terminals]);
  function terminalRow(t: TerminalInfo | undefined, title: string, row: React.ReactNode) {
    if (!t) return row;
    const hidden = hiddenTabs.includes(t.id);
    const locked = lockedTerminals.has(t.id);
    return (
      <div key={t.id} className="live-row" onContextMenu={(event) => {
        event.preventDefault();
        openRowMenu(event.currentTarget);
      }}>
        {row}
        <details className="row-menu">
          <summary aria-label={`Actions for ${title}`} title="Session actions">•••</summary>
          <div onClick={(event) => {
            const menu = event.currentTarget.parentElement as HTMLDetailsElement;
            menu.open = false;
          }}>
            {locked && <button onClick={() => {
              void window.runhuddle.locateCodexSession(t.id).catch((error) => setError(String(error)));
            }}>Find where it’s open</button>}
            {!hidden && !t.exited && <button onClick={() => hideTab(t)}>Hide tab (keep running)</button>}
            <button onClick={() => close(t)}>
              {t.exited ? "Remove terminal" : t.agent === "shell" ? "Close terminal" : "End session"}
            </button>
          </div>
        </details>
      </div>
    );
  }
  function liveRow(t: TerminalInfo) {
    const locked = !t.exited && lockedTerminals.has(t.id);
    return terminalRow(t, terminalTitle(t),
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
              "dot " + (locked ? "locked" : t.exited || t.agent !== "shell" ? "saved" : "idle")
            }
            title={
              locked ? labels.locked : t.exited
                ? "Ended"
                : t.agent === "shell"
                  ? "Terminal open"
                  : "Terminal open · agent activity not linked"
            }
          />
          {locked ? <span className="row-age conversation-lock">{labels.locked}</span> :
            !t.exited && hiddenTabs.includes(t.id) && <span className="row-age">Tab hidden</span>}
        </button>,
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
      const row = allSessions.find((session) => session.provider === provider && session.sessionID === sessionID);
      if (row && hiddenHistory.projects.includes(row.cwd)) await window.runhuddle.setHistoryHidden("projects", row.cwd, false);
      if (row && hiddenHistory.sessions.includes(key(row))) await window.runhuddle.setHistoryHidden("sessions", key(row), false);
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
        if (workspace && workspace !== t.cwd) setWorkspace(t.cwd);
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
    const source = snapshot.sessions.find((s) =>
      s.sessionID === t.sessionID && s.provider.toLowerCase() === t.agent,
    );
    return (
      <div
        className="pane-heading session-toolbar"
        aria-label="Active session toolbar"
      >
        <TerminalContext cwd={t.cwd} pathLabel={projectScope} />
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
          source={source ||
            { provider: t.agent === "codex" ? "Codex" : t.agent === "claude" ? "Claude" : "Copilot", sessionID: t.sessionID || "", title: t.title, cwd: t.cwd, project: t.cwd, preview: "", state: "disconnected", updated: 0 }}
          recap={source ? snapshot.recaps?.[key(source)] : undefined}
          onCreate={create} />}
        <details className="folder-actions">
          <summary aria-label="Session actions">•••</summary>
          <div>
            {shownSession && (
              <button onClick={() => {
                setHistoryResult(undefined);
                setSelection("session:" + key(shownSession));
              }}>
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
        {t.unavailable && t.sessionID && (
          <button disabled={resuming} onClick={() => restartEndedSession(t)}>
            {resuming ? "Resuming…" : "Resume session"}
          </button>
        )}
        {t.agent !== "shell" && (
          <button onClick={() => close(t)}>
            {t.exited ? "Remove session" : "End session"}
          </button>
        )}
      </div>
    );
  }
  async function restartEndedSession(t: TerminalInfo) {
    if (t.sessionID) {
      const provider = launchOptions.find((option) => option.id === t.agent)?.name || t.agent;
      await resumeSession(provider, t.sessionID, t.id);
      return;
    }
    setResuming(true);
    try {
      const replacement = await create(t.agent, t.cwd);
      setTabReplacement({ from: t.id, to: replacement.id });
      setHiddenTabs((old) => [...old, t.id]);
    } catch (error) {
      setError(String(error));
    } finally {
      setResuming(false);
    }
  }
  function renderTerminal(t: TerminalInfo) {
    const showRestart = t.agent !== "shell" && t.exited && !t.unavailable && connection === "connected";
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
          <div className={showRestart ? "pane-body ended-agent-terminal" : "pane-body"}>
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
                readOnly={t.exited}
                visible={true}
                focused={shown?.id === t.id}
                onError={setError}
                onConversationLock={t.agent === "codex" && !t.exited
                  ? (locked) => updateConversationLock(t.id, locked) : undefined}
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
            {showRestart && (
              <div className="terminal-exit">
                <span role="status">{t.exitCode ? `Exited with code ${t.exitCode}` : "Session ended"}</span>
                <button className="primary" disabled={resuming} onClick={() => void restartEndedSession(t)}>
                  {resuming ? "Restarting…" : t.sessionID ? "Restart session" : "Start new session"}
                </button>
              </div>
            )}
          </div>
        </CompanionShell>
      </section>
    );
  }
  const tabControls = (
    <>
      <button
        data-tour-anchor="sidebar"
        title={sidebar ? "Hide sidebar" : "Show sidebar"}
        onClick={() => setSidebar(!sidebar)}
      >
        <Icon name="sidebar" />
      </button>
      <button
        data-tour-anchor="launch"
        aria-label="New session or terminal"
        title="New session or terminal (⌘T)"
        onClick={() => setLauncher(true)}
      >
        <Icon name="plus" size={16} />
      </button>
    </>
  );
  const projectScope = workspace ? (
    <div className="project-scope" data-tour-anchor="project-scope">
      <span className="project-scope-name" title={workspace}>
        <Icon name="folder" size={14} />
        <span>{name(workspace)}</span>
      </span>
      <button title="Return to the all-projects layout" onClick={() => switchWorkspace("")}>
        All projects
      </button>
    </div>
  ) : undefined;
  return (
    <AppearanceContext.Provider value={appearance}>
      <div className={"app " + (!sidebar ? "collapsed" : "")}>
        {customAccentOpen && <AppAccentDialog accent={accent} onClose={() => setCustomAccentOpen(false)} />}
        {showGuide && <GettingStarted onClose={dismissGuide} terminalVisible={Boolean(shown)} />}
        {showHiddenHistory && <HiddenHistoryDialog hidden={hiddenHistory} sessions={allSessions}
          onRestore={(kind, id) => void changeHistoryVisibility(kind, id, false)} onClose={() => setShowHiddenHistory(false)} />}
        {overviewFolder && <ProjectOverview name={name(overviewFolder)} folder={overviewFolder}
          sessions={visibleSessions.filter((row) => row.cwd === overviewFolder).sort((a, b) => b.updated - a.updated)}
          running={snapshot.terminals.filter((row) => row.cwd === overviewFolder && !row.exited).length}
          notes={snapshot.notes.filter((note) => note.project === overviewFolder).length}
          onSelect={(row) => { focusProject(overviewFolder); select("session:" + key(row), overviewFolder); }}
          onFocus={() => focusProject(overviewFolder)} onLaunch={() => newProjectSession(overviewFolder)}
          onClose={() => setOverviewFolder("")} />}
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
                data-tour-anchor="search"
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
                data-tour-anchor="projects"
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
                </select>
              </div>
            )}
            <div className="sidebar-list">
              {mode === "workspaces" ? (
                <>
                  <div className="section-label">
                    PROJECT FOLDERS
                    <details className="row-menu project-list-menu">
                      <summary aria-label="Project list options" title="Project list options">•••</summary>
                      <div onClick={(event) => { (event.currentTarget.parentElement as HTMLDetailsElement).open = false; }}>
                        <button onClick={chooseWorkspace}>Add project folder…</button>
                        <button onClick={() => setShowHiddenHistory(true)}>Manage hidden…</button>
                      </div>
                    </details>
                  </div>
                  {projects
                    .filter((p) =>
                      [
                        p,
                        ...visibleSessions
                          .filter((s) => s.cwd === p)
                          .map((s) => s.title),
                      ]
                        .join(" ")
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                    )
                    .map((p) => {
                      const rows = visibleSessions.filter(
                        (s) =>
                          s.cwd === p &&
                          (!query ||
                            p.toLowerCase().includes(query.toLowerCase()) ||
                            s.title
                              .toLowerCase()
                              .includes(query.toLowerCase())),
                      );
                      const actions = (
                        <>
                          <button
                            onClick={() => newProjectSession(p)}
                          >
                            New session
                          </button>
                          <button
                            onClick={() => focusProject(p)}
                          >
                            Focus project
                          </button>
                          <button onClick={() => void changeHistoryVisibility("projects", p, true)}>
                            Hide project
                          </button>
                        </>
                      );
                      return (
                        <div className="project-row" key={p}>
                          <details className="project-group" open={workspace === p || !!query || undefined}>
                            <summary title={p}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                openRowMenu(event.currentTarget.closest(".project-row"));
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                                  event.preventDefault();
                                  openRowMenu(event.currentTarget.closest(".project-row"));
                                }
                              }}>
                              <Icon name="folder" />
                              <strong>{name(p)}</strong>
                              <small>{rows.length}</small>
                            </summary>
                            <div className="project-actions">{actions}</div>
                            {rows.map((s) => terminalRow(terminalsById.get(s.terminalId || ""), s.title,
                              <button
                                className={
                                  "session-row " +
                                  (selection === "session:" + key(s) ||
                                  (s.terminalId && shown?.id === s.terminalId)
                                    ? "selected"
                                    : "")
                                }
                                key={key(s)}
                                onClick={() => {
                                  setMode("recent");
                                  setScope("all");
                                  select("session:" + key(s), p);
                                }}
                              >
                                <AgentIcon agent={s.provider.toLowerCase()} />
                                <strong title={s.preview}>{s.title}</strong>
                                {s.terminalId && lockedTerminals.has(s.terminalId) &&
                                  <span className="row-age conversation-lock">{labels.locked}</span>}
                                <span
                                  className={
                                    "dot " + sidebarState(s)
                                  }
                                  title={s.terminalId ? labels[sidebarState(s)] : "Recorded session"}
                                />
                              </button>,
                            ))}
                            {!rows.length && (
                              <p className="empty-small">
                                No recorded sessions in this folder.
                              </p>
                            )}
                          </details>
                          <details className="row-menu project-row-menu" onToggle={(event) => {
                            const menu = event.currentTarget;
                            if (!menu.open) return;
                            const bottom = menu.closest(".sidebar-list")?.getBoundingClientRect().bottom ?? window.innerHeight;
                            const height = menu.querySelector("div")?.offsetHeight ?? 0;
                            menu.classList.toggle("opens-up", bottom - menu.getBoundingClientRect().bottom < height);
                          }}>
                            <summary aria-label={`Actions for project ${name(p)}`} title="Project actions">•••</summary>
                            <div onClick={(event) => {
                              (event.currentTarget.parentElement as HTMLDetailsElement).open = false;
                            }}>
                              <button onClick={() => setOverviewFolder(p)}>Project overview</button>
                              {actions}
                            </div>
                          </details>
                        </div>
                      );
                    })}
                </>
              ) : (
                <>
                  {openUnlinked.length > 0 && (
                    <section aria-label="Open in RunHuddle" className="unlinked-sessions">
                      <div className="recency-label">Open in RunHuddle</div>
                      {openUnlinked.map(liveRow)}
                    </section>
                  )}
                  {sessions.map((s, index) => {
                    const group = (row: Session) => row.terminalId ? "Open in RunHuddle" : recency(row.updated);
                    return (
                    <React.Fragment key={key(s)}>
                      {(index === 0
                        ? !s.terminalId || !openUnlinked.length
                        : group(s) !== group(sessions[index - 1])) && (
                        <div className="recency-label">
                          {group(s)}
                        </div>
                      )}
                      {terminalRow(terminalsById.get(s.terminalId || ""), s.title, <button
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
                        <span className="recent-session-title">
                          <strong title={[s.title, s.cwd, location(s.terminalId), s.preview].filter(Boolean).join("\n")}>
                            {s.title}
                          </strong>
                          {snapshot.recaps?.[key(s)]?.next && (
                            <small title={snapshot.recaps[key(s)].next}>
                              Next · {snapshot.recaps[key(s)].next}
                            </small>
                          )}
                        </span>
                        <span
                          className={
                            "dot " + sidebarState(s)
                          }
                          title={
                            s.terminalId
                              ? labels[sidebarState(s)] || s.state
                              : "Recorded session"
                          }
                        />
                        {s.terminalId && (lockedTerminals.has(s.terminalId)
                          ? <span className="row-age conversation-lock">{labels.locked}</span>
                          : s.state === "needsInput" ? <span className="row-age">Needs input</span>
                          : hiddenTabs.includes(s.terminalId) && <span className="row-age">Tab hidden</span>)}
                        {!s.terminalId && <span
                          className="row-age"
                          title={new Date(s.updated * 1000).toLocaleString()}
                        >
                          {new Date(s.updated * 1000).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric" },
                          )}
                        </span>}
                      </button>)}
                    </React.Fragment>
                    );
                  })}
                  {scope === "all" && unlinkedAgents.some((t) => t.exited && matchesTerminal(t)) && (
                    <section aria-label="Ended terminals" className="unlinked-sessions">
                      <div className="recency-label">Ended terminals</div>
                      {unlinkedAgents.filter((t) => t.exited && matchesTerminal(t)).map(liveRow)}
                    </section>
                  )}
                  {!sessions.length && (query.trim().length < 2 || scope !== "all") && (
                    <p className="empty-small">
                      {!snapshot.sessions.length && scope === "all" && !query.trim()
                        ? "Saved conversations from this device appear here."
                        : "No sessions match these filters."}
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
              <ConversationSearch key={JSON.stringify(hiddenHistory)} query={query} folder={workspace} scope={mode === "recent" ? scope : "all"}
                onOpen={(result) => {
                  setHistoryResult(result);
                  setSelection("session:" + result.provider + ":" + result.sessionID);
                }} />
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
              <small>
                {visibleSessions.length} sessions · {projects.length} projects
              </small>
            </footer>
          </aside>
        )}
        <main>
          {snapshot.updateDownload && (
            <section className="update-download" aria-label="Update download">
              <strong>Downloading RunHuddle {snapshot.updateDownload.version}…</strong>
              <progress aria-label="Update download progress" max={100}
                value={snapshot.updateDownload.percent ?? undefined} />
              {snapshot.updateDownload.percent !== null && <span>{snapshot.updateDownload.percent}%</span>}
            </section>
          )}
          {sessionAlert && (
            <div className="session-alert-banner" role="status" aria-label="Session notification">
              <div><strong>{sessionAlert.alert.title}</strong> <span>{sessionAlert.alert.body}</span></div>
              {sessionAlert.alert.provider && sessionAlert.alert.sessionID && (
                <button onClick={() => {
                  const { provider, sessionID, inboxId } = sessionAlert.alert;
                  if (provider && sessionID) {
                    const target = { provider, sessionID };
                    if (inboxId) {
                      void window.runhuddle.inboxAction(inboxId, "open")
                        .then((opened) => { if (!opened) setOpenAlert(target); })
                        .catch((e) => setError(String(e)));
                    } else setOpenAlert(target);
                  }
                  setSessionAlert(undefined);
                }}>Open session</button>
              )}
              <button onClick={() => setSessionAlert(undefined)} aria-label="Dismiss session notification">×</button>
            </div>
          )}
          {!shown && <div className="empty-tabbar">{tabControls}{projectScope}</div>}
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
          {error && (
            <div role="alert" className="error">
              {error}
              <button
                aria-label="Dismiss error"
                onClick={() => {
                  setError("");
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
                    key={workspace}
                    workspace={workspace}
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
                        <button onClick={() => void window.runhuddle.pinSession(session.provider, session.sessionID,
                          !snapshot.pinned.includes(key(session))).catch((reason) => setError(String(reason)))}>
                          {snapshot.pinned.includes(key(session)) ? "Unpin session" : "Pin session"}
                        </button>
                        <button onClick={() => void changeHistoryVisibility("sessions", key(session), true)}>
                          Hide session
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
                    <SessionHistory key={key(session)} session={session}
                      recap={snapshot.recaps?.[key(session)]}
                      anchor={historyResult && key(historyResult) === key(session) ? historyResult.anchor : undefined}
                      onLatest={() => setHistoryResult(undefined)}
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
                        <button onClick={() => {
                          if (workspace && workspace !== noteSource.cwd) setWorkspace(noteSource.cwd);
                          setSelection("session:" + key(noteSource));
                        }}>
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
                      {visibleSessions
                        .filter(
                          (s) =>
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
                              {snapshot.recaps?.[key(s)]?.next && (
                                <small>Next · {snapshot.recaps[key(s)].next}</small>
                              )}
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
              attachmentTarget={attachmentTarget}
              onReopenBrowserSession={async (id) => {
                const previous = terminalsById.get(id);
                const reopened = await window.runhuddle.reopenBrowserSession(id);
                if (!reopened) return;
                if (previous?.sessionID) setTabReplacement({ from: id, to: reopened.id });
                setSnapshot((old) => ({
                  ...old,
                  terminals: [...old.terminals.filter((t) => t.id !== reopened.id && (!previous?.sessionID || t.id !== id)), reopened],
                }));
                setHiddenTabs((old) => old.filter((item) => item !== reopened.id));
                setSelection((old) => old === "terminal:" + id ? "terminal:" + reopened.id : old);
              }}
              selection={selection}
              onSelectNote={(id) => select("note:" + id)}
              onNewNote={() => setNoteDraft({
                title: "", text: "", project: shown?.cwd || session?.cwd || note?.project || workspace,
              })}
              showNotes={showNotes}
              inbox={snapshot.inbox || []}
              onInboxAction={(id, action) =>
                void window.runhuddle.inboxAction(id, action).catch((e) => setError(String(e)))}
              cwd={
                shown?.cwd || session?.cwd || note?.project || workspace || ""
              }
            />
          </div>
          <ScreenshotPopup target={attachmentTarget} />
          <footer className="statusbar">
            <button data-tour-anchor="appearance" onClick={() => setAppearanceOpen(true)}>
              Terminal appearance…
            </button>
            <span>{shown ? shown.cwd : workspace || "All workspaces"}</span>
            <span>
              {shown?.exited
                ? `Exited (${shown.exitCode})`
                : "Terminals stay running when you close the app"}
            </span>
          </footer>
        </main>
      </div>
    </AppearanceContext.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
