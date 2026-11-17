"""unidiff - https://github.com/matiasb/python-unidiff"""
import unidiff as lib

META = {
    "name": "unidiff",
    "package": "unidiff",
    "language": "Python",
    "homepage": "https://github.com/matiasb/python-unidiff",
    "api": "PatchSet(text)",
    "input": "string",
    # source_file / target_file are returned as written in the patch, prefix included.
    "pathStyle": "raw",
    "statuses": ["added", "deleted", "renamed"],
    "noNewline": "line",
    "scope": ["git", "git-config", "gnu"],
    "notes": 'README: "Simple Python library to parse and interact with unified diff data."',
}

TYPE = {"+": "add", "-": "delete", " ": "context"}


def devnull(name):
    return None if name == "/dev/null" else name


def parse(text, _path):
    files = []
    for f in lib.PatchSet(text):
        hunks = []
        for h in f:
            lines = []
            for ln in h:
                if ln.line_type == "\\":
                    # "\ No newline at end of file" is delivered as a line of its own.
                    if lines:
                        lines[-1]["no_newline"] = True
                    continue
                value = ln.value[:-1] if ln.value.endswith("\n") else ln.value
                lines.append(
                    {
                        "type": TYPE.get(ln.line_type, "unknown(%r)" % ln.line_type),
                        "text": value,
                        "old_no": ln.source_line_no,
                        "new_no": ln.target_line_no,
                    }
                )
            hunks.append(
                {
                    "old_start": h.source_start,
                    "old_lines": h.source_length,
                    "new_start": h.target_start,
                    "new_lines": h.target_length,
                    "section": h.section_header,
                    "lines": lines,
                }
            )
        status = "added" if f.is_added_file else "deleted" if f.is_removed_file else "renamed" if f.is_rename else "modified"
        files.append(
            {
                "old_path": devnull(f.source_file),
                "new_path": devnull(f.target_file),
                "status": status,
                "binary": bool(f.is_binary_file),
                "additions": f.added,
                "deletions": f.removed,
                "hunks": hunks,
            }
        )
    return files
