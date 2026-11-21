import type { CSSProperties } from "react";
export function Icon({
  name,
  size = 18,
}: {
  name:
    | "notes"
    | "inbox"
    | "history"
    | "refresh"
    | "branch"
    | "changes"
    | "browser"
    | "terminal"
    | "plus"
    | "close"
    | "sidebar"
    | "layout"
    | "folder"
    | "chevron"
    | "search"
    | "arrow"
    | "activity"
    | "pause"
    | "disconnected"
    | "attention"
    | "lock"
    | "stop"
    | "play"
    | "archive"
    | "check"
    | "pencil"
    | "more"
    | "open-workspace";
  size?: number;
}) {
  const paths = {
    layout: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M13 4v16M13 12h8" /></>,
    browser: <><rect x="2.5" y="4" width="19" height="16" rx="2.5" /><path d="M3 9h18m-14-2h.1m3 0h.1" /></>,
    branch: <><circle cx="7" cy="5" r="2" /><circle cx="7" cy="19" r="2" /><circle cx="17" cy="7" r="2" /><path d="M7 7v10m10-8c0 5-4 6-10 6" /></>,
    refresh: <path d="M20 5v5h-5m4.4 0a7.5 7.5 0 1 0 .2 4.6" />,
    history: <path d="M3 4v5h5M3.8 9A8 8 0 1 1 4 16m8-8v4l3 2" />,
    inbox: <path d="M3 13l3-7h12l3 7v6H3Zm0 0h5l2 3h4l2-3h5" />,
    notes: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </>
    ),
    changes: (
      <>
        <circle cx="6" cy="5" r="2" />
        <circle cx="6" cy="19" r="2" />
        <circle cx="18" cy="5" r="2" />
        <path d="M6 7v10M18 7c0 6-12 4-12 10" />
      </>
    ),
    terminal: (
      <>
        <path d="m5 7 4 5-4 5M12 17h6" />
        <rect x="1.5" y="2.5" width="21" height="19" rx="3" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    sidebar: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16" />
      </>
    ),
    folder: <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11H3Z" />,
    chevron: <path d="m8 10 4 4 4-4" />,
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    activity: <path d="M2 12h4l3-6 5 12 3-6h5" />,
    pause: <><circle cx="12" cy="12" r="9" /><path d="M10 9v6m4-6v6" /></>,
    disconnected: <><circle cx="12" cy="12" r="9" /><path d="m6 18 12-12" /></>,
    attention: <path d="M12 9v4m0 3h.01M11 4 2.5 18a1 1 0 0 0 .9 1.5h17.2a1 1 0 0 0 .9-1.5L13 4a1.2 1.2 0 0 0-2 0Z" />,
    lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 5v1" /></>,
    pencil: <path d="m14 6 4 4M4 20l4.5-1 11-11a2.8 2.8 0 0 0-4-4l-11 11L4 20Z" />,
    "open-workspace": <path d="M13 4h7v7m0-7-9 9m-1-7H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />,
    more: <path d="M5 12h.01m7 0h.01m7 0h.01" strokeWidth="3" />,
    play: <path d="M8 5v14l11-7L8 5Z" />,
    archive: <><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v11h14V9m-9 4h4" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    stop: <rect x="5" y="5" width="14" height="14" rx="2" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
export const launchOptions = [
  {
    id: "claude",
    name: "Claude",
    label: "Claude session",
    detail: "Start a new conversation with Claude",
    glyph: "C",
    color: "#d8a88e",
  },
  {
    id: "codex",
    name: "Codex",
    label: "Codex session",
    detail: "Start a new conversation with Codex",
    glyph: "⌘",
    color: "#c4cbd1",
  },
  {
    id: "copilot",
    name: "Copilot",
    label: "Copilot session",
    detail: "Start a new conversation with Copilot",
    glyph: "Co",
    color: "#b6acd9",
  },
  {
    id: "shell",
    name: "Terminal",
    label: "Terminal",
    detail: "A plain shell for commands and dev servers",
    glyph: "",
    color: "#a9b6bf",
  },
];
export function AgentIcon({ agent }: { agent: string }) {
  const option = launchOptions.find((o) => o.id === agent.toLowerCase());
  return (
    <span
      className="agent-icon"
      style={{ "--agent-color": option?.color || "#b7bdc5" } as CSSProperties}
    >
      {agent === "shell" ? (
        <Icon name="terminal" size={16} />
      ) : (
        option?.glyph || agent.slice(0, 1)
      )}
    </span>
  );
}
