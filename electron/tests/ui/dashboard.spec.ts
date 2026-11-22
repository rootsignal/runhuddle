import { test, expect, _electron as electron, type Locator } from "@playwright/test";
import fs from "node:fs";
import { once } from "node:events";
import net from "node:net";
import { createServer } from "node:http";
import { address as serviceAddress, frames, send, PROTOCOL } from "../../main/protocol.mjs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { Service } from "../../main/service.mjs";
import { recapStore } from "../../main/recaps.mjs";
import { removeFixture } from "../fixture-cleanup.mjs";
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
async function dashboardPage(app: Awaited<ReturnType<typeof electron.launch>>) {
  const page = await app.firstWindow();
  await expect(page.locator(".app")).toBeVisible();
  await expect(page.locator("dialog.getting-started[open], dialog.projects-dashboard[open]").first()).toBeVisible();
  if (await page.locator("dialog.getting-started[open]").count())
    await page.getByRole("dialog", { name: "Getting started" }).getByRole("button", { name: "Skip guide" }).click();
  const dashboard = page.getByRole("dialog", { name: "RunHuddle" });
  await expect(dashboard).toBeVisible();
  return page;
}
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
    const page = await dashboardPage(app);
    const row = page.getByRole("region", { name: "Live sessions" });
    await expect(row).toBeVisible();
    expect(stopped).toBe(false);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (_window, options) => {
        (globalThis as any).serviceUpdateConfirmation = options.message;
        return { response: 0, checkboxChecked: false };
      };
    });
    await page.getByRole("button", { name: "Review terminal service update…" }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as any).serviceUpdateConfirmation))
      .toBe("Stop all terminals and update the terminal service?");
    expect(stopped).toBe(false);
    await row.getByRole("button", { name: "Browser", exact: true }).click();
    const address = page.getByRole("textbox", { name: "Browser address" });
    await address.fill("http://127.0.0.1:" + (site.address() as { port: number }).port);
    await address.press("Enter");
    const openAgentTerminal = page.getByRole("region", { name: "Browser preview" })
      .getByRole("button", { name: "Open agent terminal", exact: true });
    await openAgentTerminal.click();
    await expect(row.getByRole("button", { name: "Agent terminal", exact: true })).toHaveAttribute("aria-pressed", "true");
    const reopen = page.getByRole("button", { name: "Reopen with browser tools" });
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
    const browser = page.getByRole("region", { name: "Browser preview" });
    const allowControl = browser.getByRole("button", { name: "Allow agent control" });
    const stopControl = browser.getByRole("button", { name: "Stop agent control" });
    await expect(allowControl).toBeEnabled();
    await allowControl.click();
    const browserOrigin = "http://127.0.0.1:" + (site.address() as { port: number }).port;
    await expect(browser.getByText("Agent control on", { exact: true })).toBeVisible();
    await expect(browser.getByText(`Claude session can interact with ${browserOrigin}.`, { exact: true })).toBeVisible();
    await stopControl.click();
    await expect(allowControl).toBeEnabled();
    await expect(browser.getByText("Agent control on", { exact: true })).toHaveCount(0);
    const goBack = browser.getByRole("button", { name: "Go back", exact: true });
    const goForward = browser.getByRole("button", { name: "Go forward", exact: true });
    await address.fill(browserOrigin + "/second");
    await address.press("Enter");
    await expect(allowControl).toBeEnabled();
    await allowControl.click();
    await expect(stopControl).toBeVisible();
    await expect(goBack).toBeEnabled();
    await goBack.click();
    await expect(address).toHaveValue(browserOrigin + "/");
    await expect(stopControl).toHaveCount(0);
    await goForward.click();
    await expect(address).toHaveValue(browserOrigin + "/second");
    await browser.getByRole("button", { name: "Reload page", exact: true }).click();
    await expect(allowControl).toBeEnabled();
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

test("default dashboard keeps its server running while Quick Terminal runs a separate command", async () => {
  test.skip(process.platform === "win32", "Uses a Unix shell and curl.");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-shell-surfaces-"));
  const data = path.join(dir, "preview");
  const env: NodeJS.ProcessEnv = { ...process.env, RUNHUDDLE_DATA: data };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = {
    args: process.env.RUNHUDDLE_TEST_EXECUTABLE ? [] : [path.resolve(".")],
    executablePath: process.env.RUNHUDDLE_TEST_EXECUTABLE, env,
  };
  let app = await electron.launch(launch);
  try {
    const page = await app.firstWindow();
    const guide = page.getByRole("dialog", { name: "Getting started" });
    await expect(guide.getByRole("heading", { name: "Start a session" })).toBeVisible();
    await expect(guide).toHaveAttribute("data-anchored", "");
    await guide.getByRole("button", { name: "Next" }).click();
    await expect(guide.getByRole("heading", { name: "Review an update" })).toBeVisible();
    await expect(guide).toContainText("Next review");
    await expect(guide).not.toHaveAttribute("data-anchored");
    await guide.getByRole("button", { name: "Next" }).click();
    await expect(guide.getByRole("heading", { name: "Send a follow-up" })).toBeVisible();
    await expect(guide).toContainText("press Enter to send");
    await guide.getByRole("button", { name: "Done" }).click();
    const dashboard = page.getByRole("dialog", { name: "RunHuddle" });
    await expect(dashboard.getByRole("button", { name: "Open workspace" })).toHaveCount(0);
    await expect(page.locator(".session-sidebar")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dashboard).toBeVisible();
    await dashboard.getByRole("button", { name: "Command Palette" }).click();
    const palette = page.getByRole("dialog", { name: "Command Palette" });
    await palette.getByRole("textbox").fill("Open workspace");
    await expect(palette.getByRole("button", { name: "Open workspace", exact: true })).toHaveCount(0);
    await palette.getByRole("button", { name: "Close Command Palette" }).click();
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById("getting-started");
      if (!item) throw Error("Missing Getting started menu item.");
      item.click(item, BrowserWindow.getAllWindows()[0], {});
    });
    await expect(guide.getByRole("heading", { name: "Start a session" })).toBeVisible();
    await expect(guide).toHaveAttribute("data-anchored", "");
    await guide.getByRole("button", { name: "Next" }).click();
    await expect(guide.getByRole("heading", { name: "Review an update" })).toBeVisible();
    await guide.getByRole("button", { name: "Skip guide" }).click();
    await page.evaluate((folder) => window.runhuddle.create(folder, "shell"), dir);
    await dashboard.getByRole("button", { name: `Actions for project ${path.basename(dir)}`, exact: true }).click();
    await dashboard.getByRole("button", { name: "Open project shell", exact: true }).click();
    async function waitForShell(shell: Locator) {
      await expect(shell.locator(".xterm-helper-textarea")).toBeFocused();
      await expect(async () => {
        await page.keyboard.insertText("printf 'runhuddle-%s\\n' ready");
        await page.keyboard.press("Enter");
        await expect(shell.locator(".xterm-rows")).toContainText("runhuddle-ready", { timeout: 500 });
      }).toPass({ timeout: 5000 });
    }
    const drawer = dashboard.getByRole("region", { name: "Dashboard shell" });
    const drawerRows = drawer.locator(".xterm-rows");
    await waitForShell(drawer);
    await page.keyboard.insertText(`node -e 'require("http").createServer((req,res)=>res.end("served by drawer")).listen(0,"127.0.0.1",function(){console.log("drawer-port="+this.address().port)})'`);
    await page.keyboard.press("Enter");
    await expect(drawerRows).toContainText(/drawer-port=\d+/);
    const port = (await drawerRows.innerText()).match(/drawer-port=(\d+)/)![1];
    const drawerId = await page.evaluate(() => JSON.parse(localStorage.getItem("dashboardShellId")!));
    await drawer.getByRole("button", { name: "Hide shell" }).click();
    await page.keyboard.press("ControlOrMeta+t");
    const quick = page.getByRole("dialog", { name: "Quick Terminal" });
    await waitForShell(quick);
    const quickId = await page.evaluate(() => localStorage.getItem("quickTerminalID"));
    expect(quickId).toBeTruthy();
    expect(quickId).not.toBe(drawerId);
    await page.keyboard.insertText(`curl -fsS http://127.0.0.1:${port}/; printf '\\n'`);
    await page.keyboard.press("Enter");
    await expect(quick.locator(".xterm-rows")).toContainText("served by drawer");
    await quick.getByRole("button", { name: "Dismiss Quick Terminal" }).click();
    await dashboard.getByRole("button", { name: "Open project shell", exact: true }).click();
    await expect(drawerRows).toContainText(`drawer-port=${port}`);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("dashboardShellId")!))).toBe(drawerId);
    expect(await page.evaluate(async () => (await window.runhuddle.snapshot()).terminals.length)).toBe(3);
    await closeUI(app);
    app = await electron.launch(launch);
    const reopened = await dashboardPage(app);
    const restored = reopened.getByRole("dialog", { name: "RunHuddle" });
    await restored.getByRole("button", { name: `Actions for project ${path.basename(dir)}`, exact: true }).click();
    await restored.getByRole("button", { name: "Open project shell", exact: true }).click();
    await expect(restored.getByRole("region", { name: "Dashboard shell" }).locator(".xterm-rows")).toContainText(`drawer-port=${port}`);
    expect(await reopened.evaluate(() => localStorage.getItem("quickTerminalID"))).toBe(quickId);
  } finally {
    await closeUI(app);
    const service = new Service(path.join(data, "service-v2"));
    try { if (await service.connectExisting()) await service.call("shutdown"); } finally { service.disconnect(); }
    await removeFixture(dir);
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
    const page = await dashboardPage(app);
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
    const dashboard = page.getByRole("dialog", { name: "RunHuddle" });
    await dashboard.getByRole("button", { name: `Actions for project ${path.basename(dir)}` }).click();
    await dashboard.getByRole("button", { name: "Open project shell", exact: true }).click();
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
    const page = await dashboardPage(app);
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
        terminals: [{ ...terminal, agent: "claude", sessionID: "55555555-5555-4555-8555-555555555555", title: "Attachment fixture" }],
      });
    }, shell);
    const live = page.getByRole("region", { name: "Live sessions" });
    await expect(live.getByRole("textbox", { name: "Follow-up" })).toBeVisible();
    const second = capture("Screenshot Rick's capture.png");
    await expect(popup).toContainText(path.basename(second));
    await expect(popup.getByRole("button", { name: "Add to follow-up draft" })).toHaveAccessibleDescription(/Attach to Claude session/);
    capture("Screenshot 3.png");
    await expect(popup.getByText("2 screenshots waiting", { exact: true })).toBeVisible();
    await popup.getByRole("button", { name: "Add to follow-up draft" }).click();
    await expect(popup.getByRole("status")).toContainText("Attached to draft");
    await expect(live.getByRole("list", { name: "Draft screenshots" })).toContainText(path.basename(second));
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("screenshot-draft");
      ipcMain.handle("screenshot-draft", () => { throw Error("Screenshot is unavailable."); });
    });
    await popup.getByRole("button", { name: "Add to follow-up draft" }).click();
    await expect(popup.getByRole("alert")).toContainText("Screenshot is unavailable.");
    await expect(popup.getByRole("button", { name: "Add to follow-up draft" })).toBeEnabled();
    expect(await app.evaluate(() => (globalThis as any).screenshotWrites || [])).toEqual([]);
  } finally {
    await closeUI(app);
    if (await client.connectExisting()) {
      await client.call("shutdown").catch(() => {});
      client.disconnect();
    }
    removeFixture(dir);
  }
});

test("Inbox keeps unread completions across restart and opens the exact recorded session", async ({}, testInfo) => {
  test.setTimeout(120000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rh-inbox-ui-"));
  const externalFile = dir + " filing instructions.txt";
  fs.writeFileSync(externalFile, "External fixture");
  fs.writeFileSync(path.join(dir, "Release notes.md"), [
    "# Release checklist", "", "- Verify the mobile layout.", "- [x] Build passed.", "",
    "| Area | Status |", "| --- | --- |", "| Dashboard | Ready |", "",
    "> Review before publishing.", "", "```sh", "npm test", "```", "",
    "[Release site](https://example.test/markdown)", "", "![Remote image](https://example.test/image.png)",
    "", "<script>shouldNotRender()</script>",
    ...Array.from({ length: 30 }, (_, index) => `\nChecklist note ${index + 1}.`),
  ].join("\n"));
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
  recapStore(path.join(data, "recaps", "recaps.sqlite")).save("Codex:" + sessionID, {
    done: "Verified the desktop layout.", pending: "", next: "Check the narrow layout.",
    agent: "Codex", generatedAt: 1000, sourceUpdated: rows[1].updated,
  });
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
    let page = await dashboardPage(app);
    const dashboard = () => page.getByRole("dialog", { name: "RunHuddle" });
    const openFocusedProject = () => dashboard().getByRole("button", { name: `Focus project ${path.basename(dir)}`, exact: true }).click();
    const browseProjectHistory = async () => {
      await openFocusedProject();
      const landing = dashboard().getByRole("region", { name: "Pick up", exact: true });
      await expect(landing).toBeVisible();
      await landing.getByRole("button", { name: "Browse history", exact: true }).click();
    };
    const showAllProjects = () => dashboard().getByRole("button", { name: /Show all projects/ }).click();
    await expect(dashboard().getByRole("region", { name: "Live sessions" })).toHaveCount(0);
    await expect(dashboard().getByRole("region", { name: "Ready for review", exact: true })).toBeVisible();
    const reviewProjectCard = dashboard().locator(".dashboard-project-card").filter({
      has: page.getByRole("button", { name: `Focus project ${path.basename(dir)}`, exact: true }),
    });
    await expect(reviewProjectCard.getByRole("button", { name: "Review session", exact: true })).toBeVisible();
    await expect(reviewProjectCard.getByRole("button", { name: "Browse history", exact: true })).toBeVisible();
    await openFocusedProject();
    const projectLanding = () => dashboard().getByRole("region", { name: "Pick up", exact: true });
    await projectLanding().getByRole("button", { name: "Start a session", exact: true }).click();
    const landingLauncher = page.getByRole("dialog", { name: "New session or terminal" });
    await expect(landingLauncher.getByRole("combobox", { name: "Launch folder" })).toHaveValue(dir);
    await page.keyboard.press("Escape");
    await showAllProjects();
    await browseProjectHistory();
    const reviewQueue = page.getByRole("dialog", { name: "Review saved sessions" });
    await dashboard().getByRole("button", { name: "Review old sessions" }).click();
    await expect(reviewQueue.getByRole("heading", { name: "Old notes", exact: true })).toBeVisible();
    await expect(reviewQueue.getByText("Transcript unavailable.", { exact: false })).toBeVisible();
    await expect(reviewQueue.getByRole("button", { name: "Open full conversation" })).toHaveCount(0);
    await reviewQueue.getByRole("button", { name: "Hide", exact: true }).click();
    await expect(reviewQueue.getByText("Hidden from history · Old notes")).toBeVisible();
    await reviewQueue.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(reviewQueue.getByText("Restored · Old notes", { exact: true })).toBeVisible();
    await expect(reviewQueue.getByRole("heading", { name: "Old notes", exact: true })).toBeVisible();
    await reviewQueue.getByRole("button", { name: "Keep", exact: true }).click();
    await reviewQueue.getByRole("button", { name: "Close session review", exact: true }).click();
    await dashboard().getByRole("button", { name: "Review old sessions" }).click();
    await expect(reviewQueue.getByRole("heading", { name: "Old notes", exact: true })).toHaveCount(0);
    await reviewQueue.getByRole("button", { name: "Close session review", exact: true }).click();
    await showAllProjects();
    const cleanupSearch = dashboard().getByRole("region", { name: "Find a project or conversation" });
    const cleanupQuery = cleanupSearch.getByRole("searchbox");
    await cleanupQuery.fill("Old notes");
    await cleanupQuery.press("Enter");
    const cleanupDetails = page.getByRole("dialog", { name: "Recent session details" });
    await cleanupDetails.getByRole("button", { name: "Hide", exact: true }).click();
    await expect(cleanupQuery).toHaveValue("Old notes");
    await expect(cleanupSearch.getByText("Hidden from history · Old notes", { exact: true })).toBeVisible();
    await cleanupSearch.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(cleanupSearch.getByText("Restored · Old notes", { exact: true })).toBeVisible();
    await cleanupQuery.clear();
    const cleanup = () => dashboard().getByRole("region", { name: "Cleanup suggestions" });
    await cleanup().getByRole("button", { name: /Inactive history/ }).click();
    await expect(cleanup().getByRole("checkbox")).toHaveCount(2);
    await cleanup().getByRole("checkbox", { name: "Select Old draft" }).uncheck();
    await expect(cleanup().getByText("1 of 2 selected", { exact: true })).toBeVisible();
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
    await expect(reviewProjectCard.getByText("Check the mobile layout", { exact: false })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    const find = dashboard().getByRole("searchbox", { name: "Find projects and conversations" });
    await expect(find).toBeFocused();
    await find.fill("Codex fixture");
    await find.press("Enter");
    const titleResult = page.getByRole("dialog", { name: "Recent session details" });
    await expect(titleResult.getByRole("heading", { name: "Codex fixture" })).toBeVisible();
    await titleResult.getByRole("button", { name: "Close recent session details" }).click();
    await expect(page.getByRole("region", { name: "Ready for review" })).toBeVisible();
    await closeUI(app);
    app = await electron.launch(launch);
    page = await dashboardPage(app);
    await expect(cleanup()).toHaveCount(0);
    await expect(dashboard().getByRole("combobox", { name: "Project card view" })).toHaveValue("compact");
    await dashboard().getByRole("combobox", { name: "Project card view" }).selectOption("comfortable");
    const resume = dashboard().getByRole("region", { name: "Pick up where you left off" });
    await expect(resume.locator(".dashboard-resume-card").filter({ hasText: /Codex fixture|Review layout/ })).toHaveCount(0);
    await expect(dashboard().getByRole("region", { name: "Live sessions" })).toHaveCount(0);
    await expect(dashboard().getByRole("region", { name: "Ready for review", exact: true })).toBeVisible();
    await openFocusedProject();
    await expect(projectLanding().getByText("Check the mobile layout")).toBeVisible();
    await projectLanding().getByRole("button", { name: "Pick up", exact: true }).click();
    await expect(dashboard().getByRole("region", { name: "Conversation preview", exact: true })
      .getByRole("heading", { name: "Review layout" })).toBeVisible();
    await showAllProjects();
    await dashboard().getByRole("button", { name: "Saved reviews (2)", exact: true }).click();
    const attention = dashboard().getByRole("region", { name: "Saved reviews" });
    const savedReview = attention.getByRole("article").filter({ hasText: "Review layout" });
    await expect(savedReview).toContainText("Agent finished a turn");
    await expect(savedReview.getByText("Saved next step", { exact: true })).toBeVisible();
    await expect(savedReview.getByText("Check the mobile layout", { exact: true })).toBeVisible();
    const recappedReview = attention.getByRole("article").filter({ hasText: "Codex fixture" });
    await expect(recappedReview.getByText("Verified the desktop layout.", { exact: true })).toBeVisible();
    await expect(recappedReview.getByText("Check the narrow layout.", { exact: true })).toBeVisible();
    await attention.getByRole("button", { name: "Preview Review layout", exact: true }).click();
    await expect(attention.locator(".dashboard-briefing dt").first()).toHaveText("Your instruction");
    await expect(attention.locator(".dashboard-briefing dt").nth(1)).toHaveText("Agent update");
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
    const reviewDetails = page.getByRole("dialog", { name: "Recent session details" });
    await expect(reviewDetails.getByRole("heading", { name: "Review layout" })).toBeVisible();
    await expect(reviewDetails.getByText("Agent finished a turn · Ready for review")).toBeVisible();
    await expect(reviewDetails.getByText("Check the mobile layout", { exact: false })).toBeVisible();
    await reviewDetails.getByRole("button", { name: "Close recent session details" }).click();
    await attention.getByRole("button", { name: "Mark Review layout reviewed" }).click();
    await attention.getByRole("button", { name: "Mark Codex fixture reviewed" }).click();
    await expect(attention).toHaveCount(0);
    expect(JSON.parse(fs.readFileSync(path.join(data, "inbox.json"), "utf8"))).toEqual([]);
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
    await transcriptMatch.click();
    const matchedConversation = page.getByRole("dialog", { name: "Recent session details" });
    await expect(matchedConversation.getByRole("region", { name: "Conversation history" }))
      .toContainText("The layout is ready for **visual review**.");
    await expect(matchedConversation.locator(".dashboard-preview-heading").getByRole("button", { name: "Resume session" })).toBeVisible();
    await matchedConversation.getByRole("button", { name: "Close recent session details" }).click();
    await expect(dashboardSearch).toHaveValue("visual review");
    await expect(transcriptMatch).toBeFocused();
    await dashboardSearch.clear();
    await dashboard().getByRole("button", { name: "New session", exact: true }).click();
    const launcher = page.getByRole("dialog", { name: "New session or terminal" });
    const launchFolder = launcher.getByRole("combobox", { name: "Launch folder" });
    const launchCodex = launcher.getByRole("button", { name: /^Start Codex/ });
    await expect(launchFolder).toBeFocused();
    await expect(launchFolder).toHaveValue("");
    await expect(launchCodex).toBeDisabled();
    await expect(launcher.getByRole("region", { name: "Plain terminal" })
      .getByRole("button", { name: "Start Terminal", exact: true })).toBeDisabled();
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
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()!.getMenuItemById("getting-started")!;
      item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent);
    });
    const liveGuide = page.getByRole("dialog", { name: "Getting started" });
    await liveGuide.getByRole("button", { name: "Next" }).click();
    await expect(liveGuide).toHaveAttribute("data-highlight", "dashboard-review");
    await liveGuide.getByRole("button", { name: "Next" }).click();
    await expect(liveGuide).toHaveAttribute("data-highlight", "dashboard-follow-up");
    await liveGuide.getByRole("button", { name: "Done" }).click();
    const keyboardDraft = live.getByRole("textbox", { name: "Follow-up", exact: true });
    await keyboardDraft.fill("Check the mobile layout.");
    for (const shortcut of ["ControlOrMeta+Enter", "Shift+Enter"]) {
      await keyboardDraft.press(shortcut);
    }
    await expect(keyboardDraft).toHaveValue("Check the mobile layout.\n\n");
    await keyboardDraft.press("Enter");
    await expect(live.getByText("Follow-up sent.")).toBeVisible();
    await expect(dashboard().getByRole("button", { name: "Next attention", exact: true })).toBeDisabled();
    await expect(resume.locator(".dashboard-resume-card").filter({ hasText: "Codex fixture" })).toHaveCount(0);
    await app.evaluate(({ ipcMain, BrowserWindow, dialog, shell }, { terminal, externalFile }) => {
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
        if (!options.detail || !/^https:\/\/example\.test\/(release|markdown)\n/.test(options.detail))
          throw Error("Wrong browser confirmation");
        return { response: 1, checkboxChecked: false };
      };
      shell.openExternal = async (href) => { (globalThis as any).openedReplyLink = href; };
      shell.showItemInFolder = (file) => { (globalThis as any).revealedReplyFile = file; };
      ipcMain.removeHandler("live-session-preview");
      ipcMain.handle("live-session-preview", (_event, provider, sessionID, terminalId) => {
        if (provider !== "Codex" || sessionID !== terminal.sessionID || terminalId !== terminal.id)
          throw Error("Wrong preview destination");
        const completed = (globalThis as any).completedTurnAt;
        if (completed) return { instruction: "Review the desktop layout next.", instructionAt: completed,
          answer: "Desktop layout verified. See [Release notes](<Release notes.md>) and the [release site](https://example.test/release)." +
            ((globalThis as any).remainingPickerWork ?? ""), screenshots: 2 };
        return { instruction: "Check the mobile layout.", update: "Ready for the next instruction.",
          context: { startedAt: Date.now() - 2 * 86400000, compactions: 2 },
          recentTurns: [
            { instruction: "Inspect the checkout.", instructionAt: 1700000000000, answer: "Checkout inspected." },
            { instruction: "Check the mobile layout.", answer: "Ready for the next instruction." },
          ],
        answer: "Ready for the next instruction.\n\n- Mobile layout checked\n- Desktop layout is next\n\n| Area | Status |\n| --- | --- |\n| Mobile | Checked |\n\nSee [Release notes](<Release notes.md>) and the [release site](https://example.test/release).\n\nI updated the UX checklist. Next up is **Projects, history, and search**." +
          `\n\n:codex-file-citation{path=${JSON.stringify(externalFile)} purpose="output"}` };
      });
      const queue = { ready: false, attempts: 0, sent: 0 };
      Object.assign(globalThis, { followUpQueueFixture: queue });
      ipcMain.removeHandler("codex-prompt-ready");
      ipcMain.handle("codex-prompt-ready", (_event, sessionID, terminalId, queued) =>
        queued === true && sessionID === terminal.sessionID && terminalId === terminal.id && queue.ready);
      ipcMain.removeHandler("live-session-follow-up");
      ipcMain.handle("live-session-follow-up", (_event, provider, sessionID, terminalId, text, screenshots, queued, suggestNextSteps) => {
        if (suggestNextSteps !== true || queued !== (process.platform !== "win32") || provider !== "Codex" || sessionID !== terminal.sessionID || terminalId !== terminal.id ||
            text !== "Review the desktop layout next." || screenshots.length !== 2 ||
            screenshots.some((image: ArrayBuffer) => new Uint8Array(image)[0] !== 137)) throw Error("Wrong live follow-up destination or message");
        if (queued && ++queue.attempts === 1) return "waiting";
        queue.sent++;

      });
    }, { terminal: liveTerminal, externalFile });
    await expect(live.locator(".dashboard-briefing dd").filter({ hasText: "Ready for the next instruction." })).toBeVisible();
    const quickReplies = live.getByRole("group", { name: "Suggested follow-ups" });
    const quickDraft = live.getByRole("textbox", { name: "Follow-up", exact: true });
    const pastedDraft = "review these changes\n" + "project status check ".repeat(20) + "\nkeep the formatting";
    await quickDraft.evaluate((element, text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
    }, pastedDraft);
    const pastedSummary = live.getByRole("button", { name: /Pasted 66 words/ });
    await expect(pastedSummary).toHaveAttribute("aria-expanded", "false");
    await expect(quickDraft).toHaveCount(0);
    await pastedSummary.click();
    await expect(quickDraft).toHaveValue(pastedDraft);
    await expect(quickDraft).toBeFocused();
    await quickDraft.fill("");
    await expect(quickReplies.getByRole("button", { name: "What’s next?", exact: true })).toHaveCount(0);
    await quickReplies.getByRole("button", { name: "Projects, history, and search", exact: true }).click();
    await expect(quickDraft).toHaveValue("Please proceed with the next step you proposed: Projects, history, and search.");
    await expect(quickDraft).toBeFocused();
    await expect(quickDraft).toHaveCSS("outline-width", "2px");
    await expect(live.getByRole("button", { name: "Send follow-up" })).toHaveAttribute("title", "Press Enter to send");
    await expect(quickReplies).toHaveCount(0);
    await quickDraft.fill("");
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("suggest-quick-replies");
      ipcMain.handle("suggest-quick-replies", async (_event, provider, _session, _terminal, instruction, answer) => {
        if (provider !== "Codex" || instruction !== "Check the mobile layout." || !answer.includes("Projects, history, and search"))
          throw Error("Wrong context for quick replies");
        await new Promise<void>((resolve) => {
          Object.assign(globalThis, { releaseQuickReply: resolve });
        });
        return [{ label: "Start with project search", draft: "Start with project search and preserve the project scope." }];
      });
    });
    const aiRepliesLayout = live.getByRole("button", { name: "Preview layout", exact: true });
    await aiRepliesLayout.click();
    const aiRepliesSetting = live.getByRole("checkbox", { name: "AI quick replies", exact: true });
    await expect(aiRepliesSetting).not.toBeChecked();
    await aiRepliesSetting.check();
    await page.keyboard.press("Escape");
    await expect(quickReplies.getByRole("button", { name: "Projects, history, and search", exact: true })).toBeVisible();
    await expect(quickDraft).toBeEnabled();
    await expect.poll(() => app.evaluate(() => typeof (globalThis as any).releaseQuickReply)).toBe("function");
    await app.evaluate(() => (globalThis as any).releaseQuickReply());
    await quickReplies.getByRole("button", { name: "Start with project search", exact: true }).click();
    await expect(quickDraft).toHaveValue("Start with project search and preserve the project scope.");
    await quickDraft.fill("");
    await aiRepliesLayout.click();
    await aiRepliesSetting.uncheck();
    const nextStepsSetting = live.getByRole("checkbox", { name: "Suggest next steps", exact: true });
    await expect(nextStepsSetting).not.toBeChecked();
    await nextStepsSetting.check();
    await page.keyboard.press("Escape");
    await expect(quickReplies.getByRole("button", { name: "Start with project search", exact: true })).toHaveCount(0);
    const sessionContext = live.getByLabel("Session context", { exact: true });
    await expect(sessionContext).toContainText("Started 2 days ago · 2 context compactions");
    await sessionContext.getByRole("button", { name: "Start fresh with a handoff…" }).click();
    const handoff = page.getByRole("dialog", { name: "Start new session with context", exact: true });
    await expect(handoff).toContainText("Your original session stays open.");
    await handoff.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(live.getByRole("columnheader", { name: "Area" })).toBeVisible();
    await expect(live.getByRole("cell", { name: "Checked" })).toBeVisible();
    const initialPreviewSize = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    await page.setViewportSize({ width: 1450, height: 950 });
    const timeline = live.getByRole("navigation", { name: "Recent turns", exact: true });
    const earlierTurn = timeline.getByRole("button", { name: /Inspect the checkout/ });
    await expect(earlierTurn).toContainText("Checkout inspected.");
    await earlierTurn.click();
    await expect(earlierTurn).toHaveAttribute("aria-current", "true");
    await expect(earlierTurn).not.toContainText("Checkout inspected.");
    await expect(live.locator(".dashboard-briefing")).toContainText("Checkout inspected.");
    await timeline.getByRole("button", { name: /Latest.*Check the mobile layout/ }).click();
    await expect(live.locator(".dashboard-briefing")).toContainText("Ready for the next instruction.");
    await page.setViewportSize({ width: 780, height: 850 });
    await expect(timeline).toBeHidden();
    const turns = live.getByRole("navigation", { name: "Recent turn controls" });
    await turns.getByRole("button", { name: "Previous turn" }).click();
    await expect(turns).toContainText("Turn 1 of 2");
    await expect(live.locator(".dashboard-briefing").getByText("Inspect the checkout.", { exact: true })).toBeVisible();
    await expect(live.locator(".dashboard-briefing").getByText("Checkout inspected.", { exact: true })).toBeVisible();
    await expect(live.getByText("What needs you", { exact: true })).toHaveCount(0);
    await expect(turns.getByRole("button", { name: "Previous turn" })).toBeDisabled();
    await turns.getByRole("button", { name: "Next turn" }).click();
    await expect(turns).toContainText("Latest");
    await turns.getByRole("button", { name: "Previous turn" }).click();
    await turns.getByRole("button", { name: "Back to latest" }).click();
    await expect(turns).toContainText("Latest");
    await page.setViewportSize(initialPreviewSize);
    const references = live.getByRole("region", { name: "Referenced files and links" });
    await references.getByRole("button", { name: "View Release notes", exact: true }).click();
    const filePreview = page.getByRole("dialog", { name: "File preview" });
    const reader = filePreview.getByRole("article", { name: "Markdown document" });
    await expect(filePreview.getByRole("heading", { name: "Release notes.md" })).toBeVisible();
    await expect(reader.getByRole("heading", { name: "Release checklist" })).toBeVisible();
    await expect(filePreview.getByRole("listitem").filter({ hasText: "Verify the mobile layout." })).toBeVisible();
    await expect(filePreview.getByRole("columnheader", { name: "Area" })).toBeVisible();
    await expect(filePreview.getByRole("cell", { name: "Dashboard" })).toBeVisible();
    await expect(filePreview.getByRole("checkbox")).toBeChecked();
    await expect(filePreview.getByRole("checkbox")).toBeDisabled();
    await expect(filePreview.locator("blockquote")).toHaveText("Review before publishing.");
    await expect(filePreview.locator("pre code")).toContainText("npm test");
    await expect(filePreview.getByRole("link", { name: "Release site" })).toBeVisible();
    await expect(filePreview.locator("img, script")).toHaveCount(0);
    await filePreview.getByRole("link", { name: "Release site" }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as any).openedReplyLink)).toBe("https://example.test/markdown");
    await reader.focus();
    await page.keyboard.press("End");
    await expect.poll(() => reader.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(filePreview.getByRole("button", { name: "Close file preview" })).toBeInViewport();
    await filePreview.getByRole("button", { name: "Close file preview" }).click();
    await expect(references.getByRole("button", { name: "View Release notes", exact: true })).toBeFocused();
    const citation = live.getByRole("button", { name: path.basename(externalFile), exact: true });
    await expect(citation).toHaveAttribute("title", externalFile);
    await citation.click();
    await expect(filePreview.getByRole("alert")).toHaveText("Preview is available for files inside this session’s project.");
    await filePreview.getByRole("button", { name: process.platform === "darwin" ? "Show in Finder" : "Show in folder" }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as any).revealedReplyFile)).toBe(fs.realpathSync(externalFile));
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
      if (size.width === 800 && size.height === 550)
        await page.screenshot({ path: testInfo.outputPath("selected-session-narrow.png") });
    }
    for (const fullscreen of [true, false]) {
      const [width, height] = await app.evaluate(async ({ BrowserWindow }, enabled) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (window.isFullScreen() !== enabled) {
          await new Promise<void>((resolve) => {
            window.once(enabled ? "enter-full-screen" : "leave-full-screen", () => resolve());
            window.setFullScreen(enabled);
          });
        }
        return window.getContentSize();
      }, fullscreen);
      await page.setViewportSize({ width, height });
      await expect.poll(panelGap).toBeGreaterThanOrEqual(0);
      if (fullscreen) await page.screenshot({ path: testInfo.outputPath("selected-session-fullscreen.png") });
    }
    await page.setViewportSize(originalViewport);
    await projectsControl.click();
    const projectPanel = dashboard().getByRole("group", { name: "Choose projects" });
    await expect(projectPanel.getByRole("searchbox", { name: "Search projects" })).toBeFocused();
    await expect(projectPanel.getByRole("button", { name: "Filter live sessions", exact: true })).toBeVisible();
    await expect(projectPanel.getByRole("checkbox")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(projectsControl).toBeFocused();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(projectPanel.getByRole("searchbox", { name: "Search conversations" })).toBeFocused();
    await expect(projectPanel.getByRole("heading", { name: "Find a project or conversation" })).toHaveCount(0);
    const pickerBounds = (await projectPanel.boundingBox())!;
    expect(Math.abs(pickerBounds.x - (await projectsControl.boundingBox())!.x)).toBeLessThanOrEqual(1);
    await app.evaluate(({ BrowserWindow }, sessions) => {
      BrowserWindow.getAllWindows()[0].webContents.send("event", { event: "store", sessions });
    }, [rows[0], { ...rows[1], terminalId: liveTerminal.id, state: "idle" }]);
    const pickerSearch = projectPanel.getByRole("searchbox", { name: "Search conversations" });
    await pickerSearch.fill("visual review");
    const pickerMatch = projectPanel.getByRole("region", { name: "Conversation matches" })
      .getByRole("button", { name: /Review layout.*visual review/i });
    await expect(pickerMatch).toBeVisible();
    for (let tab = 0; tab < 12 && !await pickerMatch.evaluate((element) => element === document.activeElement); tab++)
      await page.keyboard.press("Tab");
    await expect(pickerMatch).toBeFocused();
    await expect(pickerMatch).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Recent session details" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(pickerSearch).toHaveValue("visual review");
    await expect(pickerMatch).toBeFocused();
    await pickerSearch.clear();
    await page.keyboard.press("Escape");
    await expect(viewport.getByRole("definition").filter({ hasText: "Ready for the next instruction." })).toBeVisible();
    const switchboardHeight = (await switchboard.boundingBox())!.height;
    await expect(live.getByRole("button", { name: /Expand detail|Hide session list|Show session list/ })).toHaveCount(0);
    await app.evaluate(({ BrowserWindow }, session) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      for (let i = 1; i <= 6; i++) {
        wc.send("event", { event: "store", sessions: [{ ...session, updated: i + 1, state: "working" }] });
      }
    }, { ...rows[1], terminalId: liveTerminal.id });
    const working = live.getByRole("img", { name: "Working", exact: true });
    await expect(working).toBeVisible();
    const draft = live.getByRole("textbox", { name: "Follow-up", exact: true });
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir });
    git("init", "-q");
    fs.writeFileSync(path.join(dir, ".git", "info", "exclude"), "/*\n!/Review.txt\n!/Pending.txt\n!/unchanged.txt\n");
    fs.writeFileSync(path.join(dir, "Review.txt"), "Old text\n");
    fs.writeFileSync(path.join(dir, "unchanged.txt"), "Original\n");
    fs.writeFileSync(path.join(dir, "Pending.txt"), "Pending baseline\n");
    git("add", "Review.txt", "Pending.txt", "unchanged.txt");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "Baseline");
    fs.writeFileSync(path.join(dir, "unchanged.txt"), "Unrelated pending edit\n");
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
    if (process.platform !== "win32") {
      const queueFollowUp = live.getByRole("button", { name: "Queue follow-up", exact: true });
      await queueFollowUp.click();
      await expect(live.getByText("Queued · sends when the agent is ready")).toBeVisible();
      await expect(live.getByText("2 screenshots queued with follow-up", { exact: true })).toBeVisible();
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send("event", { event: "screenshot",
          screenshot: { id: "queued-shot", name: "Queued.png", thumbnail: "" },
        });
      });
      const queuedPopup = dashboard().getByRole("complementary", { name: "Screenshot taken" });
      const addQueued = queuedPopup.getByRole("button", { name: "Add to follow-up draft" });
      await expect(addQueued).toBeDisabled();
      await expect(addQueued).toHaveAccessibleDescription(/Cancel the queued follow-up/);
      await live.getByRole("button", { name: "Cancel queue" }).click();
      await expect(addQueued).toBeEnabled();
      await queuedPopup.getByRole("button", { name: "Dismiss", exact: true }).click();
      await expect(live.getByText("2 screenshots attached to draft", { exact: true })).toBeVisible();
      await expect(screenshots.getByRole("listitem")).toHaveCount(2);
      await queueFollowUp.click();
    }
    const activityToolbar = live.locator(".dashboard-live-session:visible .dashboard-live-toolbar");
    await expect.poll(() => activityToolbar.evaluate((element) => getComputedStyle(element, "::after").animationName))
      .toBe("dashboard-header-sweep");
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
    await activityToolbar.screenshot({ path: testInfo.outputPath("active-header-working.png"), animations: "disabled" });
    await expect(meterBar).toHaveCSS("animation-name", "dashboard-meter-beat");
    await dashboard().locator(".dashboard-masthead").screenshot({ path: "test-results/preview-huddle-working.png" });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(meterBar).toHaveCSS("animation-name", "none");
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
    if (process.platform === "win32") await live.getByRole("button", { name: "Send follow-up" }).click();
    else {
      await expect(live.getByText("Queued. Waiting for an empty terminal prompt.")).toBeVisible();
      await expect(live.getByRole("button", { name: "Check terminal prompt" })).toBeVisible();
      expect(await app.evaluate(() => (globalThis as any).followUpQueueFixture.attempts)).toBe(0);
      await app.evaluate(() => { (globalThis as any).followUpQueueFixture.ready = true; });
    }


    await expect(live.getByText("Follow-up sent.")).toBeVisible();
    expect(await app.evaluate(() => (globalThis as any).followUpQueueFixture.sent)).toBe(1);
    if (process.platform !== "win32")
      expect(await app.evaluate(() => (globalThis as any).followUpQueueFixture.attempts)).toBe(2);
    await expect(live.locator(".dashboard-briefing dd").filter({ hasText: "Review the desktop layout next." })).toBeVisible();
    await expect(live.getByText("Waiting for the agent’s next recorded update.", { exact: true })).toBeVisible();
    await expect(live.getByText("2 screenshots attached", { exact: true })).toBeVisible();
    await expect(screenshots).toHaveCount(0);
    fs.writeFileSync(path.join(dir, "Review.txt"), "Desktop layout verified.\n");
    git("add", "Review.txt");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "Verify desktop layout");
    fs.writeFileSync(path.join(dir, "Pending.txt"), "Still uncommitted.\n");
    const capturedInstructionAt = Date.now();
    await app.evaluate((_electron, at) => { (globalThis as any).completedTurnAt = at; }, capturedInstructionAt);
    await expect(live.getByRole("definition").filter({ hasText: "Desktop layout verified." })).toBeVisible();
    await expect(quickReplies).toHaveCount(0);
    await app.evaluate(() => { (globalThis as any).remainingPickerWork = " Project card polish is still open."; });
    await quickReplies.getByRole("button", { name: "Project card polish", exact: true }).click();
    await expect(quickDraft).toHaveValue("Please continue with the remaining work: Project card polish.");
    await quickDraft.fill("");
    await app.evaluate(() => {
      (globalThis as any).remainingPickerWork = " I’d put the actual saved next step on the card as one short line. For a project with history and no saved next step, I’d make **Browse history** visible on the card. No app changes were made in this test.";
    });
    await expect(quickReplies.getByRole("button", { name: /Put the actual saved next step on the card/ })).toBeVisible();
    await quickReplies.getByRole("button", { name: "Make Browse history visible on the card", exact: true }).click();
    await expect(quickDraft).toHaveValue("For a project with history and no saved next step, please make Browse history visible on the card.");
    await quickDraft.fill("");
    await app.evaluate(() => {
      (globalThis as any).remainingPickerWork = " Next step: Make duplicate session titles easier to distinguish in Recent and highlight matching excerpts in conversation search.";
    });
    await quickReplies.getByRole("button", { name: "Use next step", exact: true }).click();
    await expect(quickDraft).toHaveValue("Please proceed with the next step you proposed: Make duplicate session titles easier to distinguish in Recent and highlight matching excerpts in conversation search.");
    await quickDraft.fill("");
    const actualSnapshot = await page.evaluate((cwd) => window.runhuddle.gitTurnSnapshot(cwd), dir);
    expect(actualSnapshot?.entries.map(({ file }) => file.path).sort()).toEqual(["Pending.txt", "unchanged.txt"]);
    await expect.poll(() => page.evaluate(({ sessionID, id }) =>
      window.runhuddle.liveSessionPreview("Codex", sessionID, id).then((turn) => turn.instructionAt),
      liveTerminal)).toBe(capturedInstructionAt);
    await expect(live.getByRole("region", { name: "Referenced files and links" })
      .getByRole("button", { name: "View Release notes", exact: true })).toBeVisible();
    const turnReferences = live.getByRole("region", { name: "Referenced files and links" });
    await turnReferences.getByRole("button", { name: "View Release notes", exact: true }).click();
    await expect(filePreview.getByRole("heading", { name: "Release checklist" })).toBeVisible();
    await filePreview.getByRole("button", { name: "Close file preview" }).click();
    await turnReferences.getByRole("button", { name: "Open release site in default browser" }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as any).openedReplyLink)).toBe("https://example.test/release");
    const turnChangesButton = live.getByRole("button", { name: "Turn changes 2 files" });
    await expect(turnChangesButton).toHaveCount(0);
    await expect(live.getByText("Review.txt", { exact: true })).toHaveCount(0);
    const previewLayout = live.getByRole("button", { name: "Preview layout" });
    await expect(previewLayout).toHaveText("");
    await expect(previewLayout).toHaveAttribute("data-tooltip", "Preview layout");
    await previewLayout.click();
    const previewSections = live.getByRole("group", { name: "Preview sections" });
    const showTurnChanges = previewSections.getByRole("checkbox", { name: "Turn changes" });
    await expect(showTurnChanges).not.toBeChecked();
    await showTurnChanges.check();
    await page.keyboard.press("Escape");
    await turnChangesButton.click();
    const turnChanges = page.getByRole("dialog", { name: "Changed during this turn" });
    await expect(turnChanges.getByRole("group", { name: "Committed", exact: true }).getByText("Review.txt", { exact: true })).toBeVisible();
    await expect(turnChanges.getByRole("group", { name: "Uncommitted", exact: true }).getByText("Pending.txt", { exact: true })).toBeVisible();
    await expect(turnChanges.getByText("unchanged.txt", { exact: true })).toHaveCount(0);
    await turnChanges.getByRole("button", { name: "View diff for Review.txt" }).click();
    const capturedDiff = page.getByRole("dialog", { name: "Captured checkout diff" });
    await expect(capturedDiff.getByText("Diff between the commits at the start and end of this turn.")).toBeVisible();
    await expect(capturedDiff.getByLabel("File diff", { exact: true })).toContainText("Desktop layout verified.");
    await expect(capturedDiff.getByRole("group", { name: "Diff layout" })).toBeVisible();
    await capturedDiff.getByRole("button", { name: "Back to files" }).click();
    await expect(turnChanges.getByRole("button", { name: "View diff for Review.txt" })).toBeVisible();
    await turnChanges.getByRole("button", { name: "View diff for Review.txt" }).click();
    await capturedDiff.getByRole("button", { name: "Close diff" }).click();
    await app.evaluate(() => { delete (globalThis as any).completedTurnAt; });
    await expect(live.getByRole("button", { name: "Open in workspace", exact: true })).toHaveCount(0);
    await expect(live.getByRole("button", { name: "Rename session…", exact: true })).toBeVisible();
    await live.getByRole("button", { name: "Changes", exact: true }).click();
    await expect(live.getByRole("button", { name: "Open in workspace", exact: true })).toHaveCount(0);
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
      const fixture = { working: true, published: false, emptyComparison: true, actions: [] as unknown[] };
      ipcMain.removeHandler("installed-review-agents");
      ipcMain.handle("installed-review-agents", () => ["codex"]);
      ipcMain.removeHandler("draft-git-pull-request");
      ipcMain.handle("draft-git-pull-request", (_event, cwd, target, agent, source) => {
        if (cwd !== first.cwd || target !== "refs/heads/develop" || agent !== "codex" ||
            source?.provider !== "Codex" || source?.sessionID !== first.sessionID) throw Error("Wrong drafting context");
        return { title: "Preserve review position", body: "## Changes\n- Keeps the visible diff line when the file is edited." };
      });
      ipcMain.removeHandler("prepare-git-pull-request");
      ipcMain.handle("prepare-git-pull-request", (_event, cwd, target) => {
        if (cwd !== first.cwd || target !== "refs/heads/develop") throw Error("Wrong PR target");
        return { head: "feature", target: "develop", title: "Review dashboard", body: "## Commits\n- Update the dashboard", unpublished: 1 };
      });
      ipcMain.removeHandler("open-git-pull-request");
      ipcMain.handle("open-git-pull-request", (_event, cwd, target, fields) => {
        if (!(globalThis as any).retryOpenPullRequest) {
          (globalThis as any).retryOpenPullRequest = true;
          throw Error("Browser could not open.");
        }
        if (cwd !== first.cwd || target !== "refs/heads/develop") throw Error("Wrong PR destination");
        Object.assign(globalThis, { openedGitPullRequest: fields });
      });

      Object.assign(globalThis, { gitBarFixture: fixture });
      ipcMain.removeHandler("git-repository-actions");
      ipcMain.handle("git-repository-actions", () => ({
        remotes: ["origin"], refs: ["refs/heads/develop", "refs/heads/main"],
        sessions: [{ title: first.title, working: fixture.working }],
      }));
      ipcMain.removeHandler("git-action");
      ipcMain.handle("git-action", (_event, cwd, action, options) => {
        if (cwd !== first.cwd || options.expectedBranch !== "feature") throw Error("Wrong checkout");
        fixture.actions.push([action, options]);
        if (action === "publish") fixture.published = true;
        return { root: cwd, branch: "feature", files: [] };
      });
      ipcMain.removeHandler("git-changes");
      ipcMain.handle("git-changes", (_event, _cwd, mode, _revision, compareRef) => ({
        root: first.cwd, branch: "feature", uncommittedFiles: 5, base: "1".repeat(40),
        upstream: fixture.published ? "origin/feature" : undefined,
        comparison: mode === "compare" ? { refs: ["refs/heads/main", "refs/heads/develop"], targetRef: compareRef || "refs/heads/main" } : undefined,
        files: mode === "compare" ? Array.from({ length: fixture.emptyComparison && compareRef === "refs/heads/develop" ? 0 : 434 }, (_, i) => ({ path: `file-${i}.txt`, status: "M", area: "committed" }))
          : ["fixture.txt", "second.txt", "third.txt", "fourth.txt", "fifth.txt"].map((path) =>
            ({ path, status: "M", area: "unstaged", additions: 201, deletions: 0 })) }));
      ipcMain.removeHandler("git-diff");
      ipcMain.handle("git-diff", () => {
        const prefix = (globalThis as any).diffRefreshPrefix ?? "";
        return "@@ -1,1 +1,200 @@\n- Before edit\n" + prefix +
          Array.from({ length: 200 }, (_, i) => "+ line " + i).join("\n") +
          "\n@@ -250,0 +450 @@\n+ second hunk";
      });
    }, liveTerminal);
    await updateAttentionFixture();
    await expect(live.getByRole("navigation", { name: "Live session list" }).getByRole("button", { name: /^Inspect / })).toHaveCount(6);
    const originalDraft = live.getByRole("textbox", { name: "Follow-up", exact: true });
    await originalDraft.fill("Keep this draft while I handle two requests.");
    await live.getByRole("button", { name: "Changes", exact: true }).click();
    const changesPane = live.getByRole("complementary", { name: "Project changes" });
    const branchButton = live.getByRole("button", { name: "Git branch: feature" });
    await branchButton.click();
    const branchDialog = page.getByRole("dialog", { name: "Git branches" });
    await expect(branchDialog.getByText("Sessions sharing this checkout")).toBeVisible();
    await expect(branchDialog.getByText("Wait for working sessions before switching branches.")).toBeVisible();
    await expect(branchDialog.getByRole("button", { name: /^Switch/ })).toHaveCount(1);
    await branchDialog.getByRole("button", { name: "New branch…" }).click();
    await branchDialog.getByRole("textbox", { name: "Branch name" }).fill("feature/dashboard");
    await branchDialog.getByRole("combobox", { name: "Start from" }).selectOption("refs/heads/develop");
    await expect(branchDialog.getByRole("button", { name: "Create and switch" })).toBeDisabled();
    await branchDialog.getByRole("button", { name: "Close Git actions" }).click();
    await app.evaluate(() => { (globalThis as any).gitBarFixture.working = false; });
    await branchButton.click();
    await branchDialog.getByRole("button", { name: "New branch…" }).click();
    await branchDialog.getByRole("textbox", { name: "Branch name" }).fill("feature/dashboard");
    await branchDialog.getByRole("combobox", { name: "Start from" }).selectOption("refs/heads/develop");
    await branchDialog.getByRole("button", { name: "Create and switch" }).click();
    await expect(branchDialog).toHaveCount(0);
    await live.getByRole("button", { name: "Git remote actions" }).click();
    const remoteDialog = page.getByRole("dialog", { name: "Git remote actions" });
    await expect(remoteDialog.getByText("Unpublished", { exact: true })).toBeVisible();
    await expect(remoteDialog.getByRole("button", { name: "Publish branch", exact: true })).toHaveClass("primary");
    await remoteDialog.getByRole("button", { name: "Publish branch", exact: true }).click();
    await expect(remoteDialog).toHaveCount(0);
    await expect(live.getByRole("button", { name: "Prepare PR…" })).toBeVisible();
    expect(await app.evaluate(() => (globalThis as any).gitBarFixture.actions)).toEqual([
      ["create-branch", { name: "feature/dashboard", ref: "refs/heads/develop", expectedBranch: "feature", confirmCheckout: true }],
      ["publish", { remote: "origin", expectedBranch: "feature", confirmCheckout: true }],
    ]);

    await changesPane.getByRole("combobox", { name: "Review scope" }).selectOption("compare");
    await expect(changesPane.getByText("Committed · 434")).toBeVisible();
    const branchTarget = changesPane.getByRole("combobox", { name: "Compare against" });
    await branchTarget.selectOption("refs/heads/develop");
    await expect(changesPane.getByText(/feature → develop/)).toBeVisible();
    await expect(changesPane.getByText("5 files have uncommitted changes outside this comparison.")).toBeVisible();
    await expect(changesPane.getByText("No committed changes since the branches diverged.")).toBeVisible();
    await changesPane.getByRole("button", { name: "Uncommitted 5", exact: true }).click();
    await expect(changesPane.getByRole("combobox", { name: "Review scope" })).toBeFocused();
    await expect(changesPane.getByRole("combobox", { name: "Review scope" })).toHaveValue("working");
    await app.evaluate(() => { (globalThis as any).gitBarFixture.emptyComparison = false; });
    await changesPane.getByRole("combobox", { name: "Review scope" }).selectOption("compare");
    await expect(branchTarget).toHaveValue("refs/heads/develop");
    await live.getByRole("button", { name: "Preview", exact: true }).click();
    const checkoutSummary = live.getByRole("button", { name: /Uncommitted.*5 files changed/ });
    await expect(checkoutSummary).toContainText("+1,005");
    await expect(checkoutSummary).toContainText("−0");
    await expect(live.locator(".dashboard-preview-sidebar > :first-child")).toHaveClass("dashboard-change-summary");
    await checkoutSummary.click();
    await expect(changesPane.getByRole("combobox", { name: "Review scope" })).toHaveValue("working");
    await changesPane.getByRole("combobox", { name: "Review scope" }).selectOption("working");
    await changesPane.getByRole("combobox", { name: "Review scope" }).selectOption("compare");
    await expect(branchTarget).toHaveValue("refs/heads/develop");
    await live.getByRole("button", { name: "Prepare PR…" }).click();
    const pr = page.getByRole("dialog", { name: "Prepare pull request" });
    await expect(pr.getByRole("textbox", { name: "Title" })).toHaveValue("Review dashboard");
    await expect(pr.getByText("feature → develop")).toBeVisible();
    await expect(pr.getByText("1 local commit is outside the published branch.")).toBeVisible();
    await pr.getByText("Draft with an agent", { exact: true }).click();
    const includeContext = pr.getByRole("checkbox", { name: "Include recent context from this session" });
    await expect(includeContext).not.toBeChecked();
    await includeContext.check();
    await pr.getByRole("button", { name: "Generate PR summary" }).click();
    await expect(pr.getByRole("textbox", { name: "Title" })).toHaveValue("Preserve review position");
    await expect(pr.getByRole("textbox", { name: /^Description/ })).toHaveValue(/Keeps the visible diff line/);
    await pr.getByRole("textbox", { name: "Title" }).fill("Tighten dashboard review");
    await pr.getByRole("textbox", { name: /^Description/ }).fill("## Testing\n- Reviewed locally.");
    await pr.getByRole("button", { name: "Open in GitHub" }).click();
    await expect(pr.getByRole("alert")).toContainText("Browser could not open.");
    await expect(pr.getByRole("textbox", { name: "Title" })).toHaveValue("Tighten dashboard review");
    await expect(pr.getByRole("textbox", { name: /^Description/ })).toHaveValue("## Testing\n- Reviewed locally.");
    await pr.getByRole("button", { name: "Open in GitHub" }).click();
    await expect(pr.getByRole("status")).toHaveText("Draft opened in GitHub.");
    await expect.poll(() => app.evaluate(() => (globalThis as any).openedGitPullRequest)).toEqual({
      head: "feature", title: "Tighten dashboard review", body: "## Testing\n- Reviewed locally.",
    });
    await pr.getByRole("button", { name: "Close", exact: true }).click();

    await app.evaluate(({ ipcMain, shell }) => {
      const original = shell.openExternal;
      shell.openExternal = async (url) => {
        (globalThis as any).githubTokenSetupURL = url;
        shell.openExternal = original;
      };
      ipcMain.removeHandler("github-mcp-settings");
      ipcMain.handle("github-mcp-settings", () => ({ configured: false, secureStorage: true }));
      ipcMain.removeHandler("github-branch-pr");
      ipcMain.handle("github-branch-pr", () => ({ status: "not-configured" }));
    });
    await live.getByRole("button", { name: "Refresh changes" }).click();
    await live.getByRole("button", { name: "Connect GitHub…" }).click();
    const mcp = page.getByRole("dialog", { name: "GitHub MCP" });
    await expect(mcp.getByText("GitHub is not connected")).toBeVisible();
    await mcp.getByText("Token setup", { exact: true }).click();
    await expect(mcp.getByText("Commit statuses", { exact: true })).toBeVisible();
    await mcp.getByRole("button", { name: /Create fine-grained token/ }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as any).githubTokenSetupURL))
      .toBe("https://github.com/settings/personal-access-tokens/new");
    await mcp.getByRole("button", { name: "Close GitHub MCP" }).click();
    const menuItem = await app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()?.items.find((menu) => menu.label === "Integrations")
        ?.submenu?.getMenuItemById("dashboard-mcp-settings");
      item?.click();
      return item?.label;
    });
    expect(menuItem).toBe("GitHub MCP…");
    await expect(mcp).toBeVisible();
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("save-github-mcp");
      ipcMain.handle("save-github-mcp", () => ({ configured: true, secureStorage: true }));
      ipcMain.removeHandler("verify-github-mcp");
      ipcMain.handle("verify-github-mcp", () => { throw new Error("GitHub denied access."); });
    });
    await mcp.locator('input[type="password"]').fill("github_pat_fixture");
    await mcp.getByRole("button", { name: "Save GitHub token" }).click();
    await expect(mcp.getByRole("status")).toContainText("Connection could not be verified");
    await expect(mcp.getByRole("status")).toContainText("GitHub denied access.");
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("verify-github-mcp");
      ipcMain.handle("verify-github-mcp", () => "fixture-user");
    });
    await mcp.getByRole("button", { name: "Check connection" }).click();
    await expect(mcp.getByRole("status")).toContainText("GitHub connected");
    await expect(mcp.getByRole("status")).toContainText("Signed in as fixture-user");
    await expect(mcp.getByRole("region", { name: "Token setup" })).toHaveCount(0);
    await mcp.getByRole("button", { name: "Done" }).click();
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("github-actions-failure");
      ipcMain.handle("github-actions-failure", (_event, _cwd, url) => {
        if (url.endsWith("/job/2")) throw new Error("Actions read access is required.");
        return { workflow: "Electron CI", job: "Build", step: "Install dependencies",
          excerpt: ["npm error Missing dependency"], logsUnavailable: false };
      });
      ipcMain.removeHandler("github-branch-pr");
      ipcMain.handle("github-branch-pr", () => ({
        status: "found",
        pr: {
          number: 42, title: "Preserve review position", head: "feature", target: "develop",
          url: "https://github.com/example/demo/pull/42", review: "Changes requested",
          checksState: "Checks failed", checks: [
            { name: "Build", state: "failure", url: "https://github.com/example/demo/actions/runs/123/job/1" },
            { name: "Build", state: "failure", url: "https://github.com/example/demo/actions/runs/456/job/2" },
          ],
          feedback: [{ author: "reviewer", path: "fixture.txt", line: 7, text: "Cover the restored diff position." }],
        },
      }));
    });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    const prCard = live.getByRole("button", { name: /PR #42.*Preserve review position.*Checks failed/ });
    await expect(prCard.getByText("Preserve review position", { exact: true })).toBeVisible();
    await expect(prCard.getByText("Checks failed", { exact: true })).toHaveAttribute("data-tone", "error");
    await prCard.click();
    const pullRequest = page.getByRole("dialog", { name: "GitHub pull request" });
    await expect(pullRequest.getByText("feature → develop")).toBeVisible();
    await expect(pullRequest.getByRole("listitem").filter({ hasText: "Actions run #123" })
      .getByRole("button", { name: "View job log" })).toBeVisible();
    await expect(pullRequest.getByRole("listitem").filter({ hasText: "Actions run #456" })
      .getByRole("button", { name: "View job log" })).toBeVisible();
    const failedJob = pullRequest.getByRole("listitem").filter({ hasText: "Actions run #123" });
    await expect(failedJob).toContainText("Electron CI · Failed step: Install dependencies");
    await expect(failedJob).toContainText("npm error Missing dependency");
    const secondJob = pullRequest.getByRole("listitem").filter({ hasText: "Actions run #456" });
    await secondJob.getByRole("button", { name: "Show failure details" }).click();
    await expect(secondJob).toContainText("Actions read access is required.");
    await failedJob.getByRole("button", { name: "Draft follow-up" }).click();
    await expect(originalDraft).toHaveValue(/Install dependencies.*npm error Missing dependency.*actions\/runs\/123\/job\/1/s);
    await originalDraft.fill("Keep this draft while I handle two requests.");
    await live.getByRole("button", { name: "Changes", exact: true }).click();
    await prCard.click();
    await pullRequest.getByRole("listitem").filter({ hasText: "Cover the restored diff position." })
      .getByRole("button", { name: "Draft follow-up" }).click();
    await expect(originalDraft).toHaveValue(/^Keep this draft while I handle two requests\..*Cover the restored diff position\./s);
    await originalDraft.fill("Keep this draft while I handle two requests.");
    await live.getByRole("button", { name: "Changes", exact: true }).click();

    await changesPane.locator(".changes-repo").hover();
    const dashboardScrollTop = () => dashboard().evaluate((element) => element.scrollTop);
    const listPagePosition = await dashboardScrollTop();
    await page.mouse.wheel(0, 400);
    await expect.poll(() => changesPane.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await dashboardScrollTop()).toBe(listPagePosition);
    await changesPane.getByRole("combobox", { name: "Review scope" }).selectOption("working");
    const beforeReviewViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    await page.setViewportSize({ width: 1470, height: 950 });
    const changedFiles = changesPane.getByRole("navigation", { name: "Changed files" });
    await changedFiles.getByRole("button", { name: /^M fixture.txt/ }).click();
    await expect(changedFiles).toBeVisible();
    await expect(changedFiles.locator(".change-line-count").first()).toHaveText("+201−0");
    const review = live.getByRole("region", { name: "Diff review" });
    const fileNavigation = review.getByRole("group", { name: "Navigate files" });
    for (const [index, path] of ["second.txt", "third.txt", "fourth.txt", "fifth.txt"].entries()) {
      await fileNavigation.getByRole("button", { name: "Next file" }).click();
      await expect(review.locator("header strong")).toHaveText(path);
      await expect(fileNavigation).toContainText(`${index + 2} / 5`);
    }
    await expect(fileNavigation.getByRole("button", { name: "Next file" })).toBeDisabled();
    await fileNavigation.getByRole("button", { name: "Previous file" }).click();
    await expect(review.locator("header strong")).toHaveText("fourth.txt");
    await page.setViewportSize({ width: 700, height: 650 });
    await expect(changesPane).toBeHidden();
    await review.getByRole("button", { name: "Back to files" }).click();
    await expect(changesPane).toBeVisible();
    await changedFiles.getByRole("button", { name: /^M fixture.txt/ }).click();
    await page.setViewportSize(beforeReviewViewport);
    const hunks = review.getByRole("group", { name: "Navigate changes" });
    await expect(hunks).toContainText("Hunk 1 of 2");
    await hunks.getByRole("button", { name: "Next change" }).click();
    await expect(hunks).toContainText("Hunk 2 of 2");
    await hunks.getByRole("button", { name: "Previous change" }).click();
    await expect(hunks).toContainText("Hunk 1 of 2");
    const layout = review.getByRole("group", { name: "Diff layout" });
    await layout.getByRole("button", { name: "Split" }).click();
    await expect(review.getByRole("columnheader", { name: "Before" })).toBeVisible();
    await expect(review.getByRole("columnheader", { name: "After" })).toBeVisible();
    await expect(review.getByRole("row").filter({ hasText: "Before edit" })).toContainText("line 0");
    await review.getByLabel("File diff", { exact: true }).press("F7");
    await expect(hunks).toContainText("Hunk 2 of 2");
    await review.getByLabel("File diff", { exact: true }).press("F7");
    await expect(review.locator("header strong")).toHaveText("second.txt");
    await expect(hunks).toContainText("Hunk 1 of 2");
    await review.getByLabel("File diff", { exact: true }).press("Shift+F7");
    await expect(review.locator("header strong")).toHaveText("fixture.txt");
    await expect(hunks).toContainText("Hunk 2 of 2");
    await layout.getByRole("button", { name: "Unified" }).click();
    await live.getByLabel("File diff", { exact: true }).evaluate((element) => { element.scrollTop = 0; });
    const diff = live.getByLabel("File diff", { exact: true });
    await expect(diff.getByText("+ line 199", { exact: true })).toBeVisible();
    await diff.hover();
    const diffPagePosition = await dashboardScrollTop();
    await page.mouse.wheel(0, 250);
    await expect.poll(() => diff.evaluate((element) => element.scrollTop)).toBe(250);
    expect(await dashboardScrollTop()).toBe(diffPagePosition);
    const anchoredLine = diff.getByText("+ line 14", { exact: true });
    const beforeRefresh = (await anchoredLine.boundingBox())!.y;
    const refreshDiff = (prefix: string) => app.evaluate(({ BrowserWindow }, { cwd, prefix }) => {
      (globalThis as any).diffRefreshPrefix = prefix;
      BrowserWindow.getAllWindows()[0].webContents.send("event", { event: "git", cwd });
    }, { cwd: liveTerminal.cwd, prefix });
    await refreshDiff("+ inserted above\n+ another insert\n");
    await expect(diff.getByText("+ inserted above", { exact: true })).toBeVisible();
    expect((await anchoredLine.boundingBox())!.y).toBeCloseTo(beforeRefresh, 0);
    await refreshDiff("");
    await expect(diff.getByText("+ inserted above", { exact: true })).toHaveCount(0);
    await expect.poll(() => diff.evaluate((element) => element.scrollTop)).toBe(250);
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
    const matrixViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    async function applyDashboardTheme(theme: "light" | "dark" | "system") {
      await app.evaluate(({ BrowserWindow, Menu }, nextTheme) => {
        const item = Menu.getApplicationMenu()!.getMenuItemById("app-theme-" + nextTheme)!;
        item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent);
      }, theme);
      await expect(page.locator("html")).toHaveAttribute("data-app-theme", theme);
    }
    const accentColor = (hex: string) => page.evaluate((value) => window.runhuddle.setAppAccent(value), hex);
    const dashboardExtent = () => dashboard().evaluate((element) => ({
      vertical: element.scrollHeight - element.clientHeight,
      horizontal: element.scrollWidth - element.clientWidth,
    }));
    await page.screenshot({ path: testInfo.outputPath("dashboard-before-matrix.png") });
    for (const theme of ["light", "dark"] as const) {
      await applyDashboardTheme(theme);
      for (const [accent, hex] of [["default", "#8fcbd0"], ["custom", "#ca5077"]] as const) {
        await accentColor(hex);
        await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement)
          .getPropertyValue("--app-accent-base").trim())).toBe(hex);
        await page.setViewportSize(accent === "default" ? { width: 1280, height: 800 } : { width: 800, height: 550 });
        await expect(liveBrowser.getByRole("textbox", { name: "Browser address" })).toBeInViewport();
        await expect.poll(dashboardExtent).toEqual({ vertical: 0, horizontal: 0 });
        await expect.poll(() => dashboard().evaluate((element) => {
          const pairs = [
            ...Array.from(element.querySelectorAll(".dashboard-rail-meta")).map((meta) =>
              [meta.querySelector(".session-status"), meta.querySelector("time")]),
            [element.querySelector(".diff-review-toolbar .editor-control"), element.querySelector(".diff-file-navigation")],
          ];
          return pairs.every(([a, b]) => {
            if (!a?.getClientRects().length || !b?.getClientRects().length) return true;
            const first = a.getBoundingClientRect();
            const second = b.getBoundingClientRect();
            return first.right <= second.left + 1 || second.right <= first.left + 1 ||
              first.bottom <= second.top + 1 || second.bottom <= first.top + 1;
          });
        })).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`dashboard-${theme}-${accent}.png`) });
      }
    }
    await accentColor("#8fcbd0");
    await applyDashboardTheme("system");
    for (const fullscreen of [true, false]) {
      await app.evaluate(async ({ BrowserWindow }, enabled) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (window.isFullScreen() === enabled) return;
        await new Promise<void>((resolve) => {
          window.once(enabled ? "enter-full-screen" : "leave-full-screen", () => resolve());
          window.setFullScreen(enabled);
        });
      }, fullscreen);
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen()))
        .toBe(fullscreen);
      const [width, height] = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize());
      await page.setViewportSize({ width, height });
      await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width, height });
      await expect.poll(dashboardExtent).toEqual({ vertical: 0, horizontal: 0 });
      if (fullscreen) await page.screenshot({ path: testInfo.outputPath("dashboard-fullscreen.png") });
    }
    await page.setViewportSize(matrixViewport);
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
    const attachPage = liveBrowser.getByRole("button", { name: "Attach page to draft", exact: true });
    await expect(attachPage).toHaveAccessibleDescription(/Codex fixture/);
    await attachPage.click();
    await expect(liveBrowser.getByRole("status")).toHaveText("Page report added to the follow-up draft for Codex fixture.");
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
    await live.getByRole("button", { name: "Agent terminal", exact: true }).click();
    const dashboardTerminal = live.getByLabel("Terminal", { exact: true });
    await expect(dashboardTerminal).toBeVisible();
    await expect(live.getByRole("button", { name: "Open in workspace", exact: true })).toHaveCount(0);
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
    await expect(live.getByText("Live input to Codex", { exact: true })).toBeVisible();
    await live.getByRole("button", { name: "Conversation history", exact: true }).click();
    await expect(live.getByText("Read-only transcript", { exact: true })).toBeVisible();
    await expect(terminalHistory).toBeFocused();
    await expect(terminalHistory.getByText("Recorded message 29", { exact: true })).toBeVisible();
    const historyTop = () => terminalHistory.evaluate((element) => element.scrollTop);
    await terminalHistory.hover();
    await expect.poll(historyTop).toBeGreaterThan(0);
    const historyBottom = await historyTop();
    await page.mouse.wheel(0, -400);
    await expect.poll(historyTop).toBeLessThan(historyBottom);
    await live.getByRole("button", { name: "Back to agent terminal", exact: true }).click();
    await expect(dashboardTerminal).toBeVisible();
    await expect(dashboardTerminal.locator(".xterm-helper-textarea")).toBeFocused();
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
    await live.getByRole("button", { name: "Review permission in terminal", exact: true }).click();
    await expect(dashboardTerminal.locator(".xterm-helper-textarea")).toBeFocused();
    await live.getByRole("button", { name: "Preview", exact: true }).click();
    const otherRow = live.getByRole("button", { name: "Inspect Review layout" });
    await otherRow.click({ button: "right" });
    const rowMenu = dashboard().locator(".dashboard-row-context:popover-open");
    await expect(rowMenu.getByRole("button", { name: "Rename session…", exact: true })).toBeVisible();
    await expect(live.getByRole("button", { name: "Inspect Codex fixture" })).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("Escape");
    await expect(rowMenu).toHaveCount(0);
    await live.getByRole("button", { name: "Inspect Review layout" }).click();
    await live.getByRole("button", { name: "Changes", exact: true }).click();
    await live.getByRole("button", { name: /^M fixture.txt/ }).click();
    const interruptedDiff = live.locator(".dashboard-live-session:visible").getByLabel("File diff", { exact: true });
    await expect(interruptedDiff.getByText("+ line 199", { exact: true })).toBeVisible();
    await interruptedDiff.evaluate((element) => { element.scrollTop = 180; });
    const hideSessions = live.getByRole("button", { name: "Hide session list", exact: true });
    await expect(live.getByRole("button", { name: "Expand detail", exact: true })).toHaveCount(0);
    await hideSessions.click();
    await expect(live.getByRole("navigation", { name: "Live session list" })).toHaveCount(0);
    await live.getByRole("button", { name: "Show session list", exact: true }).click();
    await expect(live.getByRole("navigation", { name: "Live session list" })).toBeVisible();
    await hideSessions.click();
    await dashboard().getByRole("button", { name: "Next attention", exact: true }).click();
    await expect(live.getByRole("navigation", { name: "Live session list" })).toBeVisible();
    await expect(live.getByRole("button", { name: "Inspect Codex fixture" })).toHaveAttribute("aria-current", "true");
    await expect(live.getByRole("button", { name: "Agent terminal", exact: true })).toHaveAttribute("aria-pressed", "true");
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
    await expect(interruptedDiff).toBeVisible();
    await expect.poll(() => interruptedDiff.evaluate((element) => element.scrollTop)).toBe(180);
    await live.getByRole("button", { name: "Inspect Codex fixture" }).click();
    await live.getByRole("button", { name: "Preview", exact: true }).click();
    const unsent = live.getByRole("textbox", { name: "Follow-up", exact: true });
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
    await dashboard().getByRole("button", { name: "New session", exact: true }).click();
    const agentChoices = launcher.getByRole("region", { name: "AI session", exact: true }).getByRole("button");
    await expect(agentChoices.first()).toHaveAccessibleName("Start Codex session");
    await expect(agentChoices.first()).toContainText("Last used");
    await launcher.getByRole("button", { name: "Close launcher", exact: true }).click();
    const namedSession = live.locator(".dashboard-live-toolbar:visible");
    await namedSession.getByRole("button", { name: "Rename session…", exact: true }).click();
    const rename = page.getByRole("dialog", { name: "Rename session" });
    const sessionName = rename.getByLabel("Session name", { exact: true });
    await expect(sessionName).toHaveValue("Security review");
    await expect(sessionName).toBeFocused();
    await sessionName.fill("Checkout security");
    await rename.getByRole("button", { name: "Save name", exact: true }).click();
    await expect(namedSession).toContainText("Checkout security");
    await namedSession.getByRole("button", { name: "Rename session…", exact: true }).click();
    await rename.getByRole("button", { name: "Use automatic title", exact: true }).click();
    await expect(namedSession).toContainText("Codex session");

    await live.getByRole("button", { name: "Inspect Codex fixture" }).click();
    await live.getByRole("button", { name: "Changes", exact: true }).click();
    const currentDiff = live.locator(".dashboard-live-session:visible").getByLabel("File diff", { exact: true });
    await expect(currentDiff.getByText("+ line 199", { exact: true })).toBeVisible();
    await currentDiff.evaluate((element) => { element.scrollTop = 310; });
    await expect.poll(() => currentDiff.evaluate((element) => element.scrollTop)).toBe(310);
    fs.writeFileSync(path.join(dir, "Review.txt"), "Later checkout edit.\n");
    await closeUI(app);
    app = await electron.launch(launch);
    page = await dashboardPage(app);
    const restoredTerminal = { ...liveTerminal, id: "reattached-codex-terminal" };
    await app.evaluate(({ BrowserWindow, ipcMain }, { terminal, row, captureAt }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      ipcMain.removeHandler("live-session-preview");
      ipcMain.handle("live-session-preview", () => ({ instruction: "Review the desktop layout next.",
        instructionAt: captureAt, answer: "Desktop layout verified. See [Release notes](<Release notes.md>)." }));
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
    }, { terminal: restoredTerminal, row: rows[1], captureAt: capturedInstructionAt });
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
    await restoredLive.getByRole("button", { name: "Turn changes 2 files" }).click();
    const restoredTurnFiles = page.getByRole("dialog", { name: "Changed during this turn" });
    await restoredTurnFiles.getByRole("button", { name: "View diff for Review.txt" }).click();
    const restoredCapturedDiff = page.getByRole("dialog", { name: "Captured checkout diff" });
    await expect(restoredCapturedDiff.getByLabel("File diff", { exact: true })).toContainText("Desktop layout verified.");
    await expect(restoredCapturedDiff).not.toContainText("Later checkout edit.");
    await restoredCapturedDiff.getByRole("button", { name: "Close diff" }).click();
    await expect(restoredLive.getByRole("textbox", { name: "Follow-up", exact: true }))
      .toHaveValue("Keep this draft while I switch.");
    await expect(restoredLive.getByRole("list", { name: "Draft screenshots" }).getByText("Switch.png")).toBeVisible();
    await restoredLive.getByRole("button", { name: "Send follow-up" }).click();
    await expect(restoredLive.getByText("Follow-up sent.")).toBeVisible();
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
    const reviewHeader = restoredLive.locator(".dashboard-live-session:visible .dashboard-live-toolbar");
    await expect(reviewHeader).toHaveAttribute("data-review", "true");
    await expect.poll(() => reviewHeader.evaluate((element) => getComputedStyle(element, "::after").animationName))
      .toBe("dashboard-header-settle");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(() => reviewHeader.evaluate((element) => getComputedStyle(element, "::after").animationName))
      .toBe("none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await reviewHeader.screenshot({ path: testInfo.outputPath("active-header-review.png"), animations: "disabled" });
    await reviewHeader.getByRole("button", { name: "Review update", exact: true }).click();
    await expect(restoredLive.getByRole("definition").filter({ hasText: "The new reply is ready." })).toBeVisible();
    await expect(reviewHeader).toHaveAttribute("data-review", "false");
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
      { ...stale[0], sessionID: "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "Release test", preview: "Check mobile navigation.", updated: +today / 1000 },
      { ...stale[0], sessionID: "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb", title: "Release test", preview: "Verify the rollback plan.", updated: +yesterday / 1000 },
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
    await expect(restoredLive.getByRole("button", { name: "Agent terminal", exact: true })).toHaveAttribute("aria-pressed", "true");
    await showStatus("idle");
    await restoredLive.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(restoredLive.getByRole("button", { name: "Check terminal", exact: true })).toHaveCount(0);
    await app.evaluate(({ BrowserWindow, ipcMain }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      ipcMain.removeHandler("reconnect");
      ipcMain.handle("reconnect", () => contents.send("event", { event: "connection", state: "connected" }));
      contents.send("event", { event: "connection", state: "disconnected" });
    });
    const serviceConnection = dashboard().getByRole("region", { name: "Terminal service connection" });
    await expect(serviceConnection.getByRole("status")).toContainText("Terminal service disconnected");
    await serviceConnection.getByRole("button", { name: "Reconnect terminals", exact: true }).click();
    await expect(serviceConnection).toHaveCount(0);
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
    const recentOriginDraft = restoredLive.getByRole("textbox", { name: "Follow-up", exact: true });
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
    await expect(quickOverlay.locator("header small")).toHaveText(`Separate shell · ${dir}`);
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
    await expect(recentPanel.getByRole("region", { name: "Today", exact: true })
      .getByRole("button", { name: /Release test.*Check mobile navigation/ })).toBeVisible();
    await expect(recentPanel.getByRole("region", { name: "Yesterday", exact: true })
      .getByRole("button", { name: /Release test.*Verify the rollback plan/ })).toBeVisible();
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
    await expect(recentDialog.locator(".dashboard-preview-heading").getByRole("button", { name: "Open live session" })).toBeVisible();
    await page.keyboard.press("Escape");
    await recentFilter.fill("release");
    await recentRelease.click();
    await expect(recentDialog.getByRole("heading", { name: "Release checkpoint" })).toBeVisible();
    await expect(recentDialog.getByText(/release-notes · Codex/)).toBeVisible();
    await expect(recentDialog.getByText("The checklist is ready for review.", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("02-session-details.png") });
    const sessionActions = recentDialog.getByRole("button", { name: "Session actions", exact: true });
    const hideFromHistory = recentDialog.getByRole("button", { name: "Hide", exact: true });
    await expect(hideFromHistory).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("02b-session-actions.png") });
    await hideFromHistory.click();
    await expect(recentDialog).toHaveCount(0);
    await expect(recentFilter).toHaveValue("release");
    await expect(recentPanel.getByRole("status")).toHaveText("Hidden from history · Release checkpoint");
    await expect(recentRelease).toHaveCount(0);
    await recentPanel.getByRole("button", { name: "Undo", exact: true, exact: true }).click();
    await recentRelease.click();
    await page.keyboard.press("Escape");
    await expect(recentFilter).toHaveValue("release");
    await expect(recentRelease).toBeFocused();
    await recentRelease.click();
    await recentDialog.getByRole("button", { name: "Close recent session details" }).click();
    await expect(recentFilter).toHaveValue("release");
    await expect(recentRelease).toBeFocused();
    await page.keyboard.press("Escape");
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
    await dashboard().getByRole("button", { name: "AI history review", exact: true }).click();
    await dashboard().getByRole("button", { name: "AI history review", exact: true }).click();
    await projectHistory.getByRole("button", { name: "Change agent", exact: true }).click();
    await projectHistory.getByLabel("Preferred review agent").selectOption("claude");
    await expect(projectHistory.getByRole("button", { name: "Review with Claude", exact: true })).toBeVisible();
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
    await projectLanding().getByRole("button", { name: "Open live session", exact: true }).click();
    await expect(projectView.getByRole("button", { name: "Live", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(restoredLive.getByRole("button", { name: "Inspect Other project session" })).toHaveCount(0);
    await expect(nextAttention).toBeDisabled();
    const clearScope = dashboard().getByRole("button", { name: /Show all projects/ });
    await expect(clearScope).toHaveText("Show all projects · 1 needs input");
    const rail = restoredLive.getByRole("navigation", { name: "Live session list" });
    const sessionHeader = restoredLive.locator(".dashboard-live-toolbar:visible");
    await expect(rail).toHaveCount(0);
    await expect(sessionHeader.getByRole("img", { name: "Idle", exact: true })).toBeVisible();
    const soloDraft = restoredLive.getByRole("textbox", { name: "Follow-up", exact: true });
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
    await expect(picker().getByRole("checkbox")).toHaveCount(0);
    await picker().getByRole("button", { name: "Filter live sessions", exact: true }).click();
    await picker().getByRole("checkbox", { name: path.basename(dir), exact: true }).check();
    await picker().getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(picker().getByRole("checkbox")).toHaveCount(0);
    await expect(scope("All projects")).toBeVisible();
    await picker().getByRole("button", { name: "Filter live sessions", exact: true }).click();
    await expect(picker().getByRole("checkbox", { name: path.basename(dir), exact: true })).not.toBeChecked();
    await picker().getByRole("checkbox", { name: path.basename(dir), exact: true }).check();
    await picker().getByRole("searchbox", { name: "Search projects" }).fill("release-notes");
    await picker().getByRole("checkbox", { name: "release-notes", exact: true }).check();
    await picker().getByRole("button", { name: "Apply filter", exact: true }).click();
    await expect(scope("2 projects")).toBeVisible();
    await expect(restoredLive.getByRole("navigation", { name: "Live session list" })).toBeVisible();
    await expect(restoredLive.getByRole("button", { name: "Inspect Other project session" })).toHaveCount(0);
    await expect(nextAttention).toBeDisabled();
    await expect(clearScope).toHaveText("Show all projects · 1 needs input");
    await scope("2 projects").click();
    await expect(picker().getByRole("checkbox")).toHaveCount(0);
    await picker().getByRole("button", { name: "Filter live sessions", exact: true }).click();
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
    const shellButton = restoredLive.getByRole("button", { name: "Dashboard shell", exact: true });
    await shellButton.click();
    await expect(drawer.locator(".xterm-helper-textarea")).toBeFocused();
    const shellDivider = drawer.getByRole("separator", { name: "Resize dashboard shell", exact: true });
    await shellDivider.press("ArrowUp");
    await expect(shellDivider).toHaveAttribute("aria-valuenow", "41");
    await drawer.getByRole("button", { name: "Hide shell", exact: true }).click();
    await expect(drawer).toBeHidden();
    await expect(shellButton).toBeFocused();
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
    await app.evaluate(({ ipcMain }, at) => {
      ipcMain.removeHandler("live-session-follow-up");
      ipcMain.handle("live-session-follow-up", (_event, _provider, _sessionID, _terminalID, text) => {
        if (text !== "Edit the pending file across a restart.") throw Error("Wrong restart fixture follow-up");
      });
      ipcMain.removeHandler("live-session-preview");
      ipcMain.handle("live-session-preview", () => ({
        instruction: "Review the desktop layout next.", instructionAt: at, answer: "Previous reply.",
      }));
    }, capturedInstructionAt);
    await restoredLive.getByRole("button", { name: "Preview", exact: true }).click();
    await restoredLive.getByRole("textbox", { name: "Follow-up", exact: true }).fill("Edit the pending file across a restart.");
    await restoredLive.getByRole("button", { name: "Send follow-up" }).click();
    await expect(restoredLive.getByText("Follow-up sent.")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("dashboardPendingTurnCaptures")))
      .toContain("Edit the pending file across a restart.");
    await restoredLive.getByRole("button", { name: "Preview layout" }).click();
    await restoredLive.getByRole("checkbox", { name: "Recent turns" }).uncheck();
    await page.keyboard.press("Escape");
    await restoredLive.getByRole("textbox", { name: "Follow-up", exact: true }).fill("Keep this draft with Workspace disabled.");
    await closeUI(app);
    fs.writeFileSync(path.join(dir, "Pending.txt"), "Edit completed after restart.\n");
    app = await electron.launch(launch);
    page = await dashboardPage(app);
    await expect(dashboard().getByRole("button", { name: "Open workspace" })).toHaveCount(0);
    await expect(scope("All projects")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("recapAgent"))).toBe("claude");
    await app.evaluate(({ BrowserWindow, ipcMain }, { terminal, row }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      const instructionAt = Date.now();
      ipcMain.removeHandler("live-session-preview");
      ipcMain.handle("live-session-preview", () => ({
        instruction: "Edit the pending file across a restart.", instructionAt, answer: "The edit is complete.",
        recentTurns: [
          { instruction: "An earlier instruction.", instructionAt: instructionAt - 30000, answer: "The earlier reply." },
          { instruction: "Edit the pending file across a restart.", instructionAt, answer: "The edit is complete." },
        ],
      }));
      wc.send("event", { event: "terminals", terminals: [terminal] });
      wc.send("event", { event: "store", sessions: [{ ...row, terminalId: terminal.id, state: "idle" }] });
    }, { terminal: { ...restoredTerminal, id: "turn-restart-terminal" }, row: rows[1] });
    const afterRestart = dashboard().getByRole("region", { name: "Live sessions" });
    await afterRestart.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(afterRestart.getByRole("textbox", { name: "Follow-up", exact: true })).toHaveValue("Keep this draft with Workspace disabled.");
    await afterRestart.getByRole("button", { name: "Preview layout" }).click();
    await expect(afterRestart.getByRole("checkbox", { name: "Recent turns" })).not.toBeChecked();
    await page.keyboard.press("Escape");
    await expect(afterRestart.getByRole("navigation", { name: "Recent turns", exact: true })).toHaveCount(0);
    const compactTurns = afterRestart.getByRole("navigation", { name: "Recent turn controls" });
    await compactTurns.getByRole("button", { name: "Previous turn" }).click();
    await expect(afterRestart.locator(".dashboard-briefing")).toContainText("The earlier reply.");
    await compactTurns.getByRole("button", { name: "Next turn" }).click();
    await afterRestart.getByRole("button", { name: /Turn changes .*file/ }).click();
    const resumedCapture = page.getByRole("dialog", { name: "Changed during this turn" });
    await expect(resumedCapture.getByText("Pending.txt", { exact: true })).toBeVisible();
    await expect(resumedCapture.getByText("unchanged.txt", { exact: true })).toHaveCount(0);
    await resumedCapture.getByRole("button", { name: "View diff for Pending.txt" }).click();
    await expect(page.getByRole("dialog", { name: "Captured checkout diff" })).toContainText("Edit completed after restart.");
  } finally {
    await closeUI(app);
    const client = new Service(path.join(data, "service-v2"));
    if (await client.connectExisting()) await client.call("shutdown");
    client.disconnect();
    fs.rmSync(externalFile, { force: true });
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
    { type: "user", isCompactSummary: true, isMeta: true, message: { content: "Keep the existing project layout." } },
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
    let page = await dashboardPage(app);
    let dashboard = page.getByRole("dialog", { name: "RunHuddle" });
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
    const continuedID = "44444444-4444-4444-8444-444444444444";
    const destination = await page.evaluate((cwd) => window.runhuddle.create(cwd, "shell"), dir);
    writeEvents(path.join(claudeProject, continuedID + ".jsonl"), [
      { type: "user", cwd: dir, message: { content: "Continue the new task" } },
    ]);
    await page.evaluate(async ({ folder, hiddenId, sourceId, targetId }) => {
      await window.runhuddle.saveNote({ title: "Note saved before retirement", text: "Existing note body.", project: folder });
      await window.runhuddle.setHistoryHidden("sessions", "Copilot:" + hiddenId, true);
      await window.runhuddle.recordSessionContinuation({ provider: "Claude", sessionID: sourceId },
        { provider: "Claude", sessionID: targetId }, "Continue the new task");
    }, { folder: dir, hiddenId: copilotID, sourceId: claudeID, targetId: continuedID });
    await closeUI(app);
    app = await electron.launch(launch);
    page = await dashboardPage(app);
    const hidden = () => page.getByRole("dialog", { name: "Hidden projects and sessions" });
    const review = () => page.getByRole("dialog", { name: "Start new session with context", exact: true });
    dashboard = page.getByRole("dialog", { name: "RunHuddle" });
    await expect(dashboard.getByRole("button", { name: "Open workspace" })).toHaveCount(0);
    await dashboard.getByRole("button", { name: /^Projects:/ }).click();
    await dashboard.getByRole("button", { name: "Manage hidden…", exact: true }).click();
    await hidden().getByRole("searchbox", { name: "Find hidden sessions" }).fill("Copilot project history");
    await expect(hidden().getByText("Copilot · Copilot project history", { exact: true })).toBeVisible();
    const restore = hidden().getByRole("button", { name: "Restore session", exact: true });
    await restore.click();
    await expect(hidden().getByRole("status")).toHaveText("Restored · Copilot project history");
    await hidden().getByRole("button", { name: "Undo", exact: true }).click();
    await expect(hidden().getByRole("status")).toHaveText("Hidden from history · Copilot project history");
    await expect(hidden().getByRole("searchbox", { name: "Find hidden sessions" })).toHaveValue("Copilot project history");
    await restore.click();
    await hidden().getByRole("button", { name: "Close hidden history" }).click();
    await dashboard.getByRole("button", { name: "Recent", exact: true }).click();
    await dashboard.getByRole("group", { name: "Recent sessions" }).getByRole("button", { name: /Claude workspace history/ }).click();
    const details = page.getByRole("dialog", { name: "Recent session details" });
    await expect(details.getByRole("region", { name: "Linked sessions" })).toContainText("Context passed to");
    await app.evaluate(({ BrowserWindow, ipcMain }, sessionID) => {
      let updates = 0;
      ipcMain.removeHandler("generate-recap");
      ipcMain.handle("generate-recap", (_event, provider, id) => {
        if (provider !== "Claude" || id !== sessionID) throw Error("Wrong recap source");
        const recap = { agent: "Claude", done: ++updates === 1 ? "First dashboard recap." : "Refreshed dashboard recap.",
          pending: "", next: "", generatedAt: Date.now(), sourceUpdated: 0 };
        BrowserWindow.getAllWindows()[0].webContents.send("event", { event: "recap", key: "Claude:" + id, recap });
        return recap;
      });
    }, claudeID);
    await details.getByText("Recap", { exact: true }).click();
    const recap = details.getByRole("region", { name: "Where we left off" });
    await recap.getByRole("button", { name: "Generate recap…" }).click();
    await recap.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(recap.getByText("First dashboard recap.")).toBeVisible();
    await recap.getByRole("button", { name: "Refresh recap…" }).click();
    await recap.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(recap.getByText("Refreshed dashboard recap.")).toBeVisible();
    await details.getByRole("button", { name: "Start new session with context…" }).click();
    await expect(review().getByLabel("Context for new session")).toBeEnabled();
    await expect(review().getByLabel("Context for new session")).toHaveValue(/Claude workspace history/);
    await review().getByRole("button", { name: "Cancel", exact: true }).click();
    await details.getByRole("button", { name: "Read conversation" }).click();
    await details.getByRole("button", { name: "Save as note" }).first().click();
    const noteEditor = page.getByRole("dialog", { name: "New note" });
    await expect(noteEditor.getByLabel("Title")).toBeFocused();
    await expect(noteEditor.locator(".note-source-card strong")).toHaveText("Claude workspace history");
    await noteEditor.getByLabel("Title").fill("Dashboard excerpt");
    await noteEditor.getByRole("button", { name: "Save note" }).click();
    await expect(noteEditor).toBeHidden();
    await details.getByRole("button", { name: "Close recent session details" }).click();
    await dashboard.getByRole("button", { name: "Command Palette" }).click();
    const palette = page.getByRole("dialog", { name: "Command Palette" });
    for (const group of ["Commands", "Sessions", "Projects"])
      await expect(palette.getByRole("region", { name: group, exact: true })).toBeVisible();
    const paletteQuery = palette.getByRole("textbox", { name: "Search commands, sessions, and projects" });
    await paletteQuery.press("ArrowUp");
    await expect(palette.getByRole("region", { name: "Projects" }).getByRole("button").last())
      .toHaveAttribute("data-active", "true");
    await paletteQuery.fill("> project");
    await expect(palette.getByRole("region", { name: "Sessions" })).toHaveCount(0);
    await expect(palette.getByRole("region", { name: "Projects" })).toHaveCount(0);
    await palette.getByRole("button", { name: /Project notes/ }).click();
    const notes = page.getByRole("dialog", { name: "Saved notes" });
    await expect(notes.getByRole("searchbox", { name: "Search notes" })).toBeFocused();
    await notes.getByRole("searchbox", { name: "Search notes" }).fill("Note saved before retirement");
    await expect(notes.getByText("Existing note body.")).toBeVisible();
    await notes.getByRole("searchbox", { name: "Search notes" }).fill("Dashboard excerpt");
    await expect(notes.getByRole("heading", { name: "Dashboard excerpt" })).toBeVisible();
    const moreNoteActions = notes.getByRole("button", { name: "More note actions" });
    await moreNoteActions.click();
    await expect(notes.getByRole("button", { name: "Copy note" })).toBeVisible();
    await expect(notes.getByRole("button", { name: "Export Markdown…" })).toBeVisible();
    await moreNoteActions.click();
    const editNoteAction = notes.getByRole("button", { name: "Edit note" });
    await editNoteAction.click();
    const editNote = page.getByRole("dialog", { name: "Edit note" });
    await expect(editNote.locator(".note-source-card strong")).toHaveText("Claude workspace history");
    await editNote.getByLabel("Note text").fill("Edited in the dashboard.");
    await editNote.getByRole("button", { name: "Save note" }).click();
    await expect(notes.getByText("Edited in the dashboard.")).toBeVisible();
    await expect(editNoteAction).toBeFocused();
    await notes.getByRole("button", { name: "View source conversation" }).click();
    await expect(details.getByRole("heading", { name: "Claude workspace history" })).toBeVisible();
    await details.getByRole("button", { name: "Close recent session details" }).click();
    await dashboard.getByRole("button", { name: "Command Palette" }).click();
    await palette.getByRole("button", { name: /Terminal appearance/ }).click();
    const appearance = page.getByRole("dialog", { name: "Terminal appearance" });
    for (const group of ["Theme", "Typography", "Cursor"])
      await expect(appearance.getByRole("group", { name: group, exact: true })).toBeVisible();
    await expect(appearance.getByRole("region", { name: "Live preview" })).toBeVisible();
    await appearance.getByRole("button", { name: "Close terminal appearance" }).click();
    await app.evaluate(({ BrowserWindow, Menu }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const menu = Menu.getApplicationMenu()!;
      for (const id of ["app-theme-light", "dashboard-terminal-appearance"]) {
        const item = menu.getMenuItemById(id)!;
        item.click(item, window, {} as Electron.KeyboardEvent);
      }
    });
    await expect(appearance).toBeVisible();
    await appearance.getByRole("button", { name: "Close terminal appearance" }).click();
    await app.evaluate(({ BrowserWindow, Menu }) => {
      const item = Menu.getApplicationMenu()!.getMenuItemById("custom-app-accent")!;
      item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent);
    });
    const accentDialog = page.getByRole("dialog", { name: "Custom accent color" });
    const sample = accentDialog.getByText("Primary action", { exact: true });
    const background = await sample.evaluate((element) => getComputedStyle(element).backgroundColor);
    await accentDialog.getByLabel("Accent color").fill("#ca5077");
    await expect.poll(() => sample.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(background);
    await expect(accentDialog.getByText("Selection", { exact: true })).toBeVisible();
    await expect(accentDialog.getByText("Focus", { exact: true })).toBeVisible();
    await accentDialog.getByRole("button", { name: "Apply color" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-app-theme", "light");
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--app-accent-base"))).toBe("#ca5077");


    await app.evaluate(({ ipcMain }, terminal) => {
      ipcMain.removeHandler("create");
      ipcMain.handle("create", (_event, cwd, agent) => ({ ...terminal, cwd, agent, title: "Dashboard continuation" }));
      ipcMain.removeHandler("write");
      ipcMain.handle("write", (_event, id, text) => { (globalThis as any).dashboardHandoff = { id, text }; });
      ipcMain.removeHandler("editors");
      ipcMain.handle("editors", () => ({ preferred: "fixture", editors: [{ id: "fixture", name: "Fixture Editor" }] }));
      ipcMain.removeHandler("open-editor");
      ipcMain.handle("open-editor", (_event, id, target) => { (globalThis as any).dashboardEditor = { id, target }; });
    }, { ...destination, sessionID: continuedID });
    await dashboard.getByRole("button", { name: `Focus project ${path.basename(dir)}`, exact: true }).click();
    await dashboard.getByRole("button", { name: "Open project in Fixture Editor" }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as any).dashboardEditor)).toEqual({ id: "fixture", target: dir });
    await dashboard.getByRole("button", { name: "Recent", exact: true }).click();
    await dashboard.getByRole("group", { name: "Recent sessions" }).getByRole("button", { name: /Claude workspace history/ }).click();
    await details.getByRole("button", { name: "Start new session with context…" }).click();
    await expect(review().getByLabel("Context for new session")).toBeEnabled();
    await expect(review().getByLabel("Context for new session")).toHaveValue(/Claude compaction summary\nKeep the existing project layout\.[\s\S]*Current request\nClaude workspace history[\s\S]*Next step\nCheck which parts/);
    await expect(review().getByRole("region", { name: "Source session" })).toContainText("Claude workspace history");
    const handoffDest = review().getByRole("region", { name: "Destination session" });
    await expect(handoffDest).toContainText(dir);
    await expect(handoffDest.getByRole("combobox")).toHaveValue("claude");
    await review().getByLabel("Context for new session").fill("Dashboard reviewed context.");
    await review().getByRole("button", { name: "Create Claude session", exact: true }).click();
    await expect(review().getByText(/Session created\. Open its terminal/)).toBeVisible();
    expect(await app.evaluate(() => (globalThis as any).dashboardHandoff)).toBeUndefined();
    await review().getByRole("button", { name: "Show new session" }).click();
    await expect(dashboard.getByRole("button", { name: "Agent terminal", exact: true })).toHaveAttribute("aria-pressed", "true");
    await dashboard.getByRole("complementary", { name: "Session context ready" })
      .getByRole("button", { name: "Paste briefing", exact: true }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as any).dashboardHandoff))
      .toEqual({ id: destination.id, text: "\x1b[200~Dashboard reviewed context.\x1b[201~" });
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
    let page = await dashboardPage(app);
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
    const shortcutPrefix = process.platform === "darwin" ? "⌘⇧" : "Ctrl+Shift+";
    await expect(dashboard().getByRole("button", { name: "Command Palette" }))
      .toHaveAttribute("data-tooltip", `Command Palette (${shortcutPrefix}P)`);
    await page.keyboard.press("ControlOrMeta+Shift+p");
    await expect(palette().getByTitle("Command Palette shortcut")).toHaveText(shortcutPrefix + "P");
    await expect(palette().getByRole("button", { name: /Quick Terminal/ }).locator("kbd"))
      .toHaveText(shortcutPrefix + "T");
    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+t");
    await expect(quick()).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Shift+t");
    await expect(terminalInput()).toBeFocused();
    await expect(quick().getByTitle("Quick Terminal shortcut")).toHaveText(shortcutPrefix + "T");
    await page.keyboard.press("ControlOrMeta+Shift+t");
    await expect(quick()).toHaveCount(0);

    await closeUI(app);
    app = await electron.launch(launch);
    page = await dashboardPage(app);
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
    const destination = "https://example.test/quick-terminal";
    await app.evaluate(({ BrowserWindow, dialog, shell }, { id, url }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      shell.openExternal = async (href) => { Object.assign(globalThis, { quickTerminalLink: href }); };
      BrowserWindow.getAllWindows()[0].webContents.send("event", {
        event: "output", id, sequence: 1_000_000,
        data: "\x1b[2J\x1b[H\x1b]8;;" + url + "\x07Quick Link\x1b]8;;\x07",
      });
    }, { id: shellId, url: destination });
    const screen = quick().locator(".xterm-screen");
    await expect(screen).toContainText("Quick Link");
    const position = { x: 12, y: 6 };
    await screen.hover({ position });
    await screen.click({ position, modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
    await expect.poll(() => app.evaluate(() => (globalThis as any).quickTerminalLink)).toBe(destination);
    await quick().getByRole("button", { name: "Dismiss Quick Terminal" }).click();
    await expect(quick()).toHaveCount(0);
    await expect(dashboard()).toBeVisible();
    await page.keyboard.press("ControlOrMeta+t");
    await expect(terminalInput()).toBeFocused();
    await app.evaluate(({ dialog }) => {
      let confirmed = false;
      dialog.showMessageBox = async (_window, options) => {
        if (options.message !== "End this shell?" || options.buttons[1] !== "End shell")
          throw Error("Expected a shell confirmation");
        const response = confirmed ? 1 : 0;
        confirmed = true;
        return { response, checkboxChecked: false };
      };
    });
    const endShell = quick().getByRole("button", { name: "End shell…" });
    await endShell.click();
    await expect(endShell).toBeEnabled();
    await expect(terminalInput()).toBeVisible();
    await endShell.click();
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
    const page = await dashboardPage(application);
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
    await expect.poll(() => page.evaluate(async (ids) => {
      const snapshot = await window.runhuddle.snapshot();
      return ids.map((id) => {
        const terminal = snapshot.terminals.find((row) => row.id === id);
        return {
          state: snapshot.sessions.find((row) => row.sessionID === terminal?.sessionID)?.state,
          exited: terminal?.exited,
        };
      });
    }, [first.id, second.id])).toEqual([
      { state: "working", exited: false }, { state: "working", exited: false },
    ]);
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
