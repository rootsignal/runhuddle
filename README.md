# RunHuddle

**Your coding agents, together.** A native macOS app by [Rootsignal](https://rootsignal.io) for finding, monitoring, and returning to AI coding sessions across local projects.

RunHuddle is an early preview. The app now bundles its runtime and dependencies; installed users do not need Python, Swift, or a source checkout. Release installers are Developer ID signed and notarized by Apple. This is a direct download, not a Mac App Store release.

## What it does

- Tracks Working, Needs input, Idle, and Saved sessions, with a menu-bar overview and desktop notifications.
- Finds sessions by project, custom name, branch, path, purpose, and recorded conversation history.
- Shows latest recorded activity alongside editable purpose and next-step notes.
- Focuses an existing terminal where it can identify one, with a chooser when it cannot.
- Saves session metadata and handoffs across restarts; can resume a saved conversation or start fresh from a handoff.
- Displays informational context-usage estimates for supported Codex sessions.
- Supports bulk archive, restore, and removal. Codex uses native cleanup; Claude and Copilot archives preserve history, with a separate Move history to Trash action.

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

1. Download the Apple Silicon `.dmg` from [GitHub Releases](https://github.com/rootsignal/runhuddle/releases), then open it.
2. Drag **RunHuddle** to **Applications** and open it there.
3. RunHuddle checks for local agents automatically. Copilot tracking is enabled automatically when its CLI or a session is detected. A one-time notice explains that already-open Copilot sessions need one restart/resume; new sessions connect automatically.

Your agent CLIs and accounts are installed separately. No Python installation, shell changes, or source checkout are needed to run the app. View connection status anytime from **Connections…** in the menu bar. Install the app at its permanent location before enabling hooks; after moving the app, reconnect in Connections.

Apple notarization tickets are attached to release installers. No Gatekeeper workaround is needed.

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

### Source-build troubleshooting

The build script explicitly uses SwiftPM's native backend. If an older checkout reports `XCBBuild` / `Could not initialize build system` / `unknown error parsing property lists`, pull the latest code and rerun the installer. No Xcode settings changes or session deletion are needed for this workaround.

If an older checkout reports `SwiftUIMacros.StateMacro` / `plugin for module 'SwiftUIMacros' not found`, pull the latest code. RunHuddle explicitly selects SwiftUI's existing state property wrapper so it does not require the newer State macro plugin. The subsequent immutable-self and missing-binding errors are consequences of that same plugin failure.

Runtime, license, and dependency downloads use `/usr/bin/curl` with TLS verification and HTTPS-only redirects. The runtime is checked against a pinned SHA-256; wheels are checked against PyPI's HTTPS metadata and installed offline. This avoids relying on an asdf/Homebrew Python certificate store during packaging. If an older checkout fails inside `urllib` with `CERTIFICATE_VERIFY_FAILED`, pull the latest version and retry. A certificate error from system curl itself still needs the Mac's trusted certificate configuration corrected.

If `python3` reports “No version is set,” your version manager must select an installed Python 3.12+ before starting the installer. The packaging step reuses that same interpreter. Quit RunHuddle from its menu-bar **Quit** item before updating; closing the main window leaves the app running.

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

Copilot tracking is configured automatically after detection. **Connections…** shows its status and offers a retry if configuration failed. Alternatively, add `--copilot-hooks` to the source installer command. This creates `~/.copilot/hooks/agent-session-manager.json` (or `$COPILOT_HOME/hooks/…`) pointing to the installed app's bundled interpreter and collector. Unrelated hook files are preserved. Restart existing Copilot sessions to load the hooks. The hooks observe activity; they never grant permissions or inject prompts.

An empty session can appear before its first prompt. When its CLI is open but live activity cannot be verified, RunHuddle explains that status rather than claiming it is idle or working.

### Connect Claude Code

Supported Claude versions connect automatically. For older versions, open **Connections… → Connection details → Enable Claude compatibility hooks**. RunHuddle merges observational hooks into `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`), preserving other settings and hooks and saving a backup before changing the file. Supported Claude versions expose existing interactive and background sessions through `claude agents --json --all`, so those sessions are discovered automatically without restarting. Hooks remain a fallback for older versions; those sessions may need to reload hooks or restart/resume.

When an existing RunHuddle hook points to an old app location, RunHuddle repairs its own hook paths automatically, backs up Claude settings, and asks you to restart/resume already-open Claude sessions. Unrelated hooks are preserved; disabled hooks are not re-enabled.

History is discovered from local project transcripts. Without live-list or hook/process evidence, a session is labeled **Disconnected** with an explanation that its live status is unknown. Verified running sessions show Working, Needs input, or Idle; ended sessions and tracked processes that have exited show Saved. PID and process start time are checked to avoid stale state after reboot or PID reuse. Child-agent events do not change the main session's state.

Tracking does not grant permissions, inject prompts, or require a separate model API key. Claude still needs its own authentication. Custom CLI installations that cannot be identified may show unknown live status. No Claude context-window percentage is inferred from transcript size.

### First launch

1. Open RunHuddle from `~/Applications`.
2. Allow Notifications if you want attention/completion alerts. Use the app's test alert and macOS Notification Settings to check delivery.
3. When using **Go to terminal**, allow Automation access to Terminal or Ghostty if prompted. Unknown or ambiguous matches open a chooser; a second terminal opens only when explicitly requested.
4. Optionally enable **Open at Login** from the menu. macOS may require confirmation in Login Items settings.

Source builds are ad-hoc signed for local development; release downloads use Developer ID signing and Apple notarization.

## Update and uninstall

For an installed release, choose **Quit** in the RunHuddle menu bar, download the new DMG from [Releases](https://github.com/rootsignal/runhuddle/releases), and drag the app into the same Applications folder, replacing the previous copy. Open it again. Names, notes, handoffs, and tracking settings are preserved. Closing the window alone does not quit the app. There is no in-app updater yet.

For a source checkout, quit RunHuddle and run:

```sh
git pull --ff-only
python3 scripts/install_local.py --open
```

Copilot hook paths are checked automatically. **Connections…** shows errors and offers retry. Updates at the same app path preserve hook paths; older Copilot processes need one restart/resume to load newly installed hooks.

To uninstall, turn off Open at Login, quit the app, and remove `~/Applications/RunHuddle.app`. Remove `~/.copilot/hooks/agent-session-manager.json` if installed. For Claude, remove only hook commands invoking `claude_bridge.py` from `~/.claude/settings.json`; preserve your other hooks and settings. Local data remains in `~/Library/Application Support/Agent Session Manager/`; delete that folder only if you also want to remove saved names, notes, handoffs, and the search index. Uninstalling RunHuddle does not delete provider sessions.

## Manage old sessions

Click **Select sessions**, check rows or choose **Select all results**, then use **Actions**. Selection can span filters. Each action shows eligible sessions and reasons for skipped selections.

Archive only closed (Saved) sessions. Codex uses its native archive; Claude and Copilot are hidden in RunHuddle while their original histories remain available. Find them in Archived and restore them anytime. A session detected running again returns automatically to the main list.

Removal requires archiving first. Codex deletion is permanent. Claude and Copilot **Move history to Trash** removes the reviewed session history files, not project files. Export handoffs you want to keep first. Running sessions and sessions whose live status cannot be verified are skipped. Histories are rechecked before removal; partial failures are reported.

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
- The development bundle retains its original bundle identifier and storage paths to preserve existing local installations. Mac App Store distribution has not been implemented. Bundled third-party license notices are included in the app’s Resources directory.

See [development and integration notes](docs/DEVELOPMENT.md) for implementation details and validation history.

## Publishing plans and licensing

RunHuddle is distributed as an early-preview standalone Mac app. See [release automation](docs/RELEASING.md) for the signing setup and GitHub Actions workflow.

Copyright © 2026 Rootsignal. All rights reserved. No open-source license has been selected for this repository.
