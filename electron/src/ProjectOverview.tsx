import { useEffect, useRef, useState } from "react";
import { AgentIcon } from "./Icons";
import type { Session } from "./types";

export function ProjectOverview({ name, folder, sessions, running, notes, onSelect, onFocus, onLaunch, onClose }: {
  name: string;
  folder: string;
  sessions: Session[];
  running: number;
  notes: number;
  onSelect: (session: Session) => void;
  onFocus: () => void;
  onLaunch: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [repository, setRepository] = useState<string>();
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  useEffect(() => {
    let active = true;
    void window.runhuddle.gitChanges(folder).then((status) => {
      const changed = new Set(status.files.map((file) => file.path)).size;
      if (active) setRepository(`${status.branch} · ${changed} changed`);
    }, () => {
      if (active) setRepository("");
    });
    return () => { active = false; };
  }, [folder]);
  return (
    <dialog className="appearance-dialog project-overview" ref={dialog} aria-labelledby="project-overview-heading"
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <header>
        <h2 id="project-overview-heading">{name}</h2>
        <button aria-label="Close project overview" onClick={onClose}>×</button>
      </header>
      <p className="project-overview-path">{folder}</p>
      <dl className="project-overview-stats">
        <div><dt>Sessions</dt><dd>{sessions.length}</dd></div>
        <div><dt>Running terminals</dt><dd>{running}</dd></div>
        <div><dt>Notes</dt><dd>{notes}</dd></div>
        {repository && <div><dt>Git</dt><dd>{repository}</dd></div>}
      </dl>
      <section aria-label="Recent project sessions">
        <h3>Recent sessions</h3>
        {sessions.length === 0 && <p>No recorded conversations in this folder.</p>}
        {sessions.slice(0, 5).map((session) => (
          <button key={session.provider + ":" + session.sessionID} className="session-row"
            onClick={() => onSelect(session)}>
            <AgentIcon agent={session.provider.toLowerCase()} />
            <strong>{session.title}</strong>
          </button>
        ))}
      </section>
      <footer>
        <button onClick={onLaunch}>New session</button>
        <button className="primary" onClick={onFocus}>Focus project</button>
      </footer>
    </dialog>
  );
}
