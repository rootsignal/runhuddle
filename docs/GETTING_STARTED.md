# Getting started

[Documentation](README.md) · [RunHuddle](../README.md)

## Install

Requires macOS 14 or newer. The current package is for Apple Silicon; Intel builds have not been verified.

<!-- current-download:start -->
**[Download RunHuddle 0.15.3 for Apple Silicon](https://github.com/rootsignal/runhuddle/releases/download/v0.15.3/RunHuddle-0.15.3-arm64.dmg)**

[Release notes](https://github.com/rootsignal/runhuddle/releases/tag/v0.15.3) · [All releases](https://github.com/rootsignal/runhuddle/releases)
<!-- current-download:end -->

1. Download the installer above, then open the `.dmg`.
2. Drag **RunHuddle** to **Applications** and open it there.
3. RunHuddle checks for local agents automatically. Copilot tracking is enabled automatically when its CLI or a session is detected. A one-time notice explains that already-open Copilot sessions need one restart/resume; new sessions report activity automatically. Reply setup is separate; see below.

Your agent CLIs and accounts are installed separately. No Python installation, shell changes, or source checkout are needed to run the app. View connection status anytime from **Connections…** in the menu bar. Install the app at its permanent location before enabling hooks; after moving the app, reconnect in Connections.

Apple notarization tickets are attached to release installers. No Gatekeeper workaround is needed.

## First launch

1. Open RunHuddle from the Applications folder where you installed it.
2. Allow Notifications if you want attention/completion alerts. Use the app's test alert and macOS Notification Settings to check delivery.
3. When using **Go to terminal**, allow Automation access to Terminal or Ghostty if prompted. Unknown or ambiguous matches open a chooser; a second terminal opens only when explicitly requested.
4. Optionally enable **Open at Login** from the menu. macOS may require confirmation in Login Items settings.

Source builds are ad-hoc signed for local development; release downloads use Developer ID signing and Apple notarization.

## Reply from RunHuddle

Use **New session** beside search to choose an installed agent and project. Install and sign in to each agent separately on each Mac. Tracking a session does not necessarily make it available for replies.

| Agent | Starting with replies | Existing session |
| --- | --- | --- |
| Codex | Start or open a live Codex session. Activity checks the queue connection. | Select the running session; follow-ups queue while it works. |
| Claude Code | Start from RunHuddle with replies enabled. Accept the development-channel prompt in Claude’s terminal if shown. | Choose **Connect Claude replies…**, exit the old Claude process, then resume the same conversation through setup. |
| GitHub Copilot | Start from RunHuddle. The reply extension is installed and experimental extension support is enabled automatically for that launch. | Choose **Reconnect with replies…**. After confirmation, RunHuddle closes only the verified idle process and resumes the same conversation ID. |

The composer becomes available after a live connection is confirmed. **Installed** only means extension files are present. Copilot extensions and Claude channels are experimental and may be restricted by the installed agent version or organization policy. Copilot live delivery remains under verification in this preview.

**Questions and tool approvals stay in the terminal.** Use Go to terminal or Review in terminal to answer them. A follow-up is not an approval. Your agent’s model and permission settings still apply.

Return sends a follow-up; Shift-Return inserts a new line. A queue receipt confirms acceptance, not completion. If delivery is uncertain, check the terminal before retrying. Local image paths must exist on the Mac running the session; RunHuddle does not sync images or conversations between Macs.

Reopen the walkthrough from **Help → Getting started**. **Help → Set up agent replies** opens this reference directly.

## Update and uninstall

For an installed release, choose **Quit** in the RunHuddle menu bar, download the current DMG using the link above, and drag the app into the same Applications folder, replacing the previous copy. Open it again. Names, notes, handoffs, and tracking settings are preserved. Closing the window alone does not quit the app. From version 0.5.0 onward, choose **Check for Updates…** in the app or menu-bar menu to download, install, and relaunch in place. **Connections → Check automatically** enables background update checks; installation remains your choice. The first update from 0.4.x still requires the DMG. Updates and the update feed are signed with Sparkle EdDSA signatures, and release apps are Developer ID signed and notarized.

For a source checkout, quit RunHuddle and run:

```sh
git pull --ff-only
python3 scripts/install_local.py --open
```

Copilot hook paths are checked automatically. **Connections…** shows errors and offers retry. Updates at the same app path preserve hook paths; older Copilot processes need one restart/resume to load newly installed hooks.

To uninstall, turn off Open at Login, quit the app, and remove the installed `RunHuddle.app` from `/Applications` or `~/Applications`. Remove `~/.copilot/hooks/agent-session-manager.json` if installed. For Claude, remove only hook commands invoking `claude_bridge.py` from `~/.claude/settings.json`; preserve your other hooks and settings. Local data remains in `~/Library/Application Support/Agent Session Manager/`; delete that folder only if you also want to remove saved names, notes, handoffs, and the search index. Uninstalling RunHuddle does not delete provider sessions.

If setup fails, see [Troubleshooting](TROUBLESHOOTING.md).
