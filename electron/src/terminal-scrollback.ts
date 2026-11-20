import type { IBuffer } from "@xterm/xterm";

const storagePrefix = "runhuddle.terminalScrollback.";
const maxLines = 2500;
const maxCharacters = 128 * 1024;
const maxTerminals = 12;

type Scrollback = { lines: string[]; sequence: number; savedAt: number };

export function readScrollback(id: string): Scrollback | undefined {
  try {
    const saved: Scrollback = JSON.parse(localStorage.getItem(storagePrefix + id) ?? "null");
    if (saved && Array.isArray(saved.lines) && saved.lines.length <= maxLines &&
        saved.lines.every((line) => typeof line === "string") && Number.isSafeInteger(saved.sequence))
      return saved;
  } catch {
    // A missing or unreadable checkpoint still permits ordinary terminal replay.
  }
}

export function scrollbackLines(buffer: IBuffer) {
  const lines: string[] = [];
  let length = 0;
  for (let index = buffer.baseY - 1; index >= 0 && lines.length < maxLines; index--) {
    const line = buffer.getLine(index)?.translateToString(true) ?? "";
    length += line.length + 2;
    if (length > maxCharacters) break;
    lines.push(line);
  }
  return lines.reverse();
}

export function saveScrollback(id: string, buffer: IBuffer, sequence: number) {
  const old = readScrollback(id);
  if (old && old.sequence > sequence) return;
  const lines = scrollbackLines(buffer);
  if (old?.sequence === sequence && old.lines.length >= lines.length) return;
  try {
    const key = storagePrefix + id;
    if (!lines.length) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify({ lines, sequence, savedAt: Date.now() }));
    const stored = Object.keys(localStorage).filter((key) => key.startsWith(storagePrefix));
    if (stored.length > maxTerminals) {
      const oldest = stored.filter((item) => item !== key)
        .map((item) => ({ item, time: readScrollback(item.slice(storagePrefix.length))?.savedAt ?? 0 }))
        .sort((a, b) => a.time - b.time);
      for (const { item } of oldest.slice(0, stored.length - maxTerminals)) localStorage.removeItem(item);
    }
  } catch {
    // The live terminal continues to work if local storage is full.
  }
}

export function historyBeforeReplay(saved: string[], buffer: IBuffer) {
  const existing: string[] = [];
  for (let index = 0; index < Math.min(buffer.baseY, saved.length); index++)
    existing.push(buffer.getLine(index)?.translateToString(true) ?? "");
  if (!existing.length) return saved;

  // Find the longest prefix of the replay that already appears at the end of the checkpoint.
  const prefix = Array(existing.length).fill(0);
  for (let index = 1, length = 0; index < existing.length; index++) {
    while (length && existing[index] !== existing[length]) length = prefix[length - 1];
    if (existing[index] === existing[length]) length++;
    prefix[index] = length;
  }
  let overlap = 0;
  for (const line of saved) {
    while (overlap && line !== existing[overlap]) overlap = prefix[overlap - 1];
    if (line === existing[overlap]) overlap++;
  }
  return saved.slice(0, saved.length - overlap);
}

export function seedScrollback(lines: string[], rows: number) {
  // Feed only printable history, then clear the visible screen for the PTY's replay.
  return lines.map((line) => line.replace(/[\x00-\x1f\x7f-\x9f]/g, "")).join("\r\n") +
    "\r\n".repeat(rows) + "\x1b[H\x1b[2J";
}
