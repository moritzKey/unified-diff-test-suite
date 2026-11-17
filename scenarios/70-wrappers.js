// Diffs with something around them.
//
// `git show`, `git log -p` and `git format-patch` wrap the patch in commit
// headers, messages, statistics and mail signatures. A parser has to skip all
// of it - and must not mistake prose for a patch, nor the "-- " that ends a
// format-patch mail for a deleted line.

import { wrapped, lines, x } from './_dsl.js';

const three = [
  { message: 'Initial import', files: { 'app.py': 'import sys\n\nprint("one")\n', 'README': 'readme\n' } },
  { message: 'Say two\n\nThe greeting is now a two.', files: { 'app.py': 'import sys\n\nprint("two")\n', 'README': 'readme\n' } },
  { message: 'Add a changelog and say three', files: { 'app.py': 'import sys\n\nprint("three")\n', 'README': 'readme\n', 'CHANGES': '- three\n' } },
];

const messageWithDiff = `Explain the parser fix

The old code split this header at the wrong place:

diff --git a/my file.txt b/my file.txt
index 1111111..2222222 100644
--- a/my file.txt
+++ b/my file.txt
@@ -1 +1 @@
-old
+new

Binary files are detected first now.`;

export const scenarios = [
  wrapped('show', {
    title: 'git show: a commit header and message before the diff',
    tags: ['prelude'],
    kind: 'git-show',
    states: three.slice(0, 2),
  }),
  wrapped('show-root-commit', {
    title: 'git show of the first commit: everything is an addition',
    tags: ['prelude', 'added'],
    kind: 'git-show',
    to: 0,
    states: three.slice(0, 1),
  }),
  wrapped('log-three-commits', {
    title: 'git log -p: three commits, each with its own diff',
    why: 'After the last hunk of one commit comes a blank line and the next commit header.',
    tags: ['prelude', 'multiple-commits'],
    kind: 'git-log',
    states: three,
  }),
  wrapped('log-message-contains-a-diff', {
    mustContain: ["\n    diff --git a/my file.txt b/my file.txt\n"],
    title: 'git log -p: a commit message that quotes a diff',
    why: 'The message is indented by four spaces. Parsers that trim lines, or that search for "diff --git" anywhere in a line, find a patch that is not there.',
    tags: ['prelude', 'multiple-commits', 'content-lookalike', 'fake-file-header'],
    kind: 'git-log',
    states: [
      { message: 'Initial import', files: { 'parser.js': 'split(" ")\n' } },
      { message: messageWithDiff, files: { 'parser.js': 'splitInTheMiddle()\n' } },
    ],
  }),
  wrapped('log-empty-commit-between', {
    title: 'git log -p: a commit without changes between two commits with changes',
    tags: ['prelude', 'multiple-commits'],
    kind: 'git-log',
    states: [three[0], three[1], { message: 'Empty commit', files: three[1].files }, three[2]],
  }),
  wrapped('log-context-then-commit-header', {
    title: 'git log -p: the last hunk of a commit ends with context lines',
    why: 'What follows is the next commit header; a parser that reads "until something that is not a diff line" has to stop exactly here.',
    tags: ['prelude', 'multiple-commits'],
    kind: 'git-log',
    states: [
      { message: 'one', files: { 'f.txt': lines(8) } },
      { message: 'two', files: { 'f.txt': lines(8, (n) => (n === 2 ? 'two' : String(n))) } },
      { message: 'three', files: { 'f.txt': lines(8, (n) => (n === 2 ? 'two' : n === 3 ? 'three' : String(n))) } },
    ],
  }),
  wrapped('format-patch', {
    mustContain: ["\n-- \n"],
    title: 'git format-patch: mail headers, a "---" separator, a stat block and a "-- " signature',
    why: 'The mail signature "-- " directly follows the last hunk. Read as a diff line it is a deletion of the line "- ".',
    tags: ['prelude', 'mbox', 'signature'],
    kind: 'git-format-patch',
    states: three.slice(0, 2),
  }),
  wrapped('format-patch-series', {
    title: 'git format-patch: a series of two mails in one mbox',
    tags: ['prelude', 'mbox', 'signature', 'multiple-commits'],
    kind: 'git-format-patch',
    states: three,
  }),
  wrapped('format-patch-prose-with-keywords', {
    title: 'git format-patch: message lines that start with words a parser looks for',
    why: 'The message body is not indented in a mail. Lines beginning with "Binary", "index" or "new file" are prose here.',
    tags: ['prelude', 'mbox', 'signature', 'content-lookalike'],
    kind: 'git-format-patch',
    states: [
      { message: 'Initial import', files: { 'reader.c': 'int read(void);\n' } },
      {
        message:
          'Detect binary files earlier\n\nBinary files are now detected before the name is read.\nindex entries keep their mode.\nnew file mode bits are preserved.\nsimilarity index is no longer rounded.\n\nSigned-off-by: A U Thor <author@example.com>',
        files: { 'reader.c': 'int read_header(void);\nint read(void);\n' },
      },
    ],
  }),
  wrapped('format-patch-no-newline-then-signature', {
    title: 'git format-patch: "\\ No newline at end of file" directly before the signature',
    tags: ['prelude', 'mbox', 'signature', 'no-newline'],
    kind: 'git-format-patch',
    states: [
      { message: 'one', files: { 'VERSION': '1' } },
      { message: 'two', files: { 'VERSION': '2' } },
    ],
  }),
  wrapped('format-patch-deleted-dashes-then-signature', {
    title: 'git format-patch: a deleted "-- " line as the last line of the patch, then the real signature',
    tags: ['prelude', 'mbox', 'signature', 'content-lookalike'],
    kind: 'git-format-patch',
    states: [
      { message: 'one', files: { 'mail.txt': 'Bye\n-- \n' } },
      { message: 'two', files: { 'mail.txt': 'Bye\n' } },
    ],
  }),
  wrapped('stat-and-patch', {
    title: 'git diff --stat -p: a statistics block before the patch',
    tags: ['prelude', 'stat'],
    args: ['--stat', '-p'],
    before: { 'a.txt': '1\n', 'bin': Buffer.from([0, 1]), 'old name.txt': lines(9) },
    after: { 'a.txt': '2\n', 'bin': Buffer.from([0, 2]), 'new name.txt': lines(9), 'run.sh': x('#!/bin/sh\n') },
  }),
  wrapped('summary-and-patch', {
    title: 'git diff --summary -p: "create mode", "rename" and "mode change" lines before the patch',
    tags: ['prelude', 'stat'],
    args: ['--summary', '-p'],
    before: { 'a.txt': '1\n', 'old name.txt': lines(9), 'tool': '#!/bin/sh\n', 'gone.txt': 'x\n' },
    after: { 'a.txt': '2\n', 'new name.txt': lines(9), 'tool': x('#!/bin/sh\n'), 'made.txt': 'y\n' },
  }),
  wrapped('raw-and-patch', {
    title: 'git diff --patch-with-raw: raw records (":100644 100644 ...") before the patch',
    tags: ['prelude', 'stat'],
    args: ['--patch-with-raw'],
    before: { 'a.txt': '1\n', 'gone.txt': 'x\n' },
    after: { 'a.txt': '2\n', 'made.txt': 'y\n' },
  }),
  wrapped('numstat-shortstat-and-patch', {
    title: 'git diff --numstat --shortstat -p',
    tags: ['prelude', 'stat'],
    args: ['--numstat', '--shortstat', '-p'],
    before: { 'a.txt': '1\n' },
    after: { 'a.txt': '2\n', 'b.txt': '3\n' },
  }),
  wrapped('show-stat-patch', {
    title: 'git show --stat -p: commit header, then "---", then statistics, then the patch',
    tags: ['prelude', 'stat'],
    kind: 'git-show',
    args: ['--stat', '-p'],
    states: three.slice(0, 2),
  }),
  wrapped('log-oneline', {
    title: 'git log -p --oneline: one-line commit headers between the diffs',
    tags: ['prelude', 'multiple-commits'],
    kind: 'git-log',
    args: ['--oneline'],
    states: three,
  }),
];
