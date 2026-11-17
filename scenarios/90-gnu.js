// GNU diff (diffutils) in unified format.
//
// No "diff --git" line, no extended headers. A file starts at "--- name<TAB>
// timestamp". Since diffutils 3.3 names with spaces or special characters are
// quoted like C strings - including names with spaces, which git does NOT
// quote. A file that exists on one side only (with -N) is not marked with
// /dev/null; it is compared with an empty file dated 1970-01-01.

import { gnu, lines } from './_dsl.js';

const c = `#include <stdio.h>\n\nint add(int a, int b)\n{\n\tint sum;\n\tsum = a + b;\n\treturn sum;\n}\n\nint main(void)\n{\n\treturn add(1, 2);\n}\n`;

export const scenarios = [
  gnu('single-file', {
    title: 'diff -u a/f.txt b/f.txt: names followed by a TAB and a timestamp',
    tags: ['timestamp'],
    args: ['-u'],
    file: 'f.txt',
    before: { 'f.txt': 'one\ntwo\nthree\n' },
    after: { 'f.txt': 'one\n2\nthree\n' },
  }),
  gnu('recursive', {
    title: 'diff -ruN a b: a "diff -ruN a/x b/x" line before each file',
    tags: ['timestamp', 'command-line'],
    before: { 'one.txt': '1\n', 'sub/two.txt': '2\n', 'same.txt': 's\n' },
    after: { 'one.txt': 'one\n', 'sub/two.txt': 'two\n', 'same.txt': 's\n' },
  }),
  gnu('new-and-deleted-files', {
    mustContain: ["\t1970-01-01 00:00:00.000000000 +0000\n"],
    title: 'diff -ruN with a new and a deleted file: no /dev/null, but a 1970 timestamp',
    tags: ['timestamp', 'added', 'deleted', 'zero-count'],
    before: { 'gone.txt': 'a\nb\n', 'kept.txt': 'k\n' },
    after: { 'kept.txt': 'K\n', 'made.txt': 'c\nd\n' },
  }),
  gnu('only-in', {
    mustContain: ["Only in a: gone.txt\n"],
    title: 'diff -ru without -N: "Only in a: gone.txt" lines between the file diffs',
    tags: ['only-in', 'prelude'],
    args: ['-ru'],
    before: { 'gone.txt': 'a\n', 'kept.txt': 'k\n', 'z.txt': 'z\n' },
    after: { 'kept.txt': 'K\n', 'made.txt': 'c\n', 'z.txt': 'Z\n' },
  }),
  gnu('space-in-name', {
    mustContain: ["--- \"a/my file.txt\"\t"],
    title: 'A space in the name: GNU diff quotes it ("a/my file.txt"), git would not',
    tags: ['quoted-path', 'space-in-path'],
    before: { 'my file.txt': 'old\n' },
    after: { 'my file.txt': 'new\n' },
  }),
  gnu('special-names', {
    title: 'Quotes, backslashes, TABs, newlines and non-ASCII bytes in names (C locale)',
    tags: ['quoted-path', 'control-chars', 'unicode'],
    before: { 'q"q.txt': '1\n', 'b\\s.txt': '1\n', 't\tt.txt': '1\n', 'n\nn.txt': '1\n', 'ü.txt': '1\n' },
    after: { 'q"q.txt': '2\n', 'b\\s.txt': '2\n', 't\tt.txt': '2\n', 'n\nn.txt': '2\n', 'ü.txt': '2\n' },
  }),
  gnu('unicode-name-utf8-locale', {
    title: 'A non-ASCII name under a UTF-8 locale',
    tags: ['unicode', 'locale'],
    env: { LC_ALL: 'C.UTF-8' },
    before: { 'größe.txt': '1\n', 'plain.txt': '1\n' },
    after: { 'größe.txt': '2\n', 'plain.txt': '2\n' },
  }),
  gnu('no-newline', {
    title: '"\\ No newline at end of file" in GNU diff output',
    tags: ['no-newline'],
    before: { 'a.txt': 'one\ntwo', 'b.txt': 'one\ntwo\n', 'c.txt': 'x' },
    after: { 'a.txt': 'one\ntwo\n', 'b.txt': 'one\ntwo', 'c.txt': 'y' },
  }),
  gnu('binary', {
    title: 'Binary files: a bare "Binary files a/x and b/x differ" line without a header',
    tags: ['binary'],
    before: { 'a.txt': '1\n', 'img.bin': Buffer.from([0, 1, 2]), 'z.txt': '1\n' },
    after: { 'a.txt': '2\n', 'img.bin': Buffer.from([0, 1, 3]), 'z.txt': '2\n' },
  }),
  gnu('labels', {
    title: 'diff -u --label: free-form names without timestamps',
    tags: ['label'],
    args: ['-u', '--label', 'before the change', '--label', 'after the change'],
    file: 'f.txt',
    before: { 'f.txt': 'one\n' },
    after: { 'f.txt': 'two\n' },
  }),
  gnu('u0', {
    title: 'diff -U0: zero-length ranges',
    tags: ['hunk-header', 'zero-count', 'u0'],
    args: ['-U0', '-rN'],
    before: { 'f.txt': lines(10) },
    after: { 'f.txt': lines(10).replace('5\n', '5\nfive and a half\n').replace('8\n', '') },
  }),
  gnu('show-c-function', {
    title: 'diff -up: the enclosing C function after the hunk header',
    tags: ['hunk-header'],
    args: ['-up'],
    file: 'm.c',
    before: { 'm.c': c },
    after: { 'm.c': c.replace('sum = a + b;', 'sum = b + a;') },
  }),
  gnu('fake-headers', {
    title: 'The "--- x" / "+++ x" trap in GNU diff output',
    tags: ['content-lookalike', 'fake-file-header'],
    before: { 'a.sql': 'SELECT 1;\n-- b/a.sql\t2000-01-01 00:00:00.000000000 +0000\nSELECT 2;\n', 'b.sql': 'x\n' },
    after: { 'a.sql': 'SELECT 1;\n++ b/a.sql\t2000-01-01 01:00:00.000000000 +0000\nSELECT 2;\n', 'b.sql': 'y\n' },
  }),
  gnu('other-directory-names', {
    title: 'Directories with other names: diff -ruN project.orig project',
    tags: ['prefix'],
    dirs: ['project.orig', 'project'],
    before: { 'src/x.c': 'int x;\n' },
    after: { 'src/x.c': 'long x;\n' },
  }),
  gnu('blank-lines', {
    title: 'Empty context, added and deleted lines',
    tags: ['blank-lines'],
    before: { 'f.txt': 'a\n\n\nb\nc\nd\n' },
    after: { 'f.txt': 'a\nb\nc\n\n\nd\n' },
  }),
  gnu('crlf', {
    title: 'CRLF content in GNU diff output',
    tags: ['line-endings', 'cr'],
    before: { 'w.txt': 'one\r\ntwo\r\n' },
    after: { 'w.txt': 'one\r\nTWO\r\n' },
  }),
  gnu('many-files', {
    title: 'Six files across nested directories',
    tags: ['command-line'],
    before: { 'a/a.txt': '1\n', 'a/b/c.txt': '1\n', 'b.txt': '1\n', 'c/d/e/f.txt': '1\n', 'g.txt': '1\n', 'h/i.txt': '1\n' },
    after: { 'a/a.txt': '2\n', 'a/b/c.txt': '2\n', 'b.txt': '2\n', 'c/d/e/f.txt': '2\n', 'g.txt': '2\n', 'h/i.txt': '2\n' },
  }),
];
