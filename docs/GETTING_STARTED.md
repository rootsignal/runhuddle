# Getting started

[Documentation](README.md) · [RunHuddle](../README.md)

## Install

Requires macOS 14 or newer. The current package is for Apple Silicon; Intel builds have not been verified.

1. Download the Apple Silicon `.dmg` from [GitHub Releases](https://github.com/rootsignal/runhuddle/releases), then open it.
2. Drag **RunHuddle** to **Applications** and open it there.
3. RunHuddle checks for local agents automatically. Copilot tracking is enabled automatically when its CLI or a session is detected. A one-time notice explains that already-open Copilot sessions need one restart/resume; new sessions connect automatically.

Your agent CLIs and accounts are installed separately. No Python installation, shell changes, or source checkout are needed to run the app. View connection status anytime from **Connections…** in the menu bar. Install the app at its permanent location before enabling hooks; after moving the app, reconnect in Connections.

Apple notarization tickets are attached to release installers. No Gatekeeper workaround is needed.

## First launch

1. Open RunHuddle from the Applications folder where you installed it.
2. Allow Notifications if you want attention/completion alerts. Use the app's test alert and macOS Notification Settings to check delivery.
3. When using **Go to terminal**, allow Automation access to Terminal or Ghostty if prompted. Unknown or ambiguous matches open a chooser; a second terminal opens only when explicitly requested.
4. Optionally enable **Open at Login** from the menu. macOS may require confirmation in Login Items settings.

Source builds are ad-hoc signed for local development; release downloads use Developer ID signing and Apple notarization.

## Update and uninstall

For an installed release, choose **Quit** in the RunHuddle menu bar, download the new DMG from [Releases](https://github.com/rootsignal/runhuddle/releases), and drag the app into the same Applications folder, replacing the previous copy. Open it again. Names, notes, handoffs, and tracking settings are preserved. Closing the window alone does not quit the app. From version 0.5.0 onward, choose **Check for Updates…** in the app or menu-bar menu to download, install, and relaunch in place. **Connections → Check automatically** enables background update checks; installation remains your choice. The first update from 0.4.x still requires the DMG. Updates and the update feed are signed with Sparkle EdDSA signatures, and release apps are Developer ID signed and notarized.

For a source checkout, quit RunHuddle and run:

```sh
git pull --ff-only
python3 scripts/install_local.py --open
```

Copilot hook paths are checked automatically. **Connections…** shows errors and offers retry. Updates at the same app path preserve hook paths; older Copilot processes need one restart/resume to load newly installed hooks.

To uninstall, turn off Open at Login, quit the app, and remove the installed `RunHuddle.app` from `/Applications` or `~/Applications`. Remove `~/.copilot/hooks/agent-session-manager.json` if installed. For Claude, remove only hook commands invoking `claude_bridge.py` from `~/.claude/settings.json`; preserve your other hooks and settings. Local data remains in `~/Library/Application Support/Agent Session Manager/`; delete that folder only if you also want to remove saved names, notes, handoffs, and the search index. Uninstalling RunHuddle does not delete provider sessions.

If setup fails, see [Troubleshooting](TROUBLESHOOTING.md).
