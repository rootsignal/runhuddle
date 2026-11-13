#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .build/agent-launch-check
swiftc -parse-as-library -I .build/debug/Modules -I Sources/CSQLite \
  Tests/AgentLaunchEnvironment/Check.swift Sources/SessionManager/PersistentTerminalService.swift \
  .build/debug/SessionCore.build/*.o -lsqlite3 -o .build/agent-launch-check/check
.build/agent-launch-check/check
