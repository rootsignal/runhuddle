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
    text: "Expand a folder in Projects to browse its conversations. Right-click a folder for Project overview and other actions. Use the project list’s … menu to manage hidden projects and sessions.",
    fallback: {
      id: "sidebar",
      text: "Open the sidebar and choose Projects. Expand a folder to browse its conversations.",
    },
  },
  {
    id: "project-scope",
    title: "Focus a project",
    text: "The Focused project label shows which project owns these tabs. Click All projects beside it to bring back your wider set of tabs. Each view remembers its layout, and sessions keep running as you switch.",
    fallback: {
      id: "projects",
      text: "In Projects, expand a folder and choose Focus project to see just its sessions and tabs. Look for Focused project above the terminal. Click All projects to return.",
    },
  },
  {
    id: "search",
    title: "Find a conversation",
    text: "Search sessions and notes across all projects, even while focused on one. Select a conversation to open it. Right-click a session for actions, or hover over its status icon to see what it means.",
    fallback: {
      id: "sidebar",
      text: "Open the sidebar to search sessions and notes across all projects. Right-click a session for its actions.",
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
    id: "handoff",
    title: "Hand off to another agent",
    text: "Use Continue with another agent… to switch agents and review the handoff. To keep the same agent, choose Start new session with context… from session actions or a saved conversation. Review the draft before sending it.",
    fallback: {
      id: "launch",
      text: "In an open AI session, use the usage menu (for example, Claude usage). Choose Continue with another agent… anytime to hand off work. Use Start new session with context… in saved history or session actions to keep the same agent.",
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
