import { useState } from "react";
import recapModels from "../main/recap-models.json";
import type { HistorySearchResult, ProjectHistoryReview as Review, Session } from "./types";

const agents = Object.keys(recapModels) as (keyof typeof recapModels)[];
const sessionKey = (row: Pick<Session, "provider" | "sessionID">) => row.provider + ":" + row.sessionID;

export function ProjectHistoryReview({
  folder, rows, available, detectionFailed, onRetryDetection, preferredAgent, onPreferredAgent, onEvidence,
}: {
  folder: string;
  rows: Session[];
  available?: string[];
  detectionFailed: boolean;
  onRetryDetection: () => void;
  preferredAgent: string;
  onPreferredAgent: (agent: string) => void;
  onEvidence: (result: HistorySearchResult) => void;
}) {
  const [configuring, setConfiguring] = useState(false);
  const choices = agents.filter((agent) => available?.includes(agent));
  const agent = choices.find((name) => name === preferredAgent) ??
    choices.find((name) => recapModels[name].agent === rows[0]?.provider) ?? choices[0];
  const [runningAgent, setRunningAgent] = useState<string>();
  const busy = !!runningAgent;
  const [result, setResult] = useState<Review>();
  const [error, setError] = useState("");
  const suggestions = result?.suggestions.filter(({ source, updated }) =>
    rows.some((row) => sessionKey(row) === sessionKey(source) && row.updated === updated));

  async function review() {
    if (!agent || busy) return;
    setConfiguring(false);
    setRunningAgent(recapModels[agent].agent);
    setResult(undefined);
    setError("");
    try {
      setResult(await window.runhuddle.reviewProjectHistory(folder, agent));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message.replace(/^Error invoking remote method '[^']+': Error: /, ""));
    } finally {
      setRunningAgent(undefined);
    }
  }

  return <div className="dashboard-project-review">
    <div className="dashboard-project-review-controls">
      {busy ? <small role="status">Reviewing with {runningAgent}…</small> : agent ? <>
        <button onClick={() => void review()} title={`Sends recent messages to ${recapModels[agent].agent} using your CLI account.`}>
          {result ? "Review again with" : "Review with"} {recapModels[agent].agent}
        </button>
        {choices.length > 1 && <button aria-expanded={configuring} onClick={() => setConfiguring(!configuring)}>
          Change agent
        </button>}
        {configuring && choices.length > 1 && <label>Preferred review agent
          <select value={agent} onChange={(event) => { onPreferredAgent(event.currentTarget.value); setConfiguring(false); }}>
            {choices.map((id) => <option key={id} value={id}>{recapModels[id].agent}</option>)}
          </select>
        </label>}
      </> : detectionFailed || available ? <>
        <small>{detectionFailed ? "Couldn’t check for installed agents." : "No supported AI agent found."}</small>
        <button onClick={onRetryDetection}>Check again</button>
      </> : <small>Checking installed agents…</small>}
      {busy && <button onClick={() => void window.runhuddle.cancelProjectHistoryReview(folder).catch(() => setError("Couldn’t cancel the review."))}>Cancel review</button>}
    </div>
    {error && <p role="alert">{error}</p>}
    {result && <div className="dashboard-project-review-result">
      <small role="status">Reviewed {result.reviewed} of {result.total} saved conversations</small>
      {suggestions?.length ? <ul>{suggestions.map(({ next, source }) => <li key={sessionKey(source)}>
        <strong>{next}</strong>
        <button onClick={() => onEvidence(source)}>View source in {source.title}</button>
      </li>)}</ul> : <p>{result.reviewed ? "No clear next step in the reviewed messages." : "No recorded messages were available to review."}</p>}
    </div>}
  </div>;
}
