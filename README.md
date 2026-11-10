# RunHuddle

**Your coding agents, together.** A native macOS app by [Rootsignal](https://rootsignal.io) for finding, monitoring, and returning to AI coding sessions across local projects.

RunHuddle is an early source-built preview. A packaged standalone app is planned; there is no signed/notarized release or Mac App Store build yet.

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
| Claude Code | Simulated demo only. Live integration is not implemented yet. |
| Terminal.app | Existing-tab discovery and focus verified locally. |
| Ghostty | Scripting integration implemented; live validation remains pending. |

RunHuddle observes local agents. It does not supply model access or bypass provider authentication. Activity excerpts and search are local; AI-generated summaries are not enabled.

## Install locally from source

### Requirements

- macOS 14 or newer. Development has been validated on Apple Silicon; Intel builds are not yet verified.
- Xcode or compatible Command Line Tools providing **Swift 6 or newer**.
- **Python 3.11 or newer**, with `venv` and `pip`.
- Git and internet access to fetch Python dependencies.
- A supported agent CLI installed and authenticated separately.

Check your tools:

```sh
swift --version
python3 --version
```

Clone into a permanent location, then build and install:

```sh
git clone https://github.com/rootsignal/runhuddle.git
cd runhuddle
python3 scripts/install_local.py --open
```

The installer creates `.venv`, installs pinned Python dependencies, builds the app, generates its icon, ad-hoc signs it, and copies it to `~/Applications/RunHuddle.app`. It does not require `sudo`, install agent CLIs, change your shell, or enable Open at Login.

**Keep the checkout and `.venv` in place.** This development bundle references them. Copying the `.app` alone to another machine will not work. If you move the checkout, rebuild/reinstall and reinstall any Copilot hooks.

To choose another application directory:

```sh
python3 scripts/install_local.py --destination "$HOME/Applications" --open
```

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

If you use Copilot, install the tracker hooks explicitly:

```sh
.venv/bin/python scripts/copilot_bridge.py install-hooks
```

Alternatively, add `--copilot-hooks` to the installer command. This creates `~/.copilot/hooks/agent-session-manager.json` (or `$COPILOT_HOME/hooks/…`) without replacing unrelated hook files. Restart existing Copilot sessions to load the hooks. The hooks observe activity; they never grant permissions or inject prompts.

An empty session can appear before its first prompt. When its CLI is open but live activity cannot be verified, RunHuddle explains that status rather than claiming it is idle or working.

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

For Copilot users, reinstall hooks after moving the checkout or changing the hook integration.

To uninstall, turn off Open at Login, quit the app, and remove `~/Applications/RunHuddle.app`. Remove `~/.copilot/hooks/agent-session-manager.json` if installed. Local data remains in `~/Library/Application Support/Agent Session Manager/`; delete that folder only if you also want to remove saved names, notes, handoffs, and the search index. Uninstalling RunHuddle does not delete provider sessions.

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
- The development bundle retains its original bundle identifier and storage paths to preserve existing local installations. Release identity, migration, bundled dependencies, signing, notarization, and App Store feasibility still need work.

See [development and integration notes](docs/DEVELOPMENT.md) for implementation details and validation history.

## Publishing plans and licensing

RunHuddle is intended to become a standalone Mac app. This public repository is a development preview, not a release announcement.

Copyright © 2026 Rootsignal. All rights reserved. No open-source license has been selected for this repository.
