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

Source and setup details: https://github.com/rootsignal/runhuddle
NOTICE
if ! /usr/bin/xcrun stapler validate "$app" >/dev/null 2>&1; then
  echo 'This development preview is not notarized. macOS may block a downloaded copy. Do not disable Gatekeeper globally.' >> "$stage/Read Me.txt"
fi
/usr/bin/hdiutil create -volname RunHuddle -srcfolder "$stage" -ov -format UDZO "$image"
if [[ -n "${RUNHUDDLE_SIGN_IDENTITY:-}" ]]; then
  /usr/bin/codesign --force --sign "$RUNHUDDLE_SIGN_IDENTITY" --timestamp "$image"
fi
/usr/bin/shasum -a 256 "$image" > "$image.sha256"
echo "$image"
