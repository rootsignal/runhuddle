export interface Session {
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
  id: string;
  title: string;
  cwd: string;
  agent: string;
  exited: boolean;
  exitCode?: number;
  sessionID?: string;
  legacy?: boolean;
  unavailable?: boolean;
}
export interface Snapshot {
  sessions: Session[];
  notes: Note[];
  pinned: string[];
  readAt: number | null;
  storeError: string | null;
  terminals: TerminalInfo[];
  home: string;
  connection?: "connected" | "reconnecting" | "disconnected";
}
export interface ScreenshotNotice {
  id: string;
  name: string;
  thumbnail: string;
}
export interface EditorChoice { id: string; name: string; application: string }
export interface Editors { editors: EditorChoice[]; preferred: string }
export type AppEvent =
  | { event: "screenshot"; screenshot: ScreenshotNotice }
  | { event: "screenshots-off" }
  | { event: "git"; cwd: string }
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
export interface API {
  screenshotPath(id: string): Promise<string>;
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
  ): Promise<{
    messages: { role: string; text: string; time: string }[];
    truncated: boolean;
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
  reconnect(): Promise<void>;
  snapshot(): Promise<Snapshot>;
  chooseFolder(): Promise<string | null>;
  create(cwd: string, agent: string): Promise<TerminalInfo>;
  link(provider: string, id: string, terminal: string): Promise<TerminalInfo>;
  title(id: string, title: string): Promise<void>;
  resume(provider: string, id: string): Promise<TerminalInfo | null>;
  archive(provider: string, id: string, archived: boolean): Promise<void>;
  replay(id: string): Promise<{ data: string; sequence: number }>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  close(id: string): Promise<boolean>;
  onEvent(callback: (event: AppEvent) => void): () => void;
}
declare global {
  interface Window {
    runhuddle: API;
  }
}
