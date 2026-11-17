# unified-diff-test-suite

A conformance corpus for programs that read diffs, and for programs that apply
them — with git itself as the oracle.

Diff parsers are everywhere and nobody looks at them: in code-review bots and
AI reviewers, secret scanners, coverage gates, "lint only the changed lines"
tools, patch appliers, and the harnesses that score coding agents. The format
they read has no specification beyond a few paragraphs of documentation, and it
is full of traps. This repository contains

- **246 test vectors** — real output of `git` and GNU `diff` for carefully
  chosen changes, each with the parse it must produce, in plain JSON that any
  language can read ([`corpus/`](corpus/README.md));
- **a harness** that runs any parser against them through a small adapter, and
  adapters for twenty-five widely used libraries in JavaScript, Python, Go,
  Rust, Java and C
  ([`RESULTS.md`](RESULTS.md), [`FINDINGS.md`](FINDINGS.md));
- **the same for programs that apply patches**: 208 of the vectors come with
  the file tree before and after, and `git apply`, GNU patch, BusyBox patch,
  toybox patch, the BSD patch of FreeBSD and macOS, Mercurial, libgit2, JGit
  and six libraries are asked to get from one to the other
  ([`APPLY.md`](APPLY.md));
- **a description of the format** as the tools actually write it
  ([`SPEC.md`](SPEC.md));
- **two small reference parsers**, in JavaScript and Python, and a reference
  applier, that pass everything.

## The trap, in ten lines

Delete a comment from an SQL file and git prints

```diff
@@ -1,5 +1,4 @@
 CREATE TABLE users (
   id INTEGER PRIMARY KEY
 );
--- speed up lookups
 CREATE INDEX users_id ON users (id);
```

The fourth line of the hunk is the deleted line `-- speed up lookups` behind
its `-` marker. It is also, character for character, what a file header looks
like. A parser has to know that it is inside a hunk, and the only way to know
is to count the lines the `@@` header announced. That is one vector. The
others are about file names with spaces, quotes and umlauts; line counts of
zero; files that do not end with a newline; carriage returns; renames, modes,
symbolic links, submodules and binary files; the text that `git show` and
`git format-patch` put around a patch; merge commits; and what changes when a
user has `diff.noprefix` in their configuration.

## Use the corpus in your own test-suite

Copy `corpus/` (it is public domain) and loop over it:

```python
import json, pathlib

corpus = pathlib.Path("corpus")
for entry in json.loads((corpus / "index.json").read_text())["vectors"]:
    if entry["tier"] != "git":                      # pick the tiers you support
        continue
    vector = json.loads((corpus / "vectors" / (entry["id"] + ".json")).read_text())
    data = (corpus / "vectors" / (entry["id"] + ".diff")).read_bytes()   # bytes, not text
    files = my_parser(data)
    assert len(files) == len(vector["expected"]["files"]), entry["id"]
    for mine, expected in zip(files, vector["expected"]["files"]):
        assert mine.new_path == expected["new_path"], entry["id"]
        ...
```

[`corpus/README.md`](corpus/README.md) documents every field. Each vector also
says why it exists (`title`, `description`), which tool invocation produced it,
and carries a recipe from which it can be produced again.

| tier | vectors | what it is |
| --- | --- | --- |
| `git` | 181 | `git diff` with git's default naming |
| `git-wrapped` | 17 | the same with something around it: `git show`, `git log -p`, `git format-patch`, `--stat` |
| `git-config` | 21 | the same, named differently: `--no-prefix`, mnemonic prefixes, `-R`, `core.quotePath=false`, … |
| `combined` | 10 | merge commits (`diff --cc`) |
| `gnu` | 17 | GNU `diff -u`, `diff -ruN` |

## Why trust the expectations

Because they are not anybody's reading of the format. A vector starts from two
file trees. The real tool computes the diff. Then:

1. **Replay.** The hunks, as parsed, are applied to the old contents; the
   result must be the new contents, byte for byte. Every line number and every
   `\ No newline at end of file` marker must be where the contents say.
2. **`git diff --raw -z` and `--numstat -z`.** Paths, modes, object ids,
   rename scores and line counts must agree with git's unambiguous,
   machine-readable account of the same comparison.
3. **`git apply --numstat`.** git's own patch reader must see the same files
   and the same counts in the text.

Binary patches are decoded and compared with the files; combined diffs are
checked hunk by hunk against the merge result and each parent.

The oracle is tested too: [`test/replay.test.js`](test/replay.test.js) damages
correct parses in more than thirty small ways — a carriage return dropped, a
range shifted by one, a TAB left on a name — and requires each to be caught.
And the parsers that produce the expectations are checked against each other:
the JavaScript and the Python reference implementation agree on every vector
and on 32,729 randomly generated scenarios; in total 47,215 random scenarios
were verified against the three oracles without an unexplained difference.
(The fuzzer did find a case in which git 2.43 cannot read its own output — git 2.56 can; see
[FINDINGS.md](FINDINGS.md#6-names-with-spaces-where-only-the-header-carries-them).)

## Results

[`RESULTS.md`](RESULTS.md) has the table for jsdiff, parse-diff, diff2html,
gitdiff-parser, what-the-diff, diffparser, parse-git-diff, git-diff-view
(JavaScript); unidiff, whatthepatch, patch-ng, GitPython (Python); libgit2 (C);
go-gitdiff and the fork that gitleaks uses, sourcegraph/go-diff, reviewdog/diff
and waigani/diffparser (Go); diffy, patch, gitpatch and unidiff (Rust);
JGit, java-diff-utils and diffparser (Java);
[`FINDINGS.md`](FINDINGS.md) explains what is behind the numbers and what was
already known to each project. Two things before you look:

- It is not a ranking. The corpus collects hard cases. A library that renders
  pull requests well can fail half of them and still be the right tool.
- The adapters were written by the author of this suite, not by the
  maintainers of the libraries. If one misuses a library, that is a bug here.

### Applying

Reading a diff wrongly gives a wrong report. Applying it wrongly gives a wrong
file. [`APPLY.md`](APPLY.md) has the second table: each program is given the
tree a diff was made from and the diff, and what it leaves behind is compared
with the tree the diff was made to, byte for byte. A program may refuse — that
is a limitation, and the caller is told. The column to look at is the other
one: it reported success and the files are not what they should be.

| | patches | right | refused | left half-done | wrong, no error |
| --- | --- | --- | --- | --- | --- |
| `git apply` 2.43.0 | 208 | 197 | 9 | – | 2 |
| `git apply --unidiff-zero` | 208 | 207 | 1 | – | – |
| GNU patch 2.7.6 | 208 | 195 | 8 | 4 | 1 |
| BusyBox patch 1.36.1 | 208 | 104 | 46 | 10 | 48 |
| toybox patch 0.8.15 | 208 | 136 | 27 | 7 | 38 |
| BSD patch (FreeBSD, = macOS) | 208 | 140 | 23 | 24 | 21 |
| libgit2 1.9.7 (`git_apply`) | 194 | 161 | 29 | – | 4 |
| JGit 7.8.1 (`Git.apply()`) | 208 | 182 | 21 | 1 | 4 |
| Mercurial 7.2.4 (`hg import`) | 208 | 171 | 6 | 22 | 9 |
| patch-ng 1.19.1 | 208 | 127 | 38 | 13 | 30 |
| jsdiff 9.0.0 (`applyPatch`) | 184 | 184 | – | – | – |
| whatthepatch 1.0.7 (`apply_diff`) | 184 | 173 | 6 | – | 5 |
| go-gitdiff 0.9.0 (`Apply`) | 189 | 182 | 2 | – | 5 |
| diffy 0.5.2 (`apply_bytes`) | 189 | 189 | – | – | – |
| java-diff-utils 4.18 (`applyTo`) | 184 | 176 | 4 | – | 4 |

Three examples of the last column. A diff made with `-U0` that inserts a line
after line 5 says `@@ -5,0 +6 @@`; plain `git apply` puts the line at the end
of the file and exits with 0, and two libraries put it before line 5. A diff
made with `-U0` that removes the first line of a file says `@@ -1 +0,0 @@`;
toybox patch deletes the file, and JGit and BusyBox patch leave it empty. A
diff that removes the final newline of a file says so with `\ No newline at
end of file`; BusyBox patch, toybox patch and patch-ng apply it and leave the
newline in. The `patch` of macOS gets all of those right, but cuts a line at a
NUL byte and applies the change of a copied file to the original. Mercurial
drops the renames of a patch that Mercurial itself wrote with `diff.noprefix`.
[`FINDINGS.md`](FINDINGS.md#13-applying) has the rest.

## Running it

Requirements: Node.js ≥ 20 and git; Python ≥ 3.9 for the Python parsers; Go ≥ 1.26
for the Go parsers; a Rust toolchain for the Rust ones; a JDK ≥ 17 for the Java
ones. An adapter whose toolchain is missing is skipped. The tests, the corpus
check and the runs of all parsers and appliers give identical results with
Node.js 20, 22, 24 and 26.

```sh
npm test                                  # the suite's own tests (48)
node src/generate.js --check              # rebuild every vector and compare

cd adapters/node && npm ci && cd ../..    # the JavaScript libraries under test
python3 -m venv adapters/python/.venv && adapters/python/.venv/bin/pip install -r adapters/python/requirements.txt
(cd adapters/go && go build -o bin/udts-go .)                                     # the Go libraries
(cd adapters/rust && cargo build --release --locked)                              # the Rust libraries
adapters/java/build.sh                                                            # the Java libraries
adapters/bsd-patch/build.sh                       # FreeBSD's patch, on Linux (a Mac has it)

node src/run.js                           # everything; writes results/*.json
node src/run.js --adapter parse-diff --show
node src/try.js diff2html git/paths/space --raw     # one parser, one vector
node src/apply.js                         # every applier; writes results/apply/*.json
node src/apply.js --adapter gnu-patch --show
node src/report.js                        # RESULTS.md and APPLY.md
node src/fuzz.js --seed 1 --count 2000    # differential fuzzing with minimisation
node src/fuzz-apply.js --seed 1 --count 300   # the same for the appliers
```

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs these steps on
every push and once a week: the tests on four versions of Node.js, the
regeneration of every vector with the git of the day, the corpus as checked out
on Linux, macOS and Windows, and all parsers — failing if `RESULTS.md` is not
exactly what they produce. The appliers run there too; `APPLY.md` is not
compared, because `git`, `patch`, `busybox` and `toybox` are whatever the
machine has (BSD patch is built there from the pinned FreeBSD sources).

The vectors were produced with git 2.43.0 and diffutils 3.10. git 2.56.1, the
latest release at the time of writing, produced each of the first 245 byte for
byte (apart from its own version number in the signature of `format-patch`
mails), and all three oracles agreed there too; the one vector added later was
not checked with it. With other versions the tools
may legitimately write something slightly different; `generate.js --check`
shows where. GNU diffutils 3.12 is one example: it quotes fewer file names
than 3.10 ([SPEC.md](SPEC.md#gnu-diff)), so the CI builds 3.10 for that
comparison.

## Testing another parser

An adapter is a small program that reads one JSON request per line and answers
with what its library returned ([`adapters/PROTOCOL.md`](adapters/PROTOCOL.md)).
Most are under sixty lines. The rule for adapters is strict: translate, never
repair. Only values the library actually returns are compared, and a library is
only held to the tiers it sets out to handle.

Parsers written in Ruby, PHP, C# and Swift are missing. The protocol does not
care about the language.

## Not only libraries

A tool that runs `git log -p` or `git diff` and parses the output inherits
every setting in the user's git configuration that changes that output.
[`extras/git-config-sensitivity`](extras/git-config-sensitivity/scan-under-configs.sh)
scans one small repository with a secret scanner under four configurations.
With gitleaks 8.30.1, `diff.noprefix=true` changes the reported paths and
makes two of three findings disappear behind a path allowlist, and
`color.ui=always` makes all of them disappear; trufflehog 3.99.9 gives the same
answer every time, and so does diff-cover 11.0.2 for the lines it considers
changed. Details and upstream status are in
[FINDINGS.md](FINDINGS.md#12-tools-that-run-git-themselves); the remedy is in
[SPEC.md](SPEC.md#asking-git-for-a-diff-you-can-parse).

## The reference parsers and the reference applier

[`src/refparse.js`](src/refparse.js) and
[`reference/python/udiff_reference.py`](reference/python/udiff_reference.py)
are small, dependency-free and byte-oriented. They exist to state the format
in executable form, and they are usable as libraries:

```python
from udiff_reference import parse_diff, resolve_names, status_of, apply_hunks

for f in parse_diff(open("change.diff", "rb").read())["files"]:
    names = resolve_names(f)                      # prefixes are inferred from the text
    print(status_of(f), names["old_path"], names["new_path"], len(f["hunks"]))
```

They parse git patches, GNU unified diffs and combined diffs, skip whatever
surrounds a patch, decode quoted names and `GIT binary patch` blocks, and
report a hunk that is shorter than its header instead of guessing.

[`src/refapply.js`](src/refapply.js) applies what they parse: `applyToTree(diff,
files, strip)` gives the tree after a patch, renames, copies, modes, symbolic
links and binary patches included, or throws without having changed anything.
It is strict on purpose — a hunk goes where its header says and every line of
context must be there — so it is a yardstick, not a replacement for `patch`.

## Limits

- **Only what real tools wrote.** There are no hand-written or damaged diffs
  here, so the corpus says nothing about how a parser should treat a patch
  whose line counts are wrong — which is exactly what language models tend to
  produce. That needs a different kind of test.
- **Two producers.** git and GNU diff. Subversion, Mercurial, Perforce and the
  diffs that forges serve through their APIs are not covered.
- **Not covered on purpose:** colourised output, `--word-diff`,
  `--submodule=log`, whitespace-ignoring options (their output is not a patch),
  context format and ed scripts.
- **Two versions of git** (2.43.0 and 2.56.1) and one of diffutils, on Linux.
- **Applying is tested in the easy direction only**: every patch is applied to
  exactly the tree it was made from. What a program does with a patch that
  does not fit — offsets, fuzz, conflicts, a patch applied twice — is not
  examined, and neither is where it writes (a patch that names `../x`).
- The fairness of an adapter is a judgement, not a measurement.

## Contributing

New vectors are scenarios in [`scenarios/`](scenarios/): two file trees and a
tool invocation, a title that says what the trap is, and optionally
`mustContain` — text the diff has to contain, so that a vector cannot silently
stop showing what its title promises. `node src/generate.js` refuses any
scenario it cannot verify.

If the corpus leads you to a bug in someone's library: check their tracker
first, send the smallest vector that shows it, and remember that most of these
projects are maintained by one person in their spare time.

## Licence

Code: MIT ([`LICENSE`](LICENSE)). Corpus: public domain, CC0 1.0
([`corpus/LICENSE`](corpus/LICENSE)).

## About

This suite was designed and written by Claude, an AI model made by Anthropic,
in November 2026. The person who ran it had spare compute and asked for it to
be spent on something useful to people and to agents; this is what it was spent
on. Everything in it is meant to be checkable without trusting its author: run
`npm test`.

The idea of a language-neutral corpus for a format everybody parses and nobody
specifies is borrowed, with gratitude, from JSONTestSuite, toml-test, the YAML
test suite and html5lib-tests.
