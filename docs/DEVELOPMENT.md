# RunHuddle development notes

Historical implementation notes and validation snapshots. For current installation steps and supported features, see [the README](../README.md).

Native macOS session tracker with live Codex discovery and simulated Claude Code sessions. The first local development app is implemented; Claude live integration remains pending paid access and validation.

## Standalone packaging (0.2.0)

`build-app.sh` packages a checksum-pinned Python 3.13.18 runtime plus pinned websockets/PyYAML wheels. All bridge scripts and third-party license notices live inside the app. The app and Copilot hooks invoke the interpreter with `-E -s -B`, so Python environment overrides, user packages, and bytecode writes do not affect the signed runtime. Source development still uses `.venv`.

First launch checks standard CLI locations and the Codex socket. Copilot setup is opt-in and points at the installed app; existing source collector hooks can migrate without replacing unrelated collectors. CLI detection does not prove authentication. Claude remains demo-only.

Validation: 22 Swift tests, 36 Python tests (also run with bundled Python), relocated app with empty HOME and system-only PATH, runtime dependency/symlink checks, hook invocation and FTS search, signature after execution, read-only DMG mount, and a live Codex snapshot from the installed app. Apple Silicon only has been exercised. Current build is ad-hoc signed; Developer ID signing and notarization remain pending.

## Original source preview (historical)

Open `dist/RunHuddle.app` after building:

```sh
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt
bash scripts/build-app.sh
open 'dist/RunHuddle.app'
```

Requires macOS 14+, Swift 6, Python 3, and the existing Codex shared server. This development bundle references this checkout and its `.venv`; keep them in place. It is ad-hoc signed, not a standalone distributable or App Store build.

Choose **Show Claude demo** to explore simulated permission, question, working, idle, and exit transitions. Demo sessions cannot launch agents and are excluded from persistence and attention notifications.

The Handoff tab separates autosaved editable notes from read-only recorded context. Context refreshes when the tab opens, when an observed working session becomes idle, and before Copy, Export, or Start fresh. Concurrent requests for the same session share a fetch. A timestamp shows the last successful retrieval; failed fetches retain cached context and label the failure both onscreen and in the outgoing handoff. Existing drafts, including any previously edited generated sections, are preserved verbatim as notes. Refresh recorded context remains a manual fallback. Codex context extracts recent requests, responses, command outcomes, and file changes from up to eight recent turns. This is bounded recorded history, not an AI-generated summary. Starting fresh sends notes plus recorded context through the existing CLI.

Session metadata, selected session, and drafts live in `~/Library/Application Support/Agent Session Manager/sessions.sqlite`. On restart, cached live sessions show Disconnected until refreshed; saved history remains Saved. Resume restores conversation context, not interrupted shell processes. Enable Open at Login from the menu bar to launch after signing in; macOS may require approval in Login Items settings.

Desktop notifications cover **Needs input** and observed **Working → Idle** transitions. The latter means ready for review, not verified task success. They are not emitted for initial history import, reconnecting to idle sessions, or demo events. Recent activity also appears in the sidebar while the app is running. Polling can miss work that starts and finishes entirely between five-second snapshots.

Both notification types have **Go to terminal** and **View session** actions. Clicking the banner itself goes to the terminal too. A unique match focuses the existing tab/pane; otherwise the tracker opens its chooser, never an automatic duplicate. Denied permission appears inline with a Notification Settings link; the menu-bar count continues to work. **Send test alert** checks desktop delivery. Actual banners depend on macOS permission, notification style, and Focus settings.

## Existing terminal navigation

**Go to terminal** discovers currently running Terminal.app and Ghostty instances through AppleScript. It matches a unique exact session title plus project-folder title (ignoring the Codex spinner), with an exact working-directory check when Ghostty exposes it. Multiple matching tabs or identical session titles open a chooser. Folder-only matching is never used. The focus action rechecks the target before acting and does not send commands to existing tabs.

Terminal.app focus was verified locally without increasing the window count. Ghostty uses its documented AppleScript API (1.3+ with scripting enabled), including split-pane focus; it was not installed/running on this Mac, so live Ghostty validation is pending. Unsupported versions or denied Automation permissions are shown in the chooser. Customized titles, tmux/SSH, and renamed sessions may require manual selection. **Open another Terminal window** is an explicit fallback.

## Session cleanup

Select a Saved Codex session and choose **Archive…**. The review sheet lists the affected root and descendant sessions before you confirm. **Archived** in the sidebar keeps archived histories out of the main list and offers **Restore…** or **Delete permanently…**. Restore applies to the selected session only; archived child sessions are also listed so they can be restored separately.

These actions use Codex's archive/unarchive/delete APIs and affect its history across clients. They do not target repository files. Archive preserves tracker handoff drafts; permanent deletion also removes affected local drafts, so export anything needed first. Loaded sessions (including idle sessions still open in a client), ephemeral sessions, and unknown runtime states block cleanup. Delete requires the whole affected tree to be archived. The adapter rechecks the affected IDs and runtime state immediately before the operation; if the scope changed, review is required again. Concurrent external changes cannot be made atomic with this client-side check.

Cleanup tests use a fake provider to verify descendant scope, revalidation, archive requirements, and loaded-session protection. A read-only cleanup plan was verified against the real server; no existing user history was archived or deleted during development.

## Checks

```sh
swift test
.venv/bin/python -m unittest discover -s Tests -p 'test_*.py' -v
```

Eleven Swift tests cover persistence, draft preservation, search, Claude lifecycle mapping, command quoting, handoff identity, stale-state recovery, terminal matching/ambiguity, and notification transitions. Six Python tests cover Codex state mapping, pagination, deduplication, malformed pagination, and bounded chronological handoff extraction. Live read-only checks verified 37 sessions across eight projects and paginated history extraction. No paid Claude requests were made.

## MVP

- SwiftUI session window and menu-bar attention count.
- Unified Needs input, Working, Idle, and Disconnected/Unknown states.
- Search by project, session title, and path; retain exact worktree paths.
- Persist provider session IDs, notes, and project associations in SQLite.
- Restore the index after reboot and resume a selected conversation explicitly.
- Editable handoff brief: objective, decisions, completed work, files, verification, blockers, next steps. Copy or pass to a fresh session.
- Keep approval handling in the original agent client.

## Integration findings — 2026-11-09

### Codex: live discovery verified

Installed CLI and running shared server both report 0.167.0. The existing server accepts a WebSocket connection over its Unix control socket. `app-server proxy` is a byte proxy, not a JSONL-to-WebSocket adapter; sending JSONL to it timed out.

The read-only probe successfully initialized, called `thread/loaded/list`, and fetched `thread/list`. At verification time it returned 36 sessions: 1 active, 5 idle, and 30 not loaded. All 36 included a working directory. This establishes coverage for this shared server; independent servers and other machines remain outside that verified scope. The probe prints counts and field names rather than titles or conversation contents.

Map active waiting-on-approval/input flags to Needs input; active without waiting flags to Working; idle to Idle. A not-loaded thread is saved history, not verified idle. Connection loss invalidates runtime status. Poll metadata initially; verify notification subscription behavior before relying on event delivery. Do not resume threads merely to observe them.

### Claude Code: installed; live validation pending login

Installed native CLI 2.1.322 at `~/.local/bin/claude`. Added that directory to `~/.zshrc`. `claude auth status` reports not logged in. `claude agents --json` succeeds with an empty array. Installed help describes this command as listing both interactive and background active sessions; actual status fields and coverage still need validation with authenticated sessions.

Use the session-list command for discovery where supported and lifecycle hooks for timely transitions. Validate SessionStart, UserPromptSubmit, PermissionRequest, explicit questions, Stop, and SessionEnd. Notification idle_prompt is delayed and must not be treated as an immediate question signal. Hook helpers should return quickly, preserve existing settings, and never approve actions. No hooks have been installed yet.

### Remaining validation and limitations

- Claude events are simulated; no hooks are installed and no live Claude polling is implemented. Actual permission/question transitions require authenticated testing later.
- Codex visibility covers the connected shared server, not independent app-server processes or remote machines. Active child-agent sources are omitted from the main list; archived children appear in Archived.
- Attention updates poll every five seconds. Ordinary conversational questions without a structured waiting flag remain idle.
- Full-machine reboot, interactive resume/attach, Terminal automation permission, and notification delivery need user-environment acceptance testing. SQLite close/reopen is covered by tests.
- Handoff context is bounded, may be incomplete, and uses `thread/turns/list`; unavailable history produces a visible error or placeholder rather than invented context.

## Reproduce the Codex probe

Requires a running shared Codex server and access to its local socket. No model calls, turns, or session mutations are requested.

```sh
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt
.venv/bin/python scripts/probe_codex.py
```

The probe honors CODEX_HOME and defaults to `~/.codex`.

## References

- [Codex app-server protocol and transports](https://learn.chatgpt.com/docs/app-server)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code CLI](https://code.claude.com/docs/en/cli-reference)
- [Claude Code installation](https://code.claude.com/docs/en/setup)
- [Ghostty AppleScript API](https://ghostty.org/docs/features/applescript)

## Copilot CLI

Copilot CLI 1.0.107 is installed via Homebrew (`copilot-cli`). The tracker now includes a Copilot provider filter, project/branch search, saved-session discovery, resume (`copilot --resume ID`), and recent transcript context for handoffs. Fresh handoffs use `copilot -i PROMPT`. Cleanup remains Codex-only.

The adapter reads `~/.copilot/session-state/*/events.jsonl` (or `$COPILOT_HOME/session-state`). It does not edit Copilot's transcripts or database. Transcript reads are bounded to the first 256 KiB and last 1 MiB; context may be incomplete. Empty CLI sessions are discovered from workspace.yaml even before a transcript exists. When a Copilot process is verified to hold the session file open but no live hook state is available, the tracker shows Disconnected with an explicit activity-unconfirmed explanation. Leftover lock files alone do not prove a live session.

Install the observational hooks with:

```sh
.venv/bin/python scripts/copilot_bridge.py install-hooks
```

This writes only `~/.copilot/hooks/agent-session-manager.json`; existing CLI sessions must restart to load it. Hooks use the current checkout and Python environment, so reinstall after moving the repository. Remove that file to uninstall the hooks. Tracker state is stored separately in `~/Library/Application Support/Agent Session Manager/copilot.sqlite`.

Hooks track prompt submission, tool completion, turn completion, session end, errors, and actual permission/question notifications. PermissionRequest alone is deliberately ignored because it also fires for automatically permitted actions. Subagent completion cannot mark the main session idle. The collector emits no output or decisions and exits successfully on recording errors. Missing or disabled hooks therefore mean live status is unavailable. The tracker verifies the owning Copilot process and its start time before displaying a live state; closed sessions become Saved. Terminal.app navigation uses a verified process TTY when available; Ghostty retains title matching and the explicit terminal chooser.

Polling is every five seconds, so very short transitions between polls may not produce a notification. Copilot provider failures are isolated from Codex. Initial discovery and reconnect do not emit historical alerts.

Validation: fixture tests cover lifecycle, actual approval prompts, out-of-order events, subagents, process exit/PID reuse, and transcript discovery/history. A live CLI launch reached its interactive UI but the account returned HTTP 403 (“not authorized to use this Copilot feature”) when loading models. The real sessionEnd hook was received with a verified owner process and the session appeared as Saved. No authenticated work cycle, permission/turn hook delivery, or Copilot notification delivery has been verified. Resolve account access using `copilot login`, then start a session in a project to finish acceptance testing.

References: [Copilot hooks](https://docs.github.com/en/copilot/reference/hooks-reference), [CLI quickstart](https://docs.github.com/en/copilot/get-started/cli-quickstart), [session data](https://docs.github.com/en/copilot/concepts/security-governance-and-network-settings/session-data).

## Context usage

Session rows and details show the latest reported context estimate when available. The detail meter includes tokens/limit, observation time, and a Prepare handoff shortcut. Usage is informational: no percentage triggers a warning or recommendation to restart. The meter explains that compaction can reduce usage. It never starts a fresh session automatically.

Codex thread/list does not include usage in the installed protocol. The adapter reads at most the final 2 MiB of the transcript path returned by the server, using `token_count.info.last_token_usage.total_tokens / model_context_window`. Cumulative `total_token_usage` and account rate limits are never used for the meter. This is the last reported request footprint, not an exact instantaneous measurement: activity after that report can change context. A subsequent compaction invalidates the reading until a new usage event arrives. Missing, invalid, inaccessible, or out-of-range-of-the-bounded-read data displays Unavailable. Saved/offline sessions retain the last reported timestamp. Claude and Copilot currently show Unavailable; their context reporting has not been verified.

Verified against live Codex transcripts and fixture tests for cumulative-vs-last usage, decreasing usage, compaction, invalid limits, and over-capacity values. The local transcript format is a best-effort integration and may change with CLI updates.

## RunHuddle identity

RunHuddle is published by Rootsignal. The local development bundle retains its existing identifier and Application Support paths so saved sessions, drafts, hooks, and notification settings continue to work. The menu-bar template mark and app icon share a vector design: a forward-leaning H monogram with a rising crossbar. The menu-bar count appears only when sessions need input. App icons are generated during packaging from the same Swift drawing code.

## Menu-bar overview

The menu summarizes real Working, Needs input, and Idle sessions. Needs input and Working each show up to five entries, followed by up to three observed recent completions that are still idle. If there are no recent completions, it shows up to three idle sessions instead. Completion observations are local to the current app run. Overflow links open the appropriate main-window filter. Saved, archived, disconnected, and demo sessions do not appear in these groups.

Session entries refresh their state and use existing terminal navigation; a unique terminal match is focused directly, otherwise the main window opens with the terminal chooser. No duplicate terminal is launched automatically. Open at Login uses SMAppService.mainApp and reads actual macOS registration status, with error and approval links where needed. Adding the toggle does not enable login launch automatically. Full sign-out/sign-in acceptance testing remains pending.

## Session display names

Right-click a session and choose Rename, or use the pencil beside its detail title. Names are local to RunHuddle, persisted separately by provider and session ID, and shown in lists, menu entries, activity, notifications, and the terminal chooser. Search matches both custom and original names. The original title remains in Overview; Reset to original name removes the override. Provider history and terminal matching always use the original session title. Existing handoff notes are not rewritten by a rename. Archive/restore preserves display names; permanent deletion removes them.

## Terminal navigation feedback

Go to terminal immediately enters a busy state with Finding terminal / Opening terminal progress. Navigation is serialized across the detail button, menu entries, and terminal chooser; repeat clicks are ignored until it completes. The menu-bar mark shows an ellipsis while navigation is pending. Apple Events run in a background osascript process with a 15-second timeout per operation so the UI stays responsive. Focusing validates the selected window/tab identity and original title (and Ghostty working directory) directly, avoiding a second full discovery scan. Live Terminal.app discovery/focus and rejection of changed titles were verified; Ghostty remains pending live validation.

Copilot live validation (2026-11-10): discovered the user-started session from workspace.yaml, confirmed its process holds the session file open, and found its Terminal.app tab. Empty history returns an explanatory result. The CLI still reports HTTP 403/no Copilot access, so prompt, approval, completion, and notification checks remain blocked. No prompt was submitted and the running session was not modified.

## Activity overview and local history search

Overview now leads with an editable purpose, latest recorded user request and agent response, and editable next-step/blocker notes. These notes persist separately from recorded history and are included in Copy, Export, and fresh-session handoffs. Original request previews provide a fallback until a purpose is written. Long messages are excerpted with an expandable recorded-message view. Technical fields live under Session info. Recorded activity refreshes on opening the detail pane and after observed work completion; retrieval time and newer-session-activity indicators distinguish snapshots from live state. No completion or verification is inferred from prose.

The search box matches names, project metadata, purpose/next-step notes, and locally indexed user/assistant messages for Codex and Copilot. Search results show the matching role and excerpt. Current provider/state filters still apply; use Archived to include archived sessions. Search debounces typing and ignores results from superseded queries. The SQLite FTS5 index lives in Application Support/Agent Session Manager/history-search.sqlite with owner-only file permissions. It indexes available provider transcript files locally, without model calls, and incrementally consumes appended complete JSONL lines. Rewritten/truncated files are reindexed; provider-deleted records are pruned when discovery succeeds. Unavailable provider/files are reported and can leave cached results until a successful refresh. No-match is not a guarantee when coverage is incomplete. Matching uses literal words (all words within one message), not semantic search or user-supplied FTS syntax. Up to 1,000 matching messages are considered per search.

AI-generated purpose/progress summaries remain a later optional integration; the current UI shows attributed recorded excerpts, not generated summaries. No external summarization provider is configured.
