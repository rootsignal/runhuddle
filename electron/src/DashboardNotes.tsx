import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./Icons";
import { matchesNote } from "./note-search";
import type { Note, NoteDraft } from "./types";

export function DashboardNotes({ notes, folder, onEdit, onSource, onClose }: {
  notes: Note[];
  folder: string;
  onEdit: (draft: NoteDraft) => void;
  onSource: (note: Note) => boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const menuID = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [feedback, setFeedback] = useState("");
  const matching = notes.filter((note) => (!folder || note.project === folder) && matchesNote(note, query));
  const note = matching.find((item) => item.id === selected) ?? matching[0];
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    element.querySelector<HTMLElement>("input[type=search]")?.focus();
    return () => element.close();
  }, []);
  async function act(note: Note, action: "copy" | "export") {
    setFeedback("");
    try {
      await window.runhuddle.noteAction(note.id, action);
      if (action === "copy") setFeedback("Note copied.");
    } catch (reason) {
      setFeedback((reason instanceof Error ? reason.message : String(reason))
        .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""));
    }
  }
  return <dialog ref={dialog} className="appearance-dialog dashboard-notes" aria-label="Saved notes"
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
    <header>
      <div><h2>Notes</h2>{folder && <small title={folder}>{folder.split(/[\\/]/).filter(Boolean).at(-1)}</small>}</div>
      <button className="primary" onClick={() => onEdit({ title: "", text: "", project: folder })}>New note</button>
      <button className="dashboard-tool-icon" aria-label="Close notes" onClick={onClose}><Icon name="close" size={17} /></button>
    </header>
    <div className="dashboard-notes-body">
      <div className="dashboard-notes-list">
        <input autoFocus type="search" aria-label="Search notes" placeholder="Search notes"
          value={query} onChange={(event) => { setQuery(event.target.value); setFeedback(""); }} />
        {matching.map((item) => <button key={item.id} aria-current={item.id === note?.id}
          onClick={() => { setSelected(item.id); setFeedback(""); }}>
          <strong>{item.title}</strong>
          {item.sourceSessionID ? <small className="note-list-source">
            <Icon name="history" size={13} /> {item.sourceTitle || item.sourceProvider || "Source conversation"}
          </small> : !folder && item.project && <small>{item.project.split(/[\\/]/).filter(Boolean).at(-1)}</small>}
        </button>)}
        {!matching.length && <p>{query.trim() ? "No matching notes." : "No saved notes."}</p>}
      </div>
      {note && <article className="dashboard-note-detail">
        <header>
          <h3>{note.title}</h3>
          <button className="secondary" onClick={() => onEdit({ id: note.id, title: note.title, text: note.text, project: note.project })}>Edit note</button>
          <button className="dashboard-tool-icon" aria-label="More note actions" title="More note actions" popoverTarget={menuID}>
            <Icon name="more" size={17} />
          </button>
          <div id={menuID} popover="auto" className="dashboard-session-popover note-action-menu" aria-label="Note actions">
            <button onClick={(event) => { event.currentTarget.parentElement?.hidePopover(); void act(note, "copy"); }}>Copy note</button>
            <button onClick={(event) => { event.currentTarget.parentElement?.hidePopover(); void act(note, "export"); }}>Export Markdown…</button>
          </div>
        </header>
        {note.sourceSessionID && <div className="note-source-card">
          <Icon name="history" size={17} />
          <div><small>Source conversation</small><strong>{note.sourceTitle || note.sourceProvider || "Saved conversation"}</strong></div>
          <button onClick={() => {
            if (!onSource(note)) setFeedback("The source conversation is unavailable or hidden.");
          }}>View source conversation</button>
        </div>}
        {feedback && <p role="status">{feedback}</p>}
        <div className="note-content preserve">{note.text}</div>
      </article>}
    </div>
  </dialog>;
}
