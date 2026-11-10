# Release automation

**Checks** runs Swift and Python tests, builds the standalone app, and verifies relocation, dependencies, hooks, and its signature on pushes to main and pull requests. It has no signing secrets.

**Release** is manually triggered from main through GitHub Actions. It runs tests, imports a temporary signing identity, builds, verifies, submits the app and DMG to Apple, staples both tickets, and creates a **draft** GitHub release with the DMG and SHA-256 checksum. Review the draft before publishing. It never releases an unaccepted submission.

The workflow uses GitHub's Apple Silicon macos-15 runner ([runner documentation](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)). Intel releases are not validated.

## One-time GitHub setup

Create a GitHub environment named **release**. Restrict it to main and optionally require a maintainer review. Add these environment secrets:

| Secret | Value |
| --- | --- |
| DEVELOPER_ID_P12_BASE64 | Base64-encoded export of the RootSignal Developer ID Application certificate **and private key**, in password-protected PKCS#12 format. |
| DEVELOPER_ID_P12_PASSWORD | Password protecting that export. |
| APPLE_ID | Apple Developer account login. |
| APPLE_APP_SPECIFIC_PASSWORD | App-specific password for notarization from the Apple account portal. |

The workflow uses team C65AQBMSBJ and identity Developer ID Application: RootSignal LLC (C65AQBMSBJ). Change these when changing organizations. The local Keychain profile is not available on GitHub runners; CI needs its own secrets. Never commit private keys, passwords, or credential exports. The temporary keychain is removed even if a job fails.

## Each release

1. Update CFBundleShortVersionString and CFBundleVersion in scripts/package_app.py.
2. Push the reviewed code to main and let Checks pass.
3. Run **Actions → Release → Run workflow** on main.
4. Wait for Apple notarization. Initial submissions can take a while.
5. Review the generated draft, add release notes, test DMG installation and replacement of a prior app, then publish.

Use a new version for each release. The workflow fails if the release tag exists instead of replacing published artifacts. Failed notarization requires investigation before retrying; do not distribute unapproved output.

## Local release fallback

With the Developer ID identity installed and credentials stored in the RunHuddle Keychain profile:

```sh
export RUNHUDDLE_SIGN_IDENTITY='Developer ID Application: RootSignal LLC (C65AQBMSBJ)'
bash scripts/build-app.sh
python3 scripts/verify_standalone.py
bash scripts/notarize.sh
```

Only upload the resulting notarized DMG and checksum from dist/. The app zip is a submission artifact, not the installer.
