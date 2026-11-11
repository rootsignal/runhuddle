# Using RunHuddle

[Documentation](README.md) · [RunHuddle](../README.md)

## Your sessions

- Opens on a focused Now view: needs input, working, recently finished, and idle sessions. Older sessions remain in All sessions.
- Pin important sessions and filter by the exact project folder. Search from Now also searches saved sessions.
- Tracks Working, Needs input, Idle, and Saved sessions, with a menu-bar overview and desktop notifications.
- Finds sessions by project, custom name, branch, path, purpose, and recorded conversation history.
- Shows latest recorded activity alongside editable purpose and next-step notes.
- Focuses an existing terminal where it can identify one, with a chooser when it cannot.
- Saves session metadata and handoffs across restarts; can resume a saved conversation or start fresh from a handoff.
- Displays informational context-usage estimates for supported Codex sessions.
- Supports bulk archive, restore, and removal. Codex uses native cleanup; Claude and Copilot archives preserve history, with a separate Move history to Trash action.

## Menu-bar switcher

Click the owl in the menu bar, or press **Control–Option–Space**, to open the session switcher above your current app. Search active sessions, use **↑ / ↓** and **Return** to switch to a terminal, or press **Escape** to dismiss it. Change or disable the global shortcut in **RunHuddle → Settings… → Session switcher** (also available from the popover’s gear menu). The full window remains available for saved sessions, history, and handoffs. Ambiguous terminal matches still ask you to choose.

## Finding sessions

Press **⌘F** to focus search. The search field finds session titles, projects, and recorded messages. Use **×** or **Escape** to clear it, or **Back to Now** to return to active work. Choosing a sidebar view also clears the search; tool and project filters remain selected. Session cards use a subtle outline for selection and text-and-icon status badges in both light and dark appearances.

## Live activity updates

RunHuddle listens for Codex app-server status changes over a passive connection. Claude and Copilot hooks wake the app through local file notifications after saving meaningful activity changes. Events refresh only the affected provider and are combined during bursts. A quiet check every 30 seconds reconciles missed events and process exits; manual Refresh is always available. Monitoring never starts or resumes an agent session.

RunHuddle watches recognized terminal agent processes and verified Claude/Copilot session processes for exits. Closing a terminal triggers a provider status check and short follow-up checks while the agent detects the disconnect. Status is confirmed by the agent; background/shared sessions are not marked closed solely because a terminal process exited. Agent events and the 30-second fallback remain available when a process cannot be identified.

## AI handoffs

Open a session’s **Handoff** tab, choose an installed AI CLI, then click **Generate handoff**. Generation sends a bounded sample of recorded history and your notes to that provider using its existing CLI sign-in and plan allowance. It runs separately from your active session. There is no automatic AI generation on refresh.

**Update handoff** creates a new brief from current recorded history. If you edited the previous handoff, review the proposed draft before replacing it; **Restore previous text** recovers the previous version. A notice identifies new activity or notes since generation. Generated summaries can still be incomplete or mistaken—review them before starting a fresh session. Recorded activity excerpts remain separate and are not an AI summary.

Codex uses ephemeral non-interactive generation in a read-only sandbox; Claude uses print mode with tools disabled and session persistence off; Copilot uses piped input with an empty tool allowlist and removes its uniquely identified temporary helper history afterward. Login, account-policy, timeout, and provider errors leave the existing handoff intact.

## Manage old sessions

Click **Bulk actions**, check rows or choose **Select all results**, then use **Actions**. Selection can span filters. Each action shows eligible sessions and reasons for skipped selections.

Archive only closed (Saved) sessions. Codex uses its native archive; Claude and Copilot are hidden in RunHuddle while their original histories remain available. Find them in Archived and restore them anytime. A session detected running again returns automatically to the main list.

Removal requires archiving first. Codex deletion is permanent. Claude and Copilot **Move history to Trash** removes the reviewed session history files, not project files. Export handoffs you want to keep first. Running sessions and sessions whose live status cannot be verified are skipped. Histories are rechecked before removal; partial failures are reported.

## Privacy and limitations

- Provider history stays on your machine. The local search index contains recorded user/assistant message text. Do not commit or share your Application Support data.
- Starting a fresh session explicitly sends the handoff to your chosen agent CLI; that provider's own data handling applies.
- Events and periodic reconciliation can miss short transitions. A completion alert means ready for review, not proof that work succeeded.
- Some archived histories may not be available as local files. Search shows incomplete coverage when detected.
- Context usage is a last-reported estimate and can decrease after compaction. It is not a restart countdown.
- Saved sessions preserve conversation identity, not running shell processes.
- The development bundle retains its original bundle identifier and storage paths to preserve existing local installations. Mac App Store distribution has not been implemented. Bundled third-party license notices are included in the app’s Resources directory.

See [development and integration notes](DEVELOPMENT.md) for implementation details and validation history.
