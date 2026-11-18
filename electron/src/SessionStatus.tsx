import { Icon } from "./Icons";

const statuses = {
  working: { icon: "activity", label: "Working" },
  idle: { icon: "pause", label: "Idle" },
  needsInput: { icon: "attention", label: "Needs input" },
  disconnected: { icon: "disconnected", label: "Activity unavailable" },
  locked: { icon: "lock", label: "In use elsewhere" },
  saved: { icon: "notes", label: "Recorded session" },
  terminal: { icon: "terminal", label: "Terminal open" },
  ended: { icon: "stop", label: "Ended" },
} as const;

export function SessionStatus({ state }: { state: string }) {
  const variant = Object.hasOwn(statuses, state) ? state as keyof typeof statuses : "disconnected";
  const { icon, label } = statuses[variant];
  return (
    <span className={`session-status ${variant}`} role="img" aria-label={label} title={label}>
      <Icon name={icon} size={14} />
    </span>
  );
}
