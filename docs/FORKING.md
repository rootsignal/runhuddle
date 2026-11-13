# Building a separate fork

Contributions to official RunHuddle can use the ordinary [build instructions](BUILDING.md).
A separately distributed fork needs its own identity and release configuration.
This repository does not currently offer a one-variable fork mode.

Before distributing a fork:

1. Choose your own app name and reverse-DNS bundle identifier. Update packaging,
   installer identity checks, app paths, and user-facing branding consistently.
   The official identifier is intentionally stable for existing installations.
2. Audit application-support directories, preferences, launch agents, tmux server
   names, and agent hook configuration. A bundle identifier change alone does not
   isolate all state. Test in a separate macOS account before running beside the
   official app; do not overwrite its installation or hooks.
3. Remove `SUFeedURL` from your packaged Info.plist until you operate your own
   updater. RunHuddle disables its updater when that key is absent. Do not ship
   a fork pointing at the official feed: it could install an official build over
   your fork. For your own updater, generate a separate Sparkle key pair, embed
   its public key, and keep its private key outside Git.
4. Retarget `generate-update-feed.sh`, `publish-release.sh`, `release-local.sh`,
   and the Release workflow to your own release repository and hosting. The
   official scripts contain RootSignal repository URLs and website dispatches;
   they are not generic fork deployment tools. Do not invoke publication scripts
   unchanged for a fork.
5. For public notarized builds, use your own Developer ID certificate and
   notarization credentials. Set `RUNHUDDLE_SIGN_IDENTITY` locally, or configure
   the Release environment variables and secrets described in [RELEASING.md](RELEASING.md).
   Never commit certificate/private-key exports or passwords. The official
   Sparkle public key, Team ID, and certificate identity are not signing secrets.
6. Preserve GPLv3 and third-party notices and provide corresponding source as
   described in [LICENSING.md](LICENSING.md). Identify your distribution clearly
   so recipients can distinguish it from official RunHuddle.

Official releases must retain the existing bundle identity and Sparkle public
key to preserve settings and update trust. Contributor cleanup is not a reason
to rotate either.
