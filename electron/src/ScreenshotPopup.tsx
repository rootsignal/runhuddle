import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { canPasteTerminalDraft, pasteTerminalPath } from "./Terminal";
import type { AttachmentTarget, ScreenshotNotice } from "./types";

function attachmentAction(target?: AttachmentTarget) {
  if (!target) return {
    label: "Select a session to attach",
    hint: "Select an open AI session to attach this screenshot.",
  };
  if (target.locked) return {
    label: "Session in use",
    hint: "This conversation is open elsewhere. Select another session to attach.",
  };
  if (target.busy) return {
    label: "Queue for current session",
    hint: "Adds the screenshot to this session’s draft when the terminal is ready. Nothing is submitted.",
  };
  return {
    label: "Attach to current session",
    hint: "Adds the screenshot to your draft. Press Enter in the session to send.",
  };
}

export function ScreenshotPopup({
  target, attachToDraft, draftFull,
}: {
  target?: AttachmentTarget;
  attachToDraft?: (terminalId: string, screenshot: ScreenshotNotice) => Promise<void>;
  draftFull?: boolean;
}) {
  const [queue, setQueue] = useState<ScreenshotNotice[]>([]);
  const [attachments, setAttachments] = useState<{ id: string; terminalId: string; title: string; file: string }[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState<{ id: string; text: string }>();
  const attachmentHintId = useId();
  const currentTarget = useRef(target);
  currentTarget.current = target;

  const nextAttachment = attachments.find((item) => item.terminalId === target?.id);
  useEffect(() => {
    if (attachToDraft || !nextAttachment || !target || target.busy || target.locked || attachmentError) return;
    let inFlight = false;
    const timer = setInterval(() => {
      if (inFlight || currentTarget.current?.id !== nextAttachment.terminalId ||
          currentTarget.current.busy || currentTarget.current.locked || !canPasteTerminalDraft(nextAttachment.terminalId)) return;
      inFlight = true;
      clearInterval(timer);
      void pasteTerminalPath(nextAttachment.terminalId, nextAttachment.file, "", false).then(() => {
        setAttachments((previous) => previous.filter((item) => item.id !== nextAttachment.id));
      }, (error) => setAttachmentError(error instanceof Error ? error.message : String(error)));
    }, 160);
    return () => clearInterval(timer);
  }, [nextAttachment, target?.id, target?.busy, target?.locked, attachmentError, !!attachToDraft]);

  useEffect(
    () =>
      window.runhuddle.onEvent((event) => {
        if (event.event === "screenshot")
          setQueue((previous) => [...previous.slice(-15), event.screenshot]);
        if (event.event === "screenshots-off") setQueue([]);
      }),
    [],
  );

  const screenshot = queue[0];
  if (!screenshot && !attachments.length) return null;
  const blocked = Boolean(target?.locked);
  const { label, hint } = attachToDraft && target && !blocked ? {
    label: "Add to follow-up draft",
    hint: draftFull ? "This draft already has 8 screenshots." : "Keeps the screenshot with this session’s follow-up.",
  } : attachmentAction(target);
  const dismiss = () =>
    setQueue((previous) =>
      previous.filter((item) => item.id !== screenshot?.id),
    );

  async function attach() {
    if (!screenshot || !target || target.locked || pending || draftFull) return;
    setError(undefined);
    setPending(true);
    try {
      if (attachToDraft) {
        await attachToDraft(target.id, screenshot);
        dismiss();
        return;
      }
      const file = await window.runhuddle.screenshotPath(screenshot.id);
      const current = currentTarget.current;
      if (current?.id !== target.id || current.locked)
        throw Error("The selected session changed. Select it again to attach.");
      if (current.busy || attachments.some((item) => item.terminalId === target.id)) {
        setAttachments((previous) => [...previous, { id: screenshot.id, terminalId: target.id, title: target.title, file }]);
      } else {
        await pasteTerminalPath(target.id, file);
      }
      dismiss();
    } catch (e) {
      setError({
        id: screenshot.id,
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!screenshot) return;
    try {
      await window.runhuddle.copyScreenshotPath(screenshot.id);
      setCopied(screenshot.id);
      setError(undefined);
    } catch (e) {
      setError({
        id: screenshot.id,
        text: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return createPortal(
    <aside className="screenshot-popup" aria-label="Screenshot taken">
      {attachments.length > 0 && <div className="screenshot-queued">
        <p role="status">{attachments.length} {attachments.length === 1 ? "screenshot" : "screenshots"} queued
          {nextAttachment ? ` for ${nextAttachment.title}` : ". Open the destination terminal to attach."}</p>
        {attachmentError && <p role="alert">{attachmentError}</p>}
        {attachmentError && <button onClick={() => setAttachmentError("")}>Retry attachments</button>}
        <button onClick={() => { setAttachments([]); setAttachmentError(""); }}>Cancel queued attachments</button>
      </div>}
      {screenshot && <>
      <div className="screenshot-preview" role="status">
        <img src={screenshot.thumbnail} alt="Screenshot thumbnail" />
        <div>
          <strong>Screenshot taken</strong>
          <span title={screenshot.name}>{screenshot.name}</span>
          {target && <small title={target.title}>{target.title}</small>}
        </div>
      </div>
      <div id={attachmentHintId} role="status" className="screenshot-attachment-hint" data-blocked={blocked}>
        {hint}
      </div>
      {error?.id === screenshot.id && <p role="alert">{error.text}</p>}
      <div className="screenshot-actions">
        <button
          className={target && !blocked ? "primary" : undefined}
          disabled={!target || blocked || pending || draftFull}
          aria-describedby={attachmentHintId}
          onClick={attach}
        >
          {pending ? "Attaching…" : label}
        </button>
        <button onClick={copy}>
          {copied === screenshot.id ? "Path copied" : "Copy path"}
        </button>
        <button onClick={dismiss}>Dismiss</button>
      </div>
      </>}
    </aside>,
    document.querySelector(".projects-dashboard[open]") || document.body,
  );
}
