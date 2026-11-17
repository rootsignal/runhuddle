import { useRef, useState } from "react";
import type { ReactNode } from "react";
export function SplitView({ children }: { children: ReactNode[] }) {
  const host = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(50);
  const clamp = (n: number) => Math.max(25, Math.min(75, n));
  return (
    <div
      ref={host}
      className="split-view"
      style={{
        gridTemplateColumns: `minmax(0, ${ratio}fr) 8px minmax(0, ${100 - ratio}fr)`,
      }}
    >
      {children[0]}
      <div
        role="separator"
        aria-label="Resize panes"
        aria-orientation="vertical"
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
          setRatio(clamp(((e.clientX - box.left) / box.width) * 100));
        }}
        onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
        onDoubleClick={() => setRatio(50)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            setRatio((r) => clamp(r + (e.key === "ArrowLeft" ? -5 : 5)));
          }
          if (e.key === "Home") setRatio(50);
        }}
      />
      {children[1]}
    </div>
  );
}
