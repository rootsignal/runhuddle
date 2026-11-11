#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
check_dir="$(mktemp -d)"
trap 'rm -rf "$check_dir"' EXIT
swift build --target SessionCore >/dev/null
build_dir="$(swift build --show-bin-path)"
swiftc -parse-as-library -I "$build_dir/Modules" -I Sources/CSQLite Sources/SessionManager/ReplyInputTextView.swift tests/ReplyInputSmoke/ReplyInputCheck.swift "$build_dir"/SessionCore.build/*.o -lsqlite3 -o "$check_dir/check"
"$check_dir/check"
