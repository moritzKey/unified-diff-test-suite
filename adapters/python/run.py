#!/usr/bin/env python3
"""Adapter host for Python parsers and appliers. Speaks the protocol in
adapters/PROTOCOL.md:

    python run.py <adapter-name>            a parser,   adapters/<name>.py
    python run.py apply:<applier-name>      an applier, appliers/<name>.py

prints one "hello" JSON line describing the library under test, then answers
one JSON line per request line read from stdin.
"""
import base64
import importlib
import importlib.metadata
import json
import os
import platform
import sys


def jb(value):
    """bytes -> JSON: a string when the bytes are valid UTF-8, else {"base64": ...}."""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    try:
        return value.decode("utf-8")
    except UnicodeDecodeError:
        return {"base64": base64.b64encode(value).decode("ascii")}


def read(path):
    with open(path, "rb") as fh:
        return fh.read()


def as_input(meta, data):
    """Bytes for a library that takes bytes, text for one that takes text."""
    return data if meta.get("input") == "bytes" else data.decode("utf-8")


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: python run.py <adapter-name>")
    sys.path.insert(0, __file__.rsplit("/", 1)[0])
    name = sys.argv[1]
    package = "adapters."
    if name.startswith("apply:"):
        package, name = "appliers.", name[len("apply:"):]
    adapter = importlib.import_module(package + name.replace("-", "_"))
    meta = dict(adapter.META)
    try:
        version = importlib.metadata.version(meta["package"])
    except importlib.metadata.PackageNotFoundError:
        version = None
    extra = adapter.runtime_info() if hasattr(adapter, "runtime_info") else {}
    hello = {"hello": True, **meta, "version": version, "runtime": "python " + platform.python_version(), **extra}
    sys.stdout.write(json.dumps(hello) + "\n")
    sys.stdout.flush()
    home = os.getcwd()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        # Every request starts from the same place: a library that changes the
        # working directory and fails must not take the next request with it.
        os.chdir(home)
        try:
            res = {"id": req["id"], "ok": True}
            if req.get("op") == "apply":
                adapter.apply_tree(req["path"], req["dir"], req["strip"])
            elif req.get("op") == "apply-file":
                old = None if req["old"] is None else as_input(meta, read(req["old"]))
                result = adapter.apply_file(as_input(meta, read(req["path"])), old)
                if result is None:
                    res["absent"] = True
                else:
                    with open(req["out"], "wb") as fh:
                        fh.write(result.encode("utf-8") if isinstance(result, str) else result)
            else:
                res["files"] = adapter.parse(as_input(meta, read(req["path"])), req["path"])
        except BaseException as exc:  # noqa: BLE001 - a crash of the library is a result, not an error of the host
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                raise
            res = {"id": req["id"], "ok": False, "error": (type(exc).__name__ + ": " + str(exc))[:500]}
        sys.stdout.write(json.dumps(res) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
