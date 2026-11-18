// A stand-in for Bazel's com.google.devtools.build.lib.vfs.Path with the methods PatchUtil calls, on java.nio.
// Each one does what Bazel's UnixFileSystem does on Linux (see the comments); PatchUtil itself is Bazel's, unchanged.
//
// Bazel's paths are strings in its "internal" encoding: one char per byte of the name, as PatchUtil gets them by
// reading the patch as ISO-8859-1. Bazel passes those bytes to the system as they are. java.nio takes Unicode and
// encodes it as UTF-8, so a name is decoded from UTF-8 first; a name that is not valid UTF-8 cannot be given to
// java.nio unchanged, and the stand-in refuses it (Bazel itself would use the bytes).
package com.google.devtools.build.lib.vfs;

import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Paths;
import java.nio.file.attribute.PosixFilePermission;
import java.util.EnumSet;
import java.util.Set;

public final class Path {
  private final java.nio.file.Path p;

  private Path(java.nio.file.Path p) {
    this.p = p.normalize();
  }

  public static Path of(String absolute) {
    return new Path(Paths.get(absolute).toAbsolutePath());
  }

  /** Bazel normalizes "." and ".." lexically (PathFragment); an absolute argument replaces the base. */
  public Path getRelative(String other) {
    return new Path(p.resolve(fromInternal(other)));
  }

  private static String fromInternal(String internal) {
    try {
      return StandardCharsets.UTF_8.newDecoder()
          .onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT)
          .decode(ByteBuffer.wrap(internal.getBytes(StandardCharsets.ISO_8859_1)))
          .toString();
    } catch (CharacterCodingException e) {
      throw new IllegalArgumentException("the stand-in for Bazel's Path cannot name a file that is not UTF-8: " + internal);
    }
  }

  private static String toInternal(String unicode) {
    return new String(unicode.getBytes(StandardCharsets.UTF_8), StandardCharsets.ISO_8859_1);
  }

  public void renameTo(Path target) throws IOException {
    Files.move(p, target.p, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
  }

  public Path relativeTo(Path base) {
    return new Path(base.p.relativize(p));
  }

  public boolean startsWith(Path other) {
    return p.startsWith(other.p);
  }

  public String getPathString() {
    return toInternal(p.toString());
  }

  public Path getParentDirectory() {
    java.nio.file.Path parent = p.getParent();
    return parent == null ? null : new Path(parent);
  }

  public boolean isSymbolicLink() {
    return Files.isSymbolicLink(p);
  }

  public Path resolveSymbolicLinks() throws IOException {
    return new Path(p.toRealPath());
  }

  /** Follows symbolic links, as Path.exists() does. */
  public boolean exists() {
    return Files.exists(p);
  }

  /** Removes a file, a symbolic link or an empty directory; false if there was nothing. */
  public boolean delete() throws IOException {
    return Files.deleteIfExists(p);
  }

  public InputStream getInputStream() throws IOException {
    return Files.newInputStream(p);
  }

  public OutputStream getOutputStream(boolean append) throws IOException {
    return append
        ? Files.newOutputStream(p, java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND)
        : Files.newOutputStream(p);
  }

  public void createDirectoryAndParents() throws IOException {
    Files.createDirectories(p);
  }

  // UnixFileSystem: is* test the owner's bit of stat(path, follow symlinks).
  public boolean isReadable() throws IOException {
    return (mode() & 0400) != 0;
  }

  public boolean isWritable() throws IOException {
    return (mode() & 0200) != 0;
  }

  public boolean isExecutable() throws IOException {
    return (mode() & 0100) != 0;
  }

  // UnixFileSystem: setReadable 0400, setWritable 0200, setExecutable 0111 (modifyPermissionBits).
  public void setReadable(boolean readable) throws IOException {
    modify(0400, readable);
  }

  public void setWritable(boolean writable) throws IOException {
    modify(0200, writable);
  }

  public void setExecutable(boolean executable) throws IOException {
    modify(0111, executable);
  }

  private static final PosixFilePermission[] BITS = {
    PosixFilePermission.OTHERS_EXECUTE, PosixFilePermission.OTHERS_WRITE, PosixFilePermission.OTHERS_READ,
    PosixFilePermission.GROUP_EXECUTE, PosixFilePermission.GROUP_WRITE, PosixFilePermission.GROUP_READ,
    PosixFilePermission.OWNER_EXECUTE, PosixFilePermission.OWNER_WRITE, PosixFilePermission.OWNER_READ,
  };

  private int mode() throws IOException {
    Set<PosixFilePermission> set = Files.getPosixFilePermissions(p);
    int mode = 0;
    for (int i = 0; i < BITS.length; i++) if (set.contains(BITS[i])) mode |= 1 << i;
    return mode;
  }

  private void modify(int bits, boolean add) throws IOException {
    int mode = add ? (mode() | bits) : (mode() & ~bits);
    Set<PosixFilePermission> set = EnumSet.noneOf(PosixFilePermission.class);
    for (int i = 0; i < BITS.length; i++) if ((mode & (1 << i)) != 0) set.add(BITS[i]);
    Files.setPosixFilePermissions(p, set);
  }

  @Override
  public boolean equals(Object other) {
    return other instanceof Path && ((Path) other).p.equals(p);
  }

  @Override
  public int hashCode() {
    return p.hashCode();
  }

  @Override
  public String toString() {
    return getPathString();
  }
}
