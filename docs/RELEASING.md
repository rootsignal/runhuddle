# Release RunHuddle for macOS

1. Bump the version in `electron/package.json` and refresh its lockfile.
2. Merge the release source to `main`.
3. Dispatch **Publish macOS** on `main`. It runs the Electron tests, signs and notarizes an Apple Silicon DMG and update ZIP, publishes both to GitHub, then invokes the website deployment.
4. Open the website’s Download link and run **RunHuddle → Check for Updates…** from a previously installed Electron release.

In the repository’s `release` environment, configure secrets `DEVELOPER_ID_P12_BASE64`, `DEVELOPER_ID_P12_PASSWORD`, `APPLE_ID`, and `APPLE_APP_SPECIFIC_PASSWORD`, plus variable `APPLE_TEAM_ID`. For website deployment, set secret `RUNHUDDLE_SITE_WORKFLOW_TOKEN` to a credential with Actions write access to `RootSignalLabs/rootsignal-site`. You can also dispatch the site’s **Deploy Site** workflow with the release version.

## Publish from a signing Mac

From `electron/` on the release commit, use a Developer ID Application identity and a stored `notarytool` profile. Run `npm ci`, `npm test` and `npm run test:ui`, then run the following with the signing profile exported as `RUNHUDDLE_NOTARY_PROFILE`:

```sh
npm run dist -- --mac --arm64 --publish never
version=$(node -p 'require("./package.json").version')
dmg="dist/package/RunHuddle-$version-arm64.dmg"
xcrun notarytool submit "$dmg" --keychain-profile "$RUNHUDDLE_NOTARY_PROFILE" --wait
xcrun stapler staple "$dmg"
bash scripts/publish-macos.sh
```

Keep the original build outputs if publication needs a retry. The script checks notarization tickets, publishes the versioned release and then updates the `electron-stable` channel. The site verifies the checksum and agreement between the two releases before publishing the download link. Use the same Developer ID signing identity across successive builds.

The first Electron release supports Apple Silicon with macOS 14 or later. Windows and Linux can be included in a manual Electron CI run. Their package targets are NSIS and AppImage.
