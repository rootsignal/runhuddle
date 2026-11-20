import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useAppearance, terminalOptions } from "./TerminalAppearance";
import { historyBeforeReplay, readScrollback, saveScrollback, seedScrollback } from "./terminal-scrollback";
import type { AppEvent } from "./types";
type Geometry = { cols: number; rows: number };
const geometries = new Map<string, Geometry>();
const redrawnTerminals = new WeakSet<Set<Terminal>>();
const terminalViews = new Map<string, Set<Terminal>>();

function synchronizeViews(id: string, geometry: Geometry) {
  for (const term of terminalViews.get(id) ?? []) {
    if (term.cols !== geometry.cols || term.rows !== geometry.rows) term.resize(geometry.cols, geometry.rows);
  }
}

type DraftPaste = { ready: () => boolean; paste: (text: string, focus: boolean) => Promise<void> };
const terminalPastes = new Map<string, Set<DraftPaste>>();
export function canPasteTerminalDraft(id: string) {
  return [...(terminalPastes.get(id) ?? [])].some((entry) => entry.ready());
}

export async function pasteTerminalPath(id: string, file: string, prefix = "", focus = true) {
  if (/[\x00-\x1f\x7f]/.test(file)) throw Error("This file path cannot be pasted.");
  const paste = [...(terminalPastes.get(id) ?? [])].find((entry) => entry.ready());
  if (!paste) throw Error("The selected terminal is no longer open.");
  const windows = /^[a-z]:[\\/]|^\\\\/i.test(file);
  const reference = windows ? '"' + file + '"' : "'" + file.replaceAll("'", "'\\''") + "'";
  await paste.paste(prefix + reference + " ", focus);
}

export function TerminalPane({
  id,
  readOnly = false,
  visible,
  active = visible,
  focused,
  onError,
  onTitle,
  onDirectory,
  onConversationLock,
  redrawOnTruncatedReplay = false,
}: {
  id: string;
  readOnly?: boolean;
  visible: boolean;
  active?: boolean;
  focused: boolean;
  onError: (error: string) => void;
  onTitle: (title: string) => void;
  onDirectory?: (directory: string) => void;
  redrawOnTruncatedReplay?: boolean;
  onConversationLock?: (locked: boolean) => void;
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
  const canUseTerminal = useRef(false);
  canUseTerminal.current = visible && active && !readOnly;
  const fitCurrent = useRef(() => {});
  const titleHandler = useRef(onTitle);
  titleHandler.current = onTitle;
  const directoryHandler = useRef(onDirectory);
  directoryHandler.current = onDirectory;
  const lockHandler = useRef(onConversationLock);
  lockHandler.current = onConversationLock;
  const errorHandler = useRef(onError);
  errorHandler.current = onError;
  useEffect(() => {
    if (!fontsReady) return;
    let disposed = false;
    const fail = (e: unknown) => {
      if (!disposed) errorHandler.current(String(e));
    };
    const term = new Terminal({
      ...terminalOptions(appearance),
      ...(geometries.get(id) ?? { cols: 100, rows: 30 }),
      scrollback: 10000,
      disableStdin: readOnly,
      linkHandler: {
        activate: (_event, url) => {
          void window.runhuddle.openTerminalLink(url).catch(fail);
        },
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current!);
    instance.current = { term, fit };
    const peers = terminalViews.get(id) ?? new Set<Terminal>();
    peers.add(term);
    terminalViews.set(id, peers);
    let needsRedraw = false;
    let ready = false,
      lastSequence = 0;
    type TerminalEvent = Extract<AppEvent, { event: "output" | "terminal-size" }>;
    const queued: TerminalEvent[] = [];
    let orderedSizes = false;
    const applySize = ({ cols, rows }: Geometry) => {
      if (!disposed && (term.cols !== cols || term.rows !== rows)) term.resize(cols, rows);
    };
    const applyEvent = (event: TerminalEvent, done?: () => void) => {
      lastSequence = event.sequence;
      if (event.event === "output") term.write(event.data, done);
      else term.write("", () => {
        applySize(event);
        done?.();
      });
    };
    let checkpointTimer: ReturnType<typeof setTimeout> | undefined;
    const checkpoint = () => {
      clearTimeout(checkpointTimer);
      checkpointTimer = undefined;
      if (ready && (canUseTerminal.current || term === peers.values().next().value))
        saveScrollback(id, term.buffer.normal, lastSequence);
    };
    function scheduleCheckpoint() {
      if (ready && canUseTerminal.current && checkpointTimer === undefined)
        checkpointTimer = setTimeout(checkpoint, 500);
    }
    window.addEventListener("pagehide", checkpoint);
    window.addEventListener("beforeunload", checkpoint);
    const off = window.runhuddle.onEvent((event) => {
      if ((event.event !== "output" && event.event !== "terminal-size") || event.id !== id) return;
      if (!ready) queued.push(event);
      else if (event.sequence > lastSequence) applyEvent(event);
    });
    fitCurrent.current = () => {
      if (disposed || !ready || !canUseTerminal.current || !host.current?.clientWidth || !host.current.clientHeight) return;
      const geometry = fit.proposeDimensions();
      if (!geometry) return;
      const old = geometries.get(id);
      const redraw = needsRedraw && !redrawnTerminals.has(peers);
      if (!redraw && old?.cols === geometry.cols && old.rows === geometry.rows) return;
      geometries.delete(id);
      geometries.set(id, geometry);
      if (geometries.size > 200) geometries.delete(geometries.keys().next().value!);
      if (!orderedSizes && !redraw) synchronizeViews(id, geometry);
      async function resize(geometry: Geometry) {
        if (redraw) {
          redrawnTerminals.add(peers);
          // The replay can start in the middle of a differential paint. Give Codex a
          // real height change so it rebuilds its viewport even if the final size is unchanged.
          const nudge = { cols: geometry.cols, rows: geometry.rows > 2 ? geometry.rows - 1 : geometry.rows + 1 };
          if (!orderedSizes) synchronizeViews(id, nudge);
          try {
            await window.runhuddle.resize(id, nudge.cols, nudge.rows);
            await new Promise((resolve) => setTimeout(resolve, 55));
          } finally {
            const latest = geometries.get(id) ?? geometry;
            if (!orderedSizes) synchronizeViews(id, latest);
            await window.runhuddle.resize(id, latest.cols, latest.rows);
          }
          return;
        }
        await window.runhuddle.resize(id, geometry.cols, geometry.rows);
      }
      void resize(geometry).catch((error) => {
        if (geometries.get(id) === geometry) geometries.delete(id);
        fail(error);
      });
    };
    const finishReplay = () => {
      if (disposed) return;
      const pending = queued.splice(0).filter((event) => event.sequence > lastSequence);
      if (pending.length) {
        pending.forEach((event, index) => {
          applyEvent(event, index === pending.length - 1 ? finishReplay : undefined);
        });
        return;
      }
      ready = true;
      scheduleCheckpoint();
      fitCurrent.current();
    };
    window.runhuddle
      .replay(id)
      .then((replay) => {
        if (disposed) return;
        orderedSizes = !!replay.sizes?.length;
        const initialSize = replay.sizes?.[0] ??
          (replay.cols && replay.rows ? { cols: replay.cols, rows: replay.rows } : undefined);
        needsRedraw = redrawOnTruncatedReplay && replay.data.length >= 512 * 1024;
        lastSequence = replay.sequence;
        const saved = replay.data.length >= 512 * 1024 ? readScrollback(id) : undefined;
        const writeReplay = (prefix: string, done: () => void) => {
          if (initialSize) applySize(initialSize);
          const sizes = replay.sizes ?? [];
          // Parse each stretch of output before applying the size its successor used.
          function writeSegment(index: number, start: number, seed = "") {
            if (disposed) return;
            const next = sizes[index];
            term.write(seed + replay.data.slice(start, next?.offset), () => {
              if (disposed) return;
              if (!next) return done();
              applySize(next);
              writeSegment(index + 1, next.offset);
            });
          }
          writeSegment(1, 0, prefix);
        };
        // Replayed terminal queries must never send responses back to the live process.
        writeReplay("", () => {
          if (saved && saved.sequence <= replay.sequence &&
              !(saved.sequence < replay.sequence && replay.data.includes("\x1b[3J"))) {
            const missing = historyBeforeReplay(saved.lines, term.buffer.normal);
            if (missing.some(Boolean)) {
              term.reset();
              writeReplay(seedScrollback(missing, initialSize?.rows ?? term.rows), finishReplay);
              return;
            }
          }
          finishReplay();
        });
      })
      .catch(fail);
    const directorySubscription = term.parser.registerOscHandler(7, (value) => {
      if (directoryHandler.current && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value)) {
        try {
          const url = new URL(value);
          if (url.protocol === "file:" && url.pathname) {
            const directory = decodeURIComponent(url.pathname);
            if (!/[\x00-\x1f\x7f]/.test(directory)) directoryHandler.current(directory);
          }
        } catch {}
      }
      return false;
    });
    const titleSubscription = term.onTitleChange((title) =>
      titleHandler.current(title),
    );
    let locked: boolean | undefined;
    const lockSubscription = term.onWriteParsed(() => {
      scheduleCheckpoint();
      if (!lockHandler.current) return;
      const buffer = term.buffer.active;
      const end = buffer.baseY + term.rows;
      let footer = "";
      for (let i = Math.max(buffer.baseY, end - 24); i < end; i++) {
        const line = buffer.getLine(i);
        if (line) footer += (line.isWrapped ? "" : " ") + line.translateToString();
      }
      footer = footer.replace(/\s+/g, " ");
      // Codex does not write the lock prompt to its transcript.
      const next = /This conversation is open in another app.*Close it there and press R to continue here\..*r retry f fork.*command center/i.test(footer);
      if (next !== locked) {
        locked = next;
        lockHandler.current?.(locked);
      }
    });
    const input = term.onData((data) => {
      if (data && ready && canUseTerminal.current) window.runhuddle.write(id, data).catch(fail);
    });
    const canPaste = () => !!(canUseTerminal.current && host.current?.getClientRects().length && ready && !locked);
    const paste = async (text: string, focus: boolean) => {
      if (!canUseTerminal.current || !host.current?.getClientRects().length || !ready)
        throw Error("Open the session terminal before attaching.");
      if (locked) throw Error("This Codex conversation is in use elsewhere.");
      const data = term.modes.bracketedPasteMode ? "\x1b[200~" + text + "\x1b[201~" : text;
      await window.runhuddle.write(id, data);
      if (focus && !disposed && canPaste()) term.focus();
    };
    const entry = { paste, ready: canPaste };
    const pastes = terminalPastes.get(id) ?? new Set<DraftPaste>();
    pastes.add(entry);
    terminalPastes.set(id, pastes);
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => fitCurrent.current(), 60);
    });
    observer.observe(host.current!);
    return () => {
      if (checkpointTimer !== undefined) checkpoint();
      window.removeEventListener("pagehide", checkpoint);
      window.removeEventListener("beforeunload", checkpoint);
      disposed = true;
      pastes.delete(entry);
      if (!pastes.size && terminalPastes.get(id) === pastes) terminalPastes.delete(id);
      clearTimeout(timer);
      observer.disconnect();
      input.dispose();
      titleSubscription.dispose();
      directorySubscription.dispose();
      lockSubscription.dispose();
      off();
      peers.delete(term);
      if (!peers.size) terminalViews.delete(id);
      term.dispose();
      instance.current = undefined;
    };
  }, [id, fontsReady, redrawOnTruncatedReplay]);
  useEffect(() => {
    if (!instance.current) return;
    const { term } = instance.current;
    term.options = terminalOptions(appearance);
    fitCurrent.current();
    if (visible) term.refresh(0, term.rows - 1);
  }, [appearance, fontsReady, id]);
  useEffect(() => {
    if (instance.current) instance.current.term.options.disableStdin = readOnly;
  }, [readOnly, fontsReady]);
  useEffect(() => {
    if (!visible || !active) return;
    const previousFocus = document.activeElement;
    const frame = requestAnimationFrame(() => {
      fitCurrent.current();
      if (focused && document.activeElement === previousFocus)
        instance.current?.term.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, active, focused, fontsReady, id]);
  return (
    <div
      className="terminal-host"
      ref={host}
      aria-label="Terminal"
      style={{ display: visible ? "block" : "none" }}
    />
  );
}
