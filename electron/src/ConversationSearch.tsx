import { useEffect, useState } from "react";
import type { HistorySearchResult } from "./types";
import { AgentIcon } from "./Icons";

export function ConversationSearch({
  query,
  folder,
  scope,
  onOpen,
}: {
  query: string;
  folder: string;
  scope: string;
  onOpen: (result: HistorySearchResult) => void;
}) {
  const search = query.trim().slice(0, 120);
  const [response, setResponse] = useState<{
    key: string;
    results: HistorySearchResult[];
    incomplete?: boolean;
    indexing?: boolean;
    failed?: boolean;
  }>();
  const key = JSON.stringify([search, folder, scope]);
  useEffect(() => {
    if (search.length < 2) return;
    let active = true;
    let running = false;
    let needsRefresh = false;
    async function searchIndex(refresh: boolean) {
      running = true;
      try {
        const result = await window.runhuddle.searchHistory(search, folder, scope, refresh);
        if (active) setResponse({ key, ...result });
      } catch {
        if (active) setResponse({ key, results: [], failed: true });
      } finally {
        running = false;
        if (active && needsRefresh) {
          needsRefresh = false;
          void searchIndex(false);
        }
      }
    }
    let started = false;
    const timer = setTimeout(() => {
      started = true;
      void searchIndex(true);
    }, 260);
    const unsubscribe = window.runhuddle.onEvent((event) => {
      if (!started || event.event !== "history-index-updated") return;
      if (running) needsRefresh = true;
      else void searchIndex(false);
    });
    return () => {
      active = false;
      clearTimeout(timer);
      unsubscribe();
      void window.runhuddle.cancelHistorySearch().catch(() => {});
    };
  }, [key, search, folder, scope]);
  if (search.length < 2) return null;
  const current = response?.key === key ? response : undefined;
  return (
    <section className="conversation-search" aria-label="Conversation matches">
      <div className="recency-label">In conversations</div>
      {!current ? (
        <p className="empty-small" role="status">
          Searching conversation history…
        </p>
      ) : current.failed ? (
        <p className="empty-small" role="status">
          Couldn’t search conversation history.
        </p>
      ) : (
        <>
          {current.results.map((result) => (
            <button
              className="conversation-result"
              key={result.provider + ":" + result.sessionID}
              onClick={() => onOpen(result)}
            >
              <AgentIcon agent={result.provider.toLowerCase()} />
              <span>
                <strong>{result.title}</strong>
                <small>{result.snippet}</small>
              </span>
            </button>
          ))}
          {!current.results.length && !current.indexing && (
            <p className="empty-small">No conversation matches.</p>
          )}
          {current.indexing && (
            <p className="empty-small" role="status">Indexing conversation history…</p>
          )}
          {current.incomplete && !current.indexing && (
            <p className="empty-small">
              Results may be incomplete. Try a project filter to narrow the
              search.
            </p>
          )}
        </>
      )}
    </section>
  );
}
