# Using RunHuddle

[Documentation](README.md) · [RunHuddle](../README.md)

## Your sessions

- Opens on a focused Now view: needs input, working, recently finished, and idle sessions. Older sessions remain in All sessions.
- Pin important sessions and filter by the exact project folder. The main search includes saved and archived sessions by default.
- Tracks Working, Needs input, Idle, and Saved sessions, with a menu-bar overview and desktop notifications.
- Finds sessions by project, custom name, branch, path, purpose, and recorded conversation history.
- Shows latest recorded activity alongside editable purpose and next-step notes.
- Focuses an existing terminal where it can identify one, with a chooser when it cannot.
- Saves session metadata and handoffs across restarts; can resume a saved conversation or start fresh from a handoff.
- Displays informational context-usage estimates for supported Codex sessions.
- Supports bulk archive, restore, and removal. Codex uses native cleanup; Claude and Copilot archives preserve history, with a separate Move history to Trash action.

## Menu-bar switcher

Click the owl in the menu bar, or press **Control–Option–Space**, to open the session switcher above your current app. Search active sessions, use **↑ / ↓** and **Return** to switch to a terminal, or press **Escape** to dismiss it. Change or disable the global shortcut in **RunHuddle → Settings… → Session switcher** (also available from the popover’s gear menu). The full window remains available for saved sessions, history, and handoffs. Ambiguous terminal matches still ask you to choose.

## Needs input

Waiting sessions are ordered by when RunHuddle observed the request. Their details distinguish permission requests, questions, plan reviews, and general input when the provider exposes that information. Claude/Copilot hooks can supply bounded request excerpts; question excerpts include recorded options. Codex’s current status connection distinguishes approval from user input but does not supply the full prompt text here. Missing details are labeled rather than inferred from the last message.

“Observed waiting” starts when the request is recorded or first seen by RunHuddle; it is not an exact historical wait duration for sessions discovered later. Requests clear when their waiting state resolves. Answer in the agent’s terminal—RunHuddle does not approve, select options, or send replies.

## Notifications

Open **RunHuddle → Settings → Notifications**, or use **Notification settings…** in the sidebar.

- Enable input and completion alerts independently, and choose whether they play a sound.
- Set quiet hours in your Mac’s local time, or snooze alerts for one hour. The menu-bar gear menu also offers snooze/resume.
- Optionally request one reminder after 5, 10, or 15 minutes of waiting. Reminders are checked during activity refreshes, so delivery may be slightly later. The reminder record lasts for the current app run.
- Mute a whole project from a session’s **… → Mute project alerts** menu. Unmute it there or in notification settings. Project matching uses the full folder path.

Updates arriving within a three-second window are combined. A grouped alert opens Now; individual alerts retain their terminal action. Requests already resolved when the batch is delivered are dropped. Quiet hours, snooze, and muted projects suppress alerts without hiding session status. Ordinary suppressed alerts are not replayed afterward; an enabled reminder can still notify you about an unresolved request once quiet time ends. Test alerts bypass these app-level controls, but still require macOS notification permission.

## Terminal targeting

RunHuddle matches a verified session TTY or an unambiguous title to an existing terminal. Terminal.app, Ghostty, and iTerm2 use their scripting interfaces; iTerm2 split panes are identified individually. Multiple valid matches still require a choice. Saved or disconnected sessions do not automatically jump to a terminal based solely on an old title.

A manually chosen tab/pane is remembered during the current app run while the session remains active. The choice is reused only while the terminal application process, tab/pane identity, title, and available directory/TTY information remain unchanged. Reopening the app or changing the terminal can require another choice.

For **tmux**, RunHuddle discovers panes on the default local server that are attached through Terminal.app or iTerm2. It validates the pane, server, and attached client, brings the outer terminal forward, and selects the existing pane. It never creates a tmux session or sends keystrokes. Detached sessions, custom tmux sockets, SSH, and Ghostty-to-tmux routing are not supported by this automatic route. Unusual installations can still require the manual chooser.

## Finding sessions

Press **⌘F** to focus search. The search field finds session titles, projects, and recorded messages. Search defaults to **Current view**, respecting the selected sidebar view, tool, and project. Choose **Search all sessions** beside the results to include all session states, including archived sessions, while retaining tool and project filters. Archived matches retain their status label. Use **×**, **Escape**, or **Done** to clear the query and return to the selected view. Each new search starts in Current view. Choosing a sidebar view also clears the search; tool and project filters remain selected. Session cards use a subtle outline for selection and text-and-icon status badges in both light and dark appearances.

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

## Repository context

The Overview shows the current Git branch (or detached HEAD), main/linked worktree, worktree path, and changed-file count. Counts include staged, unstaged, and untracked files; a rename counts once. Ignored files are excluded. Submodule changes appear as a changed submodule entry, not a recursive file count.

This is shared repository state, not changes attributed to the selected agent. It is read locally when the section opens; use its refresh button for a new snapshot. There is no background repository polling or GitHub request. Missing or inaccessible repositories show an unavailable message. PR and CI status are not included yet.

## Window layout

Columns resize automatically with the window. On narrow windows, opening session details replaces the list; use the close button in the details header to return. Hide or show the navigation sidebar with its toolbar button. Column dividers are automatically sized rather than draggable.

The compact repository summary stays above the Overview/Handoff content so branch and changed-file count remain visible while reading activity. Expand the worktree row for the full path, snapshot time, and shared-state explanation. Latest responses show three preview lines; expand “Read full message” to see the recorded text.

## Saved work library

**Saved work** in the sidebar stores independent work summaries and handoff snapshots. These records survive deleting the original session and remain available when its agent is offline. They are local records in RunHuddle’s database, not a backup of the complete conversation.

- Choose **Save work summary…** from a session’s actions or right-click menu. Write your own record, or select a signed-in AI CLI and choose **Generate summary**. Review and edit the result, then choose **Save to library**. Generating uses the chosen account’s allowance and may take a minute or two. It does not perform project work or interrupt the original session.
- In Handoff, **Save to library** preserves the current generated/edited handoff as an independent snapshot. Later handoff updates do not replace that record. Saving again creates another snapshot.
- In Saved work, search titles, projects, source agents, dates, and content. Library search is separate from the main session search. Edits save automatically. Source metadata records the agent/session ID, project path, snapshot time, and AI generator when applicable.
- Copy or export a record as Markdown to use in a future session. No content is automatically injected into an agent.
- Deleting session history offers **Save summary first…** and reports existing independent records. This cancels that deletion review so you can save a record; return to deletion afterward. Existing library records are never removed by session cleanup. **Delete record…** in the library removes only that selected saved record after confirmation.

AI summaries use available recorded source material, which may be partial. Review claimed results, verification, and rationale. No automatic summaries, cloud sync, or cross-session synthesis is enabled. Removing RunHuddle’s Application Support data also removes its library; export important records or include that directory in your backups.

## Getting help

The in-app **Getting started** guide introduces agent connections, session states, notifications, terminal switching, keyboard shortcuts, and saving useful work. It opens at startup by default; uncheck **Show this guide at startup** to stop automatic opening. Skipping or closing the guide does not change that preference.

Reopen it any time through **Help → Getting started…** or **Settings → General → Open getting started guide…**. General settings also contains the startup checkbox. The guide only requests notification permission when you click **Enable notifications**; use Next or Skip guide to continue without enabling alerts.

The **Help** menu links to this user guide, troubleshooting, and GitHub issues. Those detailed guides open in your browser and require an internet connection; the introductory guide is built into the app.

Use **Filters** beside search to choose a tool or project. Active filters appear as removable chips above the session list. Click a chip’s × to remove it, or **Clear filters** to reset both. With no chips selected, all tools and projects are included. Open **Settings…** at the bottom of the sidebar for connection status and tracking setup notices. An attention badge appears when a connection needs attention. Settings groups appearance, shortcuts, help, and updates under **General**, agent tracking under **Connections**, launch preferences under **Terminal**, and alert permissions and behavior under **Notifications**.

## Session navigation

**Now** groups confirmed live sessions by Needs input, Working, and Idle. **Pinned** contains your pinned, unarchived sessions. **All sessions** includes both live and previous sessions, excluding archived records. **Archived** is a separate view.

**Previous session** means recorded history is available without confirmed live activity. This also includes sessions whose previous live connection can no longer be confirmed. Details explain when the terminal may have closed, the agent may have stopped, or tracking may be unavailable. These appear in All sessions, not Now; uncertain activity is not a separate category.

The separate **Library → Saved work** count represents saved summary/handoff records. Its own search and tool/project filters are independent of session filters.

Project filters group system temporary directories (including macOS `/var/folders` and `/tmp`) and missing working directories under **Temporary / other**. This is a display grouping, not deletion: the sessions and their original paths remain available, including archived history. A regular project is not grouped merely because its name begins with `tmp`.

## Bulk handoffs and work summaries

Select sessions through **Bulk actions**, then choose **Generate handoffs…** or **Save work summaries…**. Review the selected sessions and choose an AI CLI before starting. Generation uses that account’s allowance and processes sessions one at a time; **Stop after current** leaves remaining sessions unprocessed. Failures are shown per session without discarding successful results.

Handoffs are saved to their source sessions; manually edited handoffs keep their edits and receive a replacement candidate for review. Work summaries remain editable drafts in the bulk dialog until you explicitly save them individually or choose **Save all reviewed summaries**. Closing with unsaved summary drafts asks before discarding them. Saved summaries are independent records in **Library → Saved work**.

Right-click a session for **Generate handoff…** (or **Update handoff…**), **Save work summary…**, and **Archive…**. Handoff generation opens the provider/usage review before starting. Archive uses the existing cleanup review and is enabled only for sessions confirmed closed; archived sessions offer **Restore…** instead.

Saved work opens as a workspace view, with records on the left and editable details on the right. At narrow widths, details replace the list until closed. The toolbar search searches saved records while this view is selected; its library filters remain independent of session filters.

Choose **Start new session from this…** in a saved record’s details to pick Codex, Claude, or Copilot and an existing project folder. Review/edit the initial prompt, then choose **Start in Terminal**. This opens a new session in Apple Terminal using your signed-in CLI account and sends the saved context as its initial prompt. It does not resume the old session or change the saved record, and it works without the original session. If the original folder is gone, choose another before starting.

## Compaction and handoff indicators

Session rows show an observed compaction count when recorded events are available and the count is above zero. Codex transcript markers, Claude compaction boundaries/hooks, and successful Copilot `session.compaction_complete` events are counted. Failed Copilot attempts and token-percentage drops are not counted. Counts reflect available history or hooks observed since tracking began, not a guaranteed lifetime total. Expanded session details include the source; unavailable evidence is not shown as zero. Transcript counts are cached and updated from appended records.

A document icon means a handoff exists. Its tooltip distinguishes ready, outdated after new activity/notes, and a generated replacement awaiting review. No icon means no generated handoff.

## Terminal launch and tab names

Resuming a saved conversation opens a new Terminal tab or window directly in its saved project folder, using its exact agent session ID. Unrelated open terminals do not trigger a chooser. Sessions currently known to be running still return to their matching terminal; ambiguous live matches retain the terminal-location dialog.

**Settings → Terminal** selects Terminal, iTerm2, or Ghostty as the preferred app for saved-session resumes, fresh handoffs, and saved-work launches. Apps not installed are labeled and unavailable for selection. Running sessions still return to their existing terminal. Choose a new tab or window; when no window exists, a new one opens. A missing preferred app produces an error rather than silently switching apps.

Terminal.app tabs require macOS Accessibility access. Terminal settings show the current permission status, explain the steps, and link directly to macOS Accessibility settings. When a launch falls back to a window, a prominent message includes a **Terminal settings…** button. iTerm2 and Ghostty use their native scripting support for tab/window creation and may request Automation permission. Ghostty requires version 1.3 or later with AppleScript enabled. Commands are supplied only to newly created tabs/windows; launch errors never retry into an existing pane.

Renaming a live session also attempts to update a uniquely matched Apple Terminal tab’s custom title. Unsupported terminals, tmux panes, ambiguous matches, and closed tabs keep their existing titles. The RunHuddle name remains saved even if the tab update fails. An agent may subsequently overwrite its tab title. Renaming does not change the underlying agent session name.

Expand **Icon guide** below Library in the sidebar for session-state, context, compaction, and handoff explanations. It starts collapsed and remembers your choice. Row indicators stay compact, with full descriptions on hover and for accessibility.

A filled **books** icon on a session means at least one Saved work record references that session. Hover for the record count. This includes saved summaries and handoff snapshots; it does not mean the record includes the session’s latest activity. Deleting the last corresponding library record removes the indicator.

### Session storage

Archived shows the allocated disk space for the primary transcript files in the current results. Filters and search affect the total; shared files are counted once. Sessions without an accessible transcript are reported as unavailable rather than counted as zero.

Expand **Session details** for an individual session’s transcript file size, allocated disk space, and check age. Measurements update with agent snapshots. These figures exclude project files, attachments, agent indexes, and RunHuddle saved-work records. APFS can share disk blocks, so this is not a promise of space recoverable by deleting a session.
