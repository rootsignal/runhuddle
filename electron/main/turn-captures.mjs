import fs from "node:fs";
import path from "node:path";

const maximumBytes = 8 * 1024 * 1024;
const areas = new Set(["staged", "unstaged", "untracked", "committed"]);

function validFile(entry) {
  const file = entry?.file;
  return typeof file?.path === "string" && file.path.length > 0 && file.path.length <= 4096 &&
    !path.posix.isAbsolute(file.path) && !path.win32.isAbsolute(file.path) &&
    !file.path.split(/[\\/]/).includes("..") && !file.path.includes("\0") &&
    typeof file.status === "string" && file.status.length === 1 && areas.has(file.area) &&
    (entry.diff === undefined || (typeof entry.diff === "string" && entry.diff.length <= 24000));
}

function validRange(range) {
  return range === undefined || (range &&
    [range.from, range.to].every((id) => typeof id === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(id)) &&
    Number.isSafeInteger(range.omitted) && range.omitted >= 0);
}

function validCapture(entry) {
  return typeof entry?.session === "string" && entry.session.length > 0 && entry.session.length <= 256 &&
    Number.isSafeInteger(entry.instructionAt) && entry.instructionAt > 0 &&
    typeof entry.root === "string" && entry.root.length <= 4096 && path.isAbsolute(entry.root) &&
    Array.isArray(entry.files) && entry.files.length > 0 && entry.files.length <= 160 && entry.files.every(validFile) && validRange(entry.commitRange);
}

export function turnCaptureStore(file) {
  let entries = [];
  try {
    if (fs.statSync(file).size <= maximumBytes) {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(saved)) entries = saved.filter(validCapture);
    }
  } catch {}

  const list = () => Object.fromEntries([...Map.groupBy(entries, (entry) => entry.session)].map(([session, captures]) =>
    [session, captures.map(({ session: _session, ...capture }) => capture)]));
  return {
    list,
    save(session, capture) {
      const entry = { session, instructionAt: capture?.instructionAt, root: capture?.root, files: capture?.files, commitRange: capture?.commitRange };
      if (!validCapture(entry)) throw Error("Invalid turn capture.");
      entry.files = entry.files.map(({ file, diff }) =>
        ({ file: { path: file.path, status: file.status, area: file.area }, diff }));
      const next = [entry, ...entries.filter((item) =>
        item.session !== session || item.instructionAt !== entry.instructionAt)]
        .sort((a, b) => b.instructionAt - a.instructionAt);
      const counts = new Map();
      let bytes = 2;
      const retained = [];
      for (const item of next) {
        const count = counts.get(item.session) ?? 0;
        const size = Buffer.byteLength(JSON.stringify(item)) + 1;
        if (count >= 5 || bytes + size > maximumBytes) continue;
        counts.set(item.session, count + 1);
        retained.push(item);
        bytes += size;
      }
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const temporary = file + ".tmp";
      try {
        fs.writeFileSync(temporary, JSON.stringify(retained), { mode: 0o600 });
        fs.renameSync(temporary, file);
        entries = retained;
      } finally {
        fs.rmSync(temporary, { force: true });
      }
      return list();
    },
  };
}
