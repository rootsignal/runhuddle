import { useCallback, useEffect, useRef, useState } from "react";

export type FollowUpDraft = { text: string; files: File[] };
export const emptyDraft: FollowUpDraft = { text: "", files: [] };

function openDrafts() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("runhuddle-dashboard", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("follow-ups", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function useDashboardDrafts() {
  const database = useRef<IDBDatabase>(null);
  const current = useRef<Record<string, FollowUpDraft>>({});
  const [drafts, setDrafts] = useState(current.current);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const unsaved = useRef(new Set<string>());

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const connection = await openDrafts();
        if (disposed) { connection.close(); return; }
        database.current = connection;
        const entries = await new Promise<(FollowUpDraft & { id: string })[]>((resolve, reject) => {
          const request = connection.transaction("follow-ups").objectStore("follow-ups").getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        if (disposed) return;
        current.current = Object.fromEntries(entries.map(({ id, text, files }) => [id, { text, files }]));
        setDrafts(current.current);
      } catch {
        if (!disposed) setError("Saved follow-up drafts couldn’t be loaded. Drafts may be lost when RunHuddle closes.");
      } finally {
        if (!disposed) setReady(true);
      }
    })();
    return () => { disposed = true; database.current?.close(); database.current = null; };
  }, []);

  const updateDraft = useCallback((id: string, update: (draft: FollowUpDraft) => FollowUpDraft) => {
    const draft = update(current.current[id] ?? emptyDraft);
    const next = { ...current.current };
    if (draft.text || draft.files.length) next[id] = draft;
    else delete next[id];
    current.current = next;
    setDrafts(next);

    try {
      const transaction = database.current?.transaction("follow-ups", "readwrite", { durability: "strict" });
      if (!transaction) throw Error("Draft storage is unavailable.");
      const store = transaction.objectStore("follow-ups");
      if (next[id]) store.put({ id, ...draft });
      else store.delete(id);
      transaction.oncomplete = () => {
        unsaved.current.delete(id);
        if (!unsaved.current.size) setError(undefined);
      };
      transaction.onabort = reportSaveError;
    } catch {
      reportSaveError();
    }

    function reportSaveError() {
      unsaved.current.add(id);
      setError("A follow-up draft couldn’t be saved. Close RunHuddle only after saving or sending your draft.");
    }
  }, []);

  return { drafts, updateDraft, ready, error };
}
