# RunHuddle development

RunHuddle runs on Electron with a React and TypeScript interface. The app bundles its terminal renderer and PTY helper. Users install and sign in to the agent CLIs separately. See the [user guide](https://runhuddle.rootsignal.io/docs/) for workflow and settings help.

```sh
npm ci
npm start
npm test
npm run test:ui
```

`npm run package` creates an unpacked application. `npm run dist` creates installers and update artifacts. See [releasing](../docs/RELEASING.md).

## Terminal and app data

A detached helper owns the PTYs. The UI connects over a user-scoped Unix socket or Windows named pipe. Closing the window keeps current processes alive. Ending a session stops its terminal and leaves its conversation available to resume.

Provider history is discovered from local CLI records. Project layouts, pins, and hidden history are preferences in the Electron profile. Hiding an item leaves its provider history and project files in place.

`RUNHUDDLE_DATA` overrides the Electron app data directory. UI tests use isolated profiles and can point `RUNHUDDLE_TEST_EXECUTABLE` at a packaged binary.

## Live browser testing

Open a local development server in Browser, select an AI session, and choose **Allow agent control**. The selected agent can inspect, screenshot, click, type, and reload the live page. Stop control, switch sessions, or close Browser to revoke it. **Share page** adds a screenshot and diagnostics to a draft. Use **Reopen with browser control** to reopen a supported older Electron session with the browser tools.

Replay **Getting started** from Help.

## Appearance

Use **View → App Theme** to follow the system or choose Light or Dark. **View → Accent Color** offers presets and a custom picker. **Terminal appearance** controls the terminal palette separately.
