import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { pasteTerminalPath } from "./Terminal";
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
    label: "Waiting for session",
    hint: target.needsInput
      ? "Answer the agent’s current prompt first. Attach will be available when the session is idle."
      : "The agent is working. Attach will be available when the session is idle.",
  };
  return {
    label: "Attach to current session",
    hint: "Adds the screenshot to your draft. Press Enter in the session to send.",
  };
}

export function ScreenshotPopup({
  target,
}: {
  target?: AttachmentTarget;
}) {
  const [queue, setQueue] = useState<ScreenshotNotice[]>([]);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState<{ id: string; text: string }>();
  const attachmentHintId = useId();
  const currentTarget = useRef(target);
  currentTarget.current = target;

  useEffect(
    () =>
      window.runhuddle.onEvent((event) => {
        if (event.event === "screenshot")
          setQueue((previous) => [...previous.slice(-3), event.screenshot]);
        if (event.event === "screenshots-off") setQueue([]);
      }),
    [],
  );

  const screenshot = queue[0];
  if (!screenshot) return null;
  const blocked = Boolean(target?.busy);
  const { label, hint } = attachmentAction(target);
  const dismiss = () =>
    setQueue((previous) =>
      previous.filter((item) => item.id !== screenshot.id),
    );

  async function attach() {
    if (!target || target.busy || pending) return;
    setError(undefined);
    setPending(true);
    try {
      const file = await window.runhuddle.screenshotPath(screenshot.id);
      if (currentTarget.current?.id !== target.id || currentTarget.current.busy)
        throw Error("Select a session ready for input and try again.");
      await pasteTerminalPath(target.id, file);
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
          disabled={!target || blocked || pending}
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
    </aside>,
    document.body,
  );
}
