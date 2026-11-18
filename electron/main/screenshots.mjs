import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { nativeImage } from "electron";

const exec = promisify(execFile);
const imageName = /\.(png|jpe?g|heic|heif|tiff?|webp|bmp|pdf)$/i;
const screenshotName =
  /^(?:screen[ _-]?shot|capture d’écran|bildschirmfoto|captura de pantalla)(?:[ _(-]|\.)/iu;
const screenshotAttribute = "com.apple.metadata:kMDItemIsScreenCapture";

async function systemFolders(desktop, pictures, home) {
  if (process.platform === "darwin") {
    const folders = [[desktop, "metadata"]];
    try {
      const { stdout } = await exec(
        "/usr/bin/defaults",
        ["read", "com.apple.screencapture", "location"],
        { timeout: 1500 },
      );
      const location = stdout.trim().replace(/^~(?=\/|$)/, () => home);
      if (path.isAbsolute(location)) folders.push([location, "metadata"]);
    } catch {}
    return folders;
  }
  const folders = [[path.join(pictures, "Screenshots"), "directory"]];
  if (process.platform === "win32") {
    const screenshotFolder = "{B7BEDE81-DF94-4682-A7D8-57A52620B86F}";
    try {
      const { stdout } = await exec(
        "reg.exe",
        [
          "query",
          "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders",
          "/v",
          screenshotFolder,
        ],
        { timeout: 1500, windowsHide: true },
      );
      const location = stdout
        .match(/REG_(?:EXPAND_)?SZ\s+([^\r\n]+)/)?.[1]
        .trim()
        .replace(/%([^%]+)%/g, (match, key) => process.env[key] || match);
      if (location && path.isAbsolute(location))
        folders.push([location, "directory"]);
    } catch {}
    for (const oneDrive of [
      process.env.OneDrive,
      process.env.OneDriveConsumer,
      process.env.OneDriveCommercial,
    ]) {
      if (oneDrive && path.isAbsolute(oneDrive))
        folders.push([
          path.join(oneDrive, "Pictures", "Screenshots"),
          "directory",
        ]);
    }
  } else {
    folders.push([pictures, "named"]);
  }
  return folders;
}

async function makeThumbnail(file) {
  if (process.platform !== "linux") {
    try {
      const thumbnail = await nativeImage.createThumbnailFromPath(file, {
        width: 240,
        height: 144,
      });
      if (!thumbnail.isEmpty()) return thumbnail;
    } catch {}
  }
  const image = nativeImage.createFromPath(file);
  if (image.isEmpty()) return image;
  const size = image.getSize();
  const scale = Math.min(1, 240 / size.width, 144 / size.height);
  return scale === 1
    ? image
    : image.resize({ width: Math.max(1, Math.round(size.width * scale)) });
}

export function screenshotMonitor({
  desktop,
  pictures,
  home,
  customFolder,
  publish,
}) {
  const watchers = new Map();
  const timers = new Map();
  const recent = new Map();
  const seen = new Map();
  let enabled = false;
  let started = 0;
  let generation = 0;

  async function inspect(file, entry) {
    if (watchers.get(entry.directory) !== entry || !enabled) return;
    try {
      const stat = await fs.promises.lstat(file);
      const created = stat.birthtimeMs || stat.mtimeMs;
      if (
        !stat.isFile() ||
        created < started ||
        !stat.size ||
        stat.size > 64 * 1024 * 1024
      )
        return;
      const identity =
        file + ":" + stat.dev + ":" + stat.ino + ":" + stat.birthtimeMs;
      if (seen.has(identity)) return;
      if (entry.kind === "metadata")
        await exec("/usr/bin/xattr", ["-p", screenshotAttribute, file], {
          timeout: 1500,
        });
      const thumbnail = await makeThumbnail(file);
      if (
        thumbnail.isEmpty() ||
        watchers.get(entry.directory) !== entry ||
        seen.has(identity)
      )
        return;
      seen.set(identity, true);
      if (seen.size > 256) seen.delete(seen.keys().next().value);
      const id = randomUUID();
      recent.set(id, { file, identity });
      if (recent.size > 16) recent.delete(recent.keys().next().value);
      publish({
        event: "screenshot",
        screenshot: {
          id,
          name: path.basename(file),
          thumbnail: thumbnail.toDataURL(),
        },
      });
    } catch {
      // The file may still be finishing, deleted, or inaccessible. A later event can retry.
    }
  }

  function schedule(entry, name) {
    if (!name || !imageName.test(name) || name !== path.basename(name)) return;
    if (entry.kind === "named" && !screenshotName.test(name)) return;
    const file = path.join(entry.directory, name);
    if (!timers.has(file) && timers.size >= 32) return;
    clearTimeout(timers.get(file));
    timers.set(
      file,
      setTimeout(() => {
        timers.delete(file);
        void inspect(file, entry);
      }, 350),
    );
  }

  function watch(directory, kind) {
    const current = watchers.get(directory);
    let parent = directory;
    while (!fs.statSync(parent, { throwIfNoEntry: false })?.isDirectory()) {
      const next = path.dirname(parent);
      if (next === parent) return;
      parent = next;
    }
    if (current?.parent === parent && current.kind === kind) return;
    current?.watcher.close();
    watchers.delete(directory);
    const entry = { directory, parent, kind };
    entry.watcher = fs.watch(parent, (_event, name) => {
      if (parent === directory) schedule(entry, name);
      else if (
        !name ||
        name === path.relative(parent, directory).split(path.sep)[0]
      ) {
        try {
          watch(directory, kind);
        } catch {}
      }
    });
    entry.watcher.on("error", () => {
      entry.watcher.close();
      if (watchers.get(directory) === entry) watchers.delete(directory);
    });
    watchers.set(directory, entry);
    if (current && current.parent !== directory && parent === directory) {
      // The screenshot app may have written its first image while creating the folder.
      for (const name of fs.readdirSync(directory)) schedule(entry, name);
    }
  }

  async function refresh() {
    if (!enabled) return;
    const request = ++generation;
    const override = process.env.RUNHUDDLE_SCREENSHOT_DIRECTORY;
    const custom = customFolder();
    const directories = override
      ? [[override, process.platform === "darwin" ? "metadata" : "named"]]
      : custom
        ? [[custom, "directory"]]
        : await systemFolders(desktop, pictures, home);
    if (!enabled || request !== generation) return;
    const wanted = new Map(
      directories.map(([directory, kind]) => [path.resolve(directory), kind]),
    );
    for (const [directory, entry] of watchers) {
      if (wanted.has(directory)) continue;
      entry.watcher.close();
      watchers.delete(directory);
    }
    for (const [directory, kind] of wanted)
      try {
        watch(directory, kind);
      } catch {}
  }

  function stop() {
    enabled = false;
    for (const entry of watchers.values()) entry.watcher.close();
    watchers.clear();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    recent.clear();
    seen.clear();
  }

  return {
    enable() {
      started = Date.now();
      enabled = true;
      void refresh();
    },
    refresh,
    stop,
    async file(id) {
      const entry = recent.get(id);
      if (entry) {
        const stat = await fs.promises.lstat(entry.file).catch(() => null);
        if (
          stat?.isFile() &&
          entry.file +
            ":" +
            stat.dev +
            ":" +
            stat.ino +
            ":" +
            stat.birthtimeMs ===
            entry.identity
        )
          return entry.file;
      }
      throw Error("The screenshot file is no longer available.");
    },
  };
}
