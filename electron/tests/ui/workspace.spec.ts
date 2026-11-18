import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { Service } from "../../main/service.mjs";
import { address as serviceAddress, frames, send, PROTOCOL } from "../../main/protocol.mjs";
import { removeFixture } from "../fixture-cleanup.mjs";
import { notesStore } from "../../main/notes.mjs";
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
async function workspacePage(app: Awaited<ReturnType<typeof electron.launch>>) {
  const page = await app.firstWindow();
  await expect(page.locator(".app")).toBeVisible();
  if (await page.locator("dialog.getting-started").count())
    await page.getByRole("dialog", { name: "Getting started" }).getByRole("button", { name: "Skip guide" }).click();
  return page;
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
    await group.locator(":scope > summary").click();
  await group.getByRole("button", { name: "Focus project", exact: true }).click();
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
  const data = path.join(dir, "preview");
  fs.mkdirSync(path.join(data, "service-v2"), { recursive: true });
  fs.writeFileSync(path.join(data, "service-v2", "sessions.json"), JSON.stringify([{
    provider: "Claude", sessionID: "11111111-1111-4111-8111-111111111111",
    title: "Investigate workspace navigation", cwd: dir, project: "Fixture project",
    preview: "A saved conversation", state: "archived", updated: Date.now() / 1000,
  }]));
  const notesFile = path.join(data, "notes", "notes.sqlite");
  notesStore(notesFile).save({
    title: "Workspace decisions", text: "Keep the terminal service independent of the window.", project: dir,
  });
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
    RUNHUDDLE_DATA: path.join(dir, "preview"),
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
    const guide = page.getByRole("dialog", { name: "Getting started" });
    await expect(guide.getByRole("heading", { name: "Start a session" })).toBeVisible();
    async function checkSpotlight(anchor: string) {
      const target = page.locator(`[data-tour-anchor="${anchor}"]:visible`);
      await expect(target).toBeVisible();
      const bounds = (await target.boundingBox())!;
      const ring = (await guide.locator(".tour-highlight").boundingBox())!;
      const tip = (await guide.locator(".tour-card").boundingBox())!;
      expect(ring).toEqual({
        x: bounds.x - 4,
        y: bounds.y - 4,
        width: bounds.width + 8,
        height: bounds.height + 8,
      });
      expect(tip.x >= ring.x + ring.width || tip.x + tip.width <= ring.x ||
        tip.y >= ring.y + ring.height || tip.y + tip.height <= ring.y).toBe(true);
      // The highlighted control remains inert while the tour is open.
      await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await expect(guide).toBeVisible();
    }
    await checkSpotlight("launch");
    for (const [title, anchor] of [
      ["Browse by project", "projects"],
      ["Focus a project", "projects"],
      ["Find a conversation", "search"],
      ["Organize open tabs", "launch"],
      ["Hand off to another agent", "launch"],
      ["Adjust terminal appearance", "appearance"],
      ["Review Git changes", "changes"],
      ["Save project notes", "notes"],
      ["Catch up in Inbox", "inbox"],
      ["Preview and share a page", "browser"],
    ]) {
      await guide.getByRole("button", { name: "Next" }).click();
      await expect(guide.getByRole("heading", { name: title })).toBeVisible();
      await checkSpotlight(anchor);
      if (title === "Hand off to another agent") {
        await expect(guide).toContainText("Claude usage");
        await expect(guide).toContainText("Continue with another agent… anytime");
      }
    }
    await guide.getByRole("button", { name: "Done" }).click();
    await expect(guide).toHaveCount(0);
    async function showUpdateDownload(download: { version: string; percent: number | null } | null) {
      await app.evaluate(({ BrowserWindow }, state) => {
        BrowserWindow.getAllWindows()[0].webContents.send("event", { event: "update-download", download: state });
      }, download);
    }
    await showUpdateDownload({ version: "0.99.0", percent: null });
    const download = page.getByRole("region", { name: "Update download" });
    await expect(download).toContainText("Downloading RunHuddle 0.99.0");
    await expect(download.locator("progress[value]")).toHaveCount(0);
    await showUpdateDownload({ version: "0.99.0", percent: 42 });
    await expect(download.getByRole("progressbar")).toHaveAttribute("value", "42");
    await expect(download).toContainText("42%");
    await showUpdateDownload(null);
    await expect(download).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Browser preview" })).toHaveCount(0);
    expect(await page.evaluate(async () => ({
      terminalCount: (await window.runhuddle.snapshot()).terminals.length,
      browserURL: (await window.runhuddle.browserState()).url,
    }))).toEqual({ terminalCount: 0, browserURL: "" });
    await page.locator('[data-tour-anchor="sidebar"]').click();
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById("getting-started");
      if (!item) throw Error("Missing Help menu item.");
      item.click(item, BrowserWindow.getAllWindows()[0], {} as any);
    });
    await expect(guide.getByRole("heading", { name: "Start a session" })).toBeVisible();
    await guide.getByRole("button", { name: "Next" }).click();
    await expect(guide).toContainText("Open the sidebar and choose Projects");
    await checkSpotlight("sidebar");
    await guide.getByRole("button", { name: "Next" }).click();
    await expect(guide.getByRole("heading", { name: "Focus a project" })).toBeVisible();
    await guide.getByRole("button", { name: "Next" }).click();
    await expect(guide).toContainText("Open the sidebar to search sessions and notes across all projects.");
    await checkSpotlight("sidebar");
    await guide.getByRole("button", { name: "Back" }).click();
    await guide.getByRole("button", { name: "Back" }).click();
    await guide.getByRole("button", { name: "Back" }).click();
    await expect(guide.getByRole("heading", { name: "Start a session" })).toBeVisible();
    await guide.getByRole("button", { name: "Skip guide" }).click();
    await expect(page.locator('[data-tour-anchor="search"]')).toHaveCount(0);
    await page.locator('[data-tour-anchor="sidebar"]').click();
    async function chooseAppMenu(id: string) {
      await app.evaluate(({ Menu, BrowserWindow }, menuId) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById(menuId);
        if (!item) throw Error("Missing app menu item " + menuId);
        item.click(item, BrowserWindow.getAllWindows()[0], {} as any);
      }, id);
    }
    await chooseAppMenu("app-theme-light");
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor))
      .toBe("rgb(243, 245, 247)");
    await chooseAppMenu("app-accent-Violet");
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--app-accent-base")))
      .toBe("#b6a0ed");
    await chooseAppMenu("custom-app-accent");
    const customAccent = page.getByRole("dialog", { name: "Custom accent color" });
    await customAccent.getByLabel("Accent color").fill("#147abc");
    await customAccent.getByRole("button", { name: "Apply color" }).click();
    await expect(customAccent).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--app-accent-base")))
      .toBe("#147abc");
    await chooseAppMenu("app-theme-dark");
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor))
      .toBe("rgb(24, 24, 27)");
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
    const recap = page.getByRole("region", { name: "Where we left off" });
    await expect(recap.getByText("Help me plan the workspace")).toBeVisible();
    await expect(recap.getByText("Keep session history close to the terminal.")).toBeVisible();
    const conversation = page.getByRole("region", { name: "Conversation history" });
    await expect(conversation.getByText("Keep session history close to the terminal.")).toBeVisible();
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      ipcMain.removeHandler("generate-recap");
      ipcMain.handle("generate-recap", (_event, provider, id, agent) => {
        if (agent !== "copilot") throw Error("Choose another agent.");
        const recap = {
          agent: "Copilot", model: "GPT-6 Luna", done: "Reviewed session navigation.", pending: "",
          next: "Open the companion shell.", generatedAt: Date.now(), sourceUpdated: Date.now() / 1000,
        };
        BrowserWindow.getAllWindows()[0].webContents.send("event", {
          event: "recap", key: provider + ":" + id, recap,
        });
        return recap;
      });
    });
    const recapAgent = recap.getByRole("combobox", { name: "Recap agent" });
    await expect(recapAgent).toHaveCount(0);
    await recap.getByRole("button", { name: "Generate recap…" }).click();
    await expect(recapAgent).toHaveValue("claude");
    await expect(recapAgent.getByRole("option", { name: "Copilot · GPT-6 Luna" })).toHaveCount(1);
    await recapAgent.selectOption("copilot");
    await recap.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(recap.getByText("Open the companion shell.", { exact: true })).toBeVisible();
    await expect(recap.getByText("Copilot · GPT-6 Luna", { exact: true })).toBeVisible();
    await expect(recapAgent).toHaveCount(0);
    await expect(page.locator(".sidebar-list").getByRole("button", { name: /Investigate workspace navigation/ }))
      .toContainText("Next · Open the companion shell.");
    await recap.getByRole("button", { name: "Refresh recap…" }).click();
    await expect(recapAgent).toHaveValue("copilot");
    await recapAgent.selectOption("claude");
    await recap.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(recap.getByRole("alert")).toContainText("Choose another agent.");
    await expect(recap.getByText("Open the companion shell.", { exact: true })).toBeVisible();
    await recap.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("searchbox", { name: "Find in conversation" })
      .fill("plan");
    await expect(conversation.getByText("Help me plan the workspace")).toBeVisible();
    await expect(
      conversation.getByText("Keep session history close to the terminal."),
    ).toHaveCount(0);
    await page
      .getByRole("searchbox", { name: "Find in conversation" })
      .fill("");
    const crossSessionSearch = page.getByRole("searchbox", { name: "Search sessions and notes" });
    await crossSessionSearch.fill("history close");
    const historyMatches = page.getByRole("region", { name: "Conversation matches" });
    await historyMatches.getByRole("button", { name: /Keep session history close/ }).click();
    const originalMessage = page.getByRole("article", { name: "Matching message" });
    await expect(originalMessage).toContainText("Keep session history close to the terminal.");
    await expect(originalMessage).toBeFocused();
    await expect(crossSessionSearch).toHaveValue("history close");
    await page.getByRole("button", { name: "Latest messages" }).click();
    await expect(originalMessage).toHaveCount(0);
    await crossSessionSearch.fill("");
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
    await expect(
      page.getByRole("button", { name: "New terminal", exact: true }),
    ).toHaveCount(0);
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
    expect(notesStore(notesFile).list()[0].text).toBe("Keep the edited preview note across restarts.");
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
    page = await workspacePage(app);
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
    await page.locator(".project-scope-name").click();
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
    page = await workspacePage(app);
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
    page = await workspacePage(app);
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
    const focusedProjectTab = await page.getByRole("tab", { selected: true }).getAttribute("title");
    await chooseProject(page, "");
    await page.locator(".live-row").first().locator(".session-row").click();
    await page.getByRole("tab").nth(1).click();
    await chooseProject(page, dir);
    await expect(page.getByRole("tab", { selected: true })).toHaveAttribute("title", focusedProjectTab!);
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
    await page.evaluate(() => localStorage.setItem("workspaceTool", "mcp"));
    console.log("UI: quitting app with live terminal");
    await closeUI(app);
    console.log("UI: app quit, relaunching");
    app = await electron.launch(launch);
    page = await workspacePage(app);
    await expect(page.getByRole("tab")).toHaveCount(1);
    console.log("UI: terminal tab ready");
    await expect(page.getByRole("dialog", { name: "Getting started" })).toHaveCount(0);
    await expect(page.getByRole("separator", { name: "Resize tools panel" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Workspace tools" }).getByRole("button")).toHaveCount(4);
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
        const resetsAt = new Date(Date.now() + 86400000).toISOString();
        ipcMain.removeHandler("usage");
        ipcMain.handle("usage", () => ({
          provider: "codex", checkedAt: new Date().toISOString(),
          windows: [{ label: "Weekly", remaining: 9, resetsAt }]
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
    const liveRow = page.getByRole("region", { name: "Open in RunHuddle", exact: true }).locator(".live-row");
    await expect(liveRow).toHaveCount(1);
    await expect(
      page
        .getByRole("region", { name: "Open in RunHuddle", exact: true })
        .locator(".live-row"),
    ).toHaveCount(1);
    await expect(
      page.getByRole("region", { name: "Open in RunHuddle", exact: true }),
    ).toContainText("Open in RunHuddle");
    async function codexOutput(sequence: number, data: string) {
      await app.evaluate(({ BrowserWindow }, output) => {
        BrowserWindow.getAllWindows()[0].webContents.send("event", { event: "output", ...output });
      }, { id: terminalId, data, sequence });
    }
    await codexOutput(1000001, "\x1b[2J\x1b[999;1HThis conversation is open in another app.\r\nClose it there and press R to continue here.\r\nr retry  f fork  ←/esc command center");
    await expect(liveRow.getByText("In use elsewhere", { exact: true })).toBeVisible();
    await liveRow.locator(".session-row").click({ button: "right" });
    await expect(liveRow.getByRole("button", { name: "Find where it’s open" })).toBeVisible();
    await expect(liveRow.getByRole("button", { name: "End session", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await codexOutput(1000002, "\x1b[2J\x1b[999;1HAsk Codex to do anything");
    await expect(liveRow.getByText("In use elsewhere", { exact: true })).toHaveCount(0);
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
    async function setLinkedState(state: string) {
      await app.evaluate(({ BrowserWindow }, { id, cwd, state }) => {
        const ui = BrowserWindow.getAllWindows()[0].webContents;
        const sessionID = "33333333-3333-4333-8333-333333333333";
        ui.send("event", { event: "terminals", terminals: [
          { id, cwd, agent: "codex", sessionID, title: "Fixture agent", exited: false },
        ] });
        ui.send("event", { event: "store", sessions: [
          { provider: "Codex", sessionID, cwd, project: "Fixture", title: "Review fixtures",
            preview: "", state, updated: Date.now() / 1000, terminalId: id },
        ] });
      }, { id: terminalId, cwd: dir, state });
    }
    const linked = page.locator(".sidebar-list").getByRole("button", { name: /Review fixtures/ }).and(page.locator(".session-row"));
    const markers = new Set<string>();
    for (const [state, label] of [["working", "Working"], ["idle", "Idle"],
      ["disconnected", "Activity unavailable"], ["needsInput", "Needs input"]]) {
      await setLinkedState(state);
      const marker = linked.getByRole("img", { name: label, exact: true });
      await expect(marker).toHaveAttribute("title", label);
      markers.add(await marker.innerHTML());
    }
    expect(markers.size).toBe(4);
    await expect(linked).toHaveCount(1);
    await expect(linked).toContainText("Needs input");
    await expect(liveRow).toHaveCount(0);
    await linked.click({ button: "right" });
    await expect(linked.locator("..").getByRole("button", { name: "End session", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await linked.click();
    await expect(linked).toHaveClass(/selected/);
    await expect(page.getByRole("tab")).toHaveCount(1);
    await page.locator(".terminal-tab").getByRole("button", { name: /^Close / }).click();
    await expect(page.getByRole("tab")).toHaveCount(0);
    const alertTarget = { provider: "Codex", sessionID: "33333333-3333-4333-8333-333333333333" };
    await app.evaluate(({ BrowserWindow }, target) => {
      BrowserWindow.getAllWindows()[0].webContents.send("event", {
        event: "session-alert", key: target.provider + ":" + target.sessionID,
        alert: { ...target, title: "Codex needs input", body: "Review fixtures" },
      });
    }, alertTarget);
    await page.getByLabel("Session notification").getByRole("button", { name: "Open session" }).click();
    await expect(page.getByRole("tab")).toHaveCount(1);
    await expect(linked).toHaveClass(/selected/);
    await page.locator(".terminal-tab").getByRole("button", { name: /^Close / }).click();
    await expect(page.getByRole("tab")).toHaveCount(0);
    await app.evaluate(({ BrowserWindow }, target) => {
      BrowserWindow.getAllWindows()[0].webContents.send("event", { event: "open-alert-session", target });
    }, alertTarget);
    await expect(page.getByRole("tab")).toHaveCount(1);
    await expect(linked).toHaveClass(/selected/);
    await expect(page.locator(".focused-pane")).toHaveAttribute("aria-label", "Review fixtures pane");
    await app.evaluate(({ BrowserWindow }, target) => {
      BrowserWindow.getAllWindows()[0].webContents.send("event", {
        event: "recap", key: target.provider + ":" + target.sessionID,
        recap: {
          agent: "Copilot", done: "Reviewed navigation.", pending: "",
          next: "Review the workspace fixture.", generatedAt: Date.now(), sourceUpdated: 0,
        },
      });
    }, alertTarget);
    await page.getByLabel("Agent usage", { exact: true }).click();
    await page.locator(".usage-menu").getByRole("button", { name: "Continue with another agent…" }).click();
    await expect(page.getByLabel("Handoff context")).toHaveValue(/Next: Review the workspace fixture\./);
    await page.getByRole("dialog", { name: "Review agent handoff" }).getByRole("button", { name: "Cancel", exact: true }).click();
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
        .locator(".terminal-exit")
        .getByRole("button", { name: "Restart session", exact: true })
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
    // Keep pinning available for the conversation recovered from the old ledger.
    if (
      !(await page
        .locator(".document-more")
        .evaluate((el) => el.hasAttribute("open")))
    )
      await page.locator(".document-more summary").click();
    await page
      .getByRole("button", { name: "Pin session", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Session filter" })
      .selectOption("pinned");
    await expect(
      page
        .locator(".sidebar-list")
        .getByRole("button", { name: /Investigate workspace navigation/ }),
    ).toHaveCount(1);
    await page
      .getByRole("button", { name: "Unpin session", exact: true })
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
    RUNHUDDLE_DATA: path.join(dir, "preview"),
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
    let page = await workspacePage(app);
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
    page = await workspacePage(app);
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

test("Browser can reopen a saved conversation after replacing its idle older terminal service", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-browser-upgrade-"));
  const directory = path.join(dir, "service-v2");
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "service.token"), "fixture-token");
  const sessionID = "22222222-2222-4222-8222-222222222222";
  const oldTerminal = { id: "11111111-1111-4111-8111-111111111111", cwd: dir, sessionID,
    agent: "claude", title: "Older Claude session", exited: false };
  const saved = { provider: "Claude", sessionID, terminalId: oldTerminal.id, title: oldTerminal.title,
    cwd: dir, project: "Fixture", state: "idle", updated: 1, preview: "" };
  let rows = [oldTerminal];
  let stopped = false;
  let socket: net.Socket | undefined;
  const older = net.createServer((peer) => {
    socket = peer;
    frames(peer, (message) => {
      let result: unknown = null;
      if (message.method === "hello") result = { protocol: PROTOCOL, pid: process.pid };
      if (message.method === "list") result = rows;
      if (message.method === "sessions") result = [saved];
      if (message.method === "replay") result = { data: "", sequence: 0 };
      send(peer, { request: message.request, result });
      if (message.method === "close" && message.id === oldTerminal.id) {
        rows = [];
        send(peer, { event: "terminals", terminals: rows });
      }
      if (message.method === "shutdown") {
        stopped = true;
        peer.end();
        older.close();
      }
    });
  });
  older.listen(serviceAddress(directory));
  await once(older, "listening");
  const site = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<title>Reopen fixture</title><h1>Reopen fixture</h1>");
  });
  site.listen(0, "127.0.0.1");
  await once(site, "listening");
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, process.platform === "win32" ? "claude.cmd" : "claude"),
    process.platform === "win32" ? "@echo off\r\npause > nul\r\n" : "#!/bin/sh\nexec cat\n", { mode: 0o700 });
  const env = { ...process.env, RUNHUDDLE_DATA: dir,
    CLAUDE_CONFIG_DIR: path.join(dir, "claude"), ZDOTDIR: dir };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
  Object.assign(env, { [pathKey]: bin + path.delimiter + (process.env[pathKey] || "") });
  delete env.ELECTRON_RUN_AS_NODE;
  const service = new Service(directory);
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({
      args: process.env.RUNHUDDLE_TEST_EXECUTABLE ? [] : [path.resolve(".")],
      executablePath: process.env.RUNHUDDLE_TEST_EXECUTABLE, env,
    });
    const page = await workspacePage(app);
    const row = page.locator(".session-row").filter({ hasText: "Older Claude session" });
    await expect(row).toBeVisible();
    expect(stopped).toBe(false);
    await row.click();
    await page.getByRole("button", { name: "Browser", exact: true }).click();
    const address = page.getByRole("textbox", { name: "Browser address" });
    await address.fill("http://127.0.0.1:" + (site.address() as { port: number }).port);
    await address.press("Enter");
    const reopen = page.getByRole("button", { name: "Reopen with browser control" });
    await expect(reopen).toBeVisible();
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    await reopen.click();
    await expect.poll(() => stopped).toBe(true);
    await expect.poll(async () => {
      if (!(await service.connectExisting())) return false;
      try {
        return service.hello.browserTools === true;
      } finally { service.disconnect(); }
    }).toBe(true);
    await expect(page.getByRole("button", { name: "Allow agent control" })).toBeEnabled();
    const terminals = await page.evaluate(async () => (await window.runhuddle.snapshot()).terminals);
    const reopened = terminals.find((terminal) => terminal.browserTools && !terminal.exited);
    expect(reopened?.sessionID).toBe(sessionID);
    expect(reopened?.id).not.toBe(oldTerminal.id);
  } finally {
    if (app) await closeUI(app);
    if (older.listening) {
      socket?.destroy();
      older.close();
    } else if (await service.connectExisting()) {
      await service.call("shutdown").catch(() => {});
      service.disconnect();
    }
    site.closeAllConnections();
    await new Promise<void>((resolve) => site.close(() => resolve()));
    removeFixture(dir);
  }
});

test("project focus keeps its own tabs and layout while other terminals stay open", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-project-layout-"));
  const first = path.join(dir, "first-project"), second = path.join(dir, "second-project");
  fs.mkdirSync(first);
  fs.mkdirSync(second);
  execFileSync("git", ["init", "-q"], { cwd: second });
  fs.writeFileSync(path.join(second, "project.txt"), "fixture\n");
  const data = path.join(dir, "profile");
  const helper = path.join(data, "service-v2");
  fs.mkdirSync(helper, { recursive: true });
  fs.writeFileSync(path.join(helper, "sessions.json"), JSON.stringify([{
    provider: "Claude", sessionID: "12345678-1234-4234-8234-123456781234",
    title: "Second project conversation", cwd: second, project: "Second project",
    preview: "", state: "saved", updated: Date.now() / 1000,
  }]));
  const env = { ...process.env, RUNHUDDLE_DATA: data };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = {
    args: process.env.RUNHUDDLE_TEST_EXECUTABLE ? [] : [path.resolve(".")],
    executablePath: process.env.RUNHUDDLE_TEST_EXECUTABLE, env,
  };
  let app = await electron.launch(launch);
  const client = new Service(helper);
  try {
    let page = await workspacePage(app);
    await page.evaluate(async (folders) => {
      for (const folder of folders) await window.runhuddle.create(folder, "shell");
    }, [first, first, second]);
    const secondTab = () => page.getByRole("tab", { name: "second-project", exact: true });
    const arrange = () => page.getByRole("button", { name: "Arrange pane 1", exact: true });
    const split = () => page.getByRole("separator", { name: "Resize panes" });
    const all = () => page.getByRole("button", { name: "All projects", exact: true });
    const projectScope = () => page.locator('.project-scope');
    await page.locator(".live-row .session-row").getByText("second-project", { exact: true }).click();
    await expect(page.getByRole("tab")).toHaveCount(3);
    await arrange().click();
    await page.getByRole("button", { name: "Move tab right", exact: true }).click();
    await expect(split()).toHaveAttribute("aria-orientation", "vertical");

    await chooseProject(page, first);
    await expect(projectScope()).toContainText("first-project");
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById("getting-started");
      if (!item) throw Error("Missing Help menu item.");
      item.click(item, BrowserWindow.getAllWindows()[0], {} as any);
    });
    const guide = page.getByRole("dialog", { name: "Getting started" });
    await guide.getByRole("button", { name: "Next" }).click();
    await guide.getByRole("button", { name: "Next" }).click();
    await expect(guide.getByRole("heading", { name: "Focus a project" })).toBeVisible();
    await expect(guide).toContainText("Click All projects beside it");
    const scopeBounds = (await projectScope().boundingBox())!;
    await expect.poll(async () => (await guide.locator(".tour-highlight").boundingBox())?.x)
      .toBe(scopeBounds.x - 4);
    await guide.getByRole("button", { name: "Skip guide" }).click();
    await projectScope().getByText("first-project", { exact: true }).click();
    await expect(all()).toBeVisible();
    await expect(secondTab()).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveCount(2);
    await arrange().click();
    await page.getByRole("button", { name: "Move tab down", exact: true }).click();
    await expect(split()).toHaveAttribute("aria-orientation", "horizontal");
    const search = page.getByRole("searchbox", { name: "Search sessions and notes" });
    const result = page.locator(".sidebar-list .session-row").getByText("Second project conversation", { exact: true });
    const sessionFilter = page.getByRole("combobox", { name: "Session filter" });
    const focusedLabel = projectScope().getByText("Focused project", { exact: true });
    await expect(focusedLabel).toBeVisible();
    await expect(sessionFilter.locator("option:checked")).toHaveText("Project sessions");
    await expect(result).toHaveCount(0);
    await search.fill("Second project");
    await expect(page.getByText("Searching all projects", { exact: true })).toBeVisible();
    await expect(focusedLabel).toBeVisible();
    await expect(sessionFilter.locator("option:checked")).toHaveText("All sessions");
    await expect(result).toBeVisible();
    await expect(secondTab()).toHaveCount(0);
    await search.clear();
    await expect(result).toHaveCount(0);
    await expect(projectScope()).toContainText("first-project");
    await search.fill("Second project");
    await result.click();
    await expect(projectScope()).toContainText("second-project");
    await expect(page.getByRole("heading", { name: "Second project conversation", exact: true })).toBeVisible();
    await search.clear();
    await chooseProject(page, "");
    await expect(secondTab()).toHaveAttribute("aria-selected", "true");
    await expect(split()).toHaveAttribute("aria-orientation", "vertical");

    await page.getByRole("button", { name: "Projects", exact: true }).click();
    const secondGroup = page.locator(".project-group").filter({ has: page.locator("summary", { hasText: "second-project" }) });
    await secondGroup.locator(":scope > summary").click({ button: "right" });
    await page.getByRole("button", { name: "Project overview", exact: true }).click();
    const overview = page.getByRole("dialog", { name: "second-project", exact: true });
    await expect(overview).toContainText(second);
    await expect(overview).toContainText("Running terminals");
    await expect(overview).toContainText("1 changed");
    await expect(overview.getByRole("button", { name: "Second project conversation", exact: false })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(overview).toHaveCount(0);
    await secondGroup.locator(":scope > summary").click();
    await secondGroup.getByRole("button", { name: /Second project conversation/ }).click();
    await expect(projectScope()).toContainText("second-project");
    await expect(page.getByRole("heading", { name: "Second project conversation", exact: true })).toBeVisible();
    await expect(page.locator(".live-row .session-row")).toHaveCount(1);

    await chooseProject(page, first);
    await expect(split()).toHaveAttribute("aria-orientation", "horizontal");
    await closeUI(app);
    app = await electron.launch(launch);
    page = await workspacePage(app);
    await expect(projectScope()).toContainText("first-project");
    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(split()).toHaveAttribute("aria-orientation", "horizontal");
    await chooseProject(page, "");
    await expect(page.getByRole("tab")).toHaveCount(3);
    await expect(split()).toHaveAttribute("aria-orientation", "vertical");
  } finally {
    await closeUI(app);
    if (await client.connectExisting()) await client.call("shutdown");
    client.disconnect();
    removeFixture(dir);
  }
});

test("companion shell follows its session through project focus and app restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-companion-ui-"));
  const other = path.join(dir, "other");
  fs.mkdirSync(other);
  const env = {
    ...process.env,
    RUNHUDDLE_DATA: path.join(dir, "preview"),
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
    let page = await workspacePage(app);
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
    await expect(page.getByRole("tab")).toHaveCount(1);
    await expect(page.getByRole("tab", { name: "other", exact: true })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Companion shell" }),
    ).toHaveCount(0);
    await expect(page.locator(".live-row")).toHaveCount(1);
    await chooseProject(page, "");
    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(page.getByRole("region", { name: "Companion shell" })).toBeVisible();
    const resize = page.getByRole("separator", { name: "Resize panes" });
    await resize.focus();
    await resize.press("ArrowUp");
    await expect(resize).toHaveAttribute("aria-valuenow", "60");
    await page.screenshot({ path: "test-results/preview-companion-shell.png" });
    await closeUI(app);
    app = await electron.launch(launch);
    page = await workspacePage(app);
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
    RUNHUDDLE_DATA: path.join(dir, "preview"),
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
    const page = await workspacePage(app);
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

test("browser preview shares reports and grants the active agent revocable live control", async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rh-browser-ui-")));
  let pendingImage: import("node:http").ServerResponse | undefined;
  const fixture = createServer((request, response) => {
    if (request.url === "/pending-image") {
      response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
      response.flushHeaders();
      pendingImage = response;
      return;
    }
    const next = request.url === "/next";
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><title>${next ? "Next page" : "Browser fixture"}</title>
      <h1>${next ? "Next page" : "Page evidence fixture"}</h1>
      <a href="/next">Next</a><a id="outside" href="http://localhost:${request.socket.localPort}/next">Other origin</a><input aria-label="Name"><button onclick="document.querySelector('h1').textContent='Button clicked'">Try me</button><script>console.warn("Fixture page warning")</script>
      ${next ? "" : '<img src="/pending-image" width="1" height="1" alt="">'}`);
  });
  fixture.listen(0, "127.0.0.1");
  await once(fixture, "listening");
  const address = `127.0.0.1:${(fixture.address() as { port: number }).port}`;
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, process.platform === "win32" ? "claude.cmd" : "claude"),
    process.platform === "win32" ? "@echo off\r\npause > nul\r\n" : "#!/bin/sh\nexec cat\n", { mode: 0o700 });
  const env = {
    ...process.env,
    RUNHUDDLE_DATA: path.join(dir, "preview"),
    CLAUDE_CONFIG_DIR: path.join(dir, "claude"),
    ZDOTDIR: dir,
  };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
  Object.assign(env, { [pathKey]: bin + path.delimiter + (process.env[pathKey] || "") });
  delete env.ELECTRON_RUN_AS_NODE;
  const client = new Service(path.join(dir, "preview", "service-v2"));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let reportFolder: string | undefined;
  try {
    app = await electron.launch({
      args: process.env.RUNHUDDLE_TEST_EXECUTABLE ? [] : [path.resolve(".")],
      env,
      executablePath: process.env.RUNHUDDLE_TEST_EXECUTABLE,
    });
    const page = await workspacePage(app);
    const tool = page.getByRole("button", { name: "Browser", exact: true });
    await tool.click();
    const panel = page.getByRole("region", { name: "Browser preview" });
    const url = panel.getByRole("textbox", { name: "Browser address" });
    const attach = panel.getByRole("button", { name: /^Share page/ });
    await url.fill("file:///private");
    await url.press("Enter");
    await expect(panel.getByRole("alert")).toContainText("Enter an HTTPS address or a local address");
    await url.fill(address);
    await url.press("Enter");
    await expect(url).toHaveValue("http://" + address + "/");
    await expect.poll(() => app!.evaluate(({ webContents }) =>
      webContents.getAllWebContents().some((item) => item.getTitle() === "Browser fixture"))).toBe(true);
    await expect(attach).toBeDisabled();

    const browserChild = () => app!.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const guest = window.contentView.children.find((child: any) => child.webContents !== window.webContents) as any;
      return { visible: guest?.getVisible(), url: guest?.webContents.getURL(), width: guest?.getBounds().width };
    });
    await expect.poll(async () => (await browserChild()).width).toBeGreaterThan(250);
    await url.fill(`http://${address}/next`);
    await url.press("Enter");
    await expect.poll(async () => (await browserChild()).url).toMatch(/\/next$/);
    await panel.getByRole("button", { name: "Go back" }).click();
    await expect(url).toHaveValue("http://" + address + "/");

    await page.getByRole("button", { name: "Terminal appearance…" }).click();
    await expect.poll(async () => (await browserChild()).visible).toBe(false);
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await browserChild()).visible).toBe(true);
    await tool.click();
    await expect.poll(async () => (await browserChild()).visible).toBe(false);
    await tool.click();
    await expect(url).toHaveValue("http://" + address + "/");

    const shell = await page.evaluate((cwd) => window.runhuddle.create(cwd, "claude"), dir);
    expect(shell.browserTools).toBe(true);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("write");
      ipcMain.handle("write", (_event, id, data) => {
        ((globalThis as any).browserReportWrites ??= []).push({ id, data });
      });
    });
    await page.getByRole("button", { name: /Claude session/ }).and(page.locator(".session-row")).click();
    await expect(page.locator(".xterm-helper-textarea")).toBeAttached();
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById("getting-started");
      if (!item) throw Error("Missing Help menu item.");
      item.click(item, BrowserWindow.getAllWindows()[0], {} as any);
    });
    const guide = page.getByRole("dialog", { name: "Getting started" });
    await expect(guide).toBeVisible();
    await expect.poll(async () => (await browserChild()).visible).toBe(false);
    for (const title of ["Browse by project", "Focus a project", "Find a conversation", "Organize open tabs"]) {
      await guide.getByRole("button", { name: "Next" }).click();
      await expect(guide.getByRole("heading", { name: title })).toBeVisible();
    }
    await expect(guide).toContainText("With two or more tabs in a pane");
    const arrange = (await page.locator('[data-tour-anchor="arrange"]').boundingBox())!;
    await expect.poll(async () => (await guide.locator(".tour-highlight").boundingBox())?.x)
      .toBe(arrange.x - 4);
    await guide.getByRole("button", { name: "Next" }).click();
    await expect(guide.getByRole("heading", { name: "Hand off to another agent" })).toBeVisible();
    await expect(guide).toContainText("Start new session with context");
    const usage = page.getByLabel("Agent usage", { exact: true });
    await expect(usage).toContainText("Claude usage");
    const usageBounds = (await usage.boundingBox())!;
    await expect.poll(() => guide.locator(".tour-highlight").boundingBox()).toEqual({
      x: usageBounds.x - 4,
      y: usageBounds.y - 4,
      width: usageBounds.width + 8,
      height: usageBounds.height + 8,
    });
    await guide.getByRole("button", { name: "Skip guide" }).click();
    await expect(page.locator(".xterm-helper-textarea")).toBeAttached();
    await expect.poll(async () => (await browserChild()).visible).toBe(true);
    await expect(url).toHaveValue("http://" + address + "/");

    await app.evaluate(async ({ webContents }) => {
      const guest = webContents.getAllWebContents().find((item) => item.getTitle() === "Browser fixture");
      if (!guest) throw Error("Expected a browser guest.");
      await guest.mainFrame.executeJavaScript("window.getSelection().selectAllChildren(document.querySelector('h1'))");
    });
    await expect.poll(() => pendingImage && !pendingImage.destroyed && !pendingImage.writableEnded).toBe(true);
    await expect(panel.getByText("Loading page…")).toHaveCount(0);
    await expect(attach).toBeEnabled();
    await expect(attach).toHaveAccessibleName(/^Share page with /);
    await expect(panel.getByText(/Adds a screenshot, page text, and console errors to your draft/)).toBeVisible();
    await attach.click();
    await expect(panel.getByRole("status")).toContainText("Press Enter in the terminal to send");
    const writes = await app.evaluate(() => (globalThis as any).browserReportWrites || []);
    const [write] = writes.filter((entry: { data: string }) => entry.data.includes("RunHuddle-browser-"));
    expect(write.id).toBe(shell.id);
    expect(write.data).not.toMatch(/[\r\n]/);
    const file = /["']([^"']*RunHuddle-browser-[^"']*report\.md)["']/.exec(write.data)?.[1];
    expect(file).toBeTruthy();
    reportFolder = path.dirname(file!);
    const report = fs.readFileSync(file!, "utf8");
    expect(report).toContain("## Selected page text\nPage evidence fixture");
    expect(report).toContain("## Visible page text\n  Page evidence fixture");
    expect(report).toContain("Fixture page warning");
    expect(report).toContain("http://" + address + "/");
    expect(fs.readFileSync(path.join(reportFolder, "page.png")).subarray(1, 4).toString()).toBe("PNG");
    const agentRoot = path.join(dir, "preview", "service-v2", "browser-agents");
    const agentConfig = path.join(agentRoot, fs.readdirSync(agentRoot)[0], "mcp.json");
    const { command, args: adapterArgs, env: adapterEnv } =
      JSON.parse(fs.readFileSync(agentConfig, "utf8")).mcpServers.runhuddle_browser;
    function browserTool(name: string, args = {}) {
      const call = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } };
      const answer = execFileSync(command, adapterArgs, {
        encoding: "utf8", input: JSON.stringify(call) + "\n", env: { ...process.env, ...adapterEnv },
        timeout: 12000, maxBuffer: 3 * 1024 * 1024,
      });
      return JSON.parse(answer).result;
    }
    expect(browserTool("inspect_page").isError).toBe(true);
    await panel.getByRole("button", { name: "Allow agent control" }).click();
    await expect(panel.getByRole("button", { name: "Stop agent control" })).toBeVisible();
    expect(JSON.parse(browserTool("inspect_page").content[0].text)).toMatchObject({
      title: "Browser fixture", visibleText: expect.stringContaining("Page evidence fixture"),
      console: expect.arrayContaining([expect.stringContaining("Fixture page warning")]),
    });
    expect(browserTool("screenshot").content[0]).toMatchObject({ type: "image", mimeType: "image/jpeg" });
    const point = (selector: string) => app!.evaluate(async ({ webContents }, selector) => {
      const guest = webContents.getAllWebContents().find((item) => item.getTitle() === "Browser fixture");
      return guest!.mainFrame.executeJavaScript(`(() => {
        const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return { x: Math.floor(r.x + r.width / 2), y: Math.floor(r.y + r.height / 2) };
      })()`);
    }, selector);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused())).toBe(true);
    expect(browserTool("type_text", { ...await point("input"), text: "Sample" })).toMatchObject({
      content: [{ text: "Entered text in the shared page." }],
    });
    await expect.poll(() => app!.evaluate(({ webContents }) => webContents.getAllWebContents()
      .find((item) => item.getTitle() === "Browser fixture")!
      .mainFrame.executeJavaScript("document.querySelector('input').value"))).toBe("Sample");
    expect(browserTool("click", await point("button"))).toMatchObject({
      content: [{ text: "Clicked the shared page." }],
    });
    await expect.poll(() => browserTool("inspect_page").content[0].text).toContain("Button clicked");
    await panel.getByRole("button", { name: "Stop agent control" }).click();
    expect(browserTool("inspect_page").isError).toBe(true);
    await panel.getByRole("button", { name: "Allow agent control" }).click();
    await expect(panel.getByRole("button", { name: "Stop agent control" })).toBeVisible();
    expect(browserTool("click", await point("#outside"))).toMatchObject({
      content: [{ text: "Clicked the shared page." }],
    });
    await expect(panel.getByRole("alert")).toContainText("Navigation outside the shared local app was blocked");
    expect(browserTool("inspect_page").isError).toBe(true);
    await expect.poll(async () => (await browserChild()).url).toBe("http://" + address + "/");
  } finally {
    if (app) await closeUI(app);
    if (await client.connectExisting()) {
      await client.call("shutdown").catch(() => {});
      client.disconnect();
    }
    fixture.closeAllConnections();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
    if (reportFolder) removeFixture(reportFolder);
    removeFixture(dir);
  }
});

test("Inbox keeps unread completions across restart and opens the exact recorded session", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-inbox-ui-"));
  const data = path.join(dir, "preview");
  fs.mkdirSync(data);
  const sessionID = "55555555-5555-4555-8555-555555555555";
  const rows = ["Claude", "Codex"].map((provider) => ({
    provider, sessionID, title: provider + " fixture", cwd: dir,
    project: "Shared project", state: "saved", preview: "", updated: 1,
  }));
  fs.mkdirSync(path.join(data, "service-v2"), { recursive: true });
  fs.writeFileSync(path.join(data, "service-v2", "sessions.json"), JSON.stringify(rows));
  fs.writeFileSync(path.join(data, "inbox.json"), JSON.stringify(rows.map((row) => ({
    id: row.provider, kind: "completion", provider: row.provider, sessionID,
    body: row.title, createdAt: 1,
  }))));
  const env = {
    ...process.env,
    RUNHUDDLE_DATA: data,
    RUNHUDDLE_SCREENSHOT_DIRECTORY: dir,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = {
    args: process.env.RUNHUDDLE_TEST_EXECUTABLE ? [] : [path.resolve(".")],
    env,
    executablePath: process.env.RUNHUDDLE_TEST_EXECUTABLE,
  };
  let app = await electron.launch(launch);
  try {
    let page = await workspacePage(app);
    const toggle = () => page.getByRole("button", { name: "Inbox", exact: true });
    await expect(toggle()).toHaveAttribute("aria-description", "2 alerts");
    await toggle().click();
    await expect(page.getByRole("region", { name: "Ready for review" })).toBeVisible();
    await closeUI(app);
    app = await electron.launch(launch);
    page = await workspacePage(app);
    const panel = page.getByRole("region", { name: "Session Inbox" });
    await expect(toggle()).toHaveAttribute("aria-description", "2 alerts");
    await panel.getByRole("button", { name: "Open Claude fixture (Claude)" }).click();
    await expect(page.getByRole("heading", { name: "Claude fixture" })).toBeVisible();
    await expect(toggle()).toHaveAttribute("aria-description", "1 alert");
    await panel.getByRole("button", { name: "Dismiss Codex fixture" }).click();
    await expect(panel.getByText("You’re all caught up.")).toBeVisible();
    expect(JSON.parse(fs.readFileSync(path.join(data, "inbox.json"), "utf8"))).toEqual([]);
  } finally {
    await closeUI(app);
    const client = new Service(path.join(data, "service-v2"));
    if (await client.connectExisting()) await client.call("shutdown");
    client.disconnect();
    removeFixture(dir);
  }
});

test("a fresh profile discovers existing local provider sessions", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-provider-history-"));
  const env = {
    ...process.env, RUNHUDDLE_DATA: path.join(dir, "app"),
    CODEX_HOME: path.join(dir, "codex"), CLAUDE_CONFIG_DIR: path.join(dir, "claude"),
    COPILOT_HOME: path.join(dir, "copilot"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const codexID = "11111111-1111-4111-8111-111111111111";
  const claudeID = "22222222-2222-4222-8222-222222222222";
  const copilotID = "33333333-3333-4333-8333-333333333333";
  const claudeProject = path.join(env.CLAUDE_CONFIG_DIR, "projects", dir.replace(/[^a-zA-Z0-9]/g, "-"));
  const copilotSession = path.join(env.COPILOT_HOME, "session-state", copilotID);
  for (const folder of [env.RUNHUDDLE_DATA, env.CODEX_HOME, claudeProject, copilotSession])
    fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(env.RUNHUDDLE_DATA, "provider-history-archive.json"),
    JSON.stringify({ ["Claude:" + claudeID]: true }));
  const writeEvents = (file: string, rows: unknown[]) =>
    fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  const codexTranscript = path.join(env.CODEX_HOME, "rollout.jsonl");
  writeEvents(codexTranscript, [
    { type: "event_msg", payload: { type: "user_message", message: "Read the package manifest." } },
  ]);
  const db = new DatabaseSync(path.join(env.CODEX_HOME, "state_5.sqlite"));
  db.exec("CREATE TABLE threads (id TEXT, cwd TEXT, title TEXT, updated_at INTEGER, rollout_path TEXT, archived INTEGER)");
  db.prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?, 1)").run(
    codexID, dir, "Codex release history", Math.floor(Date.now() / 1000), codexTranscript,
  );
  db.close();
  writeEvents(path.join(claudeProject, claudeID + ".jsonl"), [
    { type: "user", cwd: dir, message: { content: "Claude workspace history" } },
  ]);
  writeEvents(path.join(copilotSession, "events.jsonl"), [
    { type: "session.start", data: { context: { cwd: dir } } },
    { type: "user.message", data: { content: "Copilot project history" } },
  ]);
  const launch = {
    args: process.env.RUNHUDDLE_TEST_EXECUTABLE ? [] : [path.resolve(".")],
    executablePath: process.env.RUNHUDDLE_TEST_EXECUTABLE, env,
  };
  let app = await electron.launch(launch);
  try {
    let page = await workspacePage(app);
    const sidebar = () => page.locator(".sidebar-list");
    for (const title of ["Codex release history", "Claude workspace history", "Copilot project history"])
      await expect(sidebar().getByRole("button", { name: new RegExp(title) })).toBeVisible();
    await sidebar().getByRole("button", { name: /Codex release history/ }).click();
    await expect(page.getByRole("region", { name: "Conversation history" })
      .getByText("Read the package manifest.", { exact: true })).toBeVisible();
    await page.locator(".document-more summary").click();
    await expect(page.getByRole("button", { name: "Pin session", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /archive/i })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Session filter" }).locator("option"))
      .toHaveText(["All sessions", "Pinned"]);
    const codexRow = sidebar().locator(".saved-row").filter({ hasText: "Codex release history" });
    const rowMenu = codexRow.locator(".row-menu");
    await codexRow.locator(".session-row").click({ button: "right" });
    await expect(rowMenu.getByRole("button", { name: "Resume session", exact: true })).toBeVisible();
    await expect(rowMenu.getByRole("button", { name: "Start new session with context…", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(rowMenu).not.toHaveAttribute("open", "");
    await codexRow.locator(".session-row").press("Shift+F10");
    await rowMenu.getByRole("button", { name: "Pin session", exact: true }).click();
    await codexRow.locator(".session-row").click({ button: "right" });
    await expect(rowMenu.getByRole("button", { name: "Unpin session", exact: true })).toBeVisible();
    await rowMenu.getByRole("button", { name: "Hide session", exact: true }).click();
    await expect(sidebar().getByRole("button", { name: /Codex release history/ })).toHaveCount(0);

    await page.getByRole("button", { name: "Projects", exact: true }).click();
    const project = sidebar().locator(".project-group");
    const projectHeader = project.locator(":scope > summary");
    const projectMenu = sidebar().locator(".project-row-menu");
    await projectHeader.click({ button: "right" });
    await expect(project).not.toHaveAttribute("open", "");
    await expect(projectMenu.getByRole("button", { name: "Focus project", exact: true })).toBeVisible();
    await expect(projectMenu.getByRole("button", { name: "New session", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(projectMenu).not.toHaveAttribute("open", "");
    await projectHeader.press("Shift+F10");
    await expect(projectMenu.getByRole("button", { name: "Hide project", exact: true })).toBeVisible();
    await page.getByRole("searchbox", { name: "Search sessions and notes" }).click();
    await expect(projectMenu).not.toHaveAttribute("open", "");
    await projectHeader.click();
    const projectSession = project.locator(".saved-row").filter({ hasText: "Claude workspace history" });
    await projectSession.locator(".session-row").click({ button: "right" });
    await expect(projectSession.getByRole("button", { name: "Pin session", exact: true })).toBeVisible();
    await expect(projectMenu).not.toHaveAttribute("open", "");
    await projectHeader.click({ button: "right" });
    await expect(projectSession.locator(".row-menu")).not.toHaveAttribute("open", "");
    await projectMenu.getByRole("button", { name: "Hide project", exact: true }).click();
    await expect(sidebar().locator(".project-group")).toHaveCount(0);
    await closeUI(app);
    app = await electron.launch(launch);
    page = await workspacePage(app);
    await expect(sidebar().locator(".project-group")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Manage hidden…", exact: true })).toHaveCount(0);
    await page.getByLabel("Project list options", { exact: true }).click();
    await page.getByRole("button", { name: "Manage hidden…", exact: true }).click();
    const hidden = page.getByRole("dialog", { name: "Hidden projects and sessions" });
    await expect(hidden).toContainText("Codex release history");
    await hidden.getByRole("button", { name: "Restore project", exact: true }).click();
    await hidden.getByRole("button", { name: "Restore session", exact: true }).click();
    await expect(hidden).toContainText("No hidden projects or sessions.");
    await hidden.getByRole("button", { name: "Close hidden history", exact: true }).click();
    await page.getByRole("button", { name: "Recent", exact: true }).click();
    await expect(sidebar().getByRole("button", { name: /Codex release history/ })).toBeVisible();
    expect(fs.existsSync(codexTranscript)).toBe(true);

    const destination = await page.evaluate((cwd) => window.runhuddle.create(cwd, "shell"), dir);
    const continuedID = "44444444-4444-4444-8444-444444444444";
    await app.evaluate(({ ipcMain }, terminal) => {
      const fixture = { creates: [] as [string, string][], writes: [] as [string, string][] };
      (globalThis as any).continuationFixture = fixture;
      ipcMain.removeHandler("create");
      ipcMain.handle("create", (_event, cwd, agent) => {
        fixture.creates.push([cwd, agent]);
        return { ...terminal, agent, title: "Fresh Claude session" };
      });
      ipcMain.removeHandler("usage");
      ipcMain.handle("usage", (_event, provider) => ({ provider, windows: [] }));
      ipcMain.removeHandler("write");
      ipcMain.handle("write", (_event, id, text) => { fixture.writes.push([id, text]); });
    }, { ...destination, sessionID: continuedID });
    const recorded = sidebar().getByRole("button", { name: /Claude workspace history/ });
    await recorded.click();
    await page.getByRole("button", { name: "Start new session with context…", exact: true }).click();
    const review = page.getByRole("dialog", { name: "Start new session with context", exact: true });
    await expect(review.getByLabel("Agent for new session")).toHaveValue("claude");
    const context = review.getByLabel("Context for new session");
    await expect(context).toHaveValue(/user: Claude workspace history/);
    await context.fill("Continue from this reviewed context.");
    await review.getByRole("button", { name: "Create session with reviewed context", exact: true }).click();
    await review.getByRole("button", { name: "Show new session", exact: true }).click();
    const state = () => app.evaluate(() => (globalThis as any).continuationFixture);
    expect(await state()).toEqual({ creates: [[dir, "claude"]], writes: [] });
    await page.getByRole("complementary", { name: "Session context ready" })
      .getByRole("button", { name: "Paste context", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Session context ready" })).toHaveCount(0);
    expect((await state()).writes).toEqual([[destination.id, "\x1b[200~Continue from this reviewed context.\x1b[201~"]]);
    await expect(recorded).toBeVisible();
    await page.getByLabel("Session actions", { exact: true }).click();
    await page.getByRole("button", { name: "Start new session with context…", exact: true }).click();
    await expect(review.getByLabel("Agent for new session")).toHaveValue("claude");
    await review.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(recorded).toContainText("Context passed to Claude");
    await recorded.click();
    const linked = () => page.getByRole("region", { name: "Linked sessions" });
    await expect(linked()).toContainText("Context passed to");
    await linked().getByRole("button", { name: /^Claude ·/ }).click();
    await expect(linked()).toContainText("Context from");
    await expect(linked().getByRole("button", { name: /Claude workspace history/ })).toBeVisible();

    writeEvents(path.join(claudeProject, continuedID + ".jsonl"), [
      { type: "user", cwd: dir, message: { content: "Continue the new task" } },
    ]);
    await closeUI(app);
    app = await electron.launch(launch);
    page = await workspacePage(app);
    await sidebar().getByRole("button", { name: /Claude workspace history/ }).click();
    await linked().getByRole("button", { name: /Continue the new task/ }).click();
    await expect(linked()).toContainText("Context from");
  } finally {
    await closeUI(app);
    const service = new Service(path.join(env.RUNHUDDLE_DATA, "service-v2"));
    try { if (await service.connectExisting()) await service.call("shutdown"); } finally { service.disconnect(); }
    await removeFixture(dir);
  }
});
