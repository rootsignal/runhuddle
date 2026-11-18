import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useAppearance, terminalOptions } from "./TerminalAppearance";
import type { AppEvent } from "./types";
const terminalPastes = new Map<string, (text: string) => Promise<void>>();

export async function pasteTerminalPath(id: string, file: string) {
  if (/[\x00-\x1f\x7f]/.test(file)) throw Error("This file path cannot be pasted.");
  const paste = terminalPastes.get(id);
  if (!paste) throw Error("The selected terminal is no longer open.");
  const windows = /^[a-z]:[\\/]|^\\\\/i.test(file);
  const reference = windows ? '"' + file + '"' : "'" + file.replaceAll("'", "'\\''") + "'";
  await paste(reference + " ");
}

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
  const appearance = useAppearance();
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let active = true;
    document.fonts
      .load('14px "RunHuddle Symbols"')
      .catch(() => {})
      .then(() => {
        if (active) setFontsReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<{ term: Terminal; fit: FitAddon } | undefined>(
    undefined,
  );
  const titleHandler = useRef(onTitle);
  titleHandler.current = onTitle;
  const errorHandler = useRef(onError);
  errorHandler.current = onError;
  useEffect(() => {
    if (!fontsReady) return;
    const term = new Terminal({
      ...terminalOptions(appearance),
      scrollback: 10000,
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
    const paste = async (text: string) => {
      if (!host.current?.getClientRects().length || !ready)
        throw Error("Open the session terminal before attaching.");
      const data = term.modes.bracketedPasteMode ? "\x1b[200~" + text + "\x1b[201~" : text;
      await window.runhuddle.write(id, data);
      if (!disposed && host.current?.getClientRects().length) term.focus();
    };
    terminalPastes.set(id, paste);
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
      if (terminalPastes.get(id) === paste) terminalPastes.delete(id);
      clearTimeout(timer);
      observer.disconnect();
      input.dispose();
      titleSubscription.dispose();
      off();
      term.dispose();
      instance.current = undefined;
    };
  }, [id, fontsReady]);
  useEffect(() => {
    if (!instance.current) return;
    const { term, fit } = instance.current;
    term.options = terminalOptions(appearance);
    if (host.current?.clientWidth && host.current.clientHeight) {
      fit.fit();
      window.runhuddle
        .resize(id, term.cols, term.rows)
        .catch((e) => errorHandler.current(String(e)));
      term.refresh(0, term.rows - 1);
    }
  }, [appearance, fontsReady, id]);
  useEffect(() => {
    if (!visible) return;
    const previousFocus = document.activeElement;
    const frame = requestAnimationFrame(() => {
      instance.current?.fit.fit();
      if (focused && document.activeElement === previousFocus)
        instance.current?.term.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, focused, fontsReady]);
  return (
    <div
      className="terminal-host"
      ref={host}
      aria-label="Terminal"
      style={{ display: visible ? "block" : "none" }}
    />
  );
}
