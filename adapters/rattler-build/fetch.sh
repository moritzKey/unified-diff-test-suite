#!/usr/bin/env bash
# Downloads the released rattler-build (the static Linux x86_64 build) into bin/, checked against the
# sha256 that the release publishes next to it. Elsewhere, put rattler-build on the PATH or set UDTS_RATTLER_BUILD.
set -euo pipefail
cd "$(dirname "$0")"
VERSION=0.80.2
SHA256=5982426ab00d015a7b688bb9d4d3a75e137b6b746e944b6ae8b5294755030e7b
mkdir -p bin
if ! echo "$SHA256  bin/rattler-build" | sha256sum -c --status - 2>/dev/null; then
  curl -fsSL --retry 5 --connect-timeout 20 --max-time 300 -o bin/rattler-build \
    "https://github.com/prefix-dev/rattler-build/releases/download/v$VERSION/rattler-build-x86_64-unknown-linux-musl"
  echo "$SHA256  bin/rattler-build" | sha256sum -c --quiet -
fi
chmod +x bin/rattler-build
bin/rattler-build --version
