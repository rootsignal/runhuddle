# RunHuddle Electron preview

First migration milestone, alongside the native macOS app. This is not yet a replacement release.

## Run and verify

Node 24+ and npm are development requirements. End users will not need Node, Python, or tmux installed. Agent CLIs and their logins are still user prerequisites.

```sh
cd electron
npm ci
npm run build
npm test
npm run test:ui
npm start
```

`npm run package` creates an unpacked application. `npm run dist` creates a platform installer (DMG, NSIS, or AppImage). Build separately on each target OS/architecture. Preview macOS packaging is unsigned; production signing, notarization, update feeds, and platform validation remain release gates.

## Available now

- Compact terminal tab strips and per-pane repository context, with explicit refresh. Git review separates Uncommitted, Recent commits (last 30 on the branch), and vs main (committed changes from the merge base; local main or origin/main).

- Compact, recency-grouped session navigation and a slim workspace header. Right-hand tool rail opens Changes in a resizable panel; width and visibility persist. On narrow windows the panel overlays the workspace.

- Workspace Changes panel beside terminals: staged/unstaged/untracked files and colored diffs, explicit refresh, binary/large-file handling. Review only; staging, committing, and discarding changes are not implemented.

- React/TypeScript interface with Recent, Workspaces (project folders), and Notes.
- Search retained across sidebar filters; selected session and content use the same state.
- Workspace-filtered terminal tabs with xterm.js and node-pty.
- New shell, Claude, Codex, and Copilot terminals using installed CLIs. Login shell on POSIX; COMSPEC on Windows.
- Bundled background terminal service; no tmux. Closing/reloading/reopening the UI reconnects to the same PTYs. Explicit Close stops a terminal, with confirmation. The app menu also offers Stop all and quit.
- Read-only import of native `sessions.sqlite`, including saved notes and pins. WAL-aware reads run off the UI process; filesystem changes trigger debounced refreshes.
- Separate `RunHuddle Preview` settings; existing native terminals and data remain untouched.

Owned agent sessions use exact conversation IDs and transcript events; native history is imported separately. Recorded sessions can be resumed. Notes remain read-only. Pane groups support horizontal/vertical splits, drag/reorder, resizing, and per-workspace layout and selection restoration.

If the helper disconnects, the app retries automatically and offers a manual retry after repeated failures. Missing PTYs remain as unavailable panes, with explicit shell replacement or agent resume actions. This preserves layout metadata, not running processes or lost scrollback; a new helper never silently reruns commands.

## Terminal service

The installed Electron executable starts a detached Node-mode helper that owns PTYs. The app connects over a local Unix socket on macOS/Linux or a named pipe on Windows. A per-user random token authenticates each connection; Unix settings/socket permissions are restricted. No network listener is opened. Renderer code gets a narrow preload API, with sandboxing, context isolation, frame validation, and navigation denied.

Output is batched at 16 ms during activity and retained in a bounded 512 Ki-character replay buffer per terminal. Replay is sequenced to avoid duplicate output during reconnect. An idle service without any clients or terminals stops after ten seconds. A service with terminals stays alive until explicitly stopped. Reboot, helper crash, or OS logout can still terminate processes. Full-screen replay after the buffer rolls over, upgrade compatibility, process-tree shutdown on all platforms, and resource use with 100 terminals require further hardening.

`ELECTRON_RUN_AS_NODE` must remain available in the packaged executable; do not disable that Electron fuse until a separate helper runtime replaces it. The helper removes that variable before launching shells. The running helper retains its initial environment until restarted.

For isolated tests, `RUNHUDDLE_PREVIEW_DATA` overrides preview settings and `RUNHUDDLE_NATIVE_STORE` overrides the imported database. Tests create throwaway stores and services and do not invoke agent CLIs or modify the user's native database.

## Tests

- Native SQLite WAL snapshot fidelity and malformed-format handling.
- Real PTY input/output, Unicode, resize, exit, authenticated connection, replay, reconnect, close, and service shutdown.
- Electron UI navigation/search/notes plus terminal continuity after a full application quit/relaunch.
- `RUNHUDDLE_TEST_EXECUTABLE` can point UI tests at a packaged executable to verify the bundled helper and native module.

The icon is generated from RunHuddle's existing native icon source (`Sources/SessionManager/RunHuddleIcon.swift` and `scripts/icon/main.swift`). No Proactive source code or assets are included.

## Planned investigation: repository code graphs

Evaluate Graphify and inspect how Proactive integrates it before selecting an implementation. Desired workflow: an agent queries a repository code graph to locate relevant files before reading them, and users can browse the graph in RunHuddle. Storage location (repository, app data, or elsewhere), incremental indexing, query interface, and token/runtime costs are unverified. Local storage was a user interpretation, not a confirmed Proactive capability. The current working assumption is a repo-level graph; verify whether its generated files should be committed or ignored.
