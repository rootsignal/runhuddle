import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./Icons";
import { pasteTerminalPath } from "./Terminal";
import type { AttachmentTarget, BrowserPreviewState } from "./types";

const cover = "dialog[open], [popover]:popover-open, .dashboard-project-picker-panel, .screenshot-popup, .usage-warning";

export function BrowserPreview({ target, enabled = true, canGrantControl = true, onShareReport, onClose, onReopenSession }: {
  target?: AttachmentTarget;
  enabled?: boolean;
  canGrantControl?: boolean;
  onShareReport?: (target: AttachmentTarget, file: string) => void;
  onClose: () => void;
  onReopenSession: (id: string) => Promise<void>;
}) {
  const [state, setState] = useState<BrowserPreviewState>();
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [attaching, setAttaching] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [granting, setGranting] = useState(false);
  const [attached, setAttached] = useState("");
  const agentSession = state?.agentSession;
  const shareHelp = useId();
  const host = useRef<HTMLDivElement>(null);
  const currentTarget = useRef(target);
  const active = useRef(false);
  currentTarget.current = target;

  useEffect(() => {
    if (!enabled) return;
    active.current = true;
    const off = window.runhuddle.onEvent((event) => {
      if (event.event === "browser-preview") setState(event.state);
    });
    void window.runhuddle.browserState().then((value) => {
      if (active.current) setState(value);
    }).catch((reason) => {
      if (active.current) setError(displayError(reason));
    });
    return () => {
      active.current = false;
      off();
      void window.runhuddle.browserAgent(null).catch(() => {});
    };
  }, [enabled]);

  useEffect(() => { setAttached(""); }, [target?.id]);

  useEffect(() => {
    if (state?.url) setAddress(state.url);
  }, [state?.url]);

  useEffect(() => {
    if (!enabled) return;
    const element = host.current!;
    const owner = element.closest("dialog");
    let frame = 0;
    let previous: string | undefined;
    function update() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const { x, y, width, height } = element.getBoundingClientRect();
        const covered = Array.from(document.querySelectorAll(cover)).some((node) => node !== owner);
        const rect = covered || width < 2 || height < 2
          ? null : { x, y, width, height };
        const next = JSON.stringify(rect);
        if (next === previous) return;
        previous = next;
        void window.runhuddle.browserLayout(rect).catch(() => {});
      });
    }
    const resize = new ResizeObserver(update);
    resize.observe(element);
    resize.observe(document.documentElement);
    const overlays = new MutationObserver((records) => {
      if (records.some((record) => {
        const target = record.target;
        if (record.type === "attributes") return target instanceof HTMLDialogElement;
        if (target instanceof Element && target.closest(".xterm")) return false;
        return [...record.addedNodes, ...record.removedNodes].some((node) => node instanceof Element &&
          (node.matches("dialog, .dashboard-project-picker-panel, .screenshot-popup, .usage-warning") || node.querySelector(cover)));
      })) update();
    });
    overlays.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
    function popoverToggled(event: Event) {
      if (event.target instanceof HTMLElement && event.target.hasAttribute("popover")) update();
    }
    document.addEventListener("toggle", popoverToggled, true);
    window.addEventListener("resize", update);
    update();
    return () => {
      resize.disconnect();
      overlays.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener("toggle", popoverToggled, true);
      window.removeEventListener("resize", update);
      void window.runhuddle.browserLayout(null).catch(() => {});
    };
  }, [enabled]);

  async function navigate() {
    setError("");
    setAttached("");
    try {
      const next = await window.runhuddle.navigateBrowser(address);
      if (active.current) setState(next);
    } catch (reason) {
      if (active.current) setError(displayError(reason));
    }
  }

  async function attach() {
    if (!target || target.busy || !state?.ready || attaching) return;
    setAttaching(true);
    setError("");
    setAttached("");
    try {
      const { file } = await window.runhuddle.captureBrowser();
      if (!active.current || currentTarget.current?.id !== target.id || currentTarget.current.busy)
        throw Error("Select a session ready for input and try again.");
      if (onShareReport) onShareReport(target, file);
      else await pasteTerminalPath(target.id, file, "Inspect the page screenshot, visible text, and console diagnostics in ");
      if (active.current) setAttached(onShareReport
        ? `Report added to the follow-up draft for ${target.title}.`
        : `Report added to ${target.title}. Press Enter in the terminal to send.`);
    } catch (reason) {
      if (active.current) setError(displayError(reason));
    } finally {
      if (active.current) setAttaching(false);
    }
  }

  async function agentAccess(id: string | null) {
    setError("");
    setGranting(true);
    try {
      await window.runhuddle.browserAgent(id);
    } catch (reason) {
      if (active.current) setError(displayError(reason));
    } finally {
      if (active.current) setGranting(false);
    }
  }

  async function reopenSession(id: string) {
    setError("");
    setReopening(true);
    try {
      await onReopenSession(id);
    } catch (reason) {
      if (active.current) setError(displayError(reason));
    } finally {
      if (active.current) setReopening(false);
    }
  }

  function control(action: "back" | "forward" | "reload") {
    setError("");
    setAttached("");
    void window.runhuddle.browserAction(action).catch((reason) => setError(displayError(reason)));
  }

  return (
    <section className="browser-preview" aria-label="Browser preview">
      <header>
        <strong>Browser</strong>
        <button type="button" aria-label="Close browser preview" onClick={onClose}><Icon name="close" size={16} /></button>
      </header>
      <form className="browser-address-bar" onSubmit={(event) => { event.preventDefault(); void navigate(); }}>
        <button type="button" aria-label="Go back" disabled={!state?.back} onClick={() => control("back")}>←</button>
        <button type="button" aria-label="Go forward" disabled={!state?.forward} onClick={() => control("forward")}>→</button>
        <button type="button" aria-label="Reload page" disabled={!state?.url || state.loading} onClick={() => control("reload")}>↻</button>
        <input aria-label="Browser address" placeholder="localhost:3000" value={address}
          autoComplete="off" spellCheck={false} maxLength={4096} onChange={(event) => setAddress(event.target.value)} />
        <button type="submit" disabled={!address.trim()}>Open</button>
      </form>
      <div className="browser-viewport" ref={host}>
        {!state?.url && <p>Enter your dev server’s address or an HTTPS URL.</p>}
      </div>
      <footer>
        {(error || state?.error) && <p role="alert">{error || state?.error}</p>}
        {state?.loading && <p role="status">Loading page…</p>}
        {attached && <p role="status">{attached}</p>}
        <button type="button" className="primary browser-share" disabled={!target || target.busy || !state?.ready || attaching}
          aria-describedby={shareHelp} onClick={() => void attach()} title={target?.title}>
          {attaching ? "Capturing…" : target ? `Share page with ${target.title}` : "Share page"}
        </button>
        <p id={shareHelp} className="muted browser-share-help">
          {!target ? "Select an AI session to share this page." :
            target.locked ? "Close the conversation in the other app and retry in Codex." :
            target.busy ? "Wait until the active session is ready for input." :
            onShareReport ? "Adds a page report to the follow-up draft." : "Adds a screenshot, page text, and console errors to your draft. Press Enter to send."}
        </p>
        <div className="browser-agent-controls">
          {(agentSession || (canGrantControl && state?.url && target?.browserTools && !target.locked)) && (
            <button type="button" disabled={granting || (!agentSession && !state?.ready)}
              onClick={() => void agentAccess(agentSession ? null : target!.id)}>
              {agentSession ? "Stop agent control" : "Allow agent control"}
            </button>
          )}
          {canGrantControl && state?.url && target && !target.locked && !target.browserTools && (
            <button type="button" disabled={reopening} onClick={() => void reopenSession(target.id)}>
              {target.canResume ? "Reopen with browser control" : "Start session with browser control"}
            </button>
          )}
          <p className="muted" aria-live="polite">
            {reopening ? "Opening a session with browser tools…" : agentSession ? "This session can interact with this site. Stop control to take over." :
              !state?.url ? "Open a page to allow agent control." :
              !target ? "Select an AI session to allow browser control." :
              target.locked ? "This Codex conversation is in use elsewhere." :
              !canGrantControl ? "Open the session’s Terminal tab to allow agent control." :
              !target.browserTools ? target.canResume
                ? "Reopen the saved conversation to load live browser tools."
                : "Start a new conversation in this folder with live browser tools." :
              "Lets this session inspect and interact with this site. Switching sites or sessions ends access."}
          </p>
        </div>
      </footer>
    </section>
  );
}

function displayError(reason: unknown) {
  return (reason instanceof Error ? reason.message : String(reason))
    .replace(/^Error invoking remote method '[^']+': Error: /, "");
}
