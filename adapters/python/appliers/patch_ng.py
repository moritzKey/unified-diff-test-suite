"""patch-ng: PatchSet.apply() on a directory."""
import patch_ng

META = {
    "name": "patch-ng",
    "package": "patch-ng",
    "language": "Python",
    "homepage": "https://github.com/conan-io/python-patch-ng",
    "api": "fromfile(path).apply(strip=N, root=directory)",
    "applies": "tree",
    "input": "bytes",
    "notes": "patch-ng removes a/ and b/ itself from what it recognises as a git or Mercurial patch "
    "(PatchSet._normalize_filenames); `strip` counts what is left, so it is one less for those.",
}


def apply_tree(diff, directory, strip):
    patchset = patch_ng.fromfile(diff)
    if not patchset:
        raise ValueError("fromfile() returned False: the text was not accepted as a patch")
    already_removed = 1 if patchset.type in (patch_ng.GIT, patch_ng.HG) else 0
    if not patchset.apply(strip=max(strip - already_removed, 0), root=directory):
        raise ValueError("apply() returned False")
