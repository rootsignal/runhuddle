import { useLayoutEffect, useRef, useState } from "react";

const steps = [
  {
    id: "launch",
    title: "Start a session",
    text: "Use New session or terminal to choose a project folder, then open a shell or start Codex, Claude, or Copilot.",
  },
  {
    id: "projects",
    title: "Browse by project",
    text: "RunHuddle finds saved conversations on this device. Use Projects to browse by folder or Recent to browse by date.",
    fallback: {
      id: "sidebar",
      text: "Open the sidebar and choose Projects to find sessions by folder. Use Recent to browse sessions by date.",
    },
  },
  {
    id: "search",
    title: "Find a conversation",
    text: "Search sessions and notes here. Select a conversation to read its history or resume it.",
    fallback: {
      id: "sidebar",
      text: "Open the sidebar to search sessions and notes. Select a conversation to read its history or resume it.",
    },
  },
  {
    id: "arrange",
    title: "Organize open tabs",
    text: "With two or more tabs in a pane, use Arrange to move a tab right or down. Closing a tab keeps its session running. Right-click the sidebar row to end it. When an agent exits, Restart session appears in its open tab.",
    fallback: {
      id: "launch",
      text: "Open two sessions or terminals to try a split. Each pane has an Arrange menu to move a tab right or down. Right-click an open session in the sidebar to end it.",
    },
  },
  {
    id: "appearance",
    title: "Adjust terminal appearance",
    text: "Set the terminal’s theme, font, spacing, and cursor. Use View for the app theme and accent color.",
  },
  {
    id: "changes",
    title: "Review Git changes",
    text: "Use Changes to review files and diffs for the current folder, compare your branch against main, and browse recent commits. Stage and commit from the same panel.",
  },
  {
    id: "notes",
    title: "Save project notes",
    text: "Open Notes to write or find a note. You can also save text from a conversation to keep it with its source.",
  },
  {
    id: "inbox",
    title: "Catch up in Inbox",
    text: "Open Inbox to see which agents have finished or are waiting for input. Select an alert to return to its session.",
  },
  {
    id: "browser",
    title: "Preview and share a page",
    text: "Preview a local dev server or HTTPS page beside your session. Share page adds a report to your draft. For a local app, Allow agent control shares the live page with the selected session. Reopen older sessions to load browser tools.",
  },
] as const;

function placeCallout(target: DOMRect, card: DOMRect, width: number, height: number) {
  const gap = 16;
  const inset = 12;
  const centeredX = target.left + (target.width - card.width) / 2;
  const centeredY = target.top + (target.height - card.height) / 2;
  const clamp = (value: number, max: number) => Math.max(inset, Math.min(value, max - inset));

  if (target.right + gap + card.width <= width - inset)
    return { left: target.right + gap, top: clamp(centeredY, height - card.height) };
  if (target.left - gap - card.width >= inset)
    return { left: target.left - gap - card.width, top: clamp(centeredY, height - card.height) };

  const below = target.bottom + gap;
  const above = target.top - gap - card.height;
  return {
    left: clamp(centeredX, width - card.width),
    top: below + card.height <= height - inset ? below : Math.max(inset, above),
  };
}

export function GettingStarted({ onClose, terminalVisible }: {
  onClose: () => void;
  terminalVisible: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLElement>(null);
  const highlight = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [usingFallback, setUsingFallback] = useState(false);
  const step = steps[index];
  const fallback = "fallback" in step ? step.fallback : undefined;

  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  useLayoutEffect(() => {
    const element = dialog.current!;
    const tip = card.current!;
    const ring = highlight.current!;
    const app = element.parentElement!;
    const find = (id: string) => [...app.querySelectorAll<HTMLElement>(`[data-tour-anchor="${id}"]`)]
      .find((anchor) => anchor.getClientRects().length > 0);
    const primary = find(step.id);
    const target = primary ?? (fallback && find(fallback.id));
    setUsingFallback(Boolean(!primary && target));

    function update() {
      const bounds = target?.getBoundingClientRect();
      ring.hidden = !bounds;
      element.toggleAttribute("data-anchored", Boolean(bounds));
      if (!bounds) {
        tip.style.removeProperty("left");
        tip.style.removeProperty("top");
        return;
      }
      const { left, top } = placeCallout(bounds, tip.getBoundingClientRect(), element.clientWidth, element.clientHeight);
      Object.assign(tip.style, { left: left + "px", top: top + "px" });
      Object.assign(ring.style, {
        left: bounds.left - 4 + "px",
        top: bounds.top - 4 + "px",
        width: bounds.width + 8 + "px",
        height: bounds.height + 8 + "px",
      });
    }

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    observer.observe(tip);
    if (target) observer.observe(target);
    return () => observer.disconnect();
  }, [step, fallback, terminalVisible]);

  const finished = index === steps.length - 1;
  return (
    <dialog ref={dialog} className="getting-started" aria-label="Getting started"
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div ref={highlight} className="tour-highlight" aria-hidden="true" hidden />
      <section ref={card} className="tour-card" aria-labelledby="tour-title">
        <div aria-live="polite">
          <small>Getting started · {index + 1} of {steps.length}</small>
          <h2 id="tour-title">{step.title}</h2>
          <p>{usingFallback && fallback ? fallback.text : step.text}</p>
        </div>
        <footer>
          <button onClick={onClose}>Skip guide</button>
          <div>
            {index > 0 && <button onClick={() => setIndex(index - 1)}>Back</button>}
            <button autoFocus className="primary" onClick={finished ? onClose : () => setIndex(index + 1)}>
              {finished ? "Done" : "Next"}
            </button>
          </div>
        </footer>
      </section>
    </dialog>
  );
}
