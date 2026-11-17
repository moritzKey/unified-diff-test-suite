#!/usr/bin/env python3
"""Check the Python reference parser against the whole corpus, strictly.

    python3 reference/python/check_corpus.py [path/to/corpus]

For every vector the parse must equal the stored expectation exactly, and for
every vector that is a patch (its "apply" field) apply_hunks() /
decode_binary_block() must turn each old file into the new one. Needs nothing
but the standard library.
"""
import base64
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import udiff_reference as ref  # noqa: E402


def from_json(value):
    if value is None:
        return None
    if isinstance(value, str):
        return value.encode("utf-8")
    return base64.b64decode(value["base64"])


def contents(state):
    out = {}
    for f in state["files"]:
        mode = f.get("mode", "100644")
        body = from_json(f["content"])
        if mode == "160000":
            body = b"Subproject commit " + body + b"\n"
        out[from_json(f["path"])] = body
    return out


def main():
    corpus = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "corpus")
    with open(os.path.join(corpus, "index.json"), encoding="utf-8") as fh:
        index = json.load(fh)
    problems = []
    applied = 0
    for entry in index["vectors"]:
        vid = entry["id"]
        with open(os.path.join(corpus, "vectors", vid + ".json"), encoding="utf-8") as fh:
            vector = json.load(fh)
        with open(os.path.join(corpus, "vectors", vid + ".diff"), "rb") as fh:
            data = fh.read()
        result = ref.parse_diff(data)
        if result["errors"]:
            problems.append("%s: parse errors %r" % (vid, result["errors"]))
            continue
        prefixes = (from_json(vector["prefixes"]["old"]), from_json(vector["prefixes"]["new"]))
        got = [ref.to_json(f, prefixes) for f in result["files"]]
        if got != vector["expected"]["files"]:
            problems.append("%s: parse differs from the expectation" % vid)
            continue
        # Vectors that are patches say from which recorded tree to which.
        how = vector["apply"]
        if "skip" in how:
            continue
        states = vector["recipe"]["states"]
        old = contents(states[how["from"]]) if how["from"] is not None else {}
        new = contents(states[how["to"]])
        for f in result["files"]:
            names = ref.resolve_names(f, prefixes)
            before = old.get(names["old_path"], b"") if names["old_path"] is not None else b""
            wanted = new.get(names["new_path"], b"") if names["new_path"] is not None else b""
            try:
                if f["binary"] == "patch":
                    after = ref.decode_binary_block(f["binary_patch"][0], before)
                    if ref.decode_binary_block(f["binary_patch"][1], after) != before:
                        problems.append("%s: reverse binary block is wrong" % vid)
                elif f["binary"]:
                    continue
                else:
                    after = ref.apply_hunks(f["hunks"], before)
            except Exception as exc:  # noqa: BLE001
                problems.append("%s: applying failed: %s" % (vid, exc))
                continue
            applied += 1
            if after != wanted:
                problems.append("%s: applying the hunks does not give the new content of %r" % (vid, names["new_path"]))
    for p in problems:
        print("FAIL", p)
    print("%d vectors parsed, %d file sections applied, %d problem(s)" % (len(index["vectors"]), applied, len(problems)))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
