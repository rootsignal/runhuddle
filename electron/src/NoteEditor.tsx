import { useEffect, useRef, useState } from "react";
import type { Note, NoteDraft } from "./types";

export function NoteEditor({
  initial,
  projects,
  onSaved,
  onCancel,
}: {
  initial: NoteDraft;
  projects: string[];
  onSaved: (note: Note) => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fixedProject = !!(draft.id || draft.source);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      className="note-editor"
      ref={dialog}
      aria-labelledby="note-editor-title"
      onCancel={(event) => {
        event.preventDefault();
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
        <h2 id="note-editor-title">{draft.id ? "Edit note" : "New note"}</h2>
        <label>
          Title
          <input
            autoFocus
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
        <div className="note-actions">
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
        </div>
      </form>
    </dialog>
  );
}
