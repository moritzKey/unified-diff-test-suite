"""GitPython - https://github.com/gitpython-developers/GitPython

GitPython does not parse hunks, but it does parse the headers of `git diff -p`
output into Diff objects (paths, modes, new/deleted/renamed flags). That code,
Diff._index_from_patch_format, is what runs behind commit.diff(create_patch=True).
It reads from a process, so the adapter hands it a real process that prints the
vector."""
import atexit
import shutil
import tempfile

import git
from git.diff import Diff

from run import jb

META = {
    "name": "GitPython",
    "package": "GitPython",
    "language": "Python",
    "homepage": "https://github.com/gitpython-developers/GitPython",
    "api": "Diff._index_from_patch_format(repo, process)   (behind commit.diff(create_patch=True))",
    "input": "bytes",
    "pathStyle": "stripped",
    "statuses": ["added", "deleted", "renamed", "copied"],
    "noNewline": "none",
    "scope": ["git"],
    "notes": "Parses file headers only; the hunks stay unparsed in Diff.diff.",
}

_tmp = tempfile.mkdtemp(prefix="udts-gitpython-")
atexit.register(shutil.rmtree, _tmp, True)
_repo = git.Repo.init(_tmp)


def mode(value):
    return None if value is None else "%06o" % value


def parse(_data, path):
    # A genuine child process, wrapped the way GitPython wraps `git diff` itself.
    proc = _repo.git.execute(["cat", path], as_process=True)
    files = []
    for d in Diff._index_from_patch_format(_repo, proc):
        status = (
            "added" if d.new_file else "deleted" if d.deleted_file else "renamed" if d.renamed_file else "copied" if d.copied_file else "modified"
        )
        files.append(
            {
                "old_path": None if d.new_file else jb(d.a_rawpath),
                "new_path": None if d.deleted_file else jb(d.b_rawpath),
                "status": status,
                # For a new file GitPython fills a_mode from the new mode (and vice versa); the mode of
                # a side that does not exist is not compared.
                "old_mode": None if d.new_file else mode(d.a_mode),
                "new_mode": None if d.deleted_file else mode(d.b_mode),
            }
        )
    return files
