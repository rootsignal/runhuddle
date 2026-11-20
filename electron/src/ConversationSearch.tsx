import { useEffect, useState } from "react";
import type { HistorySearchResult } from "./types";
import { AgentIcon, Icon } from "./Icons";

function highlightedSnippet(snippet: string, search: string) {
  const words = [...new Set(search.toLowerCase().replaceAll('"', "").trim().split(/\s+/).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!words.length) return snippet;
  const escaped = words.map((word) => word.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&"));
  return snippet.split(new RegExp("(" + escaped.join("|") + ")", "gi")).map((part, index) =>
    index % 2 ? <mark key={index}>{part}</mark> : part);
}

const resultDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function ConversationSearch({
  query,
  sessionNames,
  scope,
  folders,
  detailed = false,
  onOpen,
}: {
  query: string;
  sessionNames: Record<string, { name: string }>;
  scope: string;
  folders?: string[];
  detailed?: boolean;
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
  const folderKey = JSON.stringify(folders ?? []);
  const key = JSON.stringify([search, scope, folderKey]);
  useEffect(() => {
    if (search.length < 2) return;
    const searchFolders: string[] = JSON.parse(folderKey);
    let active = true;
    let running = false;
    let needsRefresh = false;
    async function searchIndex(refresh: boolean) {
      running = true;
      try {
        const result = await window.runhuddle.searchHistory(search, searchFolders, scope, refresh);
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
  }, [key, search, scope, folderKey]);
  if (search.length < 2) return null;
  const current = response?.key === key ? response : undefined;
  return (
    <section className={`conversation-search${detailed ? " conversation-search-detailed" : ""}`} aria-label="Conversation matches">
      <div className="recency-label">{detailed ? "Message matches" : "In conversations"}
        {detailed && !!current?.results.length && <span> · {current.results.length}</span>}
      </div>
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
          {current.results.map((result) => {
            const customTitle = sessionNames[result.provider + ":" + result.sessionID]?.name;
            const rawTitle = result.title.trim();
            const title = customTitle || (!rawTitle || /^(?:\[Image #\d+\]\s*)+$|^<pasted_content\b/i.test(rawTitle)
              ? result.provider + " conversation" : rawTitle);
            const project = result.cwd?.split(/[\\/]/).filter(Boolean).at(-1);
            return <button
              className="conversation-result"
              key={result.provider + ":" + result.sessionID}
              onClick={() => onOpen(result)}
            >
              <AgentIcon agent={result.provider.toLowerCase()} />
              <span className="conversation-result-copy">
                <strong title={title}>{title}</strong>
                {detailed && <small className="conversation-result-meta">
                  {[project, result.provider, result.updated ? `Active ${resultDate.format(result.updated * 1000)}` : undefined]
                    .filter(Boolean).join(" · ")}
                </small>}
                <small className="conversation-result-excerpt">{detailed ? highlightedSnippet(result.snippet, search) : result.snippet}</small>
              </span>
              {detailed && <span className="conversation-result-open" title="Jump to matching message"><Icon name="arrow" size={16} /></span>}
            </button>;
          })}
          {!current.results.length && !current.indexing && (
            <p className="empty-small">No conversation matches.</p>
          )}
          {current.indexing && (
            <p className="empty-small" role="status">Indexing conversation history…</p>
          )}
          {current.incomplete && !current.indexing && (
            <p className="empty-small">
              Results may be incomplete. Try a more specific search.
            </p>
          )}
        </>
      )}
    </section>
  );
}
