#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
app="dist/RunHuddle.app"
/usr/bin/codesign --verify --deep --strict "$app"
version=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$app/Contents/Info.plist")
arch=$(/usr/bin/uname -m)
image="dist/RunHuddle-${version}-${arch}.dmg"
stage=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/runhuddle-dmg.XXXXXX")
trap '/bin/rm -rf "$stage"' EXIT
/usr/bin/ditto "$app" "$stage/RunHuddle.app"
/bin/ln -s /Applications "$stage/Applications"
cat > "$stage/Read Me.txt" <<'NOTICE'
Drag RunHuddle to Applications, then open it there.
Requires macOS 14 or newer and a supported coding agent installed separately.
Python and all RunHuddle dependencies are included.

This development preview is not yet Developer ID signed or notarized.
macOS may block a downloaded copy. Do not disable Gatekeeper globally.
Source and setup details: https://github.com/rootsignal/runhuddle
NOTICE
/usr/bin/hdiutil create -volname RunHuddle -srcfolder "$stage" -ov -format UDZO "$image"
/usr/bin/shasum -a 256 "$image" > "$image.sha256"
echo "$image"
