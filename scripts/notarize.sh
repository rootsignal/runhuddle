#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${RUNHUDDLE_SIGN_IDENTITY:?Set RUNHUDDLE_SIGN_IDENTITY to your Developer ID Application identity}"
profile="${RUNHUDDLE_NOTARY_PROFILE:-RunHuddle}"
app="dist/RunHuddle.app"
/usr/bin/codesign --verify --deep --strict "$app"
# A successful submission must report Accepted before stapling/releasing.
/usr/bin/ditto -c -k --keepParent "$app" dist/RunHuddle-notarization.zip
/usr/bin/xcrun notarytool submit dist/RunHuddle-notarization.zip --keychain-profile "$profile" --wait
/usr/bin/xcrun stapler staple "$app"
/usr/sbin/spctl --assess --type execute --verbose=2 "$app"
bash scripts/package-dmg.sh
version=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$app/Contents/Info.plist")
image="dist/RunHuddle-${version}-$(/usr/bin/uname -m).dmg"
/usr/bin/xcrun notarytool submit "$image" --keychain-profile "$profile" --wait
/usr/bin/xcrun stapler staple "$image"
/usr/bin/xcrun stapler validate "$image"
/usr/bin/shasum -a 256 "$image" > "$image.sha256"
