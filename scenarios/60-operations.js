// File-level operations: renames, copies, modes, symlinks, submodules, binary
// files, empty files. Many of these produce file sections WITHOUT "---"/"+++"
// lines and without hunks, where everything a parser can learn is in the
// extended header lines between "diff --git" and the next section.

import { git, x, link, sub, oid, bytes, lines } from './_dsl.js';

const text = lines(12, (n) => `line ${n}`);
const png = (seed) => bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, ...Array.from({ length: 96 }, (_, i) => (i * seed + 7) & 0xff));

export const scenarios = [
  // ---- renames ----
  git('ops/rename-pure', {
    mustContain: ["similarity index 100%\nrename from old.txt\nrename to new.txt\n"],
    title: 'A rename without content change: no index line, no "---"/"+++", no hunks',
    tags: ['rename', 'no-hunks'],
    before: { 'old.txt': text },
    after: { 'new.txt': text },
  }),
  git('ops/rename-and-edit', {
    title: 'A rename with a content change',
    tags: ['rename'],
    before: { 'old.txt': text },
    after: { 'new.txt': text.replace('line 7', 'line seven') },
  }),
  git('ops/rename-into-directory', {
    title: 'A file moved into a subdirectory',
    tags: ['rename', 'no-hunks'],
    before: { 'util.js': text },
    after: { 'lib/helpers/util.js': text },
  }),
  git('ops/rename-and-mode-change', {
    title: 'A rename that also makes the file executable',
    tags: ['rename', 'mode', 'no-hunks'],
    before: { 'script': text },
    after: { 'bin/script.sh': x(text) },
  }),
  git('ops/rename-edit-and-mode-change', {
    title: 'Renamed, edited and made executable at once',
    tags: ['rename', 'mode'],
    before: { 'script': text },
    after: { 'bin/script.sh': x(text.replace('line 3', 'line three')) },
  }),
  git('ops/rename-executable', {
    title: 'An executable file renamed, its mode unchanged',
    why: 'A rename that keeps the mode has no mode line: the new file is executable because the old one was.',
    mustContain: ["similarity index 100%\nrename from build.sh\nrename to make.sh\n"],
    tags: ['rename', 'mode', 'no-hunks'],
    before: { 'build.sh': x(text) },
    after: { 'make.sh': x(text) },
  }),
  git('ops/rename-and-edit-executable', {
    title: 'An executable file renamed and edited, its mode unchanged',
    tags: ['rename', 'mode'],
    before: { 'build.sh': x(text) },
    after: { 'make.sh': x(text.replace('line 3', 'line three')) },
  }),
  git('ops/renames-disabled', {
    title: 'The same rename with --no-renames: a deletion and an addition',
    tags: ['rename', 'added', 'deleted'],
    args: ['--no-renames'],
    before: { 'old.txt': text },
    after: { 'new.txt': text.replace('line 7', 'line seven') },
  }),
  git('ops/swap-two-files', {
    title: 'Two files exchange their contents: reported as two modifications',
    tags: ['rename'],
    before: { 'left.txt': lines(8, (n) => `left ${n}`), 'right.txt': lines(8, (n) => `right ${n}`) },
    after: { 'left.txt': lines(8, (n) => `right ${n}`), 'right.txt': lines(8, (n) => `left ${n}`) },
  }),
  git('ops/swap-two-files-break-rewrites', {
    title: 'The same swap with -B -M: two crossing renames',
    why: 'Each file is the rename target of the other. Applying the sections one after the other, in place, destroys one of them.',
    tags: ['rename', 'no-hunks'],
    args: ['-B', '-M'],
    mustContain: ['rename from left.txt\nrename to right.txt\n', 'rename from right.txt\nrename to left.txt\n'],
    // (git only considers files of 400 bytes or more for -B)
    before: { 'left.txt': lines(60, (n) => `left line ${n}`), 'right.txt': lines(60, (n) => `right line ${n}`) },
    after: { 'left.txt': lines(60, (n) => `right line ${n}`), 'right.txt': lines(60, (n) => `left line ${n}`) },
  }),
  git('ops/rewrite-with-dissimilarity', {
    title: 'A complete rewrite with -B: "dissimilarity index" and one all-minus, all-plus hunk',
    tags: ['rewrite'],
    args: ['-B'],
    mustContain: ['dissimilarity index '],
    before: { 'notes.txt': lines(40, (n) => `old thought number ${n}`) },
    after: { 'notes.txt': lines(36, (n) => `a new idea, the ${n}th`) },
  }),
  git('ops/rename-chain', {
    title: 'Three files rotate their names',
    tags: ['rename'],
    args: ['-B', '-M'],
    mustContain: ['rename from one.txt\nrename to two.txt\n', 'rename from two.txt\nrename to three.txt\n', 'rename from three.txt\nrename to one.txt\n'],
    before: { 'one.txt': lines(60, (n) => `uno linea ${n}`), 'two.txt': lines(60, (n) => `dos linea ${n}`), 'three.txt': lines(60, (n) => `tres linea ${n}`) },
    after: { 'one.txt': lines(60, (n) => `tres linea ${n}`), 'two.txt': lines(60, (n) => `uno linea ${n}`), 'three.txt': lines(60, (n) => `dos linea ${n}`) },
  }),

  // ---- copies ----
  git('ops/copy-pure', {
    mustContain: ["copy from template.txt\ncopy to instance.txt\n"],
    title: 'A copy (-C --find-copies-harder): "copy from"/"copy to", no hunks',
    tags: ['copy', 'no-hunks'],
    args: ['-C', '--find-copies-harder'],
    before: { 'template.txt': text },
    after: { 'template.txt': text, 'instance.txt': text },
  }),
  git('ops/copy-and-edit', {
    title: 'A copy with a change in the copy',
    tags: ['copy'],
    args: ['-C', '--find-copies-harder'],
    before: { 'template.txt': text },
    after: { 'template.txt': text, 'instance.txt': text.replace('line 2', 'line two') },
  }),
  git('ops/copy-and-rename-same-source', {
    title: 'One source, renamed once and copied once',
    tags: ['copy', 'rename', 'no-hunks'],
    args: ['-C'],
    before: { 'origin.txt': text },
    after: { 'first.txt': text, 'second.txt': text },
  }),

  // ---- modes ----
  git('ops/mode-change-only', {
    mustContain: ["old mode 100644\nnew mode 100755\n"],
    title: 'chmod +x: "old mode"/"new mode" and nothing else',
    tags: ['mode', 'no-hunks'],
    before: { 'run.sh': '#!/bin/sh\necho hi\n' },
    after: { 'run.sh': x('#!/bin/sh\necho hi\n') },
  }),
  git('ops/mode-change-and-edit', {
    title: 'chmod +x together with an edit: the index line carries no mode',
    tags: ['mode'],
    before: { 'run.sh': '#!/bin/sh\necho hi\n' },
    after: { 'run.sh': x('#!/bin/sh\necho hello\n') },
  }),
  git('ops/mode-removed', {
    title: 'chmod -x',
    tags: ['mode', 'no-hunks'],
    before: { 'run.sh': x('#!/bin/sh\n') },
    after: { 'run.sh': '#!/bin/sh\n' },
  }),
  git('ops/new-executable', {
    title: 'A new executable file ("new file mode 100755")',
    tags: ['mode', 'added'],
    before: {},
    after: { 'tool': x('#!/bin/sh\nexit 0\n') },
  }),
  git('ops/deleted-executable', {
    title: 'A deleted executable file ("deleted file mode 100755")',
    tags: ['mode', 'deleted'],
    before: { 'tool': x('#!/bin/sh\nexit 0\n') },
    after: {},
  }),

  // ---- empty files ----
  git('ops/empty-file-added', {
    title: 'A new empty file: a header, an index line and nothing else',
    why: 'There is no "+++ b/name" line to read the name from.',
    tags: ['empty-file', 'added', 'no-hunks'],
    before: { 'keep.txt': 'k\n' },
    after: { 'keep.txt': 'k\n', '.gitkeep': '' },
  }),
  git('ops/empty-file-deleted', {
    title: 'A deleted empty file',
    tags: ['empty-file', 'deleted', 'no-hunks'],
    before: { 'keep.txt': 'k\n', '.gitkeep': '' },
    after: { 'keep.txt': 'k\n' },
  }),
  git('ops/empty-file-renamed', {
    title: 'An empty file "renamed": git pairs any deleted empty file with any added one',
    tags: ['empty-file', 'rename', 'no-hunks'],
    before: { 'a/.gitkeep': '' },
    after: { 'b/.gitkeep': '' },
  }),
  git('ops/empty-files-between-others', {
    title: 'Sections without hunks between sections with hunks',
    tags: ['empty-file', 'added', 'deleted', 'no-hunks'],
    args: ['--no-renames'],
    before: { 'a.txt': '1\n', 'b.empty': '', 'c.txt': '1\n', 'e.txt': '1\n' },
    after: { 'a.txt': '2\n', 'c.txt': '2\n', 'd.empty': '', 'e.txt': '2\n' },
  }),

  // ---- symlinks ----
  git('ops/symlink-added', {
    title: 'A new symbolic link ("new file mode 120000")',
    tags: ['symlink', 'added', 'no-newline'],
    before: {},
    after: { 'latest': link('releases/2.0') },
  }),
  git('ops/symlink-deleted', {
    title: 'A deleted symbolic link',
    tags: ['symlink', 'deleted', 'no-newline'],
    before: { 'latest': link('releases/2.0') },
    after: {},
  }),
  git('ops/file-becomes-symlink', {
    mustContain: ["deleted file mode 100644","new file mode 120000"],
    title: 'A regular file replaced by a symbolic link: two sections for one path',
    why: 'A type change is written as a deletion followed by an addition of the same path.',
    tags: ['symlink', 'typechange', 'added', 'deleted'],
    before: { 'config': 'value = 1\n' },
    after: { 'config': link('config.default') },
  }),
  git('ops/symlink-becomes-file', {
    title: 'A symbolic link replaced by a regular file',
    tags: ['symlink', 'typechange', 'added', 'deleted'],
    before: { 'config': link('config.default') },
    after: { 'config': 'value = 1\n' },
  }),
  git('ops/symlink-with-odd-target', {
    title: 'A symbolic link whose target contains a newline and looks like a header',
    tags: ['symlink', 'content-lookalike', 'no-newline'],
    before: { 'odd': link('first') },
    after: { 'odd': link('-- a/x\n++ b/x') },
  }),

  // ---- submodules ----
  git('ops/submodule-added', {
    title: 'A new submodule ("new file mode 160000")',
    tags: ['submodule', 'added'],
    before: { 'README': 'r\n' },
    after: { 'README': 'r\n', 'vendor/lib': sub(oid(1)) },
  }),
  git('ops/submodule-updated', {
    title: 'A submodule moved to another commit: a one-line "Subproject commit" hunk',
    tags: ['submodule'],
    before: { 'vendor/lib': sub(oid(1)) },
    after: { 'vendor/lib': sub(oid(2)) },
  }),
  git('ops/submodule-removed', {
    title: 'A removed submodule',
    tags: ['submodule', 'deleted'],
    before: { 'vendor/lib': sub(oid(1)) },
    after: {},
  }),
  git('ops/directory-becomes-submodule', {
    title: 'A file replaced by a submodule at the same path',
    tags: ['submodule', 'typechange', 'added', 'deleted'],
    before: { 'vendor': 'placeholder\n' },
    after: { 'vendor': sub(oid(3)) },
  }),

  // ---- binary ----
  git('ops/binary-modified', {
    title: 'A modified binary file: "Binary files a/x and b/x differ"',
    tags: ['binary', 'no-hunks'],
    before: { 'logo.png': png(3) },
    after: { 'logo.png': png(5) },
  }),
  git('ops/binary-added', {
    title: 'A new binary file: "Binary files /dev/null and b/x differ"',
    tags: ['binary', 'added', 'no-hunks'],
    before: {},
    after: { 'logo.png': png(3) },
  }),
  git('ops/binary-deleted', {
    title: 'A deleted binary file',
    tags: ['binary', 'deleted', 'no-hunks'],
    before: { 'logo.png': png(3) },
    after: {},
  }),
  git('ops/binary-with-space-and-and', {
    title: 'A binary file named "salt and pepper.bin"',
    why: 'The notice "Binary files a/salt and pepper.bin and b/salt and pepper.bin differ" cannot be split at " and ".',
    tags: ['binary', 'space-in-path', 'header-ambiguity', 'no-hunks'],
    before: { 'salt and pepper.bin': png(3) },
    after: { 'salt and pepper.bin': png(5) },
  }),
  git('ops/binary-with-non-ascii-name', {
    title: 'A binary file with a non-ASCII name: quoted names inside the "Binary files ... differ" notice',
    why: 'Images and documents are the files most likely to have names outside ASCII.',
    tags: ['binary', 'quoted-path', 'unicode', 'no-hunks'],
    before: { 'bilder/größe.png': png(3) },
    after: { 'bilder/größe.png': png(5), 'bilder/neu für später.png': png(7) },
  }),
  git('ops/binary-patch-literal', {
    mustContain: ["GIT binary patch\nliteral "],
    title: 'git diff --binary: a "GIT binary patch" with literal blocks',
    why: 'Base85 lines are free-form text between the header and a blank line; they may begin with any letter.',
    tags: ['binary', 'binary-patch'],
    args: ['--binary'],
    before: { 'logo.png': png(3) },
    after: { 'logo.png': png(5) },
  }),
  git('ops/binary-patch-delta', {
    mustContain: ["GIT binary patch\ndelta "],
    title: 'git diff --binary: a small change in a large file gives delta blocks',
    tags: ['binary', 'binary-patch'],
    args: ['--binary'],
    before: { 'blob.bin': Buffer.concat([Buffer.alloc(4), Buffer.from(Array.from({ length: 4000 }, (_, i) => (i * 31 + (i >> 3)) & 0xff))]) },
    after: { 'blob.bin': Buffer.concat([Buffer.alloc(4), Buffer.from(Array.from({ length: 4000 }, (_, i) => (i === 2000 ? 1 : (i * 31 + (i >> 3)) & 0xff)))]) },
  }),
  git('ops/binary-patch-added-and-deleted', {
    title: 'git diff --binary: a binary file added and another deleted',
    tags: ['binary', 'binary-patch', 'added', 'deleted'],
    args: ['--binary', '--no-renames'],
    before: { 'old.bin': png(3) },
    after: { 'new.bin': png(7) },
  }),
  git('ops/binary-between-text', {
    title: 'A binary change between two text changes',
    tags: ['binary', 'no-hunks'],
    before: { 'a.txt': '1\n', 'm.bin': png(3), 'z.txt': '1\n' },
    after: { 'a.txt': '2\n', 'm.bin': png(5), 'z.txt': '2\n' },
  }),
  git('ops/binary-renamed-and-changed', {
    title: 'A binary file renamed and modified',
    tags: ['binary', 'rename', 'no-hunks'],
    args: ['-M30%'],
    before: { 'img/a.png': png(3) },
    after: { 'img/b.png': Buffer.concat([png(3), bytes(1, 2, 3)]) },
  }),
  git('ops/text-becomes-binary', {
    title: 'A text file that turns binary',
    tags: ['binary', 'no-hunks'],
    before: { 'data': 'plain text\n' },
    after: { 'data': bytes(0, 1, 2, 3) },
  }),

  // ---- deletions and replacements ----
  git('ops/irreversible-delete', {
    mustContain: ["deleted file mode 100644\nindex "],
    title: 'git diff -D: a deletion without its content',
    why: '"deleted file mode" and an index line, but neither "---"/"+++" nor a hunk.',
    tags: ['deleted', 'no-hunks'],
    args: ['-D'],
    before: { 'gone.txt': 'a\nb\nc\n', 'stay.txt': '1\n' },
    after: { 'stay.txt': '2\n' },
  }),
  git('ops/file-becomes-directory', {
    title: 'A file replaced by a directory of the same name',
    tags: ['added', 'deleted'],
    before: { 'thing': 'i was a file\n' },
    after: { 'thing/inside.txt': 'i am inside\n' },
  }),
  git('ops/everything-at-once', {
    title: 'Added, deleted, modified, renamed, copied, chmod, symlink, submodule and binary in one diff',
    tags: ['rename', 'copy', 'mode', 'symlink', 'submodule', 'binary', 'added', 'deleted'],
    args: ['-C', '--find-copies-harder'],
    before: {
      'a-modified.txt': text,
      'b-deleted.txt': 'bye\n',
      'c-renamed-from.txt': lines(9, (n) => `ren ${n}`),
      'd-copied-from.txt': lines(9, (n) => `cp ${n}`),
      'e-mode.sh': '#!/bin/sh\n',
      'f-link': link('one'),
      'g-sub': sub(oid(4)),
      'h-bin': png(3),
    },
    after: {
      'a-modified.txt': text.replace('line 5', 'line five'),
      'b-added.txt': 'hello\n',
      'c-renamed-to.txt': lines(9, (n) => `ren ${n}`),
      'd-copied-from.txt': lines(9, (n) => `cp ${n}`),
      'd-copied-to.txt': lines(9, (n) => (n === 9 ? 'cp nine' : `cp ${n}`)),
      'e-mode.sh': x('#!/bin/sh\n'),
      'f-link': link('two'),
      'g-sub': sub(oid(5)),
      'h-bin': png(5),
    },
  }),
];
