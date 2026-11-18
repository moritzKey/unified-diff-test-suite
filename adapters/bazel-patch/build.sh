#!/bin/sh
# Bazel's native patch (PatchUtil.java), at a pinned commit, with the libraries in the versions Bazel's
# MODULE.bazel names at that commit, all checked against sha256 sums; then compile it with the vfs
# stand-ins in vfs/ and the host.
#   ./build.sh        needs a JDK 17 or newer, curl and sha256sum
set -eu
cd "$(dirname "$0")"
COMMIT=e66a6922a0fb950e7394e78bb18159078ad359df   # "Keep CRLF line endings when patching a file", 2026-11-09
mkdir -p lib upstream build
check() { echo "$2  $1" | sha256sum -c - >/dev/null || { echo "checksum mismatch: $1" >&2; rm -f "$1"; exit 1; }; }
fetch() { # url file sha256
  [ -f "$2" ] || curl -fsS --retry 5 -m 120 -o "$2" "$1"
  check "$2" "$3"
}
fetch "https://raw.githubusercontent.com/bazelbuild/bazel/$COMMIT/src/main/java/com/google/devtools/build/lib/bazel/repository/decompressor/PatchUtil.java" \
  upstream/PatchUtil.java 6f89a3cbb6400843ea89cefcb83952e511f28592e892863c9dfd58266d2af0fd
M=https://repo1.maven.org/maven2
fetch $M/com/google/guava/guava/33.7.2-jre/guava-33.7.2-jre.jar lib/guava-33.7.2-jre.jar b530942257fb935f8b2cfaa5f8eb5bd59c555fd8e8d01b8ce98912e077ea606c
fetch $M/com/google/guava/failureaccess/1.0.3/failureaccess-1.0.3.jar lib/failureaccess-1.0.3.jar cbfc3906b19b8f55dd7cfd6dfe0aa4532e834250d7f080bd8d211a3e246b59cb
fetch $M/io/github/java-diff-utils/java-diff-utils/4.12/java-diff-utils-4.12.jar lib/java-diff-utils-4.12.jar 9990a2039778f6b4cc94790141c2868864eacee0620c6c459451121a901cd5b5
fetch $M/com/google/code/findbugs/jsr305/3.0.2/jsr305-3.0.2.jar lib/jsr305-3.0.2.jar 766ad2a0783f2687962c8ad74ceecc38a28b9f72a2d085ee438b7813e928d0c7
javac --release 17 -nowarn -cp 'lib/*' -d build \
  vfs/com/google/devtools/build/lib/vfs/Path.java vfs/com/google/devtools/build/lib/vfs/FileSystemUtils.java \
  upstream/PatchUtil.java BazelPatchHost.java
echo "$COMMIT" > build/commit
echo "built: java -cp 'build:lib/*' BazelPatchHost apply:bazel"
