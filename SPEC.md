# Reading diffs

What git and GNU diff actually write, in the detail a parser needs. Nothing
here is taken on trust: each statement is backed by vectors in `corpus/`, which
were produced by the real tools and checked against the file contents they
compared. Vector ids are given in `code font`.

The official descriptions are `git help diff` ("Generating patch text with -p")
and the GNU diffutils manual ("Unified Format"). This document is about the
parts they leave to the reader.

- [The one rule](#the-one-rule)
- [Lines](#lines)
- [Hunks](#hunks)
- [File sections](#file-sections)
- [Names](#names)
- [Sections without hunks](#sections-without-hunks)
- [Binary files](#binary-files)
- [Text around the patch](#text-around-the-patch)
- [Combined diffs](#combined-diffs)
- [GNU diff](#gnu-diff)
- [Asking git for a diff you can parse](#asking-git-for-a-diff-you-can-parse)
- [Applying a diff](#applying-a-diff)
- [A checklist](#a-checklist)

## The one rule

**Count.** A hunk header announces how many lines follow:

```
@@ -3,7 +3,8 @@
```

Seven lines of the old file, eight of the new. Read lines until both counts are
used up — a line starting with a space uses one of each, `-` one old, `+` one
new — and you know exactly where the hunk ends. Inside it, every line is
content, whatever it looks like.

The alternative, reading "until something that looks like a header", fails on
ordinary input. A diff line is a marker character followed by the file's line,
so a deleted SQL comment

```
-- speed up lookups
```

is spelled

```
--- speed up lookups
```

and an added line `++ " world"` is spelled `+++ " world"`. With `-U0` a real
hunk header can follow directly, giving three lines in the middle of one file
that are indistinguishable from the start of another:

```
@@ -3 +3 @@
--- a/secrets.env
+++ b/secrets.env
@@ -7 +7 @@
-password = "old"
+password = "new"
```

`git/content/fake-header-pair-before-next-hunk`. Only the count in `@@ -3 +3 @@`
(one old line, one new line) says that the two lines after it are content.
The other vectors under `git/content/` vary the theme: diffs of patch files,
lines that read `diff --git a/x b/x`, lines that read like extended headers.

## Lines

- A diff is bytes. File contents and file names can be in any encoding or none
  (`git/bytes/latin1-content`, `git/paths/latin1-name`).
- Lines end at LF, and only at LF. A carriage return before the LF is the last
  byte of the content of a line of a CRLF file (`git/bytes/crlf-file-modified`).
  A lone CR, a form feed, a vertical tab, U+0085, U+2028 and U+2029 are ordinary
  content (`git/bytes/lone-cr-inside-line`, `git/bytes/form-feed`,
  `git/bytes/unicode-line-separators`). Beware of library functions that split
  "lines": Python's `str.splitlines()` splits at ten different characters,
  and `.` in a JavaScript regular expression does not match four of them.
- Do not trim. Leading and trailing whitespace is content, and a line may
  consist of nothing but its marker: adding an empty line gives a bare `+`
  (`git/basics/blank-added-and-deleted-lines`).

## Hunks

```
@@ -<old start>[,<old count>] +<new start>[,<new count>] @@[ <section>]
```

- **A count of 1 is omitted.** `@@ -1 +1 @@` means `-1,1 +1,1`
  (`git/basics/single-line-file`). An omitted count is 1, never 0.
- **A count can be 0**, and then the start is the line *before* the change — 0
  at the top of the file — because there is no line on that side to name:
  `@@ -5,0 +6,2 @@` inserts two lines after old line 5 (`git/ranges/u0-insert`).
  New and deleted files read `-0,0` and `+0,0`, but so do an existing empty
  file that receives content and a file that is emptied without being deleted
  (`git/ranges/filled-empty-file`, `git/ranges/emptied-file`). Whether a file is
  new is said by `new file mode` and `/dev/null`, not by the numbers.
- **The section** is a line of the file that git guesses to be the enclosing
  function. It is free text: it can contain `@@`, a carriage return, or
  anything else but LF (`git/content/section-heading-contains-hunk-header`,
  `git/content/section-heading-with-control-characters`). Take the header apart
  from the left.
- **`\ No newline at end of file`** is not a line of the file. It says that the
  line directly above it has no terminator. It can follow a `-` line, a `+`
  line or a context line, and it can stand in the middle of a hunk when lines
  are appended to a file that lacked a final newline
  (`git/newline/marker-mid-hunk`). It never counts towards the header's
  numbers. Recognise it by its first character, a backslash, not by its text:
  GNU diff prints the text in the user's language. (git's own reader asks only
  for a line of at least twelve bytes that starts with a backslash and a space.) A line of the *file* that reads
  `\ No newline at end of file` is no problem — it follows a marker character
  like every other line (`git/content/no-newline-text-as-content`).
- An entirely empty line inside a hunk is an empty context line. git does not
  write it that way (it writes a single space), but mail programs strip
  trailing whitespace, and both `git apply` and GNU patch accept it.

## File sections

```
diff --git a/<path> b/<path>
<extended header lines>
--- a/<path>
+++ b/<path>
<hunks>
```

The extended header lines, in the order git writes them: `old mode` and
`new mode`, or `deleted file mode`, or `new file mode`; then
`similarity index` or `dissimilarity index`; then `rename from` and
`rename to`, or `copy from` and `copy to`; then `index`
(`git/ops/rename-edit-and-mode-change`, `git/ops/rewrite-with-dissimilarity`).

- Modes: `100644` file, `100755` executable, `120000` symbolic link, `160000`
  submodule. `index <old>..<new> <mode>` carries the mode only when it did not
  change; when it changed, `old mode`/`new mode` say so and the index line has
  none (`git/ops/mode-change-and-edit`).
- A **type change** — a file replaced by a symbolic link, a link by a file, a
  file by a submodule — is written as *two* sections for the same path, a
  deletion followed by an addition (`git/ops/file-becomes-symlink`).
- A symbolic link's "content" is its target, which has no final newline, so
  every hunk of a link ends with the marker (`git/ops/symlink-added`). A
  submodule's content is the single line `Subproject commit <id>`
  (`git/ops/submodule-updated`).
- A section can occur for a path that occurs again later: rename detection
  with `-B` produces pairs of renames that cross (`git/ops/swap-two-files-break-rewrites`).

## Names

### Prefixes

`a/` and `b/` are defaults. Other output is common
(vectors under `git-config/`):

| produced by | old side | new side |
| --- | --- | --- |
| default | `a/` | `b/` |
| `--no-prefix`, `diff.noprefix` | none | none |
| `diff.mnemonicPrefix` | `c/` commit, `i/` index, `o/` object | `i/` index, `w/` work tree |
| `--src-prefix`, `--dst-prefix` | anything | anything |
| `-R` | `b/` | `a/` |

The text does not say which prefixes were used. Removing "the first path
component" is right for the first row and wrong for the second, where the first
component is a real directory (`git-config/noprefix/directories-named-a-and-b`).
If you did not produce the diff yourself, infer the prefixes instead: outside
of renames, the two names of a section are the same path, so the prefixes are
whatever differs in front of the longest tail the two names share
(`a/src/x.c`, `b/src/x.c` → `a/`, `b/`; `src/x.c`, `src/x.c` → none). This fails
only for prefixes that do not end in `/`, or that share a trailing directory.

### Quoting

git writes a name literally unless it contains a control character (including
TAB and LF), a double quote, a backslash, or — unless `core.quotePath` is false
— any byte ≥ 0x80. Then the whole name, prefix included, is wrapped in double
quotes and escaped like a C string: `\a \b \t \n \v \f \r \" \\`, and three
octal digits for everything else.

```
diff --git "a/\303\274ber.txt" "b/\303\274ber.txt"        über.txt
--- "a/say \"hi\".txt"                                      say "hi".txt
```

- The escapes are bytes. `\303\274` is the two bytes of `ü` in UTF-8; decode the
  bytes first and interpret the encoding afterwards, if at all.
- Decode once. A file named `\303\274.txt` — backslashes and digits — is written
  `"a/\\303\\274.txt"` (`git/paths/literal-backslash-digits`).
- With `core.quotePath=false` a quoted name can mix raw non-ASCII bytes and
  escapes (`git-config/quotepath/off-still-quoted`).
- In a rename, one name can be quoted and the other not
  (`git/paths/two-names-one-quoted`).

### Spaces

**A space does not cause quoting.** Instead, when a name contains a space, git
ends the `---` and `+++` lines with a TAB:

```
--- a/my file.txt<TAB>
+++ b/my file.txt<TAB>
```

The name ends at the TAB. (A TAB inside a name forces quoting, so an unquoted
name never contains one.) Do not trim instead: a name can end with a space
(`git/paths/trailing-space`).

The two rules are independent. A name that has a space *and* needs quoting gets
both, the TAB after the closing quote:

```
--- "a/\303\234bersicht 2024.txt"<TAB>
```

So a quoted name ends at its closing quote, not at the end of the line
(`git/paths/emoji-and-space-quoted`, `git/paths/quoted-name-with-space-added`).
GNU diff puts its timestamp in the same place (`gnu/space-in-name`).

### `/dev/null`

Exactly `/dev/null`, with its leading slash and without a prefix, means "no
file on this side". `a/dev/null`, and `dev/null` under `--no-prefix`, are files
(`git/paths/dev-null-lookalike`, `git-config/noprefix/dev-null-directory`).

### The `diff --git` line

`diff --git a/my file.txt b/my file.txt` has no delimiters. It can be split
only by relying on the fact that both halves are the same path behind their
prefixes: find the space at which that is true. When several spaces qualify,
the right one leaves the longest shared path
(`git/paths/space-then-b-slash`, `git/paths/header-many-b-slash`).

For a rename the halves differ and the line cannot be split at all when the
names contain spaces — which is why the names are repeated, unambiguously, in
`rename from` / `rename to` (without prefix; quoted if necessary)
(`git/paths/rename-with-spaces`).

Prefer, in this order: `rename from`/`rename to` and `copy from`/`copy to`;
then the `---`/`+++` lines; then the `diff --git` line. The last is all there
is for a section without hunks that is not a rename.

## Sections without hunks

No `---`/`+++` lines and no hunks follow the extended headers when there is no
content to show:

| change | what the section contains | vector |
| --- | --- | --- |
| mode change | `old mode`, `new mode` | `git/ops/mode-change-only` |
| pure rename or copy | `similarity index 100%`, `rename from`, `rename to` | `git/ops/rename-pure` |
| empty file added | `new file mode`, `index 0000000..e69de29` | `git/ops/empty-file-added` |
| empty file deleted | `deleted file mode`, `index` | `git/ops/empty-file-deleted` |
| binary file | `index`, `Binary files a/x and b/x differ` | `git/ops/binary-modified` |
| `git diff -D` | `deleted file mode`, `index` — content omitted | `git/ops/irreversible-delete` |

A parser that moves on to "the next thing" must not lose these sections, and
must take their names from the `diff --git` line
(`git/paths/mode-change-with-space`).

git 2.43 cannot read one of these back itself: for a path below a directory
whose name ends with a space, `git apply` fails on the header
(`git/paths/directory-ending-in-space-mode-change`). git 2.56 can.

## Binary files

Without `--binary` there is one line, and nothing to apply:

```
Binary files a/logo.png and b/logo.png differ
Binary files /dev/null and b/logo.png differ
```

The names in it are not delimited either (`git/ops/binary-with-space-and-and`);
take them from the header. With `--binary` the section has a full-length
`index` line and

```
GIT binary patch
literal 108                 or: delta 14
zcmeAS@N?(olHy`uVBq!ia0…    base85 of zlib-deflated data, one length letter per line

literal 108                 the reverse direction
…
```

Two blocks, each ended by an empty line. `literal` data is the file; `delta`
data is a git pack delta against the other side
(`git/ops/binary-patch-literal`, `git/ops/binary-patch-delta`). The data lines
start with a letter and can spell anything; they are not headers.

## Text around the patch

`git show` and `git log -p` put a commit header and the message, indented by
four spaces, in front of each commit's sections; `--stat`, `--summary` and
`--patch-with-raw` put their own blocks there. Skip everything up to
`diff --git`. Messages are free text and can quote a whole diff
(`git-wrapped/log-message-contains-a-diff`); the indentation is what tells it
apart, so do not trim before testing for `diff --git`.

`git format-patch` writes a mail: headers, the message *without* indentation,
`---`, statistics, the patch, and then

```
-- 
2.43.0
```

The signature follows the last hunk directly. `-- ` is not a deleted line: the
hunk's counts were already used up (`git-wrapped/format-patch`). That holds
when a `\ No newline at end of file` marker stands between the last line and
the signature, too (`git-wrapped/format-patch-no-newline-then-signature`).

## Combined diffs

`git show` of a merge prints a different format (`combined/`):

```
diff --cc list.md
index d5b13de,4cd7502..54e90b5
--- a/list.md
+++ b/list.md
@@@ -1,6 -1,6 +1,7 @@@
  # Shopping
--- bread
+++ flour
 +- dates
```

One `@` more than there are parents, one range per parent, and one marker
column per parent in every line. A `-` in column *n* means "in parent *n*, not
in the result"; a `+` means "in the result, not in parent *n*". The two lines in
the middle are a removed `- bread` and an added `+ flour`
(`combined/cc/markdown-bullets`). Extended headers differ too: `index a,b..c`,
`mode a,b..c`, `deleted file mode a,b`; binary files are announced without
names (`Binary files differ`). Either support the format or recognise
`diff --cc` / `diff --combined` and decline.

## GNU diff

`diff -u`, `diff -ruN` (`gnu/`):

```
diff -ruN a/one.txt b/one.txt
--- a/one.txt	2000-01-01 00:00:00.000000000 +0000
+++ b/one.txt	2000-01-01 01:00:00.000000000 +0000
@@ -1 +1 @@
```

- No `diff --git`, no extended headers. A file starts at `--- `; the name ends
  at the TAB, a timestamp follows. With `--label` there is no TAB and no
  timestamp (`gnu/labels`).
- Names with spaces **are** quoted — `"a/my file.txt"` — as are names with
  special characters and non-ASCII bytes, in the same C style
  (`gnu/space-in-name`, `gnu/special-names`; observed with diffutils 3.10).
- A file that exists on one side only is, with `-N`, compared with an empty
  file dated 1970-01-01; `/dev/null` is not used (`gnu/new-and-deleted-files`).
  Without `-N` it is only mentioned: `Only in a: gone.txt` (`gnu/only-in`).
- Binary files get one bare line, without a header: `Binary files a/x and b/x differ`.

## Asking git for a diff you can parse

If your tool runs git itself, do not parse what the user's configuration
happens to produce. Pin the format:

```
git diff --no-color --no-ext-diff --no-textconv \
         --src-prefix=a/ --dst-prefix=b/ --submodule=short  [<commits>] [-- <paths>]
```

| option | protects against |
| --- | --- |
| `--no-color` | `color.diff=always`, which puts escape sequences into piped output |
| `--src-prefix=a/ --dst-prefix=b/` | `diff.noprefix`, `diff.mnemonicPrefix` (recent versions of git also have `--default-prefix`) |
| `--submodule=short` | `diff.submodule=log`, which replaces the submodule's section by prose |
| `--no-ext-diff` | `diff.external` and `GIT_EXTERNAL_DIFF`, which replace the output entirely |
| `--no-textconv` | text-conversion filters, which show something other than the file |

This is not hypothetical: a widely used secret scanner reports no findings at
all under `color.ui=always`, and loses findings under `diff.noprefix=true`
(see [FINDINGS.md](FINDINGS.md#12-tools-that-run-git-themselves)).

`git-config/prefix/pinned-against-a-hostile-configuration` sets the first three
of those configurations at once and shows that the options win. (The last two
rows are from git's documentation; the corpus does not exercise them.) Consider
also:

- `--no-renames` if you do not want to handle renames, or `-M` if you do — the
  default follows `diff.renames`.
- `--full-index` if you look up objects by the ids on the `index` line.
- `--binary` if the patch must be able to recreate binary files.
- `-c core.quotePath=false` makes names readable but does not remove the need
  to unquote.

For file names, the most robust source is not the patch at all:

```
git diff --name-status -z …      or      git diff --raw -z …
```

prints one NUL-terminated record per file with the exact bytes of each path and
no quoting, in the same order as the sections of the patch. This suite uses it
as ground truth for every git vector.

## Applying a diff

Reading a diff correctly is most of applying it. The rest is five rules, each
of which some widely used program gets wrong
([FINDINGS.md](FINDINGS.md#13-applying)).

- **A hunk goes where its header says.** `old start` is the first line of the
  old file that the hunk covers. When the old count is 0 the hunk covers no
  line, and the start is the line *after which* the new lines go: `@@ -5,0 +6
  @@` inserts after line 5, `@@ -0,0 +1,2 @@` at the top
  (`git/ranges/u0-insert-one`, `git/ranges/u0-insert-at-top`). With context lines
  around it a misplaced hunk is caught by the next rule; a hunk made with `-U0`
  has none, and only the number is left.
- **Every context line and every deleted line must be in the file**, at that
  place. If it is not, this is not the file the diff was made from. Searching
  for the lines somewhere else ("offset") or accepting a partial match
  ("fuzz") is a decision to apply a different patch, and belongs to the caller.
- **`\ No newline at end of file` decides the last byte.** After a `+` or a
  context line, the new file ends without a line feed; after a `-` line, only
  the old one did. A file that is given a final newline and a file that loses
  it are both one-line changes with a marker, and the marker is the whole
  change (`git/newline/added-at-end`, `git/newline/removed-at-end`).
- **Every section describes the tree as it was before the patch.** A patch may
  rename `a` to `b` and `b` to `a`, or copy a file that another section
  changes; the copy is a copy of the old content, and the source of a copy
  stays (`git/ops/swap-two-files-break-rewrites`, `git/ops/copy-and-edit`).
  Work out the whole result, then write it.
- **The header lines are instructions too.** `deleted file mode` removes the
  file — an empty file is something else, and `new file mode` without a hunk
  creates one. `new mode 100755` sets the executable bit. Mode `120000` is a
  symbolic link, and the content in the hunk is its target, without a final
  newline. `rename from`/`rename to` without a hunk moves a file and `GIT
  binary patch` replaces one. A program that reads only `---`, `+++` and the
  hunks will apply a git diff and report success while leaving all of that
  undone.

`git apply` follows these rules, with one catch: for a diff without context it
needs `--unidiff-zero`, and without that option it puts an insertion at the end
of the file instead of rejecting it. Every vector that is a patch says so in
its `apply` field, with the two trees ([corpus/README.md](corpus/README.md#applying)).

## A checklist

- [ ] Hunks are read by counting; a missing count is 1; a count of 0 is 0.
- [ ] Lines are split at LF only; nothing is trimmed.
- [ ] `\` lines mark the previous line and are never counted.
- [ ] Quoted names are unquoted (C escapes, octal, bytes).
- [ ] An unquoted name on `---`/`+++` ends at the TAB, a quoted one at its
      closing quote; a TAB can follow that too.
- [ ] Only the exact text `/dev/null` means "no file".
- [ ] Sections without `---`/`+++` (mode change, empty file, pure rename,
      binary) are kept, with names from `rename from/to` or the `diff --git` line.
- [ ] Prefixes are known or inferred, not assumed.
- [ ] Text before, between and after sections is skipped without being trimmed
      or pattern-matched as a header.
- [ ] `diff --cc` is supported or refused, not half-parsed.
- [ ] Empty input gives no files.

And if the diff is to be applied:

- [ ] An old count of 0 means "after this line"; every other hunk starts *at*
      its line.
- [ ] Context and deleted lines are compared with the file before anything is
      written.
- [ ] The no-newline marker sets, or removes, the final line feed.
- [ ] Renames and copies read the files as they were before the patch.
- [ ] Deletions, empty files, modes, symbolic links and binary patches are
      carried out or refused, not skipped.

Then run the corpus.
