import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import xterm from "@xterm/xterm";

const conversationLocked = /Close it there and press R to continue here/i;
const maxFollowUpLength = 16000;
const replayLimit = 512 * 1024;

async function readTerminalScreen(replay, codex = false) {
  const sizes = replay.sizes ?? [];
  const initial = sizes[0] ?? replay;
  if (!initial.cols || !initial.rows) return;
  const term = new xterm.Terminal({ cols: initial.cols, rows: initial.rows, scrollback: 0, allowProposedApi: true });
  try {
    // Unix Codex enables bracketed paste on startup. When the startup output
    // has rolled out of the buffer, let retained mode changes and resets
    // override that initial mode as the replay is parsed.
    if (codex && process.platform !== "win32" && replay.data.length === replayLimit)
      await new Promise((done) => term.write("\x1b[?2004h", done));
    let offset = 0;
    for (const size of sizes.slice(1)) {
      await new Promise((done) => term.write(replay.data.slice(offset, size.offset), done));
      term.resize(size.cols, size.rows);
      offset = size.offset;
    }
    await new Promise((done) => term.write(replay.data.slice(offset), done));
    const buffer = term.buffer.active;
    const lines = Array.from({ length: term.rows }, (_, i) =>
      buffer.getLine(buffer.baseY + i)?.translateToString(true).trim() ?? "").filter(Boolean);
    return { lines, bracketedPaste: term.modes.bracketedPasteMode };
  } finally {
    term.dispose();
  }
}

export async function codexPromptReady(replay) {
  if (!replay?.data || process.platform === "win32") return false;
  const screen = await readTerminalScreen(replay, true);
  if (!screen?.bracketedPaste) return false;
  const footer = screen.lines.slice(-8);
  return footer.some((line) => /^›\s+Ask Codex to do anything$/.test(line)) &&
    /[?] for shortcuts/i.test(footer.at(-1) ?? "") &&
    !conversationLocked.test(screen.lines.join(" ")) &&
    !footer.some((line) => /esc to interrupt|^permission (?:required|requested)\b|background terminal running/i.test(line));
}

export const screenshotReferences = /\n\nScreenshots to inspect:\n(?:- "[^"\r\n]*[\\/]runhuddle-screenshots-[^"\r\n]+[\\/]screenshot-\d+\.png"(?:\n|$))+$/;

const nextStepsRequest = "If concrete work remains, end your reply with one line starting “Next step:” and name the action. If you need my decision, use “Needs your decision:” and state the choice instead. If neither applies, omit both.";

export function stripDashboardNextSteps(text) {
  const screenshots = text.match(screenshotReferences)?.[0] ?? "";
  const instruction = screenshots ? text.slice(0, -screenshots.length) : text;
  const suffix = "\n\n" + nextStepsRequest;
  return instruction.endsWith(suffix) ? instruction.slice(0, -suffix.length) + screenshots : text;
}

export async function sendDashboardFollowUp(service, entry, terminalId, message, stillCurrent, images = [], toPng, queued = false, suggestNextSteps = false) {
  const text = typeof message === "string" ? message.replace(/\r\n/g, "\n").trim() : "";
  if (!Array.isArray(images) || images.length > 8 ||
      images.some((image) => !(image instanceof ArrayBuffer) || !image.byteLength || image.byteLength > 10 * 1024 * 1024))
    throw Error("Attach up to 8 screenshots of 10 MB each.");
  if ((!text && !images.length) || text.length > maxFollowUpLength || /[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(text) || /^[!/]/.test(text)) {
    throw Error("Enter a message of up to 16,000 characters without control characters or terminal commands.");
  }
  const target = "This session is no longer ready for a follow-up. Open it to continue.";
  const currentRow = (rows) => rows.find((row) => row.provider === entry.provider &&
    row.sessionID === entry.sessionID && row.terminalId === terminalId && !row.simulated);

  const terminals = await service.call("list");
  if (!terminals.some((row) => row.id === terminalId && !row.exited &&
      row.agent === entry.provider.toLowerCase() && row.sessionID === entry.sessionID)) throw Error(target);

  const replay = await service.call("replay", { id: terminalId });
  const pasteMode = [...replay.data.matchAll(/\x1b\[\?[\d;]*\b2004(?:;\d+)*([hl])/g)].at(-1)?.[1];
  const recentOutput = replay.data.slice(-12000);
  const screen = await readTerminalScreen(replay, entry.provider === "Codex");
  const locked = conversationLocked.test(screen ? screen.lines.join(" ") : recentOutput);
  const acceptsPaste = screen?.bracketedPaste ?? (pasteMode === "h");
  if (!acceptsPaste || locked) {
    if (queued) return "waiting";
    throw Error("Open the session to continue. Its terminal is not accepting dashboard messages.");
  }

  let directory;
  let messageToPaste = text || "Review the attached screenshots.";
  if (suggestNextSteps === true) messageToPaste += "\n\n" + nextStepsRequest;
  let writeStarted = false;
  try {
    if (images.length) {
      directory = await fs.mkdtemp(path.join(os.tmpdir(), "runhuddle-screenshots-"));
      const references = [];
      for (const [index, bytes] of images.entries()) {
        const png = toPng(bytes);
        if (!png.length) throw Error("One of the screenshots could not be read.");
        const file = path.join(directory, `screenshot-${index + 1}.png`);
        if (/["\x00-\x1f\x7f]/.test(file)) throw Error("The screenshot path cannot be sent.");
        await fs.writeFile(file, png, { mode: 0o600 });
        references.push(`- "${file}"`);
      }
      messageToPaste += "\n\nScreenshots to inspect:\n" + references.join("\n");
    }
    let current = currentRow(await service.call("sessions"));
    const state = current?.state;
    if (queued || (current?.provider === "Codex" && state === "disconnected")) {
      const ready = current?.provider === "Codex" && (state === "idle" || state === "disconnected") &&
        await codexPromptReady(await service.call("replay", { id: terminalId }));
      if (ready) {
        current = currentRow(await service.call("sessions"));
        if (current?.state === "disconnected") current = { ...current, state: "idle" };
      } else if (queued) return "waiting";
    }
    if (current?.state !== "idle" || !stillCurrent()) {
      if (queued) return "waiting";
      throw Error(target);
    }
    // Deliver the paste and submit together to the verified PTY.
    writeStarted = true;
    await service.call("write", { id: terminalId, data: "\x1b[200~" + messageToPaste + "\x1b[201~\r" });
  } finally {
    if (directory && !writeStarted) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
