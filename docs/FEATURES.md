# RunHuddle feature checklist

Baseline is the published macOS release 0.38.0. Update this checklist when a feature ships or a proposal changes.

## Shipped in 0.38.0 or earlier

| Area | What you can do |
| --- | --- |
| Live sessions | Track working agents and elapsed time. Jump to sessions waiting for input or ready for review. Name sessions and switch between Preview, Terminal, and Changes. |
| Follow-ups | Draft per session and attach screenshots while the agent is working. Draft text and attachments persist locally. Click Send follow-up yourself once the terminal is ready. |
| Preview | Read the latest instruction and agent update, expand the recorded reply, preview supported project files, and open web links in RunHuddle Browser or the default browser. |
| Projects and history | Browse projects from the dashboard, focus on one or filter to several, inspect recent sessions, and search conversation content. Review old sessions one at a time, keep or hide them, or request an AI-assisted project review. |
| Working tools | Use Quick Terminal or the dashboard shell, open RunHuddle Browser, and remap Command Palette and Quick Terminal shortcuts. Use the workspace for split terminal layouts. |
| Power | Opt in to keeping the Mac awake while an agent is working. |

## In the local build

- Dashboard follow-up checks the current terminal screen and paste mode. Terminal redraw and status detection updates are also local. The full popup → browser → Preview follow-up sequence still needs testing on the MacBook where it failed.

- Queue one follow-up per live Codex session on macOS or Linux. Delivery requires an idle session and a verified empty terminal prompt. Cancel to edit the draft, including screenshots. The queue runs while RunHuddle is open. Restarting keeps the draft and requires a fresh send or queue action. A failed send leaves the draft available for manual review.

- Step through the five most recent turns in live Preview. Current attention and follow-ups stay live.
- Markdown file previews render GitHub-style tables, task lists, headings, quotes, and code blocks. Web links use the browser confirmation.
