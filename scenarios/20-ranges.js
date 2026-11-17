// Hunk headers: "@@ -start,count +start,count @@".
//
// Two rules cause most of the trouble:
//   - a count of 1 is omitted ("-7" means "-7,1"), and
//   - when a count is 0 the start is the line BEFORE the change (0 at the top
//     of the file), because there is no line on that side to point at.
// Tools that ask for --unified=0 (linters that only look at changed lines,
// coverage tools, formatters) see zero counts all the time.

import { git, lines } from './_dsl.js';

const ten = lines(10);
const rep = (i, s) => lines(10, (n) => (n === i ? s : String(n)));

export const scenarios = [
  git('ranges/u0-insert', {
    mustContain: ["@@ -5,0 +6,2 @@"],
    title: '-U0: lines inserted in the middle ("-5,0")',
    why: 'The old range is empty, so its start names the line before the insertion.',
    tags: ['hunk-header', 'zero-count', 'u0'],
    args: ['-U0'],
    before: { 'f.txt': ten },
    after: { 'f.txt': ten.replace('5\n', '5\nfive and a half\nfive and three quarters\n') },
  }),
  git('ranges/u0-insert-one', {
    title: '-U0: a single line inserted ("-5,0 +6")',
    tags: ['hunk-header', 'zero-count', 'u0'],
    args: ['-U0'],
    before: { 'f.txt': ten },
    after: { 'f.txt': ten.replace('5\n', '5\nfive and a half\n') },
  }),
  git('ranges/u0-delete', {
    mustContain: ["@@ -3,2 +2,0 @@"],
    title: '-U0: lines deleted from the middle ("+2,0")',
    tags: ['hunk-header', 'zero-count', 'u0'],
    args: ['-U0'],
    before: { 'f.txt': ten },
    after: { 'f.txt': ten.replace('3\n4\n', '') },
  }),
  git('ranges/u0-replace', {
    title: '-U0: one line replaced by three',
    tags: ['hunk-header', 'u0'],
    args: ['-U0'],
    before: { 'f.txt': ten },
    after: { 'f.txt': ten.replace('5\n', 'five\nV\n5.0\n') },
  }),
  git('ranges/u0-insert-at-top', {
    mustContain: ["@@ -0,0 +1,2 @@"],
    title: '-U0: lines inserted before the first line ("-0,0")',
    why: 'An old start of 0 in a file that is not empty and is not new.',
    tags: ['hunk-header', 'zero-count', 'u0'],
    args: ['-U0'],
    before: { 'f.txt': ten },
    after: { 'f.txt': `zero\nnought\n${ten}` },
  }),
  git('ranges/u0-delete-first-line', {
    title: '-U0: the first line deleted ("+0,0")',
    tags: ['hunk-header', 'zero-count', 'u0'],
    args: ['-U0'],
    before: { 'f.txt': ten },
    after: { 'f.txt': ten.replace('1\n', '') },
  }),
  git('ranges/u0-append', {
    title: '-U0: lines appended at the end',
    tags: ['hunk-header', 'zero-count', 'u0'],
    args: ['-U0'],
    before: { 'f.txt': ten },
    after: { 'f.txt': `${ten}eleven\ntwelve\n` },
  }),
  git('ranges/u0-many-hunks', {
    title: '-U0: adjacent single-line hunks',
    tags: ['hunk-header', 'u0'],
    args: ['-U0'],
    before: { 'f.txt': ten },
    after: { 'f.txt': lines(10, (n) => (n % 2 ? `odd ${n}` : String(n))) },
  }),
  git('ranges/u0-mixed-file', {
    title: '-U0: insertion, deletion and replacement in one file',
    tags: ['hunk-header', 'zero-count', 'u0'],
    args: ['-U0'],
    before: { 'f.txt': lines(40) },
    after: {
      'f.txt': lines(40)
        .replace('4\n', '4\ninserted\n')
        .replace('17\n18\n19\n', '')
        .replace('30\n', 'thirty\n'),
    },
  }),
  git('ranges/emptied-file', {
    mustContain: ["@@ -1,3 +0,0 @@"],
    title: 'Every line deleted, but the file stays ("+0,0" without "deleted file")',
    why: 'Looks like a deletion in the hunk header alone; only the absence of "deleted file mode" and of /dev/null says the file still exists.',
    tags: ['hunk-header', 'zero-count', 'empty-file'],
    before: { 'notes.txt': 'one\ntwo\nthree\n' },
    after: { 'notes.txt': '' },
  }),
  git('ranges/filled-empty-file', {
    title: 'An existing empty file gets content ("-0,0" without "new file")',
    tags: ['hunk-header', 'zero-count', 'empty-file'],
    before: { 'notes.txt': '' },
    after: { 'notes.txt': 'one\ntwo\nthree\n' },
  }),
  git('ranges/u1', {
    title: '-U1: one line of context',
    tags: ['hunk-header'],
    args: ['-U1'],
    before: { 'f.txt': ten },
    after: { 'f.txt': rep(5, 'five') },
  }),
  git('ranges/u1-single-line-result', {
    title: '-U1 at the top of a file: old count 2, new count omitted',
    tags: ['hunk-header'],
    args: ['-U1'],
    before: { 'f.txt': ten },
    after: { 'f.txt': ten.replace('1\n', '') },
  }),
  git('ranges/u10-overlapping-context', {
    title: '-U10: nearby changes merge into one hunk',
    tags: ['hunk-header'],
    args: ['-U10'],
    before: { 'f.txt': lines(40) },
    after: { 'f.txt': lines(40, (n) => (n === 10 || n === 25 ? `changed ${n}` : String(n))) },
  }),
  git('ranges/function-context', {
    title: '--function-context: the whole function is context',
    tags: ['hunk-header'],
    args: ['-W'],
    before: { 'f.c': `int a(void)\n{\n${lines(12, (n) => `\tstep(${n});`)}}\n\nint b(void)\n{\n\treturn 1;\n}\n` },
    after: { 'f.c': `int a(void)\n{\n${lines(12, (n) => (n === 6 ? '\tstep(60);' : `\tstep(${n});`))}}\n\nint b(void)\n{\n\treturn 1;\n}\n` },
  }),
  git('ranges/replace-whole-file', {
    title: 'Every line replaced',
    tags: ['hunk-header'],
    before: { 'f.txt': 'a\nb\nc\nd\n' },
    after: { 'f.txt': 'w\nx\ny\nz\n' },
  }),
];
