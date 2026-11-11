# Building and testing

[Documentation](README.md) · [RunHuddle](../README.md)

## Build and install from source

Builders need macOS 14+, Swift 6+ (Xcode or compatible Command Line Tools), Python 3.12+, Git, and internet access. These requirements apply only to building the app.

```sh
git clone https://github.com/rootsignal/runhuddle.git
cd runhuddle
python3 scripts/install_local.py --open
```

The installer downloads a checksum-verified, pinned standalone Python runtime, installs pinned dependencies into it, builds and ad-hoc signs the app, and installs it in `~/Applications`. It does not need `sudo`. The installed app runs independently of the checkout.

To generate a drag-to-Applications disk image:

```sh
bash scripts/build-app.sh
python3 scripts/verify_standalone.py
bash scripts/package-dmg.sh
```

The DMG and SHA-256 checksum are written to `dist/`. Build on the target architecture; the runtime packager supports arm64 and x86_64, but only arm64 has been validated.

## Build and test without installing

```sh
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt
swift test
.venv/bin/python -m unittest discover -s Tests -p 'test_*.py' -v
bash scripts/build-app.sh
open dist/RunHuddle.app
```

## Documentation screenshots

Run `bash scripts/render-switcher-screenshot.sh` to regenerate the README’s session-switcher image. It renders the production SwiftUI view offscreen with fictional sessions and a staged terminal background. The fixture uses inert dependencies: it does not read your sessions, launch agents, or register a shortcut. No app installation is needed.

## Troubleshooting builds

See [source-build troubleshooting](TROUBLESHOOTING.md#source-build-errors).

## Releasing

See [Building and publishing releases](RELEASING.md) for Developer ID signing, notarization, local release scripts, CI, and signed updates. Historical implementation and validation details live in [development notes](DEVELOPMENT.md).
