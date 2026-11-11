#!/bin/bash
# Render production layout containers wide -> narrow -> wide, without opening a window.
set -euo pipefail
cd "$(dirname "$0")/.."
swift build --target SessionCore >/dev/null
build_dir="$(swift build --show-bin-path)"
preview_dir="$(mktemp -d)"
trap 'rm -rf "$preview_dir"' EXIT
output_dir="${1:-/tmp/runhuddle-resize-previews}"
mkdir -p "$output_dir"
swiftc -parse-as-library -I "$build_dir/Modules" -I Sources/CSQLite \
  scripts/previews/WorkspaceResize.swift Sources/SessionManager/WorkspaceLayout.swift \
  Sources/SessionManager/HuddleStyle.swift Sources/SessionManager/RepositoryContextView.swift Sources/SessionManager/ViewState.swift \
  "$build_dir"/SessionCore.build/*.o -lsqlite3 -o "$preview_dir/render"
"$preview_dir/render" "$output_dir"
