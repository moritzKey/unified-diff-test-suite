// File names.
//
// git writes a name literally unless it contains a control character, a double
// quote, a backslash or (by default) a byte >= 0x80. Then it wraps the name in
// double quotes and uses C escapes: "a/caf\303\251.txt" is a/café.txt.
// A space does NOT trigger quoting. Instead, when a name contains a space, git
// appends a TAB to the "--- " and "+++ " lines so that the end of the name can
// be found. The "diff --git a/x b/x" line is not delimited at all: it is only
// unambiguous because both halves name the same path.

import { git, bytes } from './_dsl.js';

const mod = (name, tags, title, why) =>
  git(`paths/${tags.id}`, {
    title,
    why,
    tags: ['paths', ...tags.tags],
    before: [[name, 'old\n']],
    after: [[name, 'new\n']],
  });

export const scenarios = [
  mod('my file.txt', { id: 'space', tags: ['space-in-path'] }, 'A space in the file name: the "---"/"+++" lines end with a TAB',
    'The TAB is a terminator, not part of the name.'),
  mod('dir with space/sub dir/a b c.txt', { id: 'spaces-in-directories', tags: ['space-in-path'] }, 'Spaces in directory names and several in the file name'),
  mod(' leading.txt', { id: 'leading-space', tags: ['space-in-path'] }, 'A file name that starts with a space'),
  mod('trailing.txt ', { id: 'trailing-space', tags: ['space-in-path'] }, 'A file name that ends with a space',
    'Only the TAB after the name marks where it ends; trimming the line loses the space.'),
  git('paths/trailing-space-added', {
    title: 'A new file whose name ends with a space, next to the same name without it',
    why: 'A program that trims the name of a new file writes it over the other file.',
    tags: ['paths', 'space-in-path', 'added'],
    before: [['notes.txt', 'keep me\n']],
    after: [['notes.txt', 'keep me\n'], ['notes.txt ', 'new\n']],
  }),
  git('paths/trailing-space-empty-added', {
    title: 'A new empty file whose name ends with a space: only "diff --git" names it',
    why: 'An empty new file has no "+++" line, and nothing after the name on the header line marks where it ends.',
    tags: ['paths', 'space-in-path', 'added', 'empty-file', 'no-hunks'],
    before: [['keep.txt', 'k\n']],
    after: [['keep.txt', 'k\n'], ['empty ', '']],
  }),
  mod('two  spaces.txt', { id: 'double-space', tags: ['space-in-path'] }, 'Two consecutive spaces in a file name'),
  mod('a b/c.txt', { id: 'space-then-b-slash', tags: ['space-in-path', 'header-ambiguity'] }, 'A directory named "a b": the header reads "diff --git a/a b/c.txt b/a b/c.txt"',
    'Splitting the "diff --git" line at " b/" picks the wrong place.'),
  mod('x b/x b/x', { id: 'header-many-b-slash', tags: ['space-in-path', 'header-ambiguity'] }, 'A path in which " b/" occurs twice'),
  mod('über.txt', { id: 'non-ascii-quoted', tags: ['quoted-path', 'unicode'] }, 'A non-ASCII name is quoted and octal-escaped by default ("a/\\303\\274ber.txt")',
    'Every file name outside ASCII takes this form unless core.quotePath is false: German umlauts, Cyrillic, Chinese, emoji.'),
  mod('文档/读我.md', { id: 'cjk-quoted', tags: ['quoted-path', 'unicode'] }, 'A Chinese path, quoted and octal-escaped'),
  mod('emoji 🎉.txt', { id: 'emoji-and-space-quoted', tags: ['quoted-path', 'unicode', 'space-in-path'] }, 'An emoji and a space: quoted, and the TAB follows the closing quote',
    'The space puts a TAB at the end of the "---" and "+++" lines whether or not the name is quoted. The name ends at its closing quote.'),
  mod('say "hi".txt', { id: 'double-quote', tags: ['quoted-path'] }, 'A double quote in the name ("a/say \\"hi\\".txt")'),
  mod('"quoted".txt', { id: 'starts-with-double-quote', tags: ['quoted-path'] }, 'A name that itself starts and ends with a double quote'),
  mod('back\\slash.txt', { id: 'backslash', tags: ['quoted-path'] }, 'A backslash in the name ("a/back\\\\slash.txt")'),
  mod('col1\tcol2.tsv', { id: 'tab', tags: ['quoted-path', 'control-chars'] }, 'A TAB in the name ("a/col1\\tcol2.tsv")'),
  mod('line1\nline2.txt', { id: 'newline', tags: ['quoted-path', 'control-chars'] }, 'A newline in the name ("a/line1\\nline2.txt")'),
  mod('bell\x07esc\x1bdel\x7f.txt', { id: 'control-chars', tags: ['quoted-path', 'control-chars'] }, 'BEL, ESC and DEL in the name: \\a and octal escapes'),
  mod('cr\rname.txt', { id: 'carriage-return', tags: ['quoted-path', 'control-chars', 'cr'] }, 'A carriage return in the name ("a/cr\\rname.txt")'),
  git('paths/latin1-name', {
    title: 'A name that is not valid UTF-8 (ISO-8859-1 "café.txt")',
    why: 'Quoting makes the diff itself pure ASCII; the name it denotes is a byte string, not text.',
    tags: ['paths', 'quoted-path', 'encoding'],
    before: [[bytes(0x63, 0x61, 0x66, 0xe9, 0x2e, 0x74, 0x78, 0x74), 'old\n']],
    after: [[bytes(0x63, 0x61, 0x66, 0xe9, 0x2e, 0x74, 0x78, 0x74), 'new\n']],
  }),
  mod('dev/null', { id: 'dev-null-lookalike', tags: ['dev-null'] }, 'A file at the relative path dev/null: "--- a/dev/null" is a real file',
    'Only the exact text /dev/null (with the leading slash and no prefix) means "no file".'),
  mod('a/a.txt', { id: 'directory-named-a', tags: ['prefix'] }, 'A top-level directory named "a": "--- a/a/a.txt"',
    'Stripping the prefix must remove exactly one "a/".'),
  mod('b/b/b.txt', { id: 'directory-named-b', tags: ['prefix'] }, 'Directories named "b": "+++ b/b/b/b.txt"'),
  mod('-dash.txt', { id: 'leading-dash', tags: [] }, 'A name that starts with a dash'),
  mod('+plus.txt', { id: 'leading-plus', tags: [] }, 'A name that starts with a plus sign'),
  mod('@@ -1 +1 @@.txt', { id: 'hunk-header-as-name', tags: ['space-in-path'] }, 'A name that looks like a hunk header'),
  mod('report 2024-01-01 10:00:00 +0100.txt', { id: 'timestamp-in-name', tags: ['space-in-path'] }, 'A name that contains a timestamp',
    'Parsers that cut a "timestamp" off the "---" line by pattern, not by the TAB, cut the name.'),
  mod('{old => new}.txt', { id: 'arrow-and-braces', tags: ['space-in-path'] }, 'A name with " => " and braces, the notation of --stat for renames'),
  mod('a and b.bin.txt', { id: 'contains-and', tags: ['space-in-path'] }, 'A name that contains " and "'),
  mod(`${'deep/'.repeat(40)}file.txt`, { id: 'deep-directory', tags: [] }, 'A file forty directories deep'),
  mod(`${'n'.repeat(240)}.txt`, { id: 'long-name', tags: [] }, 'A 244-character file name'),
  mod('glob[1]*?.txt', { id: 'glob-characters', tags: [] }, 'Glob characters in the name'),
  mod('semi;colon&amp$dollar#hash%percent.txt', { id: 'shell-characters', tags: [] }, 'Shell and markup metacharacters in the name'),
  mod('.hidden/.env', { id: 'dotfiles', tags: [] }, 'Dot files in dot directories'),
  mod("it's.txt", { id: 'single-quote', tags: [] }, 'A single quote in the name (not quoted by git)'),
  mod('tilde~1.txt', { id: 'tilde', tags: [] }, 'A tilde in the name'),
  mod('nbsp name.txt', { id: 'no-break-space', tags: ['quoted-path', 'unicode'] }, 'A no-break space in the name'),
  mod('é.txt', { id: 'combining-accent', tags: ['quoted-path', 'unicode'] }, 'A decomposed accented letter (e + U+0301) in the name',
    'Unquoting must not normalise: this name is five bytes, not the four of the precomposed form.'),
  mod('\\303\\274.txt', { id: 'literal-backslash-digits', tags: ['quoted-path'] }, 'A name that literally contains the characters \\303\\274',
    'Quoted as "a/\\\\303\\\\274.txt". Decoding escapes twice turns it into "ü.txt".'),
  mod('a/b/c.txt b/c.txt', { id: 'name-contains-header-split', tags: ['space-in-path', 'header-ambiguity'] }, 'A file name that contains " b/" followed by a suffix of itself'),
  git('paths/two-names-one-quoted', {
    title: 'A rename where only the new name needs quoting',
    tags: ['paths', 'quoted-path', 'rename', 'header-ambiguity'],
    before: { 'plain.txt': 'one\ntwo\nthree\nfour\n' },
    after: { 'we\tird.txt': 'one\ntwo\nthree\nfour!\n' },
  }),
  git('paths/two-names-first-quoted', {
    title: 'A rename where only the old name needs quoting',
    tags: ['paths', 'quoted-path', 'rename', 'header-ambiguity'],
    before: { 'we\tird.txt': 'one\ntwo\nthree\nfour\n' },
    after: { 'plain.txt': 'one\ntwo\nthree\nfour!\n' },
  }),
  git('paths/rename-with-spaces', {
    title: 'A rename between two names with spaces: the "diff --git" line cannot be split',
    why: '"diff --git a/old name.txt b/new name.txt" has four spaces and no rule to choose between them; the "rename from"/"rename to" lines carry the names.',
    tags: ['paths', 'space-in-path', 'rename', 'header-ambiguity'],
    before: { 'old name.txt': 'one\ntwo\nthree\nfour\n' },
    after: { 'new name.txt': 'one\ntwo\nthree\nfour!\n' },
  }),
  git('paths/pure-rename-with-spaces', {
    title: 'A rename without content change between names with spaces: no "---"/"+++" lines at all',
    tags: ['paths', 'space-in-path', 'rename', 'header-ambiguity'],
    before: { 'old name.txt': 'one\ntwo\nthree\nfour\n' },
    after: { 'new name.txt': 'one\ntwo\nthree\nfour\n' },
  }),
  git('paths/mode-change-with-space', {
    title: 'A mode change of a file with a space in its name: the name appears only on the "diff --git" line',
    tags: ['paths', 'space-in-path', 'mode', 'header-ambiguity'],
    before: { 'run me.sh': '#!/bin/sh\n' },
    after: { 'run me.sh': { content: '#!/bin/sh\n', mode: '100755' } },
  }),
  git('paths/mode-change-quoted', {
    title: 'A mode change of a file with a non-ASCII name: quoted names on the "diff --git" line only',
    tags: ['paths', 'quoted-path', 'mode', 'unicode'],
    before: { 'prüfen.sh': '#!/bin/sh\n' },
    after: { 'prüfen.sh': { content: '#!/bin/sh\n', mode: '100755' } },
  }),
  git('paths/empty-file-with-space-added', {
    title: 'A new empty file with spaces in its name',
    tags: ['paths', 'space-in-path', 'added', 'empty-file', 'header-ambiguity'],
    before: {},
    after: { 'an empty file.txt': '' },
  }),
  git('paths/quoted-name-with-space-added', {
    title: 'A new file whose name is quoted and contains a space',
    why: 'The "+++" line is the only one with the name on it that a plain patch reader looks at, and it ends in a quote and a TAB. Taking the rest of the line as the name creates a file called `\\303\\234bersicht 2024.txt"<TAB>`.',
    tags: ['paths', 'quoted-path', 'unicode', 'space-in-path', 'added'],
    before: {},
    after: { 'Übersicht 2024.txt': 'Januar\n' },
  }),
  git('paths/directory-ending-in-space-mode-change', {
    title: 'A mode change below a directory whose name ends with a space: git 2.43 cannot read this back',
    why: 'The only place that names the file is "diff --git a/dir /run.sh b/dir /run.sh". `git apply` gives up on it ("git diff header lacks filename information"): its header reader stops at the first space that is followed by a slash. git 2.56 reads it. The names were always recoverable, because both halves of the line are the same path.',
    tags: ['paths', 'space-in-path', 'mode', 'header-ambiguity', 'git-apply-rejects'],
    gitApply: 'may-reject',
    before: { 'dir /run.sh': '#!/bin/sh\n' },
    after: { 'dir /run.sh': { content: '#!/bin/sh\n', mode: '100755' } },
  }),
  git('paths/directory-ending-in-space-edit', {
    title: 'An edit below a directory whose name ends with a space: readable, because "---"/"+++" name the file',
    tags: ['paths', 'space-in-path'],
    before: { 'dir /notes.txt': 'old\n' },
    after: { 'dir /notes.txt': 'new\n' },
  }),
  git('paths/case-only-rename', {
    title: 'A rename that changes only letter case',
    tags: ['paths', 'rename'],
    before: { 'README.md': '# Title\n\nText\n' },
    after: { 'readme.md': '# Title\n\nText\n' },
  }),
  git('paths/many-odd-names', {
    title: 'Fourteen files with awkward names in one diff',
    tags: ['paths', 'quoted-path', 'space-in-path', 'unicode'],
    before: [
      ['a b.txt', '1\n'], ['ä.txt', '1\n'], ['q"q.txt', '1\n'], ['t\tt.txt', '1\n'], ['plain.txt', '1\n'], [' s.txt', '1\n'], ['e .txt', '1\n'],
      ['d/dev/null', '1\n'], ['a/b/a/b.txt', '1\n'], ['x y/z w.txt', '1\n'], ['日本語.txt', '1\n'], ['-.txt', '1\n'], ['b\\s.txt', '1\n'], ['z.txt', '1\n'],
    ],
    after: [
      ['a b.txt', '2\n'], ['ä.txt', '2\n'], ['q"q.txt', '2\n'], ['t\tt.txt', '2\n'], ['plain.txt', '2\n'], [' s.txt', '2\n'], ['e .txt', '2\n'],
      ['d/dev/null', '2\n'], ['a/b/a/b.txt', '2\n'], ['x y/z w.txt', '2\n'], ['日本語.txt', '2\n'], ['-.txt', '2\n'], ['b\\s.txt', '2\n'], ['z.txt', '2\n'],
    ],
  }),
];
