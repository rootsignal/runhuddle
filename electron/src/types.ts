export type ProjectFilePreview = { path: string; markdown: boolean; text: string; truncated: boolean };

export interface Session {
  guardianReview?: boolean;
  terminalId?: string;
  provider: string;
  sessionID: string;
  title: string;
  cwd: string;
  project: string;
  preview: string;
  state: string;
  updated: number;
}
export interface Note {
  id: string;
  title: string;
  text: string;
  project: string;
  sourceProvider: string;
  sourceSessionID?: string;
  sourceTitle?: string;
}
export interface NoteDraft {
  id?: string;
  title: string;
  text: string;
  project?: string;
  source?: Pick<Session, "provider" | "sessionID">;
}
export interface TerminalInfo {
  browserTools?: boolean;
  id: string;
  title: string;
  cwd: string;
  agent: string;
  exited: boolean;
  exitCode?: number;
  sessionID?: string;
  unavailable?: boolean;
}
export interface SessionRecap {
  done: string;
  pending: string;
  next: string;
  agent: string;
  model?: string;
  generatedAt: number;
  sourceUpdated: number;
}
export interface HiddenHistory {
  projects: string[];
  sessions: string[];
}
export type UpdateDownload = { version: string; percent: number | null };
export interface Snapshot {
  accent?: string;
  appTheme?: "system" | "light" | "dark";
  updateDownload?: UpdateDownload | null;
  sessions: Session[];
  notes: Note[];
  pinned: string[];
  hidden?: HiddenHistory;
  continuations?: ContinuationLink[];
  terminals: TerminalInfo[];
  home: string;
  keepAwakeActive?: boolean;
  connection?: "connected" | "reconnecting" | "disconnected";
  compactShell?: boolean | null;
  terminalServiceUpdate?: boolean;
  openAlert?: SessionAlertTarget;
  inbox?: InboxEntry[];
  recaps?: Record<string, SessionRecap>;
}
export type SessionAlertTarget = Pick<Session, "provider" | "sessionID">;
export type ContinuationEndpoint = SessionAlertTarget & { title: string };
export interface ContinuationLink {
  from: ContinuationEndpoint;
  to: ContinuationEndpoint;
  createdAt: number;
}
export interface SessionAlert {
  provider?: string;
  sessionID?: string;
  title: string;
  body: string;
  inboxId?: string;
}
export type InboxQuestion = { text: string; choices: string[] };
export type PreviewTurn = { instruction?: string; screenshots?: number; instructionAt?: number; update?: string; answer?: string; truncated?: boolean };
export type InboxPreview = PreviewTurn & { questions?: InboxQuestion[]; recentTurns?: PreviewTurn[] };
export interface InboxEntry extends SessionAlertTarget {
  id: string;
  kind: "input" | "completion";
  body: string;
  createdAt: number;
}
export interface ScreenshotNotice {
  id: string;
  name: string;
  thumbnail: string;
}
export interface BrowserPreviewState {
  agentSession: string | null;
  url: string;
  title: string;
  loading: boolean;
  ready: boolean;
  back: boolean;
  forward: boolean;
  error: string;
}
export type AttachmentTarget = { id: string; title: string; busy: boolean; locked?: boolean; needsInput?: boolean; canResume?: boolean; browserTools?: boolean };
export interface EditorChoice { id: string; name: string; application: string }
export interface Editors { editors: EditorChoice[]; preferred: string }
export type KeyboardBindings = { palette: string; terminal: string };
export type DashboardCommand = "dashboard" | "workspace" | "new-session" | "projects" | "recent" |
  "next-review" | "next-attention" | "return-session" | "open-browser";
export type DashboardRequest = { command: DashboardCommand } | { command: "open-project"; folder: string } | { command: "open-session"; session: string };
export type AppCommand = DashboardCommand | "command-palette" | "quick-terminal" | "keyboard-shortcuts";

export type AppEvent =
  | { event: "keep-awake"; active: boolean }
  | { event: "dashboard-command"; command: AppCommand }
  | { event: "app-accent"; accent: string }
  | { event: "app-theme"; theme: "system" | "light" | "dark" }
  | { event: "update-download"; download: UpdateDownload | null }
  | { event: "session-continuations"; continuations: ContinuationLink[] }
  | { event: "custom-app-accent" }
  | { event: "inbox"; entries: InboxEntry[] }
  | { event: "open-alert-session"; target: SessionAlertTarget }
  | { event: "session-alert"; key: string; alert: SessionAlert }
  | { event: "dismiss-session-alert"; key: string }
  | { event: "clear-session-alerts" }
  | { event: "screenshot"; screenshot: ScreenshotNotice }
  | { event: "screenshots-off" }
  | { event: "browser-preview"; state: BrowserPreviewState }
  | { event: "getting-started" }
  | { event: "git"; cwd: string }
  | { event: "history-index-updated" }
  | { event: "recap"; key: string; recap: SessionRecap }
  | { event: "terminal-size"; id: string; sequence: number; cols: number; rows: number }
  | { event: "output"; id: string; data: string; sequence: number }
  | { event: "terminals"; terminals: TerminalInfo[] }
  | ({ event: "store" } & Omit<Snapshot, "home" | "terminals">)
  | {
      event: "connection";
      state: "connected" | "reconnecting" | "disconnected";
    }
  | { event: "error"; message: string };
export interface GitFile {
  path: string;
  previous?: string;
  status: string;
  area: "staged" | "unstaged" | "untracked" | "committed";
}
export interface GitChanges {
  upstream?: string;
  ahead?: number;
  behind?: number;
  commits?: { id: string; title: string }[];
  revision?: string;
  base?: string;
  root: string;
  branch: string;
  files: GitFile[];
}
export interface UsageInfo {
  provider: string; windows: { label: string; remaining: number; resetsAt: string }[];
  checkedAt?: string; credits?: string | null; message?: string;
}
export interface ProjectHistoryReview {
  reviewed: number;
  total: number;
  suggestions: { next: string; updated: number; source: HistorySearchResult }[];
}
export interface API {
  cancelProjectHistoryReview(folder: string): Promise<void>;
  installedReviewAgents(): Promise<string[]>;
  reviewProjectHistory(folder: string, agent: string): Promise<ProjectHistoryReview>;
  generateRecap(provider: string, id: string, agent: string): Promise<SessionRecap>;
  cancelRecap(provider: string, id: string): Promise<void>;
  searchHistory(query: string, folder: string | string[], scope: string, refresh?: boolean): Promise<{ results: HistorySearchResult[]; incomplete: boolean; indexing?: boolean }>;
  cancelHistorySearch(): Promise<void>;
  codexPromptReady(id: string, terminalId: string): Promise<boolean>;
  liveSessionPreview(provider: string, id: string, terminalId: string): Promise<InboxPreview>;
  liveSessionFollowUp(provider: string, id: string, terminalId: string, message: string, screenshots?: ArrayBuffer[], queued?: boolean): Promise<void>;
  screenshotDraft(id: string): Promise<Uint8Array<ArrayBuffer>>;
  copyInboxReply(id: string, text: string): Promise<void>;
  inboxPreview(id: string): Promise<InboxPreview>;
  inboxAction(id: string, action: "open" | "dismiss"): Promise<boolean>;
  reopenBrowserSession(id: string): Promise<TerminalInfo | null>;
  previewProjectFile(provider: string, id: string, file: string): Promise<ProjectFilePreview>;
  openTerminalLink(url: string): Promise<void>;
  setAppAccent(accent: string): Promise<void>;
  locateCodexSession(id: string): Promise<void>;
  viewedTerminal(id: string | null): Promise<void>;
  screenshotPath(id: string): Promise<string>;
  browserState(): Promise<BrowserPreviewState>;
  browserLayout(rect: { x: number; y: number; width: number; height: number } | null): Promise<void>;
  navigateBrowser(url: string): Promise<BrowserPreviewState>;
  browserAction(action: "back" | "forward" | "reload"): Promise<void>;
  browserAgent(id: string | null): Promise<void>;
  captureBrowser(): Promise<{ file: string; screenshot: string }>;
  copyScreenshotPath(id: string): Promise<void>;
  usage(provider: string): Promise<UsageInfo>;
  connectClaudeUsage(enable: boolean): Promise<boolean>;
  editors(): Promise<Editors>;
  chooseEditor(): Promise<Editors | null>;
  openEditor(id: string, target: string, line?: number): Promise<void>;
  watchGit(cwd: string): Promise<void>;
  gitAction(cwd: string, action: "stage" | "unstage" | "stage-all" | "unstage-all" | "commit" | "push", input?: string): Promise<GitChanges>;
  noteAction(id: string, action: "copy" | "export"): Promise<void>;
  saveNote(draft: NoteDraft): Promise<Note>;
  history(
    provider: string,
    id: string,
    anchor?: HistoryAnchor,
  ): Promise<{
    messages: { role: string; text: string; time: string; match?: boolean }[];
    truncated: boolean;
    matchMissing?: boolean;
    unavailable?: boolean;
  }>;
  openFolder(cwd: string, target: "folder"): Promise<void>;
  gitChanges(
    cwd: string,
    mode?: string,
    revision?: string,
  ): Promise<GitChanges>;
  gitDiff(
    cwd: string,
    file: string,
    area: string,
    mode?: string,
    revision?: string,
  ): Promise<string>;
  keyboardShortcuts(): Promise<KeyboardBindings>;
  saveKeyboardShortcuts(value: KeyboardBindings): Promise<KeyboardBindings>;
  recordKeyboardShortcuts(recording: boolean): Promise<void>;
  reconnect(): Promise<void>;
  snapshot(): Promise<Snapshot>;
  chooseFolder(): Promise<string | null>;
  create(cwd: string, agent: string, compactShell?: boolean): Promise<TerminalInfo>;
  pinSession(provider: string, id: string, pinned: boolean): Promise<void>;
  setSessionsHidden(ids: string[], hidden: boolean): Promise<string[]>;
  setHistoryHidden(kind: keyof HiddenHistory, id: string, hidden: boolean): Promise<void>;
  recordSessionContinuation(from: SessionAlertTarget, to: SessionAlertTarget, title: string): Promise<boolean>;
  title(id: string, title: string): Promise<void>;
  resume(provider: string, id: string): Promise<TerminalInfo | null>;
  replay(id: string): Promise<{ data: string; sequence: number; cols?: number; rows?: number; sizes?: { offset: number; cols: number; rows: number }[] }>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  close(id: string): Promise<boolean>;
  updateTerminalService(): Promise<void>;
  onEvent(callback: (event: AppEvent) => void): () => void;
}
export interface HistoryAnchor { offset: number; fingerprint: string; textOffset: number }
export interface HistorySearchResult extends SessionAlertTarget {
  title: string;
  cwd?: string;
  updated?: number;
  snippet: string;
  anchor: HistoryAnchor;
}
declare global {
  interface Window {
    runhuddle: API;
  }
}
