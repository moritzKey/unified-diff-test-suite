#!/usr/bin/env bash
# normalize.sh PATCHUTILS_BIN IN OUT
#
# The postFetch of nixpkgs' fetchpatch (pkgs/build-support/fetchpatch/default.nix) with its default
# arguments: stripLen 0 and no relative, extraPrefix, excludes, includes, hunks or revert. The commands are
# the ones in that file; only the paths are parameters. A non-zero exit is fetchpatch failing the fetch.
set -e
PATH="$1:$PATH"
out="$3"
tmpfile="$3.tmp"
cp "$2" "$out"

lsdiff \
  "$out" \
| sort -u | sed -e 's/[*?]/\\&/g' \
| xargs -I{} --delimiter='\n' \
  filterdiff \
  --include={} \
  --strip=0 \
  --clean "$out" > "$tmpfile"

if [ ! -s "$tmpfile" ]; then
  echo "error: Normalized patch '$tmpfile' is empty (while the fetched file was not)!" 1>&2
  exit 1
fi

filterdiff \
  -p1 \
  "$tmpfile" > "$out"

if [ ! -s "$out" ]; then
  echo "error: Filtered patch '$out' is empty (while the original patch file was not)!" 1>&2
  exit 1
fi
rm -f "$tmpfile"
