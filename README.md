# RunHuddle

RunHuddle is an open-source Electron workspace for Codex CLI, Claude Code, GitHub Copilot CLI, and shell terminals. Keep a project’s conversations, terminal layout, notes, Git changes, and local app preview together.

[Download for macOS](https://runhuddle.rootsignal.io/download) · [User guide](https://runhuddle.rootsignal.io/docs/) · [Release notes](https://github.com/rootsignal/runhuddle/releases)

The public installer supports **Apple Silicon on macOS 14 or later**. Install and sign in to your agent CLIs separately. The repository also contains Windows and Linux build targets.

## Work in RunHuddle

- **Projects and tabs.** Focus a project to see its sessions and tabs. Each project remembers its splits. Switch back to All projects to see the wider layout. The terminal helper keeps sessions running when you close a tab or quit the UI.
- **History and cleanup.** Browse and search local provider conversations, pin useful sessions, and hide retired projects or conversations. Restore hidden items from the Projects options menu.
- **Recaps and handoffs.** Read or generate a session recap, or review context before handing a task to another installed agent in the same folder.
- **Project tools.** Review Git diffs, stage and commit changes, write notes, and open the folder in an editor. The Browser panel can preview an app or add a page report to an agent draft.
- **Onboarding and updates.** Replay the tour from Help. Use **RunHuddle → Check for Updates…** for future builds.

## Develop

Use Node.js 24+ and npm.

```sh
cd electron
npm ci
npm start
```

Run `npm test` and `npm run test:ui` from `electron/`. See the [Electron development guide](electron/README.md) for local profiles and the [release guide](docs/RELEASING.md) for packaging, signing, and the update feed.

## License

[GPL-3.0-only](LICENSE). See [third-party notices](docs/LICENSING.md) for bundled components.
