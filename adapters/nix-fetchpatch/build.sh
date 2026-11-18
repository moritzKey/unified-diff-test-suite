#!/usr/bin/env bash
# Builds the two patchutils that nixpkgs' fetchpatch and fetchpatch2 run, from the sources and with the
# patches that nixpkgs uses (pkgs/tools/text/patchutils/{0.3.3,0.4.2}.nix at the commit below), into
# build/patchutils-0.3.3 and build/patchutils-0.4.2. Everything is pinned by sha256.
set -euo pipefail
cd "$(dirname "$0")"
NIXPKGS=317fbe5e1a29c7ec3d11744d78637c424aa9d3d0
mkdir -p upstream build
fetch() { # url file sha256
  [ -f "upstream/$2" ] || curl -fsSL --retry 5 --connect-timeout 20 --max-time 300 -o "upstream/$2" "$1"
  echo "$3  upstream/$2" | sha256sum -c --quiet -
}
fetch https://cyberelk.net/tim/data/patchutils/stable/patchutils-0.3.3.tar.xz patchutils-0.3.3.tar.xz \
  91f4e8451b2efcac5d40c966e42c175803450f0de94c926bfecc12c90070ad3c
fetch https://cyberelk.net/tim/data/patchutils/stable/patchutils-0.4.2.tar.xz patchutils-0.4.2.tar.xz \
  8875b0965fe33de62b890f6cd793be7fafe41a4e552edbf641f1fed5ebbf45ed
P="https://raw.githubusercontent.com/NixOS/nixpkgs/$NIXPKGS/pkgs/tools/text/patchutils"
fetch "$P/drop-comments.patch" drop-comments.patch 64d4642199680cce5bd34d155bf4c35fc0a8875daded7f98fb266083b3638d04
fetch "$P/getenv-signature.patch" getenv-signature.patch ed2ea3c8776e403870a823f7a30175e1defa312cb8e607deca237a28675fccdf
fetch "$P/Make-grepdiff1-test-case-pcre-aware.patch" Make-grepdiff1-test-case-pcre-aware.patch \
  16140c0c3554c40079afbda5be48631f4bb671e1fe868ffd539a017330a4c236

build() { # version patch...
  local v=$1; shift
  local src="build/src-$v"
  rm -rf "$src" "build/patchutils-$v"
  mkdir -p "$src"
  tar -xJf "upstream/patchutils-$v.tar.xz" -C "$src" --strip-components=1
  for p in "$@"; do patch -s -d "$src" -p1 < "upstream/$p"; done
  (cd "$src" && ./configure -q --prefix="$PWD/../patchutils-$v" > /dev/null && make -s -j4 > /dev/null 2>&1 && make -s install > /dev/null 2>&1)
  rm -rf "$src"
  "build/patchutils-$v/bin/filterdiff" --version | head -n 1
}
build 0.3.3 drop-comments.patch getenv-signature.patch
build 0.4.2 Make-grepdiff1-test-case-pcre-aware.patch getenv-signature.patch
echo "$NIXPKGS" > build/nixpkgs
