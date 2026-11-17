import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { AppEvent } from "./types";
export function TerminalPane({
  id,
  visible,
  onError,
}: {
  id: string;
  visible: boolean;
  onError: (error: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<{ term: Terminal; fit: FitAddon } | undefined>(
    undefined,
  );
  const errorHandler = useRef(onError);
  errorHandler.current = onError;
  useEffect(() => {
    const term = new Terminal({
      fontSize: 14,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      cursorBlink: true,
      scrollback: 10000,
      theme: {
        background: "#0e131b",
        foreground: "#d8e1ee",
        cursor: "#5ed9e9",
        selectionBackground: "#355470",
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
      off();
      term.dispose();
      instance.current = undefined;
    };
  }, [id]);
  useEffect(() => {
    if (visible)
      requestAnimationFrame(() => {
        instance.current?.fit.fit();
        instance.current?.term.focus();
      });
  }, [visible]);
  return (
    <div
      className="terminal-host"
      ref={host}
      aria-label="Terminal"
      style={{ display: visible ? "block" : "none" }}
    />
  );
}
