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

## Session navigation and companion shells

The center opens sessions across project folders in a shared tab layout. The sidebar's Projects view and project filter organize history without hiding or switching open tabs. The + control next to tabs opens the agent/folder launcher. A shared full-width toolbar above the terminal and tools columns follows the focused pane, with its folder and Git context, Shell toggle, VS Code action, and Show folder menu.

Shell opens one companion PTY below the current tab in that tab's folder. Hiding it keeps it running; End shell uses the normal process-close confirmation. Visibility, parent mapping, and divider height survive UI restarts. Companion shells are excluded from top-level tabs and terminal rows while their parent exists. If the parent is removed, the surviving shell becomes a standalone terminal so it remains accessible. Saved collections of tabs and first-run onboarding are follow-up work; Projects currently means repository folders, not saved layouts.

### Screen review — 2026-11-17

Reviewed the existing preview screens against the installed Proactive app. Adopted its compact navigation, full-width tab strip, nearby folder actions and companion shell pattern; retained RunHuddle's resizable pane groups and terminal appearance controls.

| Screen | Result |
| --- | --- |
| Recent/search | Compact provider/title/status rows, date groups, retained query and filters; unknown unlinked agent activity is neutral. |
| Projects | Expand folders in place to browse sessions; New session and View all stay with their folder. |
| Recorded session | Local user/assistant history, message search, Resume primary action; archive/new-session and legacy linking are secondary. Transcript reads run in a worker, capped at 4 MB and 250 messages. Tool payloads are omitted. |
| New session | Explicit project destination, three supported agents and separate shell choice, last-used focus, visible launch errors. |
| Terminal workspace | Tab strips span above the tool panel; panes resize/rearrange; closing a tab keeps the process. Shell opens a persistent companion below the current session. |
| Notes | Project/source context, readable document, Copy and Markdown export. Imported native notes remain read-only. |
| Appearance | Searchable theme catalog, installed fonts, live shell-style preview, cursor/spacing and custom ANSI palette retained. |
| Git review | Uncommitted, recent commit and branch comparison views; explicit snapshot wording, file diffs and responsive tool panel retained. Read-only; no commit/push controls implied. |
| Welcome | Recent conversation shortcuts plus New session/terminal entry point. |
| Recovery | Quit/reopen retains terminals and layouts; helper loss shows recovery state without duplicating terminal tabs. |

UI coverage includes actual fixture transcript loading/search, expandable projects, note clipboard/export, archive/restore, full-width strip geometry, dense rows, launch flows, themes/cursor, Git refresh/diffs, split layouts, companion shells, narrow windows and full app restart. Proactive integrations (Graphify, vault, tickets, browser, databases) are not part of this existing-feature pass. Graphify remains deferred for separate investigation.

### Sidebar simplification

Recent and Projects are the only sidebar modes. Session scopes use one dropdown; a removable project chip appears only when a project has been selected. Notes lives in the right tool rail with its own search. Session rows expose process ending in an overflow menu. The footer holds New terminal and inventory counts; empty terminal sections and repeated creation controls are omitted.

### Proactive Team hub investigation (static inspection)

The installed 0.14.3 bundle includes readable client modules; no sign-in bypass or server calls were used. `src/features/library.js` gates its REST client on hub sign-in and delegates local installation to `_library-core.js`. The library supports prompts, rules, MCP setups and skills. MCP sharing substitutes credential values with variable placeholders, validates the shareable configuration, and builds an install plan showing which variables exist in the recipient's vault. The renderer provides publication and installation dialogs. `renderer/team.js` also exposes shared-folder settings and team MCP/database installation flows. This establishes useful local workflows we can implement independently; actual team synchronization and backend authorization remain unverified. Proactive source is not copied into RunHuddle. Further code investigation should distinguish local functionality from authenticated hub APIs before choosing new features; Graphify remains a separate investigation.

File diffs open over the central work surface while the Changes sidebar stays available for navigation. The unified review includes old/new line numbers, colored changes, scrolling, and Escape/Close to return focus to the terminal. Opening Changes does not open a diff until a file is selected. Git staging, committing, and upstream push are available through explicit controls.


### Editor and Git workflow

- The toolbar and diff review detect installed editors and offer an explicit chooser. The selected application is remembered; custom applications can be picked with the native file dialog.
- Folder actions open the active session folder. Diff actions open the current local file; select a new-line number to pass a position to supported editors. Deleted/historical-only files report that no local file is available.
- Repository filesystem events are coalesced and refresh changes automatically. Generated dependency/build folders and Git object/lock churn are ignored. Focus/manual refresh remains available.
- Individual Stage/Unstage actions preserve working files. Commit uses the current staged index and leaves unstaged content alone; Git hooks and identity errors are surfaced.
- Ahead/behind uses locally known upstream refs, explicitly labeled as last-fetch information. Push uses the current branch's configured upstream, never force-pushes, and is disabled without an upstream or when behind. Initial publication and conflict resolution remain terminal workflows.

### Source Control alignment

Compared against the installed VS Code Source Control UI: commit input/action sits above collapsible Staged Changes and Changes groups. Group headers offer Unstage All and Stage All; individual rows retain −/+ controls. Stage All includes tracked and untracked changes while respecting Git ignores. Unstage All resets only the index. Commit & Push is an explicit commit-menu option; a failed push reports that the local commit succeeded.

Follow-up: investigate provider-reported plan limits and a dismissible warning with “Continue with another agent” leading to handoff review. Do not infer subscription quota from context usage; percentages must come from reliable provider usage data.

### Usage warnings and handoffs

Codex usage is read through the installed CLI's account/rateLimits/read endpoint (no model turn), cached for one minute, refreshed on agent completion/app focus or request. Low-allowance warnings show percent remaining and reset time, with per-window dismissal and a new alert at exhaustion. Credits are separate; expired/stale quota does not warn.

Claude usage connection is opt-in from the agent usage menu. It adds a local status-line relay, saves only rate-limit windows, chains the prior status-line command, and restores it on disconnect if the setting is still owned by RunHuddle. No Claude settings are changed during installation. Current connection supports macOS/Linux. Copilot AI-credit limits are explicitly unavailable; the UI directs users to /usage rather than interpreting legacy zero quota as exhaustion.

Handoff review assembles bounded recent conversation excerpts plus a current repository file/branch snapshot. Users edit context, choose another supported agent, and create its terminal. Paste is a separate action after CLI login/trust prompts; it uses bracketed paste and never auto-submits. The original session remains open. This is a reviewed context transfer, not an AI-generated summary.

Popup menus dismiss on outside pointer clicks and Escape; Escape returns focus to the menu trigger.
