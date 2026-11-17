import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { Service } from "../../main/service.mjs";
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");
test("workspace navigation, retained search, notes and persistent terminal across full app quit", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-ui-"));
  const dbFile = path.join(dir, "sessions.sqlite");
  const db = new DatabaseSync(dbFile);
  db.exec("CREATE TABLE records(key TEXT PRIMARY KEY,value BLOB)");
  const insert = db.prepare("INSERT INTO records VALUES(?,?)");
  insert.run(
    "sessions",
    Buffer.from(
      JSON.stringify([
        {
          provider: "Claude",
          sessionID: "fixture",
          title: "Investigate workspace navigation",
          cwd: dir,
          project: "Preview project",
          preview: "A saved preview, not live activity.",
          state: "idle",
          updated: Date.now() / 1000,
        },
      ]),
    ),
  );
  insert.run(
    "savedWorkLibrary",
    Buffer.from(
      JSON.stringify([
        {
          id: "note-one",
          title: "Workspace decisions",
          text: "Keep the terminal service independent of the window.",
          project: dir,
          sourceProvider: "Claude",
        },
      ]),
    ),
  );
  db.close();
  const env = {
    ...process.env,
    RUNHUDDLE_PREVIEW_DATA: path.join(dir, "preview"),
    RUNHUDDLE_NATIVE_STORE: dbFile,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = {
    args: process.env.RUNHUDDLE_TEST_EXECUTABLE ? [] : [path.resolve(".")],
    env,
    executablePath: process.env.RUNHUDDLE_TEST_EXECUTABLE,
  };
  let app = await electron.launch(launch);
  console.log("UI: app launched");
  app
    .process()
    .on("exit", (code, signal) =>
      console.log("UI: app process exit", code, signal),
    );
  app
    .process()
    .on("close", (code, signal) =>
      console.log("UI: app process close", code, signal),
    );
  app.process().stderr?.on("data", (data) => console.log(String(data)));
  let terminalId = "";
  try {
    let page = await app.firstWindow();
    console.log("UI: window ready");
    await page.waitForLoadState("domcontentloaded");
    await expect(
      page.getByRole("button", { name: /Investigate workspace navigation/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /Investigate workspace navigation/ })
      .click();
    await expect(
      page.getByRole("heading", { name: "Investigate workspace navigation" }),
    ).toBeVisible();
    await page.getByRole("searchbox").fill("Investigate");
    await page.getByRole("button", { name: "Pinned", exact: true }).click();
    await expect(
      page.getByText("No sessions match these filters."),
    ).toBeVisible();
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.getByRole("searchbox")).toHaveValue("Investigate");
    await page.getByRole("searchbox").fill("");
    await page.getByRole("button", { name: "Notes", exact: true }).click();
    await page.getByRole("button", { name: /Workspace decisions/ }).click();
    await expect(
      page.getByText("Keep the terminal service independent of the window."),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Workspace", exact: true })
      .selectOption(dir);
    await page
      .getByRole("button", { name: "New terminal", exact: false })
      .click();
    await expect(page.getByRole("tab")).toHaveCount(1);
    console.log("UI: terminal tab ready");
    terminalId = await page.evaluate(
      async () => (await (window as any).runhuddle.snapshot()).terminals[0].id,
    );
    await page
      .locator(".xterm-helper-textarea")
      .pressSequentially(
        process.platform === "win32"
          ? "echo RH_UI^_TEST"
          : "printf 'RH_%s\\n' UI_TEST",
      );
    await page.locator(".xterm-helper-textarea").press("Enter");
    await expect
      .poll(() =>
        page.evaluate(
          async (id) => (await (window as any).runhuddle.replay(id)).data,
          terminalId,
        ),
      )
      .toContain("RH_UI_TEST");
    await page.screenshot({ path: "test-results/preview-terminal.png" });
    console.log("UI: quitting app with live terminal");
    await app.close();
    console.log("UI: app quit, relaunching");
    app = await electron.launch(launch);
    page = await app.firstWindow();
    await expect(page.getByRole("tab")).toHaveCount(1);
    console.log("UI: terminal tab ready");
    expect(
      await page.evaluate(
        async () =>
          (await (window as any).runhuddle.snapshot()).terminals[0].id,
      ),
    ).toBe(terminalId);
    await expect
      .poll(() =>
        page.evaluate(
          async (id) => (await (window as any).runhuddle.replay(id)).data,
          terminalId,
        ),
      )
      .toContain("RH_UI_TEST");
    await page.getByRole("button", { name: "Recent", exact: true }).click();
    await page
      .getByRole("button", { name: /Investigate workspace navigation/ })
      .click();
    await page.screenshot({ path: "test-results/preview-session.png" });
  } finally {
    console.log("UI: stopping test service");
    const client = new Service(path.join(dir, "preview", "service"));
    try {
      await client.connect();
      await client.call("shutdown");
    } finally {
      client.disconnect();
    }
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
