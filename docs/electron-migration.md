# Electron migration

Decision: build the replacement alongside the native app, prove session/terminal lifecycle parity, then cut over. Keep the native release pipeline and user data intact during development. One installer per operating system; no external terminal multiplexer requirement.

## Milestones and acceptance gates

1. **Foundation (implemented in `electron/`).** Original React workspace UI, searchable native data snapshot, read-only notes, bundled node-pty helper, xterm tabs, reconnect across full UI quit. Validate package runtime separately from development launch. macOS locally tested, including the packaged app. macOS, Windows, and Linux now pass CI build, real terminal-service integration, UI quit/relaunch, and unpacked packaging checks; hands-on Windows/Linux installer validation remains a release gate.
2. **Live provider parity.** Reuse existing Codex/Claude/Copilot bridge behavior behind typed service adapters. Associate CLI sessions with terminal IDs; deduplicate shell-launched agents. Separate lifecycle from work state. Verify missed Stop/End hooks, desktop/external sessions, stale PIDs, offline recovery, forced takeover, selection updates and truthful counts. Do not equate terminal output or a quiet timeout with working/idle. Bundle any retained Python bridge runtime.
3. **Workspace layouts.** Named collections of project folders and tabs, reopen without duplicate agents, companion shells, draggable/resizable splits, tab ordering, shortcut navigation. No automatic startup commands without a reviewable action. Keep project folder identity distinct from a saved layout.
4. **Project knowledge.** Implement the notes model below; preserve existing note IDs/text/source metadata in a tested migration with backup and rollback. Render Markdown safely. No inferred completion or verification claims.
5. **Workspace Git panel.** Branch, changed files, staged vs unstaged, searchable readable diffs, open in editor, review with agent. Then explicit stage/unstage, commit and push workflows with selected scope and error handling. Worktrees for isolated tasks. Refresh from filesystem/explicit changes and coalesce events; no per-tab status polling loops. Repository changes belong to a workspace, not an individual session. Preserve native Git edge-case behavior (renames, untracked/binary files, spaces, missing remotes).
6. **Agent tools / MCP.** Discover each provider's configured servers and scope, display availability/health, and show a capability matrix. Add/edit/remove through provider adapters with a preview and backups, preserving unrelated config. Never silently mirror credentials or project-scoped tools to every agent. Tool health checks are opt-in or bounded, not continuous process polling. Distinguish managing agent MCP config from RunHuddle itself hosting an MCP client/server. Browser tools and other bundled servers are separate opt-in features.
7. **Context and workflows.** Optional Graphify indexing and query integration, including index freshness, project scope and measured task-level token benefit. Bounded builder/reviewer work and scheduled worktrees only after ownership and recovery are reliable.
8. **Cutover.** Feature/data parity, signed/notarized platform packages, updater, safe helper compatibility during updates, 100-session idle CPU/memory measurements, process crash/reboot recovery, Windows/Linux tests, and explicit migration/rollback. No production release from the preview pipeline.

## Notes refinement

Keep four different user intentions clear:

- **Session reminder:** short “where I left off / do next” annotation attached to a session.
- **Pinned answer:** exact source answer bookmarked within a conversation, with jump-to-source. Not automatically a project-wide truth.
- **Project note:** editable reusable knowledge (decision, reference, procedure), scoped to a workspace. Retain source agent/session/message and generated/edited timestamps. Browse and search independently of the originating session. Actions: Edit, Use in new session, Save as Markdown. Optional project file destination such as `docs/decisions/`; show path and review before writing/overwriting.
- **Recap / handoff:** a point-in-time summary for continuing work. Distinguish confirmed work, open questions, and proposed next steps. This should not silently become evergreen project knowledge.

Existing notes remain accessible during development. Do not auto-convert every historical summary into a decision. A new-session composer should let users select relevant notes and preview the context being sent. Obsidian export remains useful but should be optional.

## Reference inspection

Proactive 0.14.3 was statically inspected from a user-supplied DMG. These are observed UI/code capabilities, not hands-on quality claims. No source or assets were copied.

- Recent / Projects sidebar, search, compact tab strip; saved workspaces reopen tab collections with startup command confirmation. Companion shell and grid layout are useful references.
- Session reminder annotations and tags; persistent answer pins with jump actions; Save answer as document writes project Markdown (default `docs/decisions/`) and prompts before replacing a file; recap is a separate reader action.
- MCP inventory distinguishes scopes, has add/remove/promote/sync/health operations and per-agent adapters. It also ships custom browser, screen and service-specific MCP servers. Prefer a provider-aware configuration UI before building proprietary-service integrations.
- Changes panel supports review and commit; adjacent repository/branch context and editor actions are relevant to RunHuddle. Evaluate staged changes, review, worktrees and explicit mutations against our existing native implementation before porting.

Build the general workspace capabilities first. Do not import an enterprise-specific Azure/ServiceNow/Jira integration suite merely because the reference app includes one.

## Foundation validation (2026-11-17)

[Cross-platform check run](https://github.com/rootsignal/runhuddle/actions/runs/44135121437) passed on macOS, Ubuntu, and Windows. UI tests type through xterm, preserve search across filters, read imported notes, request a normal app quit, assert process exit code 0, and reconnect to the original terminal after relaunch. The test runner releases diagnostic pipes only after the UI process exits; it never kills the helper to make the restart test pass.

The macOS arm64 packaged app also passed the restart test locally. A separate, locally ad-hoc-signed `RunHuddle Preview.app` was installed in `/Applications` at the user's request and opened successfully against the existing native store (14 sessions). This is a development preview, not a notarized public release. Production RunHuddle and its release/update feeds were not changed.

Before distribution, verify helper lifetime under AppImage mount/unmount, Windows installer/update file locks, and a versioned helper upgrade strategy. The initial helper survives UI quit/reopen; reboot and update recovery are not yet established.

### Preview session lifecycle (2026-11-17)

New preview agent terminals carry exact provider conversation IDs. Claude and
Copilot receive explicit UUIDs; Codex allocates and persists a named thread via
its local app-server protocol, then opens that ID with `resume --no-daemon`.
No model turn is sent during allocation. This requires current CLI versions
supporting these commands; initialization errors stay in the launcher.

The terminal helper keeps an atomic local session ledger across UI and helper
restarts. File events read bounded increments of the specific conversation's
transcript. Unknown activity stays unknown; terminal exit wins over stale native
status. Exact provider/ID reconciliation merges native history with owned
sessions. Resume focuses an already-owned terminal; external last-known active
sessions require a visible warning. Archive is local RunHuddle organization and
does not delete or archive the provider's underlying conversation.

The lifecycle helper uses `service-v2`. The UI still connects to a running older
`service` helper, preserving those terminals. Older agent terminals can be linked
explicitly from a recorded conversation's page; no title/folder heuristic silently
assigns identity. Old Codex terminals may use its shared background server, so
closing their connection is not a guarantee that background work has ended.

Terminal launches discard inherited `NO_COLOR` and helper-only Node/Electron
variables and advertise xterm-256color/truecolor. The renderer has an explicit
16-color ANSI palette. Already-running CLIs retain their original environment;
resume them through the new helper to receive the corrected color environment.

### Pane groups

The Electron workspace now uses a persisted split tree per workspace. Each leaf owns an ordered tab list and active tab; branches store right/down orientation and divider ratio. Sidebar selection focuses an existing tab without moving it. New terminals enter the focused group. Arrange offers move right/down, move to another pane, and combine all tabs; drag targets support moving, reordering, and right/bottom splits. Empty groups collapse without stopping the underlying terminal. Closing an AI tab still hides its view; End session remains explicit.

UI regression coverage exercises nested right/down splits, keyboard resizing, independent tab selection, creation in the focused pane, sidebar focus, restart restoration, tab drag/reorder and edge drops, merging empty panes, and terminal output surviving app restart. Legacy global split controls are removed.
