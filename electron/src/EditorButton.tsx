import { useEffect, useRef, useState } from "react";
import type { Editors } from "./types";
function editorError(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}
export function EditorButton({ target, line, project = false }: { target: string; line?: number; project?: boolean }) {
  const [data, setData] = useState<Editors>({ editors: [], preferred: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  async function load() {
    try { setData(await window.runhuddle.editors()); } catch (e) { setError(editorError(e)); }
  }
  useEffect(() => {
    void load();
    window.addEventListener("editor-changed", load);
    return () => window.removeEventListener("editor-changed", load);
  }, []);
  const preferred = data.editors.find(e => e.id === data.preferred);
  async function open(id: string) {
    setBusy(true); setError("");
    try {
      await window.runhuddle.openEditor(id, target, line);
      window.dispatchEvent(new Event("editor-changed"));
      if (menu.current) menu.current.open = false;
    } catch (e) { setError(editorError(e)); }
    finally { setBusy(false); }
  }
  return <div className="editor-control">
    <button disabled={busy} onClick={() => preferred ? open(preferred.id) : menu.current && (menu.current.open = true)}>
      {(project ? "Open project in " : "Open in ") + (preferred?.name ?? "editor")}
    </button>
    <details ref={menu} className="editor-menu" onToggle={() => { if (menu.current?.open) void load(); }}>
      <summary aria-label="Choose editor">▾</summary>
      <div>
        <small>Choose an editor · remembered for next time</small>
        {data.editors.map(e => <button key={e.id} disabled={busy} onClick={() => open(e.id)}>{e.name}{e.id === data.preferred ? " ✓" : ""}</button>)}
        {!data.editors.length && <small>No supported editors detected.</small>}
        <button disabled={busy} onClick={async () => {
          try {
            const next = await window.runhuddle.chooseEditor();
            if (next) { setData(next); window.dispatchEvent(new Event("editor-changed")); await open(next.preferred); }
          } catch (e) { setError(editorError(e)); }
        }}>Choose another application…</button>
      </div>
    </details>
    {error && <span role="alert" className="editor-error">{error}</span>}
  </div>;
}
