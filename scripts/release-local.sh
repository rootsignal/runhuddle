#!/bin/bash
# Build and upload a draft from this Mac's existing signing identity/Keychain.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -n "$(git status --porcelain)" ]]; then
  echo 'Commit or stash working tree changes before releasing.' >&2
  exit 1
fi
export RUNHUDDLE_SIGN_IDENTITY="${RUNHUDDLE_SIGN_IDENTITY:-Developer ID Application: RootSignal LLC (C65AQBMSBJ)}"
python="${RUNHUDDLE_BUILD_PYTHON:-python3}"
export RUNHUDDLE_BUILD_PYTHON="$python"
"$python" -c 'import websockets, yaml'
gh auth status
swift test --build-system native
"$python" -m unittest discover -s Tests -p 'test_*.py'
bash scripts/build-app.sh
"$python" scripts/verify_standalone.py
bash scripts/notarize.sh
version=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' dist/RunHuddle.app/Contents/Info.plist)
image="dist/RunHuddle-${version}-$(uname -m).dmg"
commit=$(git rev-parse HEAD)
# Verify the release commit exists remotely. Never create a release of unpushed code.
gh api "repos/rootsignal/runhuddle/commits/$commit" --silent
gh release create "v$version" "$image" "$image.sha256" --target "$commit" --title "RunHuddle $version" --draft --generate-notes
