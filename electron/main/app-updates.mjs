export function terminalUpdateBlocker(terminals, sessions, platform) {
  const open = terminals.filter((terminal) => !terminal.exited);
  if (platform !== "darwin") return open.length ? "End the open terminals before installing." : "";
  const working = new Set(sessions.filter((session) => session.state === "working").map((session) => session.terminalId));
  return open.some((terminal) => working.has(terminal.id))
    ? "Wait for working agents to finish before installing."
    : "";
}

export function createUpdateCheck({ app, dialog, updater, windowForDialog, supported = true,
  installBlocker = async () => "", onDownloadProgress = () => {} }) {
  let busy = false;
  let downloadProgress;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  // electron-updater also emits errors for rejected checks and downloads.
  updater.on("error", () => {});
  updater.on("download-progress", ({ percent }) => {
    if (!downloadProgress || !Number.isFinite(percent)) return;
    const rounded = Math.round(Math.max(0, Math.min(100, percent)));
    if (downloadProgress.percent === rounded) return;
    downloadProgress = { ...downloadProgress, percent: rounded };
    onDownloadProgress(downloadProgress);
    windowForDialog()?.setProgressBar(rounded / 100);
  });

  const show = (options) => {
    const window = windowForDialog();
    return window && !window.isDestroyed()
      ? dialog.showMessageBox(window, options)
      : dialog.showMessageBox(options);
  };

  return async function checkForUpdates() {
    if (busy) return;
    if (!app.isPackaged || !supported) {
      await show({ type: "info", message: "Install a RunHuddle release to check for updates." });
      return;
    }
    busy = true;
    try {
      const result = await updater.checkForUpdates();
      if (!result?.isUpdateAvailable) {
        await show({ type: "info", message: "RunHuddle is up to date.", detail: "Installed version " + app.getVersion() });
        return;
      }
      const { version } = result.updateInfo;
      const download = await show({
        type: "question", message: `RunHuddle ${version} is available.`,
        buttons: ["Download", "Later"], defaultId: 0, cancelId: 1,
      });
      if (download.response !== 0) return;
      downloadProgress = { version, percent: null };
      onDownloadProgress(downloadProgress);
      windowForDialog()?.setProgressBar(2);
      try {
        await updater.downloadUpdate();
      } finally {
        downloadProgress = undefined;
        onDownloadProgress(null);
        windowForDialog()?.setProgressBar(-1);
      }
      const install = await show({
        type: "question", message: `RunHuddle ${version} is ready to install.`,
        detail: "RunHuddle will reopen after installing the update.",
        buttons: ["Install and restart", "Later"], defaultId: 0, cancelId: 1,
      });
      if (install.response !== 0) return;
      const blocked = await installBlocker();
      if (!blocked) updater.quitAndInstall();
      else await show({ type: "info", message: blocked,
        detail: "Open Check for Updates again when you’re ready to install." });
    } catch (error) {
      const channelMissing = error.code === "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND";
      await show({
        type: "error", message: "Couldn’t update RunHuddle.",
        detail: channelMissing
          ? "An update feed hasn’t been published for this platform yet."
          : "Try Check for Updates again later.",
      });
    } finally {
      busy = false;
    }
  };
}
