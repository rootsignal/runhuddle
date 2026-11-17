import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { Service } from "../../main/service.mjs";
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");
// Request a normal app quit asynchronously, so the test is not awaiting a
// debugger evaluation in the process being terminated. Detached helpers may
// retain Playwright diagnostic handles on Linux/Windows. Verify actual process
// exit before releasing those runner handles; never stop the terminal helper.
async function closeUI(
  application: Awaited<ReturnType<typeof electron.launch>>,
) {
  const child = application.process();
  if (child.exitCode === null) {
    const exited = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    );
    await application.evaluate(({ app }) => {
      setTimeout(() => app.quit(), 25);
    });
    await exited;
  }
  for (const stream of child.stdio) stream?.destroy();
  expect(child.exitCode).toBe(0);
}
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
      .getByRole("button", { name: "New session or terminal", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("combobox", { name: "Launch workspace" }),
    ).toHaveValue(dir);
    await page.screenshot({ path: "test-results/preview-launcher.png" });
    await page
      .getByRole("button", { name: "Start Terminal", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
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
    // Creating another tab selects it; workspace switches restore the first tab.
    await page
      .getByRole("button", { name: "New session or terminal", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Start Terminal", exact: true })
      .click();
    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(page.getByRole("tab").nth(1)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("tab").first().click();
    await page
      .getByRole("combobox", { name: "Workspace", exact: true })
      .selectOption("");
    await page.getByRole("tab").nth(1).click();
    await page
      .getByRole("combobox", { name: "Workspace", exact: true })
      .selectOption(dir);
    await expect(page.getByRole("tab").first()).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("tab").nth(1).click();
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 0,
        checkboxChecked: false,
      });
    });
    await page
      .getByRole("button", { name: /^Close / })
      .last()
      .click();
    await expect(page.getByRole("tab")).toHaveCount(2);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    });
    await page
      .getByRole("button", { name: /^Close / })
      .last()
      .click();
    await expect(page.getByRole("tab")).toHaveCount(1);
    await expect(page.getByRole("tab")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    console.log("UI: quitting app with live terminal");
    await closeUI(app);
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
    await page
      .getByRole("button", { name: "New session or terminal", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("button", { name: "Start Terminal", exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole("combobox", { name: "Launch workspace" }),
    ).toHaveValue(dir);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Recent", exact: true }).click();
    await page
      .getByRole("button", { name: /Investigate workspace navigation/ })
      .click();
    await page.screenshot({ path: "test-results/preview-session.png" });
    // Verify each provider choice and failure recovery without launching a paid CLI.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("create");
      ipcMain.handle("create", (_event, cwd, agent) => {
        throw new Error(`Test launch ${agent} in ${cwd}`);
      });
    });
    await page
      .getByRole("button", { name: "New session in this folder" })
      .click();
    for (const [label, agent] of [
      ["Claude session", "claude"],
      ["Codex session", "codex"],
      ["Copilot session", "copilot"],
    ]) {
      await page
        .getByRole("button", { name: `Start ${label}`, exact: true })
        .click();
      await expect(page.getByRole("alert")).toContainText(
        `Test launch ${agent} in ${dir}`,
      );
      await expect(page.getByRole("dialog")).toBeVisible();
    }
    await page.getByRole("button", { name: "Close launcher" }).click();
    await page.setViewportSize({ width: 800, height: 600 });
    await page
      .getByRole("button", { name: "New session or terminal", exact: true })
      .first()
      .click();
    await page.screenshot({ path: "test-results/preview-launcher-narrow.png" });
    await page.keyboard.press("Escape");
  } finally {
    console.log("UI: stopping test service");
    const client = new Service(path.join(dir, "preview", "service"));
    try {
      await client.connect();
      await client.call("shutdown");
    } finally {
      client.disconnect();
    }
    await closeUI(app);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
