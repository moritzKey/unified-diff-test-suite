# The adapter protocol

An adapter makes one diff parser testable. It is a small program, in whatever
language the parser is written in, that reads requests on standard input and
writes answers on standard output — one JSON document per line in both
directions.

```
$ node run.mjs parse-diff
{"hello":true,"name":"parse-diff","version":"0.12.0", ...}        <- printed once at start
{"id":"git/basics/add-file","path":"/abs/corpus/vectors/git/basics/add-file.diff"}    -> request
{"id":"git/basics/add-file","ok":true,"files":[ ... ]}            <- answer
```

The harness sends one request at a time and waits for the answer. If none
arrives within the time limit (10 s by default) the process is killed and
restarted and the request counts as a **hang**. If the process dies, the request
counts as a **crash**.

A line ends with LF and with nothing else. Read lines by splitting at the byte
0x0A, not with a convenience that knows more line terminators: the answers
contain what the vectors contain, and that includes U+2028, U+2029 and U+0085.
`JSON.stringify` writes those unescaped; Node's `readline` ends a line at U+2028
and U+2029 from Node.js 24 on, and Python's `str.splitlines()` at all three. The
hosts in this repository therefore write plain ASCII (`\uXXXX` for everything
else), and a new host should do the same; the harness copes either way.

## The one rule

**An adapter translates. It never repairs.** If the library returns a wrong
value, the adapter passes the wrong value on. If the library does not provide a
piece of information, the adapter leaves the field out — it does not compute
it. Everything an adapter does to a value (removing the marker column that the
library keeps in front of a line, cutting off a line terminator the library
keeps, mapping the library's `"/dev/null"` to `null`) is a documented fact about
the library's representation and is commented in the adapter.

Leaving a field out is never held against a library. Only values the library
actually returned are compared.

## hello

| field | meaning |
| --- | --- |
| `name` | short name shown in results |
| `package`, `version`, `language`, `homepage`, `api` | what exactly is under test |
| `input` | `"string"` — the library takes text; the host decodes the file as UTF-8. `"bytes"` — it takes bytes. Vectors that are not valid UTF-8 are *not applicable* to a string library. |
| `names` | `"text"` — the library takes bytes but reports file names as text (a Java `String`). A vector with a name that is not valid UTF-8 is *not applicable* to it. |
| `pathStyle` | how the library reports names: `"raw"` (as written in the diff, prefix included), `"stripped"` (prefix removed), `"header-new"` (one name per file, spelled as on the new side). A file may override it with `path_style`. |
| `statuses` | the statuses the library can tell apart, out of `added`, `deleted`, `renamed`, `copied`. Everything else is treated as `modified` on both sides of the comparison. |
| `noNewline` | how `\ No newline at end of file` is reported: `"line"`, `"file"` or `"none"`. |
| `scope` | the tiers the library sets out to handle: `git`, `git-wrapped`, `git-config`, `combined`, `gnu`. A vector with text around the patch (tag `prelude`: commit headers, mails, statistics) is in scope only if `git-wrapped` is declared as well. Other tiers are still run, and reported separately as outside the declared scope. |
| `singleFile` | `true` if the parser reads the diff of one file at a time; it is only given vectors with exactly one file section. |
| `notes` | where the claims above come from (a quote from the README, a pointer into the source). |

## answer

`{"id": ..., "ok": false, "error": "message"}` when the library threw.
Otherwise `{"id": ..., "ok": true, "files": [...]}` with one object per file
section, in the order of the diff. All fields are optional.

| field | compared with | notes |
| --- | --- | --- |
| `old_path`, `new_path` | `old_path`/`new_path` (style `stripped`) or `old_name`/`new_name` (style `raw`) | `null` = no file on that side; `{"unknown": true}` = the library could not determine the name |
| `path` | the new path, or the old one for a deleted file | for libraries with one name per file |
| `status` | `status` | after collapsing to the library's `statuses` |
| `old_mode`, `new_mode` | modes | `null` is accepted unless the diff states the mode in an explicit mode header |
| `binary` | `binary` (any kind) | |
| `similarity` | `similarity` | |
| `additions`, `deletions` | counts of added / deleted lines | |
| `old_eof_newline`, `new_eof_newline` | derived from the markers | for `noNewline: "file"` |
| `hunks[]` | | |
| `hunks[].old_start`, `old_lines`, `new_start`, `new_lines` | the hunk header | |
| `hunks[].section` | text after the closing `@@` | |
| `hunks[].lines[]` | | |
| `lines[].type` | `context`, `add`, `delete` | |
| `lines[].text` | the line without marker and without terminator | |
| `lines[].old_no`, `new_no` | line numbers; `null` where the line does not exist | |
| `lines[].no_newline` | the marker | only compared for `noNewline: "line"` |

Text is a JSON string, or `{"base64": "..."}` for bytes that are not valid
UTF-8.

For a combined diff the file object has `"combined": true`, a `path`, and hunks
whose lines are `{ "markers": "+ ", "text": "..." }` or `{ "raw": "+ ..." }`.

### Paths, fairly

A library that removes `a/` and `b/` cannot know other prefixes. For vectors
written with other prefixes (`--no-prefix`, `--src-prefix`, mnemonic prefixes,
`-R`) a `stripped` library may return either the repository path or the name
exactly as written. Where the path cannot be worked out from the text at all,
`null` is accepted too. What is never accepted is a name that is neither — one
with a real directory cut off, or with half a prefix left on.

## Appliers

A program that *applies* patches is tested through the same kind of adapter
(`node src/apply.js`, results in [`APPLY.md`](../APPLY.md)). Its hello says how
it works:

| field | meaning |
| --- | --- |
| `applies` | `"tree"` — it applies a diff to the files in a directory. `"file"` — it patches one file at a time. |
| `input` | as above. A `"string"` applier of the `file` kind is not given files or diffs that are not valid UTF-8. |
| `binary` | (`file` kind) `true` if it applies `GIT binary patch` sections; otherwise it is not given them. |
| `eofNewline` | `false` if its answer cannot say whether the last line ends with a newline (a list of lines). That is then not compared. |
| `scope` | optional: the tiers it sets out to read. Other vectors are not given to it. |
| `prefixes` | optional: `["a/", "b/"]` for a program that always removes those two prefixes and takes no `-p` (patch-package, pnpm, Yarn). Vectors with other prefixes are not given to it, and it may ignore `strip`. |

and it answers two more requests:

```
{"id": ..., "op": "apply", "path": "/abs/x.diff", "dir": "/abs/tree", "strip": 1}
{"id": ..., "op": "apply-file", "path": "/abs/one-section.diff", "old": "/abs/old-content", "out": "/abs/new-content"}
```

`apply`: the directory holds the tree the diff was made from; `strip` is the
number of leading path components that the names in the diff carry, the `N` of
`patch -pN`. Apply the diff there. Answer `{"ok": true}` if the program reports
success and `{"ok": false, "error": ...}` if it reports failure — whatever it
did to the files. The harness reads the directory back itself.

`apply-file`: the diff holds exactly one file section, `old` is the old content
of that file (`null`: there was none). Write the new content to `out` and
answer `{"ok": true}`, or `{"ok": true, "absent": true}` if the result is that
there is no file.

The one rule holds here too. Call the program the way its documentation says,
say how in `api`, and do not prepare its input or tidy up after it: a backup
file it leaves behind is part of what it did.

## Adding a parser

1. Write `adapters/<host>/adapters/<name>.*` with the `meta` and a `parse`
   function (see the existing ones; most are under 60 lines).
2. Add a line to `adapters/registry.json`.
3. `node src/run.js --adapter <name> --show`.

There are hosts for JavaScript (`adapters/node/run.mjs`), Python
(`adapters/python/run.py`), Go (`adapters/go/main.go`), Rust
(`adapters/rust/src/main.rs`) and Java (`adapters/java/Host.java`). A new host
(Ruby, PHP, C#, …) only has to speak the line protocol above.

An applier is entered in the `appliers` list of the registry, and the hosts are
started with `apply:<name>` for those. In the JavaScript and Python hosts it is
a file in the `appliers` directory; the other hosts keep theirs in the source.
