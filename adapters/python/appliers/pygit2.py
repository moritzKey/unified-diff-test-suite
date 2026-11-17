"""libgit2 through pygit2: Diff.parse_diff() and Repository.apply() on a working directory."""
import pygit2

META = {
    "name": "libgit2",
    "package": "pygit2",
    "language": "C",
    "homepage": "https://libgit2.org/",
    "api": "Diff.parse_diff, then Repository.apply (git_diff_from_buffer, git_apply)",
    "applies": "tree",
    "input": "bytes",
    # git_diff_from_buffer reads git's own format only.
    "scope": ["git", "git-wrapped", "git-config"],
    "notes": "Applied to the working directory (GIT_APPLY_LOCATION_WORKDIR). git_apply needs a repository: an empty one "
    "is initialised in the directory first; committing the files beforehand makes no difference to the results. "
    "git_diff_from_buffer reads names with one leading component (a/, b/); the adapter declines other vectors.",
}


def runtime_info():
    return {"library_version": pygit2.LIBGIT2_VERSION}


def apply_tree(diff, directory, strip):
    if strip != 1:
        raise ValueError("git_diff_from_buffer has no option for the number of leading path components (-p%d)" % strip)
    repo = pygit2.init_repository(directory)
    with open(diff, "rb") as fh:
        parsed = pygit2.Diff.parse_diff(fh.read())
    repo.apply(parsed, pygit2.enums.ApplyLocation.WORKDIR)
