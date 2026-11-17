"""The Python reference parser of this project, run through the same door as everybody else."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "reference", "python"))

import udiff_reference as lib  # noqa: E402

META = {
    "name": "reference (Python)",
    "package": "unified-diff-test-suite",
    "language": "Python",
    "homepage": "reference/python/udiff_reference.py",
    "api": "parse_diff(bytes)",
    "input": "bytes",
    "pathStyle": "stripped",
    "statuses": ["added", "deleted", "renamed", "copied"],
    "noNewline": "line",
    "scope": ["git", "git-wrapped", "git-config", "combined", "gnu"],
    "notes": "Prefixes are inferred from the text, as a consumer without inside knowledge has to.",
}


def parse(data, _path):
    result = lib.parse_diff(data)
    if result["errors"]:
        raise ValueError("parse errors: %r" % result["errors"])
    return [lib.to_json(f) for f in result["files"]]
