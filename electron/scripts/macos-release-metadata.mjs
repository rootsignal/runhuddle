import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const app = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url)));
const directory = process.argv[2] || "dist/package";
const { version } = app;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error("Expected a stable version in package.json");
const dmg = `RunHuddle-${version}-arm64.dmg`;
const zip = `RunHuddle-${version}-arm64.zip`;
const installer = fs.readFileSync(path.join(directory, dmg));
const archive = fs.readFileSync(path.join(directory, zip));
const digest = (algorithm, bytes, encoding = "hex") =>
  createHash(algorithm).update(bytes).digest(encoding);
const archiveHash = digest("sha512", archive, "base64");
const minimumMacOS = app.build.mac.minimumSystemVersion;
if (!/^\d+\.\d+$/.test(minimumMacOS)) throw Error("Expected a minimum macOS version");
const updatePath = path.join(directory, "latest-mac.yml");
const previousUpdate = fs.existsSync(updatePath) ? fs.readFileSync(updatePath, "utf8") : "";
const releaseDate = /^releaseDate: ['"]?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)['"]?$/m.exec(previousUpdate)?.[1]
  ?? new Date().toISOString();
const update = [
  `version: ${version}`,
  "files:",
  `  - url: ${zip}`,
  `    sha512: ${archiveHash}`,
  `    size: ${archive.length}`,
  `path: ${zip}`,
  `sha512: ${archiveHash}`,
  `minimumSystemVersion: "${minimumMacOS}"`,
  `releaseDate: "${releaseDate}"`,
  "",
].join("\n");
const sha256 = digest("sha256", installer);
fs.writeFileSync(path.join(directory, dmg + ".sha256"), `${sha256}  ${dmg}\n`);
fs.writeFileSync(updatePath, update);
fs.writeFileSync(path.join(directory, "macos-release.json"), JSON.stringify({
  version, minimumMacOS, architecture: "Apple Silicon", file: dmg,
  bytes: installer.length, sha256, updateManifestSha256: digest("sha256", update),
}, null, 2) + "\n");
