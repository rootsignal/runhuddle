import { useEffect, useRef } from "react";
import type { HiddenHistory, Session } from "./types";

export function HiddenHistoryDialog({ hidden, sessions, onRestore, onClose }: {
  hidden: HiddenHistory;
  sessions: Session[];
  onRestore: (kind: keyof HiddenHistory, id: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  const recordedSessions = new Map(sessions.map((row) => [row.provider + ":" + row.sessionID, row]));
  return (
    <dialog ref={dialog} className="appearance-dialog hidden-history" aria-labelledby="hidden-history-heading"
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <header>
        <h2 id="hidden-history-heading">Hidden projects and sessions</h2>
        <button aria-label="Close hidden history" onClick={onClose}>×</button>
      </header>
      <p>Restore an item to show it in RunHuddle again.</p>
      {!hidden.projects.length && !hidden.sessions.length && <p>No hidden projects or sessions.</p>}
      {hidden.projects.length > 0 && (
        <section aria-label="Hidden projects">
          <h3>Projects</h3>
          <ul>
            {hidden.projects.map((folder) => (
              <li key={folder}>
                <span title={folder}>{folder}</span>
                <button onClick={() => onRestore("projects", folder)}>Restore project</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {hidden.sessions.length > 0 && (
        <section aria-label="Hidden sessions">
          <h3>Sessions</h3>
          <ul>
            {hidden.sessions.map((id) => {
              const row = recordedSessions.get(id);
              return (
                <li key={id}>
                  <span title={row?.cwd}>{row ? row.provider + " · " + row.title : id}</span>
                  <button onClick={() => onRestore("sessions", id)}>Restore session</button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </dialog>
  );
}
