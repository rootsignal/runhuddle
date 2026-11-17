import { useEffect, useRef, useState } from "react";
import { ChangesPanel } from "./ChangesPanel";
import { Icon } from "./Icons";
export function WorkspaceTools({ cwd }: { cwd: string }) {
  const [open, setOpen] = useState(
    () => localStorage.getItem("workspaceTool") === "changes",
  );
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem("workspaceToolWidth"));
    return stored >= 260 && stored <= 700 ? stored : 360;
  });
  const drag = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    localStorage.setItem("workspaceTool", open ? "changes" : "");
  }, [open]);
  useEffect(() => {
    localStorage.setItem("workspaceToolWidth", String(width));
  }, [width]);
  const resize = (value: number) =>
    setWidth(Math.max(260, Math.min(700, value)));
  return (
    <>
      {open && (
        <div className="workspace-tool" style={{ width }}>
          <div
            className="tool-resizer"
            role="separator"
            aria-label="Resize tools panel"
            aria-orientation="vertical"
            aria-valuemin={260}
            aria-valuemax={700}
            aria-valuenow={width}
            tabIndex={0}
            onPointerDown={(e) => {
              drag.current = { x: e.clientX, width };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (
                drag.current &&
                e.currentTarget.hasPointerCapture(e.pointerId)
              )
                resize(drag.current.width + drag.current.x - e.clientX);
            }}
            onPointerUp={(e) => {
              drag.current = null;
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onDoubleClick={() => resize(360)}
            onKeyDown={(e) => {
              if (["ArrowLeft", "ArrowRight", "Home"].includes(e.key)) {
                e.preventDefault();
                resize(
                  e.key === "Home"
                    ? 360
                    : width + (e.key === "ArrowLeft" ? 20 : -20),
                );
              }
            }}
          />
          <ChangesPanel cwd={cwd} onClose={() => setOpen(false)} />
        </div>
      )}
      <nav className="tools-rail" aria-label="Workspace tools">
        <button
          title="Changes"
          aria-label="Changes"
          aria-pressed={open}
          onClick={() => setOpen(!open)}
        >
          <Icon name="changes" size={19} />
        </button>
      </nav>
    </>
  );
}
