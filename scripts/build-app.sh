#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
swift build -c release
python3 scripts/package_app.py
