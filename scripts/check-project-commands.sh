#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .build/command-smoke
swiftc -parse-as-library -I .build/debug/Modules -I Sources/CSQLite \
  Tests/ProjectCommandSmoke/RunnerCheck.swift Sources/SessionManager/ProjectPreferencesView.swift \
  Sources/SessionManager/ViewState.swift .build/debug/SessionCore.build/*.o \
  -lsqlite3 -o .build/command-smoke/check
.build/command-smoke/check
