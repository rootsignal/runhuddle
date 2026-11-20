import fs from "node:fs/promises";
import path from "node:path";
import extensions from "./preview-file-types.json" with { type: "json" };

const limit = 256 * 1024;
const supported = new Set(extensions);
const extension = (file) => path.extname(file).slice(1).toLowerCase();

export async function readProjectPreview(cwd, reference) {
  if (!path.isAbsolute(cwd) || typeof reference !== "string" || !reference.trim() || reference.length > 4096 ||
      /[\x00-\x1f\x7f]/.test(reference) || !supported.has(extension(reference)))
    throw Error("Choose a supported text file in this session’s project.");
  const root = await fs.realpath(cwd);
  const requested = path.resolve(cwd, reference);
  const inside = (directory, file) => {
    const relative = path.relative(directory, file);
    return !!relative && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
  };
  if (!inside(cwd, requested) && !inside(root, requested)) throw Error("This file is outside the session’s project.");
  const file = await fs.realpath(requested).catch(() => { throw Error("This file is no longer available."); });
  if (!inside(root, file)) throw Error("This file is outside the session’s project.");
  if (!supported.has(extension(file))) throw Error("This file type is unavailable in Preview.");
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw Error("This reference is not a file.");
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (buffer.subarray(0, length).includes(0)) throw Error("This file does not appear to contain text.");
    return {
      path: path.relative(root, file),
      markdown: ["md", "markdown"].includes(extension(file)),
      text: buffer.subarray(0, Math.min(length, limit)).toString("utf8"),
      truncated: length > limit,
    };
  } finally {
    await handle.close();
  }
}
