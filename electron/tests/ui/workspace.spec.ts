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
async function workspacePage(app: Awaited<ReturnType<typeof electron.launch>>, keepDashboard = false) {
  const page = await app.firstWindow();
  await expect(page.locator(".app")).toBeVisible();
  if (await page.locator("dialog.getting-started").count())
    await page.getByRole("dialog", { name: "Getting started" }).getByRole("button", { name: "Skip guide" }).click();
  const dashboard = page.getByRole("dialog", { name: "RunHuddle" });
  await expect(dashboard).toBeVisible();
  if (!keepDashboard) await dashboard.getByRole("button", { name: "Open workspace" }).click();
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
    const startupDashboard = page.getByRole("dialog", { name: "RunHuddle" });
    await expect(startupDashboard).toHaveCount(0);
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
      ["See all projects", "project-dashboard"],
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
      if (title === "See all projects") {
        await expect(guide).toContainText("Open Browser from the session toolbar");
        await expect(guide).toContainText("Preview also shows referenced files and web links");
        await expect(guide).toContainText("Session → Keyboard Shortcuts");
      }
      if (title === "Preview and share a page") {
        await expect(guide).toContainText("Preview a local dev server or HTTPS page");
        await expect(guide).toContainText("Switching sites or sessions ends access");
      }
    }
    await guide.getByRole("button", { name: "Done" }).click();
    await expect(guide).toHaveCount(0);
    await expect(startupDashboard).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(startupDashboard).toHaveCount(0);
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
    await page.getByRole("button", { name: "Project dashboard", exact: true }).click();
    const liveHeader = page.locator(".dashboard-toolbar-activity");
    const masthead = page.locator(".dashboard-masthead");
    const brandMark = masthead.locator(".dashboard-brand-mark");
    const initialBrandTint = await brandMark.evaluate((element) => getComputedStyle(element, "::after").backgroundColor);
    const initialMasthead = await masthead.evaluate((element) => getComputedStyle(element).backgroundImage);
    const initialHeader = await liveHeader.evaluate((element) => getComputedStyle(element).backgroundImage);
    await chooseAppMenu("app-accent-Violet");
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--app-accent-base")))
      .toBe("#b6a0ed");
    await expect.poll(() => liveHeader.evaluate((element) => getComputedStyle(element).backgroundImage))
      .not.toBe(initialHeader);
    await expect.poll(() => masthead.evaluate((element) => getComputedStyle(element).backgroundImage))
      .not.toBe(initialMasthead);
    await expect.poll(() => brandMark.evaluate((element) => getComputedStyle(element, "::after").backgroundColor))
      .not.toBe(initialBrandTint);
    const violetHeader = await liveHeader.evaluate((element) => getComputedStyle(element).backgroundImage);
    await chooseAppMenu("app-accent-Rose");
    await expect.poll(() => liveHeader.evaluate((element) => getComputedStyle(element).backgroundImage))
      .not.toBe(violetHeader);
    await masthead.screenshot({ path: "test-results/preview-huddle-light.png" });
    await chooseAppMenu("app-theme-dark");
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
    await masthead.screenshot({ path: "test-results/preview-huddle-dark.png" });
    const originalViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    await page.setViewportSize({ width: 1470, height: 950 });
    const projectsPanel = page.getByRole("dialog", { name: "RunHuddle" }).getByRole("region", { name: "Projects", exact: true });
    await expect.poll(async () => (await projectsPanel.boundingBox())?.width ?? 0).toBeGreaterThan(1390);
    await page.setViewportSize(originalViewport);
    await chooseAppMenu("app-theme-light");
    await page.getByRole("button", { name: "Open workspace" }).click();
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
    execFileSync("git", ["rm", "review-fixture.txt"], { cwd: dir });
    execFileSync("git", ["commit", "-qm", "Delete review fixture"], { cwd: dir });
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("editors");
      ipcMain.handle("editors", () => ({
        preferred: "code", editors: [{ id: "code", name: "VS Code", application: "/mock/Code.app" }],
      }));
      ipcMain.removeHandler("open-editor");
      ipcMain.handle("open-editor", (_event, id, target, line) => {
        (globalThis as any).deletedDiffEditor = { id, target, line };
      });
    });
    await page.getByRole("button", { name: "Refresh changes", exact: true }).click();
    const deletion = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    const commitPicker = page.getByRole("combobox", { name: "Commit to review" });
    await expect(commitPicker).toContainText("Delete review fixture");
    await commitPicker.selectOption(deletion);
    const deletedFile = page.getByRole("navigation", { name: "Changed files" })
      .getByRole("button", { name: /^D review-fixture.txt/ });
    await expect(deletedFile).toBeVisible();
    await deletedFile.click();
    const deletedDiff = page.getByLabel("Diff review", { exact: true });
    await expect(deletedDiff.getByText("committed · Deleted file")).toBeVisible();
    await deletedDiff.getByRole("button", { name: "Open project in VS Code", exact: true }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as any).deletedDiffEditor))
      .toEqual({ id: "code", target: fs.realpathSync.native(dir), line: undefined });

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
    await page.evaluate(async (id) => {
      await window.runhuddle.write(id, "awk 'BEGIN {for (i=0; i<180; i++) print \"RH_SCROLLBACK_LINE_\" i}'\r");
    }, terminalId);
    const scrollbackKey = "runhuddle.terminalScrollback." + terminalId;
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), scrollbackKey))
      .toContain("RH_SCROLLBACK_LINE_0");
    await page.evaluate(async (id) => {
      await window.runhuddle.write(id, "awk 'BEGIN {for (i=0; i<180000; i++) printf \"%c[H\", 27}'\r");
    }, terminalId);
    await expect.poll(() => page.evaluate(async (id) => {
      const { data } = await window.runhuddle.replay(id);
      return data.length === 512 * 1024 && !data.includes("RH_SCROLLBACK_LINE_0");
    }, terminalId)).toBe(true);
    console.log("UI: quitting app with live terminal");
    await closeUI(app);
    console.log("UI: app quit, relaunching");
    app = await electron.launch(launch);
    page = await workspacePage(app);
    await expect(page.getByRole("tab")).toHaveCount(1);
    console.log("UI: terminal tab ready");
    const restoredSlider = page.locator(".terminal-host:visible .scrollbar.vertical .slider");
    const restoredBottom = () => restoredSlider.evaluate((element) => parseFloat((element as HTMLElement).style.top));
    await expect.poll(restoredBottom).toBeGreaterThan(0);
    const savedPosition = await restoredBottom();
    await page.locator(".terminal-host:visible .xterm-screen").hover();
    await page.mouse.wheel(0, -350);
    await expect.poll(restoredBottom).toBeLessThan(savedPosition);
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
    await page.getByRole("status", { name: "Session notification", exact: true }).getByRole("button", { name: "Open session" }).click();
    await expect(page.getByRole("tab")).toHaveCount(1);
    await expect(linked).toHaveClass(/selected/);
    await app.evaluate(({ BrowserWindow }, target) => {
      BrowserWindow.getAllWindows()[0].webContents.send("event", {
        event: "session-alert", key: target.provider + ":" + target.sessionID,
        alert: { ...target, title: "Codex is ready for review", body: "Review fixtures" },
      });
    }, alertTarget);
    await expect(page.getByRole("status", { name: "Session notification", exact: true })).toHaveCount(0);
    await page.locator(".terminal-tab").getByRole("button", { name: /^Close / }).click();
    await expect(page.getByRole("tab")).toHaveCount(0);
    await app.evaluate(({ BrowserWindow }, target) => {
      BrowserWindow.getAllWindows()[0].webContents.send("event", {
        event: "session-alert", key: target.provider + ":" + target.sessionID,
        alert: { ...target, title: "Codex is ready for review", body: "Review fixtures" },
      });
    }, alertTarget);
    await expect(page.getByRole("status", { name: "Session notification", exact: true })).toBeVisible();
    await linked.click();
    await expect(page.getByRole("status", { name: "Session notification", exact: true })).toHaveCount(0);
    await page.locator(".terminal-tab").getByRole("button", { name: /^Close / }).click();
    await expect(page.getByRole("status", { name: "Session notification", exact: true })).toHaveCount(0);
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
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await page.evaluate(() => window.runhuddle.updateTerminalService());
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
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rh-companion-ui-")));
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
    await page.evaluate(async (dir) => {
      await window.runhuddle.create(dir, "shell");
    }, dir);
    await page.getByRole("button", { name: "Project dashboard", exact: true }).click();
    const dashboard = page.getByRole("dialog", { name: "RunHuddle" });
    await dashboard.getByRole("button", { name: `Actions for project ${path.basename(dir)}`, exact: true }).click();
    await dashboard.getByRole("button", { name: "Open project shell", exact: true }).click();
    await expect(dashboard).toBeHidden();
    const projectShells = await page.evaluate(async (dir) =>
      (await window.runhuddle.snapshot()).terminals.filter((terminal) => terminal.cwd === dir && terminal.agent === "shell"), dir);
    expect(projectShells).toHaveLength(2);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    await page.evaluate(async (id) => { await window.runhuddle.close(id); }, projectShells[0].id);
    await page.evaluate(async (other) => { await window.runhuddle.create(other, "shell"); }, other);
    await chooseProject(page, "");
    await page.locator(".live-row .session-row").first().click();
    await expect(page.locator(".workspace-header")).toHaveCount(0);
    await page.getByRole("button", { name: "Open shell beside session", exact: true }).click();
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
    await page.getByRole("button", { name: "Open shell beside session", exact: true }).click();
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
    await expect(resize).toHaveAttribute("aria-orientation", "vertical");
    await resize.press("ArrowLeft");
    await expect(resize).toHaveAttribute("aria-valuenow", "60");
    await page.getByRole("button", { name: "Project dashboard", exact: true }).click();
    await dashboard.getByRole("button", { name: "Open workspace", exact: true }).click();
    await expect(resize).toHaveAttribute("aria-valuenow", "60");
    await expect(page.getByRole("region", { name: "Companion shell" })).toBeVisible();
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

test("terminal hyperlinks open in the default browser only after confirmation", async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rh-terminal-link-ui-")));
  const profile = path.join(dir, "profile");
  const env = { ...process.env, RUNHUDDLE_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: process.env.RUNHUDDLE_TEST_EXECUTABLE ? [] : [path.resolve(".")],
    executablePath: process.env.RUNHUDDLE_TEST_EXECUTABLE, env,
  });
  const client = new Service(path.join(profile, "service-v2"));
  try {
    const page = await workspacePage(app);
    await page.evaluate((cwd) => window.runhuddle.create(cwd, "shell"), dir);
    const url = "https://example.test/project?q=runhuddle#details";
    await app.evaluate(({ ipcMain, dialog, shell }, destination) => {
      const fixture = { approve: false, fail: false, confirmations: [] as object[], opened: [] as string[] };
      (globalThis as any).linkFixture = fixture;
      dialog.showMessageBox = (async (_, options) => {
        fixture.confirmations.push(options);
        return { response: fixture.approve ? 1 : 0, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
      shell.openExternal = async (href) => {
        if (fixture.fail) throw Error("Browser unavailable");
        fixture.opened.push(href);
      };
      ipcMain.removeHandler("replay");
      ipcMain.handle("replay", () => ({
        data: "\x1b]8;;" + destination + "\x1b\\RunHuddle link\x1b]8;;\x1b\\",
        sequence: 1000000,
      }));
    }, url);
    await page.locator(".live-row .session-row").getByText(path.basename(dir), { exact: true }).click();
    const screen = page.locator(".xterm-screen");
    await expect(screen).toContainText("RunHuddle link");
    const clickLink = async () => {
      const position = { x: 12, y: 6 };
      await screen.hover({ position });
      await screen.click({ position, modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
    };
    await clickLink();
    const state = () => app.evaluate(() => (globalThis as any).linkFixture);
    await expect.poll(async () => (await state()).confirmations.length).toBe(1);
    expect((await state()).confirmations[0]).toMatchObject({
      defaultId: 0, cancelId: 0, detail: expect.stringContaining(url),
    });
    expect((await state()).opened).toEqual([]);
    await app.evaluate(() => { (globalThis as any).linkFixture.approve = true; });
    await clickLink();
    await expect.poll(async () => (await state()).opened).toEqual([url]);
    await expect(page.evaluate(() => window.runhuddle.openTerminalLink("file:///tmp/local-file")))
      .rejects.toThrow("isn’t a supported web address");
    expect((await state()).confirmations).toHaveLength(2);
    expect(await app.windows()).toHaveLength(1);
    await app.evaluate(() => { (globalThis as any).linkFixture.fail = true; });
    await clickLink();
    await expect(page.getByRole("alert")).toContainText("Couldn’t open the link in your default browser.");
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
    await expect(popup.getByRole("button", { name: "Select a session to attach" })).toBeDisabled();
    await expect(popup).toContainText("Select an open AI session");
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
    const setSessionState = (state: string) => app.evaluate(({ BrowserWindow }, session) => {
      BrowserWindow.getAllWindows()[0].webContents.send("event", { event: "store", sessions: [session] });
    }, {
      state, terminalId: shell.id, provider: "Claude", sessionID: "attachment-fixture",
      title: "Attachment fixture", cwd: dir, project: path.basename(dir), preview: "", updated: Date.now() / 1000,
    });
    await setSessionState("working");
    const second = capture("Screenshot Rick's capture.png");
    await expect(popup).toContainText(path.basename(second));
    const queue = popup.getByRole("button", { name: "Queue for current session" });
    await expect(queue).toBeEnabled();
    await queue.click();
    await expect(popup.getByText(/1 screenshot queued/)).toBeVisible();
    const third = capture("Screenshot next capture.png");
    await expect(popup).toContainText(path.basename(third));
    await queue.click();
    await expect(popup.getByText(/2 screenshots queued/)).toBeVisible();
    await setSessionState("needsInput");
    expect(await app.evaluate(() => (globalThis as any).screenshotWrites || [])).toEqual([]);
    await setSessionState("idle");
    await expect(popup).toHaveCount(0);
    const writes = await app.evaluate(() => (globalThis as any).screenshotWrites || []);
    const attachmentWrites = writes.filter((write: { data: string }) => write.data.includes("capture.png"));
    expect(attachmentWrites).toHaveLength(2);
    expect(writes.every((write: { data: string }) => !/[\r\n]/.test(write.data))).toBe(true);
    for (const [index, file] of [second, third].entries()) {
      const result = attachmentWrites[index];
      expect(result.id).toBe(shell.id);
      expect(result.data.replace(/^\x1b\[200~/, "").replace(/\x1b\[201~$/, ""))
        .toBe(process.platform === "win32" ? '"' + file + '" ' : "'" + file.replaceAll("'", "'\\''") + "' ");
    }
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
    for (const title of ["Adjust terminal appearance", "Review Git changes", "Save project notes", "See all projects", "Catch up in Inbox", "Preview and share a page"]) {
      await guide.getByRole("button", { name: "Next" }).click();
      await expect(guide.getByRole("heading", { name: title })).toBeVisible();
      if (title === "See all projects") await expect(guide).toContainText("Open Browser from the session toolbar");
    }
    await expect(guide).toContainText("Allow agent control lets the selected session interact with the open site");
    await guide.getByRole("button", { name: "Done" }).click();
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
    const point = (selector: string, title = "Browser fixture") => app!.evaluate(async ({ webContents }, { selector, title }) => {
      const guest = webContents.getAllWebContents().find((item) => item.getTitle() === title);
      return guest!.mainFrame.executeJavaScript(`(() => {
        const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return { x: Math.floor(r.x + r.width / 2), y: Math.floor(r.y + r.height / 2) };
      })()`);
    }, { selector, title });
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
    await expect(panel.getByRole("alert")).toContainText("Navigation outside the shared site was blocked");
    expect(browserTool("inspect_page").isError).toBe(true);
    await expect.poll(async () => (await browserChild()).url).toBe("http://" + address + "/");

    // Serve non-loopback HTTPS origins through Chromium without a network dependency.
    const site = "https://preview.runhuddle.test";
    const otherSite = "https://another.runhuddle.test";
    await app.evaluate(async ({ webContents }, { site, otherSite }) => {
      const guest = webContents.getAllWebContents().find((item) => item.getTitle() === "Browser fixture")!;
      await guest.session.protocol.handle("https", (request) => {
        const url = new URL(request.url);
        if (![site, otherSite].includes(url.origin)) return new Response("Not found", { status: 404 });
        return new Response(
          `<!doctype html><title>HTTPS fixture</title><h1>${url.origin}${url.pathname}</h1>
            <button onclick="document.querySelector('h1').textContent='HTTPS button clicked'">Try me</button>
            <a href="${otherSite}/next">Other site</a>`,
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      });
    }, { site, otherSite });
    const openAddress = async (address: string) => {
      await url.fill(address);
      await url.press("Enter");
      await expect.poll(async () => (await browserChild()).url).toBe(address);
      await expect(panel.getByRole("button", { name: /^Share page/ })).toBeEnabled();
    };
    await openAddress(site + "/");
    expect(browserTool("inspect_page").isError).toBe(true);
    const allow = panel.getByRole("button", { name: "Allow agent control" });
    const stop = panel.getByRole("button", { name: "Stop agent control" });
    await allow.click();
    await expect(stop).toBeVisible();
    expect(JSON.parse(browserTool("inspect_page").content[0].text)).toMatchObject({
      url: site + "/", visibleText: expect.stringContaining(site + "/"),
    });
    expect(browserTool("click", await point("button", "HTTPS fixture"))).toMatchObject({
      content: [{ text: "Clicked the shared page." }],
    });
    await expect.poll(() => browserTool("inspect_page").content[0].text).toContain("HTTPS button clicked");
    await openAddress(site + "/next");
    await expect(stop).toBeVisible();
    expect(JSON.parse(browserTool("inspect_page").content[0].text)).toMatchObject({ url: site + "/next" });
    await openAddress(otherSite + "/");
    await expect(stop).toHaveCount(0);
    expect(browserTool("inspect_page").isError).toBe(true);
    await allow.click();
    await expect(stop).toBeVisible();
    expect(JSON.parse(browserTool("inspect_page").content[0].text)).toMatchObject({ url: otherSite + "/" });
    await openAddress(site + "/");
    await allow.click();
    await expect(stop).toBeVisible();
    expect(browserTool("click", await point("a", "HTTPS fixture"))).toMatchObject({
      content: [{ text: "Clicked the shared page." }],
    });
    await expect(panel.getByRole("alert")).toContainText("Navigation outside the shared site was blocked");
    expect(browserTool("inspect_page").isError).toBe(true);
    expect((await browserChild()).url).toBe(site + "/");
    await page.getByRole("button", { name: "Project dashboard", exact: true }).click();
    const board = page.getByRole("dialog", { name: "RunHuddle" });
    await expect.poll(async () => (await browserChild()).visible).toBe(false);
    await page.keyboard.press("ControlOrMeta+p");
    const commandInput = page.getByRole("dialog", { name: "Command Palette" }).getByRole("textbox");
    await commandInput.fill("> open browser");
    await commandInput.press("Enter");
    const dashboardBrowser = board.getByRole("region", { name: "Browser preview" });
    await expect(dashboardBrowser.getByRole("textbox", { name: "Browser address" })).toHaveValue(site + "/");
    await expect.poll(async () => (await browserChild()).visible).toBe(true);
    const splitWidth = (await browserChild()).width;
    const split = board.getByRole("separator", { name: "Resize browser pane" });
    await split.press("ArrowLeft");
    await expect.poll(async () => (await browserChild()).width).toBeGreaterThan(splitWidth);
    await board.getByRole("button", { name: "Recent", exact: true }).click();
    await expect.poll(async () => (await browserChild()).visible).toBe(false);
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await browserChild()).visible).toBe(true);
    await expect.poll(async () => (await browserChild()).url).toBe(site + "/");
    await dashboardBrowser.getByRole("button", { name: "Close browser preview" }).click();
    await expect(dashboardBrowser).toHaveCount(0);
    await expect.poll(async () => (await browserChild()).visible).toBe(false);
    await board.getByRole("button", { name: "Open workspace", exact: true }).click();
    await expect.poll(async () => (await browserChild()).visible).toBe(true);
    await expect(url).toHaveValue(site + "/");
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

test("Inbox keeps unread completions across restart and opens the exact recorded session", async ({}, testInfo) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-inbox-ui-"));
  fs.writeFileSync(path.join(dir, "Release notes.md"), "# Release checklist\n\n- Verify the mobile layout.\n");
  const data = path.join(dir, "preview");
  fs.mkdirSync(data);
  const sessionID = "55555555-5555-4555-8555-555555555555";
  const rows = ["Claude", "Codex"].map((provider) => ({
    provider, sessionID, title: provider + " fixture", cwd: dir,
    project: "Shared project", state: "saved", preview: "", updated: 1,
  }));
  const stale = [
    { ...rows[1], sessionID: "66666666-6666-4666-8666-666666666666", title: "Old notes", updated: 0.5 },
    { ...rows[1], sessionID: "77777777-7777-4777-8777-777777777777", title: "Old draft" },
  ];
  fs.mkdirSync(path.join(data, "service-v2"), { recursive: true });
  fs.writeFileSync(path.join(data, "service-v2", "sessions.json"), JSON.stringify([...rows, ...stale]));
  fs.writeFileSync(path.join(data, "inbox.json"), JSON.stringify(rows.map((row) => ({
    id: row.provider, kind: "completion", provider: row.provider, sessionID,
    body: row.title, createdAt: 1,
  }))));
  const env = {
    ...process.env,
    RUNHUDDLE_DATA: data,
    RUNHUDDLE_SCREENSHOT_DIRECTORY: dir,
    CLAUDE_CONFIG_DIR: path.join(dir, "claude"),
  };
  const transcriptFolder = path.join(env.CLAUDE_CONFIG_DIR, "projects", dir.replace(/[^a-zA-Z0-9]/g, "-"));
  fs.mkdirSync(transcriptFolder, { recursive: true });
  fs.writeFileSync(path.join(transcriptFolder, sessionID + ".jsonl"), [
    { type: "user", message: { content: '<image name=[Image #1] path="/tmp/private-capture.png"></image>\n[Image #1] Review the checkout layout.' } },
    { type: "assistant", message: { content: [{ type: "text", text: "Checking the layout…" }] } },
    { type: "assistant", message: { content: [
      { type: "text", text: "The layout is ready for **visual review**.\n\n- Check mobile\n- Check desktop" },
      { type: "tool_use", input: { command: "Hidden tool payload" } },
    ] } },
  ].map((record) => JSON.stringify(record)).join("\n"));
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = {
    args: process.env.RUNHUDDLE_TEST_EXECUTABLE ? [] : [path.resolve(".")],
    env,
    executablePath: process.env.RUNHUDDLE_TEST_EXECUTABLE,
  };
  let app = await electron.launch(launch);
  try {
    let page = await workspacePage(app, true);
    const toggle = () => page.getByRole("button", { name: "Inbox", exact: true });
    const dashboard = () => page.getByRole("dialog", { name: "RunHuddle" });
    const openFocusedProject = () => dashboard().getByRole("button", { name: `Focus project ${path.basename(dir)}`, exact: true }).click();
    const browseProjectHistory = async () => {
      await openFocusedProject();
      await expect(dashboard().getByRole("region", { name: "Pick up", exact: true })).toBeVisible();
      await dashboard().getByRole("button", { name: "History", exact: true }).click();
    };
    const showAllProjects = () => dashboard().getByRole("button", { name: /Show all projects/ }).click();
    await expect(dashboard().getByRole("region", { name: "Live sessions" })).toHaveCount(0);
    await expect(dashboard().getByRole("region", { name: "Ready for review", exact: true })).toBeVisible();
    const reviewProjectCard = dashboard().locator(".dashboard-project-card").filter({
      has: page.getByRole("button", { name: `Focus project ${path.basename(dir)}`, exact: true }),
    });
    await expect(reviewProjectCard.getByRole("button", { name: "Review session", exact: true })).toBeVisible();
    await browseProjectHistory();
    const reviewQueue = page.getByRole("dialog", { name: "Review saved sessions" });
    await dashboard().getByRole("button", { name: "Review old sessions" }).click();
    await expect(reviewQueue.getByRole("heading", { name: "Old notes", exact: true })).toBeVisible();
    await expect(reviewQueue.getByText("Transcript unavailable.", { exact: false })).toBeVisible();
    await expect(reviewQueue.getByRole("button", { name: "Open full conversation" })).toHaveCount(0);
    await reviewQueue.getByRole("button", { name: "Hide from history", exact: true }).click();
    await expect(reviewQueue.getByText("Hidden from history · Old notes")).toBeVisible();
    await reviewQueue.getByRole("button", { name: "Undo hide" }).click();
    await expect(reviewQueue.getByRole("heading", { name: "Old notes", exact: true })).toBeVisible();
    await reviewQueue.getByRole("button", { name: "Keep", exact: true }).click();
    await reviewQueue.getByRole("button", { name: "Close session review", exact: true }).click();
    await dashboard().getByRole("button", { name: "Review old sessions" }).click();
    await expect(reviewQueue.getByRole("heading", { name: "Old notes", exact: true })).toHaveCount(0);
    await reviewQueue.getByRole("button", { name: "Close session review", exact: true }).click();
    await showAllProjects();
    const cleanup = () => dashboard().getByRole("region", { name: "Cleanup suggestions" });
    await cleanup().getByRole("button", { name: /Inactive history/ }).click();
    await expect(cleanup().getByRole("checkbox")).toHaveCount(2);
    await cleanup().getByRole("checkbox", { name: "Select Old draft" }).uncheck();
    await cleanup().getByRole("button", { name: "Hide 1 session", exact: true }).click();
    await expect(cleanup().getByRole("status")).toHaveText("Hid 1 session.");
    await expect(cleanup().getByRole("checkbox", { name: "Select Old notes" })).toHaveCount(0);
    await cleanup().getByRole("button", { name: "Undo", exact: true }).click();
    await expect(cleanup().getByRole("status")).toHaveText("Restored 1 session.");
    await expect(cleanup().getByRole("checkbox", { name: "Select Old notes" })).toBeChecked();
    await cleanup().getByRole("checkbox", { name: "Select Old draft" }).check();
    await cleanup().getByRole("button", { name: "Hide 2 sessions", exact: true }).click();
    await expect(cleanup().getByRole("status")).toHaveText("Hid 2 sessions.");
    const projectCardView = dashboard().getByRole("combobox", { name: "Project card view" });
    await expect(projectCardView).toHaveValue("comfortable");
    await projectCardView.selectOption("compact");
    await expect(dashboard().locator(".dashboard-grid")).toHaveAttribute("data-density", "compact");
    await browseProjectHistory();
    await dashboard().getByRole("button", { name: "Actions for Claude fixture", exact: true }).click();
    await dashboard().getByRole("button", { name: "Pin Claude fixture", exact: true }).click();
    await dashboard().getByRole("button", { name: "Actions for Claude fixture", exact: true }).click();
    await dashboard().getByRole("button", { name: "Edit details for Claude fixture" }).click();
    await dashboard().getByLabel("Session name", { exact: true }).fill("Review layout");
    await dashboard().getByLabel("Next step").fill("Check the mobile layout");
    await dashboard().getByRole("button", { name: "Save details" }).click();
    await expect(dashboard().locator(".dashboard-next:visible").getByText("Check the mobile layout")).toBeVisible();
    await dashboard().getByRole("button", { name: "Preview Review layout", exact: true }).click();
    const conversation = dashboard().getByRole("region", { name: "Conversation preview", exact: true });
    await expect(conversation.getByText("The layout is ready for visual review.", { exact: true })).toBeVisible();
    await expect(conversation.getByText("Review the checkout layout.", { exact: true })).toBeVisible();
    await expect(conversation).not.toContainText("/tmp/private-capture.png");
    await expect(conversation.getByRole("button", { name: "Resume session", exact: true })).toBeEnabled();
    await showAllProjects();
    await expect(reviewProjectCard.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    const find = dashboard().getByRole("searchbox", { name: "Find projects and conversations" });
    await expect(find).toBeFocused();
    await find.fill("Codex fixture");
    await find.press("Enter");
    await expect(page.getByRole("heading", { name: "Codex fixture" })).toBeVisible();
    await toggle().click();
    await expect(page.getByRole("region", { name: "Ready for review" })).toBeVisible();
    await closeUI(app);
    app = await electron.launch(launch);
    page = await workspacePage(app, true);
    await expect(cleanup()).toHaveCount(0);
    await expect(dashboard().getByRole("combobox", { name: "Project card view" })).toHaveValue("compact");
    await dashboard().getByRole("combobox", { name: "Project card view" }).selectOption("comfortable");
    const resume = dashboard().getByRole("region", { name: "Pick up where you left off" });
    await expect(resume.locator(".dashboard-resume-card").filter({ hasText: /Codex fixture|Review layout/ })).toHaveCount(0);
    await expect(dashboard().getByRole("region", { name: "Live sessions" })).toHaveCount(0);
    await expect(dashboard().getByRole("region", { name: "Ready for review", exact: true })).toBeVisible();
    await openFocusedProject();
    await expect(dashboard().locator(".dashboard-next:visible").getByText("Check the mobile layout")).toBeVisible();
    await showAllProjects();
    await dashboard().getByRole("button", { name: "Saved reviews (2)", exact: true }).click();
    const attention = dashboard().getByRole("region", { name: "Saved reviews" });
    await attention.getByRole("button", { name: "Preview Review layout", exact: true }).click();
    await expect(attention.getByText("Your instruction", { exact: true })).toBeVisible();
    await expect(attention.getByText("Review the checkout layout.", { exact: true })).toBeVisible();
    await expect(attention.getByText("1 screenshot attached", { exact: true })).toBeVisible();
    await expect(attention).not.toContainText("/tmp/private-capture.png");
    await expect(attention.locator(".dashboard-briefing dd").filter({ hasText: "The layout is ready for visual review." })).toBeVisible();
    await expect(attention.getByText("Review the agent’s update.", { exact: true })).toBeVisible();
    await expect(attention.getByText("Check mobile", { exact: true })).toBeHidden();
    await attention.getByText("Read full reply", { exact: true }).click();
    await expect(attention.locator(".dashboard-review-excerpt strong")).toHaveText("visual review");
    await expect(attention.getByRole("listitem")).toHaveText(["Check mobile", "Check desktop"]);
    await expect(attention).not.toContainText("Hidden tool payload");
    await expect(attention.getByRole("button", { name: "Mark Review layout reviewed" })).toBeVisible();
    await attention.getByRole("button", { name: "Open Review layout (Claude)" }).click();
    await expect(page.getByRole("heading", { name: "Review layout" })).toBeVisible();
    const panel = page.getByRole("region", { name: "Session Inbox" });
    await expect(toggle()).toHaveAttribute("aria-description", "2 alerts");
    await panel.getByRole("button", { name: "Open Review layout (Claude)" }).click();
    await expect(page.getByRole("heading", { name: "Review layout" })).toBeVisible();
    await expect(toggle()).toHaveAttribute("aria-description", "2 alerts");
    await panel.getByRole("button", { name: "Mark Review layout reviewed" }).click();
    await expect(toggle()).toHaveAttribute("aria-description", "1 alert");
    await panel.getByRole("button", { name: "Mark Codex fixture reviewed" }).click();
    await expect(panel.getByText("You’re all caught up.")).toBeVisible();
    expect(JSON.parse(fs.readFileSync(path.join(data, "inbox.json"), "utf8"))).toEqual([]);
    await page.getByRole("button", { name: "Project dashboard", exact: true }).click();
    await expect(resume.locator(".dashboard-resume-card").filter({ hasText: "Codex fixture" })).toContainText("Opened");
    await expect(resume.locator(".dashboard-resume-card").filter({ hasText: "Review layout" })).toContainText("Check the mobile layout");
    await resume.getByRole("button", { name: "Dismiss Codex fixture from resume suggestions" }).click();
    await expect(resume).not.toContainText("Codex fixture");
    await resume.getByRole("button", { name: "Dismiss Review layout from resume suggestions" }).click();
    await expect(resume).toBeHidden();
    await expect(dashboard().getByRole("region", { name: "Live sessions" })).toHaveCount(0);
    await expect(dashboard().getByRole("region", { name: "Ready for review", exact: true })).toHaveCount(0);
    await expect(dashboard().getByRole("button", { name: "New session", exact: true })).toBeVisible();
    const start = dashboard().getByRole("region", { name: "Find a project or conversation" });
    await expect(start.getByRole("combobox")).toHaveCount(0);
    const dashboardSearch = start.getByRole("searchbox");
    await dashboardSearch.fill("visual review");
    const transcriptMatch = start.getByRole("region", { name: "Conversation matches" })
      .getByRole("button", { name: /Review layout.*visual review/i });
    await expect(transcriptMatch).toBeVisible();
    await expect(transcriptMatch.locator("mark")).toHaveText(["visual", "review"]);
    await expect(transcriptMatch.locator(".conversation-result-meta")).toContainText(path.basename(dir));
    await dashboardSearch.clear();
    await dashboard().getByRole("button", { name: "New session", exact: true }).click();
    const launcher = page.getByRole("dialog", { name: "New session or terminal" });
    const launchFolder = launcher.getByRole("combobox", { name: "Launch folder" });
    const launchCodex = launcher.getByRole("button", { name: /^Start Codex/ });
    await expect(launchFolder).toBeFocused();
    await expect(launchFolder).toHaveValue("");
    await expect(launchCodex).toBeDisabled();
    await launchFolder.selectOption(dir);
    await expect(launchCodex).toBeEnabled();
    const anotherFolder = path.join(dir, "another-project");
    fs.mkdirSync(anotherFolder);
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, anotherFolder);
    await launcher.getByRole("button", { name: "Browse…" }).click();
    await expect(launchFolder).toHaveValue(anotherFolder);
    await launcher.getByRole("button", { name: "Close launcher" }).click();
    await expect(dashboard()).toBeVisible();
    const liveTerminal = { id: "fixture-terminal", agent: "codex", sessionID, cwd: dir, title: "Codex fixture", exited: false };
    await app.evaluate(({ BrowserWindow, ipcMain }, { terminal, liveSession }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      const completion = { id: "follow-up-review", kind: "completion", provider: "Codex", sessionID: terminal.sessionID,
        body: terminal.title, createdAt: Date.now() };
      ipcMain.removeHandler("inbox-action");
      ipcMain.handle("inbox-action", (_event, id, action) => {
        if (id !== completion.id || action !== "dismiss") throw Error("Wrong review to acknowledge");
        wc.send("event", { event: "inbox", entries: [] });
        return true;
      });
      ipcMain.removeHandler("live-session-follow-up");
      ipcMain.handle("live-session-follow-up", (_event, provider, sessionID, terminalId, text) => {
        if (provider !== "Codex" || sessionID !== terminal.sessionID || terminalId !== terminal.id || text !== "Check the mobile layout.")
          throw Error("Wrong follow-up destination or message");
        wc.send("event", { event: "inbox", entries: [] });
      });
      wc.send("event", { event: "terminals", terminals: [terminal] });
      wc.send("event", { event: "store", sessions: [liveSession] });
      wc.send("event", { event: "inbox", entries: [completion] });
    }, { terminal: liveTerminal, liveSession: { ...rows[1], terminalId: liveTerminal.id, state: "idle" } });
    const live = dashboard().getByRole("region", { name: "Live sessions" });
    await expect(dashboard().getByRole("button", { name: "Next attention", exact: true })).toBeDisabled();
    await expect(dashboard().getByRole("button", { name: "Next review", exact: true })).toHaveAccessibleDescription("1 session is ready to review");
    await expect(live.getByRole("button", { name: /Saved reviews/ })).toHaveCount(0);
    await expect(dashboard().getByRole("region", { name: "Needs attention" })).toHaveCount(0);
    await expect(live.getByRole("navigation", { name: "Live session list" })).toHaveCount(0);
    await expect(live.locator(".dashboard-live-toolbar:visible")).toContainText("Codex fixture");
    const sendScreen = (sequence: number, data: string) => app.evaluate(({ BrowserWindow }, output) => {
      BrowserWindow.getAllWindows()[0].webContents.send("event", { event: "output", ...output });
    }, { id: liveTerminal.id, sequence, data });
    await sendScreen(900000, "\x1b[2J\x1b[H• Working (1m 02s • esc to interrupt)");
    await expect(live.getByRole("img", { name: "Working", exact: true })).toBeVisible();
    await expect(dashboard().getByRole("button", { name: "Next review", exact: true })).toBeDisabled();
    await sendScreen(900001, "\x1b[2J\x1b[HReady");
    await expect(dashboard().getByRole("button", { name: "Next review", exact: true })).toBeEnabled();
    await dashboard().getByRole("button", { name: "Next review", exact: true }).click();
    await expect(dashboard().getByRole("button", { name: "Next review", exact: true })).toBeDisabled();
    await expect(live.getByRole("img", { name: "Idle", exact: true })).toBeVisible();
    await expect(live.locator(".dashboard-live-toolbar:visible")).toContainText("Codex fixture");
    await live.getByRole("textbox", { name: /Follow up · Codex fixture/ }).fill("Check the mobile layout.");
    await live.getByRole("button", { name: "Send follow-up" }).click();
    await expect(live.getByText("Follow-up sent to Codex fixture.")).toBeVisible();
    await expect(dashboard().getByRole("button", { name: "Next attention", exact: true })).toBeDisabled();
    await expect(resume.locator(".dashboard-resume-card").filter({ hasText: "Codex fixture" })).toHaveCount(0);
    await app.evaluate(({ ipcMain, BrowserWindow, dialog, shell }, terminal) => {
      let url = "";
      const browserState = () => ({ url, title: "Preview link fixture", loading: false, ready: !!url,
        back: false, forward: false, agentSession: null, error: "" });
      ipcMain.removeHandler("browser-state");
      ipcMain.handle("browser-state", browserState);
      ipcMain.removeHandler("browser-navigate");
      ipcMain.handle("browser-navigate", (_event, destination) => {
        url = destination;
        const state = browserState();
        BrowserWindow.getAllWindows()[0].webContents.send("event", { event: "browser-preview", state });
        return state;
      });
      dialog.showMessageBox = async (_window, options) => {
        if (!options.detail?.includes("https://example.test/release")) throw Error("Wrong browser confirmation");
        return { response: 1, checkboxChecked: false };
      };
      shell.openExternal = async (href) => { (globalThis as any).openedReplyLink = href; };
      ipcMain.removeHandler("live-session-preview");
      ipcMain.handle("live-session-preview", (_event, provider, sessionID, terminalId) => {
        if (provider !== "Codex" || sessionID !== terminal.sessionID || terminalId !== terminal.id)
          throw Error("Wrong preview destination");
        return { instruction: "Check the mobile layout.", update: "Ready for the next instruction.",
        answer: "Ready for the next instruction.\n\n- Mobile layout checked\n- Desktop layout is next\n\nSee [Release notes](<Release notes.md>) and the [release site](https://example.test/release)." };
      });
      ipcMain.removeHandler("live-session-follow-up");
      ipcMain.handle("live-session-follow-up", (_event, provider, sessionID, terminalId, text, screenshots) => {
        if (provider !== "Codex" || sessionID !== terminal.sessionID || terminalId !== terminal.id ||
            text !== "Review the desktop layout next." || screenshots.length !== 2 ||
            screenshots.some((image: ArrayBuffer) => new Uint8Array(image)[0] !== 137)) throw Error("Wrong live follow-up destination or message");
      });
    }, liveTerminal);
    await expect(live.locator(".dashboard-briefing dd").filter({ hasText: "Ready for the next instruction." })).toBeVisible();
    const references = live.getByRole("region", { name: "Referenced files and links" });
    await references.getByRole("button", { name: "View Release notes", exact: true }).click();
    const filePreview = page.getByRole("dialog", { name: "File preview" });
    await expect(filePreview.getByRole("heading", { name: "Release checklist" })).toBeVisible();
    await expect(filePreview.getByRole("listitem").filter({ hasText: "Verify the mobile layout." })).toBeVisible();
    await filePreview.getByRole("button", { name: "Close file preview" }).click();
    await references.getByRole("button", { name: "Open release site in RunHuddle Browser" }).click();
    const linkedBrowser = live.getByRole("region", { name: "Browser preview" });
    await expect(linkedBrowser.getByRole("textbox", { name: "Browser address" })).toHaveValue("https://example.test/release");
    await linkedBrowser.getByRole("button", { name: "Close browser preview" }).click();
    await references.getByRole("button", { name: "Open release site in default browser" }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as any).openedReplyLink)).toBe("https://example.test/release");
    await expect(page.evaluate((id) => window.runhuddle.previewProjectFile("Codex", id, "../outside.md"), sessionID))
      .rejects.toThrow("outside the session’s project");
    const viewport = live.locator(".dashboard-live-preview-scroll");
    const switchboard = live.locator(".dashboard-switchboard");
    const panelGap = () => switchboard.evaluate((board) => innerHeight - board.getBoundingClientRect().bottom);
    const projectsControl = dashboard().getByRole("button", { name: "Projects: All projects", exact: true });
    const originalViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    for (const size of [{ width: 800, height: 550 }, { width: 850, height: 640 }, { width: 1470, height: 950 }, originalViewport]) {
      await page.setViewportSize(size);
      await expect.poll(panelGap).toBeGreaterThanOrEqual(0);
      await expect.poll(panelGap).toBeLessThan(12);
      expect(await dashboard().evaluate((element) => element.scrollHeight - element.clientHeight)).toBe(0);
    }
    await projectsControl.click();
    const projectPanel = dashboard().getByRole("group", { name: "Choose projects" });
    await expect(projectPanel.getByRole("searchbox", { name: "Search projects" })).toBeFocused();
    await expect(projectPanel.getByRole("button", { name: "Apply" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(projectsControl).toBeFocused();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(projectPanel.getByRole("searchbox", { name: "Search conversations" })).toBeFocused();
    await expect(projectPanel.getByRole("heading", { name: "Find a project or conversation" })).toHaveCount(0);
    const pickerBounds = (await projectPanel.boundingBox())!;
    expect(Math.abs(pickerBounds.x - (await projectsControl.boundingBox())!.x)).toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape");
    await expect(viewport.getByRole("definition").filter({ hasText: "Ready for the next instruction." })).toBeVisible();
    const switchboardHeight = (await switchboard.boundingBox())!.height;
    const expandDetail = live.getByRole("button", { name: "Expand detail" });
    await page.mouse.move(0, 0);
    await expandDetail.hover();
    await expect.poll(() => expandDetail.evaluate((button) => getComputedStyle(button, "::after").visibility)).toBe("visible");
    await expandDetail.click();
    await expect(viewport.getByText("Desktop layout is next", { exact: true })).toBeVisible();
    expect((await switchboard.boundingBox())!.height).toBe(switchboardHeight);
    await live.getByRole("button", { name: "Collapse detail" }).click();
    await expect(viewport.getByText("Desktop layout is next", { exact: true })).toBeVisible();
    await app.evaluate(({ BrowserWindow }, session) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      for (let i = 1; i <= 6; i++) {
        wc.send("event", { event: "store", sessions: [{ ...session, updated: i + 1, state: "working" }] });
      }
    }, { ...rows[1], terminalId: liveTerminal.id });
    const working = live.getByRole("img", { name: "Working", exact: true });
    await expect(working).toBeVisible();
    const draft = live.getByRole("textbox", { name: /Follow up · Codex fixture/ });
    await draft.fill("Review the desktop layout next.");
    await draft.evaluate((element) => {
      const clipboardData = new DataTransfer();
      clipboardData.items.add(new File([new Uint8Array([137, 80, 78, 71])], "Mobile.png", { type: "image/png" }));
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
    });
    await app.evaluate(({ BrowserWindow, ipcMain }) => {
      ipcMain.removeHandler("screenshot-draft");
      ipcMain.handle("screenshot-draft", (_event, id) => {
        if (id !== "desktop-shot") throw Error("Wrong screenshot");
        return Uint8Array.of(137, 80, 78, 71);
      });
      BrowserWindow.getAllWindows()[0].webContents.send("event", { event: "screenshot",
        screenshot: { id: "desktop-shot", name: "Desktop.png", thumbnail: "" },
      });
    });
    await dashboard().getByRole("button", { name: "Add to follow-up draft" }).click();
    const screenshots = live.getByRole("list", { name: "Draft screenshots" });
    await expect(screenshots.getByRole("listitem")).toHaveCount(2);
    await expect(live.getByRole("button", { name: "Send follow-up" })).toBeDisabled();
    const activityToolbar = live.locator(".dashboard-live-session:visible .dashboard-live-toolbar");
    await expect.poll(() => activityToolbar.evaluate((element) => getComputedStyle(element, "::after").animationName))
      .toBe("dashboard-horizontal-signal");
    const workTimer = activityToolbar.getByRole("timer", { name: "Time working" });
    await expect(workTimer).toHaveText(/^0:[0-5][1-9]$/, { timeout: 4000 });
    const meterBar = dashboard().locator(".dashboard-activity-meter i").first();
    const initialBarColor = await meterBar.evaluate((element) => getComputedStyle(element).backgroundColor);
    const initialStatusColor = await working.evaluate((element) => getComputedStyle(element).color);
    const initialStreak = await activityToolbar.evaluate((element) => getComputedStyle(element, "::after").backgroundImage);
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById("app-accent-Orange");
      if (!item) throw Error("Orange accent is unavailable");
      item.click(item, BrowserWindow.getAllWindows()[0], {} as any);
    });
    await expect.poll(() => meterBar.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(initialBarColor);
    await expect.poll(() => activityToolbar.evaluate((element) => getComputedStyle(element, "::after").backgroundImage)).not.toBe(initialStreak);
    expect(await working.evaluate((element) => getComputedStyle(element).color)).toBe(initialStatusColor);
    const signal = dashboard().locator(".dashboard-masthead-art i").last();
    await expect.poll(() => signal.evaluate((element) => getComputedStyle(element, "::after").animationName))
      .toBe("dashboard-signal");
    await dashboard().locator(".dashboard-masthead").screenshot({ path: "test-results/preview-huddle-working.png" });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(() => signal.evaluate((element) => getComputedStyle(element, "::after").animationName)).toBe("none");
    await expect.poll(() => activityToolbar.evaluate((element) => getComputedStyle(element, "::after").animationName)).toBe("none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await app.evaluate(({ BrowserWindow }, session) => {
      BrowserWindow.getAllWindows()[0].webContents.send("event", { event: "store", sessions: [session] });
    }, { ...rows[1], terminalId: liveTerminal.id, state: "idle", updated: 8 });
    await expect(live.locator(".dashboard-briefing dd").filter({ hasText: "Ready for the next instruction." })).toBeVisible();
    await expect(live.getByText("Loading preview…")).toHaveCount(0);
    expect((await switchboard.boundingBox())!.height).toBe(switchboardHeight);
    await expect(activityToolbar).toHaveAttribute("data-working", "false");
    await expect(workTimer).toHaveCount(0);

    await live.getByRole("button", { name: "Send follow-up" }).click();
    await expect(live.getByText("Follow-up sent to Codex fixture.")).toBeVisible();
    await expect(live.locator(".dashboard-briefing dd").filter({ hasText: "Review the desktop layout next." })).toBeVisible();
    await expect(live.getByText("Waiting for the agent’s next recorded update.", { exact: true })).toBeVisible();
    await expect(live.getByText("2 screenshots attached", { exact: true })).toBeVisible();
    await expect(screenshots).toHaveCount(0);
    await expect(live.getByRole("button", { name: "Open in workspace", exact: true })).toBeVisible();
    await expect(live.getByRole("button", { name: "Rename session…", exact: true })).toBeVisible();
    await live.getByRole("button", { name: "Session actions", exact: true }).click();
    await live.getByRole("button", { name: "Hide tab (keep running)" }).click();
    await expect(live.locator(".dashboard-live-toolbar:visible").getByText("Tab hidden", { exact: true })).toBeVisible();
    await live.getByRole("button", { name: "Changes", exact: true }).click();
    await expect(live.getByRole("button", { name: "Open in workspace", exact: true })).toBeVisible();
    await live.getByRole("button", { name: "Session actions", exact: true }).click();
    await live.getByRole("button", { name: /End session/ }).click();
    await expect(live.getByRole("button", { name: "End Codex fixture" })).toBeVisible();
    await live.getByRole("button", { name: "Cancel" }).click();
    await page.keyboard.press("Escape");
    await live.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(live.locator(".dashboard-live-toolbar:visible")).toContainText("Codex fixture");
    const secondTerminal = { ...liveTerminal, id: "fixture-claude-terminal", agent: "claude", title: "Claude fixture" };
    const extraTerminals = Array.from({ length: 4 }, (_, index) => ({
      ...liveTerminal, id: `attention-extra-${index}`,
      sessionID: `11111111-2222-4333-8444-00000000000${index}`,
      title: index === 0 ? "Second attention request" : `Background session ${index}`,
    }));
    const updateAttentionFixture = (extras = extraTerminals) => app.evaluate(({ BrowserWindow }, { first, second, fixtureRows, extras }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      wc.send("event", { event: "terminals", terminals: [first, second, ...extras] });
      wc.send("event", { event: "store", sessions: [
        { ...fixtureRows[1], terminalId: first.id, state: "idle" },
        { ...fixtureRows[0], terminalId: second.id, state: "needsInput" },
        ...extras.map((terminal, index) => ({ ...fixtureRows[1], terminalId: terminal.id, sessionID: terminal.sessionID,
          title: terminal.title, state: index === 0 ? "needsInput" : "working" })),
      ] });
      wc.send("event", { event: "inbox", entries: [{
        id: "input:Claude:" + second.sessionID, kind: "input", provider: "Claude", sessionID: second.sessionID,
        body: second.title, createdAt: Date.now(),
      }] });
    }, { first: liveTerminal, second: secondTerminal, fixtureRows: rows, extras });
    await app.evaluate(({ ipcMain }, first) => {
      ipcMain.removeHandler("git-changes");
      ipcMain.handle("git-changes", (_event, _cwd, mode) => ({ root: first.cwd, branch: "main",
        files: mode === "compare" ? Array.from({ length: 434 }, (_, i) => ({ path: `file-${i}.txt`, status: "M", area: "committed" }))
          : [{ path: "fixture.txt", status: "M", area: "unstaged" }] }));
      ipcMain.removeHandler("git-diff");
      ipcMain.handle("git-diff", () => "@@ -1,1 +1,200 @@\n" +
        Array.from({ length: 200 }, (_, i) => "+ line " + i).join("\n"));
    }, liveTerminal);
    await updateAttentionFixture();
    await expect(live.getByRole("navigation", { name: "Live session list" }).getByRole("button", { name: /^Inspect / })).toHaveCount(6);
    const originalDraft = live.getByRole("textbox", { name: /Follow up · Codex fixture/ });
    await originalDraft.fill("Keep this draft while I handle two requests.");
    await live.getByRole("button", { name: "Changes", exact: true }).click();
    const changesPane = live.getByRole("complementary", { name: "Workspace changes" });
    await changesPane.getByRole("button", { name: "vs main", exact: true }).click();
    await expect(changesPane.getByText("Committed · 434")).toBeVisible();
    await changesPane.locator(".changes-repo").hover();
    const dashboardScrollTop = () => dashboard().evaluate((element) => element.scrollTop);
    const listPagePosition = await dashboardScrollTop();
    await page.mouse.wheel(0, 400);
    await expect.poll(() => changesPane.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await dashboardScrollTop()).toBe(listPagePosition);
    await changesPane.getByRole("button", { name: "Uncommitted", exact: true }).click();
    await live.getByRole("button", { name: "M fixture.txt", exact: true }).click();
    const diff = live.getByLabel("File diff", { exact: true });
    await expect(diff.getByText("+ line 199", { exact: true })).toBeVisible();
    await diff.hover();
    const diffPagePosition = await dashboardScrollTop();
    await page.mouse.wheel(0, 250);
    await expect.poll(() => diff.evaluate((element) => element.scrollTop)).toBe(250);
    expect(await dashboardScrollTop()).toBe(diffPagePosition);
    await diff.evaluate((element) => { element.scrollTop = 0; });
    await page.mouse.wheel(0, -160);
    expect(await dashboardScrollTop()).toBe(diffPagePosition);
    await diff.evaluate((element) => { element.scrollTop = 250; });
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("browser-capture");
      ipcMain.handle("browser-capture", () => ({ file: "/tmp/Local Build Report.md" }));
      ipcMain.removeHandler("browser-state");
      ipcMain.handle("browser-state", () => ({
        url: "http://localhost:3000/", title: "Local build fixture", loading: false, ready: true,
        back: false, forward: false, agentSession: null, error: "",
      }));
    });
    await live.getByRole("button", { name: "Browser", exact: true }).click();
    const liveBrowser = live.getByRole("region", { name: "Browser preview" });
    const buildAddress = liveBrowser.getByRole("textbox", { name: "Browser address" });
    await expect(buildAddress).toHaveValue("http://localhost:3000/");
    await dashboard().getByRole("button", { name: "Next attention", exact: true }).click();
    await expect(live.getByRole("button", { name: "Inspect Review layout" })).toHaveAttribute("aria-current", "true");
    await expect(diff).toBeHidden();
    const backToChanges = live.getByRole("button", { name: "Back to Codex fixture · Changes", exact: true });
    await expect(backToChanges).toBeVisible();
    await dashboard().getByRole("button", { name: "Next attention", exact: true }).click();
    await expect(live.getByRole("button", { name: "Inspect Second attention request" })).toHaveAttribute("aria-current", "true");
    await expect(backToChanges).toBeVisible();
    await backToChanges.click();
    await expect(backToChanges).toHaveCount(0);
    await expect(diff).toBeVisible();
    await expect.poll(() => diff.evaluate((element) => element.scrollTop)).toBe(250);
    await expect(buildAddress).toHaveValue("http://localhost:3000/");
    await projectsControl.click();
    await expect(projectPanel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(diff).toBeVisible();
    await expect.poll(() => diff.evaluate((element) => element.scrollTop)).toBe(250);
    await live.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(originalDraft).toHaveValue("Keep this draft while I handle two requests.");
    await liveBrowser.getByRole("button", { name: "Share page with Codex fixture" }).click();
    await expect(originalDraft).toHaveValue('Keep this draft while I handle two requests. Inspect the page screenshot, visible text, and console diagnostics in "/tmp/Local Build Report.md"');
    await liveBrowser.getByRole("button", { name: "Close browser preview" }).click();
    await expect(liveBrowser).toHaveCount(0);
    await originalDraft.clear();
    await live.getByRole("button", { name: "Changes", exact: true }).click();
    await updateAttentionFixture([]);
    await app.evaluate(({ ipcMain }, id) => {
      const writes: string[] = [];
      (globalThis as any).dashboardTerminalWrites = writes;
      const resizes: number[][] = [];
      (globalThis as any).dashboardTerminalResizes = resizes;
      ipcMain.removeHandler("replay");
      const tail = "\x1b[6nRecorded terminal output";
      ipcMain.handle("replay", () => ({ data: " ".repeat(512 * 1024 - tail.length) + tail, sequence: 1, cols: 100, rows: 30 }));
      ipcMain.removeHandler("write");
      ipcMain.handle("write", (_event, target, data) => {
        if (target === id) writes.push(data);
      });
      ipcMain.removeHandler("resize");
      ipcMain.handle("resize", (_event, target, cols, rows) => { if (target === id) resizes.push([cols, rows]); });
    }, liveTerminal.id);
    await live.getByRole("button", { name: "Terminal", exact: true }).click();
    const dashboardTerminal = live.getByLabel("Terminal", { exact: true });
    await expect(dashboardTerminal).toBeVisible();
    await expect(live.getByRole("button", { name: "Open in workspace", exact: true })).toBeVisible();
    await expect(live.getByRole("button", { name: "Rename session…", exact: true })).toBeVisible();
    const terminalScreen = dashboardTerminal.locator(".xterm-screen");
    const terminalSlider = dashboardTerminal.locator(".scrollbar.vertical .slider");
    await expect.poll(() => app.evaluate(() => (globalThis as any).dashboardTerminalResizes.length)).toBeGreaterThanOrEqual(2);
    await sendScreen(900100, "\x1b[3J\x1b[2J\x1b[H" +
      Array.from({ length: 150 }, (_, index) => `Terminal scroll line ${index}`).join("\r\n"));
    await expect.poll(() => terminalSlider.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(35);
    await terminalScreen.hover();
    const sliderTop = () => terminalSlider.evaluate((element) => parseFloat((element as HTMLElement).style.top));
    await expect.poll(sliderTop).toBeGreaterThan(0);
    const bottom = await sliderTop();
    const terminalPagePosition = await dashboardScrollTop();
    await page.mouse.wheel(0, -400);
    await expect.poll(sliderTop).toBeLessThan(bottom);
    await page.mouse.wheel(0, 800);
    await expect.poll(sliderTop).toBeGreaterThanOrEqual(bottom);
    await page.mouse.wheel(0, 600);
    expect(await dashboardScrollTop()).toBe(terminalPagePosition);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("history");
      ipcMain.handle("history", () => ({
        messages: Array.from({ length: 30 }, (_, index) => ({ role: "assistant", text: `Recorded message ${index}`, time: "" })),
        truncated: false,
      }));
    });
    await sendScreen(900101, "\x1b[3J\x1b[2J\x1b[H\x1b[4;1HCursor-addressed Codex output");
    await expect.poll(() => terminalSlider.evaluate((element) => {
      const track = element.parentElement!;
      return element.getBoundingClientRect().height >= track.getBoundingClientRect().height - 1;
    })).toBe(true);
    await terminalScreen.hover();
    await page.mouse.wheel(0, -400);
    const terminalHistory = live.getByRole("region", { name: "Conversation history" });
    await expect(dashboardTerminal).toBeVisible();
    await expect(terminalHistory).toHaveCount(0);
    await live.getByRole("button", { name: "Conversation history", exact: true }).click();
    await expect(terminalHistory.getByText("Recorded message 29", { exact: true })).toBeVisible();
    const historyTop = () => terminalHistory.evaluate((element) => element.scrollTop);
    await terminalHistory.hover();
    await expect.poll(historyTop).toBeGreaterThan(0);
    const historyBottom = await historyTop();
    await page.mouse.wheel(0, -400);
    await expect.poll(historyTop).toBeLessThan(historyBottom);
    await live.getByRole("button", { name: "Back to terminal", exact: true }).click();
    await expect(dashboardTerminal).toBeVisible();
    await app.evaluate(({ BrowserWindow }, id) => {
      BrowserWindow.getAllWindows()[0].webContents.send("event", {
        event: "output", id, sequence: 1000000,
        data: "\x1b[2J\x1b[HWould you like to run the following command?\r\n" +
          "  › 1. Yes, proceed\r\n    2. No, and tell Codex what to do differently\r\n",
      });
    }, liveTerminal.id);
    await expect(live.getByRole("img", { name: "Permission required" })).toBeVisible();
    await live.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(live.getByRole("list", { name: "Permission choices" }).getByRole("listitem"))
      .toHaveText(["Yes, proceed", "No, and tell Codex what to do differently"]);
    const otherRow = live.getByRole("button", { name: "Inspect Review layout" });
    await otherRow.click({ button: "right" });
    const rowMenu = dashboard().locator(".dashboard-row-context:popover-open");
    await expect(rowMenu.getByRole("button", { name: "Rename session…", exact: true })).toBeVisible();
    await expect(live.getByRole("button", { name: "Inspect Codex fixture" })).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("Escape");
    await expect(rowMenu).toHaveCount(0);
    await live.getByRole("button", { name: "Inspect Review layout" }).click();
    await live.getByRole("button", { name: "Changes", exact: true }).click();
    await live.getByRole("button", { name: "M fixture.txt", exact: true }).click();
    const interruptedDiff = live.locator(".dashboard-live-session:visible").getByLabel("File diff", { exact: true });
    await expect(interruptedDiff.getByText("+ line 199", { exact: true })).toBeVisible();
    await interruptedDiff.evaluate((element) => { element.scrollTop = 180; });
    await live.getByRole("button", { name: "Hide session list", exact: true }).click();
    await expect(live.getByRole("navigation", { name: "Live session list" })).toHaveCount(0);
    await dashboard().getByRole("button", { name: "Next attention", exact: true }).click();
    await expect(live.getByRole("navigation", { name: "Live session list" })).toBeVisible();
    await expect(live.getByRole("button", { name: "Inspect Codex fixture" })).toHaveAttribute("aria-current", "true");
    await expect(live.getByRole("button", { name: "Terminal", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(live.getByLabel("Terminal", { exact: true })).toBeVisible();
    await app.evaluate(({ BrowserWindow }, id) => {
      BrowserWindow.getAllWindows()[0].webContents.send("event", {
        event: "output", id, sequence: 1000001, data: "\x1b[2J\x1b[HWorking",
      });
    }, liveTerminal.id);
    await expect(live.getByRole("img", { name: "Permission required" })).toHaveCount(0);
    await expect.poll(async () => {
      const sizes = await app.evaluate(() => (globalThis as any).dashboardTerminalResizes as number[][]);
      return sizes.length >= 2 && sizes[0][0] === sizes[1][0] && Math.abs(sizes[0][1] - sizes[1][1]) === 1;
    }).toBe(true);
    expect(await app.evaluate(() => (globalThis as any).dashboardTerminalWrites)).toEqual([]);
    const terminalInput = live.locator(".dashboard-inline-terminal .xterm-helper-textarea:visible");
    await terminalInput.press("x");
    await expect.poll(() => app.evaluate(() => (globalThis as any).dashboardTerminalWrites)).toEqual(["x"]);
    await dashboard().getByRole("button", { name: "Next attention", exact: true }).focus();
    await page.keyboard.press("Alt+Shift+ArrowLeft");
    await expect(interruptedDiff).toBeVisible();
    await expect.poll(() => interruptedDiff.evaluate((element) => element.scrollTop)).toBe(180);
    await dashboard().getByRole("button", { name: "Open workspace", exact: true }).click();
    await expect(dashboard()).toBeHidden();
    await page.getByRole("button", { name: "Project dashboard", exact: true }).click();
    await expect(interruptedDiff).toBeVisible();
    await expect.poll(() => interruptedDiff.evaluate((element) => element.scrollTop)).toBe(180);
    await live.getByRole("button", { name: "Inspect Codex fixture" }).click();
    await live.getByRole("button", { name: "Preview", exact: true }).click();
    const unsent = live.getByRole("textbox", { name: /Follow up · Codex fixture/ });
    await unsent.fill("Keep this draft while I switch.");
    await unsent.evaluate((element) => {
      const clipboardData = new DataTransfer();
      clipboardData.items.add(new File(["fixture"], "Switch.png", { type: "image/png" }));
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
    });
    await live.getByRole("button", { name: "Inspect Review layout" }).click();
    await expect(screenshots).toHaveCount(0);
    await live.getByRole("button", { name: "Inspect Codex fixture" }).click();
    await expect(unsent).toHaveValue("Keep this draft while I switch.");
    await expect(screenshots.getByText("Switch.png")).toBeVisible();
    await dashboard().getByRole("button", { name: "Open workspace", exact: true }).click();
    await page.getByRole("button", { name: "Project dashboard", exact: true }).click();
    await expect(unsent).toHaveValue("Keep this draft while I switch.");
    await expect(screenshots.getByText("Switch.png")).toBeVisible();
    await dashboard().getByRole("button", { name: "New session", exact: true }).click();
    await launcher.getByRole("combobox", { name: "Launch folder" }).selectOption(dir);
    await launcher.getByLabel("Session name", { exact: false }).fill("Security review");
    await app.evaluate(({ ipcMain }, cwd) => {
      ipcMain.removeHandler("create");
      ipcMain.handle("create", () => ({
        id: "named-launch-fixture", cwd, agent: "codex", title: "<environment_context>", exited: false,
        sessionID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }));
    }, dir);
    await launcher.getByRole("button", { name: /^Start Codex/ }).click();
    await expect(dashboard()).toBeVisible();
    await expect(live.locator(".dashboard-live-toolbar:visible")).toContainText("Security review");
    await live.getByRole("button", { name: "Open in workspace", exact: true }).click();
    await expect(page.getByRole("tab", { name: /Security review/ })).toBeVisible();
    await page.locator(".folder-actions").getByLabel("Session actions", { exact: true }).click();
    await page.getByRole("button", { name: "Rename session…", exact: true }).click();
    const rename = page.getByRole("dialog", { name: "Rename session" });
    const sessionName = rename.getByLabel("Session name", { exact: true });
    await expect(sessionName).toHaveValue("Security review");
    await sessionName.fill("Checkout security");
    await rename.getByRole("button", { name: "Save name", exact: true }).click();
    await expect(page.getByRole("tab", { name: /Checkout security/ })).toBeVisible();
    await page.locator(".folder-actions").getByLabel("Session actions", { exact: true }).click();
    await page.getByRole("button", { name: "Rename session…", exact: true }).click();
    await sessionName.fill("");
    await rename.getByRole("button", { name: "Save name", exact: true }).click();
    await expect(page.getByRole("tab", { name: /Checkout security/ })).toHaveCount(0);
    await expect(page.getByRole("tab", { selected: true })).toContainText("Codex session");

    await page.getByRole("button", { name: "Project dashboard", exact: true }).click();
    await live.getByRole("button", { name: "Inspect Codex fixture" }).click();
    await live.getByRole("button", { name: "Changes", exact: true }).click();
    const currentDiff = live.locator(".dashboard-live-session:visible").getByLabel("File diff", { exact: true });
    await expect(currentDiff.getByText("+ line 199", { exact: true })).toBeVisible();
    await currentDiff.evaluate((element) => { element.scrollTop = 310; });
    await expect.poll(() => currentDiff.evaluate((element) => element.scrollTop)).toBe(310);
    await closeUI(app);
    app = await electron.launch(launch);
    page = await workspacePage(app, true);
    const restoredTerminal = { ...liveTerminal, id: "reattached-codex-terminal" };
    await app.evaluate(({ BrowserWindow, ipcMain }, { terminal, row }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      ipcMain.removeHandler("git-changes");
      ipcMain.handle("git-changes", () => ({ root: terminal.cwd, branch: "main",
        files: [{ path: "fixture.txt", status: "M", area: "unstaged" }] }));
      ipcMain.removeHandler("git-diff");
      ipcMain.handle("git-diff", () => "@@ -1,1 +1,200 @@\n" +
        Array.from({ length: 200 }, (_, i) => "+ line " + i).join("\n"));
      ipcMain.removeHandler("live-session-follow-up");
      ipcMain.handle("live-session-follow-up", (_event, provider, sessionID, terminalId, text, images) => {
        if (provider !== row.provider || sessionID !== row.sessionID || terminalId !== terminal.id ||
            text !== "Keep this draft while I switch." || images.length !== 1 ||
            Buffer.from(images[0]).toString() !== "fixture") throw Error("Restored draft did not match");
      });
      wc.send("event", { event: "terminals", terminals: [terminal] });
      wc.send("event", { event: "store", sessions: [{ ...row, terminalId: terminal.id, state: "idle" }] });
    }, { terminal: restoredTerminal, row: rows[1] });
    const restoredLive = dashboard().getByRole("region", { name: "Live sessions" });
    const restoredSession = restoredLive.getByRole("button", { name: "Inspect Codex fixture" });
    const restoredHeader = restoredLive.locator(".dashboard-live-toolbar:visible");
    await expect(restoredHeader.getByText("Draft", { exact: true })).toBeVisible();
    await expect(restoredLive.getByRole("navigation", { name: "Live session list" })).toHaveCount(0);
    await expect(restoredLive.getByRole("button", { name: "Changes", exact: true })).toHaveAttribute("aria-pressed", "true");
    const restoredDiff = restoredLive.getByLabel("File diff", { exact: true });
    await expect(restoredDiff.getByText("+ line 199", { exact: true })).toBeVisible();
    await expect.poll(() => restoredDiff.evaluate((element) => element.scrollTop)).toBe(310);
    await restoredLive.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(restoredLive.getByRole("textbox", { name: /Follow up · Codex fixture/ }))
      .toHaveValue("Keep this draft while I switch.");
    await expect(restoredLive.getByRole("list", { name: "Draft screenshots" }).getByText("Switch.png")).toBeVisible();
    await restoredLive.getByRole("button", { name: "Send follow-up" }).click();
    await expect(restoredLive.getByText("Follow-up sent to Codex fixture.")).toBeVisible();
    await expect(restoredHeader.getByText("Draft", { exact: true })).toHaveCount(0);
    const queueReview = (id: string) => app.evaluate(({ BrowserWindow, ipcMain }, { id, row }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      ipcMain.removeHandler("inbox-action");
      ipcMain.handle("inbox-action", (_event, entryID, action) => {
        if (entryID !== id || action !== "dismiss") throw Error("Wrong review acknowledged");
        (globalThis as any).acknowledgedReview = id;
        wc.send("event", { event: "inbox", entries: [] });
        return true;
      });
      ipcMain.removeHandler("live-session-preview");
      ipcMain.handle("live-session-preview", () => ({
        instruction: "Keep this draft while I switch.",
        answer: "The new reply is ready.",
        instructionAt: Date.now(),
      }));
      wc.send("event", { event: "inbox", entries: [{
        id, kind: "completion", provider: row.provider, sessionID: row.sessionID, createdAt: Date.now(),
      }] });
    }, { id, row: rows[1] });
    await restoredLive.getByRole("button", { name: "Changes", exact: true }).click();
    await queueReview("review-in-changes");
    const reviewButton = dashboard().getByRole("button", { name: "Next review", exact: true });
    await expect(reviewButton).toBeEnabled();
    await restoredLive.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(restoredLive.getByRole("definition").filter({ hasText: "The new reply is ready." })).toBeVisible();
    await expect(reviewButton).toBeDisabled();
    await queueReview("review-while-viewing");
    await expect.poll(() => app.evaluate(() => (globalThis as any).acknowledgedReview)).toBe("review-while-viewing");
    await expect(reviewButton).toBeDisabled();

    const otherTerminal = { ...secondTerminal, cwd: anotherFolder };
    const thirdFolder = path.join(dir, "release-notes");
    fs.mkdirSync(thirdFolder);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const scopedRows = [
      { ...rows[1], terminalId: restoredTerminal.id, state: "idle" },
      { ...rows[0], cwd: otherTerminal.cwd, terminalId: otherTerminal.id, state: "needsInput", title: "Other project session" },
      { ...stale[0], sessionID: "abababab-abab-4bab-8bab-abababababab", title: "Saved project checkpoint" },
      { ...stale[0], sessionID: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", cwd: thirdFolder, title: "Release checkpoint" },
      { ...stale[0], sessionID: "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "Today’s conversation", updated: +today / 1000 },
      { ...stale[0], sessionID: "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb", title: "Yesterday’s conversation", updated: +yesterday / 1000 },
    ];
    await app.evaluate(({ BrowserWindow }, { terminals, sessions }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      wc.send("event", { event: "terminals", terminals });
      wc.send("event", { event: "store", sessions });
    }, { terminals: [restoredTerminal, otherTerminal], sessions: scopedRows });
    const showStatus = (state: string) => app.evaluate(({ BrowserWindow }, sessions) => {
      BrowserWindow.getAllWindows()[0].webContents.send("event", { event: "store", sessions });
    }, [{ ...scopedRows[0], state }, ...scopedRows.slice(1)]);
    await showStatus("disconnected");
    await expect(restoredSession.getByRole("img", { name: "Status unknown" })).toBeVisible();
    const statusTimes = restoredLive.getByRole("navigation", { name: "Live session list" }).locator("time");
    await expect(statusTimes).toHaveCount(2);
    const timestampEdges = await statusTimes.evaluateAll((items) => items.map((item) => item.getBoundingClientRect().right));
    expect(timestampEdges[0]).toBeCloseTo(timestampEdges[1], 1);
    await expect(restoredLive.getByText("Terminal still open", { exact: true })).toBeVisible();
    await expect(restoredLive.getByRole("button", { name: "Send follow-up" })).toBeDisabled();
    await restoredLive.getByRole("button", { name: "Check terminal", exact: true }).click();
    await expect(restoredLive.getByRole("button", { name: "Terminal", exact: true })).toHaveAttribute("aria-pressed", "true");
    await showStatus("idle");
    await restoredLive.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(restoredLive.getByRole("button", { name: "Check terminal", exact: true })).toHaveCount(0);
    const scope = (label: string) => dashboard().getByRole("button", { name: `Projects: ${label}`, exact: true });
    const picker = () => dashboard().getByRole("group", { name: "Choose projects" });
    const nextAttention = dashboard().getByRole("button", { name: "Next attention", exact: true });
    await expect(nextAttention).toBeEnabled();
    const openProjectFromPicker = async (project: string) => {
      await scope("All projects").click();
      await picker().getByRole("button", { name: `Focus project ${project}`, exact: true }).click();
    };
    await app.evaluate(({ ipcMain }, folder) => {
      ipcMain.removeHandler("installed-review-agents");
      (globalThis as any).installedReviewAgents = ["codex"];
      ipcMain.handle("installed-review-agents", () => (globalThis as any).installedReviewAgents);
      ipcMain.removeHandler("review-project-history");
      ipcMain.handle("review-project-history", (_event, requestedFolder, agent) => {
        if (requestedFolder !== folder || agent !== "codex") throw Error("Wrong review request");
        return { reviewed: 23, total: 23, suggestions: [{
          next: "Verify the release checklist.", updated: 0.5,
          source: { provider: "Codex", sessionID: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            title: "Release checkpoint", snippet: "The release checklist still needs verification.",
            anchor: { offset: 0, textOffset: 0, fingerprint: "a".repeat(24) } },
        }] };
      });
    }, thirdFolder);
    await dashboard().getByRole("button", { name: "Open workspace" }).click();
    await page.getByRole("button", { name: "Project dashboard", exact: true }).click();
    await app.evaluate(({ ipcMain }, { liveID, releaseID }) => {
      ipcMain.removeHandler("history");
      ipcMain.handle("history", (_event, _provider, id) => ({
        messages: id === liveID || id === releaseID ? [
          { role: "user", text: "Check the release checklist.", time: "" },
          { role: "assistant", text: "The checklist is ready for review.", time: "" },
        ] : [],
        truncated: false,
        unavailable: id !== liveID && id !== releaseID,
      }));
    }, { liveID: scopedRows[0].sessionID, releaseID: scopedRows[3].sessionID });
    await app.evaluate(({ BrowserWindow, ipcMain }, id) => {
      ipcMain.removeHandler("set-history-hidden");
      ipcMain.handle("set-history-hidden", (_event, kind, ids, hide) => {
        if (kind !== "sessions" || ids.length !== 1 || ids[0] !== id) throw Error("Wrong hide target");
        BrowserWindow.getAllWindows()[0].webContents.send("event", {
          event: "store", hidden: { projects: [], sessions: hide ? [id] : [] },
        });
        return [id];
      });
    }, scopedRows[3].provider + ":" + scopedRows[3].sessionID);
    const recentOriginDraft = restoredLive.getByRole("textbox", { name: /Follow up · Codex fixture/ });
    await recentOriginDraft.fill("Keep my place while browsing Recent.");
    await restoredLive.getByRole("button", { name: "Changes", exact: true }).click();
    await expect(restoredDiff).toBeVisible();
    await restoredDiff.evaluate((element) => { element.scrollTop = 310; });
    await app.evaluate(({ ipcMain }, cwd) => {
      ipcMain.removeHandler("create");
      ipcMain.handle("create", (_event, folder, agent) => {
        if (folder !== cwd || agent !== "shell") throw Error("Quick Terminal used the wrong project folder");
        return { id: "quick-toolbar-fixture", cwd, agent, title: "Quick Terminal", exited: false };
      });
      ipcMain.removeHandler("replay");
      ipcMain.handle("replay", () => ({ data: "$ ", sequence: 0, cols: 80, rows: 24 }));
    }, dir);
    const quickOverlay = page.getByRole("dialog", { name: "Quick Terminal" });
    await restoredDiff.focus();
    await page.keyboard.press("ControlOrMeta+t");
    await expect(quickOverlay.locator(".xterm-helper-textarea")).toBeFocused();
    await expect(quickOverlay.locator("header small")).toHaveText(dir);
    await page.keyboard.press("ControlOrMeta+t");
    await expect(restoredDiff).toBeFocused();
    await expect.poll(() => restoredDiff.evaluate((element) => element.scrollTop)).toBe(310);
    await restoredLive.getByRole("button", { name: "Preview", exact: true }).click();
    await recentOriginDraft.focus();
    await page.keyboard.press("ControlOrMeta+t");
    await expect(quickOverlay.locator(".xterm-helper-textarea")).toBeFocused();
    await page.keyboard.press("ControlOrMeta+t");
    await expect(recentOriginDraft).toBeFocused();
    await expect(recentOriginDraft).toHaveValue("Keep my place while browsing Recent.");
    await restoredLive.getByRole("button", { name: "Changes", exact: true }).click();
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById("dashboard-recent");
      if (!item) throw Error("Recent Sessions menu item missing");
      item.click(item, BrowserWindow.getAllWindows()[0], {} as any);
    });
    const recentPanel = dashboard().getByRole("group", { name: "Recent sessions" });
    await expect(recentPanel.getByRole("region", { name: "Live", exact: true }).getByRole("button", { name: /Codex fixture/ })).toBeVisible();
    await expect(recentPanel.getByRole("region", { name: "Today", exact: true })).toContainText("Today’s conversation");
    await expect(recentPanel.getByRole("region", { name: "Yesterday", exact: true })).toContainText("Yesterday’s conversation");
    const recentRows = recentPanel.locator(".dashboard-picker-session");
    const icons = await recentRows.locator(".agent-icon").evaluateAll((items) =>
      items.map((item) => ({ width: item.getBoundingClientRect().width, left: item.getBoundingClientRect().left })));
    expect(icons.every((icon) => icon.width === 23 && icon.left === icons[0].left)).toBe(true);
    const recentFilter = recentPanel.getByRole("searchbox", { name: "Filter recent sessions" });
    await expect(recentFilter).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath("01-recent-list.png") });
    await recentFilter.fill("nothing matches this");
    await expect(recentPanel.getByText("No matching sessions.")).toBeVisible();
    await recentFilter.clear();
    await expect(recentPanel.getByRole("region", { name: "Today", exact: true }).locator("time")).toBeVisible();
    const recentDialog = page.getByRole("dialog", { name: "Recent session details" });
    const earlier = recentPanel.getByRole("region", { name: "Earlier", exact: true });
    const recentRelease = earlier.getByRole("button", { name: /Release checkpoint/ });
    await recentPanel.getByRole("region", { name: "Live", exact: true }).getByRole("button", { name: /Codex fixture/ }).click();
    await expect(recentDialog.getByRole("button", { name: "Read conversation" })).toBeVisible();
    await recentDialog.getByRole("button", { name: "Read conversation" }).click();
    await expect(recentDialog.getByRole("region", { name: "Conversation history" })).toBeVisible();
    await expect(recentDialog.getByRole("searchbox", { name: "Find in conversation" })).toBeVisible();
    await expect(recentDialog.getByText("The checklist is ready for review.", { exact: true })).toBeVisible();
    await recentDialog.getByRole("button", { name: "Back to summary" }).click();
    await expect(recentDialog.getByRole("button", { name: "Open live session" })).toBeVisible();
    await page.keyboard.press("Escape");
    await recentFilter.fill("release");
    await recentRelease.click();
    await expect(recentDialog.getByRole("heading", { name: "Release checkpoint" })).toBeVisible();
    await expect(recentDialog.getByText(/release-notes · Codex/)).toBeVisible();
    await expect(recentDialog.getByText("The checklist is ready for review.", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("02-session-details.png") });
    const sessionActions = recentDialog.getByRole("button", { name: "Session actions", exact: true });
    const hideFromHistory = recentDialog.getByRole("button", { name: "Hide from history", exact: true });
    await expect(hideFromHistory).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("02b-session-actions.png") });
    await hideFromHistory.click();
    await expect(recentDialog).toHaveCount(0);
    await expect(recentFilter).toHaveValue("release");
    await expect(recentPanel.getByRole("status")).toHaveText("Hidden from history · Release checkpoint");
    await expect(recentRelease).toHaveCount(0);
    await recentPanel.getByRole("button", { name: "Undo hide", exact: true }).click();
    await recentRelease.click();
    await page.keyboard.press("Escape");
    await expect(recentFilter).toHaveValue("release");
    await expect(recentRelease).toBeFocused();
    await recentRelease.click();
    await recentDialog.getByRole("button", { name: "Close recent session details" }).click();
    await expect(scope("All projects")).toBeVisible();
    await expect(restoredLive).toBeVisible();
    await expect(restoredDiff).toBeVisible();
    await expect.poll(() => restoredDiff.evaluate((element) => element.scrollTop)).toBe(310);
    await restoredLive.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(recentOriginDraft).toHaveValue("Keep my place while browsing Recent.");
    await recentOriginDraft.clear();
    await dashboard().getByRole("button", { name: "Recent", exact: true }).click();
    await recentRelease.click();
    await recentDialog.getByRole("button", { name: "View project", exact: true }).click();
    await expect(scope("release-notes")).toBeVisible();
    await expect(dashboard().getByRole("region", { name: "Saved conversations" })).toBeVisible();
    await expect(dashboard().getByRole("region", { name: "Conversation preview" })
      .getByText("The checklist is ready for review.", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("03-project-history.png") });
    await dashboard().getByRole("button", { name: /Back to Recent/ }).click();
    await expect(scope("All projects")).toBeVisible();
    await expect(recentRelease).toBeFocused();
    await page.keyboard.press("Escape");
    await scope("All projects").click();
    await picker().getByRole("button", { name: "Expand release-notes sessions" }).click();
    await picker().getByRole("group", { name: "release-notes sessions" })
      .getByRole("button", { name: /Release checkpoint/ }).click();
    await expect(dashboard().getByRole("region", { name: "Conversation preview" })
      .getByRole("heading", { name: "Release checkpoint" })).toBeVisible();
    await dashboard().getByRole("button", { name: "AI history review", exact: true }).click();
    const projectHistory = dashboard().getByRole("region", { name: "Saved conversations" });
    await expect(projectHistory.getByRole("button", { name: "Change agent", exact: true })).toHaveCount(0);
    await projectHistory.getByRole("button", { name: "Review with Codex", exact: true }).click();
    await expect(projectHistory.getByText("Reviewed 23 of 23 saved conversations")).toBeVisible();
    await expect(projectHistory.getByText("Verify the release checklist.", { exact: true })).toBeVisible();
    await expect(projectHistory.getByRole("button", { name: "View source in Release checkpoint" })).toBeVisible();
    await app.evaluate(() => { (globalThis as any).installedReviewAgents = ["codex", "claude"]; });
    await dashboard().getByRole("button", { name: "Open workspace" }).click();
    await page.getByRole("button", { name: "Project dashboard", exact: true }).click();
    await projectHistory.getByRole("button", { name: "Change agent", exact: true }).click();
    await projectHistory.getByLabel("Preferred review agent").selectOption("claude");
    await expect(projectHistory.getByRole("button", { name: "Review again with Claude", exact: true })).toBeVisible();
    const projectView = dashboard().getByRole("group", { name: "Project view" });
    await expect(projectView.getByRole("button", { name: "History", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(dashboard().getByRole("region", { name: "Saved conversations" })
      .getByRole("button", { name: "Preview Release checkpoint", exact: true })).toBeVisible();
    await projectView.getByRole("button", { name: "Live", exact: true }).click();
    await expect(restoredLive.getByRole("button", { name: "Start a session", exact: true })).toBeVisible();
    await restoredLive.getByRole("button", { name: "Browse saved conversations" }).click();
    await expect(projectView.getByRole("button", { name: "History", exact: true })).toHaveAttribute("aria-pressed", "true");
    await dashboard().getByRole("button", { name: /Show all projects/ }).click();
    await openProjectFromPicker(path.basename(dir));
    await expect(scope(path.basename(dir))).toBeVisible();
    await projectView.getByRole("button", { name: "Live", exact: true }).click();
    await expect(restoredLive.getByRole("button", { name: "Inspect Other project session" })).toHaveCount(0);
    await expect(nextAttention).toBeDisabled();
    const clearScope = dashboard().getByRole("button", { name: /Show all projects/ });
    await expect(clearScope).toHaveText("Show all projects · 1 needs input");
    const rail = restoredLive.getByRole("navigation", { name: "Live session list" });
    const sessionHeader = restoredLive.locator(".dashboard-live-toolbar:visible");
    await expect(rail).toHaveCount(0);
    await expect(sessionHeader.getByRole("img", { name: "Idle", exact: true })).toBeVisible();
    const soloDraft = restoredLive.getByRole("textbox", { name: /Follow up · Codex fixture/ });
    await soloDraft.fill("Resume this after checking history.");
    await expect(sessionHeader.getByText("Draft", { exact: true })).toBeVisible();
    await restoredLive.getByRole("button", { name: "Changes", exact: true }).click();
    await expect(restoredDiff).toBeVisible();
    const preview = dashboard().getByRole("group", { name: "Project view" });
    await preview.getByRole("button", { name: "History", exact: true }).click();
    await expect(restoredLive).toBeHidden();
    const search = dashboard().getByRole("searchbox", { name: "Find saved conversations" });
    await expect(search).toBeVisible();
    await expect(dashboard().getByRole("region", { name: "Saved conversations" })
      .getByRole("button", { name: "Preview Saved project checkpoint" })).toBeVisible();
    await search.fill("checkpoint");
    await expect(dashboard().getByRole("button", { name: /Saved project checkpoint/ })).toBeVisible();
    await search.clear();
    await preview.getByRole("button", { name: "Live", exact: true }).click();
    await expect(restoredDiff).toBeVisible();
    await expect.poll(() => restoredDiff.evaluate((element) => element.scrollTop)).toBe(310);
    await restoredLive.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(soloDraft).toHaveValue("Resume this after checking history.");
    await dashboard().getByRole("button", { name: "New session", exact: true }).click();
    const focusedLauncher = page.getByRole("dialog", { name: "New session or terminal" });
    await expect(focusedLauncher.getByRole("combobox", { name: "Launch folder" })).toHaveValue(dir);
    await app.evaluate(({ BrowserWindow, ipcMain }, { terminal, sessions }) => {
      ipcMain.removeHandler("create");
      ipcMain.handle("create", () => {
        BrowserWindow.getAllWindows()[0].webContents.send("event", { event: "store", sessions: [
          ...sessions,
          { ...sessions[0], sessionID: terminal.sessionID, terminalId: terminal.id, title: terminal.title, state: "idle" },
        ] });
        return terminal;
      });
    }, {
      terminal: { ...restoredTerminal, id: "second-focused-terminal", title: "Second focused session",
        sessionID: "aaaabbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      sessions: scopedRows,
    });
    await focusedLauncher.getByRole("button", { name: /^Start Codex/ }).click();
    await expect(rail.getByRole("button", { name: "Inspect Second focused session" })).toHaveAttribute("aria-current", "true");
    await restoredSession.click();
    await expect(restoredSession).toHaveAttribute("aria-current", "true");
    await expect(soloDraft).toHaveValue("Resume this after checking history.");
    await clearScope.click();
    await expect(scope("All projects")).toBeVisible();
    await expect(restoredSession).toHaveAttribute("aria-current", "true");
    await expect(nextAttention).toBeEnabled();
    await scope("All projects").click();
    await picker().getByRole("checkbox", { name: path.basename(dir), exact: true }).check();
    await picker().getByRole("searchbox", { name: "Search projects" }).fill("release-notes");
    await picker().getByRole("checkbox", { name: "release-notes", exact: true }).check();
    await picker().getByRole("button", { name: "Apply", exact: true }).click();
    await expect(scope("2 projects")).toBeVisible();
    await expect(restoredLive.getByRole("navigation", { name: "Live session list" })).toBeVisible();
    await expect(restoredLive.getByRole("button", { name: "Inspect Other project session" })).toHaveCount(0);
    await expect(nextAttention).toBeDisabled();
    await expect(clearScope).toHaveText("Show all projects · 1 needs input");
    await scope("2 projects").click();
    await expect(picker().getByRole("checkbox", { name: "release-notes" })).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(picker()).toHaveCount(0);
    await expect(dashboard()).toBeVisible();
    await dashboard().getByRole("button", { name: "New session", exact: true }).click();
    const destination = focusedLauncher.getByRole("combobox", { name: "Launch folder" });
    await expect(destination).toHaveValue("");
    await expect(destination.getByRole("option")).toHaveText(["Choose a folder…", path.basename(dir), "release-notes"]);
    await focusedLauncher.getByRole("button", { name: "Close launcher" }).click();
    await app.evaluate(({ ipcMain }) => {
      (globalThis as any).drawerShellStarts = [];
      ipcMain.removeHandler("replay");
      ipcMain.handle("replay", () => ({ data: "", sequence: 0 }));
      ipcMain.removeHandler("create");
      ipcMain.handle("create", (_event, cwd, agent, compactPrompt) => {
        if (agent !== "shell") throw Error("Expected a plain shell");
        const starts = (globalThis as any).drawerShellStarts;
        starts.push({ cwd, compactPrompt });
        return { id: "dashboard-shell-fixture-" + starts.length, cwd, agent, title: "Shell", exited: false };
      });
    });
    const drawer = restoredLive.getByRole("region", { name: "Dashboard shell", exact: true });
    const shellButton = restoredLive.getByRole("button", { name: "Shell", exact: true });
    await shellButton.click();
    await expect(drawer.locator(".xterm-helper-textarea")).toBeFocused();
    const shellDivider = drawer.getByRole("separator", { name: "Resize dashboard shell", exact: true });
    await shellDivider.press("ArrowUp");
    await expect(shellDivider).toHaveAttribute("aria-valuenow", "41");
    await drawer.getByRole("button", { name: "Hide shell", exact: true }).click();
    await expect(drawer).toBeHidden();
    await shellButton.click();
    await expect(drawer).toBeVisible();
    await rail.getByRole("button", { name: "Inspect Second focused session" }).click();
    await expect(drawer).toBeVisible();
    await clearScope.click();
    await expect(nextAttention).toBeEnabled();
    await nextAttention.click();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(`Started in ${dir}`, { exact: true })).toBeVisible();
    await app.evaluate(({ BrowserWindow }, folder) => {
      BrowserWindow.getAllWindows()[0].webContents.send("event", {
        event: "output", id: "dashboard-shell-fixture-1", sequence: 999999,
        data: "\x1b]7;file://localhost" + encodeURI(folder) + "\x07",
      });
    }, anotherFolder);
    await expect(drawer.getByText(anotherFolder, { exact: true })).toBeVisible();
    await restoredSession.click();
    await expect(drawer.getByText(anotherFolder, { exact: true })).toBeVisible();
    await expect(shellDivider).toHaveAttribute("aria-valuenow", "41");
    await drawer.getByLabel("Compact prompt").check();
    await drawer.getByRole("button", { name: "Start shell here", exact: true }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as any).drawerShellStarts))
      .toEqual([{ cwd: dir, compactPrompt: false }, { cwd: dir, compactPrompt: true }]);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("close");
      ipcMain.handle("close", (_event, id) => {
        (globalThis as any).endedDrawerShell = id;
        return true;
      });
    });
    await drawer.getByRole("button", { name: "End shell…", exact: true }).click();
    await expect(drawer.getByRole("button", { name: "End shell…", exact: true })).toHaveCount(0);
    expect(await app.evaluate(() => (globalThis as any).endedDrawerShell)).toBe("dashboard-shell-fixture-2");
    await drawer.getByRole("button", { name: "Hide shell", exact: true }).click();
    const release = scopedRows[3];
    await dashboard().getByRole("button", { name: "Recent", exact: true }).click();
    await recentRelease.click();
    const releasePreview = recentDialog.getByRole("region", { name: "Conversation preview", exact: true });
    await releasePreview.getByRole("button", { name: "Save next step" }).click();
    await releasePreview.getByRole("textbox", { name: "Next step" }).fill("Verify the release checklist.");
    await releasePreview.getByRole("button", { name: "Save next step" }).click();
    await expect(releasePreview.getByText("Verify the release checklist.")).toBeVisible();
    await expect(hideFromHistory).toBeDisabled();
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("resume");
      ipcMain.handle("resume", () => { throw Error("Agent unavailable"); });
    });
    await releasePreview.getByRole("button", { name: "Resume session" }).click();
    await expect(releasePreview.getByRole("alert")).toContainText("Agent unavailable");
    await expect(recentDialog).toBeVisible();
    await app.evaluate(({ BrowserWindow, ipcMain }, { terminal, release, sessions }) => {
      ipcMain.removeHandler("resume");
      ipcMain.handle("resume", (_event, provider, id) => {
        if (provider !== release.provider || id !== release.sessionID) throw Error("Wrong session resumed");
        BrowserWindow.getAllWindows()[0].webContents.send("event", { event: "store", sessions: [
          ...sessions.filter((row) => row.sessionID !== release.sessionID),
          { ...release, terminalId: terminal.id, state: "idle" },
        ] });
        return terminal;
      });
    }, { terminal: { ...restoredTerminal, id: "resumed-release", cwd: thirdFolder, sessionID: release.sessionID, title: release.title }, release, sessions: scopedRows });
    await releasePreview.getByRole("button", { name: "Resume session" }).click();
    await expect(restoredLive.locator(".dashboard-live-toolbar:visible")).toContainText("Release checkpoint");
    await page.screenshot({ path: testInfo.outputPath("04-resumed-session.png") });
    await expect(scope("All projects")).toBeVisible();
    await dashboard().getByRole("button", { name: /Back to Recent/ }).click();
    const resumedRecent = recentPanel.getByRole("region", { name: "Live", exact: true }).getByRole("button", { name: /Release checkpoint/ });
    await resumedRecent.click();
    await sessionActions.click();
    await recentDialog.getByRole("button", { name: "Hide workspace tab", exact: true }).click();
    await sessionActions.click();
    await expect(recentDialog.getByRole("button", { name: "Hide workspace tab", exact: true })).toHaveCount(0);
    await recentDialog.getByRole("button", { name: "End session…", exact: true }).click();
    await expect(recentDialog.getByText("Stop this terminal and keep its conversation?")).toBeVisible();
    await recentDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await recentDialog.getByRole("button", { name: "End session…", exact: true }).click();
    await recentDialog.getByRole("button", { name: "End Release checkpoint", exact: true }).click();
    await expect(recentDialog.getByRole("button", { name: "Resume session", exact: true })).toBeVisible();
    await expect.poll(() => app.evaluate(() => (globalThis as any).endedDrawerShell)).toBe("resumed-release");
    await recentDialog.getByRole("button", { name: "Close recent session details" }).click();
    await expect(restoredLive.locator(".dashboard-live-toolbar:visible")).toContainText("Codex fixture");
    await closeUI(app);
    app = await electron.launch(launch);
    page = await workspacePage(app, true);
    await expect(scope("All projects")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("recapAgent"))).toBe("claude");
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
  db.exec("CREATE TABLE threads (id TEXT, cwd TEXT, title TEXT, updated_at INTEGER, rollout_path TEXT, archived INTEGER, thread_source TEXT)");
  db.prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?, 1, NULL)").run(
    codexID, dir, "Codex release history", Math.floor(Date.now() / 1000), codexTranscript,
  );
  const guardianID = "88888888-8888-4888-8888-888888888888";
  const sameTitleID = "99999999-9999-4999-8999-999999999999";
  const reviewTime = Math.floor(Date.now() / 1000) - 14 * 86400;
  const insertReview = db.prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?, 0, ?)");
  insertReview.run(guardianID, dir, "Guardian review", reviewTime, codexTranscript, "guardian_review");
  insertReview.run(sameTitleID, dir, "Guardian review", reviewTime, codexTranscript, null);
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
    let page = await workspacePage(app, true);
    const dashboard = page.getByRole("dialog", { name: "RunHuddle" });
    const cleanup = dashboard.getByRole("region", { name: "Cleanup suggestions" });
    await cleanup.getByRole("button", { name: /Codex Guardian reviews/ }).click();
    await expect(cleanup.getByRole("checkbox", { name: "Select Guardian review" })).toHaveCount(1);
    await dashboard.getByRole("button", { name: `Focus project ${path.basename(dir)}`, exact: true }).click();
    await dashboard.getByRole("button", { name: "History", exact: true }).click();
    await expect(dashboard.getByText("Guardian reviews (1)", { exact: true })).toBeVisible();
    await dashboard.getByRole("button", { name: /Show all projects/ }).click();
    await cleanup.getByRole("button", { name: "Hide 1 session", exact: true }).click();
    await expect(cleanup.getByRole("status")).toHaveText("Hid 1 session.");
    await expect(cleanup.getByRole("checkbox", { name: "Select Guardian review" })).toHaveCount(0);
    expect(JSON.parse(fs.readFileSync(path.join(env.RUNHUDDLE_DATA, "hidden-history.json"), "utf8")).sessions)
      .toEqual(["Codex:" + guardianID]);
    await cleanup.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(cleanup.getByRole("status")).toHaveText("Restored 1 session.");
    await dashboard.getByRole("button", { name: "Open workspace" }).click();
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
    await rowMenu.getByRole("button", { name: "Hide from history", exact: true }).click();
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
    await page.getByLabel("Active session toolbar", { exact: true }).getByLabel("Session actions", { exact: true }).click();
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

test("Quick Terminal keeps its shell and keyboard shortcuts can be remapped", async () => {
  test.setTimeout(45000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-keyboard-ui-"));
  const data = path.join(dir, "preview");
  const env = { ...process.env, RUNHUDDLE_DATA: data };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = {
    args: process.env.RUNHUDDLE_TEST_EXECUTABLE ? [] : [path.resolve(".")],
    env, executablePath: process.env.RUNHUDDLE_TEST_EXECUTABLE,
  };
  let app = await electron.launch(launch);
  try {
    let page = await workspacePage(app, true);
    const dashboard = () => page.getByRole("dialog", { name: "RunHuddle" });
    const palette = () => page.getByRole("dialog", { name: "Command Palette" });
    const quick = () => page.getByRole("dialog", { name: "Quick Terminal" });
    const settings = () => page.getByRole("dialog", { name: "Keyboard Shortcuts" });
    const terminalInput = () => quick().locator(".xterm-helper-textarea");
    const paletteInput = () => palette().getByRole("textbox", { name: "Search commands, sessions, and projects" });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await dashboard().getByRole("button", { name: "Recent", exact: true }).focus();
    await page.keyboard.press("ControlOrMeta+p");
    await expect(paletteInput()).toBeFocused();
    await paletteInput().fill("> quick");
    await paletteInput().press("Enter");
    await expect(terminalInput()).toBeFocused();
    await page.setViewportSize({ width: 860, height: 600 });
    await expect.poll(() => quick().evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { bottom: Math.round(innerHeight - bounds.bottom), height: Math.round(bounds.height) };
    })).toEqual({ bottom: 12, height: 384 });
    await expect(quick()).toHaveCSS("animation-name", "quick-terminal-enter");
    await expect(quick()).toHaveCSS("animation-duration", "0.34s");
    const motion = quick().getByRole("button", { name: "Animate Quick Terminal" });
    await expect(motion).toHaveAttribute("aria-pressed", "true");
    await motion.click();
    await expect(quick()).toHaveCSS("animation-name", "none");
    await terminalInput().focus();
    const shellId = await page.evaluate(() => localStorage.getItem("quickTerminalID"));
    expect(shellId).toBeTruthy();
    await page.keyboard.insertText("printf 'quick-%s\\n' 'terminal-ready'");
    await page.keyboard.press("Enter");
    await expect(quick().locator(".xterm-rows")).toContainText("quick-terminal-ready");
    await page.keyboard.press("ControlOrMeta+t");
    await expect(quick()).toHaveCount(0);
    await expect(dashboard().getByRole("button", { name: "Recent", exact: true })).toBeFocused();
    await page.keyboard.press("ControlOrMeta+t");
    await expect(terminalInput()).toBeFocused();
    await expect(motion).toHaveAttribute("aria-pressed", "false");
    await expect(quick()).toHaveCSS("animation-name", "none");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await motion.click();
    await page.keyboard.press("ControlOrMeta+t");
    await page.keyboard.press("ControlOrMeta+t");
    await expect(terminalInput()).toBeFocused();
    await expect(motion).toHaveAttribute("aria-pressed", "true");
    await expect(quick()).toHaveCSS("animation-name", "none");
    expect(await page.evaluate(() => localStorage.getItem("quickTerminalID"))).toBe(shellId);
    await expect(quick().locator(".xterm-rows")).toContainText("quick-terminal-ready");
    await page.keyboard.press("ControlOrMeta+t");

    await page.keyboard.press("ControlOrMeta+p");
    await paletteInput().fill("> keyboard");
    await paletteInput().press("Enter");
    await settings().getByRole("button", { name: "Record shortcut for Quick Terminal" }).click();
    await settings().getByRole("textbox", { name: "Record shortcut for Quick Terminal" }).press("ControlOrMeta+p");
    await settings().getByRole("button", { name: "Save shortcuts" }).click();
    await expect(settings().getByRole("alert")).toContainText("must use different shortcuts");
    await settings().getByRole("button", { name: "Record shortcut for Quick Terminal" }).click();
    await settings().getByRole("textbox", { name: "Record shortcut for Quick Terminal" }).press("ControlOrMeta+Shift+t");
    await settings().getByRole("button", { name: "Record shortcut for Command Palette" }).click();
    await settings().getByRole("textbox", { name: "Record shortcut for Command Palette" }).press("ControlOrMeta+Shift+p");
    await settings().getByRole("button", { name: "Save shortcuts" }).click();
    await expect(settings()).toHaveCount(0);
    await expect.poll(() => app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.getMenuItemById("dashboard-quick-terminal")?.accelerator)).toBe("CmdOrCtrl+Shift+T");
    await page.keyboard.press("ControlOrMeta+t");
    await expect(quick()).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Shift+t");
    await expect(terminalInput()).toBeFocused();
    await page.keyboard.press("ControlOrMeta+Shift+t");
    await expect(quick()).toHaveCount(0);

    await closeUI(app);
    app = await electron.launch(launch);
    page = await workspacePage(app, true);
    await page.keyboard.press("ControlOrMeta+Shift+p");
    await expect(paletteInput()).toBeFocused();
    await paletteInput().fill("> keyboard");
    await paletteInput().press("Enter");
    await settings().getByRole("button", { name: "Reset to defaults" }).click();
    await settings().getByRole("button", { name: "Save shortcuts" }).click();
    await expect(settings()).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+t");
    await expect(terminalInput()).toBeFocused();
    expect(await page.evaluate(() => localStorage.getItem("quickTerminalID"))).toBe(shellId);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (_window, options) => {
        if (options.message !== "Close this terminal?") throw Error("Expected a shell confirmation");
        return { response: 1, checkboxChecked: false };
      };
    });
    await quick().getByRole("button", { name: "End shell…" }).click();
    await expect(quick().getByRole("button", { name: "Start shell" })).toBeVisible();
  } finally {
    await closeUI(app);
    const client = new Service(path.join(data, "service-v2"));
    if (await client.connectExisting()) await client.call("shutdown");
    client.disconnect();
    removeFixture(dir);
  }
});

test("keep awake follows live agent activity across sessions", async () => {
  test.skip(process.platform === "win32", "Claude hook fixture uses a Unix shell");
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rh-awake-ui-")));
  const data = path.join(dir, "preview");
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "claude"), "#!/bin/sh\nexec cat\n", { mode: 0o700 });
  const env = {
    ...process.env, RUNHUDDLE_DATA: data, CLAUDE_CONFIG_DIR: path.join(dir, "claude"),
    PATH: bin + path.delimiter + process.env.PATH, ZDOTDIR: dir,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const serviceDir = path.join(data, "service-v2");
  const service = new Service(serviceDir);
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const application = app = await electron.launch({
      args: process.env.RUNHUDDLE_TEST_EXECUTABLE ? [] : [path.resolve(".")],
      executablePath: process.env.RUNHUDDLE_TEST_EXECUTABLE, env,
    });
    const page = await workspacePage(application, true);
    const first = await page.evaluate((cwd) => window.runhuddle.create(cwd, "claude"), dir);
    const second = await page.evaluate((cwd) => window.runhuddle.create(cwd, "claude"), dir);
    const report = (id: string, type: string) =>
      fs.appendFileSync(path.join(serviceDir, "activity", id + ".jsonl"), JSON.stringify({ type }) + "\n");
    const active = () => page.evaluate(async () => (await window.runhuddle.snapshot()).keepAwakeActive);
    const toggle = (checked: boolean) => application.evaluate(({ Menu, BrowserWindow }, value) => {
      const item = Menu.getApplicationMenu()!.getMenuItemById("keep-awake-while-working")!;
      if (item.checked === value) return;
      item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent);
    }, checked);

    report(first.id, "UserPromptSubmit");
    report(second.id, "UserPromptSubmit");
    await expect.poll(() => page.evaluate(async () =>
      (await window.runhuddle.snapshot()).sessions.filter((row) => row.state === "working").length,
    )).toBe(2);
    expect(await active()).toBe(false);
    await toggle(true);
    const indicator = page.getByText("Keeping awake", { exact: true });
    await expect(indicator).toBeVisible();
    expect(await active()).toBe(true);

    report(first.id, "PermissionRequest");
    await expect.poll(() => page.evaluate(async (id) =>
      (await window.runhuddle.snapshot()).sessions.find((row) => row.terminalId === id)?.state, first.id,
    )).toBe("needsInput");
    expect(await active()).toBe(true);

    report(second.id, "Stop");
    await expect(indicator).toBeHidden();
    expect(await active()).toBe(false);
    report(first.id, "PostToolUse");
    await expect(indicator).toBeVisible();
    await toggle(false);
    await expect(indicator).toBeHidden();
    expect(await active()).toBe(false);
  } finally {
    if (app) await closeUI(app);
    if (await service.connectExisting()) await service.call("shutdown");
    service.disconnect();
    removeFixture(dir);
  }
});
