const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const run = promisify(execFile);

module.exports = async ({ appOutDir, packager, electronPlatformName }) => {
  const profile = process.env.RUNHUDDLE_NOTARY_PROFILE;
  if (electronPlatformName !== "darwin" || !profile) return;
  const app = path.join(appOutDir, packager.appInfo.productFilename + ".app");
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "runhuddle-notary-"));
  const submission = path.join(temp, "RunHuddle.zip");
  try {
    await run("codesign", ["--verify", "--deep", "--strict", app]);
    await run("ditto", ["-c", "-k", "--keepParent", app, submission]);
    const { stdout } = await run("xcrun", ["notarytool", "submit", submission,
      "--keychain-profile", profile, "--wait", "--output-format", "json"]);
    const result = JSON.parse(stdout);
    if (result.status !== "Accepted") throw Error("Apple rejected the application: " + result.id);
    process.stdout.write("Apple accepted RunHuddle application " + result.id + "\n");
    await run("xcrun", ["stapler", "staple", app]);
    await run("xcrun", ["stapler", "validate", app]);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
};
