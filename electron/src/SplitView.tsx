import { useRef } from "react";
import type { ReactNode } from "react";
export function SplitView({
  children,
  axis = "right",
  ratio,
  onRatio: setRatio,
}: {
  children: ReactNode[];
  axis?: "right" | "down";
  ratio: number;
  onRatio: (ratio: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const horizontal = axis === "right";
  const clamp = (n: number) => Math.max(25, Math.min(75, n));
  return (
    <div
      ref={host}
      className={"split-view " + (horizontal ? "" : "split-down")}
      style={{
        [horizontal ? "gridTemplateColumns" : "gridTemplateRows"]:
          `minmax(0, ${ratio}fr) 8px minmax(0, ${100 - ratio}fr)`,
      }}
    >
      {children[0]}
      <div
        role="separator"
        aria-label="Resize panes"
        aria-orientation={horizontal ? "vertical" : "horizontal"}
        aria-valuemin={25}
        aria-valuemax={75}
        aria-valuenow={Math.round(ratio)}
        tabIndex={0}
        className="split-divider"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          const box = host.current!.getBoundingClientRect();
          setRatio(
            clamp(
              (horizontal
                ? (e.clientX - box.left) / box.width
                : (e.clientY - box.top) / box.height) * 100,
            ),
          );
        }}
        onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
        onDoubleClick={() => setRatio(50)}
        onKeyDown={(e) => {
          if (
            e.key === (horizontal ? "ArrowLeft" : "ArrowUp") ||
            e.key === (horizontal ? "ArrowRight" : "ArrowDown")
          ) {
            e.preventDefault();
            setRatio(
              clamp(
                ratio + (["ArrowLeft", "ArrowUp"].includes(e.key) ? -5 : 5),
              ),
            );
          }
          if (e.key === "Home") setRatio(50);
        }}
      />
      {children[1]}
    </div>
  );
}
