import type { CSSProperties } from "react";
export function Icon({
  name,
  size = 18,
}: {
  name:
    | "terminal"
    | "plus"
    | "close"
    | "sidebar"
    | "folder"
    | "chevron"
    | "search"
    | "arrow";
  size?: number;
}) {
  const paths = {
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
