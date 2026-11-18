"""Dulwich - https://www.dulwich.io/. patch.parse_unified_diff(), the parser behind porcelain.apply_patch()."""
from dulwich.patch import parse_unified_diff

from run import jb

META = {
    "name": "Dulwich",
    "package": "dulwich",
    "language": "Python",
    "homepage": "https://www.dulwich.io/",
    "api": "dulwich.patch.parse_unified_diff(bytes)",
    "input": "bytes",
    "pathStyle": "raw",
    "statuses": ["added", "deleted", "renamed", "copied"],
    "noNewline": "line",
    # The parser of Dulwich's `git apply` (porcelain.apply_patch, since 1.2.0), which is given git diffs.
    "scope": ["git", "git-config"],
    "notes": "Paths come as written, prefixes included, and None for the side that does not exist. A rename or a copy "
    "is a FilePatch with rename_from/rename_to or copy_from/copy_to. Without ---/+++ lines (a pure rename or copy) "
    "old_path and new_path are both None and the names are only in those fields, as git writes them, without "
    "prefixes: the adapter reports them, with path_style 'stripped' for that file. Hunk lines keep their marker, and the "
    "'\\ No newline at end of file' line is kept as a line of its own: the adapter makes it the no_newline flag of "
    "the line before it. No line numbers, numbers of added or deleted lines, or similarity are returned.",
}

TYPES = {b"+": "add", b"-": "delete", b" ": "context"}


def mode(value):
    return None if not value else "%06o" % value


def status(p):
    if p.rename_from is not None:
        return "renamed"
    if p.copy_from is not None:
        return "copied"
    if p.old_path is None:
        return "added"
    if p.new_path is None:
        return "deleted"
    return "modified"


def parse(data, _path):
    files = []
    for p in parse_unified_diff(data):
        hunks = []
        for h in p.hunks:
            lines = []
            for line in h.lines:
                marker, body = line[:1], line[1:]
                if marker == b"\\":
                    if lines:
                        lines[-1]["no_newline"] = True
                    continue
                lines.append({"type": TYPES.get(marker, "unknown(%r)" % marker), "text": jb(body)})
            hunks.append(
                {
                    "old_start": h.old_start,
                    "old_lines": h.old_count,
                    "new_start": h.new_start,
                    "new_lines": h.new_count,
                    "lines": lines,
                }
            )
        entry = {"old_path": jb(p.old_path), "new_path": jb(p.new_path)}
        if p.old_path is None and p.new_path is None:
            # A pure rename or copy: Dulwich keeps the names only on the rename/copy fields.
            if p.rename_from is not None:
                entry = {"old_path": jb(p.rename_from), "new_path": jb(p.rename_to), "path_style": "stripped"}
            elif p.copy_from is not None:
                entry = {"old_path": jb(p.copy_from), "new_path": jb(p.copy_to), "path_style": "stripped"}
        files.append(
            {
                **entry,
                "status": status(p),
                "old_mode": mode(p.old_mode),
                "new_mode": mode(p.new_mode),
                "binary": bool(p.binary),
                "hunks": hunks,
            }
        )
    return files
