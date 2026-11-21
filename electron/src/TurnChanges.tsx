import { useEffect, useRef, useState } from "react";
import { DiffReview } from "./DiffReview";
import { Icon } from "./Icons";
import type { TurnChanges, TurnDiff } from "./types";

export function TurnChangedFiles({ changes }: { changes: TurnChanges }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<TurnDiff>();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    const modal = dialog.current!;
    modal.showModal();
    return () => modal.close();
  }, [open]);

  function close() {
    setOpen(false);
    setSelected(undefined);
  }

  const committed = changes.files.filter((entry) => entry.file.area === "committed");
  const uncommitted = changes.files.filter((entry) => entry.file.area !== "committed");
  const count = new Set(changes.files.map((entry) => entry.file.path)).size;
  return <>
    <button type="button" className="dashboard-turn-changes-button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <Icon name="changes" size={16} /> <strong>Turn changes</strong>
      <span>{count} {count === 1 ? "file" : "files"}</span>
      <Icon name="chevron" size={13} />
    </button>
    {open && <dialog ref={dialog} className="appearance-dialog dashboard-turn-diff"
      aria-label={selected ? "Captured checkout diff" : "Changed during this turn"}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); close(); }}>
      {selected ? <>
        <button type="button" className="dashboard-turn-back" onClick={() => setSelected(undefined)}>← Back to changed files</button>
        <p>{selected.file.area === "committed"
          ? "Diff between the commits at the start and end of this turn."
          : "Checkout diff captured at turn end. It may include earlier edits to this file."}</p>
        <DiffReview key={selected.file.path} root={changes.root} file={selected.file}
          diff={selected.diff!} loading={false} onClose={close} />
      </> : <>
        <header><h2>Changed during this turn</h2><button type="button" aria-label="Close turn changes" onClick={close}>
          <Icon name="close" size={18} />
        </button></header>
        {([["Committed", committed], ["Uncommitted", uncommitted]] as const).map(([label, files]) => {
          if (!files.length) return null;
          const range = label === "Committed" ? changes.commitRange : undefined;
          return <section key={label} role="group" aria-label={label} className="dashboard-turn-file-group">
            <h3>{label}{range && <code title={`${range.from} → ${range.to}`}>{range.from.slice(0, 7)} → {range.to.slice(0, 7)}</code>}</h3>
            <ul>{files.map((entry) => <li key={entry.file.path}>
              <span title={entry.file.path}>{entry.file.path}</span>
              {entry.diff && <button type="button" className="secondary" aria-label={`View diff for ${entry.file.path}`}
                onClick={() => setSelected(entry)}>View diff</button>}
            </li>)}</ul>
            {!!range?.omitted && <p>{range.omitted} additional committed files were outside the capture limit.</p>}
          </section>;
        })}
      </>}
    </dialog>}
  </>;
}
