# RunHuddle

RunHuddle is an open-source desktop app for working with Codex CLI, Claude Code, GitHub Copilot CLI, and shell terminals. The Project Dashboard brings live sessions, conversation history, and Git review together across projects.

[Download for macOS](https://runhuddle.rootsignal.io/download) · [User guide](https://runhuddle.rootsignal.io/docs/) · [Release notes](https://github.com/rootsignal/runhuddle/releases)

The public installer supports **Apple Silicon on macOS 14 or later**. Install and sign in to your agent CLIs separately. The repository also contains Windows and Linux build targets.

## Work in RunHuddle

- **Live sessions.** See which agents are working, waiting for input, or ready to review. Read recent turns in Markdown, open referenced files and links, and draft follow-ups with screenshots. On supported Codex sessions, queue one follow-up for when the terminal is ready.
- **Git and pull requests.** Review unified or split diffs, stage and commit changes, switch branches, and sync with your remote. Draft a pull request with context from the session. Connect GitHub MCP to see open PRs, reviews, and check failures.
- **Projects and history.** Browse recent conversations, search their contents, and hide sessions you no longer need in the list.
- **Tools while you work.** Open Quick Terminal or RunHuddle Browser from the dashboard. Remap shortcuts in the Command Palette and opt in to keeping your Mac awake while agents work.
- **Updates.** Replay the tour from Help. Use **RunHuddle → Check for Updates…** for future builds.

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
