#!/bin/bash
# Render the real switcher with fictional data over a staged terminal.
set -euo pipefail
cd "$(dirname "$0")/.."
swift build --target SessionCore >/dev/null
build_dir="$(swift build --show-bin-path)"
preview_dir="$(mktemp -d)"
trap 'rm -rf "$preview_dir"' EXIT
swiftc -parse-as-library -I "$build_dir/Modules" -I Sources/CSQLite \
  scripts/previews/SwitcherScreenshot.swift \
  Sources/SessionManager/SessionSwitcherView.swift \
  Sources/SessionManager/HuddleStyle.swift \
  Sources/SessionManager/RunHuddleIcon.swift \
  Sources/SessionManager/ViewState.swift \
  "$build_dir"/SessionCore.build/*.o -lsqlite3 -o "$preview_dir/render"
"$preview_dir/render" "$PWD/docs/images/runhuddle-switcher.png"
