"""whatthepatch: apply_diff(), one file at a time, in pure Python."""
import whatthepatch

META = {
    "name": "whatthepatch",
    "package": "whatthepatch",
    "language": "Python",
    "homepage": "https://github.com/cscorley/whatthepatch",
    "api": "apply_diff(diff, old_text)  with diff from parse_patch(text)",
    "applies": "file",
    "input": "string",
    # apply_diff() returns a list of lines. Whether the last line ends with a
    # newline is not part of its answer, so that is not compared.
    "eofNewline": False,
    "notes": "The pure-Python path (use_patch=False, the default). The lines it returns are joined with LF, "
    "as the library does itself where it writes them out (apply.py).",
}


def apply_file(diff, old):
    diffs = list(whatthepatch.parse_patch(diff))
    if len(diffs) != 1:
        raise ValueError("parse_patch() found %d diffs in the text of one file section" % len(diffs))
    return "\n".join(whatthepatch.apply_diff(diffs[0], old if old is not None else ""))
