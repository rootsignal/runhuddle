import { useEffect } from "react";
import { Terminal } from "@xterm/xterm";

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
    const queued: { sequence: number; data: string }[] = [];
    const scan = terminal.onWriteParsed(() => {
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
    function write(event: { sequence: number; data: string }) {
      if (event.sequence <= sequence) return;
      sequence = event.sequence;
      terminal.write(event.data);
    }
    const unsubscribe = window.runhuddle.onEvent((event) => {
      if (event.event !== "output" || event.id !== id) return;
      if (ready) write(event);
      else queued.push(event);
    });
    void window.runhuddle.replay(id).then((replay) => {
      if (disposed) return;
      write(replay);
      ready = true;
      queued.forEach(write);
      queued.length = 0;
    }, () => {
      if (disposed) return;
      ready = true;
      queued.forEach(write);
      queued.length = 0;
    });
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
