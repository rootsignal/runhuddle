#!/bin/bash
# Build the same tmux protocol version bundled by local releases.
set -euo pipefail
brew install libevent ncurses utf8proc pkgconf
stage="${RUNNER_TEMP:?This helper is for CI}/runhuddle-tmux"
mkdir -p "$stage"
curl --fail --location --retry 3 https://github.com/tmux/tmux/releases/download/3.5a/tmux-3.5a.tar.gz -o "$stage/tmux.tar.gz"
echo "16216bd0877170dfcc64157085ba9013610b12b082548c7c9542cc0103198951  $stage/tmux.tar.gz" | shasum -a 256 --check
tar -xzf "$stage/tmux.tar.gz" -C "$stage"
cd "$stage/tmux-3.5a"
export PKG_CONFIG_PATH="$(brew --prefix libevent)/lib/pkgconfig:$(brew --prefix ncurses)/lib/pkgconfig:$(brew --prefix utf8proc)/lib/pkgconfig"
./configure --prefix="$stage/runtime" --enable-sixel --enable-utf8proc
make -j 3
make install
cp COPYING "$stage/runtime/COPYING"
echo "RUNHUDDLE_TMUX=$stage/runtime/bin/tmux" >> "$GITHUB_ENV"
"$stage/runtime/bin/tmux" -V
