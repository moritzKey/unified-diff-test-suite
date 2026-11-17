"""patch-ng - https://github.com/conan-io/python-patch-ng"""
import patch_ng as lib

from run import jb

META = {
    "name": "patch-ng",
    "package": "patch-ng",
    "language": "Python",
    "homepage": "https://github.com/conan-io/python-patch-ng",
    "api": "fromstring(bytes)",
    "input": "bytes",
    # For patches it recognises as git patches the library strips "a/" and "b/";
    # otherwise names are returned as written. Reported per file below.
    "pathStyle": "stripped",
    "statuses": [],
    # "\ No newline" lines stay in the hunk text when they occur in the middle of a hunk, but
    # there is no API that says which line lacks its terminator; not compared.
    "noNewline": "none",
    "scope": ["git", "git-wrapped", "gnu"],
    "notes": 'README: "Library to parse and apply unified diffs." The patch engine of the Conan package manager.',
}

TYPE = {b"+": "add", b"-": "delete", b" ": "context"}


def devnull(name):
    return None if name == b"/dev/null" else name


def parse(data, _path):
    patchset = lib.fromstring(data)
    if patchset is False:
        if not data.strip():
            return []
        raise ValueError("fromstring() returned False (the library could not parse the patch)")
    files = []
    for p in patchset.items:
        hunks = []
        for h in p.hunks:
            lines = []
            for raw in h.text:
                if raw[:1] == b"\\":
                    continue  # "\ No newline at end of file"
                body = raw[1:]
                if body.endswith(b"\n"):
                    body = body[:-1]
                lines.append({"type": TYPE.get(raw[:1], "unknown(%r)" % raw[:1]), "text": jb(body)})
            hunks.append(
                {
                    "old_start": h.startsrc,
                    "old_lines": h.linessrc,
                    "new_start": h.starttgt,
                    "new_lines": h.linestgt,
                    "section": jb(h.desc),
                    "lines": lines,
                }
            )
        files.append(
            {
                "old_path": jb(devnull(p.source)),
                "new_path": jb(devnull(p.target)),
                "path_style": "stripped" if p.type == "git" else "raw",
                "hunks": hunks,
            }
        )
    return files
