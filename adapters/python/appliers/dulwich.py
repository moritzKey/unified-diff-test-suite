"""Dulwich: porcelain.apply_patch(), Dulwich's `git apply`, in a repository whose last commit is the old tree."""
import os

from dulwich import porcelain

META = {
    "name": "Dulwich",
    "package": "dulwich",
    "language": "Python",
    "homepage": "https://www.dulwich.io/",
    "api": "porcelain.apply_patch(repo, FILE, strip=N)",
    "applies": "tree",
    "input": "bytes",
    "notes": "apply_patch() needs a repository, so the directory is made one first, with Dulwich itself: "
    "porcelain.init(), add() of every file, commit(). A file that Dulwich cannot add makes that step fail, and the "
    "patch counts as refused. apply_patch() reads git's extended headers itself; strip is passed as for patch -pN. "
    "It applies the sections one after the other, so one that fails can leave the ones before it applied.",
}

_IDENTITY = b"udts <udts@example.invalid>"


def _files(directory):
    root = os.fsencode(directory)
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        if dirpath == root and b".git" in dirnames:
            dirnames.remove(b".git")
        for name in filenames:
            out.append(os.path.join(dirpath, name))
    return out


def apply_tree(diff, directory, strip):
    repo = porcelain.init(directory)
    try:
        files = _files(directory)
        if files:
            porcelain.add(repo, paths=[os.fsdecode(f) for f in files])
        porcelain.commit(repo, message=b"the old tree", author=_IDENTITY, committer=_IDENTITY)
        porcelain.apply_patch(repo, diff, strip=strip)
    finally:
        repo.close()
