#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Avoid the XCBuild/swiftbuild backend, which can fail to initialize with
# Command Line Tools installations. This package needs only SwiftPM's native backend.
swift build --build-system native -c release
"${RUNHUDDLE_BUILD_PYTHON:-python3}" scripts/package_app.py
