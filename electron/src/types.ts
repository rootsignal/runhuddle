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
export type AppEvent =
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
  commits?: { id: string; title: string }[];
  revision?: string;
  base?: string;
  root: string;
  branch: string;
  files: GitFile[];
}
export interface API {
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
