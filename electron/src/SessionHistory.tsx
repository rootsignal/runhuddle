import { useEffect, useRef, useState } from "react";
import { SessionRecap } from "./SessionRecap";
import type { HistoryAnchor, Session, SessionRecap as Recap } from "./types";
export function SessionHistory({
  session,
  onSaveExcerpt,
  anchor,
  onLatest,
  recap,
}: {
  session: Session;
  onSaveExcerpt: (text: string) => void;
  anchor?: HistoryAnchor;
  onLatest: () => void;
  recap?: Recap;
}) {
  const preparedExcerpt = useRef("");
  const matched = useRef<HTMLElement>(null);
  const [messages, setMessages] = useState<
    { role: string; text: string; time: string; match?: boolean }[]
  >([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [truncated, setTruncated] = useState(false);
  const [matchMissing, setMatchMissing] = useState(false);
  const [query, setQuery] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => setQuery(""), [anchor]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setMessages([]);
    setError("");
    setMatchMissing(false);
    window.runhuddle
      .history(session.provider, session.sessionID, anchor)
      .then((result) => {
        if (active) {
          setMessages(result.messages);
          setTruncated(result.truncated);
          setMatchMissing(!!result.matchMissing);
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
  }, [session.provider, session.sessionID, revision, anchor]);
  useEffect(() => {
    if (!loading && anchor && matched.current) {
      matched.current.scrollIntoView({ block: "center" });
      matched.current.focus({ preventScroll: true });
    }
  }, [messages, loading, anchor]);
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
    <>
      {!anchor && <SessionRecap session={session} messages={messages} recap={recap} loading={loading} />}
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
          {anchor && <button onClick={onLatest}>Latest messages</button>}
        </div>
        {loading ? (
          <p role="status">Loading conversation…</p>
        ) : error ? (
          <p role="alert">Couldn't read the conversation. {error}</p>
        ) : matchMissing ? (
          <p role="status">
            This match has moved or is no longer in the conversation. Search again
            or open the latest messages.
          </p>
        ) : messages.length ? (
          <>
            {anchor ? (
              <p className="muted">Showing messages around the match.</p>
            ) : (
              truncated && (
                <p className="muted">
                  Showing the most recent recorded messages. Older messages and
                  tool activity may be omitted.
                </p>
              )
            )}
            {!shown.length && <p>No messages match your search.</p>}
            {shown.map((m, i) => (
              <article
                className={
                  "history-message " + m.role + (m.match ? " history-match" : "")
                }
                aria-label={m.match ? "Matching message" : undefined}
                tabIndex={m.match ? -1 : undefined}
                ref={m.match ? matched : undefined}
                key={i}
              >
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
    </>
  );
}
