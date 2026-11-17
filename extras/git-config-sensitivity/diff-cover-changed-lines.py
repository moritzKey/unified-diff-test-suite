#!/usr/bin/env python3
"""Which lines does diff-cover think changed - whatever the git configuration is?

    pip install diff-cover
    python diff-cover-changed-lines.py

Builds a throw-away repository with seven files whose names are awkward in
different ways, changes line 3 and inserts a line 8 in each on a branch, and
asks diff-cover's GitDiffReporter for the changed lines under four git
configurations. diff-cover pins the format of the diff it asks git for, so the
answer should not depend on the configuration.
"""
import inspect, os, subprocess, sys, tempfile
from diff_cover.diff_reporter import GitDiffReporter
from diff_cover.git_diff import GitDiffTool

ENV = dict(os.environ, GIT_CONFIG_NOSYSTEM="1", GIT_AUTHOR_NAME="a", GIT_AUTHOR_EMAIL="a@example.com", GIT_COMMITTER_NAME="a", GIT_COMMITTER_EMAIL="a@example.com")
FILES = ["pkg/plain.py", "my pkg/my mod.py", "pkg/größe.py", "pkg/tab\there.py", 'pkg/quo"te.py', "a b/c.py", "pkg/café au lait.py"]

def git(*args):
    subprocess.run(["git", *args], check=True, capture_output=True, env=ENV)

def main(config_line):
    with tempfile.TemporaryDirectory() as work:
        cfg = os.path.join(work, "gitconfig")
        open(cfg, "w").write(config_line + "\n")
        ENV["GIT_CONFIG_GLOBAL"] = cfg; os.environ.update(ENV); os.environ["HOME"] = work
        repo = os.path.join(work, "repo"); os.mkdir(repo); os.chdir(repo)
        git("init", "-q", "-b", "main")
        for f in FILES:
            os.makedirs(os.path.dirname(f), exist_ok=True)
            open(f, "w").write("".join("line%d = %d\n" % (i, i) for i in range(1, 11)))
        git("add", "-A"); git("commit", "-q", "-m", "base")
        git("checkout", "-q", "-b", "feature")
        for f in FILES:
            lines = open(f).read().splitlines(True)
            lines[2] = "line3 = 'changed'\n"          # line 3 replaced
            lines.insert(7, "inserted = True\n")      # new line 8
            open(f, "w").write("".join(lines))
        git("add", "-A"); git("commit", "-q", "-m", "change")
        sig = inspect.signature(GitDiffTool.__init__).parameters
        tool = GitDiffTool(**{k: v for k, v in dict(range_notation="...", ignore_whitespace=False).items() if k in sig})
        reporter = GitDiffReporter("main", git_diff=tool, supported_extensions=["py"])
        paths = reporter.src_paths_changed()
        ok = 0
        for f in FILES:
            got = reporter.lines_changed(f) if f in paths else None
            good = got == [3, 8]
            ok += good
            if not good:
                print("   %-28r -> %s" % (f, "not reported as changed" if got is None else got))
        extra = [p for p in paths if p not in FILES]
        print("%-28s %d/%d files with the right changed lines%s" % (config_line or "(default)", ok, len(FILES), ("; unexpected paths: %r" % extra) if extra else ""))

for cfg in ["", "[diff]\n\tnoprefix = true", "[color]\n\tui = always", "[core]\n\tquotePath = false"]:
    main(cfg)
