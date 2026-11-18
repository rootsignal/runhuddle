import { useRef, useState } from "react";
import recapModels from "../main/recap-models.json";
import type { Session, SessionRecap as Recap } from "./types";

type Agent = keyof typeof recapModels;
const agents = Object.keys(recapModels) as Agent[];
const snippet = (text: string) => {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 220 ? compact.slice(0, 220) + "…" : compact;
};

export function SessionRecap({
  session,
  messages,
  recap,
  loading,
}: {
  session: Session;
  messages: { role: string; text: string }[];
  recap?: Recap;
  loading: boolean;
}) {
  const [agent, setAgent] = useState<Agent>(() => {
    const last = localStorage.getItem("recapAgent");
    return agents.find((value) => value === last)
      ?? agents.find((value) => recapModels[value].agent === session.provider)
      ?? "codex";
  });
  const [configuring, setConfiguring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const action = useRef<HTMLButtonElement>(null);
  const { provider, sessionID } = session;
  const latest = [...messages].reverse();
  const prompt = latest.find((message) => message.role === "user");
  const reply = latest.find((message) => message.role === "assistant");
  const excerpts = [
    ...(prompt ? [{ label: "Last prompt", text: prompt.text }] : []),
    ...(reply ? [{ label: "Latest reply", text: reply.text }] : []),
  ];
  if (!excerpts.length && session.preview)
    excerpts.push({ label: "Last recorded activity", text: session.preview });
  if (!recap && !excerpts.length && !configuring) return null;
  const excerptList = (
    <dl className="recap-excerpts">
      {excerpts.map(({ label, text }) => (
        <div key={label}>
          <dt>{label}</dt><dd title={snippet(text)}>{snippet(text)}</dd>
        </div>
      ))}
    </dl>
  );
  const model = recapModels[agent];
  function closeOptions() {
    setConfiguring(false);
    setError("");
    action.current?.focus();
  }
  async function generate() {
    setBusy(true);
    setError("");
    try {
      await window.runhuddle.generateRecap(provider, sessionID, agent);
      localStorage.setItem("recapAgent", agent);
      closeOptions();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setError(detail.replace(/^Error invoking remote method 'generate-recap': Error: /, ""));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="session-recap" aria-labelledby="session-recap-heading">
      <header className="recap-heading">
        <h2 id="session-recap-heading">Where we left off</h2>
        {(messages.length > 0 || configuring) && (
          <button
            ref={action}
            aria-expanded={configuring}
            aria-controls={configuring ? "recap-generation" : undefined}
            disabled={loading}
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) configuring ? closeOptions() : setConfiguring(true);
            }}
          >
            {recap ? "Refresh recap…" : "Generate recap…"}
          </button>
        )}
      </header>
      {recap && <>
        <dl className="recap-summary">
          {recap.done && <div><dt>Done</dt><dd>{recap.done}</dd></div>}
          {recap.pending && <div><dt>Pending</dt><dd>{recap.pending}</dd></div>}
          {recap.next && <div><dt>Next</dt><dd>{recap.next}</dd></div>}
        </dl>
        <small className="muted" title={new Date(recap.generatedAt).toLocaleString()}>
          {recap.agent}{recap.model && " · " + recap.model}
          {session.updated > recap.sourceUpdated && " · Session activity since this recap"}
        </small>
      </>}
      {excerpts.length > 0 && (recap ? (
        <details>
          <summary>Latest recorded messages</summary>
          {excerptList}
        </details>
      ) : excerptList)}
      {configuring && (
        <form id="recap-generation" className="recap-generation"
          onSubmit={(event) => { event.preventDefault(); if (!busy && !loading) void generate(); }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !busy && !event.defaultPrevented) closeOptions();
          }}
        >
          <div className="recap-actions">
            <label>
              Recap agent
              <select autoFocus value={agent} onChange={(event) => setAgent(event.target.value as Agent)} disabled={busy}>
                {agents.map((value) => (
                  <option key={value} value={value}>
                    {recapModels[value].agent} · {recapModels[value].label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="secondary" disabled={busy || loading || !messages.length}>Generate</button>
            <button type="button" onClick={() => {
              if (busy) void window.runhuddle.cancelRecap(provider, sessionID).catch(() => {});
              else closeOptions();
            }}>Cancel</button>
          </div>
          {busy ? <small role="status">Generating with {model.agent} · {model.label}…</small> : (
            <small className="muted">Sends recent messages to {model.agent} using your CLI account.</small>
          )}
          {error && <div className="recap-error" role="alert">{error}</div>}
        </form>
      )}
    </section>
  );
}
