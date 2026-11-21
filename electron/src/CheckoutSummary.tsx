import { useEffect, useState } from "react";
import { Icon } from "./Icons";
import type { GitChanges } from "./types";

export function CheckoutSummary({ cwd, enabled, working, onOpen }: {
  cwd: string; enabled: boolean; working: boolean; onOpen: () => void;
}) {
  const [snapshot, setSnapshot] = useState<GitChanges>();
  useEffect(() => {
    if (!cwd || !enabled) return;
    let active = true;
    let loading = false;
    let refreshPending = false;
    async function refresh() {
      if (loading) {
        refreshPending = true;
        return;
      }
      loading = true;
      try {
        const changes = await window.runhuddle.gitChanges(cwd, "working");
        if (active) setSnapshot(changes);
      } catch {
        if (active) setSnapshot(undefined);
      } finally {
        loading = false;
        if (active && refreshPending) {
          refreshPending = false;
          void refresh();
        }
      }
    }
    void refresh();
    const timer = setInterval(refresh, working ? 4000 : 12000);
    const off = window.runhuddle.onEvent((event) => {
      if (event.event === "git" && event.cwd === cwd) void refresh();
    });
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      off();
      window.removeEventListener("focus", refresh);
    };
  }, [cwd, enabled, working]);

  if (!enabled || !snapshot?.files.length) return null;
  const count = snapshot.uncommittedFiles ?? new Set(snapshot.files.map((file) => file.path)).size;
  const stats = snapshot.files.filter((file) => file.additions !== undefined && file.deletions !== undefined);
  const additions = stats.reduce((total, file) => total + (file.additions ?? 0), 0);
  const deletions = stats.reduce((total, file) => total + (file.deletions ?? 0), 0);
  const filesLabel = `${count.toLocaleString()} ${count === 1 ? "file changed" : "files changed"}`;
  const linesLabel = stats.length > 0 ? `, ${additions.toLocaleString()} lines added, ${deletions.toLocaleString()} lines removed` : "";
  return <button type="button" className="dashboard-change-summary" aria-label={`Uncommitted, ${filesLabel}${linesLabel}`}
    title="Open Uncommitted changes. Line counts cover staged and unstaged text changes reported by Git."
    onClick={onOpen}>
    <span className="dashboard-change-icon"><Icon name="changes" size={17} /></span>
    <span className="dashboard-change-copy">
      <strong>Uncommitted</strong>
      <span>{filesLabel}</span>
    </span>
    {stats.length > 0 && <span className="dashboard-change-counts">
      <span>+{additions.toLocaleString()}</span><span>−{deletions.toLocaleString()}</span>
    </span>}
    <span className="dashboard-change-arrow"><Icon name="chevron" size={14} /></span>
  </button>;
}
