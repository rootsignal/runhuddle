import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { pasteTerminalPath } from "./Terminal";
import type { ScreenshotNotice } from "./types";

export function ScreenshotPopup({
  target,
}: {
  target?: { id: string; title: string; busy: boolean };
}) {
  const [queue, setQueue] = useState<ScreenshotNotice[]>([]);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState<{ id: string; text: string }>();
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
  const dismiss = () =>
    setQueue((previous) =>
      previous.filter((item) => item.id !== screenshot.id),
    );

  async function attach() {
    if (!target || target.busy || pending) return;
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
          {target ? (
            <small title={target.title}>
              {target.busy ? "Session is busy" : target.title}
            </small>
          ) : (
            <small>Open an AI session to attach.</small>
          )}
        </div>
      </div>
      {error?.id === screenshot.id && <p role="alert">{error.text}</p>}
      <div className="screenshot-actions">
        <button
          className="primary"
          disabled={!target || target.busy || pending}
          onClick={attach}
        >
          Attach to current session
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
