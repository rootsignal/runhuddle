import { spawnSync } from "node:child_process";
import electron from "electron";
import fs from "node:fs";
const files = fs
  .readdirSync("tests")
  .filter((f) => f.endsWith(".test.mjs"))
  .map((f) => "tests/" + f);
const result = spawnSync(electron, ["--test", ...files], {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
});
process.exit(result.status ?? 1);
