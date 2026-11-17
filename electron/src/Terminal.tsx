import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { AppEvent } from "./types";
export function TerminalPane({
  id,
  visible,
  focused,
  onError,
  onTitle,
}: {
  id: string;
  visible: boolean;
  focused: boolean;
  onError: (error: string) => void;
  onTitle: (title: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<{ term: Terminal; fit: FitAddon } | undefined>(
    undefined,
  );
  const titleHandler = useRef(onTitle);
  titleHandler.current = onTitle;
  const errorHandler = useRef(onError);
  errorHandler.current = onError;
  useEffect(() => {
    const term = new Terminal({
      fontSize: 14,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      cursorBlink: true,
      scrollback: 10000,
      theme: {
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
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current!);
    instance.current = { term, fit };
    let disposed = false,
      ready = false,
      lastSequence = 0;
    const queued: Extract<AppEvent, { event: "output" }>[] = [];
    const fail = (e: unknown) => {
      if (!disposed) errorHandler.current(String(e));
    };
    const off = window.runhuddle.onEvent((event) => {
      if (event.event !== "output" || event.id !== id) return;
      if (!ready) queued.push(event);
      else if (event.sequence > lastSequence) {
        term.write(event.data);
        lastSequence = event.sequence;
      }
    });
    window.runhuddle
      .replay(id)
      .then((replay) => {
        if (disposed) return;
        term.write(replay.data);
        lastSequence = replay.sequence;
        for (const event of queued)
          if (event.sequence > lastSequence) {
            term.write(event.data);
            lastSequence = event.sequence;
          }
        queued.length = 0;
        ready = true;
      })
      .catch(fail);
    const titleSubscription = term.onTitleChange((title) =>
      titleHandler.current(title),
    );
    const input = term.onData((data) => {
      window.runhuddle.write(id, data).catch(fail);
    });
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!host.current?.clientWidth || !host.current.clientHeight) return;
        fit.fit();
        window.runhuddle.resize(id, term.cols, term.rows).catch(fail);
      }, 60);
    });
    observer.observe(host.current!);
    return () => {
      disposed = true;
      clearTimeout(timer);
      observer.disconnect();
      input.dispose();
      titleSubscription.dispose();
      off();
      term.dispose();
      instance.current = undefined;
    };
  }, [id]);
  useEffect(() => {
    if (!visible) return;
    const previousFocus = document.activeElement;
    const frame = requestAnimationFrame(() => {
      instance.current?.fit.fit();
      if (focused && document.activeElement === previousFocus)
        instance.current?.term.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, focused]);
  return (
    <div
      className="terminal-host"
      ref={host}
      aria-label="Terminal"
      style={{ display: visible ? "block" : "none" }}
    />
  );
}
