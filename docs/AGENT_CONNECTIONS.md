# Agent connections

[Documentation](README.md) · [RunHuddle](../README.md)

## Supported integrations

| Tool | Current support |
| --- | --- |
| Codex CLI / shared app server | Live discovery, status, history, resume, context estimates, and cleanup. Tested against 0.167.0. Requires the compatible local shared server. |
| GitHub Copilot CLI | Local discovery, observational hooks, history, and resume. Tested against 1.0.107; full authenticated work/approval/completion testing remains pending. |
| Claude Code | Local history discovery, live activity hooks, history search, handoffs, and resume. CLI 2.1.322 startup/exit hooks verified; authenticated work/approval testing remains pending. |
| Terminal.app | Existing-tab discovery and focus verified locally. |
| Ghostty | Scripting integration implemented; live validation remains pending. |

RunHuddle observes local agents. It does not supply model access or bypass provider authentication. Activity excerpts and search are local. Generating an AI handoff is optional and explicitly sends recorded context to your selected provider; see [AI handoffs](USING_RUNHUDDLE.md#ai-handoffs).

## Connect Codex

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

## Connect Copilot CLI

Copilot tracking is configured automatically after detection. **Connections…** shows its status and offers a retry if configuration failed. Alternatively, add `--copilot-hooks` to the source installer command. This creates `~/.copilot/hooks/agent-session-manager.json` (or `$COPILOT_HOME/hooks/…`) pointing to the installed app's bundled interpreter and collector. Unrelated hook files are preserved. Outdated RunHuddle app paths are migrated even if the old app has been deleted, with a backup before replacement. Restart existing Copilot sessions to load the hooks. The hooks observe activity; they never grant permissions or inject prompts.

An empty session can appear before its first prompt. When its CLI is open but live activity cannot be verified, RunHuddle explains that status rather than claiming it is idle or working.

## Connect Claude Code

Supported Claude versions connect automatically. For older versions, open **Connections… → Connection details → Enable Claude compatibility hooks**. RunHuddle merges observational hooks into `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`), preserving other settings and hooks and saving a backup before changing the file. Supported Claude versions expose existing interactive and background sessions through `claude agents --json --all`, so those sessions are discovered automatically without restarting. Hooks remain a fallback for older versions; those sessions may need to reload hooks or restart/resume.

When an existing RunHuddle hook points to an old app location, RunHuddle repairs its own hook paths automatically, backs up Claude settings, and asks you to fully exit and relaunch already-open Claude processes from the shell. Using /resume inside an existing process may retain its previously loaded hook commands. Unrelated hooks are preserved; disabled hooks are not re-enabled.

History is discovered from local project transcripts. Without live-list or hook/process evidence, a session is labeled **Disconnected** with an explanation that its live status is unknown. Verified running sessions show Working, Needs input, or Idle; ended sessions and tracked processes that have exited show Saved. PID and process start time are checked to avoid stale state after reboot or PID reuse. Child-agent events do not change the main session's state. Idle compaction preserves the prior activity state. An interactive process with no controlling terminal is shown as Disconnected, retaining the status reported by Claude in its explanation. Verified background processes remain distinct from detached interactive sessions.

Tracking does not grant permissions, inject prompts, or require a separate model API key. Claude still needs its own authentication. Custom CLI installations that cannot be identified may show unknown live status. No Claude context-window percentage is inferred from transcript size.

For connection errors and stale sessions, see [Troubleshooting](TROUBLESHOOTING.md).
