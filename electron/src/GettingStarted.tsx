import { useLayoutEffect, useRef, useState } from "react";

const steps = [
  { id: "dashboard-launch", title: "Start a session",
    text: "Choose New session, pick a project folder, and start an agent. Give it a name if you want it to stay fixed." },
  { id: "dashboard-projects", title: "Browse projects",
    text: "Open Projects to focus on one project or filter to a few. Use Show all projects to clear the filter. Manage hidden… restores hidden sessions and projects." },
  { id: "dashboard-palette", title: "Find work and tools",
    text: "Open the Command Palette to find sessions, projects, and commands. Use Recent to read or resume a conversation, or search its messages from Projects → Conversations." },
  { id: "dashboard-launch", title: "Review live work",
    text: "Select a live session to switch between Preview, Terminal, and Changes. Use Next review for completed turns and Next attention for agents waiting on you." },
  { id: "dashboard-palette", title: "Open a shell",
    text: "Use Quick Terminal for a command from anywhere. Open the dashboard shell to keep a server or other command beside an agent, and hide it when you want the space back." },
  { id: "dashboard-projects", title: "Keep useful context",
    text: "Save excerpts as project notes, generate a recap from conversation details, or start a new session with reviewed context." },
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

export function GettingStarted({ onClose }: {
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLElement>(null);
  const highlight = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const step = steps[index];

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
    const target = find(step.id);

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
  }, [step]);

  const finished = index === steps.length - 1;
  return (
    <dialog ref={dialog} className="getting-started" aria-label="Getting started"
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div ref={highlight} className="tour-highlight" aria-hidden="true" hidden />
      <section ref={card} className="tour-card" aria-labelledby="tour-title">
        <div aria-live="polite">
          <small>Getting started · {index + 1} of {steps.length}</small>
          <h2 id="tour-title">{step.title}</h2>
          <p>{step.text}</p>
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
