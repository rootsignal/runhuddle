#!/usr/bin/env bash
set -euo pipefail

repo=${GH_REPO:-rootsignal/runhuddle}
sha=${RELEASE_SHA:-$(git rev-parse HEAD)}
version=$(node -p 'require("./package.json").version')
dist=dist/package
dmg="RunHuddle-${version}-arm64.dmg"
zip="RunHuddle-${version}-arm64.zip"
tag="v${version}"

xcrun stapler validate "$dist/$dmg"
xcrun stapler validate "$dist/mac-arm64/RunHuddle.app"
node scripts/macos-release-metadata.mjs "$dist"

installer_assets=("$dist/$dmg" "$dist/$dmg.sha256" "$dist/$zip")
manifest_assets=("$dist/latest-mac.yml" "$dist/macos-release.json")

verify_asset() {
  local release="$1" file="$2"
  local digest remote
  digest=$(shasum -a 256 "$file" | cut -d ' ' -f 1)
  remote=$(gh api "repos/$repo/releases/tags/$release" --jq ".assets[] | select(.name == \"${file##*/}\") | .digest")
  [[ "$remote" == "sha256:$digest" ]]
}

if gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
  if [[ $(gh api "repos/$repo/commits/$tag" --jq .sha) != "$sha" ]]; then
    echo "Release $tag points to a different source commit." >&2
    exit 1
  fi
  for file in "${installer_assets[@]}" "${manifest_assets[@]}"; do
    if ! verify_asset "$tag" "$file"; then
      echo "Release $tag has a missing or different ${file##*/}. Use the original signed artifacts to retry." >&2
      exit 1
    fi
  done
else
  gh release create "$tag" "${installer_assets[@]}" "${manifest_assets[@]}" \
    --repo "$repo" --target "$sha" --title "RunHuddle $version" \
    --notes "RunHuddle for Apple Silicon. [Source for $version](https://github.com/$repo/tree/$tag)." --latest
fi
if gh release view electron-stable --repo "$repo" >/dev/null 2>&1; then
  for file in "${installer_assets[@]}" "${manifest_assets[@]}"; do
    if ! verify_asset electron-stable "$file"; then
      gh release upload electron-stable "$file" --clobber --repo "$repo"
    fi
  done
else
  gh release create electron-stable "${installer_assets[@]}" "${manifest_assets[@]}" \
    --repo "$repo" --target "$sha" --title "RunHuddle update channel" \
    --notes "Automatic update feed. [Browse RunHuddle releases](https://github.com/$repo/releases)." --latest=false
fi
