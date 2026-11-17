"""whatthepatch - https://github.com/cscorley/whatthepatch"""
import whatthepatch as lib

META = {
    "name": "whatthepatch",
    "package": "whatthepatch",
    "language": "Python",
    "homepage": "https://github.com/cscorley/whatthepatch",
    "api": "parse_patch(text)",
    "input": "string",
    "pathStyle": "stripped",
    "statuses": [],
    # Changes carry line numbers and the index of their hunk, but neither hunk ranges nor
    # "\ No newline" information.
    "noNewline": "none",
    # "parsing and applying patch files": patch files usually are mails.
    "scope": ["git", "git-wrapped", "git-config", "gnu"],
    "notes": 'README: "What The Patch!? is a library for both parsing and applying patch files."',
}


def devnull(name):
    return None if name == "/dev/null" else name


def parse(text, _path):
    files = []
    for d in lib.parse_patch(text):
        hunks = []
        current = None
        changes = d.changes or []
        if any(isinstance(ch.line, bytes) or isinstance(ch.hunk, bytes) for ch in changes):
            # A "GIT binary patch": the library decodes it and returns the file contents as bytes.
            entry = {"binary": True, "hunks": []}
            if d.header is not None:
                entry["old_path"] = devnull(d.header.old_path)
                entry["new_path"] = devnull(d.header.new_path)
            files.append(entry)
            continue
        for ch in changes:
            if current is None or ch.hunk != current["_hunk"]:
                current = {"_hunk": ch.hunk, "lines": []}
                hunks.append(current)
            kind = "add" if ch.old is None else "delete" if ch.new is None else "context"
            current["lines"].append({"type": kind, "text": ch.line, "old_no": ch.old, "new_no": ch.new})
        for h in hunks:
            del h["_hunk"]
        entry = {"hunks": hunks}
        if d.header is not None:
            entry["old_path"] = devnull(d.header.old_path)
            entry["new_path"] = devnull(d.header.new_path)
        files.append(entry)
    return files
