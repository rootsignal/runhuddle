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
          sessionID: "11111111-1111-4111-8111-111111111111",
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
    await page
      .getByRole("button", { name: "Terminal appearance…", exact: true })
      .click();
    await expect
      .poll(() =>
        page
          .getByRole("combobox", { name: "Terminal theme" })
          .locator("option")
          .count(),
      )
      .toBeGreaterThan(500);
    await page
      .getByRole("searchbox", { name: "Search terminal themes" })
      .fill("Dracula");
    await page
      .getByRole("combobox", { name: "Terminal theme" })
      .selectOption("Dracula");
    await expect(
      page.getByLabel("Background hex", { exact: true }),
    ).toHaveValue("#282a36");
    await page
      .getByRole("searchbox", { name: "Search terminal themes" })
      .fill("");
    await expect
      .poll(() =>
        page
          .getByRole("combobox", { name: "Terminal font family" })
          .locator("option")
          .count(),
      )
      .toBeGreaterThan(2);
    await page
      .getByRole("combobox", { name: "Terminal font family" })
      .selectOption({ index: 1 });
    await page
      .getByRole("combobox", { name: "Terminal theme" })
      .selectOption("Light");
    await page
      .getByRole("spinbutton", { name: "Terminal font size" })
      .fill("16");
    await page
      .getByRole("spinbutton", { name: "Terminal line spacing" })
      .fill("1.15");
    await page
      .getByRole("combobox", { name: "Terminal cursor style" })
      .selectOption("bar");
    await expect
      .poll(() =>
        page.evaluate(() => document.fonts.check('14px "RunHuddle Symbols"')),
      )
      .toBe(true);
    for (const style of ["block", "underline", "bar"]) {
      await page
        .getByRole("combobox", { name: "Terminal cursor style" })
        .selectOption(style);
      await expect(
        page.locator(`.appearance-preview .xterm-cursor-${style}`),
      ).toHaveCount(1);
    }
    await expect(page.locator(".appearance-preview .xterm-cursor")).toHaveCSS(
      "animation-name",
      "preview-cursor-blink",
    );
    await page.getByRole("checkbox", { name: "Blink cursor" }).uncheck();
    await expect(page.locator(".appearance-preview .xterm-cursor")).toHaveCSS(
      "animation-name",
      "none",
    );
    await page.getByRole("checkbox", { name: "Blink cursor" }).check();

    await page
      .getByRole("dialog", { name: "Terminal appearance", exact: true })
      .evaluate((el) => {
        el.scrollTop = 0;
      });
    await page.screenshot({
      path: "test-results/preview-realistic-terminal.png",
    });
    await page
      .getByText("Customize colors · text, background and ANSI palette")
      .click();
    await page
      .getByRole("textbox", { name: "Blue hex", exact: true })
      .fill("#123abc");
    await expect(
      page.getByRole("combobox", { name: "Terminal theme" }),
    ).toHaveValue("Custom");
    await page.screenshot({ path: "test-results/preview-appearance.png" });
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page
      .getByRole("button", { name: "New AI session", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Start Codex session", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start Terminal", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Close launcher" }).click();
    await page
      .getByRole("button", { name: "New terminal", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Start Terminal", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start Codex session", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Close launcher" }).click();
    await page
      .getByRole("searchbox", { name: "Search sessions and notes" })
      .fill("Investigate");
    await page.getByRole("button", { name: "Pinned", exact: true }).click();
    await expect(
      page.getByText("No sessions match these filters."),
    ).toBeVisible();
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.getByRole("searchbox")).toHaveValue("Investigate");
    await page
      .getByRole("searchbox", { name: "Search sessions and notes" })
      .fill("");
    await page.getByRole("button", { name: "Notes", exact: true }).click();
    await page.getByRole("button", { name: /Workspace decisions/ }).click();
    await expect(
      page.getByText("Keep the terminal service independent of the window."),
    ).toBeVisible();
    await closeUI(app);
    app = await electron.launch(launch);
    page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "Workspace decisions", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Workspace decisions/ }),
    ).toHaveClass(/selected/);

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
    await page
      .locator(".terminal-tab")
      .getByRole("button", { name: /^Close / })
      .click();
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(page.locator(".live-row")).toContainText("Tab closed");
    expect(
      await page.evaluate(
        async (id) =>
          (await (window as any).runhuddle.snapshot()).terminals.some(
            (t: any) => t.id === id,
          ),
        terminalId,
      ),
    ).toBe(true);
    await page.locator(".live-row").locator(".session-row").click();
    await expect(page.getByRole("tab")).toHaveCount(1);
    await expect(page.locator(".live-row")).toContainText("Pane 1");

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
    await page
      .getByRole("button", { name: "Arrange pane 1", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Move tab right", exact: true })
      .click();
    await expect(page.getByRole("tablist")).toHaveCount(2);
    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(page.locator(".terminal-host")).toHaveCount(2);
    const splitter = page.getByRole("separator", { name: "Resize panes" });
    await expect(splitter).toHaveAttribute("aria-orientation", "vertical");
    await splitter.focus();
    await page.keyboard.press("ArrowRight");
    await expect(splitter).toHaveAttribute("aria-valuenow", "55");
    await page
      .getByRole("tablist", { name: "Pane 2 tabs" })
      .getByRole("tab")
      .click();
    await page
      .getByRole("button", { name: "New session or terminal", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Start Terminal", exact: true })
      .click();
    await expect(
      page.getByRole("tablist", { name: "Pane 2 tabs" }).getByRole("tab"),
    ).toHaveCount(2);
    await page
      .getByRole("tablist", { name: "Pane 2 tabs" })
      .getByRole("tab")
      .first()
      .click();
    await expect(page.getByRole("tablist")).toHaveCount(2);
    await expect(page.locator(".terminal-host")).toHaveCount(2);
    await page
      .getByRole("button", { name: "Arrange pane 2", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Move tab down", exact: true })
      .click();
    await expect(page.getByRole("tablist")).toHaveCount(3);
    await expect(page.getByRole("separator")).toHaveCount(2);
    const horizontal = page.locator(
      '[role="separator"][aria-orientation="horizontal"]',
    );
    await horizontal.focus();
    await page.keyboard.press("ArrowDown");
    await expect(horizontal).toHaveAttribute("aria-valuenow", "55");
    // Sidebar focuses an existing pane without making duplicate tabs or collapsing layout.
    await page.locator(".live-row").first().locator(".session-row").click();
    await expect(page.getByRole("tablist")).toHaveCount(3);
    await expect(page.getByRole("tab")).toHaveCount(3);
    await page.screenshot({ path: "test-results/preview-split.png" });
    await closeUI(app);
    app = await electron.launch(launch);
    page = await app.firstWindow();
    await expect(page.getByRole("tablist")).toHaveCount(3);
    await expect(
      page.locator('[role="separator"][aria-orientation="horizontal"]'),
    ).toHaveAttribute("aria-valuenow", "55");
    await page
      .getByRole("tablist", { name: "Pane 3 tabs" })
      .locator(".terminal-tab")
      .dragTo(page.getByRole("tablist", { name: "Pane 1 tabs" }));
    await expect(page.getByRole("tablist")).toHaveCount(2);
    await expect(
      page.getByRole("tablist", { name: "Pane 1 tabs" }).getByRole("tab"),
    ).toHaveCount(2);
    await page
      .getByRole("button", { name: "Arrange pane 1", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Combine all tabs into one pane",
        exact: true,
      })
      .click();
    await expect(page.getByRole("tablist")).toHaveCount(1);
    await expect(page.getByRole("tab")).toHaveCount(3);
    // Put the original shell first again before the close/reopen checks.
    await page
      .locator(".terminal-tab")
      .filter({ hasText: path.basename(dir) + " · 1" })
      .dragTo(page.locator(".terminal-tab").first());
    // Drag a tab to the highlighted right edge, then move it back with the menu.
    const dragBox = await page.locator(".terminal-tab").last().boundingBox();
    await page.mouse.move(dragBox!.x + 40, dragBox!.y + 15);
    await page.mouse.down();
    await page.mouse.move(dragBox!.x + 40, dragBox!.y + 100, { steps: 5 });
    await expect(page.locator(".drop-right")).toBeVisible();
    const zone = await page.locator(".drop-right").boundingBox();
    await page.mouse.move(
      zone!.x + zone!.width / 2,
      zone!.y + zone!.height / 2,
      { steps: 5 },
    );
    await page.mouse.up();
    await expect(page.getByRole("tablist")).toHaveCount(2);
    await expect(page.getByRole("tab")).toHaveCount(3);
    await page
      .getByRole("button", { name: "Arrange pane 2", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Move to pane 1", exact: true })
      .click();
    await expect(page.getByRole("tablist")).toHaveCount(1);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    });
    await page
      .locator(".terminal-tab")
      .getByRole("button", { name: /^Close / })
      .last()
      .click();
    await expect(page.getByRole("tab")).toHaveCount(2);
    await page.getByRole("tab").first().click();
    await page
      .getByRole("combobox", { name: "Workspace", exact: true })
      .selectOption("");
    await page.locator(".live-row").first().locator(".session-row").click();
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
      .getByRole("button", { name: "Arrange pane 1", exact: true })
      .click();
    await page
      .locator(".pane-actions")
      .getByRole("button", { name: "Close terminal", exact: true })
      .click();
    await expect(page.getByRole("tab")).toHaveCount(2);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    });
    await page
      .getByRole("button", { name: "Arrange pane 1", exact: true })
      .click();
    await page
      .locator(".pane-actions")
      .getByRole("button", { name: "Close terminal", exact: true })
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
    await page
      .getByRole("button", { name: "Terminal appearance…", exact: true })
      .click();
    await expect(
      page.getByRole("spinbutton", { name: "Terminal font size" }),
    ).toHaveValue("16");
    await expect(
      page.getByRole("combobox", { name: "Terminal theme" }),
    ).toHaveValue("Custom");
    await page
      .getByRole("button", { name: "Restore defaults", exact: true })
      .click();
    await expect(
      page.getByRole("spinbutton", { name: "Terminal font size" }),
    ).toHaveValue("14");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    expect(
      await page.evaluate(
        async (id) =>
          (await (window as any).runhuddle.snapshot()).terminals.some(
            (t: any) => t.id === id && !t.unavailable && !t.exited,
          ),
        terminalId,
      ),
    ).toBe(true);
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
    // A shell-backed fixture exercises AI view lifecycle without launching an agent.
    await app.evaluate(
      ({ ipcMain }, { id, cwd }) => {
        ipcMain.removeHandler("create");
        ipcMain.handle("create", () => ({
          id,
          cwd,
          agent: "codex",
          title: "Fixture agent",
          exited: false,
        }));
      },
      { id: terminalId, cwd: dir },
    );
    await page
      .getByRole("button", { name: "New session in this folder" })
      .click();
    await page
      .getByRole("button", { name: "Start Codex session", exact: true })
      .click();
    const liveRow = page.locator(".live-row").filter({ hasText: "Codex" });
    await expect(liveRow).toHaveCount(1);
    await page
      .locator(".terminal-tab")
      .getByRole("button", { name: /^Close / })
      .click();
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(liveRow).toContainText("Tab closed");
    expect(
      await page.evaluate(
        async (id) =>
          (await (window as any).runhuddle.snapshot()).terminals.some(
            (t: any) => t.id === id,
          ),
        terminalId,
      ),
    ).toBe(true);
    await liveRow.locator(".session-row").click();
    await expect(page.getByRole("tab")).toHaveCount(1);
    await expect(liveRow.locator(".session-row")).toHaveClass(/selected/);
    await expect(
      page.getByRole("button", { name: "End session", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /Investigate workspace navigation/ })
      .click();
    // Exited agent panes expose recovery with the exact provider conversation ID.
    await app.evaluate(
      ({ ipcMain }, { id, cwd }) => {
        ipcMain.removeHandler("create");
        ipcMain.handle("create", (_e, _cwd, agent) => ({
          id,
          cwd,
          agent,
          title: "Exited agent",
          exited: true,
          exitCode: 1,
          sessionID: "22222222-2222-4222-8222-222222222222",
        }));
        ipcMain.removeHandler("resume");
        ipcMain.handle("resume", (_e, provider, id) => {
          throw Error(`Recovery requested ${provider}:${id}`);
        });
      },
      { id: terminalId, cwd: dir },
    );
    for (const provider of ["Claude", "Codex", "Copilot"]) {
      await page
        .getByRole("button", { name: "New session or terminal", exact: true })
        .first()
        .click();
      await page
        .getByRole("button", { name: `Start ${provider} session`, exact: true })
        .click();
      await expect(
        page.getByText("Exited with code 1", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Resume session", exact: true })
        .click();
      await expect(page.getByRole("alert")).toContainText(
        `Recovery requested ${provider}:22222222-2222-4222-8222-222222222222`,
      );
      await page.getByRole("button", { name: "Dismiss error" }).click();
    }
    await page
      .getByRole("button", { name: /Investigate workspace navigation/ })
      .click();
    // Archive/restore imports locally, preserving one exact-ID record.
    await page
      .getByRole("button", { name: "Archive in RunHuddle", exact: true })
      .click();
    await page.getByRole("button", { name: "Archived", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /Investigate workspace navigation/ }),
    ).toHaveCount(1);
    await page
      .getByRole("button", { name: "Restore from archive", exact: true })
      .click();
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /Investigate workspace navigation/ }),
    ).toHaveCount(1);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("resume");
      ipcMain.handle("resume", (_e, provider, id) => {
        throw Error(`Resume requested ${provider}:${id}`);
      });
    });
    await page
      .getByRole("button", { name: "Resume session", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Resume requested Claude:11111111-1111-4111-8111-111111111111",
    );
    await page.getByRole("button", { name: "Dismiss error" }).click();
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
    await closeUI(app);
    console.log("UI: stopping test service");
    const client = new Service(path.join(dir, "preview", "service-v2"));
    try {
      await client.connect();
      await client.call("shutdown");
    } finally {
      client.disconnect();
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("helper crash preserves panes and recovers without restarting the app", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-recovery-ui-"));
  const env = {
    ...process.env,
    RUNHUDDLE_PREVIEW_DATA: path.join(dir, "preview"),
    RUNHUDDLE_NATIVE_STORE: path.join(dir, "absent.sqlite"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = {
    args: process.env.RUNHUDDLE_TEST_EXECUTABLE ? [] : [path.resolve(".")],
    env,
    executablePath: process.env.RUNHUDDLE_TEST_EXECUTABLE,
  };
  let app = await electron.launch(launch);
  let client = new Service(path.join(dir, "preview", "service-v2"));
  try {
    let page = await app.firstWindow();
    await page.evaluate(async (cwd) => {
      const api = (window as any).runhuddle;
      await api.create(cwd, "shell");
      await api.create(cwd, "shell");
    }, dir);
    await page.locator(".live-row").first().locator(".session-row").click();
    await page.getByRole("tab").nth(1).click();
    await page
      .getByRole("button", { name: "Arrange pane 1", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Move tab right", exact: true })
      .click();
    await expect(page.getByRole("tablist")).toHaveCount(2);
    const layout = await page.evaluate(() =>
      localStorage.getItem("pane-layout:"),
    );
    await client.connect();
    const hello = client.hello;
    // Kill only the isolated test helper, never a user's process.
    process.kill(hello.pid, "SIGKILL");
    client.disconnect();
    await expect(
      page.getByRole("heading", { name: "Terminal unavailable", exact: true }),
    ).toHaveCount(2);
    await expect(page.getByRole("tablist")).toHaveCount(2);
    expect(
      await page.evaluate(() => localStorage.getItem("pane-layout:")),
    ).toBe(layout);
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await (window as any).runhuddle.snapshot()).connection,
        ),
      )
      .toBe("connected");
    // Unavailable panes and selection also survive an app restart.
    await closeUI(app);
    app = await electron.launch(launch);
    page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "Terminal unavailable", exact: true }),
    ).toHaveCount(2);
    await expect(page.locator(".live-row .selected")).toHaveCount(1);
    await page
      .getByRole("button", { name: "Open new terminal here", exact: true })
      .last()
      .click();
    await expect(page.locator(".terminal-host")).toHaveCount(1);
    await expect(
      page.getByRole("heading", { name: "Terminal unavailable", exact: true }),
    ).toHaveCount(1);
    const data = await page.evaluate(
      async () => (await (window as any).runhuddle.snapshot()).terminals,
    );
    expect(data.filter((t: any) => !t.unavailable && !t.exited)).toHaveLength(
      1,
    );
    await page
      .getByRole("button", { name: "Remove unavailable tab", exact: true })
      .click();
    await expect(page.getByRole("tablist")).toHaveCount(1);
    await expect(page.getByRole("tab")).toHaveCount(1);
  } finally {
    await closeUI(app);
    client = new Service(path.join(dir, "preview", "service-v2"));
    if (await client.connectExisting()) await client.call("shutdown");
    client.disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
