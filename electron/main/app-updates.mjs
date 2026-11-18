export function createUpdateCheck({ app, dialog, updater, windowForDialog, supported = true, canInstall = async () => true }) {
  let busy = false;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  // electron-updater also emits errors for rejected checks and downloads.
  updater.on("error", () => {});
  updater.on("download-progress", ({ percent }) => {
    windowForDialog()?.setProgressBar(Math.max(0, Math.min(1, percent / 100)));
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
      windowForDialog()?.setProgressBar(2);
      try {
        await updater.downloadUpdate();
      } finally {
        windowForDialog()?.setProgressBar(-1);
      }
      const install = await show({
        type: "question", message: `RunHuddle ${version} is ready to install.`,
        detail: "RunHuddle will reopen after installing the update.",
        buttons: ["Install and restart", "Later"], defaultId: 0, cancelId: 1,
      });
      if (install.response !== 0) return;
      if (await canInstall()) updater.quitAndInstall();
      else await show({ type: "info", message: "Finish running sessions before installing.",
        detail: "When your terminals have ended, open Check for Updates again to install." });
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
