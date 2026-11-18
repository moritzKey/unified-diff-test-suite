#!/bin/sh
# Build the patch of FreeBSD (usr.bin/patch) on Linux. macOS ships the same program as
# /usr/bin/patch ("patch 2.0-12u11-Apple"), so on a Mac nothing needs to be built.
#   ./build.sh        needs a C compiler, curl and sha256sum
# The sources are those of one commit of freebsd-src, checked against the hashes below, and
# compiled unchanged; compat.h supplies the few things glibc does not have.
set -eu
cd "$(dirname "$0")"
COMMIT=5b952262d3e223c033849441320bb12796bc52e4 # main, 2026-11-17
mkdir -p src build
fetch() { # file sha256
  [ -f "src/$1" ] || curl -fsS --retry 5 -m 60 -o "src/$1" "https://raw.githubusercontent.com/freebsd/freebsd-src/$COMMIT/usr.bin/patch/$1"
  echo "$2  src/$1" | sha256sum -c - >/dev/null || { echo "checksum mismatch: src/$1" >&2; rm -f "src/$1"; exit 1; }
}
fetch backupfile.c 3aa676ff1fb2b6d74326ae2837105c900466d9b478676d5a963842bdb4ff87f0
fetch backupfile.h 86c0ea2661b61103e0a9c274754f0e6bd598f9c5835c6dad02a4d42dda415704
fetch common.h 156db179796656102fbf05e30964e4b1ebcc2660b2498517972d43a3b504d480
fetch inp.c 6bbdc2d8331219840a667786306bbf17d002758cc265192f5bf3583eeef46c0e
fetch inp.h ca3403443cd691bf937fe3e6a4331fae214ab4fd8165e9fbecef5e33186e04b7
fetch mkpath.c efb94bebbf44f4b25f5a80b7d3c7a833e910e45b10f5503e3b843974bfdc2646
fetch patch.c 182c0637958ac1d00ed8a898271e3a3c9bb1cdd8ee296a46a18a9bbce5a332b2
fetch pathnames.h 9c11adfa190a09aebaa119cca228128c6d4ef65009383b74bac0923198c64794
fetch pch.c ef3e3297f0a7627dddadb0449a8092c1015f2b4befb290216b5576a6b50616ea
fetch pch.h 5db991531956823ad331f69be33b7d5ed9fe4af057d9ebd3a4fc23e72a04f1b6
fetch util.c 085fa3634738168afc26da22bb1e315b0a8f30cb43a867c909b3d098226347b4
fetch util.h 7389b31fed7b5bdb6c90f4143179cbe8e18b1e8bba8df4077b232efd771c74de
${CC:-cc} -O2 -w -include compat.h -o build/patch src/backupfile.c src/inp.c src/mkpath.c src/patch.c src/pch.c src/util.c
echo "built: $(pwd)/build/patch ($(build/patch --version))"
