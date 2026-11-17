export interface Session {
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
}
export interface Snapshot {
  sessions: Session[];
  notes: Note[];
  pinned: string[];
  readAt: number | null;
  storeError: string | null;
  terminals: TerminalInfo[];
  home: string;
}
export type AppEvent =
  | { event: "output"; id: string; data: string; sequence: number }
  | { event: "terminals"; terminals: TerminalInfo[] }
  | ({ event: "store" } & Omit<Snapshot, "home" | "terminals">)
  | { event: "error"; message: string };
export interface API {
  snapshot(): Promise<Snapshot>;
  chooseFolder(): Promise<string | null>;
  create(cwd: string, agent: string): Promise<TerminalInfo>;
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
