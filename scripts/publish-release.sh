#!/bin/bash
# Publish a reviewed draft, then advertise its signed feed to installed apps.
set -euo pipefail
cd "$(dirname "$0")/.."
version="${1:?Usage: bash scripts/publish-release.sh 0.5.0}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then echo 'Invalid version' >&2; exit 1; fi
if [[ -n "$(git status --porcelain)" ]]; then echo 'Use a clean working tree to publish the feed.' >&2; exit 1; fi
stage=$(mktemp -d "$PWD/.build/publish-feed.XXXXXX")
trap 'rm -rf "$stage"' EXIT
gh release download "v$version" --pattern appcast.xml --dir "$stage"
.build/artifacts/sparkle/Sparkle/bin/sign_update --account RunHuddle --verify "$stage/appcast.xml"
python3 - "$stage/appcast.xml" "$version" <<'PY'
import sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
items = root.findall('./channel/item')
assert items, 'Empty feed'
assert items[0].findtext('{http://www.andymatuschak.org/xml-namespaces/sparkle}shortVersionString') == sys.argv[2], 'Feed version differs'
url = items[0].find('enclosure').get('url')
assert url.startswith('https://github.com/rootsignal/runhuddle/releases/download/v' + sys.argv[2] + '/'), 'Unexpected download URL'
PY
gh release edit "v$version" --draft=false --prerelease
mkdir -p updates
cp "$stage/appcast.xml" updates/appcast.xml
python3 scripts/update-download-links.py updates/appcast.xml
git add updates/appcast.xml README.md docs/GETTING_STARTED.md
git commit -m "Publish signed update feed for $version"
git push origin main
