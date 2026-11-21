import { Icon } from "./Icons";
import { EditorButton } from "./EditorButton";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { readPosition, savePosition } from "./dashboard-position";
import type { GitFile } from "./types";

type DiffLine = { text: string; old?: number; next?: number; kind: "added" | "removed" | "context" | "hunk" | "meta"; hunk?: number };
type DisplayRow = { line: DiffLine; right?: DiffLine };
type DiffLayout = "Unified" | "Split";

function parseDiff(diff: string, untracked: boolean) {
  let old = 0, next = 1, inHunk = untracked, hunks = 0;
  const lines = diff.replace(/\n$/, "").split("\n").map((text): DiffLine => {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (header) {
      old = Number(header[1]);
      next = Number(header[2]);
      inHunk = true;
      return { text, kind: "hunk", hunk: hunks++ };
    }
    if (text.startsWith("diff --git")) inHunk = false;
    if (inHunk) {
      if (text.startsWith("+")) return { text, next: next++, kind: "added" };
      if (text.startsWith("-")) return { text, old: old++, kind: "removed" };
      if (text.startsWith(" ")) return { text, old: old++, next: next++, kind: "context" };
    }
    return { text, kind: "meta" };
  });
  return { lines, hunks };
}

function splitRows(lines: DiffLine[]): DisplayRow[] {
  const rows: DisplayRow[] = [];
  let removed: DiffLine[] = [], added: DiffLine[] = [];
  function flush() {
    for (let index = 0; index < Math.max(removed.length, added.length); index++)
      rows.push({ line: removed[index] ?? added[index], right: removed[index] ? added[index] : undefined });
    removed = [];
    added = [];
  }
  for (const line of lines) {
    if (line.kind === "removed") removed.push(line);
    else if (line.kind === "added") added.push(line);
    else {
      flush();
      rows.push({ line });
    }
  }
  flush();
  return rows;
}

const rowSelector = "tbody tr[data-anchor]";
const layoutKey = "dashboardDiffLayout";

export function DiffReview({ file, diff, loading, onClose, root, inline = false, active = true, scrollTop, onScrollPosition, filePosition,
  onPreviousFile, onNextFile, onPreviousChangeFile, onNextChangeFile, entryHunk }: {
  filePosition?: { index: number; total: number };
  onPreviousFile?: () => void; onNextFile?: () => void;
  onPreviousChangeFile?: () => void; onNextChangeFile?: () => void;
  entryHunk?: "first" | "last";
  active?: boolean; scrollTop?: number; onScrollPosition?: (scrollTop: number) => void;
  root: string; file: GitFile; diff: string; loading: boolean; onClose: () => void; inline?: boolean;
}) {
  const [hunkIndex, setHunkIndex] = useState(-1);
  const [line, setLine] = useState<number | undefined>();
  const [layout, setLayout] = useState<DiffLayout>(() => readPosition<DiffLayout>(layoutKey, "Unified") === "Split" ? "Split" : "Unified");
  const split = inline && layout === "Split";
  const fileID = JSON.stringify([file.path, file.area]);
  const close = useRef(onClose);
  close.current = onClose;
  const container = useRef<HTMLElement>(null);
  const diffContainer = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(scrollTop);
  savedScroll.current = scrollTop;
  const anchor = useRef<{ key: string; index: number; offset: number } | undefined>(undefined);
  const renderedFile = useRef<string>(undefined);
  const requestedHunk = useRef<{ index: number; top: number } | undefined>(undefined);
  const { lines, hunks } = useMemo(() => parseDiff(diff, file.area === "untracked"), [diff, file.area]);
  const rows = useMemo(() => {
    let section = -1;
    const display = split ? splitRows(lines) : lines.map((line): DisplayRow => ({ line }));
    return display.map((row) => {
      if (row.line.hunk !== undefined) section = row.line.hunk;
      return { ...row, section, anchor: row.line.kind === "hunk" ? row.line.text.replace(/^@@[^@]*@@\s*/, "hunk:") : row.line.text };
    });
  }, [lines, split]);

  function updatePosition(scroller: HTMLDivElement) {
    const top = scroller.getBoundingClientRect().top;
    const head = scroller.querySelector("thead")?.getBoundingClientRect().height ?? 0;
    const rows = scroller.querySelectorAll<HTMLTableRowElement>(rowSelector);
    // Find the first row below the sticky column headings.
    let low = 0, high = rows.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (rows[mid].getBoundingClientRect().bottom <= top + head + 0.5) low = mid + 1;
      else high = mid;
    }
    const visible = rows[low];
    anchor.current = visible ? { key: visible.dataset.anchor!, index: low, offset: visible.getBoundingClientRect().top - top } : undefined;
    const atBottom = scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
    const requested = requestedHunk.current;
    if (requested && requested.top !== scroller.scrollTop) requestedHunk.current = undefined;
    const next = requestedHunk.current?.index ?? (atBottom ? hunks - 1 : Number(visible?.dataset.section ?? -1));
    setHunkIndex(next);
  }

  function goToHunk(index: number) {
    const scroller = diffContainer.current;
    const row = scroller?.querySelector<HTMLElement>(`[data-hunk="${index}"]`);
    if (!scroller || !row) return;
    const head = scroller.querySelector("thead")?.getBoundingClientRect().height ?? 0;
    scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - head;
    requestedHunk.current = { index, top: scroller.scrollTop };
    updatePosition(scroller);
  }

  useLayoutEffect(() => {
    const scroller = diffContainer.current;
    if (!active || loading || !scroller) return;
    const same = renderedFile.current === fileID;
    renderedFile.current = fileID;
    requestedHunk.current = undefined;
    if (!same) {
      anchor.current = undefined;
      setLine(undefined);
      if (entryHunk && hunks) {
        goToHunk(entryHunk === "first" ? 0 : hunks - 1);
        return;
      }
    }
    if (inline && same && anchor.current) {
      const saved = anchor.current;
      let match: HTMLTableRowElement | undefined;
      let distance = Infinity;
      scroller.querySelectorAll<HTMLTableRowElement>(rowSelector).forEach((row, index) => {
        if (row.dataset.anchor === saved.key && Math.abs(index - saved.index) < distance) {
          match = row;
          distance = Math.abs(index - saved.index);
        }
      });
      if (match) scroller.scrollTop += match.getBoundingClientRect().top - scroller.getBoundingClientRect().top - saved.offset;
      else if (savedScroll.current !== undefined) scroller.scrollTop = savedScroll.current;
    } else if (savedScroll.current !== undefined) scroller.scrollTop = savedScroll.current;
    if (inline) updatePosition(scroller);
  }, [active, loading, diff, fileID, split]);

  useEffect(() => {
    if (!active) return;
    const panel = container.current?.closest(".changes-review-layout")?.querySelector(".changes-panel");
    if (!inline || !panel?.getClientRects().length) container.current?.focus({ preventScroll: true });
    if (inline) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close.current(); }
    };
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("keydown", escape, true);
      document.querySelector<HTMLTextAreaElement>(".focused-pane .xterm-helper-textarea")?.focus();
    };
  }, [inline, active]);

  const currentHunk = Math.min(hunkIndex, hunks - 1);
  const canGoBack = currentHunk > 0 || !!onPreviousChangeFile;
  const canGoForward = currentHunk + 1 < hunks || !!onNextChangeFile;
  function previousChange() {
    if (currentHunk > 0) goToHunk(currentHunk - 1);
    else onPreviousChangeFile?.();
  }
  function nextChange() {
    if (currentHunk + 1 < hunks) goToHunk(currentHunk + 1);
    else onNextChangeFile?.();
  }
  const deleted = file.status === "D";
  const target = deleted ? root : root.replace(/[\\/]$/, "") + "/" + file.path;
  function newLineNumber(next?: number) {
    return next === undefined ? null : <button aria-label={"Select line " + next} aria-pressed={line === next} onClick={() => setLine(next)}>{next}</button>;
  }

  return <section ref={container} className="diff-review" aria-label="Diff review" tabIndex={-1}
    onKeyDown={e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
      if (inline && !loading && e.key === "F7" && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (e.shiftKey) previousChange();
        else nextChange();
      }
    }}>
    <header><div><strong>{file.path}</strong><small>{file.area}{deleted ? " · Deleted file" : ""}</small></div>
      <EditorButton key={target} line={deleted ? undefined : line} target={target} project={deleted} />
      {filePosition && <div className="diff-file-navigation" role="group" aria-label="Navigate files">
        <button className="dashboard-tool-icon diff-previous-file" type="button" aria-label="Previous file" data-tooltip="Previous file"
          disabled={!onPreviousFile} onClick={onPreviousFile}><Icon name="chevron" size={17} /></button>
        <span>{filePosition.index} / {filePosition.total}</span>
        <button className="dashboard-tool-icon diff-next-file" type="button" aria-label="Next file" data-tooltip="Next file"
          disabled={!onNextFile} onClick={onNextFile}><Icon name="chevron" size={17} /></button>
      </div>}
      <button aria-label={inline ? "Back to files" : "Close diff"} onClick={onClose}>{inline ? "Back to files" : "Close · Esc"}</button>
    </header>
    {inline && <div className="diff-hunk-navigation">
      <div className="diff-layout-toggle" role="group" aria-label="Diff layout">
        {(["Unified", "Split"] as const).map((value) => <button type="button" key={value} aria-pressed={layout === value}
          onClick={() => { setLayout(value); savePosition(layoutKey, value); }}>{value}</button>)}
      </div>
      <div className="diff-change-navigation" role="group" aria-label="Navigate changes">
        <span>{loading ? "" : currentHunk >= 0 ? `Hunk ${currentHunk + 1} of ${hunks}` : `${hunks} ${hunks === 1 ? "hunk" : "hunks"}`}</span>
        <button className="dashboard-tool-icon diff-previous-hunk" type="button" aria-label="Previous change" data-tooltip="Previous change (Shift+F7)"
          disabled={loading || !canGoBack} onClick={previousChange}><Icon name="chevron" size={17} /></button>
        <button className="dashboard-tool-icon" type="button" aria-label="Next change" data-tooltip="Next change (F7)"
          disabled={loading || !canGoForward} onClick={nextChange}><Icon name="chevron" size={17} /></button>
      </div>
    </div>}
    <div ref={diffContainer} className="git-diff" aria-label="File diff" tabIndex={0}
      onScroll={(event) => {
        if (!active || loading) return;
        if (inline) updatePosition(event.currentTarget);
        onScrollPosition?.(event.currentTarget.scrollTop);
      }}>
      {loading ? <p role="status">Loading diff…</p> : !diff ? <p>No text diff available.</p> :
        <table className={split ? "split-diff" : undefined}>
          {split && <colgroup><col className="line-number" /><col /><col className="line-number" /><col /></colgroup>}
          <thead>{split ? <tr><th colSpan={2}>Before</th><th colSpan={2}>After</th></tr>
            : <tr><th>Old line</th><th>New line</th><th>Change</th></tr>}</thead>
          <tbody>{rows.map(({ line, right, section, anchor }, index) => {
              const attrs = { "data-hunk": line.hunk, "data-section": section, "data-anchor": anchor };
              if (!split) return <tr key={index} className={line.kind} {...attrs}>
                <td className="line-number">{line.old}</td><td className="line-number">{newLineNumber(line.next)}</td>
                <td className="diff-code">{line.text || " "}</td></tr>;
              if (line.kind === "meta" || line.kind === "hunk") return <tr key={index} className={line.kind} {...attrs}>
                <td className="diff-code" colSpan={4}>{line.text || " "}</td></tr>;
              const before = line.kind === "added" ? undefined : line;
              const after = right ?? (line.kind === "removed" ? undefined : line);
              return <tr key={index} {...attrs}>
                <td className={`line-number ${before?.kind || "diff-empty-cell"}`}>{before?.old}</td>
                <td className={`diff-code ${before?.kind || "diff-empty-cell"}`}>{before?.text.slice(1) || " "}</td>
                <td className={`line-number ${after?.kind || "diff-empty-cell"}`}>{newLineNumber(after?.next)}</td>
                <td className={`diff-code ${after?.kind || "diff-empty-cell"}`}>{after?.text.slice(1) || " "}</td>
              </tr>;
            })}</tbody>
        </table>}
    </div>
  </section>;
}
