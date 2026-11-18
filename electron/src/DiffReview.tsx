import { EditorButton } from "./EditorButton";
import { useEffect, useRef, useState } from "react";
import type { GitFile } from "./types";

export function DiffReview({ file, diff, loading, onClose, root }: {
  root: string; file: GitFile; diff: string; loading: boolean; onClose: () => void;
}) {
  const [line, setLine] = useState<number | undefined>();
  useEffect(() => setLine(undefined), [file.path, file.area]);
  const close = useRef(onClose);
  close.current = onClose;
  const container = useRef<HTMLElement>(null);
  useEffect(() => {
    container.current?.focus();
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close.current(); }
    };
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("keydown", escape, true);
      document.querySelector<HTMLTextAreaElement>(
        ".focused-pane .xterm-helper-textarea",
      )?.focus();
    };
  }, []);
  let oldLine = 0, newLine = file.area === "untracked" ? 1 : 0, inHunk = file.area === "untracked";
  const rows = diff.split("\n").map((text, index) => {
    const hunk = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    let old = "", next = "", kind = "meta";
    if (hunk) {
      oldLine = Number(hunk[1]); newLine = Number(hunk[2]);
      inHunk = true; kind = "hunk";
    } else if (inHunk && text.startsWith("+")) {
      next = String(newLine++); kind = "added";
    } else if (inHunk && text.startsWith("-")) {
      old = String(oldLine++); kind = "removed";
    } else if (inHunk && text.startsWith(" ")) {
      old = String(oldLine++); next = String(newLine++); kind = "context";
    } else if (text.startsWith("diff --git")) inHunk = false;
    return <tr key={index} className={kind}>
      <td className="line-number">{old}</td><td className="line-number">{next ? <button aria-label={"Select line " + next} aria-pressed={line === Number(next)} onClick={() => setLine(Number(next))}>{next}</button> : ""}</td>
      <td className="diff-code">{text || " "}</td>
    </tr>;
  });
  return <section ref={container} className="diff-review" aria-label="Diff review" tabIndex={-1}
    onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
    <header><div><strong>{file.path}</strong><small>{file.area} · Unified diff</small></div>
      <EditorButton line={line} target={root.replace(/[\\/]$/, "") + "/" + file.path} />
      <button aria-label="Close diff" onClick={onClose}>Close · Esc</button>
    </header>
    <div className="git-diff" aria-label="File diff" tabIndex={0}>
      {loading ? <p role="status">Loading diff…</p> : !diff ? <p>No text diff available.</p> :
        <table><thead><tr><th>Old line</th><th>New line</th><th>Change</th></tr></thead><tbody>{rows}</tbody></table>}
    </div>
  </section>;
}
