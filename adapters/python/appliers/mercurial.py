"""Mercurial: hg import --no-commit, in a repository whose last commit is the old tree."""
import os
import subprocess
import sys

# UDTS_HG names another hg; by default the one installed next to this Python.
HG = os.environ.get("UDTS_HG") or os.path.join(os.path.dirname(sys.executable), "hg")

META = {
    "name": "Mercurial",
    "package": "mercurial",
    "language": "Python",
    "homepage": "https://www.mercurial-scm.org/",
    "api": "hg import --no-commit -pN FILE",
    "applies": "tree",
    "input": "bytes",
    "notes": "hg import patches tracked files only, and only in a working directory without changes: the directory "
    "is made a repository first and its files committed (hg init; hg commit -A). A file that hg cannot track (a "
    "name with a newline or a carriage return) makes that step fail, and the patch counts as refused. HGPLAIN=1 "
    "and an empty HGRCPATH keep any configuration out.",
}


def _env(directory):
    return {
        "PATH": os.environ.get("PATH", ""),
        "HOME": directory,
        "HGPLAIN": "1",
        "HGRCPATH": "",
        "HGUSER": "udts",
        "LC_ALL": "C",
        "TZ": "UTC",
    }


def _hg(args, directory, ok=(0,)):
    res = subprocess.run([HG, *args], cwd=directory, env=_env(directory), capture_output=True)
    if res.returncode not in ok:
        said = [l.strip() for l in (res.stderr + b"\n" + res.stdout).decode("utf-8", "replace").splitlines() if l.strip()]
        raise RuntimeError("hg %s: exit %d: %s" % (args[0], res.returncode, " | ".join(said[:3])))


def apply_tree(diff, directory, strip):
    _hg(["init", "--quiet"], directory)
    # Status 1: nothing to commit, the old tree is empty.
    _hg(["commit", "--quiet", "--addremove", "--message", "the old tree", "--date", "0 0"], directory, ok=(0, 1))
    _hg(["import", "--no-commit", "--quiet", "-p", str(strip), diff], directory)
