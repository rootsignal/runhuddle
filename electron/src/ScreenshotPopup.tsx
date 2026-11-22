import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icons";
import type { AttachmentTarget, ScreenshotNotice } from "./types";

function displayError(reason: unknown) {
  return (reason instanceof Error ? reason.message : String(reason))
    .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}

export function ScreenshotPopup({ target, blockedReason, onAttach }: {
  target?: AttachmentTarget;
  blockedReason?: string;
  onAttach: (file: File) => void;
}) {
  const [queue, setQueue] = useState<ScreenshotNotice[]>([]);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState<{ id: string; text: string }>();
  const [attached, setAttached] = useState<{ target: string; name: string }>();
  const hintId = useId();
  const current = useRef({ target, blockedReason, onAttach });
  current.current = { target, blockedReason, onAttach };

  useEffect(() => window.runhuddle.onEvent((event) => {
    if (event.event === "screenshot")
      setQueue((previous) => [...previous.slice(-15), event.screenshot]);
    if (event.event === "screenshots-off") {
      setQueue([]);
      setAttached(undefined);
    }
  }), []);
  useEffect(() => {
    if (!attached) return;
    const timer = setTimeout(() => setAttached(undefined), 4000);
    return () => clearTimeout(timer);
  }, [attached]);

  const screenshot = queue[0];
  if (!screenshot && !attached) return null;
  const dismiss = () => setQueue((previous) => previous.filter((item) => item.id !== screenshot?.id));
  const failed = screenshot && error?.id === screenshot.id ? error.text : undefined;

  async function attach() {
    if (!screenshot || !target || blockedReason || pending) return;
    setError(undefined);
    setPending(true);
    try {
      const bytes = await window.runhuddle.screenshotDraft(screenshot.id);
      const destination = current.current;
      if (destination.target?.id !== target.id) throw Error("The selected session changed. Check the destination and try again.");
      if (destination.blockedReason) throw Error(destination.blockedReason);
      destination.onAttach(new File([new Uint8Array(bytes)], screenshot.name, { type: "image/png" }));
      setAttached({ target: target.title, name: screenshot.name });
      dismiss();
    } catch (reason) {
      setError({ id: screenshot.id, text: displayError(reason) });
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!screenshot) return;
    try {
      await window.runhuddle.copyScreenshotPath(screenshot.id);
      setCopied(screenshot.id);
    } catch (reason) {
      setError({ id: screenshot.id, text: displayError(reason) });
    }
  }

  return createPortal(
    <aside className="screenshot-popup" aria-label={screenshot ? "Screenshot taken" : "Screenshot attachment"}>
      {attached && <div className="screenshot-attached">
        <Icon name="check" size={16} />
        <span role="status"><strong>Attached to draft</strong><small title={attached.name}>{attached.name} · {attached.target}</small></span>
        {!screenshot && <button aria-label="Dismiss attachment confirmation" onClick={() => setAttached(undefined)}><Icon name="close" size={15} /></button>}
      </div>}
      {screenshot && <>
        <div className="screenshot-preview">
          <img src={screenshot.thumbnail} alt="Screenshot thumbnail" />
          <div>
            <strong>Screenshot taken</strong>
            <span title={screenshot.name}>{screenshot.name}</span>
            {queue.length > 1 && <small>{queue.length} screenshots waiting</small>}
          </div>
        </div>
        <div id={hintId} className="screenshot-attachment-hint" data-blocked={!!blockedReason}>
          {target ? <><small>Attach to</small><strong title={target.title}>{target.title}</strong></> : "Select an open AI session to attach this screenshot."}
          {blockedReason && <span>{blockedReason}</span>}
          {target && !blockedReason && target.busy && <span>The agent is busy. You can still add this to its draft.</span>}
        </div>
        {failed && <p role="alert"><strong>Screenshot action failed.</strong> {failed}</p>}
        <div className="screenshot-actions">
          <button className={target && !blockedReason ? "primary" : undefined}
            disabled={!target || !!blockedReason || pending} aria-describedby={hintId} onClick={attach}>
            {pending ? "Attaching…" : target ? "Add to follow-up draft" : "Select a session to attach"}
          </button>
          <button onClick={copy} disabled={pending}>{copied === screenshot.id ? "Path copied" : "Copy path"}</button>
          <button onClick={dismiss} disabled={pending}>Dismiss</button>
        </div>
      </>}
    </aside>,
    document.querySelector(".projects-dashboard[open]") || document.body,
  );
}
