import { useEffect, useRef, useState } from "react";
import type { Session } from "./types";
export function SessionHistory({
  session,
  onSaveExcerpt,
}: {
  session: Session;
  onSaveExcerpt: (text: string) => void;
}) {
  const preparedExcerpt = useRef("");
  const [messages, setMessages] = useState<
    { role: string; text: string; time: string }[]
  >([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [truncated, setTruncated] = useState(false);
  const [query, setQuery] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setMessages([]);
    setError("");
    window.runhuddle
      .history(session.provider, session.sessionID)
      .then((result) => {
        if (active) {
          setMessages(result.messages);
          setTruncated(result.truncated);
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session.provider, session.sessionID, revision]);
  const shown = messages.filter((m) =>
    m.text.toLowerCase().includes(query.toLowerCase()),
  );
  function excerpt(article: HTMLElement, fallback: string) {
    const selection = window.getSelection();
    const message = article.querySelector(".preserve");
    return selection &&
      message?.contains(selection.anchorNode) &&
      message.contains(selection.focusNode) &&
      selection.toString().trim()
      ? selection.toString()
      : fallback;
  }
  return (
    <section className="conversation-history" aria-label="Conversation history">
      <div className="history-toolbar">
        <input
          type="search"
          aria-label="Find in conversation"
          placeholder="Find in conversation"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span>{messages.length ? `${shown.length} messages` : ""}</span>
        <button onClick={() => setRevision((n) => n + 1)} disabled={loading}>
          Refresh history
        </button>
      </div>
      {loading ? (
        <p role="status">Loading conversation…</p>
      ) : error ? (
        <p role="alert">Couldn't read the conversation. {error}</p>
      ) : messages.length ? (
        <>
          {truncated && (
            <p className="muted">
              Showing the most recent recorded messages. Older messages and tool
              activity may be omitted.
            </p>
          )}
          {!shown.length && <p>No messages match your search.</p>}
          {shown.map((m, i) => (
            <article className={"history-message " + m.role} key={i}>
              <header>
                <strong>{m.role === "user" ? "You" : session.provider}</strong>
                <div className="history-message-actions">
                  {m.time && <time>{new Date(m.time).toLocaleString()}</time>}
                  <button
                    type="button"
                    title="Save selected text or the entire message"
                    onPointerDown={(event) => {
                      const article = event.currentTarget.closest("article");
                      if (article)
                        preparedExcerpt.current = excerpt(article, m.text);
                    }}
                    onClick={(event) => {
                      const article = event.currentTarget.closest("article");
                      const selected = event.detail
                        ? preparedExcerpt.current
                        : "";
                      preparedExcerpt.current = "";
                      onSaveExcerpt(
                        selected ||
                          (article ? excerpt(article, m.text) : m.text),
                      );
                    }}
                  >
                    Save as note
                  </button>
                </div>
              </header>
              <div className="preserve">{m.text}</div>
            </article>
          ))}
        </>
      ) : (
        <div className="history-fallback">
          <p className="muted">
            Conversation history isn't available locally. You can still resume
            this session.
          </p>
          {session.preview && (
            <>
              <h3>Last recorded message</h3>
              <div className="preserve">{session.preview}</div>
              <button onClick={() => onSaveExcerpt(session.preview)}>
                Save as note
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
