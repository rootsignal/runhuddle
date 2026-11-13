#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .build/terminal-smoke
swiftc -parse-as-library -I .build/debug/Modules -I Sources/CSQLite \
  Tests/EmbeddedTerminalSmoke/TerminalCheck.swift Sources/SessionManager/EmbeddedTerminal.swift \
  Sources/SessionManager/PersistentTerminalService.swift Sources/SessionManager/TerminalPreferences.swift Sources/SessionManager/TerminalTheme.swift Sources/SessionManager/TerminalThemePreview.swift Sources/SessionManager/HuddleStyle.swift Sources/SessionManager/ViewState.swift \
  .build/debug/SessionCore.build/*.o .build/debug/SwiftTerm.build/*.o \
  -lsqlite3 -o .build/terminal-smoke/check
.build/terminal-smoke/check
