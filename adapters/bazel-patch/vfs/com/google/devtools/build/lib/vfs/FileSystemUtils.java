// Copyright 2014 The Bazel Authors. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// A stand-in for the methods of Bazel's com.google.devtools.build.lib.vfs.FileSystemUtils that PatchUtil calls.
// The method bodies are Bazel's (FileSystemUtils.java at the commit build.sh names), so this file keeps Bazel's
// license; they run on top of the Path stand-in.
package com.google.devtools.build.lib.vfs;

import static java.nio.charset.StandardCharsets.ISO_8859_1;

import com.google.common.collect.ImmutableList;
import com.google.common.io.ByteSink;
import com.google.common.io.ByteSource;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.Charset;

public final class FileSystemUtils {
  private FileSystemUtils() {}

  public static ByteSource asByteSource(final Path path) {
    return new ByteSource() {
      @Override
      public InputStream openStream() throws IOException {
        return path.getInputStream();
      }
    };
  }

  public static ByteSink asByteSink(final Path path, final boolean append) {
    return new ByteSink() {
      @Override
      public OutputStream openStream() throws IOException {
        return path.getOutputStream(append);
      }
    };
  }

  public static ByteSink asByteSink(final Path path) {
    return asByteSink(path, false);
  }

  /** Writes lines to file using the given encoding, ending every line with '\n'. */
  public static void writeLinesAs(Path file, Charset charset, Iterable<String> lines) throws IOException {
    file.getParentDirectory().createDirectoryAndParents();
    asByteSink(file).asCharSink(charset).writeLines(lines, "\n");
  }

  public static ImmutableList<String> readLinesAsLatin1(Path inputFile) throws IOException {
    return readLines(inputFile, ISO_8859_1);
  }

  public static ImmutableList<String> readLines(Path inputFile, Charset charset) throws IOException {
    return asByteSource(inputFile).asCharSource(charset).readLines();
  }
}
