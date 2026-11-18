import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { Service } from "../../main/service.mjs";
import { removeFixture } from "../fixture-cleanup.mjs";
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
async function chooseProject(page: any, folder: string) {
  if (!folder) {
    const clear = page.getByRole("button", {
      name: "All projects",
      exact: true,
    });
    if (await clear.count()) await clear.click();
    return;
  }
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  const group = page.locator(".project-group").filter({
    has: page.locator("summary").filter({ hasText: path.basename(folder) }),
  });
  if (!(await group.evaluate((el: any) => el.open)))
    await group.locator("summary").click();
  await group.getByRole("button", { name: "View all", exact: true }).click();
}
test("workspace navigation, retained search, notes and persistent terminal across full app quit", async () => {
  test.setTimeout(90000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-ui-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  fs.writeFileSync(
    path.join(dir, ".git", "info", "exclude"),
    "preview/\nclaude/\nnote-export.md\nsessions.sqlite*\n",
  );
  fs.writeFileSync(
    path.join(dir, "review-fixture.txt"),
    "Visible Git review content\n",
  );
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
  const claudeDir = path.join(dir, "claude");
  const transcriptDir = path.join(
    claudeDir,
    "projects",
    dir.replace(/[^a-zA-Z0-9]/g, "-"),
  );
  fs.mkdirSync(transcriptDir, { recursive: true });
  fs.writeFileSync(
    path.join(transcriptDir, "11111111-1111-4111-8111-111111111111.jsonl"),
    [
      { type: "user", message: { content: "Help me plan the workspace" } },
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "text",
              text: "Keep session history close to the terminal.",
            },
          ],
        },
      },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n") + "\n",
  );
  const env = {
    ...process.env,
    RUNHUDDLE_PREVIEW_DATA: path.join(dir, "preview"),
    RUNHUDDLE_NATIVE_STORE: dbFile,
    CLAUDE_CONFIG_DIR: claudeDir,
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
      page
        .locator(".sidebar-list")
        .getByRole("button", { name: /Investigate workspace navigation/ }),
    ).toBeVisible();
    await page
      .locator(".sidebar-list")
      .getByRole("button", { name: /Investigate workspace navigation/ })
      .click();
    await expect(
      page.getByRole("heading", { name: "Investigate workspace navigation" }),
    ).toBeVisible();
    await expect(
      page.getByText("Keep session history close to the terminal."),
    ).toBeVisible();
    await page
      .getByRole("searchbox", { name: "Find in conversation" })
      .fill("plan");
    await expect(page.getByText("Help me plan the workspace")).toBeVisible();
    await expect(
      page.getByText("Keep session history close to the terminal."),
    ).toHaveCount(0);
    await page
      .getByRole("searchbox", { name: "Find in conversation" })
      .fill("");
    await page.screenshot({ path: "test-results/preview-history.png" });
    await page.getByRole("button", { name: "Projects", exact: true }).click();
    await page.locator(".project-group summary").first().click();
    await expect(
      page
        .locator(".project-group")
        .getByRole("button", { name: /Investigate workspace navigation/ }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/preview-projects.png" });
    await page.getByRole("button", { name: "Recent", exact: true }).click();
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
    await page
      .getByRole("combobox", { name: "Terminal font family" })
      .selectOption("__custom");
    await page.getByLabel("Custom font family").fill("monospace");
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
      .getByRole("button", { name: "New session or terminal", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Start Codex session", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start Terminal", exact: true }),
    ).toBeVisible();
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
    await page
      .getByRole("combobox", { name: "Session filter" })
      .selectOption("pinned");
    await expect(
      page.getByText("No sessions match these filters."),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Session filter" })
      .selectOption("all");
    await expect(
      page.getByRole("searchbox", { name: "Search sessions and notes" }),
    ).toHaveValue("Investigate");
    await page
      .getByRole("searchbox", { name: "Search sessions and notes" })
      .fill("");
    await page.getByRole("button", { name: "Notes", exact: true }).click();
    await page.getByRole("button", { name: /Workspace decisions/ }).click();
    await expect(
      page.getByText("Keep the terminal service independent of the window."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Copy note", exact: true }).click();
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toContain("Keep the terminal service independent");
    const exportFile = path.join(dir, "note-export.md");
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, exportFile);
    await page
      .getByRole("button", { name: "Export Markdown…", exact: true })
      .click();
    await expect.poll(() => fs.existsSync(exportFile)).toBe(true);
    expect(fs.readFileSync(exportFile, "utf8")).toContain(
      "# Workspace decisions",
    );
    await page.getByRole("button", { name: "Edit note", exact: true }).click();
    await page.getByLabel("Note text").fill("Keep the edited preview note across restarts.");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(page.getByText("Keep the edited preview note across restarts.")).toBeVisible();
    const original = new DatabaseSync(dbFile, { readOnly: true });
    expect(String(original.prepare("SELECT CAST(value AS TEXT) AS value FROM records WHERE key = 'savedWorkLibrary'").get().value))
      .toContain("Keep the terminal service independent of the window.");
    original.close();
    await page.locator(".sidebar-list")
      .getByRole("button", { name: /Investigate workspace navigation/ }).click();
    const message = page.locator(".history-message").filter({ hasText: "Keep session history close" });
    await message.locator(".preserve").evaluate((element) => {
      const range = document.createRange();
      range.setStart(element.firstChild!, 5);
      range.setEnd(element.firstChild!, 20);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    });
    await message.getByRole("button", { name: "Save as note" }).click();
    await expect(page.getByLabel("Note text")).toHaveValue("session history");
    await page.getByLabel("Title").fill("History excerpt");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Investigate workspace navigation" })).toBeVisible();
    await page.getByRole("searchbox", { name: "Search notes", exact: true }).fill("history");
    await page.getByRole("button", { name: /History excerpt/ }).click();
    await expect(page.locator(".note-content")).toHaveText("session history");
    await page.getByRole("button", { name: "View source conversation" }).click();
    await expect(page.getByRole("region", { name: "Conversation history" })).toBeVisible();
    await page.getByRole("searchbox", { name: "Search notes", exact: true }).fill("");
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Project", exact: true })).toHaveValue(dir);
    await page.getByLabel("Title").fill("Project follow-up");
    await page.getByLabel("Note text").fill("A standalone project note.");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Project follow-up" })).toBeVisible();
    await page.getByRole("button", { name: /Workspace decisions/ }).click();
    await page.screenshot({ path: "test-results/preview-notes.png" });
    await closeUI(app);
    app = await electron.launch(launch);
    page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "Workspace decisions", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Workspace decisions/ }),
    ).toHaveClass(/selected/);
    await expect(page.getByText("Keep the edited preview note across restarts.")).toBeVisible();
    const globalSearch = page.getByRole("searchbox", { name: "Search sessions and notes" });
    await globalSearch.fill("standalone project");
    await expect(page.getByRole("region", { name: "Matching notes" })
      .getByRole("button", { name: /Project follow-up/ })).toBeVisible();
    await globalSearch.fill("");

    await chooseProject(page, dir);
    await page
      .getByRole("button", { name: "New session or terminal", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("combobox", { name: "Launch folder" }),
    ).toHaveValue(dir);
    await page.screenshot({ path: "test-results/preview-launcher.png" });
    await page
      .getByRole("button", { name: "Start Terminal", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveCount(1);
    console.log("UI: terminal tab ready");
    await app.evaluate(({ ipcMain }) => {
      let preferred = "";
      const editors = [{ id: "cursor", name: "Cursor", application: "/mock/Cursor.app" }, { id: "code", name: "VS Code", application: "/mock/Code.app" }];
      ipcMain.removeHandler("editors");
      ipcMain.handle("editors", () => ({ editors, preferred }));
      ipcMain.removeHandler("open-editor");
      ipcMain.handle("open-editor", (_event, id, target, line) => {
        preferred = id;
        (globalThis as any).editorOpened = { id, target, line };
      });
    });
    await page.getByLabel("Choose editor", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Cursor", exact: true })).toBeVisible();
    await page.locator(".context-path").click();
    await expect(page.getByRole("button", { name: "Cursor", exact: true })).toBeHidden();
    await page.getByLabel("Choose editor", { exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Cursor", exact: true })).toBeHidden();
    await expect(page.getByLabel("Choose editor", { exact: true })).toBeFocused();
    await page.getByLabel("Choose editor", { exact: true }).click();
    await page.getByRole("button", { name: "Cursor", exact: true }).click();
    await expect(page.getByRole("button", { name: "Open in Cursor", exact: true })).toBeVisible();
    expect(await app.evaluate(() => (globalThis as any).editorOpened.target)).toBe(dir);
    await page.getByRole("button", { name: "Changes", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Changed files" })
      .getByRole("button", { name: /^[?MA] review-fixture.txt/ })
      .click();
    await expect(page.getByLabel("File diff", { exact: true })).toContainText(
      "+Visible Git review content",
    );
    const reviewBox = await page.getByLabel("Diff review", { exact: true }).boundingBox();
    const stageBox = await page.locator("#review-stage").boundingBox();
    expect(reviewBox).toEqual(stageBox);
    await expect(page.locator(".diff-review .added").first()).toContainText("Visible Git review content");
    await expect(page.locator(".diff-review .added .line-number").nth(1)).toHaveText("1");
    await page.getByRole("button", { name: "Select line 1", exact: true }).click();
    await page.getByLabel("Diff review", { exact: true }).getByRole("button", { name: "Open in Cursor", exact: true }).click();
    const openedFile = await app.evaluate(() => (globalThis as any).editorOpened);
    expect({ ...openedFile, target: fs.realpathSync.native(openedFile.target) })
      .toEqual({ id: "cursor", target: fs.realpathSync.native(path.join(dir, "review-fixture.txt")), line: 1 });
    await page.screenshot({ path: "test-results/preview-diff-review.png" });
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Diff review", { exact: true })).toHaveCount(0);
    await expect(page.locator(".focused-pane .xterm-helper-textarea")).toBeFocused();
    await page.getByRole("navigation", { name: "Changed files" })
      .getByRole("button", { name: /^[?MA] review-fixture.txt/ }).click();
    await expect(page.locator(".terminal-host")).toBeVisible();
    fs.writeFileSync(
      path.join(dir, "review-fixture.txt"),
      "Updated Git review content\n",
    );
    await expect(page.getByLabel("File diff", { exact: true })).toContainText(
      "+Updated Git review content",
    );
    const toolDivider = page.getByRole("separator", {
      name: "Resize tools panel",
      exact: true,
    });
    await toolDivider.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(toolDivider).toHaveAttribute("aria-valuenow", "400");
    const dividerBox = await toolDivider.boundingBox();
    await page.mouse.move(
      dividerBox!.x + dividerBox!.width / 2,
      dividerBox!.y + 80,
    );
    await page.mouse.down();
    await page.mouse.move(
      dividerBox!.x + dividerBox!.width / 2 - 30,
      dividerBox!.y + 80,
      { steps: 4 },
    );
    await page.mouse.up();
    await expect(toolDivider).toHaveAttribute("aria-valuenow", "430");
    await toolDivider.dblclick();
    await expect(toolDivider).toHaveAttribute("aria-valuenow", "360");
    await toolDivider.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");

    const beforeToolsRestart = await page.evaluate(async () =>
      (await (window as any).runhuddle.snapshot()).terminals.map(
        (t: any) => t.id,
      ),
    );
    await closeUI(app);
    app = await electron.launch(launch);
    page = await app.firstWindow();
    await expect(
      page.getByRole("button", { name: "Changes", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("separator", { name: "Resize tools panel", exact: true }),
    ).toHaveAttribute("aria-valuenow", "400");
    expect(
      await page.evaluate(async () =>
        (await (window as any).runhuddle.snapshot()).terminals.map(
          (t: any) => t.id,
        ),
      ),
    ).toEqual(beforeToolsRestart);
    await expect(page.getByLabel("Diff review", { exact: true })).toHaveCount(0);
    await page.getByRole("navigation", { name: "Changed files" })
      .getByRole("button", { name: /^[?MA] review-fixture.txt/ }).click();
    await expect(page.getByLabel("File diff", { exact: true })).toContainText(
      "+Updated Git review content",
    );
    execFileSync("git", ["config", "user.name", "UI Test"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], {
      cwd: dir,
    });
    await page.getByRole("textbox", { name: "Commit message", exact: true }).fill("testing");
    await expect(page.getByRole("button", { name: "Commit staged changes", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Commit staged changes", exact: true })).toHaveCSS("cursor", "default");
    await expect(page.getByText("Stage files with + before committing.", { exact: true })).toBeVisible();
    const commitButton = page.getByRole("button", { name: "Commit staged changes", exact: true });
    const pushButton = page.getByRole("button", { name: "Push", exact: true });
    await expect(pushButton).toHaveCSS("cursor", "default");
    const filesBox = await page.getByRole("navigation", { name: "Changed files" }).boundingBox();
    const commitBox = await commitButton.boundingBox();
    const pushBox = await pushButton.boundingBox();
    expect(commitBox!.y).toBeLessThan(filesBox!.y);
    expect(pushBox!.y).toBeGreaterThan(commitBox!.y);
    await page.getByRole("button", { name: "Stage All Changes", exact: true }).click();
    await expect(page.getByRole("button", { name: "Unstage review-fixture.txt", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Unstage All Changes", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stage review-fixture.txt", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Stage All Changes", exact: true }).click();
    await page.getByRole("textbox", { name: "Commit message", exact: true }).fill("Completed UI work");
    await page.getByRole("button", { name: "Commit staged changes", exact: true }).click();
    await expect(page.getByText("Committed staged changes.", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Refresh changes", exact: true })
      .click();
    await expect(
      page.getByText(
        "No uncommitted changes. See Recent commits for completed work.",
      ),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Recent commits", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Commit to review" }),
    ).toContainText("Completed UI work");
    await expect(page.getByLabel("Diff review", { exact: true })).toHaveCount(0);
    await page.getByRole("navigation", { name: "Changed files" })
      .getByRole("button", { name: /^[?MA] review-fixture.txt/ }).click();
    await expect(page.getByLabel("File diff", { exact: true })).toContainText(
      "+Updated Git review content",
    );
    await expect(page.locator(".context-branch")).toContainText("0 changed");
    const tabsBox = await page.locator(".main-tabs").boundingBox();
    const mainBox = await page.locator("main").boundingBox();
    const toolsBox = await page.locator(".workspace-tool").boundingBox();
    expect(tabsBox!.x).toBe(mainBox!.x);
    expect(tabsBox!.width).toBe(mainBox!.width);
    const toolbarBox = await page.locator(".session-toolbar").boundingBox();
    expect(toolbarBox!.x).toBe(mainBox!.x);
    expect(toolbarBox!.width).toBe(mainBox!.width);
    expect(toolsBox!.y).toBeGreaterThanOrEqual(
      toolbarBox!.y + toolbarBox!.height,
    );
    expect(toolsBox!.y).toBeGreaterThanOrEqual(tabsBox!.y + tabsBox!.height);
    const rowBox = await page
      .locator(".live-row .session-row")
      .first()
      .boundingBox();
    expect(rowBox!.height).toBeLessThanOrEqual(36);
    await page.screenshot({ path: "test-results/preview-git-review.png" });
    await page.setViewportSize({ width: 800, height: 600 });
    await expect(
      page.getByRole("button", { name: "Close changes", exact: true }),
    ).toBeInViewport();
    await page.screenshot({ path: "test-results/preview-tools-narrow.png" });
    await page.setViewportSize({ width: 1280, height: 840 });
    await page
      .getByRole("button", { name: "Close changes", exact: true })
      .click();
    await expect(
      page.getByRole("complementary", { name: "Workspace changes" }),
    ).toHaveCount(0);

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
    await expect(page.locator(".live-row strong")).toHaveAttribute(
      "title",
      /Tab closed/,
    );
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
    await expect(page.locator(".live-row strong")).toHaveAttribute(
      "title",
      /Pane 1/,
    );

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
    const focusedBeforeQuit = await page.locator(".focused-pane").getAttribute("aria-label");
    await expect(page.getByRole("tablist")).toHaveCount(3);
    await expect(page.getByRole("tab")).toHaveCount(3);
    await page.screenshot({ path: "test-results/preview-split.png" });
    await closeUI(app);
    app = await electron.launch(launch);
    page = await app.firstWindow();
    await expect(page.getByRole("tablist")).toHaveCount(3);
    await expect(page.locator(".focused-pane")).toHaveAttribute("aria-label", focusedBeforeQuit!);
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
    await chooseProject(page, "");
    await page.locator(".live-row").first().locator(".session-row").click();
    await page.getByRole("tab").nth(1).click();
    await chooseProject(page, dir);
    await expect(page.getByRole("tab").nth(1)).toHaveAttribute(
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
      page.getByRole("combobox", { name: "Launch folder" }),
    ).toHaveValue(dir);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Recent", exact: true }).click();
    await page
      .locator(".sidebar-list")
      .getByRole("button", { name: /Investigate workspace navigation/ })
      .click();
    await page.screenshot({ path: "test-results/preview-session.png" });
    // A shell-backed fixture exercises AI view lifecycle without launching an agent.
    await app.evaluate(
      ({ ipcMain }, { id, cwd }) => {
        ipcMain.removeHandler("usage");
        ipcMain.handle("usage", () => ({
          provider: "codex", checkedAt: new Date().toISOString(),
          windows: [{ label: "Weekly", remaining: 9, resetsAt: new Date(Date.now() + 86400000).toISOString() }]
        }));
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
    if (
      !(await page
        .locator(".document-more")
        .evaluate((el) => el.hasAttribute("open")))
    )
      await page.locator(".document-more summary").click();
    await page
      .getByRole("button", { name: "New session in this folder" })
      .click();
    await page
      .getByRole("button", { name: "Start Codex session", exact: true })
      .click();
    const warning = page.getByLabel("Agent usage warning", { exact: true });
    await expect(warning).toContainText("9% remaining");
    await warning.getByRole("button", { name: "Continue with another agent…" }).click();
    await expect(page.getByRole("dialog", { name: "Review agent handoff" })).toBeVisible();
    await expect(page.getByLabel("Handoff context")).toContainText("Recent conversation excerpts");
    await expect(page.getByLabel("Handoff agent")).toHaveValue("claude");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await warning.getByRole("button", { name: "Later", exact: true }).click();
    await expect(warning).toHaveCount(0);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("write");
      ipcMain.handle("write", (_event, id, data) => { (globalThis as any).handoffPaste = { id, data }; });
    });
    await page.getByLabel("Agent usage", { exact: true }).click();
    await page.locator(".usage-menu").getByRole("button", { name: "Continue with another agent…" }).click();
    await page.getByLabel("Handoff context").fill("Reviewed handoff: inspect files before continuing.");
    await page.getByRole("button", { name: "Create session with reviewed handoff", exact: true }).click();
    await expect(page.getByRole("button", { name: "Show new session", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Show new session", exact: true }).click();
    await expect(page.getByLabel("Handoff ready", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Paste handoff", exact: true }).click();
    expect(await app.evaluate(() => (globalThis as any).handoffPaste.data))
      .toBe("\x1b[200~Reviewed handoff: inspect files before continuing.\x1b[201~");
    await expect(page.getByLabel("Handoff ready", { exact: true })).toHaveCount(0);
    const liveRow = page.getByRole("region", { name: "Open now", exact: true }).locator(".live-row");
    await expect(liveRow).toHaveCount(1);
    await expect(
      page
        .getByRole("region", { name: "Open now", exact: true })
        .locator(".live-row"),
    ).toHaveCount(1);
    await expect(
      page.getByRole("region", { name: "Open now", exact: true }),
    ).toContainText("Open now");
    await page
      .locator(".terminal-tab")
      .getByRole("button", { name: /^Close / })
      .click();
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(liveRow.locator("strong")).toHaveAttribute(
      "title",
      /Tab closed/,
    );
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
    // The live terminal and newly recorded history can arrive in either order.
    await app.evaluate(({ BrowserWindow }, { id, cwd }) => {
      const ui = BrowserWindow.getAllWindows()[0].webContents;
      const sessionID = "33333333-3333-4333-8333-333333333333";
      ui.send("event", { event: "terminals", terminals: [
        { id, cwd, agent: "codex", sessionID, title: "Fixture agent", exited: false },
      ] });
      ui.send("event", { event: "store", sessions: [
        { provider: "Codex", sessionID, cwd, project: "Fixture", title: "Review fixtures",
          preview: "", state: "needsInput", updated: Date.now() / 1000, terminalId: id },
      ] });
    }, { id: terminalId, cwd: dir });
    const linked = page.locator(".sidebar-list").getByRole("button", { name: /Review fixtures/ });
    await expect(linked).toHaveCount(1);
    await expect(linked).toContainText("Needs input");
    await expect(liveRow).toHaveCount(0);
    await linked.click();
    await expect(linked).toHaveClass(/selected/);
    await expect(page.getByRole("tab")).toHaveCount(1);
    await app.evaluate(async ({ BrowserWindow }) => {
      const ui = BrowserWindow.getAllWindows()[0].webContents;
      const snapshot = await ui.executeJavaScript("window.runhuddle.snapshot()");
      ui.send("event", { ...snapshot, event: "store" });
    });
    await page
      .locator(".sidebar-list")
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
      .locator(".sidebar-list")
      .getByRole("button", { name: /Investigate workspace navigation/ })
      .click();
    // Archive/restore imports locally, preserving one exact-ID record.
    if (
      !(await page
        .locator(".document-more")
        .evaluate((el) => el.hasAttribute("open")))
    )
      await page.locator(".document-more summary").click();
    await page
      .getByRole("button", { name: "Archive in RunHuddle", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Session filter" })
      .selectOption("archived");
    await expect(
      page
        .locator(".sidebar-list")
        .getByRole("button", { name: /Investigate workspace navigation/ }),
    ).toHaveCount(1);
    await page
      .getByRole("button", { name: "Restore from archive", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Session filter" })
      .selectOption("all");
    await expect(
      page
        .locator(".sidebar-list")
        .getByRole("button", { name: /Investigate workspace navigation/ }),
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
    if (
      !(await page
        .locator(".document-more")
        .evaluate((el) => el.hasAttribute("open")))
    )
      await page.locator(".document-more summary").click();
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
    removeFixture(dir);
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
    await expect(page.getByRole("tablist")).toHaveCount(2);
    await expect(page.getByRole("tablist", { name: "Pane 2 tabs" }).getByRole("tab"))
      .not.toContainText("Unavailable");
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
    removeFixture(dir);
  }
});

test("companion shell persists without becoming a tab or following project filters", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-companion-ui-"));
  const other = path.join(dir, "other");
  fs.mkdirSync(other);
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
  const client = new Service(path.join(dir, "preview", "service-v2"));
  try {
    let page = await app.firstWindow();
    await page.evaluate(
      async ({ dir, other }) => {
        await (window as any).runhuddle.create(dir, "shell");
        await (window as any).runhuddle.create(other, "shell");
      },
      { dir, other },
    );
    await page.locator(".live-row .session-row").first().click();
    await expect(page.locator(".workspace-header")).toHaveCount(0);
    await page.getByRole("button", { name: "Shell", exact: true }).click();
    await expect(
      page
        .getByRole("region", { name: "Companion shell" })
        .locator(".terminal-host"),
    ).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(page.locator(".live-row")).toHaveCount(2);
    const id = await page.evaluate(
      () =>
        Object.values(
          JSON.parse(localStorage.getItem("companionShells")!),
        )[0] as string,
    );
    await page.evaluate(async (id) => {
      await (window as any).runhuddle.write(id, "printf 'COMPANION_OK\\n'\r");
    }, id);
    await page.getByRole("button", { name: "Hide shell", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Companion shell" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Shell", exact: true }).click();
    expect(
      await page.evaluate(
        () =>
          Object.values(
            JSON.parse(localStorage.getItem("companionShells")!),
          )[0],
      ),
    ).toBe(id);
    await chooseProject(page, other);
    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(
      page.getByRole("region", { name: "Companion shell" }),
    ).toBeVisible();
    await expect(page.locator(".live-row")).toHaveCount(1);
    const resize = page.getByRole("separator", { name: "Resize panes" });
    await resize.focus();
    await resize.press("ArrowUp");
    await expect(resize).toHaveAttribute("aria-valuenow", "60");
    await page.screenshot({ path: "test-results/preview-companion-shell.png" });
    await closeUI(app);
    app = await electron.launch(launch);
    page = await app.firstWindow();
    await expect(
      page.getByRole("region", { name: "Companion shell" }),
    ).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(
      page.getByRole("separator", { name: "Resize panes" }),
    ).toHaveAttribute("aria-valuenow", "60");
    await expect
      .poll(() =>
        page.evaluate(
          async (id) => (await (window as any).runhuddle.replay(id)).data,
          id,
        ),
      )
      .toContain("COMPANION_OK");
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    });
    await page.getByRole("button", { name: "End shell", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Companion shell" }),
    ).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveCount(2);
  } finally {
    await closeUI(app);
    if (await client.connectExisting()) await client.call("shutdown");
    client.disconnect();
    removeFixture(dir);
  }
});

test("new screenshots offer a thumbnail, copy, dismiss, and attachment without submission", async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rh-screenshot-ui-")));
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAD0lEQVR4nGNgWPAfiuAsAFteCbtERib8AAAAAElFTkSuQmCC",
    "base64",
  );
  const capture = (name: string, tagged = true) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, image);
    if (tagged && process.platform === "darwin") execFileSync("/usr/bin/xattr", [
      "-w", "com.apple.metadata:kMDItemIsScreenCapture", "1", file,
    ]);
    return file;
  };
  capture("Screenshot old.png");
  const env = {
    ...process.env,
    RUNHUDDLE_PREVIEW_DATA: path.join(dir, "preview"),
    RUNHUDDLE_NATIVE_STORE: path.join(dir, "absent.sqlite"),
    RUNHUDDLE_SCREENSHOT_DIRECTORY: dir,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: process.env.RUNHUDDLE_TEST_EXECUTABLE ? [] : [path.resolve(".")],
    env,
    executablePath: process.env.RUNHUDDLE_TEST_EXECUTABLE,
  });
  const client = new Service(path.join(dir, "preview", "service-v2"));
  try {
    const page = await app.firstWindow();
    const popup = page.getByRole("complementary", { name: "Screenshot taken" });
    const shell = await page.evaluate((cwd) => window.runhuddle.create(cwd, "shell"), dir);
    await app.evaluate(({ clipboard }) => {
      clipboard.writeText = (value) => { (globalThis as any).copiedScreenshot = value; };
    });
    capture("Ordinary image.png", false);
    const first = capture(process.platform === "darwin" ? "Localized capture.png" : "Screenshot 1.png");
    await expect(popup).toBeVisible();
    await expect(popup).toContainText(path.basename(first));
    await expect.poll(() => popup.getByRole("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await expect(popup.getByRole("button", { name: "Attach to current session" })).toBeDisabled();
    await popup.getByRole("button", { name: "Copy path" }).click();
    await expect(popup.getByRole("button", { name: "Path copied" })).toBeVisible();
    expect(await app.evaluate(() => (globalThis as any).copiedScreenshot)).toBe(first);
    await popup.getByRole("button", { name: "Dismiss" }).click();
    await expect(popup).toHaveCount(0);

    // Present the real PTY as an AI session without sending a prompt to a paid CLI.
    await app.evaluate(({ BrowserWindow, ipcMain }, terminal) => {
      ipcMain.removeHandler("write");
      ipcMain.handle("write", (_event, id, data) => {
        ((globalThis as any).screenshotWrites ??= []).push({ id, data });
      });
      BrowserWindow.getAllWindows()[0].webContents.send("event", {
        event: "terminals",
        terminals: [{ ...terminal, agent: "claude", title: "Attachment fixture" }],
      });
    }, shell);
    await page.locator(".live-row").getByRole("button", { name: /New Claude session/ }).click();
    await expect(page.locator(".xterm-helper-textarea")).toBeAttached();
    const second = capture("Screenshot Rick's capture.png");
    await expect(popup).toContainText(path.basename(second));
    await popup.getByRole("button", { name: "Attach to current session" }).click();
    await expect(popup).toHaveCount(0);
    const writes = await app.evaluate(() => (globalThis as any).screenshotWrites || []);
    const attachmentWrites = writes.filter((write: { data: string }) => write.data.includes("Screenshot Rick"));
    expect(attachmentWrites).toHaveLength(1);
    const [result] = attachmentWrites;
    expect(writes.every((write: { data: string }) => !/[\r\n]/.test(write.data))).toBe(true);
    expect(result.id).toBe(shell.id);
    expect(result.data.replace(/^\x1b\[200~/, "").replace(/\x1b\[201~$/, ""))
      .toBe(process.platform === "win32" ? '"' + second + '" ' : "'" + second.replaceAll("'", "'\\''") + "' ");
    expect(result.data).not.toMatch(/[\r\n]/);
    await expect(page.locator(".xterm-helper-textarea")).toBeFocused();
  } finally {
    await closeUI(app);
    if (await client.connectExisting()) {
      await client.call("shutdown").catch(() => {});
      client.disconnect();
    }
    removeFixture(dir);
  }
});
