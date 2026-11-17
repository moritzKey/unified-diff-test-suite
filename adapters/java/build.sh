#!/bin/sh
# Fetch the libraries under test (pinned, with checksums) and compile the host.
#   ./build.sh        needs a JDK 17 or newer, curl and sha256sum
set -eu
cd "$(dirname "$0")"
mkdir -p lib build
fetch() { # path-below-maven2 sha256
  file="lib/$(basename "$1")"
  [ -f "$file" ] || curl -fsS -m 120 -o "$file" "https://repo1.maven.org/maven2/$1"
  echo "$2  $file" | sha256sum -c - >/dev/null || { echo "checksum mismatch: $file" >&2; rm -f "$file"; exit 1; }
}
fetch io/github/java-diff-utils/java-diff-utils/4.18/java-diff-utils-4.18.jar a20d8f538a1254dde49370cc06466aff7df7e8cbc75d1077e14f5c951d2f8bfa
fetch io/reflectoring/diffparser/diffparser/1.4/diffparser-1.4.jar 06db33c3aaf52997d2fbf59a3686c72be98c46a4dab39f434b68dddd8d66520c
fetch org/eclipse/jgit/org.eclipse.jgit/7.8.1.202611041320-r/org.eclipse.jgit-7.8.1.202611041320-r.jar acca09a77e74440fd24af72c8af4c496e42650d8092a4691a2935d9ce21d05d7
# What JGit needs at run time, in the versions its own build names.
fetch com/googlecode/javaewah/JavaEWAH/1.2.3/JavaEWAH-1.2.3.jar d65226949713c4c61a784f41c51167e7b0316f93764398ebba9e4336b3d954c2
fetch commons-codec/commons-codec/1.22.1/commons-codec-1.22.1.jar 78a5d732fbd715e2d10bd7150d2f8030bae57267f8aacc5c88f642cb6c2e5d3f
# diffparser and JGit log through slf4j; without a binding it says so once on stderr and stays quiet.
fetch org/slf4j/slf4j-api/2.0.18/slf4j-api-2.0.18.jar 44508fd1576500688c790b190acdd16fec4f8c79a3e0b900afd70503cf055f55
javac --release 17 -Xlint:all -cp 'lib/*' -d build Host.java
echo "built: java -cp 'build:lib/*' Host <adapter>"
