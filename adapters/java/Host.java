// Adapter host for Java parsers and appliers. Speaks the protocol in
// adapters/PROTOCOL.md:
//
//   java -cp 'build:lib/*' Host <adapter-name>          a parser
//   java -cp 'build:lib/*' Host apply:<applier-name>    an applier
//
// prints one "hello" JSON line describing the library under test, then answers
// one JSON line per request line read from stdin. Whatever a library throws is
// reported as an error for that request; the process keeps running.
//
// An adapter translates a library's own result into the shape the harness
// compares. It does not repair anything: a wrong value is passed on as it is.

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.PrintStream;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.github.difflib.patch.AbstractDelta;
import com.github.difflib.unifieddiff.UnifiedDiff;
import com.github.difflib.unifieddiff.UnifiedDiffFile;
import com.github.difflib.unifieddiff.UnifiedDiffReader;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.diff.DiffEntry;
import org.eclipse.jgit.lib.FileMode;
import org.eclipse.jgit.patch.CombinedFileHeader;
import org.eclipse.jgit.patch.FileHeader;
import org.eclipse.jgit.patch.FormatError;
import org.eclipse.jgit.patch.HunkHeader;
import org.eclipse.jgit.patch.Patch;

public final class Host {
  interface Parser {
    List<Object> parse(byte[] data) throws Exception;
  }

  interface FileApplier {
    /** The text of one file section and the old content (null: no file) give the new content. */
    byte[] apply(byte[] patch, byte[] old) throws Exception;
  }

  interface TreeApplier {
    /** Apply the diff to the files in the directory; strip is the N of patch -pN. */
    void apply(Path diff, Path dir, int strip) throws Exception;
  }

  // ---- the libraries -------------------------------------------------------------

  static Map<String, Object> meta(Object... pairs) {
    Map<String, Object> m = new LinkedHashMap<>();
    for (int i = 0; i < pairs.length; i += 2) m.put((String) pairs[i], pairs[i + 1]);
    return m;
  }

  /** "/dev/null" is the conventional placeholder for "no file on this side". */
  static Object devnull(String name) {
    return "/dev/null".equals(name) ? null : name == null ? meta("unknown", true) : name;
  }

  // java-diff-utils: UnifiedDiffReader. It turns every hunk into one "delta":
  // the old lines of the hunk and the new lines of the hunk, context included,
  // each with a zero-based position, plus the numbers of the lines that changed.
  // That gives the sizes of a hunk and the counts of deleted and added lines.
  // The start is the position plus one; for a side without lines the library
  // stores 0 both for "-0,0" and for "-1,0", so no start is reported there.
  static final Map<String, Object> JAVA_DIFF_UTILS = meta(
      "name", "java-diff-utils",
      "package", "io.github.java-diff-utils:java-diff-utils",
      "version", "4.18",
      "homepage", "https://github.com/java-diff-utils/java-diff-utils",
      "api", "UnifiedDiffReader.parseUnifiedDiff(InputStream)",
      "input", "string",
      "pathStyle", "stripped",
      "statuses", List.of("added", "deleted", "renamed", "copied"),
      // isNoNewLineAtTheEndOfTheFile() is one flag per file; it does not say which side it is about.
      "noNewline", "none",
      "scope", List.of("git", "gnu"),
      "notes", "The reader decodes its input as text and removes a/ and b/ itself. A hunk is one delta in its model; the lines of a hunk are not reported one by one.");

  static List<Object> javaDiffUtils(byte[] data) throws Exception {
    UnifiedDiff diff = UnifiedDiffReader.parseUnifiedDiff(new ByteArrayInputStream(data));
    List<Object> files = new ArrayList<>();
    for (UnifiedDiffFile f : diff.getFiles()) {
      Map<String, Object> m = new LinkedHashMap<>();
      String status = f.getRenameFrom() != null ? "renamed"
          : f.getCopyFrom() != null ? "copied"
          : f.getNewFileMode() != null ? "added"
          : f.getDeletedFileMode() != null ? "deleted" : "modified";
      m.put("status", status);
      m.put("old_path", devnull(f.getFromFile()));
      m.put("new_path", devnull(f.getToFile()));
      m.put("old_mode", f.getOldMode() != null ? f.getOldMode() : f.getDeletedFileMode());
      m.put("new_mode", f.getNewMode() != null ? f.getNewMode() : f.getNewFileMode());
      if (f.getSimilarityIndex() != null) m.put("similarity", f.getSimilarityIndex());
      m.put("binary", f.getBinaryAdded() != null || f.getBinaryDeleted() != null || f.getBinaryEdited() != null);
      int additions = 0;
      int deletions = 0;
      List<Object> hunks = new ArrayList<>();
      if (f.getPatch() != null) {
        for (AbstractDelta<String> delta : f.getPatch().getDeltas()) {
          Map<String, Object> hunk = new LinkedHashMap<>();
          if (delta.getSource().size() > 0) hunk.put("old_start", delta.getSource().getPosition() + 1);
          hunk.put("old_lines", delta.getSource().size());
          if (delta.getTarget().size() > 0) hunk.put("new_start", delta.getTarget().getPosition() + 1);
          hunk.put("new_lines", delta.getTarget().size());
          hunks.add(hunk);
          if (delta.getSource().getChangePosition() != null) deletions += delta.getSource().getChangePosition().size();
          if (delta.getTarget().getChangePosition() != null) additions += delta.getTarget().getChangePosition().size();
        }
      }
      m.put("additions", additions);
      m.put("deletions", deletions);
      m.put("hunks", hunks);
      files.add(m);
    }
    return files;
  }

  static final Map<String, Object> JAVA_DIFF_UTILS_APPLY = meta(
      "name", "java-diff-utils",
      "package", "io.github.java-diff-utils:java-diff-utils",
      "version", "4.18",
      "homepage", "https://github.com/java-diff-utils/java-diff-utils",
      "api", "UnifiedDiffReader.parseUnifiedDiff(stream).getFiles().get(0).getPatch().applyTo(lines)",
      "applies", "file",
      "input", "string",
      // applyTo() takes and returns a list of lines.
      "eofNewline", false,
      "notes", "The old text is cut into lines the way the reader cuts the patch (BufferedReader.readLine), and the lines that come back are joined with LF.");

  static byte[] javaDiffUtilsApply(byte[] patch, byte[] old) throws Exception {
    UnifiedDiff diff = UnifiedDiffReader.parseUnifiedDiff(new ByteArrayInputStream(patch));
    if (diff.getFiles().size() != 1) {
      throw new IllegalStateException("parseUnifiedDiff found " + diff.getFiles().size() + " files in the text of one file section");
    }
    List<String> lines = new ArrayList<>();
    if (old != null) {
      BufferedReader reader = new BufferedReader(new StringReader(new String(old, StandardCharsets.UTF_8)));
      for (String line = reader.readLine(); line != null; line = reader.readLine()) lines.add(line);
    }
    List<String> result = diff.getFiles().get(0).getPatch().applyTo(lines);
    return String.join("\n", result).getBytes(StandardCharsets.UTF_8);
  }

  // io.reflectoring.diffparser
  static final Map<String, Object> DIFFPARSER = meta(
      "name", "diffparser (Java)",
      "package", "io.reflectoring.diffparser:diffparser",
      "version", "1.4",
      "homepage", "https://github.com/thombergs/diffparser",
      "api", "new UnifiedDiffParser().parse(byte[])",
      "input", "string",
      "pathStyle", "raw",
      "statuses", List.of(),
      "noNewline", "none",
      "scope", List.of("git", "gnu"),
      "notes", "\"Parse unified diffs with Java\". The parser decodes its input as text.");

  static List<Object> diffparser(byte[] data) {
    List<Object> files = new ArrayList<>();
    for (io.reflectoring.diffparser.api.model.Diff d : new io.reflectoring.diffparser.api.UnifiedDiffParser().parse(data)) {
      List<Object> hunks = new ArrayList<>();
      for (io.reflectoring.diffparser.api.model.Hunk h : d.getHunks()) {
        List<Object> lines = new ArrayList<>();
        for (io.reflectoring.diffparser.api.model.Line line : h.getLines()) {
          String type;
          switch (line.getLineType()) {
            case FROM: type = "delete"; break;
            case TO: type = "add"; break;
            case NEUTRAL: type = "context"; break;
            default: type = "unknown(" + line.getLineType() + ")";
          }
          // The library removes the marker from deleted and added lines and
          // leaves the leading space on context lines.
          String content = line.getContent();
          if (type.equals("context") && content.startsWith(" ")) content = content.substring(1);
          lines.add(meta("type", type, "text", content));
        }
        Map<String, Object> hunk = new LinkedHashMap<>();
        if (h.getFromFileRange() != null) {
          hunk.put("old_start", h.getFromFileRange().getLineStart());
          hunk.put("old_lines", h.getFromFileRange().getLineCount());
        }
        if (h.getToFileRange() != null) {
          hunk.put("new_start", h.getToFileRange().getLineStart());
          hunk.put("new_lines", h.getToFileRange().getLineCount());
        }
        hunk.put("lines", lines);
        hunks.add(hunk);
      }
      files.add(meta("old_path", devnull(d.getFromFileName()), "new_path", devnull(d.getToFileName()), "hunks", hunks));
    }
    return files;
  }

  // JGit: org.eclipse.jgit.patch.Patch, the parser behind ApplyCommand. A file is
  // a FileHeader (a DiffEntry: paths, modes, change type, score) with HunkHeaders
  // that carry the numbers of the hunk header and the counts of the lines in it;
  // the lines themselves stay in the buffer and are not part of the model.
  static final String JGIT_VERSION = "7.8.1.202611041320-r";

  static final Map<String, Object> JGIT = meta(
      "name", "JGit",
      "package", "org.eclipse.jgit:org.eclipse.jgit",
      "version", JGIT_VERSION,
      "homepage", "https://github.com/eclipse-jgit/jgit",
      "api", "new Patch().parse(InputStream), then getFiles() and getErrors()",
      "input", "bytes",
      // DiffEntry.getOldPath() and getNewPath() are Strings.
      "names", "text",
      "pathStyle", "stripped",
      "statuses", List.of("added", "deleted", "renamed", "copied"),
      "noNewline", "none",
      "scope", List.of("git", "git-wrapped", "combined", "gnu"),
      "notes", "\"A parsed collection of FileHeaders from a unified diff patch file\"; the parser knows diff --git, diff --cc and "
          + "plain ---/+++ sections and passes over other text. It does not throw: problems are collected in getErrors(). "
          + "An entry of severity ERROR is reported here as the failure of the request, as ApplyCommand does with any entry; warnings are not.");

  static Object jgitMode(FileMode mode) {
    return mode == null || mode == FileMode.MISSING ? null : String.format("%06o", mode.getBits());
  }

  static List<Object> jgit(byte[] data) throws Exception {
    Patch patch = new Patch();
    patch.parse(new ByteArrayInputStream(data));
    for (FormatError e : patch.getErrors()) {
      if (e.getSeverity() == FormatError.Severity.ERROR) throw new IllegalStateException("getErrors(): " + e.getMessage() + " at \"" + e.getLineText().trim() + "\"");
    }
    List<Object> files = new ArrayList<>();
    for (FileHeader fh : patch.getFiles()) {
      Map<String, Object> m = new LinkedHashMap<>();
      List<Object> hunks = new ArrayList<>();
      if (fh instanceof CombinedFileHeader) {
        m.put("combined", true);
        // One name per file: the new one, or the old one when the merge deleted the file.
        m.put("path", DiffEntry.DEV_NULL.equals(fh.getNewPath()) ? fh.getOldPath() : fh.getNewPath());
        for (int i = 0; i < fh.getHunks().size(); i++) hunks.add(meta());
        m.put("hunks", hunks);
        files.add(m);
        continue;
      }
      DiffEntry.ChangeType type = fh.getChangeType();
      m.put("status", type == DiffEntry.ChangeType.ADD ? "added"
          : type == DiffEntry.ChangeType.DELETE ? "deleted"
          : type == DiffEntry.ChangeType.RENAME ? "renamed"
          : type == DiffEntry.ChangeType.COPY ? "copied" : "modified");
      m.put("old_path", devnull(fh.getOldPath()));
      m.put("new_path", devnull(fh.getNewPath()));
      // No mode header and no mode on the index line: the fields are null. For a
      // file that does not exist on one side the library stores FileMode.MISSING.
      if (fh.getOldMode() != null) m.put("old_mode", jgitMode(fh.getOldMode()));
      if (fh.getNewMode() != null) m.put("new_mode", jgitMode(fh.getNewMode()));
      if (type == DiffEntry.ChangeType.RENAME || type == DiffEntry.ChangeType.COPY) m.put("similarity", fh.getScore());
      m.put("binary", fh.getPatchType() != FileHeader.PatchType.UNIFIED);
      int additions = 0;
      int deletions = 0;
      for (HunkHeader h : fh.getHunks()) {
        hunks.add(meta(
            "old_start", h.getOldImage().getStartLine(),
            "old_lines", h.getOldImage().getLineCount(),
            "new_start", h.getNewStartLine(),
            "new_lines", h.getNewLineCount()));
        additions += h.getOldImage().getLinesAdded();
        deletions += h.getOldImage().getLinesDeleted();
      }
      m.put("additions", additions);
      m.put("deletions", deletions);
      m.put("hunks", hunks);
      files.add(m);
    }
    return files;
  }

  static final Map<String, Object> JGIT_APPLY = meta(
      "name", "JGit",
      "package", "org.eclipse.jgit:org.eclipse.jgit",
      "version", JGIT_VERSION,
      "homepage", "https://github.com/eclipse-jgit/jgit",
      "api", "Git.apply().setPatch(stream).call()",
      "applies", "tree",
      "input", "bytes",
      "notes", "ApplyCommand (PatchApplier underneath) works on the working tree of a repository: an empty one is initialised in the "
          + "directory first (Git.init). It reads names with one leading component (a/, b/); the adapter declines other vectors.");

  static void jgitApply(Path diff, Path dir, int strip) throws Exception {
    if (strip != 1) throw new IllegalArgumentException("ApplyCommand has no option for the number of leading path components (-p" + strip + ")");
    try (Git git = Git.init().setDirectory(dir.toFile()).call(); InputStream in = Files.newInputStream(diff)) {
      git.apply().setPatch(in).call();
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

  // ---- the host -----------------------------------------------------------------

  static String shorten(String message) {
    return message.length() > 500 ? message.substring(0, 500) : message;
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 1) {
      System.err.println("usage: Host <adapter-name> | apply:<applier-name>");
      System.exit(2);
    }
    Map<String, Object> about = null;
    Parser parser = null;
    FileApplier applier = null;
    TreeApplier treeApplier = null;
    switch (args[0]) {
      case "java-diff-utils": about = JAVA_DIFF_UTILS; parser = Host::javaDiffUtils; break;
      case "diffparser": about = DIFFPARSER; parser = Host::diffparser; break;
      case "apply:java-diff-utils": about = JAVA_DIFF_UTILS_APPLY; applier = Host::javaDiffUtilsApply; break;
      case "jgit": about = JGIT; parser = Host::jgit; break;
      case "apply:jgit": about = JGIT_APPLY; treeApplier = Host::jgitApply; break;
      default:
        System.err.println("unknown adapter " + args[0]);
        System.exit(2);
    }
    PrintStream out = new PrintStream(System.out, false, "US-ASCII");
    Map<String, Object> hello = new LinkedHashMap<>();
    hello.put("hello", true);
    hello.put("language", "Java");
    hello.put("runtime", "java " + System.getProperty("java.version"));
    hello.putAll(about);
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
        if (treeApplier != null) {
          treeApplier.apply(Paths.get(request.get("path")), Paths.get(request.get("dir")), Integer.parseInt(request.get("strip")));
          answer.put("ok", true);
          line.setLength(0);
          write(line, answer);
          out.print(line.append('\n'));
          out.flush();
          continue;
        }
        byte[] data = Files.readAllBytes(Paths.get(request.get("path")));
        if (applier != null) {
          String oldPath = request.get("old");
          byte[] old = oldPath == null ? null : Files.readAllBytes(Paths.get(oldPath));
          Files.write(Paths.get(request.get("out")), applier.apply(data, old));
          answer.put("ok", true);
        } else {
          List<Object> files = parser.parse(data);
          answer.put("ok", true);
          answer.put("files", files);
        }
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
