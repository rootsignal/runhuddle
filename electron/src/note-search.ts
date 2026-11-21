import type { Note } from "./types";

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
