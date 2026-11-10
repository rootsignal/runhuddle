# RunHuddle

**Your coding agents, together.** A native macOS app by [Rootsignal](https://rootsignal.io) for finding, monitoring, and returning to AI coding sessions across local projects.

RunHuddle is an early preview. The app now bundles its runtime and dependencies; installed users do not need Python, Swift, or a source checkout. Developer ID signing and notarization are still pending, so this is not yet a trusted public download or Mac App Store release.

## What it does

- Tracks Working, Needs input, Idle, and Saved sessions, with a menu-bar overview and desktop notifications.
- Finds sessions by project, custom name, branch, path, purpose, and recorded conversation history.
- Shows latest recorded activity alongside editable purpose and next-step notes.
- Focuses an existing terminal where it can identify one, with a chooser when it cannot.
- Saves session metadata and handoffs across restarts; can resume a saved conversation or start fresh from a handoff.
- Displays informational context-usage estimates for supported Codex sessions.
- Offers reviewed Codex archive, restore, and permanent-delete actions.

## Integration status

| Tool | Current support |
| --- | --- |
| Codex CLI / shared app server | Live discovery, status, history, resume, context estimates, and cleanup. Tested against 0.167.0. Requires the compatible local shared server. |
| GitHub Copilot CLI | Local discovery, observational hooks, history, and resume. Tested against 1.0.107; full authenticated work/approval/completion testing remains pending. |
| Claude Code | Local history discovery, live activity hooks, history search, handoffs, and resume. CLI 2.1.322 startup/exit hooks verified; authenticated work/approval testing remains pending. |
| Terminal.app | Existing-tab discovery and focus verified locally. |
| Ghostty | Scripting integration implemented; live validation remains pending. |

RunHuddle observes local agents. It does not supply model access or bypass provider authentication. Activity excerpts and search are local; AI-generated summaries are not enabled.

## Install the standalone app

Requires macOS 14 or newer. The current package is for Apple Silicon; Intel builds have not been verified.

1. Open the `RunHuddle-0.3.0-arm64.dmg` produced by the build below.
2. Drag **RunHuddle** to **Applications** and open it there.
3. The first-launch setup screen checks for local agents. Enable tracking for Claude Code and/or Copilot CLI, then restart or resume existing CLI sessions.

Your agent CLIs and accounts are installed separately. No Python installation, shell changes, or source checkout are needed to run the app. Reopen setup anytime from **Agent setup…** in the menu bar. Install the app at its permanent location before enabling hooks; after moving the app, update tracking in Agent setup.

This preview is ad-hoc signed, not notarized. A downloaded copy may be blocked by macOS. Do not disable Gatekeeper globally. A signed public download is the next distribution step.

## Build and install from source

Builders need macOS 14+, Swift 6+ (Xcode or compatible Command Line Tools), Python 3.12+, Git, and internet access. These requirements apply only to building the app.

```sh
git clone https://github.com/rootsignal/runhuddle.git
cd runhuddle
python3 scripts/install_local.py --open
```

The installer downloads a checksum-verified, pinned standalone Python runtime, installs pinned dependencies into it, builds and ad-hoc signs the app, and installs it in `~/Applications`. It does not need `sudo`. The installed app runs independently of the checkout.

To generate a drag-to-Applications disk image:

```sh
bash scripts/build-app.sh
python3 scripts/verify_standalone.py
bash scripts/package-dmg.sh
```

The DMG and SHA-256 checksum are written to `dist/`. Build on the target architecture; the runtime packager supports arm64 and x86_64, but only arm64 has been validated.

### Connect Codex

Start your normal Codex CLI workflow. RunHuddle looks for the shared server socket at:

```text
~/.codex/app-server-control/app-server-control.sock
```

The bridge honors `CODEX_HOME` when it is present in the app's environment. Finder-launched apps may not inherit shell environment variables.

With the tested CLI, you can check the daemon or start it if needed:

```sh
codex app-server daemon version
codex app-server daemon start
```

Compatibility with other Codex versions, independent servers, and remote machines is not guaranteed. RunHuddle never resumes a session merely to discover it.

### Connect Copilot CLI

Open **Agent setup…** from the RunHuddle menu and choose **Enable Copilot tracking**. Alternatively, add `--copilot-hooks` to the source installer command. This creates `~/.copilot/hooks/agent-session-manager.json` (or `$COPILOT_HOME/hooks/…`) pointing to the installed app's bundled interpreter and collector. Unrelated hook files are preserved. Restart existing Copilot sessions to load the hooks. The hooks observe activity; they never grant permissions or inject prompts.

An empty session can appear before its first prompt. When its CLI is open but live activity cannot be verified, RunHuddle explains that status rather than claiming it is idle or working.

### Connect Claude Code

Open **Agent setup…** and choose **Enable or update Claude tracking**. RunHuddle merges observational hooks into `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`), preserving other settings and hooks and saving a backup before changing the file. Restart or resume existing Claude sessions so they load the hooks. Installing hooks cannot retroactively determine what an already-open session is doing.

History is discovered from local project transcripts. Without hook/process evidence, a session is labeled **Disconnected** with an explanation that its live status is unknown. Verified running sessions show Working, Needs input, or Idle; ended sessions and tracked processes that have exited show Saved. PID and process start time are checked to avoid stale state after reboot or PID reuse. Child-agent events do not change the main session's state.

Tracking does not grant permissions, inject prompts, or require a separate model API key. Claude still needs its own authentication. Custom CLI installations that cannot be identified may show unknown live status. No Claude context-window percentage is inferred from transcript size.

### First launch

1. Open RunHuddle from `~/Applications`.
2. Allow Notifications if you want attention/completion alerts. Use the app's test alert and macOS Notification Settings to check delivery.
3. When using **Go to terminal**, allow Automation access to Terminal or Ghostty if prompted. Unknown or ambiguous matches open a chooser; a second terminal opens only when explicitly requested.
4. Optionally enable **Open at Login** from the menu. macOS may require confirmation in Login Items settings.

The app is ad-hoc signed for local development. Do not disable Gatekeeper globally. Signed/notarized distribution is future work.

## Update and uninstall

Quit RunHuddle before updating:

```sh
git pull --ff-only
python3 scripts/install_local.py --open
```

For Copilot users, use **Update Copilot tracking** after moving the app or changing the hook integration. Updates at the same app path preserve hook paths.

To uninstall, turn off Open at Login, quit the app, and remove `~/Applications/RunHuddle.app`. Remove `~/.copilot/hooks/agent-session-manager.json` if installed. For Claude, remove only hook commands invoking `claude_bridge.py` from `~/.claude/settings.json`; preserve your other hooks and settings. Local data remains in `~/Library/Application Support/Agent Session Manager/`; delete that folder only if you also want to remove saved names, notes, handoffs, and the search index. Uninstalling RunHuddle does not delete provider sessions.

## Build and test without installing

```sh
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt
swift test
.venv/bin/python -m unittest discover -s Tests -p 'test_*.py' -v
bash scripts/build-app.sh
open dist/RunHuddle.app
```

## Privacy and limitations

- Provider history stays on your machine. The local search index contains recorded user/assistant message text. Do not commit or share your Application Support data.
- Starting a fresh session explicitly sends the handoff to your chosen agent CLI; that provider's own data handling applies.
- Five-second polling can miss short transitions. A completion alert means ready for review, not proof that work succeeded.
- Some archived histories may not be available as local files. Search shows incomplete coverage when detected.
- Context usage is a last-reported estimate and can decrease after compaction. It is not a restart countdown.
- Saved sessions preserve conversation identity, not running shell processes.
- The development bundle retains its original bundle identifier and storage paths to preserve existing local installations. Release identity, migration, Developer ID signing, notarization, and App Store feasibility still need work. Bundled third-party license notices are included in the app’s Resources directory.

See [development and integration notes](docs/DEVELOPMENT.md) for implementation details and validation history.

## Publishing plans and licensing

RunHuddle is now packaged as a standalone Mac app. This public repository is a development preview, not a release announcement.

Copyright © 2026 Rootsignal. All rights reserved. No open-source license has been selected for this repository.
