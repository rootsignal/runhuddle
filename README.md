# RunHuddle

RunHuddle is an Electron workspace for running Codex CLI, Claude Code, GitHub Copilot CLI, and shells. It brings persistent terminal tabs and splits, conversation search, project notes, Git changes, agent notifications, and a local browser into one app.

## Develop

Use Node.js 24+ and npm. Install and sign in to the agent CLIs you want to use.

```sh
cd electron
npm ci
npm start
```

Run `npm test` and `npm run test:ui` from `electron/`. For packaging and update configuration, see [releasing](docs/RELEASING.md). The [Electron development guide](electron/README.md) describes the terminal service and isolated test profiles.

## License

RunHuddle is licensed under [GPL-3.0-only](LICENSE). See [third-party notices](docs/LICENSING.md) for bundled fonts, palettes, and runtime components.
