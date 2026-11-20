import { useEffect, useMemo, useRef, useState } from "react";
import { ChangesPanel } from "./ChangesPanel";
import { BrowserPreview } from "./BrowserPreview";
import type { AttachmentTarget, InboxEntry, Note } from "./types";
import { Inbox } from "./Inbox";
import { Icon } from "./Icons";
export function WorkspaceTools({
  cwd,
  notes,
  selection,
  onSelectNote,
  onNewNote,
  showNotes,
  inbox,
  onInboxAction,
  attachmentTarget,
  browserEnabled,
  onReopenBrowserSession,
}: {
  cwd: string;
  notes: Note[];
  selection: string;
  onSelectNote: (id: string) => void;
  onNewNote: () => void;
  showNotes: number;
  inbox: InboxEntry[];
  onInboxAction: (id: string, action: "open" | "dismiss") => void;
  attachmentTarget?: AttachmentTarget;
  browserEnabled: boolean;
  onReopenBrowserSession: (id: string) => Promise<void>;
}) {
  useEffect(() => {
    void window.runhuddle.watchGit(cwd);
  }, [cwd]);
  const [open, setOpen] = useState(() => {
    const stored = localStorage.getItem("workspaceTool");
    return stored === "changes" || stored === "notes" || stored === "inbox" || stored === "browser" ? stored : "";
  });
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!showNotes) return;
    setOpen("notes");
    setQuery("");
  }, [showNotes]);
  const matching = useMemo(
    () =>
      open === "notes"
        ? query.trim()
          ? notes.filter((note) => matchesNote(note, query))
          : notes
        : [],
    [notes, open, query],
  );
  const inboxCount = inbox.length ? `${inbox.length} ${inbox.length === 1 ? "alert" : "alerts"}` : "";
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem("workspaceToolWidth"));
    return stored >= 260 && stored <= 700 ? stored : 360;
  });
  const [browserWidth, setBrowserWidth] = useState(() => {
    const stored = Number(localStorage.getItem("browserPreviewWidth"));
    return stored >= 300 && stored <= 850 ? stored : 510;
  });
  const isBrowser = open === "browser";
  const toolWidth = isBrowser ? browserWidth : width;
  const minWidth = isBrowser ? 300 : 260;
  const maxWidth = isBrowser ? 850 : 700;
  const drag = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    localStorage.setItem("workspaceTool", open);
  }, [open]);
  useEffect(() => {
    localStorage.setItem("workspaceToolWidth", String(width));
  }, [width]);
  useEffect(() => {
    localStorage.setItem("browserPreviewWidth", String(browserWidth));
  }, [browserWidth]);
  const resize = (value: number) =>
    (isBrowser ? setBrowserWidth : setWidth)(Math.max(minWidth, Math.min(maxWidth, value)));
  return (
    <>
      {open && (
        <div className="workspace-tool" style={{ width: toolWidth }}>
          <div
            className="tool-resizer"
            role="separator"
            aria-label="Resize tools panel"
            aria-orientation="vertical"
            aria-valuemin={minWidth}
            aria-valuemax={maxWidth}
            aria-valuenow={toolWidth}
            tabIndex={0}
            onPointerDown={(e) => {
              drag.current = { x: e.clientX, width: toolWidth };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (
                drag.current &&
                e.currentTarget.hasPointerCapture(e.pointerId)
              )
                resize(drag.current.width + drag.current.x - e.clientX);
            }}
            onPointerUp={(e) => {
              drag.current = null;
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onDoubleClick={() => resize(isBrowser ? 510 : 360)}
            onKeyDown={(e) => {
              if (["ArrowLeft", "ArrowRight", "Home"].includes(e.key)) {
                e.preventDefault();
                resize(
                  e.key === "Home"
                    ? (isBrowser ? 510 : 360)
                    : toolWidth + (e.key === "ArrowLeft" ? 20 : -20),
                );
              }
            }}
          />
          {open === "changes" ? (
            <ChangesPanel cwd={cwd} onClose={() => setOpen("")} />
          ) : isBrowser ? (
            <BrowserPreview enabled={browserEnabled} target={attachmentTarget} onReopenSession={onReopenBrowserSession} onClose={() => setOpen("")} />
          ) : open === "inbox" ? (
            <Inbox
              entries={inbox}
              onAction={onInboxAction}
              onClose={() => setOpen("")}
            />
          ) : (
            <section className="notes-panel" aria-label="Saved notes">
              <header>
                <strong>Notes</strong>
                <button onClick={onNewNote}>New note</button>
                <button aria-label="Close notes" onClick={() => setOpen("")}>
                  ×
                </button>
              </header>
              <input
                type="search"
                aria-label="Search notes"
                placeholder="Search notes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div>
                {matching.map((n) => (
                  <button
                    key={n.id}
                    className={
                      "session-row " +
                      (selection === "note:" + n.id ? "selected" : "")
                    }
                    onClick={() => onSelectNote(n.id)}
                  >
                    <strong>{n.title}</strong>
                    <small>
                      {[
                        n.project.split(/[\\/]/).filter(Boolean).at(-1),
                        n.sourceProvider,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Personal note"}
                    </small>
                  </button>
                ))}
                {!matching.length && (
                  <p className="empty-small">
                    {notes.length
                      ? "No notes match your search."
                      : "Save a project note or an excerpt from a conversation."}
                  </p>
                )}
              </div>
            </section>
          )}
        </div>
      )}
      <nav className="tools-rail" aria-label="Workspace tools">
        <button
          className="inbox-toggle"
          title={inboxCount ? `Inbox · ${inboxCount}` : "Inbox"}
          data-tour-anchor="inbox"
          aria-label="Inbox"
          aria-description={inboxCount || undefined}
          aria-pressed={open === "inbox"}
          onClick={() => setOpen(open === "inbox" ? "" : "inbox")}
        >
          <Icon name="inbox" size={19} />
          {inbox.length > 0 && (
            <span className="inbox-badge" aria-hidden="true">
              {Math.min(inbox.length, 99)}
              {inbox.length > 99 ? "+" : ""}
            </span>
          )}
        </button>
        <button
          title="Changes"
          data-tour-anchor="changes"
          aria-label="Changes"
          aria-pressed={open === "changes"}
          onClick={() => setOpen(open === "changes" ? "" : "changes")}
        >
          <Icon name="changes" size={19} />
        </button>
        <button
          title="Notes"
          data-tour-anchor="notes"
          aria-label="Notes"
          aria-pressed={open === "notes"}
          onClick={() => setOpen(open === "notes" ? "" : "notes")}
        >
          <Icon name="notes" size={19} />
        </button>
        <button
          data-tour-anchor="browser"
          title="Browser"
          aria-label="Browser"
          aria-pressed={isBrowser}
          onClick={() => setOpen(isBrowser ? "" : "browser")}
        >
          <Icon name="browser" size={19} />
        </button>
      </nav>
    </>
  );
}

export function matchesNote(note: Note, query: string) {
  const fields = [
    note.title,
    note.text,
    note.project,
    note.sourceProvider,
    note.sourceTitle,
  ]
    .join("\n")
    .toLowerCase();
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .every((word) => fields.includes(word));
}
