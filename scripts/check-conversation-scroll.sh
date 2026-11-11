#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .build/scroll-smoke
swiftc -parse-as-library Sources/SessionManager/ConversationScrollFollower.swift Tests/ConversationScrollSmoke/ScrollCheck.swift -o .build/scroll-smoke/check
.build/scroll-smoke/check
