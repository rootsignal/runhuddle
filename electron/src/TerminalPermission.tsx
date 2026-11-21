import { useEffect } from "react";
import { Terminal } from "@xterm/xterm";
import type { AppEvent } from "./types";

export type TerminalPermissionPrompt = { question: string; choices: string[] };

const heading = /Would you like to (?:run the following command|grant these permissions|make the following edits|send input to the existing terminal)\?/i;
const choice = /^(?:[›❯>→]\s*)?\d+[.)]\s+((?:yes|no|allow|deny|run|cancel)\b.+)$/i;

export function TerminalPermissionObserver({ id, onPrompt, onWorking }: {
  id: string;
  onPrompt: (id: string, prompt?: TerminalPermissionPrompt) => void;
  onWorking: (id: string, working: boolean) => void;
}) {
  useEffect(() => {
    const terminal = new Terminal({ cols: 240, rows: 100, scrollback: 0 });
    let sequence = -1;
    let ready = false;
    let disposed = false;
    type TerminalEvent = Extract<AppEvent, { event: "output" | "terminal-size" }>;
    const queued: TerminalEvent[] = [];
    const scan = terminal.onWriteParsed(() => {
      if (!ready) return;
      const buffer = terminal.buffer.active;
      const lines = Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i)?.translateToString(true).trim() ?? "");
      const footer = lines.filter(Boolean).slice(-14).join(" ");
      onWorking(id, /(?:^|\s)[•●]\s*Working\s*\([^)]*\besc to interrupt\)/i.test(footer));
      let start = lines.length - 1;
      while (start >= 0 && !heading.test(lines[start])) start--;
      const choices = start < 0 ? [] : lines.slice(start + 1, start + 30)
        .flatMap((line) => line.match(choice)?.[1] ?? []);
      onPrompt(id, choices.length >= 2
        ? { question: lines[start].match(heading)![0], choices }
        : undefined);
    });
    function write(event: TerminalEvent) {
      if (event.sequence <= sequence) return;
      sequence = event.sequence;
      if (event.event === "output") terminal.write(event.data);
      else terminal.write("", () => {
        if (!disposed) terminal.resize(event.cols, event.rows);
      });
    }
    const unsubscribe = window.runhuddle.onEvent((event) => {
      if ((event.event !== "output" && event.event !== "terminal-size") || event.id !== id) return;
      if (ready) write(event);
      else queued.push(event);
    });
    function finishReplay() {
      if (disposed) return;
      ready = true;
      queued.splice(0).forEach(write);
      terminal.write("");
    }
    void window.runhuddle.replay(id).then((replay) => {
      if (disposed) return;
      sequence = replay.sequence;
      const sizes = replay.sizes ?? [];
      const first = sizes[0] ?? replay;
      if (first.cols && first.rows) terminal.resize(first.cols, first.rows);
      function writeSegment(index: number, offset: number) {
        const next = sizes[index];
        terminal.write(replay.data.slice(offset, next?.offset), () => {
          if (disposed) return;
          if (!next) return finishReplay();
          terminal.resize(next.cols, next.rows);
          writeSegment(index + 1, next.offset);
        });
      }
      writeSegment(1, 0);
    }, finishReplay);
    return () => {
      disposed = true;
      unsubscribe();
      scan.dispose();
      terminal.dispose();
      onPrompt(id);
      onWorking(id, false);
    };
  }, [id, onPrompt, onWorking]);
  return null;
}
