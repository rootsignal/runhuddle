import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { GitChanges } from "./types";
const cache = new Map<
  string,
  { at: number; result: Promise<GitChanges | null> }
>();
export function TerminalContext({ cwd, pathLabel }: { cwd: string; pathLabel?: ReactNode }) {
  const [data, setData] = useState<GitChanges | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const updated = (event: Event) => {
      if ((event as CustomEvent).detail === cwd) {
        cache.delete(cwd);
        setRefresh((n) => n + 1);
      }
    };
    window.addEventListener("repository-refreshed", updated);
    const unsubscribe = window.runhuddle.onEvent(e => {
      if (e.event === "git" && e.cwd === cwd) { cache.delete(cwd); setRefresh(n => n + 1); }
    });
    return () => { unsubscribe(); window.removeEventListener("repository-refreshed", updated); };
  }, [cwd]);
  useEffect(() => {
    let active = true;
    setData(null);
    let entry = cache.get(cwd);
    if (!entry || Date.now() - entry.at > 5000) {
      entry = {
        at: Date.now(),
        result: window.runhuddle.gitChanges(cwd).catch(() => null),
      };
      cache.set(cwd, entry);
    }
    entry.result.then((result) => {
      if (active) setData(result);
    });
    return () => {
      active = false;
    };
  }, [cwd, refresh]);
  return (
    <div className="terminal-context">
      {pathLabel ?? <span className="context-path" title={cwd}>
        {cwd}
      </span>}
      {data && (
        <span
          className="context-branch"
          title="Repository branch and uncommitted files"
        >
          {data.branch} · {new Set(data.files.map((f) => f.path)).size} changed
        </span>
      )}
      <button
        aria-label="Refresh repository context"
        title="Refresh repository context"
        onClick={() => {
          cache.delete(cwd);
          setRefresh((n) => n + 1);
        }}
      >
        ↻
      </button>
    </div>
  );
}
