"""pygit2 - Python bindings for libgit2. This adapter tests libgit2's patch parser
(git_diff_from_buffer), the one behind git2-rs, rugged, LibGit2Sharp and nodegit too."""
import re

import pygit2 as lib

from run import jb

META = {
    "name": "libgit2",
    "package": "pygit2",
    "language": "C (via pygit2)",
    "homepage": "https://github.com/libgit2/libgit2",
    "api": "pygit2.Diff.parse_diff(bytes)  ->  git_diff_from_buffer()",
    "input": "bytes",
    "pathStyle": "stripped",
    "statuses": ["added", "deleted", "renamed", "copied"],
    "noNewline": "line",
    # "a git patch file": the output of git format-patch is the usual one.
    "scope": ["git", "git-wrapped"],
    "notes": 'libgit2: "Read the contents of a git patch file into a git_diff object." '
    "A delta carries the same path on both sides for added and deleted files; "
    "the adapter reports the side that does not exist as absent.",
}

STATUS = {"A": "added", "D": "deleted", "M": "modified", "R": "renamed", "C": "copied", "T": "modified"}
HEADER = re.compile(rb"^@@ [^@]* @@ ?(.*?)\n?$", re.S)


def runtime_info():
    return {"engine": "libgit2 " + lib.LIBGIT2_VERSION}


def mode(value):
    return None if value == 0 else "%06o" % value


def parse(data, _path):
    files = []
    try:
        diff = lib.Diff.parse_diff(data)
    except KeyError as exc:
        # GIT_ENOTFOUND "no patch found": libgit2's documented answer to input without any patch.
        if "no patch found" in str(exc):
            return []
        raise
    for patch in diff:
        delta = patch.delta
        status = delta.status_char()
        hunks = []
        for h in patch.hunks:
            lines = []
            for ln in h.lines:
                if ln.origin in ("=", ">", "<"):
                    # GIT_DIFF_LINE_*_EOFNL: the "\ No newline at end of file" marker.
                    if lines:
                        lines[-1]["no_newline"] = True
                    continue
                body = ln.raw_content
                if body.endswith(b"\n"):
                    body = body[:-1]
                lines.append(
                    {
                        "type": {"+": "add", "-": "delete", " ": "context"}.get(ln.origin, "unknown(%r)" % ln.origin),
                        "text": jb(body),
                        "old_no": None if ln.old_lineno < 0 else ln.old_lineno,
                        "new_no": None if ln.new_lineno < 0 else ln.new_lineno,
                    }
                )
            raw_header = h.header.encode("utf-8", "surrogateescape") if isinstance(h.header, str) else h.header
            m = HEADER.match(raw_header)
            hunks.append(
                {
                    "old_start": h.old_start,
                    "old_lines": h.old_lines,
                    "new_start": h.new_start,
                    "new_lines": h.new_lines,
                    "section": jb(m.group(1)) if m else None,
                    "lines": lines,
                }
            )
        _context, additions, deletions = patch.line_stats
        files.append(
            {
                "old_path": None if status == "A" else jb(delta.old_file.raw_path),
                "new_path": None if status == "D" else jb(delta.new_file.raw_path),
                "status": STATUS.get(status, "unknown(%s)" % status),
                "old_mode": mode(delta.old_file.mode),
                "new_mode": mode(delta.new_file.mode),
                "binary": bool(delta.is_binary),
                "similarity": delta.similarity if status in ("R", "C") else None,
                "additions": None if delta.is_binary else additions,
                "deletions": None if delta.is_binary else deletions,
                "hunks": hunks,
            }
        )
    return files
