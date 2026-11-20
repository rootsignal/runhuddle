import { Icon } from "./Icons";

const statuses = {
  working: { icon: "activity", label: "Working" },
  permission: { icon: "attention", label: "Permission required" },
  review: { icon: "inbox", label: "Ready to review" },
  idle: { icon: "pause", label: "Idle" },
  needsInput: { icon: "attention", label: "Needs input" },
  unknownActivity: { icon: "terminal", label: "Status unknown" },
  disconnected: { icon: "disconnected", label: "Activity unavailable" },
  locked: { icon: "lock", label: "In use elsewhere" },
  saved: { icon: "notes", label: "Recorded session" },
  terminal: { icon: "terminal", label: "Terminal open" },
  ended: { icon: "stop", label: "Ended" },
} as const;

function statusVariant(state: string) {
  return Object.hasOwn(statuses, state) ? state as keyof typeof statuses : "disconnected";
}
export function SessionStatus({ state, showLabel = false }: { state: string; showLabel?: boolean }) {
  const variant = statusVariant(state);
  const { icon, label } = statuses[variant];
  return (
    <span className={`session-status ${variant}${showLabel ? " with-label" : ""}`} role="img" aria-label={label} title={label}>
      <Icon name={icon} size={14} />
      {showLabel && <span>{label}</span>}
    </span>
  );
}
