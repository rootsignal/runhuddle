import { DashboardNotes } from "./DashboardNotes";
import { CommandPalette, KeyboardShortcutSettings, QuickTerminal, bindingForEvent, bindingText, defaultBindings } from "./KeyboardTools";
import type { AppCommand, DashboardRequest } from "./types";
import { RenameSession } from "./RenameSession";
import { HiddenHistoryDialog } from "./HiddenHistoryDialog";
import { useDashboardDrafts } from "./dashboard-drafts";
import { McpSettings } from "./GitHubPRControl";
import { ProjectsDashboard, type SessionDetails } from "./ProjectsDashboard";
import { SessionContinuation, type ContinuationRequest } from "./SessionContinuation";
import { ScreenshotPopup } from "./ScreenshotPopup";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AppearanceContext,
  loadAppearance,
  TerminalAppearance,
} from "./TerminalAppearance";
import { NoteEditor } from "./NoteEditor";
import { LaunchMenu } from "./LaunchMenu";
import { AppAccentDialog } from "./AppAccentDialog";
import { GettingStarted } from "./GettingStarted";
import { launchOptions } from "./Icons";
import type { ContinuationLink, NoteDraft, SessionAlertTarget, Snapshot, Session, TerminalInfo } from "./types";
import "./app-theme.css";
import "./style.css";
const key = (s: Pick<Session, "provider" | "sessionID">) => s.provider + ":" + s.sessionID;
const name = (p: string) => p.split(/[\\/]/).filter(Boolean).at(-1) || p;
const emptyHiddenHistory = { projects: [], sessions: [] };
const terminalSessionKey = (t: TerminalInfo) =>
  `${launchOptions.find((option) => option.id === t.agent)?.name}:${t.sessionID}`;
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
function App() {
  const [customAccentOpen, setCustomAccentOpen] = useState(false);
  const [dashboardNotes, setDashboardNotes] = useState<{ folder: string }>();
  const [noteDraft, setNoteDraft] = useState<NoteDraft>();
  const [openAlert, setOpenAlert] = useState<SessionAlertTarget>();
  const [showHiddenHistory, setShowHiddenHistory] = useState(false);
  const [dashboardCommand, setDashboardCommand] = useState<DashboardRequest>();
  const [keyboardTool, setKeyboardTool] = useState<"command-palette" | "quick-terminal" | "keyboard-shortcuts" | "mcp-settings">();
  const [keyboardBindings, setKeyboardBindings] = useState(defaultBindings);
  const [dashboardFolder, setDashboardFolder] = useState("");
  const [quickTerminalID, setQuickTerminalID] = useState(() => localStorage.getItem("quickTerminalID") || "");
  const [animateQuickTerminal, setAnimateQuickTerminal] = useState(() => readSetting("animateQuickTerminal", true));
  useEffect(() => {
    localStorage.setItem("animateQuickTerminal", JSON.stringify(animateQuickTerminal));
  }, [animateQuickTerminal]);
  const quickStart = useRef<Promise<void> | null>(null);
  useEffect(() => {
    void window.runhuddle.keyboardShortcuts().then(setKeyboardBindings).catch(() => {});
  }, []);
  useEffect(() => {
    if (quickTerminalID) localStorage.setItem("quickTerminalID", quickTerminalID);
    else localStorage.removeItem("quickTerminalID");
  }, [quickTerminalID]);
  function runAppCommand(action: AppCommand | DashboardRequest) {
    if (action === "project-notes" || action === "terminal-appearance") {
      setKeyboardTool(undefined);
      if (action === "project-notes") setDashboardNotes({ folder: "" });
      else setAppearanceOpen(true);
      return;
    }
    if (typeof action === "string" &&
        (action === "command-palette" || action === "quick-terminal" || action === "keyboard-shortcuts" || action === "mcp-settings")) {
      setKeyboardTool((previous) => previous === action ? undefined : action);
      return;
    }
    setKeyboardTool(undefined);
    const request = typeof action === "string" ? { command: action } : action;
    setDashboardCommand(request);
  }
  useEffect(() => {
    function keyboardShortcut(event: KeyboardEvent) {
      if (keyboardTool === "keyboard-shortcuts" || event.isComposing) return;
      const shortcut = bindingForEvent(event);
      const tool = shortcut === keyboardBindings.palette ? "command-palette"
        : shortcut === keyboardBindings.terminal ? "quick-terminal" : undefined;
      if (!tool) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) setKeyboardTool((old) => old === tool ? undefined : tool);
    }
    window.addEventListener("keydown", keyboardShortcut, true);
    return () => window.removeEventListener("keydown", keyboardShortcut, true);
  }, [keyboardBindings, keyboardTool]);
  const [snapshot, setSnapshot] = useState<Snapshot>({
    sessions: [],
    notes: [],
    pinned: [],
    terminals: [],
    home: "",
  });
  const [dashboardSubmitted, setDashboardSubmitted] = useState<Record<string, { text: string; at: number; screenshots?: number }>>({});
  const dashboardDrafts = useDashboardDrafts();
  const [dashboardTerminal, setDashboardTerminal] = useState<string | null>(null);
  const [dashboardDraftTarget, setDashboardDraftTarget] = useState<{ id: string; queued: boolean } | null>(null);
  const [openedSessions, setOpenedSessions] = useState(() => readSetting<Record<string, number>>("dashboardOpenedSessions", {}));
  const [renameTarget, setRenameTarget] = useState<string>();
  const [sessionDetails, setSessionDetails] = useState(() => readSetting<Record<string, SessionDetails>>("projectSessionDetails", {}));
  useEffect(() => {
    localStorage.setItem("projectSessionDetails", JSON.stringify(sessionDetails));
  }, [sessionDetails]);
  const [continuation, setContinuation] = useState<(ContinuationRequest & { id: number })>();
  const continuationID = useRef(0);
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
  const accent = snapshot.accent || "#8fcbd0";
  useEffect(() => {
    document.documentElement.style.setProperty("--app-accent-base", accent);
    document.documentElement.dataset.appTheme = snapshot.appTheme || "system";
  }, [accent, snapshot.appTheme]);
  const [loaded, setLoaded] = useState(false);
  const [connection, setConnection] = useState("connected");
  const [error, setError] = useState("");
  const [appearance, setAppearance] = useState(loadAppearance);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  useEffect(() => {
    localStorage.setItem("terminalAppearance", JSON.stringify(appearance));
  }, [appearance]);
  const [dashboardLaunchTerminal, setDashboardLaunchTerminal] = useState<string>();
  const [launchInTerminal, setLaunchInTerminal] = useState(false);
  const [dashboardLaunchScope, setDashboardLaunchScope] = useState<string[]>([]);
  const [folders] = useState(() => readSetting<string[]>("folders", []));
  const [launcher, setLauncher] = useState(false);
  const [lastUsed, setLastUsed] = useState(() => readSetting<string>("lastLaunchType", ""));

  useEffect(() => {
    window.runhuddle
      .snapshot()
      .then((data) => {
        setSnapshot(data);
        if (data.openAlert) setOpenAlert(data.openAlert);
        setConnection(data.connection || "connected");
        setLoaded(true);
      })
      .catch((e) => setError(String(e)));
    return window.runhuddle.onEvent((event) => {
      if (event.event === "dashboard-command") runAppCommand(event.command);
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
      if (event.event === "keep-awake") setSnapshot((old) => ({ ...old, keepAwakeActive: event.active }));
      if (event.event === "app-theme") setSnapshot((old) => ({ ...old, appTheme: event.theme }));
      if (event.event === "update-download") setSnapshot((old) => ({ ...old, updateDownload: event.download }));
      if (event.event === "session-continuations") setSnapshot((old) => ({ ...old, continuations: event.continuations }));
      if (event.event === "app-accent") setSnapshot((old) => ({ ...old, accent: event.accent }));
      if (event.event === "custom-app-accent") setCustomAccentOpen(true);
      if (event.event === "getting-started") setShowGuide(true);
      if (event.event === "error") setError(event.message);
      if (event.event === "open-alert-session") setOpenAlert(event.target);
    });
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
  useEffect(() => {
    const linked = snapshot.terminals.filter((terminal) => terminal.sessionID && sessionDetails["terminal:" + terminal.id]?.name);
    if (!linked.length) return;
    setSessionDetails((previous) => {
      const next = { ...previous };
      for (const terminal of linked) {
        const pending = "terminal:" + terminal.id;
        const session = terminalSessionKey(terminal);
        if (next[pending]?.name && !next[session]?.name)
          next[session] = { ...next[pending], ...next[session], name: next[pending].name };
        delete next[pending];
      }
      return next;
    });
  }, [snapshot.terminals, sessionDetails]);
  const allSessions = useMemo(
    () => sessionRows(snapshot, connection === "connected").map((row) => {
      const customName = sessionDetails[key(row)]?.name || (row.terminalId && sessionDetails["terminal:" + row.terminalId]?.name);
      const automaticTitle = /^<environment_context(?:\s[^>]*)?>\s*$/i.test(row.title.trim())
        ? row.provider + " session" : row.title;
      return customName || automaticTitle !== row.title
        ? { ...row, title: customName || automaticTitle } : row;
    }),
    [snapshot.sessions, snapshot.terminals, connection, sessionDetails],
  );
  const namedInbox = (snapshot.inbox ?? []).map((entry) => {
    const customName = sessionDetails[key(entry)]?.name;
    return customName ? { ...entry, body: customName } : entry;
  });
  function saveSessionName(id: string, name: string) {
    setSessionDetails((previous) => ({ ...previous, [id]: { next: previous[id]?.next ?? "", name } }));
  }
  const projects = useMemo(() => allProjects.filter((folder) => !hiddenHistory.projects.includes(folder)),
    [allProjects, hiddenHistory]);
  const visibleSessions = useMemo(() => allSessions.filter((row) =>
    !hiddenHistory.projects.includes(row.cwd) && !hiddenHistory.sessions.includes(key(row))), [allSessions, hiddenHistory]);
  const continuationsBySession = useMemo(() => {
    const result = new Map<string, { outgoing: ContinuationLink[]; incoming: ContinuationLink[] }>();
    for (const link of snapshot.continuations ?? []) {
      for (const [endpoint, direction] of [[link.from, "outgoing"], [link.to, "incoming"]] as const) {
        const id = key(endpoint);
        const links = result.get(id) ?? { outgoing: [], incoming: [] };
        links[direction].push(link);
        result.set(id, links);
      }
    }
    return result;
  }, [snapshot.continuations]);
  function recordSessionOpened(id: string) {
    const openedAt = Date.now();
    setOpenedSessions((previous) => {
      const next = { ...previous };
      delete next[id];
      return Object.fromEntries([...Object.entries(next).slice(-99), [id, openedAt]]);
    });
  }
  useEffect(() => {
    localStorage.setItem("dashboardOpenedSessions", JSON.stringify(openedSessions));
  }, [openedSessions]);
  const dashboardAttachment = snapshot.terminals.find((t) => t.id === dashboardDraftTarget?.id && !t.exited);
  const dashboardAttachmentSession = dashboardAttachment && allSessions.find((row) => row.terminalId === dashboardAttachment.id);
  const screenshotDraftID = dashboardAttachmentSession ? key(dashboardAttachmentSession) : undefined;
  const screenshotTarget = dashboardAttachment && dashboardAttachmentSession && connection === "connected" ? {
    id: dashboardAttachment.id,
    title: dashboardAttachmentSession.title,
    locked: lockedTerminals.has(dashboardAttachment.id),
    busy: dashboardAttachmentSession.state === "working",
  } : undefined;
  const screenshotBlocked = screenshotTarget?.locked ? "This conversation is open elsewhere."
    : dashboardDraftTarget?.queued ? "Cancel the queued follow-up to add more screenshots."
    : !screenshotDraftID ? undefined
    : !dashboardDrafts.ready ? "The follow-up draft is loading."
    : (dashboardDrafts.drafts[screenshotDraftID]?.files.length ?? 0) >= 8 ? "This draft already has 8 screenshots."
    : undefined;
  const noteBeingEdited = noteDraft?.id ? snapshot.notes.find((note) => note.id === noteDraft.id) : undefined;
  const draftSource = noteDraft?.source;
  const noteSourceTitle = draftSource
    ? allSessions.find((row) => key(row) === key(draftSource))?.title || draftSource.provider
    : noteBeingEdited?.sourceSessionID ? noteBeingEdited.sourceTitle || noteBeingEdited.sourceProvider || "Saved conversation" : undefined;
  const viewedTerminal = connection === "connected" ? dashboardTerminal : null;
  useEffect(() => {
    void window.runhuddle.viewedTerminal(viewedTerminal).catch(() => {});
  }, [viewedTerminal]);
  useEffect(() => {
    if (!loaded || !openAlert) return;
    const row = visibleSessions.find((candidate) => key(candidate) === key(openAlert));
    if (row) runAppCommand({ command: "open-session", session: key(row), notification: true });
    else setError("This session is no longer available.");
    setOpenAlert(undefined);
  }, [loaded, openAlert, visibleSessions]);
  async function create(agent: string, cwd: string, sessionName = "") {
    if (hiddenHistory.projects.includes(cwd)) await window.runhuddle.setHistoryHidden("projects", cwd, false);
    const t = await window.runhuddle.create(cwd, agent);
    if (sessionName) saveSessionName(t.sessionID ? terminalSessionKey(t) : "terminal:" + t.id, sessionName);
    setSnapshot((old) => ({
      ...old,
      terminals: [...old.terminals.filter((x) => x.id !== t.id), t],
    }));
    if (agent !== "shell") {
      setLastUsed(agent);
      localStorage.setItem("lastLaunchType", JSON.stringify(agent));
    }
    return t;
  }
  function continueWithContext(source: Session, anotherAgent = false) {
    setContinuation({ id: ++continuationID.current, source, anotherAgent,
      recap: snapshot.recaps?.[key(source)], nextStep: sessionDetails[key(source)]?.next });
  }
  async function resumeSession(provider: string, sessionID: string) {
    const terminal = await window.runhuddle.resume(provider, sessionID);
    if (!terminal) throw Error("Couldn’t resume this conversation.");
    setSnapshot((old) => ({
      ...old,
      terminals: [...old.terminals.filter((item) => item.id !== terminal.id), terminal],
    }));
    setDashboardLaunchTerminal(terminal.id);
  }
  async function closeTerminal(id: string) {
    if (!await window.runhuddle.close(id)) return false;
    setSnapshot((old) => ({ ...old, terminals: old.terminals.filter((terminal) => terminal.id !== id) }));
    return true;
  }
  async function reopenBrowserSession(id: string) {
    const previous = snapshot.terminals.find((terminal) => terminal.id === id);
    const reopened = await window.runhuddle.reopenBrowserSession(id);
    if (!reopened) return;
    setSnapshot((old) => ({
      ...old,
      terminals: [...old.terminals.filter((t) => t.id !== reopened.id && (!previous?.sessionID || t.id !== id)), reopened],
    }));
    setLaunchInTerminal(true);
    setDashboardLaunchTerminal(reopened.id);
  }
  const quickTerminal = snapshot.terminals.find((terminal) => terminal.id === quickTerminalID && !terminal.exited);
  const quickDirectory = dashboardFolder || snapshot.home;
  function startQuickTerminal() {
    if (quickStart.current) return quickStart.current;
    const start = window.runhuddle.create(quickDirectory, "shell").then((terminal) => {
      setQuickTerminalID(terminal.id);
      setSnapshot((old) => ({ ...old, terminals: [...old.terminals.filter((item) => item.id !== terminal.id), terminal] }));
    }).finally(() => { quickStart.current = null; });
    quickStart.current = start;
    return start;
  }
  async function endQuickTerminal(id: string) {
    if (!await closeTerminal(id)) return false;
    setQuickTerminalID((current) => current === id ? "" : current);
    return true;
  }
  return (
    <AppearanceContext.Provider value={appearance}>
      <div className="app">
        {customAccentOpen && <AppAccentDialog accent={accent} onClose={() => setCustomAccentOpen(false)} />}
        {continuation && <SessionContinuation key={continuation.id} request={continuation}
          onCreate={async (agent, folder) => {
            const terminal = await create(agent, folder);
            setLaunchInTerminal(true);
            setDashboardLaunchTerminal(terminal.id);
            return terminal;
          }}
          onClose={() => setContinuation((current) => current === continuation ? undefined : current)} />}
        {showHiddenHistory && <HiddenHistoryDialog hidden={hiddenHistory} sessions={allSessions} names={sessionDetails}
          onVisibilityChange={(kind, id, hide) => kind === "sessions"
            ? window.runhuddle.setSessionsHidden([id], hide)
            : window.runhuddle.setHistoryHidden(kind, id, hide)} onClose={() => setShowHiddenHistory(false)} />}
        {!loaded && error && <p role="alert">{error}</p>}
        <ProjectsDashboard connectionStatus={connection} appError={error} onDismissError={() => setError("")}
          onReconnect={() => void window.runhuddle.reconnect().catch((reason) => setError(String(reason)))}
          keepAwakeActive={Boolean(snapshot.keepAwakeActive)} open={loaded} menuCommand={dashboardCommand}
          onProjectContext={setDashboardFolder} paletteShortcut={bindingText(keyboardBindings.palette)}
          onCommandPalette={() => runAppCommand("command-palette")}
          onManageHidden={() => setShowHiddenHistory(true)}
          onRecordOpened={recordSessionOpened}
          onNotes={(folder) => setDashboardNotes({ folder })}
          onSaveExcerpt={(row, text) => setNoteDraft({
            title: row.title.slice(0, 120), text, project: row.cwd,
            source: { provider: row.provider, sessionID: row.sessionID },
          })}
          onContinue={continueWithContext}
          continuations={continuationsBySession}
          onReopenBrowserSession={reopenBrowserSession}
          folders={projects} sessions={visibleSessions} pinned={snapshot.pinned}
          inbox={namedInbox.filter((entry) =>
            !hiddenHistory.sessions.includes(key(entry)) &&
            !allSessions.some((row) => key(row) === key(entry) && hiddenHistory.projects.includes(row.cwd)))}
          submitted={dashboardSubmitted}
          onSubmitted={(id, instruction) => setDashboardSubmitted((previous) => ({ ...previous, [id]: instruction }))}
          connected={connection === "connected"}
          followUps={dashboardDrafts}
          onDraftTerminal={setDashboardDraftTarget}
          onViewTerminal={setDashboardTerminal}
          onTerminalLock={updateConversationLock}
          onEndSession={async (id) => {
            if (allSessions.some((row) => row.terminalId === id && row.state === "idle")) await closeTerminal(id);
          }}
          recaps={snapshot.recaps} lockedTerminals={lockedTerminals} details={sessionDetails} openedSessions={openedSessions}
          terminals={snapshot.terminals} compactShell={snapshot.compactShell ?? null}
          terminalServiceUpdate={!!snapshot.terminalServiceUpdate}
          onStartDrawerShell={async (folder, compactPrompt) => {
            const terminal = await window.runhuddle.create(folder, "shell", compactPrompt);
            setSnapshot((old) => ({
              ...old,
              terminals: [...old.terminals.filter((row) => row.id !== terminal.id), terminal],
            }));
            return terminal.id;
          }}
          launchedTerminal={dashboardLaunchTerminal} launchInTerminal={launchInTerminal} onLaunchHandled={() => {
            setDashboardLaunchTerminal(undefined);
            setLaunchInTerminal(false);
          }}
          onLaunch={(folders) => {
            setDashboardLaunchScope(folders);
            setLauncher(true);
          }}
          protectedSessions={new Set([
            ...continuationsBySession.keys(),
            ...snapshot.notes.flatMap((note) => note.sourceSessionID ? [
              key({ provider: note.sourceProvider, sessionID: note.sourceSessionID }),
            ] : []),
          ])}
          onCleanup={(ids, hide) => window.runhuddle.setSessionsHidden(ids, hide)}
          onRename={(row) => setRenameTarget(key(row))}
          onEdit={(id, details) => setSessionDetails((previous) => ({ ...previous, [id]: details }))}
          onPin={(row, value) => void window.runhuddle.pinSession(row.provider, row.sessionID, value)
            .catch((reason) => setError(String(reason)))}
          onResume={(row) => resumeSession(row.provider, row.sessionID)}
          onReview={(id) => void window.runhuddle.inboxAction(id, "dismiss").catch((reason) => setError(String(reason)))}
        />
        {loaded && showGuide && <GettingStarted onClose={dismissGuide} />}
        {dashboardNotes && <DashboardNotes key={dashboardNotes.folder} folder={dashboardNotes.folder}
          notes={snapshot.notes.filter((note) => !hiddenHistory.projects.includes(note.project))}
          onEdit={setNoteDraft} onClose={() => setDashboardNotes(undefined)}
          onSource={(note) => {
            const row = visibleSessions.find((item) => item.provider === note.sourceProvider && item.sessionID === note.sourceSessionID);
            if (!row) return false;
            setDashboardNotes(undefined);
            runAppCommand({ command: "open-session", session: key(row), notification: true });
            return true;
          }} />}
        {keyboardTool === "command-palette" && <CommandPalette bindings={keyboardBindings}
          projects={projects} sessions={visibleSessions.filter((row) => !row.guardianReview)}
          onClose={() => setKeyboardTool(undefined)} onChoose={runAppCommand} />}
        {keyboardTool === "keyboard-shortcuts" && <KeyboardShortcutSettings bindings={keyboardBindings}
          onSave={(next) => { setKeyboardBindings(next); setKeyboardTool(undefined); }}
          onClose={() => setKeyboardTool(undefined)} />}
        {keyboardTool === "mcp-settings" && <McpSettings onClose={() => setKeyboardTool(undefined)} />}
        {keyboardTool === "quick-terminal" && <QuickTerminal terminal={quickTerminal} cwd={quickDirectory} shortcut={keyboardBindings.terminal}
          connected={connection === "connected"} animate={animateQuickTerminal} onAnimate={setAnimateQuickTerminal}
          onStart={startQuickTerminal} onEnd={endQuickTerminal}
          onClose={() => setKeyboardTool(undefined)} />}
        {appearanceOpen && (
          <TerminalAppearance
            value={appearance}
            onChange={setAppearance}
            onDismiss={() => setAppearanceOpen(false)}
          />
        )}
        {launcher && (
          <LaunchMenu
            cwd={dashboardLaunchScope.length === 1 ? dashboardLaunchScope[0] : ""}
            projects={dashboardLaunchScope.length ? dashboardLaunchScope : projects}
            lastUsed={lastUsed}
            onLaunch={async (agent, folder, name) => {
              const terminal = await create(agent, folder, name);
              setDashboardLaunchTerminal(terminal.id);
              return terminal;
            }}
            onDismiss={() => setLauncher(false)}
          />
        )}
        {renameTarget && <RenameSession key={renameTarget} name={sessionDetails[renameTarget]?.name ?? ""}
          onClose={() => setRenameTarget(undefined)}
          onSave={(name) => { saveSessionName(renameTarget, name); setRenameTarget(undefined); }} />}
        {noteDraft && (
          <NoteEditor initial={noteDraft} projects={projects} sourceTitle={noteSourceTitle}
            onCancel={() => setNoteDraft(undefined)}
            onSaved={(saved) => {
              setSnapshot((old) => ({
                ...old,
                notes: [saved, ...old.notes.filter((item) => item.id !== saved.id)],
              }));
              setNoteDraft(undefined);
            }} />
        )}
          <ScreenshotPopup target={screenshotTarget} blockedReason={screenshotBlocked}
            onAttach={(file) => {
              if (!screenshotDraftID) throw Error("Select an open AI session to attach this screenshot.");
              dashboardDrafts.updateDraft(screenshotDraftID, (draft) => {
                if (draft.files.length >= 8) throw Error("This draft already has 8 screenshots.");
                return { ...draft, files: [...draft.files, file] };
              });
            }} />
      </div>
    </AppearanceContext.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
