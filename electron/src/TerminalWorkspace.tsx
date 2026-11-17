import { useEffect, useState, useRef } from "react";
import type { ReactNode } from "react";
import { SplitView } from "./SplitView";
import { AgentIcon, Icon } from "./Icons";
import type { TerminalInfo } from "./types";

type Group = { id: string; tabs: string[]; active: string };
type Branch = {
  id: string;
  axis: "right" | "down";
  ratio: number;
  children: [Node, Node];
};
type Node = Group | Branch;
const isBranch = (n: Node): n is Branch => "children" in n;
const groups = (n: Node): Group[] =>
  isBranch(n) ? n.children.flatMap(groups) : [n];
const group = (tabs: string[]): Group => ({
  id: crypto.randomUUID(),
  tabs,
  active: tabs[0] || "",
});
function map(n: Node, id: string, fn: (n: Node) => Node): Node {
  if (n.id === id) return fn(n);
  return isBranch(n)
    ? { ...n, children: n.children.map((c) => map(c, id, fn)) as [Node, Node] }
    : n;
}
function prune(n: Node, ids: Set<string>): Node | null {
  if (!isBranch(n)) {
    const tabs = n.tabs.filter((id) => ids.has(id));
    return tabs.length
      ? { ...n, tabs, active: tabs.includes(n.active) ? n.active : tabs[0] }
      : null;
  }
  const a = prune(n.children[0], ids),
    b = prune(n.children[1], ids);
  return a && b ? { ...n, children: [a, b] } : a || b;
}
function reconcile(
  n: Node,
  ids: string[],
  focused: string,
  preferred = "",
): Node {
  let next = prune(n, new Set(ids)) || group([]);
  const leaves = groups(next),
    known = new Set(leaves.flatMap((g) => g.tabs));
  const target =
    leaves.find((g) => g.tabs.includes(focused)) ||
    leaves.find((g) => g.id === preferred) ||
    leaves[0];
  return map(next, target.id, (node) => ({
    ...(node as Group),
    tabs: [...(node as Group).tabs, ...ids.filter((id) => !known.has(id))],
  }));
}
function restore(key: string, ids: string[]): Node {
  try {
    const n = JSON.parse(localStorage.getItem(key) || "null");
    const valid = (v: any): boolean =>
      v &&
      typeof v.id === "string" &&
      (v.children
        ? ["right", "down"].includes(v.axis) &&
          Number.isFinite(v.ratio) &&
          v.children.length === 2 &&
          v.children.every(valid)
        : Array.isArray(v.tabs) &&
          v.tabs.every((x: any) => typeof x === "string") &&
          typeof v.active === "string");
    if (valid(n)) return reconcile(n, ids, "");
  } catch {}
  return group(ids);
}
export function TerminalWorkspace({
  workspace,
  terminals,
  selected,
  title,
  onSelect,
  onClose,
  onEnd,
  onLayout,
  render,
}: {
  workspace: string;
  terminals: TerminalInfo[];
  selected: string;
  title: (t: TerminalInfo) => string;
  onSelect: (id: string) => void;
  onClose: (t: TerminalInfo, next?: string) => void;
  onEnd: (t: TerminalInfo) => void;
  onLayout: (info: {
    locations: Record<string, string>;
    focused: string;
  }) => void;
  render: (t: TerminalInfo) => ReactNode;
}) {
  const storageKey = "pane-layout:" + workspace;
  const ids = terminals.map((t) => t.id);
  const [tree, setTree] = useState<Node>(() => restore(storageKey, ids));
  const [dragged, setDragged] = useState("");
  const [drop, setDrop] = useState("");
  const [menu, setMenu] = useState("");
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const focusedGroup = useRef("");
  useEffect(() => {
    const dismiss = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu("");
        setDragged("");
        setDrop("");
      }
    };
    const outside = (e: PointerEvent) => {
      if (!(e.target as Element)?.closest(".pane-menu")) setMenu("");
    };
    window.addEventListener("keydown", dismiss);
    window.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("keydown", dismiss);
      window.removeEventListener("pointerdown", outside);
    };
  }, []);
  // Terminal creation and sidebar selection affect only the owning/focused group.
  useEffect(() => {
    setTree((old) => {
      let next = reconcile(old, ids, selected, focusedGroup.current);
      const owner = groups(next).find((g) => g.tabs.includes(selected));
      if (owner) focusedGroup.current = owner.id;
      if (owner)
        next = map(next, owner.id, (n) => ({
          ...(n as Group),
          active: selected,
        }));
      return next;
    });
  }, [ids.join("|"), selected]);
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(tree));
  }, [tree, storageKey]);
  const leaves = groups(tree);
  useEffect(() => {
    const locations: Record<string, string> = {};
    groups(tree).forEach((g, i) =>
      g.tabs.forEach((id) => {
        locations[id] = `Pane ${i + 1}` + (g.active === id ? " · Visible" : "");
      }),
    );
    onLayout({
      locations,
      focused: locations[selected]?.split(" · ")[0] || "Pane 1",
    });
  }, [tree, selected, onLayout]);
  function move(
    id: string,
    targetId: string,
    edge?: "right" | "down",
    before?: string,
  ) {
    setTree((old) => {
      const source = groups(old).find((g) => g.tabs.includes(id));
      const target = groups(old).find((g) => g.id === targetId);
      if (
        !source ||
        !target ||
        (edge && source.id === targetId && source.tabs.length < 2)
      )
        return old;
      if (before === id) return old;
      let next = map(old, source.id, (n) => {
        const g = n as Group,
          tabs = g.tabs.filter((t) => t !== id);
        return {
          ...g,
          tabs,
          active: g.active === id ? tabs[0] || "" : g.active,
        };
      });
      next = map(next, targetId, (n) => {
        if (edge)
          return {
            id: crypto.randomUUID(),
            axis: edge,
            ratio: 50,
            children: [n, group([id])],
          };
        const g = n as Group,
          tabs = [...g.tabs];
        const at = before ? tabs.indexOf(before) : -1;
        tabs.splice(at < 0 ? tabs.length : at, 0, id);
        return { ...g, tabs, active: id };
      });
      next = prune(next, new Set(ids)) || group(ids);
      focusedGroup.current =
        groups(next).find((g) => g.tabs.includes(id))?.id || "";
      return next;
    });
    setMenu("");
    setDragged("");
    setDrop("");
    onSelect(id);
  }
  function draw(n: Node): ReactNode {
    if (isBranch(n))
      return (
        <SplitView
          key={n.id}
          axis={n.axis}
          ratio={n.ratio}
          onRatio={(ratio) =>
            setTree((old) =>
              map(old, n.id, (branch) => ({ ...(branch as Branch), ratio })),
            )
          }
        >
          {n.children.map(draw)}
        </SplitView>
      );
    const active =
      terminals.find((t) => t.id === n.active) ||
      terminals.find((t) => n.tabs.includes(t.id));
    const number = leaves.findIndex((g) => g.id === n.id) + 1;
    return (
      <div
        key={n.id}
        className={
          "pane-group " + (n.tabs.includes(selected) ? "active-group" : "")
        }
        aria-label={`Pane ${number}`}
      >
        <div className="group-tabs">
          <div
            className="tabbar"
            role="tablist"
            aria-label={`Pane ${number} tabs`}
            onDragOver={(e) => {
              if (dragged) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragged) move(dragged, n.id);
            }}
          >
            {n.tabs.map((id) => {
              const t = terminals.find((t) => t.id === id);
              if (!t) return null;
              return (
                <div
                  key={id}
                  className={
                    "terminal-tab " + (active?.id === id ? "selected" : "")
                  }
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragged(id);
                  }}
                  onDragEnd={() => {
                    setDragged("");
                    setDrop("");
                  }}
                  onDragOver={(e) => {
                    if (dragged) {
                      e.preventDefault();
                      e.stopPropagation();
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (dragged) move(dragged, n.id, undefined, id);
                  }}
                >
                  <button
                    role="tab"
                    aria-selected={active?.id === id}
                    title={title(t) + " · " + t.cwd}
                    onClick={() => {
                      setTree((old) =>
                        map(old, n.id, (g) => ({
                          ...(g as Group),
                          active: id,
                        })),
                      );
                      onSelect(id);
                    }}
                  >
                    <AgentIcon agent={t.agent} />
                    <span className="tab-title">
                      {title(t)}
                      {t.unavailable
                        ? " · Unavailable"
                        : t.exited
                          ? " · Ended"
                          : ""}
                    </span>
                  </button>
                  <button
                    title="Close tab · keeps running"
                    aria-label={`Close ${title(t)}`}
                    onClick={() =>
                      onClose(
                        t,
                        n.tabs.find((x) => x !== t.id),
                      )
                    }
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="pane-menu">
            <button
              title="Arrange tabs: move right, down, or to another pane"
              aria-label={`Arrange pane ${number}`}
              aria-expanded={menu === n.id}
              onClick={(e) => {
                const box = e.currentTarget.getBoundingClientRect();
                setMenuPosition({
                  top: Math.max(
                    8,
                    Math.min(box.bottom, window.innerHeight - 290),
                  ),
                  left: Math.max(
                    8,
                    Math.min(box.right - 230, window.innerWidth - 238),
                  ),
                });
                setMenu(menu === n.id ? "" : n.id);
              }}
            >
              {leaves.length > 1 ? `Pane ${number} · ` : ""}Arrange ▾
            </button>
            {menu === n.id && active && (
              <div className="pane-actions" style={menuPosition}>
                <strong>Arrange current tab</strong>
                <button
                  disabled={n.tabs.length < 2}
                  onClick={() => move(active.id, n.id, "right")}
                >
                  Move tab right
                </button>
                <button
                  disabled={n.tabs.length < 2}
                  onClick={() => move(active.id, n.id, "down")}
                >
                  Move tab down
                </button>
                {n.tabs.length < 2 && (
                  <small>Add another tab to split this pane.</small>
                )}
                {leaves
                  .filter((g) => g.id !== n.id)
                  .map((g) => (
                    <button key={g.id} onClick={() => move(active.id, g.id)}>
                      Move to pane {leaves.indexOf(g) + 1}
                    </button>
                  ))}
                {leaves.length > 1 && (
                  <button
                    onClick={() => {
                      setTree({
                        ...group(leaves.flatMap((g) => g.tabs)),
                        active: active.id,
                      });
                      setMenu("");
                      onSelect(active.id);
                    }}
                  >
                    Combine all tabs into one pane
                  </button>
                )}
                <button
                  onClick={() => {
                    setMenu("");
                    onEnd(active);
                  }}
                >
                  {active.agent === "shell" ? "Close terminal" : "End session"}
                </button>
                <button onClick={() => setMenu("")}>Done</button>
              </div>
            )}
          </div>
        </div>
        <div className="group-content">
          {active && render(active)}
          {dragged && (
            <div className="drop-targets">
              {(["center", "right", "down"] as const).map((edge) => (
                <div
                  key={edge}
                  className={`drop-zone drop-${edge} ${drop === n.id + edge ? "over" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDrop(n.id + edge);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    move(dragged, n.id, edge === "center" ? undefined : edge);
                  }}
                >
                  {edge === "center"
                    ? "Move into this pane"
                    : edge === "right"
                      ? "Move to right pane"
                      : "Move to bottom pane"}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
  return <div className="terminal-workspace">{draw(tree)}</div>;
}
