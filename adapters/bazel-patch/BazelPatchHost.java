// The native patch of Bazel (PatchUtil, what `ctx.patch()` and the `patches` of http_archive and of
// Bzlmod overrides use when no patch_tool is set), behind the adapter protocol.
//
//   java -cp 'build:lib/*' BazelPatchHost apply:bazel
//
// PatchUtil.java is Bazel's file, unchanged (build.sh fetches it at a pinned commit). The two vfs classes
// it uses are stand-ins in vfs/. The JSON code is the same as in ../java/Host.java.
import com.google.devtools.build.lib.bazel.repository.decompressor.PatchUtil;
import com.google.devtools.build.lib.vfs.Path;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class BazelPatchHost {
  /** The Bazel commit PatchUtil.java comes from, as build.sh records it. */
  static String commit() {
    try {
      return new String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get("build", "commit")), StandardCharsets.US_ASCII).trim();
    } catch (java.io.IOException e) {
      return "unknown";
    }
  }

  // ---- JSON, as much of it as the protocol needs ----------------------------------

  static void write(StringBuilder out, Object value) {
    if (value == null) out.append("null");
    else if (value instanceof Boolean || value instanceof Number) out.append(value);
    else if (value instanceof Map) {
      out.append('{');
      boolean first = true;
      for (Map.Entry<?, ?> e : ((Map<?, ?>) value).entrySet()) {
        if (!first) out.append(',');
        first = false;
        write(out, String.valueOf(e.getKey()));
        out.append(':');
        write(out, e.getValue());
      }
      out.append('}');
    } else if (value instanceof List) {
      out.append('[');
      boolean first = true;
      for (Object item : (List<?>) value) {
        if (!first) out.append(',');
        first = false;
        write(out, item);
      }
      out.append(']');
    } else {
      // One line of plain ASCII: everything else is written as \\uXXXX.
      String s = String.valueOf(value);
      out.append('"');
      for (int i = 0; i < s.length(); i++) {
        char c = s.charAt(i);
        if (c == '"' || c == '\\') out.append('\\').append(c);
        else if (c >= 0x20 && c < 0x7f) out.append(c);
        else out.append(String.format("\\u%04x", (int) c));
      }
      out.append('"');
    }
  }

  /** The string members of a flat JSON object; other members are skipped (null for JSON null). */
  static Map<String, String> readObject(String json) {
    Map<String, String> members = new LinkedHashMap<>();
    int[] pos = {0};
    skipSpace(json, pos);
    if (pos[0] >= json.length() || json.charAt(pos[0]) != '{') throw new IllegalArgumentException("not an object");
    pos[0]++;
    while (true) {
      skipSpace(json, pos);
      if (json.charAt(pos[0]) == '}') break;
      String key = readString(json, pos);
      skipSpace(json, pos);
      pos[0]++; // ':'
      skipSpace(json, pos);
      if (json.charAt(pos[0]) == '"') members.put(key, readString(json, pos));
      else {
        int start = pos[0];
        while (",}".indexOf(json.charAt(pos[0])) < 0) pos[0]++;
        String literal = json.substring(start, pos[0]).trim();
        members.put(key, literal.equals("null") ? null : literal);
      }
      skipSpace(json, pos);
      if (json.charAt(pos[0]) == ',') pos[0]++;
    }
    return members;
  }

  static void skipSpace(String s, int[] pos) {
    while (pos[0] < s.length() && Character.isWhitespace(s.charAt(pos[0]))) pos[0]++;
  }

  static String readString(String s, int[] pos) {
    StringBuilder out = new StringBuilder();
    pos[0]++; // opening quote
    while (s.charAt(pos[0]) != '"') {
      char c = s.charAt(pos[0]++);
      if (c != '\\') {
        out.append(c);
        continue;
      }
      char e = s.charAt(pos[0]++);
      switch (e) {
        case 'n': out.append('\n'); break;
        case 't': out.append('\t'); break;
        case 'r': out.append('\r'); break;
        case 'b': out.append('\b'); break;
        case 'f': out.append('\f'); break;
        case 'u': out.append((char) Integer.parseInt(s.substring(pos[0], pos[0] + 4), 16)); pos[0] += 4; break;
        default: out.append(e);
      }
    }
    pos[0]++; // closing quote
    return out.toString();
  }

  static String shorten(String message) {
    return message.length() > 500 ? message.substring(0, 500) : message;
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 1 || !args[0].equals("apply:bazel")) {
      System.err.println("usage: BazelPatchHost apply:bazel");
      System.exit(2);
    }
    PrintStream out = new PrintStream(System.out, false, "US-ASCII");
    Map<String, Object> hello = new LinkedHashMap<>();
    hello.put("hello", true);
    hello.put("name", "Bazel");
    hello.put("package", "bazel (PatchUtil, the native patch)");
    String commit = commit();
    hello.put("version", "master " + commit.substring(0, Math.min(10, commit.length())));
    hello.put("language", "Java");
    hello.put("homepage", "https://github.com/bazelbuild/bazel/blob/master/src/main/java/com/google/devtools/build/lib/bazel/repository/decompressor/PatchUtil.java");
    hello.put("api", "PatchUtil.apply(patchFile, strip, outputDirectory)");
    hello.put("applies", "tree");
    hello.put("input", "bytes");
    hello.put("notes", "What repository_ctx.patch() calls, and with it the patches of http_archive, git_repository and the "
        + "Bzlmod overrides when no patch_tool is set. PatchUtil.java is Bazel's file at the commit in the version, unchanged; "
        + "the vfs classes Path and FileSystemUtils are stand-ins (adapters/bazel-patch/vfs) that do what Bazel's do on Linux. "
        + "Bazel's build uses java-diff-utils 4.12 and Guava 33.7.2, and so does this one.");
    hello.put("runtime", "java " + System.getProperty("java.version"));
    StringBuilder line = new StringBuilder();
    write(line, hello);
    out.print(line.append('\n'));
    out.flush();

    InputStream in = new BufferedInputStream(System.in);
    ByteArrayOutputStream buffer = new ByteArrayOutputStream();
    for (int b = in.read(); b != -1; b = in.read()) {
      if (b != '\n') { // a line ends with LF and with nothing else
        buffer.write(b);
        continue;
      }
      String text = new String(buffer.toByteArray(), StandardCharsets.UTF_8);
      buffer.reset();
      if (text.trim().isEmpty()) continue;
      Map<String, String> request = readObject(text);
      Map<String, Object> answer = new LinkedHashMap<>();
      answer.put("id", request.get("id"));
      try {
        PatchUtil.apply(Path.of(request.get("path")), Integer.parseInt(request.get("strip")), Path.of(request.get("dir")));
        answer.put("ok", true);
      } catch (Throwable problem) { // also StackOverflowError and the like: a result, not an error of the host
        answer.put("ok", false);
        answer.put("error", shorten(problem.getClass().getSimpleName() + ": " + problem.getMessage()));
      }
      line.setLength(0);
      write(line, answer);
      out.print(line.append('\n'));
      out.flush();
    }
  }
}
