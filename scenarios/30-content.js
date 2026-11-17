// Content that looks like diff syntax.
//
// A diff line is one marker character followed by the file's line. If the
// file's line itself starts with "-- " or "++ ", the result begins with "--- "
// or "+++ " - exactly like a file header. A parser must therefore know whether
// it is inside a hunk, and the only reliable way to know is to count the lines
// the hunk header announced.

import { git, lines } from './_dsl.js';

const sql = (comment) => `CREATE TABLE users (\n  id INTEGER PRIMARY KEY\n);\n${comment}CREATE INDEX users_id ON users (id);\n`;

export const scenarios = [
  git('content/deleted-double-dash-comment', {
    mustContain: ["\n--- speed up lookups\n"],
    title: 'Deleting a "-- comment" line (SQL, Lua, Haskell, Ada) yields "--- comment"',
    why: 'The most common way to meet this trap: every SQL migration that removes a comment at the start of a line.',
    tags: ['content-lookalike', 'fake-file-header'],
    before: { 'schema.sql': sql('-- speed up lookups\n') },
    after: { 'schema.sql': sql('') },
  }),
  git('content/added-double-plus-line', {
    title: 'Adding a line that starts with "++ " yields "+++ ..."',
    tags: ['content-lookalike', 'fake-file-header'],
    before: { 'concat.hs': 'message =\n  "hello"\n' },
    after: { 'concat.hs': 'message =\n  "hello"\n++ " world"\n' },
  }),
  git('content/fake-header-pair', {
    title: 'A deleted "-- a/x" next to an added "++ b/x" reads exactly like a file header pair',
    tags: ['content-lookalike', 'fake-file-header'],
    before: { 'notes.txt': 'intro\n-- a/config.yml\noutro\n' },
    after: { 'notes.txt': 'intro\n++ b/config.yml\noutro\n' },
  }),
  git('content/fake-header-pair-before-next-hunk', {
    mustContain: ["@@ -3 +3 @@\n--- a/secrets.env\n+++ b/secrets.env\n@@ -7 +7 @@\n"],
    title: 'A fake header pair at the end of one hunk, immediately followed by the next hunk',
    why: 'With -U0 the second hunk header follows directly, so "--- a/x", "+++ b/x", "@@ ..." appear in a row in the middle of one file. A parser that does not count lines attributes the second hunk to a file "x" that is not part of the diff.',
    tags: ['content-lookalike', 'fake-file-header', 'u0'],
    args: ['-U0'],
    before: { 'notes.txt': `1\n2\n-- a/secrets.env\n4\n5\n6\npassword = "old"\n8\n` },
    after: { 'notes.txt': `1\n2\n++ b/secrets.env\n4\n5\n6\npassword = "new"\n8\n` },
  }),
  git('content/bare-triple-dash', {
    title: 'Deleting a line "--" yields a bare "---"',
    tags: ['content-lookalike', 'fake-file-header'],
    before: { 'mail.txt': 'Regards\n--\nAlice\n' },
    after: { 'mail.txt': 'Regards\nAlice\n' },
  }),
  git('content/bare-triple-plus', {
    title: 'Adding a line "++" yields a bare "+++"',
    tags: ['content-lookalike', 'fake-file-header'],
    before: { 'ops.txt': 'a\nb\n' },
    after: { 'ops.txt': 'a\n++\nb\n' },
  }),
  git('content/signature-separator', {
    title: 'Deleting an e-mail signature separator "-- " yields "--- " with nothing after it',
    tags: ['content-lookalike', 'fake-file-header', 'whitespace'],
    before: { 'mail.txt': 'See you.\n-- \nBob\n' },
    after: { 'mail.txt': 'See you.\nBob\n' },
  }),
  git('content/markdown-rule-and-front-matter', {
    title: 'Markdown front matter and rules: lines of "---" added and deleted',
    why: 'A deleted "---" becomes "----", an added one "+---".',
    tags: ['content-lookalike'],
    before: { 'post.md': '---\ntitle: Old\n---\n\nText\n\n---\n\nMore\n' },
    after: { 'post.md': 'title: New\n\nText\n\nMore\n---\n' },
  }),
  git('content/c-decrement-and-increment', {
    title: 'C statements "--count;" deleted and "++count;" added at column 0',
    tags: ['content-lookalike', 'fake-file-header'],
    before: { 'macro.c': '#define STEP \\\n--count;\nint x;\n' },
    after: { 'macro.c': '#define STEP \\\n++count;\nint x;\n' },
  }),
  git('content/lines-of-only-markers', {
    title: 'Lines that consist only of "+", "-" and spaces',
    tags: ['content-lookalike'],
    before: { 'art.txt': '+\n-\n \n+-+\n--\n++\n' },
    after: { 'art.txt': '-\n+\n \n-+-\n++\n--\n+\n' },
  }),
  git('content/hunk-header-as-content', {
    title: 'File lines that look like hunk headers',
    tags: ['content-lookalike', 'fake-hunk-header'],
    before: { 'doc.txt': 'see below\n@@ -1,3 +1,3 @@\nold text\nend\n' },
    after: { 'doc.txt': 'see below\n@@ -9,9 +9,9 @@ fake\nnew text\nend\n' },
  }),
  git('content/section-heading-contains-hunk-header', {
    mustContain: ["@@ label @@ -90,7 +91,8 @@ label\n"],
    title: 'A hunk header whose function-context text contains another "@@ -a,b +c,d @@"',
    why: 'git copies a nearby line that starts with a letter into the header. Splitting the header at the last "@@" gives the wrong numbers.',
    tags: ['content-lookalike', 'fake-hunk-header', 'hunk-header'],
    before: { 'log.txt': `label @@ -90,7 +91,8 @@ label\n${lines(8)}` },
    after: { 'log.txt': `label @@ -90,7 +91,8 @@ label\n${lines(8, (n) => (n === 6 ? 'six' : String(n)))}` },
  }),
  git('content/section-heading-with-control-characters', {
    title: 'A hunk header whose function-context text contains a carriage return and U+2028',
    why: 'The text after the closing "@@" is copied from a line of the file and can contain any byte but LF. A regular expression whose "." stops at line terminators cuts it short.',
    tags: ['hunk-header', 'cr', 'unicode', 'line-splitting'],
    before: { 'log.txt': `progress\r50%\u2028done\n${lines(8)}` },
    after: { 'log.txt': `progress\r50%\u2028done\n${lines(8, (n) => (n === 6 ? 'six' : String(n)))}` },
  }),
  git('content/diff-git-line-as-content', {
    title: 'File lines that read "diff --git a/x b/x"',
    tags: ['content-lookalike', 'fake-file-header'],
    before: { 'howto.txt': 'Run this:\ndiff --git a/one b/one\nthen that.\n' },
    after: { 'howto.txt': 'Run this:\ndiff --git a/two b/two\nthen that.\nindex 1234567..89abcde 100644\n' },
  }),
  git('content/extended-headers-as-content', {
    title: 'File lines that read like git extended headers',
    tags: ['content-lookalike', 'fake-file-header'],
    before: { 'headers.txt': 'new file mode 100644\nrename from a.txt\nrename to b.txt\nsimilarity index 90%\nkeep\n' },
    after: { 'headers.txt': 'deleted file mode 100644\ncopy from a.txt\ncopy to b.txt\nBinary files a/x and b/x differ\nkeep\n' },
  }),
  git('content/patch-file-modified', {
    title: 'A diff of a patch file: every line of the inner patch is content',
    why: 'Repositories that carry patches (distribution packaging, patch-package, vendored fixes) produce diffs of diffs every day.',
    tags: ['content-lookalike', 'fake-file-header', 'fake-hunk-header'],
    before: {
      'patches/fix.patch':
        'diff --git a/lib/x.js b/lib/x.js\nindex 1111111..2222222 100644\n--- a/lib/x.js\n+++ b/lib/x.js\n@@ -1,3 +1,3 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n const c = 4;\n',
    },
    after: {
      'patches/fix.patch':
        'diff --git a/lib/y.js b/lib/y.js\nindex 1111111..3333333 100644\n--- a/lib/y.js\n+++ b/lib/y.js\n@@ -1,3 +1,4 @@\n const a = 1;\n-const b = 2;\n+const b = 5;\n+const d = 6;\n const c = 4;\n',
    },
  }),
  git('content/patch-file-added', {
    title: 'A new patch file: the inner "--- a/x" and "+++ b/x" become "+--- a/x" and "++++ b/x"',
    tags: ['content-lookalike', 'added'],
    before: {},
    after: {
      'fix.patch': '--- a/x.txt\n+++ b/x.txt\n@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file\n',
    },
  }),
  git('content/patch-file-deleted', {
    title: 'A deleted patch file: the inner "--- a/x" becomes "---- a/x", the inner "-old" becomes "--old"',
    tags: ['content-lookalike', 'deleted'],
    before: {
      'fix.patch': '--- a/x.txt\n+++ b/x.txt\n@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file\n',
    },
    after: {},
  }),
  git('content/no-newline-text-as-content', {
    title: 'A file line that reads "\\ No newline at end of file"',
    why: 'As content it always follows a marker character; only a line that STARTS with a backslash is the real marker.',
    tags: ['content-lookalike', 'no-newline'],
    before: { 'faq.txt': 'Q: what does this mean?\n\\ No newline at end of file\nA: see below\n' },
    after: { 'faq.txt': 'Q: what does it mean?\n\\ No newline at end of file\nA: see above' },
  }),
  git('content/backslash-lines', {
    title: 'File lines that start with a backslash',
    tags: ['content-lookalike'],
    before: { 'tex.tex': '\\section{One}\n\\textbf{x}\n\\\\\n' },
    after: { 'tex.tex': '\\section{Two}\n\\textbf{x}\n\\\n' },
  }),
  git('content/deleted-comment-then-next-file', {
    title: 'A "--- comment" line as the last line of a file section, followed by another file',
    tags: ['content-lookalike', 'fake-file-header'],
    before: { 'a.sql': 'SELECT 1;\n-- trailing note\n', 'b.sql': 'SELECT 2;\n' },
    after: { 'a.sql': 'SELECT 1;\n', 'b.sql': 'SELECT 3;\n' },
  }),
  git('content/only-fake-headers', {
    title: 'A hunk that consists of nothing but fake headers',
    tags: ['content-lookalike', 'fake-file-header', 'u0'],
    args: ['-U0'],
    before: { 'x.lua': '-- one\n-- two\n-- three\n' },
    after: { 'x.lua': '++ one\n++ two\n++ three\n' },
  }),
  git('content/timestamp-like-lines', {
    title: 'Content lines that look like GNU diff headers with timestamps',
    tags: ['content-lookalike', 'fake-file-header'],
    before: { 'paste.txt': 'x\n-- a/file.c\t2024-01-01 10:00:00.000000000 +0100\ny\n' },
    after: { 'paste.txt': 'x\n++ b/file.c\t2024-01-02 11:00:00.000000000 +0100\ny\n' },
  }),
  git('content/index-line-as-content', {
    title: 'Deleted and added lines that read "Index: file" and "====="',
    tags: ['content-lookalike'],
    before: { 'svn.txt': 'Index: trunk/a.c\n===================================================================\nbody\n' },
    after: { 'svn.txt': 'Index: trunk/b.c\n===================================================================\nbody\nmore\n' },
  }),
];
