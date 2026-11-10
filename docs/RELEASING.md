# Release automation

**Checks** runs Swift and Python tests, builds the standalone app, and verifies relocation, dependencies, hooks, and its signature on pushes to main and pull requests. It has no signing secrets.

**Release** is manually triggered from main through GitHub Actions. It runs tests, imports a temporary signing identity, builds, verifies, submits the app and DMG to Apple, staples both tickets, and creates a **draft** GitHub release with the DMG and SHA-256 checksum. Review the draft before publishing. It never releases an unaccepted submission.

The workflow uses GitHub's Apple Silicon macos-15 runner ([runner documentation](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)). Intel releases are not validated.

## Optional GitHub signing setup

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

## Recommended: release from this Mac

With the Developer ID identity installed and credentials stored in the RunHuddle Keychain profile:

```sh
export RUNHUDDLE_SIGN_IDENTITY='Developer ID Application: RootSignal LLC (C65AQBMSBJ)'
bash scripts/build-app.sh
python3 scripts/verify_standalone.py
bash scripts/notarize.sh
```

Only upload the resulting notarized DMG and checksum from dist/. The app zip is a submission artifact, not the installer.

For the complete local flow, including tests and uploading a draft release:

```sh
bash scripts/release-local.sh
```

Use a clean, committed checkout already pushed to GitHub. The selected Python must have scripts/requirements.txt installed. This uses the existing Mac Keychain profile and leaves signing credentials on this Mac. Review and publish the draft in GitHub Releases. GitHub Checks still runs automatically; the optional Release workflow is unused unless its secrets are configured.

## Signed in-app updates (0.5.0+)

Sparkle 2.10.1 is pinned in Package.resolved. Its public key is in config/sparkle-public-key.txt; the private signing key stays in the local login Keychain under account RunHuddle. Do not rotate or discard it casually: existing installations trust this key.

The local release script signs the notarized DMG and generates a signed appcast as a draft-release asset. To publish a reviewed draft and update the feed:

```sh
bash scripts/publish-release.sh 0.5.0
```

This verifies the feed signature, publishes the release, then commits the exact signed feed to updates/appcast.xml and pushes it. The app reads that feed over HTTPS from GitHub. Do not edit a signed appcast manually; regenerate and re-sign it. Advertising a draft release is deliberately avoided because its assets are not public yet.

For optional GitHub release builds, add SPARKLE_PRIVATE_KEY as an environment secret containing a Sparkle private-key export. This is not configured on GitHub; local signing remains the recommended workflow. The GitHub workflow creates a draft with its signed appcast; publishing the feed still uses the local script above.

Initial 0.4.x users must install the 0.5.0 DMG once. Thereafter Sparkle can replace the existing app in place and relaunch it. Automatic checks are opt-in in Connections; automatic installation is disabled.

The local release flow also runs scripts/test_updater.py against a separate signed fixture bundle. It checks rejection of a modified feed and an actual download/install/relaunch, without reading RunHuddle session data or installing agent hooks. It needs the existing Developer ID identity and Sparkle Keychain key. Put user-facing release notes in docs/releases/VERSION.md; they are embedded in the signed update feed.
