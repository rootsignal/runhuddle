/// <reference lib="es2024.collection" />
import { TerminalPermissionObserver, type TerminalPermissionPrompt } from "./TerminalPermission";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { readPosition, savePosition } from "./dashboard-position";
import { ConversationSearch } from "./ConversationSearch";
import { BrowserPreview } from "./BrowserPreview";
import { DashboardShell } from "./DashboardShell";
import { ChangesPanel } from "./ChangesPanel";
import { TerminalPane } from "./Terminal";
import { SessionHistory } from "./SessionHistory";
import { SessionStatus } from "./SessionStatus";
import { ProjectFileDialog } from "./ReplyReferences";
import { CheckoutSummary } from "./CheckoutSummary";
import { AttentionPreview, previewSections, type PreviewSection } from "./AttentionPreview";
import { ProjectSessionReview } from "./ProjectSessionReview";
import { ProjectConversationPreview, RecentConversationDialog } from "./ProjectConversationPreview";
import { ProjectHistoryReview } from "./ProjectHistoryReview";
import { DashboardCleanup, type CleanupSuggestion } from "./DashboardCleanup";
import { emptyDraft, type FollowUpDraft, type useDashboardDrafts } from "./dashboard-drafts";
import logo from "../assets/icon.png";
import { AgentIcon, Icon } from "./Icons";
import type { DashboardRequest, HistorySearchResult, GitTurnSnapshot, InboxEntry, Session, SessionRecap, TerminalInfo, TurnChanges } from "./types";

export type SessionDetails = { name: string; next: string };

const pendingCaptureKey = "dashboardPendingTurnCaptures";
const pendingCaptureLifetime = 12 * 60 * 60 * 1000;
type PendingTurnCapture = {
  cwd: string;
  before: Omit<GitTurnSnapshot, "entries"> & { entries: Pick<GitTurnSnapshot["entries"][number], "file" | "fingerprint">[] };
  at: number;
  instruction: string;
};

const key = ({ provider, sessionID }: Pick<Session, "provider" | "sessionID">) => provider + ":" + sessionID;
const name = (folder: string) => folder.split(/[\\/]/).filter(Boolean).at(-1) || folder;
const isTestFolder = (folder: string) =>
  /^(?:\/private)?\/(?:tmp|var\/folders\/[^/]+\/[^/]+\/T)\/rh-(?:live|alert-smoke)-[^/]+\/scratch\/?$/.test(folder);
const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
function elapsed(time: number, now: number) {
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  if (minutes === 0) return "just now";
  if (minutes < 60) return relativeTime.format(-minutes, "minute");
  if (minutes < 1440) return relativeTime.format(-Math.floor(minutes / 60), "hour");
  return relativeTime.format(-Math.floor(minutes / 1440), "day");
}
const date = (time: number) => new Date(time).toLocaleString([], {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

function WorkingDuration({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const clock = [hours ? String(hours) : "", hours ? String(minutes).padStart(2, "0") : String(minutes),
    String(seconds % 60).padStart(2, "0")].filter(Boolean).join(":");
  return <span className="dashboard-working-duration" role="timer" aria-label="Time working"
    title="Time since RunHuddle detected this work period">{clock}</span>;
}

export function ProjectsDashboard({ keepAwakeActive, open, menuCommand, onProjectContext, paletteShortcut, onCommandPalette, onReopenBrowserSession, folders, sessions, pinned, inbox, recaps, details, submitted, onSubmitted, lockedTerminals, hiddenTabs, connected, followUps, onDraftTerminal, onEvidence, onViewTerminal, onTerminalLock, onHideTab, onEndSession, openedSessions, workspaceLabel, terminals, compactShell, terminalServiceUpdate, launchedTerminal, onLaunchHandled, onOpenShell, onStartDrawerShell, onLaunch, protectedSessions, onCleanup, onRename, onEdit, onPin, onOpen, onResume, onReview, onClose }: {
  open: boolean;
  keepAwakeActive: boolean;
  menuCommand?: DashboardRequest;
  onProjectContext: (folder: string) => void;
  paletteShortcut: string;
  onCommandPalette: () => void;
  onReopenBrowserSession: (id: string) => Promise<void>;
  folders: string[];
  sessions: Session[];
  pinned: string[];
  inbox: InboxEntry[];
  recaps?: Record<string, SessionRecap>;
  details: Record<string, SessionDetails>;
  submitted: Record<string, { text: string; at: number; screenshots?: number }>;
  onSubmitted: (id: string, instruction: { text: string; at: number; screenshots?: number }) => void;
  followUps: ReturnType<typeof useDashboardDrafts>;
  onViewTerminal: (id: string | null) => void;
  onDraftTerminal: (id: string | null) => void;
  lockedTerminals: ReadonlySet<string>;
  hiddenTabs: string[];
  connected: boolean;
  onTerminalLock: (id: string, locked: boolean) => void;
  onHideTab: (id: string) => void;
  onEndSession: (id: string) => Promise<void>;
  openedSessions: Record<string, number>;
  workspaceLabel?: string;
  terminals: TerminalInfo[];
  compactShell: boolean | null;
  terminalServiceUpdate: boolean;
  launchedTerminal?: string;
  onLaunchHandled: () => void;
  onStartDrawerShell: (folder: string, compactPrompt: boolean) => Promise<string>;
  onOpenShell: (folder: string) => Promise<void>;
  onLaunch: (folders: string[]) => void;
  protectedSessions: ReadonlySet<string>;
  onCleanup: (ids: string[], hide: boolean) => Promise<string[]>;
  onRename: (row: Session) => void;
  onEdit: (id: string, details: SessionDetails) => void;
  onPin: (row: Session, value: boolean) => void;
  onOpen: (row: Session | InboxEntry) => void;
  onResume: (row: Session) => Promise<void>;
  onEvidence: (result: HistorySearchResult) => void;
  onReview: (id: string) => void;
  onClose: () => void;
}) {
  const isMac = navigator.platform.toLowerCase().startsWith("mac");
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const scopeControl = useRef<HTMLButtonElement>(null);
  const pickerSearch = useRef<HTMLInputElement>(null);
  const recentControl = useRef<HTMLButtonElement>(null);
  const recentSearch = useRef<HTMLInputElement>(null);
  const recentPosition = useRef<{ scroll: number; session?: string }>({ scroll: 0 });
  const recentList = useRef<HTMLDivElement>(null);
  const handledMenuCommand = useRef<typeof menuCommand>(undefined);
  const picker = useRef<HTMLDivElement>(null);
  const [reviewAgents, setReviewAgents] = useState<string[]>();
  const [reviewAgentError, setReviewAgentError] = useState(false);
  const [preferredReviewAgent, setPreferredReviewAgent] = useState("");
  const [reviewAgentCheck, setReviewAgentCheck] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setPreferredReviewAgent(localStorage.getItem("recapAgent") ?? "");
    setReviewAgentError(false);
    setReviewAgents(undefined);
    void window.runhuddle.installedReviewAgents().then((agents) => {
      if (active) setReviewAgents(agents);
    }, () => {
      if (active) setReviewAgentError(true);
    });
    return () => { active = false; };
  }, [open, reviewAgentCheck]);
  const [terminalHistory, setTerminalHistory] = useState<string>();
  const [projectScope, setProjectScope] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<"Projects" | "Conversations" | "Recent">("Projects");
  const [pendingScope, setPendingScope] = useState<string[]>([]);
  const [pickerQuery, setPickerQuery] = useState("");
  const [expandedPickerProjects, setExpandedPickerProjects] = useState<ReadonlySet<string>>(() => new Set());
  const [projectView, setProjectView] = useState<"Live" | "Pick up" | "History">("Live");
  const [focusSearchOnShow, setFocusSearchOnShow] = useState(false);
  const [focusedPreview, setFocusedPreview] = useState<string>();
  const [query, setQuery] = useState("");
  const [showSavedReviews, setShowSavedReviews] = useState(false);
  const [previewID, setPreviewID] = useState<string>();
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string>();
  const sendingRef = useRef(false);
  const [queuedFollowUps, setQueuedFollowUps] = useState<Record<string, { terminalId: string; draft: FollowUpDraft }>>({});
  function cancelQueuedFollowUp(id: string) {
    setQueuedFollowUps(({ [id]: _removed, ...remaining }) => remaining);
  }
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean; composeId?: string }>();
  type LiveView = "Preview" | "Terminal" | "Changes";
  const [allProjectsPreview, setAllProjectsPreview] = useState(() => readPosition<string | undefined>("dashboardSelectedSession", undefined));
  type InterruptedSession = { session: string; view: LiveView };
  const [allProjectsInterruption, setAllProjectsInterruption] = useState(() =>
    readPosition<InterruptedSession | null>("dashboardInterruptedSession", null));
  const [focusedInterruption, setFocusedInterruption] = useState<InterruptedSession | null>(null);
  const [previousLive, setPreviousLive] = useState<string>();
  const [views, setViews] = useState(() => readPosition<Record<string, LiveView>>("dashboardSessionViews", {}));
  const [reviewFolder, setReviewFolder] = useState("");
  const [hiddenPreviewSections, setHiddenPreviewSections] = useState<Partial<Record<PreviewSection, boolean>>>(() => ({
    changes: true,
    ...readPosition<Partial<Record<PreviewSection, boolean>>>("dashboardHiddenPreviewSections", {}),
  }));
  useEffect(() => { savePosition("dashboardHiddenPreviewSections", hiddenPreviewSections); }, [hiddenPreviewSections]);
  const [collapsedRail, setCollapsedRail] = useState(false);
  const [projectDensity, setProjectDensity] = useState(() =>
    readPosition<string>("dashboardProjectDensity", "") === "compact" ? "compact" : "comfortable");
  useEffect(() => savePosition("dashboardProjectDensity", projectDensity), [projectDensity]);
  const [dismissedResume, setDismissedResume] = useState(() =>
    readPosition<Record<string, string>>("dashboardDismissedResume", {}));
  useEffect(() => savePosition("dashboardDismissedResume", dismissedResume), [dismissedResume]);
  const [mountedViews, setMountedViews] = useState<Record<string, Partial<Record<LiveView, true>>>>({});
  const scopedFolders = projectScope.filter((folder) => folders.includes(folder));
  const hasProjectFilter = scopedFolders.length > 0;
  const focusedFolder = scopedFolders.length === 1 ? scopedFolders[0] : "";
  const [recentQuery, setRecentQuery] = useState("");
  const [recentSelection, setRecentSelection] = useState<string>();
  const [recentHidden, setRecentHidden] = useState<{ id: string; title: string }>();
  const [recentAction, setRecentAction] = useState(false);
  const [recentActionError, setRecentActionError] = useState("");
  const [recentOrigin, setRecentOrigin] = useState<{
    scope: string[]; view: typeof projectView; query: string; scroll: number; history?: string; focused?: string; all?: string;
    interruption: InterruptedSession | null;
  }>();
  const [filePreview, setFilePreview] = useState<{ source: Session; file: string }>();
  async function openBrowserReference(url: string) {
    setBrowserOpen(true);
    await window.runhuddle.navigateBrowser(url);
  }
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserSize, setBrowserSize] = useState(() =>
    Math.max(28, Math.min(65, readPosition("dashboardBrowserSize", 42))));
  const browserSurface = useRef<HTMLDivElement>(null);
  useEffect(() => savePosition("dashboardBrowserSize", browserSize), [browserSize]);
  const [historySelection, setHistorySelection] = useState<string>();
  const [aiReviewFolder, setAiReviewFolder] = useState("");
  const showingLive = !focusedFolder || projectView === "Live";
  const livePreview = hasProjectFilter ? focusedPreview : allProjectsPreview;
  const interrupted = hasProjectFilter ? focusedInterruption : allProjectsInterruption;
  const setInterrupted = hasProjectFilter ? setFocusedInterruption : setAllProjectsInterruption;
  function selectLive(id: string) {
    if (id === livePreview) return;
    setPreviousLive(livePreview);
    if (livePreview && views[livePreview]) {
      const view = views[livePreview];
      setMountedViews((old) => ({ ...old, [livePreview]: { ...old[livePreview], [view]: true } }));
    }
    if (hasProjectFilter) setFocusedPreview(id);
    else {
      setAllProjectsPreview(id);
      savePosition("dashboardSelectedSession", id);
    }
    setConfirmEnd(undefined);
  }
  const [uncommittedFor, setUncommittedFor] = useState<string>();
  function selectView(id: string, view: LiveView, scope?: "working") {
    setUncommittedFor(scope === "working" ? id : undefined);
    setViews((old) => ({ ...old, [id]: view }));
    setMountedViews((old) => ({ ...old, [id]: { ...old[id], [view]: true } }));
  }
  const [confirmEnd, setConfirmEnd] = useState<string>();
  const rowMenu = useRef<HTMLDivElement>(null);
  const [context, setContext] = useState<{ terminalId: string; x: number; y: number }>();
  const [ending, setEnding] = useState<string>();
  const [openingShell, setOpeningShell] = useState(false);
  const [shellError, setShellError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerId, setDrawerId] = useState(() => readPosition("dashboardShellId", "") ||
    Object.values(readPosition<Record<string, string>>("dashboardProjectShells", {})).at(-1) || "");
  const [compactPrompt, setCompactPrompt] = useState(() => readPosition("dashboardCompactPrompt", false));
  const pendingDrawer = useRef(false);
  const [drawerOpening, setDrawerOpening] = useState(false);
  const [drawerError, setDrawerError] = useState("");
  useEffect(() => savePosition("dashboardShellId", drawerId), [drawerId]);
  useEffect(() => savePosition("dashboardCompactPrompt", compactPrompt), [compactPrompt]);
  const drawerTerminal = terminals.find((terminal) => terminal.id === drawerId &&
    terminal.agent === "shell" && !terminal.exited && !terminal.unavailable);
  async function startDrawerShell(folder: string) {
    if (pendingDrawer.current) return;
    pendingDrawer.current = true;
    setDrawerOpening(true);
    setDrawerError("");
    try {
      setDrawerId(await onStartDrawerShell(folder, compactShell === true && compactPrompt));
    } catch (error) {
      setDrawerError((error instanceof Error ? error.message : String(error))
        .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""));
    } finally {
      pendingDrawer.current = false;
      setDrawerOpening(false);
    }
  }
  async function openProjectShell(folder: string) {
    if (openingShell) return;
    setOpeningShell(true);
    setShellError("");
    try {
      await onOpenShell(folder);
    } catch (error) {
      setShellError((error instanceof Error ? error.message : String(error))
        .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""));
    } finally {
      setOpeningShell(false);
    }
  }
  async function sendMessage(id: string, title: string, send: (text: string, files: File[]) => Promise<void | "waiting">, followUpID?: string, queued = false) {
    if (followUpID && !followUps.ready) return;
    const draft = followUpID ? followUps.drafts[followUpID] ?? emptyDraft : { text: replyDrafts[id] ?? "", files: [] };
    const text = draft.text.trim();
    const { files } = draft;
    if ((!text && !files.length) || sendingRef.current) return;
    sendingRef.current = true;
    const at = Date.now();
    setSending(id);
    setFeedback(undefined);
    try {
      if (await send(text, files) === "waiting") return false;
      if (followUpID) {
        onSubmitted(id, { text: text || "Review the attached screenshots.", at, screenshots: files.length });
        followUps.updateDraft(followUpID, (current) => ({
          text: current.text === draft.text ? "" : current.text,
          files: current.files.filter((file) => !files.includes(file)),
        }));
      }
      setFeedback({ composeId: id, message: !followUpID
        ? `Reply to ${title} copied. Open the session to submit it.`
        : `Follow-up sent to ${title}.` });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback({ composeId: id, message: (queued ? `Queued follow-up to ${title} couldn’t send. Your draft is ready to review. ` : "") + message.replace(/^Error invoking remote method '[^']+': Error: /, ""), error: true });
      return true;
    } finally {
      sendingRef.current = false;
      setSending(undefined);
    }
  }
  const [editing, setEditing] = useState<string>();
  useLayoutEffect(() => {
    if (!open) return;
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, [open]);
  useLayoutEffect(() => {
    if (!open) { setPickerOpen(false); setRecentSelection(undefined); }
    if (!pickerOpen || !open) return;
    if (pickerMode === "Recent") {
      const { scroll, session } = recentPosition.current;
      const list = recentList.current;
      const row = list?.querySelector<HTMLButtonElement>(`[data-recent-session="${CSS.escape(session ?? "")}"]`);
      (row ?? recentSearch.current)?.focus({ preventScroll: true });
      if (list) list.scrollTop = scroll;
    }
    else (pickerMode === "Projects" ? pickerSearch : searchInput).current?.focus();
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !picker.current?.contains(event.target)) setPickerOpen(false);
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [pickerOpen, pickerMode, open]);
  useLayoutEffect(() => {
    if (!open || showingLive || !focusSearchOnShow) return;
    searchInput.current?.focus();
    searchInput.current?.select();
    setFocusSearchOnShow(false);
  }, [open, showingLive, focusSearchOnShow]);

  const [permissions, setPermissions] = useState<Partial<Record<string, TerminalPermissionPrompt & { detectedAt: number }>>>({});
  const onPermission = useCallback((id: string, prompt?: TerminalPermissionPrompt) => {
    setPermissions((previous) => {
      const old = previous[id];
      if (old?.question === prompt?.question && old?.choices.join("\n") === prompt?.choices.join("\n")) return previous;
      const next = { ...previous };
      if (prompt) next[id] = { ...prompt, detectedAt: old?.detectedAt ?? Date.now() };
      else delete next[id];
      return next;
    });
  }, []);
  const [workingTerminals, setWorkingTerminals] = useState<ReadonlySet<string>>(() => new Set());
  const onTerminalWorking = useCallback((id: string, working: boolean) => {
    setWorkingTerminals((previous) => {
      if (previous.has(id) === working) return previous;
      const next = new Set(previous);
      if (working) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const [readyCodexTerminal, setReadyCodexTerminal] = useState<string>();
  function liveState(row: Session) {
    const id = row.terminalId!;
    if (permissions[id]) return "needsInput";
    if (lockedTerminals.has(id)) return "locked";
    if (workingTerminals.has(id) && row.state !== "needsInput") return "working";
    return row.state === "disconnected" && readyCodexTerminal === id ? "idle" : row.state;
  }
  const byFolder = Map.groupBy(sessions, (row) => row.cwd);
  const byKey = new Map(sessions.map((row) => [key(row), row]));
  const pins = new Set(pinned);
  const testFolders = new Set(folders.filter(isTestFolder));
  const terminalAlerts: InboxEntry[] = sessions.flatMap((row) => {
    const permission = row.terminalId ? permissions[row.terminalId] : undefined;
    if (!permission) return [];
    const id = "terminal-permission:" + row.terminalId;
    return [{ id, kind: "input", provider: row.provider, sessionID: row.sessionID, body: row.title, createdAt: permission.detectedAt }];
  });
  const permissionKeys = new Set(terminalAlerts.map(key));
  const allAlerts = [...terminalAlerts, ...inbox.filter((entry) => !permissionKeys.has(key(entry)))].filter((entry) => {
    const row = byKey.get(key(entry));
    return !row || !testFolders.has(row.cwd);
  });
  const alertsByFolder = Map.groupBy(allAlerts, (row) => byKey.get(key(row))?.cwd);
  const inScope = (folder: string) => !hasProjectFilter || scopedFolders.includes(folder);
  const alerts = hasProjectFilter ? allAlerts.filter((entry) => inScope(byKey.get(key(entry))?.cwd ?? "")) : allAlerts;
  const allWorkSessions = sessions.filter((row) => !testFolders.has(row.cwd));
  const workSessions = allWorkSessions.filter((row) => inScope(row.cwd));
  const allLiveSessions = allWorkSessions.filter((row) => row.terminalId)
    .sort((a, b) => a.cwd.localeCompare(b.cwd) || key(a).localeCompare(key(b)));
  const liveSessions = allLiveSessions.filter((row) => inScope(row.cwd));
  const inputIDsForQueue = new Set(allAlerts.filter((entry) => entry.kind === "input").map(key));
  const [initialPendingCaptures] = useState(() => {
    const saved = readPosition<[string, PendingTurnCapture][]>(pendingCaptureKey, []);
    return new Map(Array.isArray(saved) ? saved.filter((entry) =>
      Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1]?.cwd === "string" &&
      typeof entry[1]?.instruction === "string" && Array.isArray(entry[1]?.before?.entries) &&
      Number.isFinite(entry[1].at) && Date.now() - entry[1].at <= pendingCaptureLifetime) : []);
  });
  const pendingTurnChanges = useRef(initialPendingCaptures);
  function savePendingTurnChanges() {
    savePosition(pendingCaptureKey, [...pendingTurnChanges.current].slice(-16));
  }
  function clearPendingTurnChange(id: string) {
    if (pendingTurnChanges.current.delete(id)) savePendingTurnChanges();
  }
  const [turnChanges, setTurnChanges] = useState<Record<string, TurnChanges[]>>({});
  useEffect(() => {
    let active = true;
    void window.runhuddle.gitTurnCaptures().then((saved) => {
      if (active) setTurnChanges((current) => ({ ...saved, ...current }));
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  const [monitorTurnChanges, setMonitorTurnChanges] = useState(initialPendingCaptures.size > 0);
  function submitLiveFollowUp(row: Session, queued = false) {
    const id = key(row);
    return sendMessage("live:" + row.terminalId, details[id]?.name || row.title, async (text, files) => {
      const images = await Promise.all(files.map((file) => file.arrayBuffer()));
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const before = await Promise.race([
        window.runhuddle.gitTurnSnapshot(row.cwd).catch(() => undefined),
        new Promise<undefined>((resolve) => { timeout = setTimeout(resolve, 1200); }),
      ]).finally(() => clearTimeout(timeout));
      const at = Date.now();
      const result = await window.runhuddle.liveSessionFollowUp(row.provider, row.sessionID, row.terminalId!, text, images, queued);
      if (result !== "waiting") {
        pendingTurnChanges.current.delete(id);
        if (before) {
          const instruction = text.length > 240 ? text.slice(0, 239).trimEnd() + "…" : text;
          pendingTurnChanges.current.set(id, {
            cwd: row.cwd, at, instruction,
            before: { ...before, entries: before.entries.map(({ file, fingerprint }) => ({ file, fingerprint })) },
          });
          setMonitorTurnChanges(true);
        }
        savePendingTurnChanges();
      }
      return result;
    }, id, queued);
  }
  const observedTurns = useRef({ allLiveSessions, liveState });
  observedTurns.current = { allLiveSessions, liveState };
  useEffect(() => {
    if (!monitorTurnChanges) return;
    let active = true;
    let checking = false;
    async function check() {
      if (checking) return;
      checking = true;
      try {
        for (const [id, pending] of pendingTurnChanges.current) {
          const current = observedTurns.current;
          const row = current.allLiveSessions.find((item) => key(item) === id && item.cwd === pending.cwd);
          if (Date.now() - pending.at > pendingCaptureLifetime) {
            clearPendingTurnChange(id);
            continue;
          }
          if (!row?.terminalId || current.liveState(row) !== "idle") continue;
          const terminalId = row.terminalId;
          const turn = await window.runhuddle.liveSessionPreview(row.provider, row.sessionID, terminalId).catch(() => undefined);
          if (!active || pendingTurnChanges.current.get(id) !== pending) continue;
          if (!turn?.instructionAt || turn.instructionAt < pending.at || !turn.answer) continue;
          if (pending.instruction ? turn.instruction !== pending.instruction : !turn.screenshots) {
            clearPendingTurnChange(id);
            continue;
          }
          const after = await window.runhuddle.gitTurnSnapshot(row.cwd).catch(() => undefined);
          if (!active || pendingTurnChanges.current.get(id) !== pending) continue;
          if (!after || after.root !== pending.before.root || after.branch !== pending.before.branch) {
            clearPendingTurnChange(id);
            continue;
          }
          const from = pending.before.head;
          const to = after.head;
          const committed = from !== to
            ? await window.runhuddle.gitTurnCommittedDiffs(after.root, from, to).catch(() => undefined)
            : undefined;
          if (!active || pendingTurnChanges.current.get(id) !== pending) continue;
          const latest = observedTurns.current;
          const latestRow = latest.allLiveSessions.find((item) => item.terminalId === terminalId);
          if (!latestRow || latest.liveState(latestRow) !== "idle") continue;
          if (from !== to && !committed) {
            clearPendingTurnChange(id);
            continue;
          }
          const before = new Map(pending.before.entries.map((entry) => [JSON.stringify([entry.file.path, entry.file.area]), entry.fingerprint]));
          const uncommitted = [...new Map(after.entries.filter((entry) =>
            before.get(JSON.stringify([entry.file.path, entry.file.area])) !== entry.fingerprint)
            .map(({ file, diff }) => [file.path, { file, diff }])).values()];
          const files = [...(committed?.entries ?? []), ...uncommitted];
          if (!files.length) {
            clearPendingTurnChange(id);
            continue;
          }
          const capture = { instructionAt: turn.instructionAt, root: after.root, files,
            commitRange: committed ? { from, to, omitted: committed.omitted } : undefined };
          try {
            const saved = await window.runhuddle.saveGitTurnCapture(id, capture);
            if (active) setTurnChanges(saved);
          } catch {
            if (active) setTurnChanges((previous) => ({ ...previous, [id]: [
              capture, ...(previous[id] ?? []).filter((item) => item.instructionAt !== capture.instructionAt),
            ].slice(0, 5) }));
          }
          if (active && pendingTurnChanges.current.get(id) === pending) clearPendingTurnChange(id);
        }
      } finally {
        checking = false;
        if (active && !pendingTurnChanges.current.size) setMonitorTurnChanges(false);
      }
    }
    void check();
    const timer = setInterval(() => void check(), 1200);
    return () => { active = false; clearInterval(timer); };
  }, [monitorTurnChanges]);
  const queueCheck = useRef(false);
  const queueSnapshot = useRef({
    queuedFollowUps, drafts: followUps.drafts, allLiveSessions, connected, ready: followUps.ready, liveState, inputIDsForQueue, submitLiveFollowUp,
  });
  queueSnapshot.current = {
    queuedFollowUps, drafts: followUps.drafts, allLiveSessions, connected, ready: followUps.ready, liveState, inputIDsForQueue, submitLiveFollowUp,
  };
  const hasQueuedFollowUps = Object.keys(queuedFollowUps).length > 0;
  useEffect(() => {
    if (!hasQueuedFollowUps || !connected || !followUps.ready) return;
    function available(id: string, terminalId: string) {
      const snapshot = queueSnapshot.current;
      if (!snapshot.connected || !snapshot.ready || sendingRef.current || snapshot.inputIDsForQueue.has(id)) return;
      const row = snapshot.allLiveSessions.find((item) => key(item) === id && item.terminalId === terminalId);
      if (!row || !["idle", "disconnected"].includes(row.state) ||
          !["idle", "disconnected"].includes(snapshot.liveState(row))) return;
      return row;
    }
    async function check() {
      if (queueCheck.current || sendingRef.current) return;
      queueCheck.current = true;
      try {
        const snapshot = queueSnapshot.current;
        for (const [id, job] of Object.entries(snapshot.queuedFollowUps)) {
          const { terminalId, draft } = job;
          if (!snapshot.allLiveSessions.some((item) => key(item) === id && item.terminalId === terminalId) ||
              draft !== snapshot.drafts[id]) {
            cancelQueuedFollowUp(id);
            continue;
          }
          const row = available(id, terminalId);
          if (!row || !await window.runhuddle.codexPromptReady(row.sessionID, terminalId, true).catch(() => false)) continue;
          const latest = queueSnapshot.current;
          const current = available(id, terminalId);
          if (!current || latest.queuedFollowUps[id] !== job || latest.drafts[id] !== draft) continue;
          if (await latest.submitLiveFollowUp(current, true)) cancelQueuedFollowUp(id);
          break;
        }
      } finally {
        queueCheck.current = false;
      }
    }
    void check();
    const timer = setInterval(() => void check(), 1000);
    return () => clearInterval(timer);
  }, [hasQueuedFollowUps, connected, followUps.ready]);

  const [workingSince, setWorkingSince] = useState<ReadonlyMap<string, number>>(() => new Map());
  useLayoutEffect(() => {
    const ids = allLiveSessions.filter((row) => liveState(row) === "working").map((row) => row.terminalId!);
    if (ids.length === workingSince.size && ids.every((id) => workingSince.has(id))) return;
    const now = Date.now();
    setWorkingSince(new Map(ids.map((id) => [id, workingSince.get(id) ?? now])));
  });
  const contextSession = open && showingLive ? liveSessions.find((row) => row.terminalId === context?.terminalId) : undefined;
  useLayoutEffect(() => {
    const menu = rowMenu.current;
    if (!context || !contextSession || !menu) return;
    if (!menu.matches(":popover-open")) {
      menu.showPopover();
      menu.querySelector("button")?.focus({ preventScroll: true });
    }
    menu.style.left = `${Math.max(6, Math.min(context.x, innerWidth - menu.offsetWidth - 6))}px`;
    menu.style.top = `${Math.max(6, Math.min(context.y, innerHeight - menu.offsetHeight - 6))}px`;
  }, [context, contextSession?.terminalId, confirmEnd]);

  useEffect(() => {
    if (!open || !launchedTerminal) return;
    const row = allLiveSessions.find((session) => session.terminalId === launchedTerminal);
    if (!row) return;
    const id = key(row);
    if (hasProjectFilter && scopedFolders.includes(row.cwd)) setFocusedPreview(id);
    else {
      setProjectScope([]);
      setAllProjectsPreview(id);
      savePosition("dashboardSelectedSession", id);
    }
    setProjectView("Live");
    setQuery("");
    setViews((old) => ({ ...old, [id]: "Preview" }));
    dialog.current?.scrollTo({ top: 0 });
    onLaunchHandled();
  }, [open, launchedTerminal, allLiveSessions, hasProjectFilter, scopedFolders, onLaunchHandled]);
  const outsideInputCount = hasProjectFilter ? new Set([
    ...allAlerts.filter((entry) => entry.kind === "input" && !inScope(byKey.get(key(entry))?.cwd ?? "")).map(key),
    ...allLiveSessions.filter((row) => !inScope(row.cwd) && liveState(row) === "needsInput").map(key),
  ]).size : 0;
  function showProjects(folders: string[], view?: typeof projectView) {
    if (folders.length) {
      const rows = allLiveSessions.filter((row) => folders.includes(row.cwd));
      const row = rows.find((row) => key(row) === livePreview) ?? rows[0];
      setFocusedPreview(row ? key(row) : undefined);
      if (activeLive && views[key(activeLive)]) {
        const session = key(activeLive);
        setMountedViews((old) => ({ ...old, [session]: { ...old[session], [views[session]]: true } }));
      }
    }
    setFocusedInterruption(null);
    setProjectScope(folders);
    setPickerOpen(false);
    setProjectView(view ?? (folders.length === 1 ? "Pick up" : "Live"));
    setHistorySelection(undefined);
    setQuery("");
    dialog.current?.scrollTo({ top: 0 });
    scopeControl.current?.focus();
  }
  const singleLive = liveSessions.length === 1 ? liveSessions[0] : undefined;
  const activeLive = singleLive ?? liveSessions.find((row) => key(row) === livePreview);
  const hideRail = !!singleLive || (collapsedRail && !!activeLive);
  const activeFolder = activeLive?.cwd;
  useLayoutEffect(() => {
    onProjectContext(open ? (activeFolder || focusedFolder) : "");
  }, [activeFolder, focusedFolder, open, onProjectContext]);
  const pendingCodex = open && connected && showingLive && activeLive?.provider === "Codex" &&
    activeLive.state === "disconnected" ? activeLive : undefined;
  const pendingSessionId = pendingCodex?.sessionID;
  const pendingTerminalId = pendingCodex?.terminalId;
  useEffect(() => {
    setReadyCodexTerminal(undefined);
    if (!pendingSessionId || !pendingTerminalId) return;
    let disposed = false;
    let running = false;
    async function refresh() {
      if (running) return;
      running = true;
      try {
        const ready = await window.runhuddle.codexPromptReady(pendingSessionId!, pendingTerminalId!);
        if (!disposed) setReadyCodexTerminal(ready ? pendingTerminalId : undefined);
      } catch {
        if (!disposed) setReadyCodexTerminal(undefined);
      } finally {
        running = false;
      }
    }
    void refresh();
    const timer = setInterval(refresh, 1500);
    return () => { disposed = true; clearInterval(timer); };
  }, [pendingSessionId, pendingTerminalId]);

  const drawerVisible = open && showingLive && !!activeFolder && drawerOpen;
  const singleLiveID = singleLive && key(singleLive);
  useEffect(() => {
    if (!singleLiveID) return;
    if (hasProjectFilter) setFocusedPreview(singleLiveID);
    else {
      setAllProjectsPreview(singleLiveID);
      savePosition("dashboardSelectedSession", singleLiveID);
    }
  }, [singleLiveID, hasProjectFilter]);
  const returnSession = interrupted && liveSessions.find((row) => key(row) === interrupted.session);
  const returnTitle = returnSession && (details[key(returnSession)]?.name || returnSession.title);
  useEffect(() => savePosition("dashboardSessionViews", views), [views]);
  useEffect(() => savePosition("dashboardInterruptedSession", allProjectsInterruption), [allProjectsInterruption]);
  useEffect(() => {
    if (interrupted && livePreview === interrupted.session && (views[livePreview] ?? "Preview") === interrupted.view)
      setInterrupted(null);
  }, [interrupted, livePreview, views, setInterrupted]);
  function returnToSession() {
    if (!interrupted || !returnSession) return;
    selectLive(interrupted.session);
    selectView(interrupted.session, interrupted.view);
    setInterrupted(null);
  }
  const draftTerminal = open && connected && showingLive ? activeLive?.terminalId ?? null : null;
  const viewedTerminal = draftTerminal && activeLive && views[key(activeLive)] === "Terminal" &&
    draftTerminal !== terminalHistory ? draftTerminal : null;
  useLayoutEffect(() => {
    onDraftTerminal(draftTerminal);
    onViewTerminal(viewedTerminal);
    return () => { onDraftTerminal(null); onViewTerminal(null); };
  }, [draftTerminal, viewedTerminal, onDraftTerminal, onViewTerminal]);
  const browserVisible = open && showingLive && browserOpen;
  const browserTerminal = terminals.find((terminal) => terminal.id === draftTerminal && !terminal.exited);
  const browserTarget = activeLive && browserTerminal ? {
    id: browserTerminal.id, title: details[key(activeLive)]?.name || activeLive.title,
    browserTools: browserTerminal.browserTools, canResume: !!browserTerminal.sessionID,
    locked: lockedTerminals.has(browserTerminal.id), busy: liveState(activeLive) !== "idle",
  } : undefined;
  const today = new Date();
  const conversationSessions = workSessions.filter((row) => !row.guardianReview);
  const allProjects = folders.filter((folder) => !testFolders.has(folder)).map((folder) => {
    const rows = (byFolder.get(folder) ?? []).sort((a, b) => b.updated - a.updated);
    return {
      folder, rows,
      followed: rows.filter((row) => pins.has(key(row))),
      attention: alertsByFolder.get(folder) ?? [],
      working: rows.filter((row) => row.terminalId && liveState(row) === "working"),
    };
  }).sort((a, b) =>
    Number(!!b.attention.length) - Number(!!a.attention.length) ||
    Number(!!b.followed.length) - Number(!!a.followed.length) ||
    (b.rows[0]?.updated ?? 0) - (a.rows[0]?.updated ?? 0) ||
    name(a.folder).localeCompare(name(b.folder)),
  );
  const projects = allProjects.filter(({ folder }) => inScope(folder));
  const pickerProjects = allProjects.filter(({ folder }) => folder.toLowerCase().includes(pickerQuery.trim().toLowerCase()));
  const scopeLabel = focusedFolder ? name(focusedFolder) : hasProjectFilter ? `${scopedFolders.length} projects` : "All projects";
  const tests = sessions.filter((row) => inScope(row.cwd) && testFolders.has(row.cwd)).sort((a, b) => b.updated - a.updated);

  const attentionIDs = new Set(alerts.map(key));
  const inputIDs = new Set(alerts.filter((entry) => entry.kind === "input").map(key));
  const reviewIDs = new Set(alerts.filter((entry) => entry.kind === "completion").map(key));
  const liveAttention = liveSessions.filter((row) => inputIDs.has(key(row)) || row.state === "needsInput")
    .sort((a, b) => Number(Boolean(permissions[b.terminalId!])) - Number(Boolean(permissions[a.terminalId!])));
  const liveReviews = liveSessions.filter((row) => reviewIDs.has(key(row)) && liveState(row) !== "working" && !liveAttention.includes(row));
  const savedReviews = alerts.filter((entry) => entry.kind === "completion" && !byKey.get(key(entry))?.terminalId);
  const reviewsOnly = !focusedFolder && !liveSessions.length && savedReviews.length > 0;
  const showLivePanel = showingLive && (Boolean(focusedFolder) || liveSessions.length > 0 || reviewsOnly || browserOpen);
  const liveFirst = showingLive && (liveSessions.length > 0 || browserOpen);
  useLayoutEffect(() => {
    if (!open) return;
    function focusSearch(event: KeyboardEvent) {
      if (!(isMac ? event.metaKey : event.ctrlKey) || event.key.toLowerCase() !== "k" || event.altKey) return;
      const activeDialog = document.activeElement?.closest("dialog");
      if (activeDialog && activeDialog !== dialog.current) return;
      event.preventDefault();
      if (liveFirst) {
        if (!pickerOpen) setPendingScope(scopedFolders);
        setPickerMode("Conversations");
        setPickerOpen(true);
        searchInput.current?.focus();
        searchInput.current?.select();
      } else if (searchInput.current?.closest("[hidden]")) {
        setProjectView("History");
        setFocusSearchOnShow(true);
      } else {
        searchInput.current?.focus();
        searchInput.current?.select();
      }
    }
    document.addEventListener("keydown", focusSearch);
    return () => {
      document.removeEventListener("keydown", focusSearch);
    };
  }, [isMac, open, liveFirst, pickerOpen, scopedFolders]);
  function nextInQueue(queue: Session[]) {
    const index = queue.findIndex((row) => row === activeLive);
    return queue.length ? queue[(index + 1) % queue.length] : undefined;
  }
  const nextAttention = nextInQueue(liveAttention);
  const nextReview = nextInQueue(liveReviews);
  function showLiveAttention(row: Session, remember = true) {
    const id = key(row);
    const view = permissions[row.terminalId!] ? "Terminal" : "Preview";
    if (activeLive && id !== key(activeLive)) {
      setCollapsedRail(false);
    }
    if (remember && activeLive && !returnSession && (id !== livePreview || view !== (views[id] ?? "Preview"))) {
      const session = key(activeLive);
      setInterrupted({ session, view: views[session] ?? "Preview" });
    }
    selectLive(id);
    if (view === "Terminal") setTerminalHistory(undefined);
    selectView(id, view);
    document.getElementById("dashboard-live-panel")?.scrollIntoView({ block: "nearest" });
  }
  function openPicker(mode: "Projects" | "Recent") {
    if (mode === "Recent") {
      setRecentOrigin(undefined);
      setRecentQuery("");
      recentPosition.current = { scroll: 0 };
    }
    setPendingScope(scopedFolders);
    setPickerQuery("");
    setPickerMode(mode);
    setPickerOpen(true);
  }
  function advanceReview() {
    if (!nextReview?.terminalId) return;
    setProjectView("Live");
    showLiveAttention(nextReview, false);
    const review = alerts.find((entry) => entry.kind === "completion" && key(entry) === key(nextReview));
    if (review) onReview(review.id);
  }
  function advanceAttention() {
    if (!nextAttention?.terminalId) return;
    setProjectView("Live");
    showLiveAttention(nextAttention);
  }
  function returnFromAttention() {
    if (returnSession) {
      setProjectView("Live");
      returnToSession();
    } else if (previousLive && liveSessions.some((row) => key(row) === previousLive)) {
      setProjectView("Live");
      selectLive(previousLive);
    }
  }
  useEffect(() => {
    if (!open || !menuCommand || handledMenuCommand.current === menuCommand) return;
    handledMenuCommand.current = menuCommand;
    switch (menuCommand.command) {
      case "new-session": setPickerOpen(false); onLaunch(scopedFolders); break;
      case "projects": openPicker("Projects"); break;
      case "open-project": showProjects([menuCommand.folder], "Pick up"); break;
      case "open-session": {
        const row = byKey.get(menuCommand.session);
        if (!row) break;
        if (row.terminalId) void openRecentSession(row);
        else {
          recentPosition.current = { scroll: 0 };
          setRecentQuery("");
          previewRecentSession(row);
        }
        break;
      }
      case "recent": openPicker("Recent"); break;
      case "open-browser":
        setPickerOpen(false);
        setProjectView("Live");
        setBrowserOpen(true);
        break;
      case "next-review": setPickerOpen(false); advanceReview(); break;
      case "next-attention": setPickerOpen(false); advanceAttention(); break;
      case "return-session": setPickerOpen(false); returnFromAttention(); break;
    }
  });
  function railStatus(row: Session) {
    const id = row.terminalId!;
    if (permissions[id]) return "permission";
    const state = liveState(row);
    if (state === "disconnected") return "unknownActivity";
    return state === "idle" && reviewIDs.has(key(row)) ? "review" : state;
  }
  const workingCount = liveSessions.filter((row) => railStatus(row) === "working").length;
  const candidates = sessions.filter((row) => {
    if (!inScope(row.cwd)) return false;
    const id = key(row);
    return !row.terminalId && ["saved", "idle", "ended"].includes(row.state) &&
      !pins.has(id) && !attentionIDs.has(id) && !protectedSessions.has(id) &&
      !details[id]?.name && !details[id]?.next;
  }).sort((a, b) => a.updated - b.updated);
  const secondsPerDay = 86400;
  const now = +today / 1000;
  const greeting = /^(?:hi|hello|hey|test|testing|ping)[.!?]*$/i;
  const guardianReason = "Codex creates these threads when its automatic reviewer checks an action that needs approval.";
  const guardian: CleanupSuggestion = {
    id: "guardian", label: "Codex Guardian reviews",
    reason: guardianReason + " Saved reviews inactive for at least 7 days can be hidden to make your project conversations easier to find.",
    sessions: [],
  };
  const testRuns: CleanupSuggestion = { id: "tests", label: "RunHuddle test sessions", reason: "Saved conversations in known RunHuddle test folders.", sessions: [] };
  const greetings: CleanupSuggestion = { id: "greetings", label: "Old greetings and test prompts", reason: "A short greeting or test title, with no other preview, last updated at least 30 days ago.", sessions: [] };
  const stale: CleanupSuggestion = { id: "stale", label: "Inactive history", reason: "Last updated at least 90 days ago.", sessions: [] };
  const cleanup = [guardian, testRuns, greetings, stale];
  const resumeVersion = (id: string) => JSON.stringify([openedSessions[id] ?? 0, details[id]?.next ?? ""]);
  const resume = conversationSessions.filter((row) => {
    const id = key(row);
    return !row.terminalId && !attentionIDs.has(id) && (openedSessions[id] || details[id]?.next) &&
      dismissedResume[id] !== resumeVersion(id);
  })
    .sort((a, b) => (openedSessions[key(b)] ?? 0) - (openedSessions[key(a)] ?? 0) || b.updated - a.updated)
    .slice(0, 4);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (...fields: string[]) => {
    const haystack = fields.join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  };
  const matchedProjects = !focusedFolder && terms.length ? projects.filter(({ folder }) => matches(folder)).slice(0, 4) : [];
  const savedConversations = focusedFolder
    ? conversationSessions.filter((row) => !row.terminalId).sort((a, b) =>
      Number(pins.has(key(b))) - Number(pins.has(key(a))) || b.updated - a.updated)
    : [];
  const guardianConversations = focusedFolder ? workSessions.filter((row) => row.guardianReview && !row.terminalId) : [];
  const selectedConversation = savedConversations.find((row) => key(row) === historySelection);
  const checkpoints = savedConversations.filter((row) => details[key(row)]?.next?.trim());
  const recentConversations = [...savedConversations].sort((a, b) => b.updated - a.updated).slice(0, 4);
  function openConversationPreview(row: Session) {
    setHistorySelection(key(row));
    setProjectView("History");
  }
  const matchedSessions = terms.length ? (focusedFolder ? savedConversations : conversationSessions)
    .filter((row) => matches(row.title, row.cwd, row.provider, details[key(row)]?.name ?? "", details[key(row)]?.next ?? ""))
    .sort((a, b) => (openedSessions[key(b)] ?? 0) - (openedSessions[key(a)] ?? 0) || b.updated - a.updated).slice(0, 8) : [];
  for (const row of candidates) {
    const age = row.updated > 0 ? (now - row.updated) / secondsPerDay : 0;
    const suggestion = row.guardianReview ? (age >= 7 ? guardian : undefined)
      : testFolders.has(row.cwd) ? testRuns
      : age >= 30 && greeting.test(row.title.trim()) && (!row.preview.trim() || greeting.test(row.preview.trim())) ? greetings
      : age >= 90 ? stale
      : undefined;
    suggestion?.sessions.push({ id: key(row), title: row.title, row });
  }

  function sessionRow(row: Session, preview = false) {
    const id = key(row);
    const info = details[id];
    const title = info?.name || row.title;
    const followed = pins.has(id);
    return (
      <div key={id} className="dashboard-session">
        <div className="dashboard-session-line">
          <button className="dashboard-open" onClick={() => preview ? openConversationPreview(row) : onOpen(row)}
            aria-pressed={preview ? historySelection === id : undefined} aria-label={`${preview ? "Preview" : "Open"} ${title}`} title={title}>
            <AgentIcon agent={row.provider.toLowerCase()} />
            <span><strong>{title}</strong><small>{row.provider}
              {row.state === "working" && " · In progress"}
              {row.state === "needsInput" && " · Needs input"}
              {row.updated > 0 && ` · ${date(row.updated * 1000)}`}
            </small></span>
          </button>
          <button className="dashboard-session-more" aria-label={`Actions for ${title}`} title="Conversation actions"
            popoverTarget={`conversation-actions-${id}`}><Icon name="more" size={16} /></button>
          <div className="dashboard-session-popover" id={`conversation-actions-${id}`} popover="auto" aria-label={`Actions for ${title}`}>
            <button aria-label={`Rename ${title}`} onClick={(event) => {
              event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
              onRename(row);
            }}>Rename…</button>
            {followed && <button aria-label={`Edit details for ${title}`} onClick={(event) => {
              event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
              setEditing(editing === id ? undefined : id);
            }}>Edit next step…</button>}
            <button aria-label={`${followed ? "Unpin" : "Pin"} ${title}`} onClick={(event) => {
              event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
              onPin(row, !followed);
            }}>{followed ? "Unpin" : "Pin"}</button>
          </div>
        </div>
        {info?.next && <p className="dashboard-next"><small>Next step</small>{info.next}</p>}
        {followed && editing === id && (
          <form onSubmit={(event) => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget);
            onEdit(id, { name: String(fields.get("name")).trim(), next: String(fields.get("next")).trim() });
            setEditing(undefined);
          }}>
            <label>Session name<input name="name" defaultValue={info?.name} maxLength={100} /></label>
            <label>Next step<textarea name="next" defaultValue={info?.next} maxLength={300} /></label>
            <button type="submit" className="primary">Save details</button>
            <button type="button" onClick={() => setEditing(undefined)}>Cancel</button>
          </form>
        )}
      </div>
    );
  }

  function sessionActions(row: Session, fromRecent = false) {
    const terminalId = row.terminalId!;
    const id = "live:" + terminalId;
    const title = details[key(row)]?.name || row.title;
    const review = alerts.find((entry) => entry.kind === "completion" && key(entry) === key(row));
    const canEnd = liveState(row) === "idle" && row.state === "idle";
    function act(event: React.MouseEvent<HTMLButtonElement>, action: () => void) {
      event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
      action();
    }
    if (canEnd && confirmEnd === id) return <>
      {fromRecent && <p className="dashboard-preview-menu-note">Stop this terminal and keep its conversation?</p>}
      <button disabled={!!sending || !!ending} onClick={(event) => {
        const menu = event.currentTarget.closest<HTMLElement>("[popover]");
        setEnding(id);
        if (fromRecent) setRecentActionError("");
        void onEndSession(terminalId).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          if (fromRecent) setRecentActionError(message);
          else setFeedback({ error: true, message });
        }).finally(() => {
          menu?.hidePopover();
          setEnding(undefined);
          setConfirmEnd(undefined);
        });
      }}>{fromRecent && <Icon name="stop" size={15} />} End {title}</button>
      <button autoFocus onClick={() => setConfirmEnd(undefined)}>Cancel</button>
    </>;
    if (fromRecent) return <>
      {!hiddenTabs.includes(terminalId) && <button onClick={(event) => act(event, () => onHideTab(terminalId))}>
        <Icon name="sidebar" size={15} /> Hide workspace tab
      </button>}
      {canEnd ? <button className="dashboard-preview-end" onClick={() => setConfirmEnd(id)}>
        <Icon name="stop" size={15} /> End session…
      </button> : <p className="dashboard-preview-menu-note">End session is available when the agent is idle.</p>}
    </>;
    return <>
      <button onClick={(event) => act(event, () => onRename(row))}>Rename session…</button>
      {review && liveState(row) !== "working" && <button onClick={(event) => act(event, () => onReview(review.id))}>Mark reviewed</button>}
      {!hiddenTabs.includes(terminalId) && <button onClick={(event) => act(event, () => onHideTab(terminalId))}>Hide tab (keep running)</button>}
      {canEnd && <button onClick={() => setConfirmEnd(id)}>End session…</button>}
    </>;
  }
  function openPickerSession(row: Session) {
    const id = key(row);
    if (row.terminalId) {
      showProjects([row.cwd], "Live");
      setFocusedPreview(id);
      if (permissions[row.terminalId]) selectView(id, "Terminal");
    } else {
      showProjects([row.cwd], "History");
      setHistorySelection(id);
    }
  }
  function previewRecentSession(row: Session) {
    recentPosition.current = { scroll: recentList.current?.scrollTop ?? 0, session: key(row) };
    setPickerOpen(false);
    setRecentActionError("");
    setRecentSelection(key(row));
  }
  function closeRecentPreview(back: boolean) {
    setRecentSelection(undefined);
    if (back) {
      setPickerMode("Recent");
      setPickerOpen(true);
    } else {
      requestAnimationFrame(() => recentControl.current?.focus({ preventScroll: true }));
    }
  }
  function rememberRecentOrigin() {
    setRecentOrigin({ scope: projectScope, view: projectView, query, scroll: dialog.current?.scrollTop ?? 0, history: historySelection,
      focused: focusedPreview, all: allProjectsPreview, interruption: focusedInterruption });
  }
  function returnToRecentOrigin() {
    if (!recentOrigin) return;
    setProjectScope(recentOrigin.scope);
    setProjectView(recentOrigin.view);
    setQuery(recentOrigin.query);
    setHistorySelection(recentOrigin.history);
    setFocusedPreview(recentOrigin.focused);
    setAllProjectsPreview(recentOrigin.all);
    savePosition("dashboardSelectedSession", recentOrigin.all);
    setFocusedInterruption(recentOrigin.interruption);
    setRecentOrigin(undefined);
    setPickerMode("Recent");
    setPickerOpen(true);
    requestAnimationFrame(() => dialog.current?.scrollTo({ top: recentOrigin.scroll }));
  }
  async function openRecentSession(row: Session) {
    const terminalId = row.terminalId;
    if (terminalId) {
      rememberRecentOrigin();
      if (!inScope(row.cwd)) {
        showProjects([], "Live");
        setAllProjectsPreview(key(row));
        savePosition("dashboardSelectedSession", key(row));
      } else {
        setProjectView("Live");
        selectLive(key(row));
      }
      if (permissions[terminalId]) selectView(key(row), "Terminal");
    } else {
      await onResume(row);
      rememberRecentOrigin();
    }
    closeRecentPreview(false);
  }
  function pickerSession(row: Session, recentGroup?: "Live" | "Today" | "Yesterday" | "Earlier") {
    const title = details[key(row)]?.name || row.title;
    const timestamp = recentGroup && !row.terminalId && row.updated > 0 ? new Date(row.updated * 1000) : undefined;
    const activity = timestamp?.toLocaleString([], recentGroup === "Earlier"
      ? { month: "short", day: "numeric" }
      : { hour: "numeric", minute: "2-digit" });
    return <button key={key(row)} className="dashboard-open dashboard-picker-session"
      aria-current={recentGroup === "Live" && activeLive && showingLive && key(activeLive) === key(row) ? "true" : undefined}
      data-recent-session={recentGroup ? key(row) : undefined}
      onClick={() => recentGroup ? previewRecentSession(row) : openPickerSession(row)}>
      <AgentIcon agent={row.provider.toLowerCase()} />
      <span className="dashboard-picker-session-label">
        <strong>{title}</strong>{recentGroup && <small>{name(row.cwd)}</small>}
      </span>
      {timestamp && <time dateTime={timestamp.toISOString()}>{activity}</time>}
      {row.terminalId && <SessionStatus state={railStatus(row)} showLabel />}
    </button>;
  }
  function conversationPreview(row: Session, fromRecent = false) {
    const id = key(row);
    const review = (fromRecent ? allAlerts : savedReviews).find((entry) =>
      entry.kind === "completion" && !row.terminalId && key(entry) === id);
    return <ProjectConversationPreview key={id} row={row} title={details[id]?.name || row.title}
      metadata={fromRecent ? `${name(row.cwd)} · ${row.provider}${row.updated > 0 ? ` · ${date(row.updated * 1000)}` : ""}` : undefined}
      next={details[id]?.next} inlineHistory={fromRecent}
      onSave={(next) => onEdit(id, { name: details[id]?.name ?? "", next })}
      onReview={review ? () => onReview(review.id) : undefined}
      onResume={() => fromRecent ? openRecentSession(row) : onResume(row)}
      onOpen={() => { if (fromRecent) closeRecentPreview(false); onOpen(row); }}
      onProject={fromRecent ? () => {
        rememberRecentOrigin();
        setRecentSelection(undefined);
        if (row.terminalId) showProjects([row.cwd], "Pick up");
        else openPickerSession(row);
      } : undefined} />;
  }
  const recentRow = recentSelection ? byKey.get(recentSelection) : undefined;
  async function changeRecentVisibility(target: { id: string; title: string }, hide: boolean) {
    setRecentAction(true);
    setRecentActionError("");
    try {
      await onCleanup([target.id], hide);
      setRecentHidden(hide ? target : undefined);
      if (hide) closeRecentPreview(true);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setRecentActionError(message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""));
    } finally {
      setRecentAction(false);
    }
  }
  function recentSessionActions(row: Session) {
    const id = key(row);
    const title = details[id]?.name || row.title;
    const canHide = !pins.has(id) && !protectedSessions.has(id) && !allAlerts.some((entry) => key(entry) === id)
      && !details[id]?.next?.trim();
    if (!row.terminalId) return <button className="dashboard-preview-hide" aria-disabled={recentAction || !canHide}
      title={canHide ? "Hide from Recent and history. You can undo this."
        : "This conversation has a pin, a link, a next step, or an unread alert."}
      onClick={() => { if (canHide && !recentAction) void changeRecentVisibility({ id, title }, true); }}>
      <Icon name="archive" size={16} /> Hide from history
    </button>;
    return <>
      <button className="dashboard-tool-icon" aria-label="Session actions" data-tooltip="Session actions"
        popoverTarget="dashboard-recent-session-actions" onClick={() => setConfirmEnd(undefined)}>
        <Icon name="more" size={17} />
      </button>
      <div id="dashboard-recent-session-actions" className="dashboard-session-popover dashboard-preview-menu" popover="auto" aria-label="Recent session actions">
        {sessionActions(row, true)}
      </div>
    </>;
  }
  function renderRecent() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const filter = recentQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matchesRecent = (row: Session) => {
      const text = `${details[key(row)]?.name ?? ""} ${row.title} ${row.cwd} ${row.provider}`.toLowerCase();
      return filter.every((word) => text.includes(word));
    };
    const saved = allWorkSessions.filter((row) => !row.terminalId && !row.guardianReview && matchesRecent(row))
      .sort((a, b) => b.updated - a.updated);
    const groups = Map.groupBy(saved, (row) => row.updated * 1000 >= +todayStart ? "Today"
      : row.updated * 1000 >= +yesterdayStart ? "Yesterday" : "Earlier");
    const recentLive = allLiveSessions.filter(matchesRecent).sort((a, b) => b.updated - a.updated);
    return <>
      <input type="search" ref={recentSearch} aria-label="Filter recent sessions" placeholder="Filter by session, project, or agent"
        value={recentQuery} onChange={(event) => {
          setRecentQuery(event.currentTarget.value);
          if (recentList.current) recentList.current.scrollTop = 0;
        }} />
      {recentHidden && <div className="dashboard-recent-hidden">
        <span role="status">Hidden from history · {recentHidden.title}</span>
        <button disabled={recentAction} onClick={() => void changeRecentVisibility(recentHidden, false)}>Undo hide</button>
      </div>}
      {recentActionError && <p role="alert" className="dashboard-attention-feedback">{recentActionError}</p>}
      <div ref={recentList} className="dashboard-project-picker-options dashboard-recent-list">
      {recentLive.length > 0 && <section aria-label="Live">
        <div className="recency-label">Live</div>
        {recentLive.map((row) => pickerSession(row, "Live"))}
      </section>}
      {(["Today", "Yesterday", "Earlier"] as const).map((group) => {
        const rows = groups.get(group);
        return rows?.length ? <section key={group} aria-label={group}>
          <div className="recency-label">{group}</div>
          {rows.map((row) => pickerSession(row, group))}
        </section> : null;
      })}
      {!recentLive.length && !saved.length && <p>{filter.length ? "No matching sessions." : "No recent sessions."}</p>}
      </div>
    </>;
  }
  function renderSearch(inPicker: boolean) {
    const recent = inPicker && !terms.length
      ? conversationSessions.filter((row) => !row.terminalId).sort((a, b) => b.updated - a.updated).slice(0, 4)
      : [];
    const resultRows = terms.length ? matchedSessions : recent;
    const searchLabel = inPicker ? "Search conversations" : focusedFolder ? "Find saved conversations" : "Find projects and conversations";
    return (
        <section hidden={!inPicker && !!focusedFolder && projectView !== "History"} className="dashboard-find" aria-label={inPicker ? searchLabel : undefined}
          aria-labelledby={inPicker ? undefined : "dashboard-find-title"}>
          {!inPicker && <h3 id="dashboard-find-title" tabIndex={-1}>{focusedFolder ? "Find a saved conversation" : "Find a project or conversation"}</h3>}
          <div className="dashboard-find-controls">
            <form role="search" onSubmit={(event) => {
              event.preventDefault();
              if (matchedSessions.length) {
                if (focusedFolder) { setPickerOpen(false); openConversationPreview(matchedSessions[0]); }
                else onOpen(matchedSessions[0]);
              }
              else if (matchedProjects.length) showProjects([matchedProjects[0].folder]);
            }}>
              <Icon name="search" size={16} />
              <input type="search" ref={searchInput} aria-label={searchLabel}
                placeholder={searchLabel} value={query} onChange={(event) => setQuery(event.target.value)} />
              {!inPicker && <kbd>{isMac ? "⌘ K" : "Ctrl K"}</kbd>}
            </form>
          </div>
          {(recent.length > 0 || (terms.length > 0 && (matchedProjects.length > 0 || matchedSessions.length > 0 || query.trim().length < 2))) &&
            <div className="dashboard-find-results">
            {recent.length > 0 && <div className="recency-label">Recent conversations</div>}
            {(matchedProjects.length > 0 || matchedSessions.length > 0) && <div className="recency-label">Projects and conversation titles</div>}
            {terms.length > 0 && query.trim().length < 2 && !matchedProjects.length && !matchedSessions.length && <p>No matching projects or conversations.</p>}
            {resultRows.map((row) => (
              <button key={key(row)} className="dashboard-open" onClick={() => {
                setPickerOpen(false);
                if (focusedFolder) openConversationPreview(row);
                else onOpen(row);
              }}>
                <AgentIcon agent={row.provider.toLowerCase()} />
                <span><strong>{details[key(row)]?.name || row.title}</strong><small>{name(row.cwd)} · {row.provider}</small></span>
              </button>
            ))}
            {matchedProjects.map(({ folder }) => (
              <button key={folder} className="dashboard-open" onClick={() => showProjects([folder])}>
                <Icon name="folder" size={16} /><span><strong>{name(folder)}</strong><small>{folder}</small></span>
              </button>
            ))}
          </div>}
          {open && (inPicker || !focusedFolder || projectView === "History") && <ConversationSearch
            query={query} folders={scopedFolders} scope="all" detailed sessionNames={details} onOpen={onEvidence} />}
        </section>
    );
  }
  return (
    <dialog ref={dialog} className="appearance-dialog projects-dashboard" data-live-first={liveFirst} aria-labelledby="dashboard-heading"
      onKeyDownCapture={(event) => {
            if (!showLivePanel || pickerOpen || recentSelection || filePreview || !event.altKey || !event.shiftKey) return;
            if (event.key === "ArrowLeft" && (returnSession || liveSessions.some((row) => key(row) === previousLive))) {
              event.preventDefault();
              event.stopPropagation();
              returnFromAttention();
            }
            if (event.key === "ArrowRight" && nextAttention?.terminalId) {
              event.preventDefault();
              event.stopPropagation();
              advanceAttention();
            }
          }}
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <header className="dashboard-masthead" data-working={workingCount > 0}>
        <div className="dashboard-masthead-art" aria-hidden="true">
          <i /><i /><i />
        </div>
        <div className="dashboard-brand">
          <span className="dashboard-brand-mark" aria-hidden="true" style={{ maskImage: `url("${logo}")` }}>
            <img src={logo} alt="" />
          </span>
          <h2 id="dashboard-heading">RunHuddle</h2>
        </div>
        <div className="dashboard-scope">
          <div ref={picker} className="dashboard-project-picker" onBlur={(event) => {
            if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setPickerOpen(false);
          }} onKeyDown={(event) => {
            if (event.key !== "Escape" || !pickerOpen) return;
            event.preventDefault();
            event.stopPropagation();
            setPickerOpen(false);
            (pickerMode === "Recent" ? recentControl : scopeControl).current?.focus();
          }}>
            <button ref={scopeControl} className="dashboard-project-picker-trigger" aria-expanded={pickerOpen && pickerMode !== "Recent"}
              aria-controls={pickerOpen && pickerMode !== "Recent" ? "dashboard-project-picker-panel" : undefined} aria-label={`Projects: ${scopeLabel}`}
              onClick={() => {
                if (pickerOpen && pickerMode !== "Recent") setPickerOpen(false);
                else openPicker("Projects");
              }}>
              <Icon name="folder" size={15} /><span title={scopeLabel}>{scopeLabel}</span><Icon name="chevron" size={13} />
            </button>
            <button ref={recentControl} className="dashboard-recent-trigger" aria-expanded={pickerOpen && pickerMode === "Recent"}
              aria-controls={pickerOpen && pickerMode === "Recent" ? "dashboard-project-picker-panel" : undefined}
              onClick={() => {
                if (pickerOpen && pickerMode === "Recent") setPickerOpen(false);
                else openPicker("Recent");
              }}><Icon name="history" size={15} /> Recent</button>
            {pickerOpen && <div id="dashboard-project-picker-panel" className="dashboard-project-picker-panel"
              data-recent={pickerMode === "Recent"} role="group" aria-label={pickerMode === "Recent" ? "Recent sessions" : "Choose projects"}>
              {pickerMode === "Recent" ? renderRecent() : <>
              <div className="dashboard-picker-tabs" role="group" aria-label="Browse">
                {(["Projects", "Conversations"] as const).map((mode) => <button key={mode}
                  aria-pressed={pickerMode === mode} onClick={() => setPickerMode(mode)}>{mode}</button>)}
              </div>
              {pickerMode === "Projects" ? <>
                <input type="search" ref={pickerSearch} aria-label="Search projects" placeholder="Search projects"
                  value={pickerQuery} onChange={(event) => setPickerQuery(event.currentTarget.value)} />
                <div className="dashboard-project-picker-options">
                  {pickerProjects.map(({ folder, rows, working }, index) => {
                    const expanded = expandedPickerProjects.has(folder);
                    const group = `dashboard-picker-sessions-${index}`;
                    const live = rows.filter((row) => row.terminalId);
                    const saved = rows.filter((row) => !row.terminalId && !row.guardianReview)
                      .sort((a, b) => Number(pins.has(key(b))) - Number(pins.has(key(a))) || b.updated - a.updated);
                    const label = name(folder);
                    return <div className="dashboard-picker-project" key={folder}>
                      <div className="dashboard-picker-row">
                        <button className="dashboard-picker-expand" aria-label={`${expanded ? "Collapse" : "Expand"} ${label} sessions`}
                          aria-expanded={expanded} aria-controls={group} onClick={() => setExpandedPickerProjects((previous) => {
                            const next = new Set(previous);
                            if (expanded) next.delete(folder);
                            else next.add(folder);
                            return next;
                          })}><Icon name="chevron" size={14} /></button>
                        <button className="dashboard-open" title={folder} aria-label={`Focus project ${label}`}
                          onClick={() => showProjects([folder], "Pick up")}>
                          <Icon name="folder" size={16} /><span><strong>{label}</strong></span>
                        </button>
                        {working.length > 0 ? <small>{working.length} working</small>
                          : live.length > 0 ? <small>{live.length} live</small>
                          : saved.length > 0 && <small>{saved.length} saved</small>}
                        <input type="checkbox" aria-label={label} title={`Include ${label} in live filter`}
                          checked={pendingScope.includes(folder)} onChange={(event) => {
                            const checked = event.currentTarget.checked;
                            setPendingScope((previous) => checked ? [...previous, folder] : previous.filter((item) => item !== folder));
                          }} />
                      </div>
                      <div id={group} className="dashboard-picker-sessions" role="group" aria-label={`${label} sessions`} hidden={!expanded}>
                        {expanded && <>
                          {live.length > 0 && <><div className="recency-label">Live</div>{live.map((row) => pickerSession(row))}</>}
                          {saved.length > 0 && <><div className="recency-label">Saved</div>{saved.map((row) => pickerSession(row))}</>}
                          {!live.length && !saved.length && <p>No sessions yet</p>}
                        </>}
                      </div>
                    </div>;
                  })}
                  {!pickerProjects.length && <p>No matching projects.</p>}
                </div>
                <div className="dashboard-project-picker-footer">
                  <span>{pendingScope.length ? `${pendingScope.length} selected` : "All projects"}</span>
                  <button className="primary" onClick={() => showProjects(pendingScope, "Live")}>Apply</button>
                </div>
              </> : <div className="dashboard-picker-search">{renderSearch(true)}</div>}
              </>}
            </div>}
          </div>
          {recentOrigin && <button className="dashboard-clear-scope" onClick={returnToRecentOrigin}>← Back to Recent</button>}
          {hasProjectFilter && <button className="dashboard-clear-scope" onClick={() => showProjects([])}>
            Show all projects{outsideInputCount > 0 && <span> · {outsideInputCount} {outsideInputCount === 1 ? "needs input" : "need input"}</span>}
          </button>}
        </div>
        <div className="dashboard-toolbar-activity" hidden={!showLivePanel && !keepAwakeActive}>
            <div className="dashboard-live-heading">
              {showLivePanel && <><Icon name={reviewsOnly ? "inbox" : "activity"} size={19} />
              {reviewsOnly ? <h3>Ready for review</h3>
                : <span className="dashboard-live-total" title="Live sessions">{liveSessions.length} live</span>}
              {workingCount > 0 && <span className="dashboard-working-count">
                <span className="dashboard-activity-meter" aria-hidden="true"><i /><i /><i /><i /><i /></span>
                {workingCount} working
              </span>}</>}
              {keepAwakeActive && <span className="dashboard-working-count" role="status"
                title="Preventing idle sleep while agents work">Keeping awake</span>}
            </div>
            {showLivePanel && <div className="dashboard-live-actions">
              {savedReviews.length > 0 && <button aria-expanded={showSavedReviews} aria-controls="dashboard-saved-reviews"
                onClick={() => setShowSavedReviews(!showSavedReviews)}>Saved reviews ({savedReviews.length})</button>}
              {liveSessions.length > 0 && <>
                <button className="dashboard-tool-icon dashboard-next-review" aria-label="Next review" data-tooltip="Next review"
                  aria-description={liveReviews.length ? `${liveReviews.length} ${liveReviews.length === 1 ? "session is" : "sessions are"} ready to review` : undefined}
                  aria-disabled={!nextReview} onClick={advanceReview}>
                  <Icon name="inbox" size={17} />
                  {liveReviews.length > 0 && <span aria-hidden="true">{liveReviews.length}</span>}
                </button>
                <button className="dashboard-tool-icon dashboard-next-attention" aria-label="Next attention" data-tooltip="Next attention"
                  aria-description={liveAttention.length ? `${liveAttention.length} ${liveAttention.length === 1 ? "session needs" : "sessions need"} attention` : undefined}
                  aria-disabled={!nextAttention} onClick={advanceAttention}>
                  <Icon name="attention" size={17} />
                  {liveAttention.length > 0 && <span aria-hidden="true">{liveAttention.length}</span>}
                </button>
              </>}
            </div>}
        </div>
        <div className="dashboard-masthead-actions">
          <button className="dashboard-tool-icon dashboard-open-workspace" aria-label="Command Palette"
            data-tooltip={`Command Palette (${paletteShortcut})`} onClick={onCommandPalette}><Icon name="search" size={17} /></button>
          <button className="dashboard-tool-icon dashboard-open-workspace" aria-label="Open workspace"
            data-tooltip={workspaceLabel ? `Open workspace for ${workspaceLabel} (Esc)` : "Open workspace (Esc)"} onClick={onClose}>
            <Icon name="terminal" size={17} />
          </button>
          {focusedFolder && <button disabled={!connected || openingShell} onClick={() => void openProjectShell(focusedFolder)}>
            <Icon name="terminal" size={16} /> Open project shell
          </button>}
          <button className="primary dashboard-new-session" onClick={() => onLaunch(scopedFolders)}>
            <Icon name="plus" size={16} /> New session
          </button>
        </div>
      </header>
      {connected && allLiveSessions.filter((row) => row.provider === "Codex" && (open || queuedFollowUps[key(row)])).map((row) =>
        <TerminalPermissionObserver key={row.terminalId} id={row.terminalId!} onPrompt={onPermission} onWorking={onTerminalWorking} />)}
      <div className="dashboard-body">
        {shellError && <p className="dashboard-attention-feedback" role="alert">{shellError}</p>}
        {focusedFolder && <div className="dashboard-project-views" role="group" aria-label="Project view">
          {(["Pick up", "Live", "History"] as const).map((view) =>
            <button key={view} aria-pressed={projectView === view} onClick={() => setProjectView(view)}>{view}</button>)}
        </div>}
        <section id="dashboard-live-panel" hidden={!showLivePanel} className="dashboard-attention dashboard-live"
          aria-label={reviewsOnly ? "Ready for review" : "Live sessions"}>
          {returnSession && interrupted && <div className="dashboard-live-actions dashboard-interruption">
              <button className="dashboard-return-session"
                title={`Back to ${returnTitle} · ${interrupted.view}`} onClick={returnToSession}>
                <span>Back to {returnTitle}</span><span>· {interrupted.view}</span>
              </button>
          </div>}
          {showSavedReviews && savedReviews.length > 0 && <section id="dashboard-saved-reviews" aria-label="Saved reviews" className="dashboard-saved-reviews">
            {savedReviews.map((entry) => {
              const row = byKey.get(key(entry));
              const title = details[key(entry)]?.name || row?.title || entry.body;
              return <div key={entry.id} className="dashboard-attention-item">
                <div className="dashboard-session-line">
                  <button className="dashboard-open" aria-label={`Open ${title} (${entry.provider})`} onClick={() => onOpen(row ?? entry)}>
                    <AgentIcon agent={entry.provider.toLowerCase()} />
                    <span><strong>{title}</strong><small>{row ? name(row.cwd) : entry.provider} · {elapsed(entry.createdAt, +today)}</small></span>
                  </button>
                  <button aria-label={`Preview ${title}`} aria-expanded={previewID === entry.id}
                    onClick={() => setPreviewID(previewID === entry.id ? undefined : entry.id)}>
                    {previewID === entry.id ? "Hide preview" : "Preview"}
                  </button>
                  <button aria-label={`Mark ${title} reviewed`} onClick={() => onReview(entry.id)}>Mark reviewed</button>
                </div>
                {previewID === entry.id && <AttentionPreview enabled={open && showingLive} id={entry.id} kind="completion" recap={recaps?.[key(entry)]} updated={row?.updated} />}
              </div>;
            })}
          </section>}
          {followUps.error && <p className="dashboard-attention-feedback" role="alert">{followUps.error}</p>}
          {feedback?.error && <p className="dashboard-attention-feedback" role="alert">{feedback.message}</p>}
          {focusedFolder && !liveSessions.length && <div className="dashboard-live-empty">
            <p>No live sessions in {name(focusedFolder)}.</p>
            <button onClick={() => setProjectView("History")}>Browse saved conversations</button>
            <button className="primary" onClick={() => onLaunch(scopedFolders)}>Start a session</button>
          </div>}
          {(liveSessions.length > 0 || browserVisible) && <div ref={browserSurface} className="dashboard-work-area"
            data-browser={browserVisible} style={{ "--dashboard-browser-size": `${browserSize}%` } as React.CSSProperties}>
          {liveSessions.length > 0 ? <div className="dashboard-switchboard" data-rail-hidden={hideRail}>
            <nav id="dashboard-live-rail" className="dashboard-live-rail" aria-label="Live session list" hidden={hideRail}>
              {[...Map.groupBy(liveSessions, (row) => row.cwd)].map(([folder, rows]) => <section key={folder}>
                <h4 title={folder}>{name(folder)}</h4>
                {rows.map((row) => {
                  const terminalId = row.terminalId!;
                  const title = details[key(row)]?.name || row.title;
                  const state = liveState(row);
                  const draft = followUps.drafts[key(row)];
                  const hasDraft = !!(draft?.text.trim() || draft?.files.length);
                  const hidden = hiddenTabs.includes(terminalId);
                  return <button key={terminalId} className="dashboard-open dashboard-rail-row" data-working={state === "working"}
                    aria-label={`Inspect ${title}`} aria-description={queuedFollowUps[key(row)] ? "Queued follow-up" : hasDraft ? "Unsent follow-up draft" : undefined}
                    aria-current={key(row) === livePreview ? "true" : undefined}
                    onClick={() => selectLive(key(row))}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      const anchor = event.currentTarget.getBoundingClientRect();
                      setConfirmEnd(undefined);
                      setContext({ terminalId, x: event.clientX || anchor.left, y: event.clientY || anchor.bottom });
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
                      event.preventDefault();
                      const anchor = event.currentTarget.getBoundingClientRect();
                      setConfirmEnd(undefined);
                      setContext({ terminalId, x: anchor.left, y: anchor.bottom });
                    }}>
                    <AgentIcon agent={row.provider.toLowerCase()} />
                    <span className="dashboard-rail-text">
                      <span className="dashboard-rail-title">
                        <strong title={title}>{title}</strong>
                        {hasDraft && <span className="dashboard-draft-badge">{queuedFollowUps[key(row)] ? "Queued" : "Draft"}</span>}
                        {hidden && <span className="dashboard-rail-hidden">Tab hidden</span>}
                      </span>
                      <small className="dashboard-rail-meta">
                        <span>
                          <SessionStatus state={railStatus(row)} showLabel />
                          {state !== "idle" && state !== "working" && state !== "needsInput" && attentionIDs.has(key(row)) && " · Review"}
                        </span>
                        {open && showingLive && !hideRail && state === "working" && workingSince.has(terminalId)
                          ? <WorkingDuration since={workingSince.get(terminalId)!} />
                          : row.updated > 0 && <time dateTime={new Date(row.updated * 1000).toISOString()}
                          title={date(row.updated * 1000)}>{elapsed(row.updated * 1000, +today)}</time>}
                      </small>
                    </span>
                  </button>;
                })}
              </section>)}
            </nav>
            <div className="dashboard-live-detail">
              {liveSessions.length > 1 && <button className="dashboard-tool-icon dashboard-rail-toggle"
                aria-label={hideRail ? "Show session list" : "Hide session list"}
                data-tooltip={hideRail ? "Show session list" : "Hide session list"}
                aria-expanded={!hideRail} aria-controls="dashboard-live-rail"
                onClick={() => {
                  if (!activeLive) selectLive(key(liveSessions[0]));
                  setCollapsedRail(!hideRail);
                }}><Icon name="sidebar" size={17} /></button>}
              {!activeLive && <p>Select a live session to inspect its work.</p>}
              {allLiveSessions.filter((row) => row === activeLive || mountedViews[key(row)]).map((row) => {
                const terminalId = row.terminalId!;
                const id = "live:" + terminalId;
                const title = details[key(row)]?.name || row.title;
                const state = liveState(row);
                const followUpID = key(row);
                const draft = followUps.drafts[followUpID] ?? emptyDraft;
                const queued = queuedFollowUps[followUpID]?.terminalId === terminalId;
                const canQueue = row.provider === "Codex" && !navigator.platform.startsWith("Win") && state === "working" && connected;
                const { files } = draft;
                const view = views[followUpID] ?? "Preview";
                const current = row === activeLive;
                const visible = current && showingLive;
                const readingHistory = terminalHistory === terminalId;
                const showingTerminal = visible && view === "Terminal" && !readingHistory && open;
                const review = alerts.find((entry) => entry.kind === "completion" && key(entry) === key(row));
                const visibleReview = review && liveReviews.includes(row) ? review.id : undefined;
                const question = !permissions[terminalId] && alerts.find((entry) => entry.kind === "input" && key(entry) === key(row));
                const replyDraftId = question ? "reply:" + question.id : id;
                const input = {
                  value: question ? replyDrafts[replyDraftId] ?? "" : draft.text,
                  maxLength: 2000,
                  disabled: sending === replyDraftId || (!question && (!followUps.ready || queued)),
                  onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                    const text = event.currentTarget.value;
                    if (question) setReplyDrafts((previous) => ({ ...previous, [replyDraftId]: text }));
                    else followUps.updateDraft(followUpID, (previous) => ({ ...previous, text }));
                  },
                };
                return <div className="dashboard-live-session" key={terminalId} hidden={!current}>
                  <div className="dashboard-live-toolbar" data-working={state === "working"}>
                    <div>
                      <div className="dashboard-session-title">
                        <strong title={title}>{title}</strong>
                        <button aria-label="Rename session…" title="Rename session" onClick={() => onRename(row)}>
                          <Icon name="pencil" size={14} />
                        </button>
                      </div>
                      <small className="dashboard-single-status">
                        {hideRail && current ? <>{row.provider} <SessionStatus state={railStatus(row)} showLabel /></>
                          : `${name(row.cwd)} · ${row.provider}`}
                        {open && visible && state === "working" && workingSince.has(terminalId) &&
                          <WorkingDuration since={workingSince.get(terminalId)!} />}
                        {hideRail && current && <>
                          {hiddenTabs.includes(terminalId) && <span>Tab hidden</span>}
                          {!!(draft.text.trim() || files.length) && <span className="dashboard-draft-badge">{queued ? "Queued" : "Draft"}</span>}
                        </>}
                      </small>
                    </div>
                    <div className="dashboard-session-controls">
                      <div role="group" aria-label="Session detail view">
                        {(["Preview", "Terminal", "Changes"] as const).map((mode) =>
                          <button key={mode} aria-pressed={view === mode} onClick={() => selectView(followUpID, mode)}>{mode}</button>)}
                      </div>
                      {view === "Preview" && <>
                        <button type="button" className="dashboard-tool-icon" aria-label="Preview layout" data-tooltip="Preview layout"
                          popoverTarget={id + "-preview-layout"}><Icon name="layout" size={17} /></button>
                        <div className="dashboard-session-popover dashboard-preview-layout-menu" id={id + "-preview-layout"}
                          popover="auto" role="group" aria-label="Preview sections">
                          <strong>Show in Preview</strong>
                          {(Object.keys(previewSections) as PreviewSection[]).map((section) =>
                            <label key={section}><input type="checkbox" checked={!hiddenPreviewSections[section]}
                              onChange={(event) => {
                                const hidden = !event.currentTarget.checked;
                                setHiddenPreviewSections((previous) => ({ ...previous, [section]: hidden }));
                              }} />{previewSections[section]}</label>)}
                        </div>
                      </>}
                      <button className="dashboard-tool-icon" aria-label="Browser" aria-expanded={browserVisible}
                        data-tooltip={browserVisible ? "Close browser pane" : "Open browser pane"}
                        onClick={() => setBrowserOpen((visible) => !visible)}><Icon name="browser" size={17} /></button>
                      <button className="dashboard-tool-icon" aria-label="Shell" aria-expanded={drawerOpen}
                        data-tooltip={drawerOpen ? "Hide shell" : "Open shell"}
                        disabled={!connected && !drawerOpen}
                        onClick={() => {
                          setDrawerOpen(!drawerOpen);
                          if (!drawerOpen && !drawerTerminal && !(compactShell && compactPrompt)) void startDrawerShell(row.cwd);
                        }}><Icon name="terminal" size={17} /></button>
                      <button className="dashboard-session-more" aria-label="Session actions" title="Session actions"
                        popoverTarget={id + "-actions"} onClick={() => setConfirmEnd(undefined)}><Icon name="more" size={17} /></button>
                      <div className="dashboard-session-popover" id={id + "-actions"} popover="auto" aria-label="Session actions">
                        {sessionActions(row)}
                      </div>
                    </div>
                  </div>
                  <div className="dashboard-live-content" hidden={view !== "Preview"}>
                    <div className="dashboard-live-preview-scroll">
                      {current && view === "Preview" && <AttentionPreview enabled={open && showingLive} id={id} kind={state === "needsInput" ? "input" : "completion"}
                        onFileReference={(file) => setFilePreview({ source: row, file })} onBrowserReference={openBrowserReference}
                        onReadHistory={() => { selectView(followUpID, "Terminal"); setTerminalHistory(terminalId); }}
                        checkoutSummary={<CheckoutSummary key={row.cwd} cwd={row.cwd} enabled={open && showingLive}
                          working={state === "working"} onOpen={() => selectView(followUpID, "Changes", "working")} />}
                        liveSession={row} hiddenSections={hiddenPreviewSections} turnChanges={turnChanges[followUpID]} compactTurns={drawerOpen} followUpQueued={!!queued} reviewID={visibleReview} onReview={onReview} submitted={submitted[id]} liveState={review && state === "idle" ? undefined : state} updated={row.updated} permission={permissions[terminalId]} />}
                    </div>
                    {state === "disconnected" && <div className="dashboard-live-unavailable">
                      <div><strong>Terminal still open</strong>
                        <p>RunHuddle can’t tell whether the agent is ready. You can keep drafting a follow-up here.</p>
                      </div>
                      <button onClick={() => selectView(followUpID, "Terminal")}>Check terminal</button>
                    </div>}
                    <div className="dashboard-attention-compose dashboard-live-compose">
                      {current && feedback?.composeId === (question ? replyDraftId : id) && !feedback.error && <p className="dashboard-compose-feedback" role="status">{feedback.message}</p>}
                      <form onSubmit={(event) => {
                        event.preventDefault();
                        if (question) {
                          void sendMessage(replyDraftId, title, (text) => window.runhuddle.copyInboxReply(question.id, text));
                          return;
                        }
                        if (queued || sendingRef.current || !followUps.ready || (!draft.text.trim() && !files.length)) return;
                        if (canQueue) {
                          const text = draft.text.trim();
                          if (/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(text) || /^[!/]/.test(text)) {
                            setFeedback({ composeId: id, message: "Enter a single-line message of up to 2,000 characters.", error: true });
                            return;
                          }
                          setFeedback(undefined);
                          setQueuedFollowUps((previous) => ({ ...previous, [followUpID]: { terminalId, draft } }));
                        } else if (state === "idle") void submitLiveFollowUp(row);
                      }}>
                        <label><span>{question ? "Draft a reply" : "Follow up"} · {title} · {name(row.cwd)} · {row.provider}</span>
                          {question ? <textarea {...input} rows={2} placeholder="Write a reply to copy" />
                            : <input {...input} placeholder="Write a follow-up" onPaste={(event) => {
                                const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
                                if (!images.length) return;
                                event.preventDefault();
                                if (images.some((file) => file.size > 10 * 1024 * 1024) || files.length + images.length > 8) {
                                  setFeedback({ message: "Attach up to 8 screenshots of 10 MB each.", error: true });
                                  return;
                                }
                                followUps.updateDraft(followUpID, (previous) => ({
                                  ...previous, files: [...previous.files, ...images],
                                }));
                              }} />}
                        </label>
                        <button className="primary" disabled={(!question && (!followUps.ready || queued || (state !== "idle" && !canQueue))) || !!sending || (!input.value.trim() && (!!question || !files.length))}
                            title={question || state === "idle" || canQueue ? undefined : "Send when the agent is idle"}>{question ? "Copy reply" : queued ? "Queued" : canQueue ? "Queue follow-up" : "Send follow-up"}</button>
                      </form>
                      {queued && <div className="dashboard-draft-wait">
                        <span role="status">{state === "working" ? "Queued · sends when the agent is ready" : state === "needsInput" ? "Queued · waiting for your input" : "Queued · waiting for an empty terminal prompt"}</span>
                        <button type="button" disabled={sending === id} onClick={() => cancelQueuedFollowUp(followUpID)} title="Keep this as an editable draft">Cancel queue</button>
                      </div>}
                      {!canQueue && state === "working" && (draft.text.trim() || files.length > 0) &&
                        <small className="dashboard-draft-wait">Send this draft when the agent is ready.</small>}
                      {!!files.length && <ul className="dashboard-draft-attachments" aria-label="Draft screenshots">
                        {files.map((file, index) => <li key={index}>
                          <span title={file.name}>{file.name === "image.png" ? `Screenshot ${index + 1}` : file.name}</span>
                          <button type="button" aria-label={`Remove screenshot ${index + 1}`} disabled={sending === id || queued}
                            onClick={() => followUps.updateDraft(followUpID, (previous) => ({
                              ...previous, files: previous.files.filter((item) => item !== file),
                            }))}>×</button>
                        </li>)}
                      </ul>}
                      {state === "needsInput" && <button onClick={() => { setTerminalHistory(undefined); selectView(followUpID, "Terminal"); }}>Answer in terminal</button>}
                      {review && state !== "working" && <button onClick={() => onReview(review.id)}>Mark reviewed</button>}
                    </div>
                  </div>
                  {(view === "Terminal" || mountedViews[followUpID]?.Terminal) && <div className="dashboard-inline-terminal" hidden={view !== "Terminal"}>
                    <div className="dashboard-terminal-history-controls">
                      <button onClick={() => setTerminalHistory(readingHistory ? undefined : terminalId)}>
                        {readingHistory ? "Back to terminal" : "Conversation history"}
                      </button>
                    </div>
                    <div className="dashboard-terminal-surface" hidden={readingHistory}>
                    {connected ? <TerminalPane id={terminalId} visible={showingTerminal}
                      active={showingTerminal} focused={showingTerminal && !drawerVisible} redrawOnTruncatedReplay={row.provider === "Codex"} onTitle={() => {}}
                      onConversationLock={row.provider === "Codex" ? (locked) => onTerminalLock(terminalId, locked) : undefined}
                      onError={(message) => setFeedback({ message, error: true })} />
                      : <p>Terminal connection interrupted.</p>}
                    </div>
                    {readingHistory && visible && view === "Terminal" && <SessionHistory session={row} inline />}
                  </div>}
                  {(view === "Changes" || mountedViews[followUpID]?.Changes) && <div className="dashboard-inline-changes" hidden={view !== "Changes"}>
                    <ChangesPanel key={row.cwd} cwd={row.cwd} session={row} inline preferUncommitted={uncommittedFor === followUpID} active={open && visible && view === "Changes"}
                      onDraftFollowUp={(text) => {
                        if (!followUps.ready || queued || sending === id) return false;
                        const next = [draft.text.trim(), text].filter(Boolean).join(" ");
                        if (next.length > 2000) return false;
                        followUps.updateDraft(followUpID, (previous) => ({ ...previous, text: next }));
                        selectView(followUpID, "Preview");
                        return true;
                      }}
                      positionKey={JSON.stringify([followUpID, row.cwd])} onClose={() => selectView(followUpID, "Preview")} />
                  </div>}
                </div>;
              })}
              {activeFolder && (drawerOpen || drawerTerminal) &&
                <DashboardShell terminal={drawerTerminal} project={name(activeFolder)}
                  visible={drawerVisible} connected={connected} opening={drawerOpening} error={drawerError}
                  compactPrompt={compactPrompt} compactShell={compactShell} terminalServiceUpdate={terminalServiceUpdate} onCompactPrompt={setCompactPrompt}
                  onHide={() => setDrawerOpen(false)} onStart={() => void startDrawerShell(activeFolder)}
                  onEnd={async (id) => {
                    if (await window.runhuddle.close(id))
                      setDrawerId((current) => current === id ? "" : current);
                  }} />}
            </div>
          </div> : <div className="dashboard-work-area-empty">
            {!focusedFolder && <><p>No live sessions</p><button className="primary" onClick={() => onLaunch(scopedFolders)}>Start a session</button></>}
          </div>}
          {browserVisible && <>
            <div className="dashboard-browser-divider" role="separator" tabIndex={0} aria-label="Resize browser pane"
              aria-orientation="vertical" aria-valuemin={28} aria-valuemax={65} aria-valuenow={browserSize}
              onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                const bounds = browserSurface.current?.getBoundingClientRect();
                if (!bounds?.width) return;
                setBrowserSize(Math.round(Math.max(28, Math.min(65, (bounds.right - event.clientX) * 100 / bounds.width))));
              }}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                setBrowserSize((size) => Math.max(28, Math.min(65, size + (event.key === "ArrowLeft" ? 5 : -5))));
              }} />
            <BrowserPreview target={browserTarget} canGrantControl={!!viewedTerminal && viewedTerminal === browserTarget?.id}
              onReopenSession={onReopenBrowserSession} onClose={() => setBrowserOpen(false)}
              onShareReport={(_target, file) => {
                if (!activeLive) return;
                followUps.updateDraft(key(activeLive), (draft) => ({
                  ...draft,
                  text: [draft.text, `Inspect the page screenshot, visible text, and console diagnostics in ${JSON.stringify(file)}`].filter(Boolean).join(" "),
                }));
              }} />
          </>}
          </div>}
        </section>
        {contextSession && <div ref={rowMenu} className="dashboard-session-popover dashboard-row-context"
          popover="auto" aria-label="Session row actions"
          onToggle={(event) => {
            if (!event.currentTarget.matches(":popover-open")) setContext(undefined);
          }}>{sessionActions(contextSession)}</div>}
        <section hidden={liveFirst || !!focusedFolder || !resume.length} className="dashboard-resume" aria-labelledby="dashboard-resume-title">
          <h3 id="dashboard-resume-title" tabIndex={-1}>Pick up where you left off</h3>
          <div className="dashboard-resume-grid">
            {resume.map((row) => {
              const id = key(row);
              const title = details[id]?.name || row.title;
              return <div key={id} className="dashboard-resume-item">
                <button className="dashboard-resume-card" onClick={() => onOpen(row)} title={title}>
                  <span><AgentIcon agent={row.provider.toLowerCase()} /><small>{name(row.cwd)}</small></span>
                  <strong>{title}</strong>
                  {details[id]?.next && <span className="dashboard-resume-next">{details[id].next}</span>}
                  {openedSessions[id] && <small>Opened {elapsed(openedSessions[id], +today)}</small>}
                </button>
                <button className="dashboard-resume-dismiss" aria-label={`Dismiss ${title} from resume suggestions`}
                  title="Dismiss from resume suggestions"
                  onClick={() => setDismissedResume((previous) => ({ ...previous, [id]: resumeVersion(id) }))}>
                  <Icon name="close" size={14} />
                </button>
              </div>;
            })}
          </div>
        </section>
        {!liveFirst && !(pickerOpen && pickerMode === "Conversations") && renderSearch(false)}
        {focusedFolder && projectView === "Pick up" && <section className="dashboard-project-landing" aria-label="Pick up">
          {liveSessions.length > 0 && <div className="dashboard-project-live-link">
            <button onClick={() => setProjectView("Live")}>View live sessions ({liveSessions.length})</button>
          </div>}
          {(liveReviews.length > 0 || savedReviews.length > 0) && <div className="dashboard-project-history-panel">
            <h3>Ready to review</h3>
            {liveReviews.map((row) => <button key={key(row)} className="dashboard-open" onClick={() => {
              setProjectView("Live");
              selectLive(key(row));
              selectView(key(row), "Preview");
            }}>{details[key(row)]?.name || row.title}</button>)}
            {savedReviews.map((entry) => {
              const row = byKey.get(key(entry));
              return <div key={entry.id} className="dashboard-session-line">
                <button className="dashboard-open" onClick={() => row ? openConversationPreview(row) : onOpen(entry)}>
                  {details[key(entry)]?.name || row?.title || entry.body}
                </button>
                <button onClick={() => onReview(entry.id)}>Mark reviewed</button>
              </div>;
            })}
          </div>}
          {(checkpoints.length > 0 || (liveReviews.length === 0 && savedReviews.length === 0 && recentConversations.length > 0)) &&
            <div className="dashboard-project-history-panel">
              <h3>{checkpoints.length ? "Saved next steps" : "Recent conversations"}</h3>
              {(checkpoints.length ? checkpoints : recentConversations).map((row) => sessionRow(row, true))}
            </div>}
          {!savedConversations.length && !liveSessions.length && !savedReviews.length && <p>No conversations yet. Start a session in this project to get going.</p>}
          {savedConversations.length > 0 && <button onClick={() => setProjectView("History")}>Browse history ({savedConversations.length})</button>}
        </section>}
        {focusedFolder && <section hidden={projectView !== "History"} className="dashboard-saved-conversations" aria-label="Saved conversations">
          <header className="dashboard-project-history-heading">
            <h3>Saved conversations <span className="dashboard-project-count">{savedConversations.length}</span></h3>
            {!!savedConversations.length && <button onClick={() => setReviewFolder(focusedFolder)}>Review old sessions</button>}
            {!!savedConversations.length && <button aria-expanded={aiReviewFolder === focusedFolder}
              onClick={() => setAiReviewFolder(aiReviewFolder === focusedFolder ? "" : focusedFolder)}>AI history review</button>}
          </header>
          {aiReviewFolder === focusedFolder && savedConversations.length > 0 && <ProjectHistoryReview
            key={focusedFolder} folder={focusedFolder} rows={savedConversations}
            available={reviewAgents} detectionFailed={reviewAgentError}
            onRetryDetection={() => setReviewAgentCheck((value) => value + 1)}
            preferredAgent={preferredReviewAgent} onPreferredAgent={(agent) => {
              localStorage.setItem("recapAgent", agent);
              setPreferredReviewAgent(agent);
            }} onEvidence={onEvidence} />}
          <div className="dashboard-project-history-layout" data-preview={!!selectedConversation}>
            {!terms.length && <div className="dashboard-project-history-panel">
              {savedConversations.length ? savedConversations.map((row) => sessionRow(row, true)) : <p>No saved conversations for this project.</p>}
            </div>}
            {selectedConversation && conversationPreview(selectedConversation)}
          </div>
          {!terms.length && guardianConversations.length > 0 && <details>
            <summary>Guardian reviews ({guardianConversations.length})</summary>
            <p>{guardianReason}</p>
            {guardianConversations.map((row) => sessionRow(row))}
          </details>}
        </section>}
        <section aria-label="Projects" hidden={liveFirst || !!focusedFolder}>
          <div className="dashboard-projects-heading">
            <h3>Projects <span className="dashboard-project-count">{projects.length}</span></h3>
            {projects.length > 0 && <label>View
              <select aria-label="Project card view" value={projectDensity}
                onChange={(event) => setProjectDensity(event.currentTarget.value === "compact" ? "compact" : "comfortable")}>
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>}
          </div>
          {!projects.length && <p>Your projects will appear here as you open sessions.</p>}
          <div className="dashboard-grid" data-density={projectDensity}>
            {allProjects.map(({ folder, rows, attention, working }, index) => {
              const candidates = rows.filter((row) => !row.guardianReview);
              const pending = liveAttention.find((row) => row.cwd === folder);
              const draft = candidates.find((row) => {
                const draft = followUps.drafts[key(row)];
                return draft?.text.trim() || draft?.files.length;
              });
              const unknown = candidates.find((row) => row.terminalId && liveState(row) === "disconnected");
              const checkpoint = candidates.find((row) => details[key(row)]?.next?.trim());
              const saved = candidates.filter((row) => !row.terminalId);
              const waitingReview = attention.find((entry) => entry.kind === "completion" &&
                !liveAttention.some((row) => key(row) === key(entry)) &&
                candidates.some((row) => key(row) === key(entry) && liveState(row) !== "working"));
              const reviewTarget = waitingReview && byKey.get(key(waitingReview));
              const target = pending ?? draft ?? checkpoint ?? reviewTarget ?? unknown;
              const isCheckpoint = !!checkpoint && target === checkpoint && !pending && !draft;
              const action = pending ? "Answer session" : draft ? "Continue draft" : isCheckpoint ? "Continue"
                : reviewTarget ? "Review session" : "Check terminal";
              const targetTitle = target && (details[key(target)]?.name || target.title);
              function openNext() {
                if (!target) { onLaunch([folder]); return; }
                if (!target.terminalId) {
                  showProjects([folder], "History");
                  setHistorySelection(key(target));
                  return;
                }
                showLiveAttention(target, false);
                if (target === unknown) selectView(key(target), "Terminal");
              }
              const menuId = `dashboard-project-menu-${index}`;
              const menuAction = (event: React.MouseEvent<HTMLButtonElement>, action: () => void) => {
                event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
                action();
              };
              return (
                <article key={folder} className="dashboard-project dashboard-project-card" hidden={!inScope(folder)}
                  data-attention={!!pending} data-working={working.length > 0}>
                  <div className="dashboard-project-content">
                    <div className="dashboard-project-heading">
                      <button className="dashboard-project-title" onClick={() => showProjects([folder], "Pick up")}
                        aria-label={`Focus project ${name(folder)}`} title={folder}>
                        <span className="dashboard-project-icon"><Icon name="folder" size={20} /></span>
                        <strong>{name(folder)}</strong>
                      </button>
                      <button className="dashboard-session-more" aria-label={`Actions for project ${name(folder)}`}
                        title="Project actions" popoverTarget={menuId}><Icon name="more" size={16} /></button>
                      <div className="dashboard-session-popover" id={menuId} popover="auto">
                        <button onClick={(event) => menuAction(event, () => showProjects([folder], "History"))}>Browse history</button>
                        {saved.length > 0 && <button onClick={(event) => menuAction(event, () => {
                          showProjects([folder], "History");
                          setAiReviewFolder(folder);
                        })}>AI history review</button>}
                        <button disabled={!connected || openingShell} onClick={(event) => menuAction(event,
                          () => void openProjectShell(folder))}>Open project shell</button>
                        {target && <button onClick={(event) => menuAction(event, () => onLaunch([folder]))}>New session</button>}
                      </div>
                    </div>
                    {working.length > 0 && <div className="dashboard-project-working">
                      {working.map((row) => {
                        const title = details[key(row)]?.name || row.title;
                        return <button key={key(row)} title={title} aria-label={`Inspect working session ${title}`}
                          onClick={() => {
                            selectLive(key(row));
                            dialog.current?.scrollTo({ top: 0 });
                          }}>
                          <SessionStatus state="working" />
                          <span>{title}</span>
                          {open && !focusedFolder && inScope(folder) && workingSince.has(row.terminalId!) &&
                            <WorkingDuration since={workingSince.get(row.terminalId!)!} />}
                          <Icon name="arrow" size={14} />
                        </button>;
                      })}
                    </div>}
                  </div>
                  <footer className="dashboard-project-actions">
                    <small>{targetTitle || (saved.length
                      ? `${saved.length} saved ${saved.length === 1 ? "conversation" : "conversations"}`
                      : "No saved conversations")}</small>
                    <button className="dashboard-project-next-action" onClick={openNext}
                      aria-label={target ? undefined : `New session in ${name(folder)}`}>{target ? action : "New session"}</button>
                  </footer>
                </article>
              );
            })}
          </div>
        </section>
        <div hidden={liveFirst || !!focusedFolder}>
          <DashboardCleanup suggestions={cleanup.filter((group) => group.sessions.length)} onOpen={onOpen} onCleanup={onCleanup} />
          {tests.length > 0 && <details className="dashboard-tests"><summary>Test sessions ({tests.length})</summary>{tests.map((row) => sessionRow(row))}</details>}
        </div>
      </div>
      {open && filePreview && <ProjectFileDialog source={filePreview.source} file={filePreview.file}
        onClose={() => setFilePreview(undefined)} />}
      {open && recentSelection && <RecentConversationDialog actions={recentRow ? recentSessionActions(recentRow) : undefined}
        onBack={() => closeRecentPreview(true)} onClose={() => closeRecentPreview(false)}>
        {recentRow ? conversationPreview(recentRow, true) : <p>This session is no longer available.</p>}
        {recentActionError && <p role="alert" className="dashboard-attention-feedback">{recentActionError}</p>}
      </RecentConversationDialog>}
      {open && reviewFolder && <ProjectSessionReview key={reviewFolder} project={name(reviewFolder)}
        rows={conversationSessions.filter((row) => row.cwd === reviewFolder && !row.terminalId)}
        details={details} protectedIds={new Set([...pins, ...attentionIDs, ...protectedSessions])}
        onClose={() => setReviewFolder("")} onOpen={onOpen} onEdit={onEdit} onHideHistory={onCleanup} />}
    </dialog>
  );
}
