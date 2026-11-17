// Line terminators, control characters and encodings inside content.
//
// A diff is split into lines at LF and nowhere else. Carriage returns, form
// feeds, U+2028 and the other characters that some string libraries treat as
// "line boundaries" are ordinary bytes of the line. Python's str.splitlines(),
// for instance, splits at eleven different characters; a regular expression
// like /\r?\n|\r/ splits at a lone CR.

import { git, bytes } from './_dsl.js';

const crlf = (s) => s.replace(/\n/g, '\r\n');

export const scenarios = [
  git('bytes/crlf-file-modified', {
    title: 'A file with CRLF line endings: every content line ends with CR',
    tags: ['line-endings', 'cr'],
    before: { 'win.txt': crlf('one\ntwo\nthree\n') },
    after: { 'win.txt': crlf('one\nTWO\nthree\n') },
  }),
  git('bytes/lf-to-crlf', {
    title: 'Line endings converted from LF to CRLF: every line changes',
    tags: ['line-endings', 'cr'],
    before: { 'conv.txt': 'one\ntwo\n' },
    after: { 'conv.txt': crlf('one\ntwo\n') },
  }),
  git('bytes/mixed-line-endings', {
    title: 'Mixed LF and CRLF endings in one file',
    tags: ['line-endings', 'cr'],
    before: { 'mixed.txt': 'a\r\nb\nc\r\nd\n' },
    after: { 'mixed.txt': 'a\nb\r\nc\r\nD\n' },
  }),
  git('bytes/mixed-line-endings-change-elsewhere', {
    title: 'Mixed endings: only the first line ends with CRLF, and the change is near the end',
    tags: ['line-endings', 'cr'],
    before: { 'notes.txt': 'title\r\n1\n2\n3\n4\n5\n6\n7\n8\n' },
    after: { 'notes.txt': 'title\r\n1\n2\n3\n4\n5\n6\n7\neight\n' },
  }),
  git('bytes/mixed-line-endings-renamed', {
    mustContain: ['similarity index 100%\nrename from old.txt\nrename to new.txt\n'],
    title: 'A file with mixed line endings renamed without a change: no hunks to see them in',
    tags: ['line-endings', 'cr', 'rename', 'no-hunks'],
    before: { 'old.txt': 'a\nb\r\nc\n' },
    after: { 'new.txt': 'a\nb\r\nc\n' },
  }),
  git('bytes/lone-cr-inside-line', {
    title: 'A lone CR in the middle of a line is not a line break',
    tags: ['line-endings', 'cr', 'line-splitting'],
    before: { 'progress.log': 'step 1\rstep 2\rdone\nnext\n' },
    after: { 'progress.log': 'step 1\rstep 2\rstep 3\rdone\nnext\n' },
  }),
  git('bytes/classic-mac-file', {
    title: 'A file that uses CR as its only line terminator is one long line without a final newline',
    tags: ['line-endings', 'cr', 'line-splitting', 'no-newline'],
    before: { 'old-mac.txt': 'one\rtwo\rthree\r' },
    after: { 'old-mac.txt': 'one\rTWO\rthree\r' },
  }),
  git('bytes/form-feed', {
    title: 'Form feed (page break) characters inside lines',
    why: 'Common in older C, Emacs Lisp and Python sources. str.splitlines() in Python treats U+000C as a line boundary.',
    tags: ['control-chars', 'line-splitting'],
    before: { 'paged.el': ';;; a\n\f\n;;; b\n(provide \'x)\n' },
    after: { 'paged.el': ';;; a\n\f;;; page two\n;;; b\n(provide \'y)\f\n' },
  }),
  git('bytes/vertical-tab-and-separators', {
    title: 'VT, FS, GS, RS and US control characters inside lines',
    tags: ['control-chars', 'line-splitting'],
    before: { 'ctl.txt': 'a\x0bb\nc\x1cd\ne\x1df\ng\x1eh\ni\x1fj\n' },
    after: { 'ctl.txt': 'a\x0bB\nc\x1cD\ne\x1dF\ng\x1eH\ni\x1fJ\n' },
  }),
  git('bytes/unicode-line-separators', {
    title: 'U+2028, U+2029 and U+0085 inside lines',
    why: 'JavaScript regular expressions, Python splitlines() and several other libraries treat these as line terminators.',
    tags: ['unicode', 'line-splitting'],
    before: { 'i18n.json': '{"a": "x y", "b": "p q", "c": "m\u0085n"}\nend\n' },
    after: { 'i18n.json': '{"a": "x Y", "b": "p Q", "c": "m\u0085N"}\nend\n' },
  }),
  git('bytes/nul-with-text-option', {
    title: 'NUL bytes shown as text (git diff --text)',
    tags: ['control-chars', 'nul'],
    args: ['--text'],
    before: { 'rec.dat': bytes(...Buffer.from('key\0value\nend\n')) },
    after: { 'rec.dat': bytes(...Buffer.from('key\0VALUE\nend\n')) },
  }),
  git('bytes/escape-sequences', {
    title: 'ANSI escape sequences and BEL inside lines',
    tags: ['control-chars'],
    before: { 'colour.txt': '\x1b[31mred\x1b[0m\nplain\x07\n' },
    after: { 'colour.txt': '\x1b[32mgreen\x1b[0m\nplain\n' },
  }),
  git('bytes/bom-added', {
    title: 'A UTF-8 byte order mark added at the start of a file',
    tags: ['unicode', 'bom'],
    before: { 'data.csv': 'id,name\n1,x\n' },
    after: { 'data.csv': '﻿id,name\n1,x\n' },
  }),
  git('bytes/unicode-content', {
    title: 'Non-ASCII content: accents, CJK, emoji, combining marks, right-to-left text',
    tags: ['unicode'],
    before: { 'hello.txt': 'Grüße\n你好\n👋🏽\né\nשלום\n' },
    after: { 'hello.txt': 'Grüße!\n您好\n👋🏿\né\nשלום עולם\n' },
  }),
  git('bytes/tabs-and-trailing-spaces', {
    title: 'Tabs inside lines and whitespace at line ends',
    tags: ['whitespace'],
    before: { 'Makefile': 'all:\n\tcc -o x x.c  \n\n.PHONY: all\t\n' },
    after: { 'Makefile': 'all:\n\tcc -O2 -o x x.c\t \n\n.PHONY: all\n' },
  }),
  git('bytes/long-line', {
    title: 'A 64 KiB line',
    tags: ['long-line'],
    before: { 'min.js': `var a="${'x'.repeat(65536)}";\nvar b=1;\n` },
    after: { 'min.js': `var a="${'x'.repeat(65536)}";\nvar b=2;\n` },
  }),
  git('bytes/latin1-content', {
    title: 'Content that is not valid UTF-8 (ISO-8859-1)',
    why: 'git does not care about encodings; the diff carries the bytes as they are. A parser that insists on UTF-8 fails or silently replaces bytes.',
    tags: ['non-utf8', 'encoding'],
    before: { 'legacy.txt': bytes(0x47, 0x72, 0xfc, 0xdf, 0x65, 0x0a, 0x65, 0x6e, 0x64, 0x0a) },
    after: { 'legacy.txt': bytes(0x47, 0x72, 0xfc, 0xdf, 0x65, 0x21, 0x0a, 0x65, 0x6e, 0x64, 0x0a) },
  }),
  git('bytes/whitespace-only-change', {
    title: 'Only the amount of whitespace changes',
    tags: ['whitespace'],
    before: { 'w.txt': 'a b\n\tc\nd  \n' },
    after: { 'w.txt': 'a  b\n    c\nd\n' },
  }),
];
