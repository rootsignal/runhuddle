# RunHuddle UX polish checklist

This is the implementation backlog from the macOS UX review. The order reflects how often people use each surface and how much a confusing state can interrupt their work. Update each checkbox when its acceptance checks pass. Keep shipped functionality in the [feature checklist](FEATURES.md).

## 1. Dashboard and Preview

- [x] **Toolbar and activity** — Keep the orbit artwork and compact toolbar. Give active Review and Needs input counts distinct labels, with one clear destination for each. Keep quiet states compact.
- [x] **Live session rail** — Use a useful task excerpt to distinguish automatically titled sessions when available. Keep status, elapsed time, and draft indicators aligned. Bound the rail width at large window sizes and preserve collapse and restoration.
- [x] **Session header and Preview** — Make the latest agent update the focal point. Keep the instruction, recent turns, and references accessible. Show an attention callout only when the user has a concrete action. Keep session age and compactions secondary.
- [x] **Composer** — Give saved drafts, screenshot attachments, queued follow-ups, and send feedback a consistent location. Make the destination and Send versus Queue behavior clear.
- [ ] **Shared visual primitives** — Define primary, secondary, icon, and destructive controls. Standardize icon size and stroke, provider badges, focus rings, keycaps, spacing, and status colors. Keep the user accent for selection and interaction. Use motion to signal real activity.

**First pass verified** in the local dark dashboard and the Electron review, queue, resize, and screenshot workflows. Provider badges are in place. The broader shared-control pass and full visual matrix remain open.

**Accept when** a user can identify the working and blocked sessions, read the latest update, and draft or queue a reply without losing context when switching views or resizing. Check with one session, multiple sessions, and the rail collapsed.

## 2. Changes, Git, and GitHub

- [x] **Changes modes** — Give Uncommitted, branch comparison, and commit review distinct labels. Display the comparison base and add a direct **Uncommitted N** action when edits exist outside the comparison.
- [x] **File list and diff review** — Align toolbars across live and captured diffs. Preserve file and hunk navigation, Unified and Split, scroll position, keyboard movement, and independent pane scrolling. Explain empty states and offer the relevant next action.
- [x] **Captured turn changes** — Distinguish committed and uncommitted changes and keep return navigation consistent with the live diff.
- [x] **Branches and remotes** — Group current branch, upstream, and sync status. Put shared-checkout warnings beside the affected action. Emphasize the relevant Switch, Pull, Push, or Publish action.
- [x] **Prepare PR** — Make the base and head, editable title and body, and **Open in GitHub** easy to scan. Keep the draft through recoverable failures.
- [x] **PR details and GitHub connection** — Present check results, failure details, and review requests as scannable rows. Make disconnected, verified, and failed connection states explicit. Keep token setup available under an expandable section.

**Accept when** a feature-branch workflow makes local edits, committed differences, upstream state, PR status, and check failures distinguishable without guessing. Include a clean comparison with uncommitted edits, an unpublished branch, and a PR with failed checks.

## 3. Projects, history, and search

- [x] **Project picker and focus** — Make browse and expand the default. Put multi-project selection in an explicit **Filter live sessions** mode. Keep **All projects** easy to reach from a focused view.
- [x] **Project landing** — Lead with the most useful live session or saved next step. Keep **Browse history** beside the primary action and show **Start a session** when there is nothing to resume.
- [x] **Project cards** — Show the saved next step on the card. Give projects with saved conversations and no next step a visible **Browse history** action.
- [x] **Recent and conversation search** — Keep date grouping, distinguish duplicate titles with short excerpts, and highlight transcript matches. Preserve query, scope, and scroll when returning.
- [x] **Session details** — Promote **Resume** or **Open live session** as appropriate. Keep project navigation and session management secondary. Preserve the original dashboard context on close.
- [x] **Saved reviews and recap** — Show why an item is ready for review and keep the recap and next step easy to find. Use the same session row pattern across views.
- [x] **Cleanup, old-session review, and hidden history** — Use consistent **Keep**, **Hide**, and **Restore** labels. Show selection counts and offer Undo near the result. Keep AI-assisted review anchored to the conversation it refers to.

**Accept when** users can find and preview a session in a project with a long history, return to exactly where they started, and hide or restore an old session without ambiguity.

## 4. Tools and dialogs

- [x] **Agent terminal, conversation history, dashboard shell, and Quick Terminal** — Make the live terminal, readable transcript, persistent shell, and overlay easy to distinguish. Separate Dismiss from End shell. Preserve command focus and scrollback.
- [x] **Browser** — Use consistent navigation icons and distinguish **Attach page to draft** from **Allow agent control**. Show the site and session when agent control is active.
- [x] **Files, links, and Markdown** — Use consistent reference rows with recognizable type icons, readable names, and a clear open action. Give Markdown a readable document layout.
- [x] **Screenshot popups and attachments** — Make the target session and queued, attached, or failed state obvious. Keep multiple screenshots manageable while an agent is working.
- [x] **Launcher and Rename** — Prefill a known project folder, surface the last-used agent, and distinguish the plain Terminal choice. Keep the optional session name clear and reuse Rename’s focused dialog layout.
- [x] **Handoff** — Show source and destination, make current work and next steps easy to review, and clarify the difference between creating the new session and sending its briefing.
- [x] **Notes and note editor** — Keep the source conversation visible and group infrequent actions. Standardize editor footer actions and focus behavior.
- [x] **Command Palette and keyboard shortcuts** — Group commands, sessions, and projects. Use consistent keycaps and confirm that remapped shortcuts appear where users discover them.
- [x] **Appearance and native menus** — Group terminal theme, typography, and cursor options around the live preview. Show custom accent samples for selection, focus, and primary actions. Align native menu names with dashboard controls.
- [x] **Getting Started** — Demonstrate the launch, review, and follow-up loop using real dashboard controls. Verify the tour both on a fresh profile and from Help.
- [x] **Permissions, unavailable sessions, and recovery** — Give each state a plain-language explanation and a clear next action. Cover browser control, terminal status unknown, disconnected service, and service updates.

## Verification for each phase

- [x] Check dark and light themes with the default accent and a custom accent.
- [x] Check a narrow window, a typical desktop window, and fullscreen. Include split panes and long names.
- [x] Walk the main flow with keyboard only. Check focus visibility, accessible names, Escape behavior, and focus restoration.
- [x] Verify that working, review, attention, success, and failure states have readable labels. Check motion with Reduce Motion enabled.
- [ ] Verify loading, empty, error, and recovery states with fixtures where needed. Use a real session for the final workflow check when practical.
- [ ] Capture before and after views. Record which checks passed and which environments or states remain unverified.

The macOS Electron suite exercises light and dark themes with default and custom accents, narrow and desktop window sizes, native fullscreen, split panes, and keyboard navigation. The dashboard test saves the theme and fullscreen screenshots under `electron/test-results`. Recovery scenarios use local fixtures.

- A live Codex session on macOS answered an initial prompt in Preview and answered an Enter-submitted follow-up using the earlier turn.
- The Linux ARM64 AppImage built and passed two Electron tests from its extracted executable under Xvfb. The tests covered a persistent dashboard shell, Quick Terminal, and saved-conversation discovery.
- The unsigned Windows x64 NSIS installer built successfully. Its size and SHA-512 matched the update metadata, and the installer payload extracted cleanly with Windows x64 ConPTY binaries. The Wine install attempt did not complete. A native Windows install and launch check remains open.
