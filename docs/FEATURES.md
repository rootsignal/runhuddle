# RunHuddle feature checklist

This checklist covers the macOS release through 0.39.1. Update this checklist when a feature ships or a proposal changes.

## Shipped in 0.38.0 or earlier

| Area | What you can do |
| --- | --- |
| Live sessions | Track working agents and elapsed time. Jump to sessions waiting for input or ready for review. Name sessions and switch between Preview, Terminal, and Changes. |
| Follow-ups | Draft per session and attach screenshots while the agent is working. Draft text and attachments persist locally. Click Send follow-up yourself once the terminal is ready. |
| Preview | Read the latest instruction and agent update, expand the recorded reply, preview supported project files, and open web links in RunHuddle Browser or the default browser. |
| Projects and history | Browse projects from the dashboard, focus on one or filter to several, inspect recent sessions, and search conversation content. Review old sessions one at a time, keep or hide them, or request an AI-assisted project review. |
| Working tools | Use Quick Terminal or the dashboard shell, open RunHuddle Browser, and remap Command Palette and Quick Terminal shortcuts. Use the workspace for split terminal layouts. |
| Power | Opt in to keeping the Mac awake while an agent is working. |

## Fixed in 0.39.1

- Preview looks farther back when large Codex tool output pushes recent turns out of the transcript tail.
- Queued follow-ups can verify the empty Codex prompt in long macOS and Linux sessions after startup output rolls out of the replay buffer. The composer shows a short label and a way to check the terminal when a queue is waiting.

## Added in 0.39.0

- Dashboard follow-up checks the current terminal screen and paste mode. This release also updates terminal redraw and status detection. The full popup → browser → Preview follow-up sequence still needs testing on the MacBook where it failed.

- Queue one follow-up per live Codex session on macOS or Linux. Delivery requires an idle session and a verified empty terminal prompt. Cancel to edit the draft, including screenshots. The queue runs while RunHuddle is open. Restarting keeps the draft and requires a fresh send or queue action. A queue waits through an unready prompt. A failed write leaves the draft available for manual review.

- Browse up to five turns in the live Preview timeline. Narrow panes and the split shell use compact turn controls. Current attention and follow-ups stay live. The Uncommitted summary shows changed files and tracked line counts, and opens the checkout’s Uncommitted view. For follow-ups sent from Preview, enable Turn changes from Layout to see a compact button below the reply with the captured files and diffs. Preview layout lets you show or hide Recent turns, Uncommitted, Turn changes, and file and link references. Forward commits on the same branch have their own captured diff, separate from remaining uncommitted edits. Starting snapshots survive a restart while a turn is in progress. Completed captures are saved locally across restarts, up to five per session within a shared storage limit.
- Markdown file previews render GitHub-style tables, task lists, headings, quotes, and code blocks. Web links use the browser confirmation.
- Dashboard Changes keeps the file list and diff side by side on wide panes. Review changes with file and hunk navigation, tracked-file line counts, and retained diff position.
- Dashboard Changes remembers Unified or Split. Next Change and Previous Change work across files, including with F7 and Shift+F7 in the diff. A live refresh tries to keep the visible line in place.
- Session replies use the Markdown renderer, including tables. Changes has a compact Review scope picker, a remembered comparison target per feature branch, and a latest-commit shortcut when the worktree is clean.
- The dashboard Git bar can switch or create branches, fetch, fast-forward pull, push, and publish. It shows sessions sharing the checkout and prevents branch changes or pulls while one reports working. Published GitHub branches can prepare an editable PR title and description in RunHuddle and open the prefilled form in GitHub. Generate PR summary uses an installed agent to describe the published changes and can include recent context from the selected session.

- Connect GitHub from Changes or Integrations → GitHub MCP to see open PRs, checks, and review feedback for published branches in the same github.com repository. PR status refreshes when you return from the browser or click Refresh changes. Inspect failed Actions steps and short log excerpts in Changes, or add the exact job and failure context to a follow-up draft. Actions read access may be required.
