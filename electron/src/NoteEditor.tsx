import { useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./Icons";
import type { Note, NoteDraft } from "./types";

export function NoteEditor({
  initial,
  projects,
  sourceTitle,
  onSaved,
  onCancel,
}: {
  initial: NoteDraft;
  projects: string[];
  sourceTitle?: string;
  onSaved: (note: Note) => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fixedProject = !!(draft.id || draft.source);
  useLayoutEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement;
    element.showModal();
    element.querySelector<HTMLElement>("input")?.focus();
    return () => {
      element.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      className="note-editor"
      ref={dialog}
      aria-labelledby="note-editor-title"
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!busy) onCancel();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || !draft.title.trim() || !draft.text.trim()) return;
          setBusy(true);
          setError("");
          try {
            onSaved(await window.runhuddle.saveNote(draft));
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setBusy(false);
          }
        }}
      >
        <header>
          <h2 id="note-editor-title">{draft.id ? "Edit note" : "New note"}</h2>
          <button type="button" aria-label="Close note editor" disabled={busy} onClick={onCancel}><Icon name="close" size={17} /></button>
        </header>
        {sourceTitle && <div className="note-source-card">
          <Icon name="history" size={17} />
          <div><small>Source conversation</small><strong>{sourceTitle}</strong></div>
        </div>}
        <label>
          Title
          <input
            value={draft.title}
            maxLength={120}
            required
            onChange={(event) =>
              setDraft({ ...draft, title: event.target.value })
            }
          />
        </label>
        {fixedProject ? (
          draft.project && <p className="muted">{draft.project}</p>
        ) : (
          <label>
            Project
            <select
              value={draft.project || ""}
              onChange={(event) =>
                setDraft({ ...draft, project: event.target.value })
              }
            >
              <option value="">No project</option>
              {[...new Set([...projects, initial.project].filter(Boolean))].map(
                (project) => (
                  <option key={project} value={project}>
                    {project}
                  </option>
                ),
              )}
            </select>
          </label>
        )}
        <label className="note-editor-body">
          Note text
          <textarea
            value={draft.text}
            rows={10}
            maxLength={100000}
            required
            onChange={(event) =>
              setDraft({ ...draft, text: event.target.value })
            }
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer className="note-actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={busy || !draft.title.trim() || !draft.text.trim()}
            type="submit"
          >
            {busy ? "Saving…" : "Save note"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
