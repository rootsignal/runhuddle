# RunHuddle

**Your coding agents, together.** A native macOS workspace by [RootSignal](https://rootsignal.io).

[RunHuddle website](https://runhuddle.rootsignal.io) · [Documentation](https://runhuddle.rootsignal.io/docs/) · [Report an issue](https://github.com/rootsignal/runhuddle/issues)

## Download

<!-- current-download:start -->
**[Download RunHuddle for macOS](https://runhuddle.rootsignal.io/download)**
<!-- current-download:end -->

Requires **macOS 14 or newer on Apple Silicon**. Agent CLIs and accounts are installed separately. Release downloads are Developer ID signed and notarized. No Python, Swift or source checkout is required to use the downloaded app.

Open the DMG, drag RunHuddle to Applications and launch it. Use **Check for Updates…** in the app for updates. See [Getting started](https://runhuddle.rootsignal.io/docs/getting-started/).

## Current workspace

The current development workspace supports:

- Codex CLI, Claude Code and GitHub Copilot CLI in embedded terminals.
- Active, All, Pinned and Archived session views, search and project/tool filters.
- A menu-bar switcher, configurable shortcut, Inbox and notifications.
- Persistent shell tabs and reconnection after closing the app with terminals kept running.
- Project notes, reviewed handoffs and continuation into new sessions.
- Repository diffs, project preferences, reviewed commands and another-agent reviews.
- Isolated Git workspaces for supported launches.
- Theme presets, saved themes, terminal colors and keyboard preferences.

The [documentation](https://runhuddle.rootsignal.io/docs/) identifies its reviewed workspace version. Public releases may lag development; check the notes for the version you install. Screenshots and the product overview live on the [website](https://runhuddle.rootsignal.io).

## Development

[Build and test](docs/BUILDING.md) · [Publish releases](docs/RELEASING.md) · [Release history](docs/releases/)

## License

RunHuddle is open source under the [GNU General Public License version 3](LICENSE)
(SPDX: `GPL-3.0-only`).
Copyright © 2026 RootSignal LLC.

You may use, modify, and redistribute RunHuddle, including commercially, under
GPLv3. Distributed modified versions must remain under GPLv3 with corresponding
source available to recipients. RunHuddle comes with no warranty.

See [licensing details](docs/LICENSING.md) for the license transition and
redistribution requirements. Previously granted MIT permissions are not revoked.

Third-party dependencies and theme palettes retain their respective licenses.
Their notices are included in the app’s `Contents/Resources/ThirdPartyNotices`
directory; theme notices are also available in [docs/theme-licenses](docs/theme-licenses/).
