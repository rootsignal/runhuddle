import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

export const colorKeys = [
  "background",
  "foreground",
  "cursor",
  "selectionBackground",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;
export type Colors = Record<(typeof colorKeys)[number], string>;
const dark: Colors = {
  background: "#18181b",
  foreground: "#dedee3",
  cursor: "#b6dce0",
  selectionBackground: "#41414b",
  black: "#20212a",
  red: "#f0788c",
  green: "#98d8a0",
  yellow: "#e8c77a",
  blue: "#7db5f5",
  magenta: "#d99ae8",
  cyan: "#80d5dc",
  white: "#dce0e9",
  brightBlack: "#73798b",
  brightRed: "#ff9bae",
  brightGreen: "#b0e9b7",
  brightYellow: "#f6df9c",
  brightBlue: "#a6ccff",
  brightMagenta: "#efb6fa",
  brightCyan: "#a6edf0",
  brightWhite: "#ffffff",
};
export const presets: Record<string, Colors> = {
  "RunHuddle Dark": dark,
  Midnight: {
    ...dark,
    background: "#0c1422",
    foreground: "#dce7f5",
    selectionBackground: "#304562",
    blue: "#61a8ff",
    magenta: "#e595ec",
    cyan: "#47d3d9",
  },
  Light: {
    ...dark,
    background: "#fafaf8",
    foreground: "#242933",
    cursor: "#176c83",
    selectionBackground: "#c7dae8",
    black: "#242933",
    red: "#b02c43",
    green: "#27713d",
    yellow: "#896100",
    blue: "#2459b3",
    magenta: "#833d9e",
    cyan: "#146e7c",
    white: "#737780",
    brightBlack: "#525862",
    brightRed: "#bb2e48",
    brightGreen: "#2f7738",
    brightYellow: "#896300",
    brightBlue: "#2465c0",
    brightMagenta: "#9138a0",
    brightCyan: "#09788a",
    brightWhite: "#444a53",
  },
  "High contrast": {
    ...dark,
    background: "#000000",
    foreground: "#ffffff",
    cursor: "#ffffff",
    selectionBackground: "#464646",
    blue: "#69b5ff",
    magenta: "#ff8cea",
    green: "#8aff80",
    yellow: "#fff479",
  },
};
export type Appearance = {
  preset: string;
  colors: Colors;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorStyle: "block" | "underline" | "bar";
  cursorBlink: boolean;
};
export const defaults: Appearance = {
  preset: "RunHuddle Dark",
  colors: dark,
  fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono"',
  fontSize: 14,
  lineHeight: 1,
  cursorStyle: "block",
  cursorBlink: true,
};
export function loadAppearance(): Appearance {
  try {
    const p = JSON.parse(localStorage.getItem("terminalAppearance") || "null");
    if (!p) return defaults;
    const colors = { ...dark };
    for (const k of colorKeys)
      if (/^#[0-9a-f]{6}$/i.test(p.colors?.[k])) colors[k] = p.colors[k];
    return {
      ...defaults,
      colors,
      preset: typeof p.preset === "string" ? p.preset : defaults.preset,
      fontFamily:
        typeof p.fontFamily === "string"
          ? p.fontFamily.slice(0, 250)
          : defaults.fontFamily,
      fontSize: Number.isFinite(p.fontSize)
        ? Math.max(10, Math.min(30, p.fontSize))
        : 14,
      lineHeight: Number.isFinite(p.lineHeight)
        ? Math.max(1, Math.min(1.8, p.lineHeight))
        : 1,
      cursorStyle: ["block", "bar", "underline"].includes(p.cursorStyle)
        ? p.cursorStyle
        : "block",
      cursorBlink: typeof p.cursorBlink === "boolean" ? p.cursorBlink : true,
    };
  } catch {
    return defaults;
  }
}
export const AppearanceContext = createContext<Appearance>(defaults);
export const useAppearance = () => useContext(AppearanceContext);
export const fontStack = (p: Appearance) =>
  `${p.fontFamily || defaults.fontFamily}, "RunHuddle Symbols", monospace`;
export const terminalOptions = (p: Appearance) => ({
  theme: p.colors,
  fontFamily: fontStack(p),
  fontSize: p.fontSize,
  lineHeight: p.lineHeight,
  cursorStyle: p.cursorStyle,
  cursorBlink: p.cursorBlink,
});
function Preview({ value }: { value: Appearance }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    let term: Terminal | undefined;
    let observer: ResizeObserver | undefined;
    document.fonts
      .load('14px "RunHuddle Symbols"')
      .catch(() => {})
      .then(() => {
        if (cancelled) return;
        term = new Terminal({
          ...terminalOptions(value),
          disableStdin: true,
          rows: 7,
          scrollback: 0,
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(host.current!);
        fit.fit();
        term.write("\x1b[1mTerminal preview\x1b[0m\r\n");
        for (let i = 0; i < 8; i++)
          term.write(
            `\x1b[${30 + i}m ${["Black", "Red", "Green", "Yellow", "Blue", "Pink", "Cyan", "White"][i]} \x1b[0m`,
          );
        term.write("\r\n");
        for (let i = 0; i < 8; i++)
          term.write(`\x1b[${90 + i}m Bright \x1b[0m`);
        term.write(
          "\r\n\x1b[3mItalic\x1b[0m  \x1b[1mBold\x1b[0m  \x1b[4mUnderline\x1b[0m\r\n\x1b[36m\ue0b0 \ue0a0 \uf115 \uf017\x1b[0m  Prompt symbols   ✓\r\n$ ",
        );
        observer = new ResizeObserver(() => fit.fit());
        observer.observe(host.current!);
      });
    return () => {
      cancelled = true;
      observer?.disconnect();
      term?.dispose();
    };
  }, [value]);
  return (
    <div
      className="appearance-preview"
      aria-label="Terminal appearance preview"
      ref={host}
    />
  );
}
const label = (key: string) =>
  key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
function ColorControl({
  name,
  color,
  onChange,
}: {
  name: string;
  color: string;
  onChange: (color: string) => void;
}) {
  const [draft, setDraft] = useState(color);
  useEffect(() => setDraft(color), [color]);
  return (
    <div className="color-control">
      <input
        aria-label={name + " color"}
        type="color"
        value={color}
        onChange={(e) => onChange(e.target.value)}
      />
      <label>
        {name}
        <input
          aria-label={name + " hex"}
          value={draft}
          spellCheck={false}
          maxLength={7}
          aria-invalid={!/^#[0-9a-f]{6}$/i.test(draft)}
          onChange={(e) => {
            setDraft(e.target.value);
            if (/^#[0-9a-f]{6}$/i.test(e.target.value))
              onChange(e.target.value);
          }}
          onBlur={() => setDraft(color)}
        />
      </label>
    </div>
  );
}
export function TerminalAppearance({
  value,
  onChange,
  onDismiss,
}: {
  value: Appearance;
  onChange: (p: Appearance) => void;
  onDismiss: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current!.showModal();
    return () => dialog.current?.close();
  }, []);
  function change<K extends keyof Appearance>(k: K, v: Appearance[K]) {
    onChange({ ...value, [k]: v });
  }
  return (
    <dialog
      ref={dialog}
      className="appearance-dialog"
      aria-label="Terminal appearance"
      onCancel={onDismiss}
    >
      <header>
        <div>
          <h2>Terminal appearance</h2>
          <p>
            Applies live to every terminal. Your shell and agents control their
            own output.
          </p>
        </div>
        <button onClick={onDismiss} aria-label="Close terminal appearance">
          ×
        </button>
      </header>
      <Preview value={value} />
      <div className="appearance-fields">
        <label>
          Theme
          <select
            aria-label="Terminal theme"
            value={value.preset}
            onChange={(e) =>
              onChange({
                ...value,
                preset: e.target.value,
                colors: { ...presets[e.target.value] },
              })
            }
          >
            {Object.keys(presets).map((p) => (
              <option key={p}>{p}</option>
            ))}
            {!presets[value.preset] && <option>Custom</option>}
          </select>
        </label>
        <label>
          Font family
          <input
            aria-label="Terminal font family"
            list="terminal-fonts"
            value={value.fontFamily}
            onChange={(e) => change("fontFamily", e.target.value)}
          />
          <datalist id="terminal-fonts">
            <option value={defaults.fontFamily} />
            <option value="Menlo" />
            <option value="Consolas" />
            <option value="JetBrains Mono" />
            <option value="Fira Code" />
            <option value="monospace" />
          </datalist>
          <small>Uses installed fonts; prompt symbols are included.</small>
        </label>
        <label>
          Font size
          <input
            aria-label="Terminal font size"
            type="number"
            min="10"
            max="30"
            value={value.fontSize}
            onChange={(e) =>
              change(
                "fontSize",
                Math.max(10, Math.min(30, Number(e.target.value) || 14)),
              )
            }
          />
        </label>
        <label>
          Line spacing
          <input
            aria-label="Terminal line spacing"
            type="number"
            min="1"
            max="1.8"
            step="0.05"
            value={value.lineHeight}
            onChange={(e) =>
              change(
                "lineHeight",
                Math.max(1, Math.min(1.8, Number(e.target.value) || 1)),
              )
            }
          />
        </label>
        <label>
          Cursor
          <select
            aria-label="Terminal cursor style"
            value={value.cursorStyle}
            onChange={(e) =>
              change("cursorStyle", e.target.value as Appearance["cursorStyle"])
            }
          >
            <option value="block">Block</option>
            <option value="bar">Bar</option>
            <option value="underline">Underline</option>
          </select>
        </label>
        <label className="cursor-check">
          <input
            type="checkbox"
            checked={value.cursorBlink}
            onChange={(e) => change("cursorBlink", e.target.checked)}
          />
          Blink cursor
        </label>
      </div>
      <details>
        <summary>Customize colors · text, background and ANSI palette</summary>
        <div className="appearance-colors">
          {colorKeys.map((k) => (
            <ColorControl
              key={k}
              name={label(k)}
              color={value.colors[k]}
              onChange={(color) =>
                onChange({
                  ...value,
                  preset: "Custom",
                  colors: { ...value.colors, [k]: color },
                })
              }
            />
          ))}
        </div>
        <p>
          Explicit RGB colors emitted by an agent remain unchanged by the ANSI
          palette.
        </p>
      </details>
      <footer>
        <button onClick={() => onChange(defaults)}>Restore defaults</button>
        <span>Changes saved automatically</span>
        <button className="primary" onClick={onDismiss}>
          Done
        </button>
      </footer>
    </dialog>
  );
}
