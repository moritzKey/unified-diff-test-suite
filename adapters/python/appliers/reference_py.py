"""The Python reference of this project as an applier, one file at a time."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "reference", "python"))

import udiff_reference as lib  # noqa: E402

META = {
    "name": "reference, one file (Python)",
    "package": "unified-diff-test-suite",
    "language": "Python",
    "homepage": "reference/python/udiff_reference.py",
    "api": "apply_hunks(parse_diff(diff)['files'][0]['hunks'], old)",
    "applies": "file",
    "input": "bytes",
    "binary": True,
}


def apply_file(diff, old):
    result = lib.parse_diff(diff)
    if result["errors"]:
        raise ValueError("parse errors: %r" % result["errors"])
    if len(result["files"]) != 1:
        raise ValueError("expected one file section, found %d" % len(result["files"]))
    section = result["files"][0]
    before = old if old is not None else b""
    if section["binary"] == "patch":
        return lib.decode_binary_block(section["binary_patch"][0], before)
    if section["binary"]:
        raise ValueError("binary files differ and the diff does not carry their content")
    return lib.apply_hunks(section["hunks"], before)
