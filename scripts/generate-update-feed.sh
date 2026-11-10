#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' dist/RunHuddle.app/Contents/Info.plist)
image="dist/RunHuddle-${version}-$(uname -m).dmg"
/usr/bin/xcrun stapler validate "$image"
stage=$(mktemp -d "$PWD/.build/update-feed.XXXXXX")
trap 'rm -rf "$stage"' EXIT
cp "$image" "$stage/"
if [[ -f updates/appcast.xml ]]; then cp updates/appcast.xml "$stage/appcast.xml"; fi
signing=(--account RunHuddle)
if [[ -n "${RUNHUDDLE_SPARKLE_KEY_FILE:-}" ]]; then signing=(--ed-key-file "$RUNHUDDLE_SPARKLE_KEY_FILE"); fi
.build/artifacts/sparkle/Sparkle/bin/generate_appcast "${signing[@]}" \
  --download-url-prefix "https://github.com/rootsignal/runhuddle/releases/download/v$version/" \
  --maximum-versions 1 --maximum-deltas 0 -o dist/appcast.xml "$stage"
.build/artifacts/sparkle/Sparkle/bin/sign_update "${signing[@]}" --verify dist/appcast.xml
