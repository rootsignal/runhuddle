import { useEffect } from "react";
const menus = "details.editor-menu[open], details.folder-actions[open], details.row-menu[open], details.commit-options[open], details.document-more[open]";
export function useDismissMenus() {
  useEffect(() => {
    function outside(event: PointerEvent) {
      document.querySelectorAll<HTMLDetailsElement>(menus).forEach(menu => {
        if (event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
      });
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const open = [...document.querySelectorAll<HTMLDetailsElement>(menus)];
      if (!open.length) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const focused = open.find(menu => menu.contains(document.activeElement)) || open.at(-1);
      open.forEach(menu => { menu.open = false; });
      focused?.querySelector<HTMLElement>("summary")?.focus();
    }
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", escape, true);
    };
  }, []);
}
