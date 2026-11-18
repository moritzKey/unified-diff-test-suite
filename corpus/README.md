# The corpus

```
index.json                 every vector: id, tier, title, tags
vectors/<id>.diff          the diff, byte for byte as the tool wrote it
vectors/<id>.json          what it means, where it came from, how to make it again
```

The `.diff` files are data, not text: several contain carriage returns, form
feeds, NUL bytes or bytes that are not valid UTF-8. Read them as bytes. The
`.gitattributes` in this directory keeps git from touching their line endings
(with `core.autocrlf`, the default of Git for Windows, a checkout would
otherwise rewrite most of them); take it along when you copy the corpus.

## A vector

```jsonc
{
  "id": "git/content/deleted-double-dash-comment",
  "title": "Deleting a \"-- comment\" line (SQL, Lua, Haskell, Ada) yields \"--- comment\"",
  "description": "…why this is a trap…",
  "tier": "git",                       // git | git-wrapped | git-config | combined | gnu
  "tags": ["content-lookalike", "fake-file-header"],
  "producer": {                        // the real tool invocation that wrote the .diff
    "tool": "git", "version": "2.43.0",
    "argv": ["git", "diff", "<state0>", "<state1>"],
    "config": {}
  },
  "prefixes": { "old": "a/", "new": "b/" },   // what the tool put in front of the paths
  "verified": {                        // how the expectations were established
    "replay": true,                    //   applying the hunks to the old content gives the new content
    "git_raw_numstat": true,           //   files, modes, ids, counts agree with git diff --raw / --numstat
    "git_apply_numstat": true          //   git's own patch reader sees the same files and counts
  },
  "text": {
    "diff_is_utf8": true,              // false: the diff cannot be given to a text API
    "names_are_utf8": true,            // false: a file name is not valid UTF-8
    "paths_inferable": true            // false: the prefixes cannot be worked out from the text
  },
  "expected": { "files": [ /* see below */ ] },
  "apply": { "from": 0, "to": 1, "strip": 1, "modes": true },   // see "Applying"
  "recipe": { /* the file trees and the invocation, enough to produce the diff again */ }
}
```

### expected.files[]

One object per file section of the diff, in order.

| field | meaning |
| --- | --- |
| `status` | `added`, `deleted`, `modified`, `renamed`, `copied`; `null` in the `gnu` tier, where the text does not say |
| `old_name`, `new_name` | the name as the diff spells it, unquoted, prefix included (`a/src/x.c`); `null` on the side where no file exists |
| `old_path`, `new_path` | the path in the repository (`src/x.c`); `null` on the side where no file exists |
| `old_mode`, `new_mode` | `"100644"`, `"100755"`, `"120000"` (symlink), `"160000"` (submodule); `null` when the diff does not say |
| `similarity` | percentage for renames and copies, else `null` |
| `binary` | `false`, `"notice"` (`Binary files … differ`) or `"patch"` (`GIT binary patch`) |
| `additions`, `deletions` | number of `+` and `-` lines; `null` for binary sections |
| `hunks[]` | `old_start`, `old_lines`, `new_start`, `new_lines`, `section`, `lines[]` |
| `hunks[].lines[]` | `type` (`context`, `add`, `delete`), `text`, `old_no`, `new_no`, and `no_newline: true` when the line is followed by `\ No newline at end of file` |

`old_start` and `new_start` are the numbers in the hunk header, unchanged: when
a count is zero the start names the line *before* the change.

`text`, names and `section` are JSON strings when the bytes are valid UTF-8 and
`{"base64": "…"}` otherwise. `text` never includes the line terminator; a
carriage return at the end of a line of a CRLF file is part of `text`.

A type change (file ↔ symlink ↔ submodule) appears as two sections for the same
path, a deletion and an addition, because that is how git writes it.

### Combined diffs

In the `combined` tier a file object has `"combined": true`, a `path`, the
number of `parents`, and hunks with `parent_ranges` (one `{start, lines}` per
parent), `new_start`, `new_lines` and lines of the form
`{"markers": "+ ", "text": "…"}` — one marker character per parent.

## Applying

214 of the vectors are patches in the plain sense, and say so:

```jsonc
"apply": { "from": 0, "to": 1, "strip": 1, "modes": true }
```

Applied to the tree `recipe.states[from]`, the diff must give exactly the tree
`recipe.states[to]`. `from` is `null` when the diff starts from nothing (the
first commit of a repository). `strip` is the number of leading path components
that the names in the diff carry, the `N` of `patch -pN`: 1 for `a/` and `b/`,
0 for `--no-prefix`. `modes` is `false` for GNU diff, which does not record
file modes; compare contents only.

A state is a list of files:

```jsonc
{ "path": "bin/tool", "content": "#!/bin/sh\n", "mode": "100755" }
```

`path` and `content` are strings, or `{"base64": "…"}` for bytes that are not
valid UTF-8. `mode` is left out for an ordinary file (`100644`); `120000` is a
symbolic link whose target is `content`.

The other 38 vectors carry a reason instead — `"apply": { "skip": "a combined
diff describes a merge, it is not a patch" }`. They are diffs that no program
can be expected to apply: merges, several commits in one text, a binary change
without its data, submodules, an empty diff, `-D`, `--relative`, names that are
labels or carry a prefix that is not a directory, and a GNU diff that does not
mention every difference.

```python
import base64

def raw(value):                      # a string, or {"base64": ...} for other bytes
    return value.encode() if isinstance(value, str) else base64.b64decode(value["base64"])

def tree(state):                     # path -> (mode, content), all bytes
    return {raw(f["path"]): (f.get("mode", "100644"), raw(f["content"])) for f in state["files"]}

how = vector["apply"]
if "skip" not in how:
    states = vector["recipe"]["states"]
    before = tree(states[how["from"]]) if how["from"] is not None else {}
    after = tree(states[how["to"]])
    # write `before` to a directory, run your program on <id>.diff there with -p<how["strip"]>,
    # read the directory back and compare it with `after`
```

[`APPLY.md`](../APPLY.md) shows what twenty-one programs make of them.

## Tiers

| tier | what it contains |
| --- | --- |
| `git` | output of `git diff` with git's default naming (`a/`, `b/`, quoted paths). Any option that does not change the naming may be in use: `-U0`, `-M`, `-C`, `-B`, `--binary`, `--full-index`, … Nothing but file sections. |
| `git-wrapped` | the same with text around the patch: the commit header of `git show` and `git log -p`, the mail of `git format-patch`, the statistics of `--stat` and `--summary`. All of them carry the tag `prelude`. |
| `git-config` | the same, named differently: `--no-prefix`, `diff.mnemonicPrefix`, `--src-prefix`/`--dst-prefix`, `-R`, `core.quotePath=false`, `--relative` |
| `combined` | merge commits (`git show <merge>`, `-c`, `--cc`) |
| `gnu` | GNU diffutils, `diff -u` and `diff -ruN` |

## Reproducing

`node src/generate.js --check` rebuilds every vector from its recipe and
compares it with the stored one. With a different version of git or diffutils
the output may legitimately differ; the check tells you where.

## Licence

The corpus (everything under `corpus/`) is dedicated to the public domain under
CC0 1.0. Copy it into your test-suite.
