# Troubleshooting

[Documentation](README.md) · [RunHuddle](../README.md)

## Closed sessions still show Idle

Agent shutdown and server disconnect detection can take a moment. RunHuddle listens for activity events, watches recognized agent processes for exits, and performs brief follow-up checks after an exit. A 30-second fallback covers missed events. Use Refresh to request a current snapshot. A session still running in another client or in the background may remain active.

## Claude or Copilot sessions show Saved or Disconnected

Open **Connections…** to check detection and tracking status. Copilot sessions opened before hooks were installed need to be fully exited and restarted/resumed. Supported Claude versions discover existing sessions through their live session list; older versions may need compatibility hooks. See [Agent connections](AGENT_CONNECTIONS.md) for details.

## Hook errors mention an old app location

Keep one installed copy of RunHuddle at its permanent location and open **Connections…**. RunHuddle repairs its own outdated hook paths while preserving unrelated settings. Fully exit and relaunch already-open agent processes to load the new paths; using Claude’s `/resume` inside an existing process can retain old hooks.

## Go to terminal opens a chooser

RunHuddle asks you to choose when it cannot identify one existing tab or pane confidently. Allow macOS Automation access when prompted. If multiple tabs match, select the correct one. RunHuddle remembers a verified unchanged choice for the current app run. For tmux, only the default local server attached through Terminal.app or iTerm2 is supported. Opening another terminal is a separate explicit action. See [terminal support](AGENT_CONNECTIONS.md#supported-integrations).

## Notifications do not appear

Use **Notification settings…** and the app’s test alert. Check RunHuddle’s permission and alert style in macOS System Settings → Notifications, along with your current Focus settings. A completion alert means work is ready for review, not that it succeeded.

## Updating or duplicate app copies

Use **Check for Updates…** from the app or the menu-bar gear menu. If updating manually, quit RunHuddle and replace the app in the same Applications folder. A source checkout may also contain `dist/RunHuddle.app`; use your installed copy rather than launching both. See [update and uninstall](GETTING_STARTED.md#update-and-uninstall).

## Source-build errors

The build script explicitly uses SwiftPM's native backend. If an older checkout reports `XCBBuild` / `Could not initialize build system` / `unknown error parsing property lists`, pull the latest code and rerun the installer. No Xcode settings changes or session deletion are needed for this workaround.

If an older checkout reports `SwiftUIMacros.StateMacro` / `plugin for module 'SwiftUIMacros' not found`, pull the latest code. RunHuddle explicitly selects SwiftUI's existing state property wrapper so it does not require the newer State macro plugin. The subsequent immutable-self and missing-binding errors are consequences of that same plugin failure.

Runtime, license, and dependency downloads use `/usr/bin/curl` with TLS verification and HTTPS-only redirects. The runtime is checked against a pinned SHA-256; wheels are checked against PyPI's HTTPS metadata and installed offline. This avoids relying on an asdf/Homebrew Python certificate store during packaging. If an older checkout fails inside `urllib` with `CERTIFICATE_VERIFY_FAILED`, pull the latest version and retry. A certificate error from system curl itself still needs the Mac's trusted certificate configuration corrected.

If `python3` reports “No version is set,” your version manager must select an installed Python 3.12+ before starting the installer. The packaging step reuses that same interpreter. Quit RunHuddle from its menu-bar **Quit** item before updating; closing the main window leaves the app running.

## Report an issue

[Open a GitHub issue](https://github.com/rootsignal/runhuddle/issues) with your RunHuddle version (shown at the bottom of the sidebar), macOS and agent versions, steps to reproduce, and relevant errors. Remove private conversation content and credentials from screenshots and logs before sharing.
