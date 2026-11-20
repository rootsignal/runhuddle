import { EditorButton } from "./EditorButton";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { GitFile } from "./types";

export function DiffReview({ file, diff, loading, onClose, root, inline = false, active = true, scrollTop, onScrollPosition }: {
  active?: boolean; scrollTop?: number; onScrollPosition?: (scrollTop: number) => void;
  root: string; file: GitFile; diff: string; loading: boolean; onClose: () => void; inline?: boolean;
}) {
  const [line, setLine] = useState<number | undefined>();
  useEffect(() => setLine(undefined), [file.path, file.area]);
  const close = useRef(onClose);
  close.current = onClose;
  const container = useRef<HTMLElement>(null);
  const diffContainer = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(scrollTop);
  savedScroll.current = scrollTop;
  useLayoutEffect(() => {
    if (active && !loading && diffContainer.current && savedScroll.current !== undefined)
      diffContainer.current.scrollTop = savedScroll.current;
  }, [active, loading, diff, file.path, file.area]);
  useEffect(() => {
    if (!active) return;
    container.current?.focus({ preventScroll: true });
    if (inline) return;
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
  }, [inline, active]);
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
  const deleted = file.status === "D";
  const target = deleted ? root : root.replace(/[\\/]$/, "") + "/" + file.path;
  return <section ref={container} className="diff-review" aria-label="Diff review" tabIndex={-1}
    onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
    <header><div><strong>{file.path}</strong><small>{file.area} · {deleted ? "Deleted file" : "Unified diff"}</small></div>
      <EditorButton key={target} line={deleted ? undefined : line} target={target} project={deleted} />
      <button aria-label="Close diff" onClick={onClose}>Close · Esc</button>
    </header>
    <div ref={diffContainer} className="git-diff" aria-label="File diff" tabIndex={0}
      onScroll={(event) => { if (active && !loading) onScrollPosition?.(event.currentTarget.scrollTop); }}>
      {loading ? <p role="status">Loading diff…</p> : !diff ? <p>No text diff available.</p> :
        <table><thead><tr><th>Old line</th><th>New line</th><th>Change</th></tr></thead><tbody>{rows}</tbody></table>}
    </div>
  </section>;
}
