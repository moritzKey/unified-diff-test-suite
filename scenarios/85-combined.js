// Combined diffs: what `git show` prints for a merge commit. (The vectors use
// `git show --format=` so that nothing but the diff is printed; one keeps the
// commit header.)
//
// A combined diff compares the result with every parent at once. Hunk headers
// have one "@" more than there are parents ("@@@ -1,5 -1,5 +1,6 @@@" for two)
// and every line has one marker column per parent. This is a different format
// that happens to share its first lines with the ordinary one; a parser either
// supports it or has to recognise it and say no.
//
// It also has a trap of its own: a line removed relative to both parents starts
// with "--". If the file's line is a Markdown bullet ("- item"), the result is
// "--- item".

import { merge, lines, x, bytes } from './_dsl.js';

const TWO = [[], [0], [0], [1, 2]];
const list = (...items) => `# Shopping\n\n${items.map((i) => `${i}\n`).join('')}`;

export const scenarios = [
  merge('cc/conflict-resolved', {
    title: 'git show of a merge that resolved a conflict by hand',
    tags: ['combined'],
    args: ['--format='],
    parents: TWO,
    states: [
      { message: 'base', files: { 'f.txt': lines(8) } },
      { message: 'ours', files: { 'f.txt': lines(8, (n) => (n === 4 ? 'four (ours)' : String(n))) } },
      { message: 'theirs', files: { 'f.txt': lines(8, (n) => (n === 4 ? 'four (theirs)' : String(n))) } },
      { message: 'Merge theirs into ours', files: { 'f.txt': lines(8, (n) => (n === 4 ? 'four (both)' : String(n))) } },
    ],
  }),
  merge('cc/markdown-bullets', {
    mustContain: ["\n--- bread\n+++ flour\n"],
    title: 'A merge that drops "- item" bullets and adds "+ item" bullets: "--- item" and "+++ item"',
    why: 'In a two-parent combined diff a line removed from both parents begins with "--" and a line new to both begins with "++".',
    tags: ['combined', 'content-lookalike', 'fake-file-header'],
    args: ['--format='],
    parents: TWO,
    states: [
      { message: 'base', files: { 'list.md': list('- apples', '- bread', '- cheese') } },
      { message: 'ours', files: { 'list.md': list('- apples', '- bread', '- cheese', '- dates') } },
      { message: 'theirs', files: { 'list.md': list('- apples', '- bread', '- cheese', '- eggs') } },
      { message: 'Merge', files: { 'list.md': list('- apples', '+ flour', '- cheese', '- dates', '- eggs') } },
    ],
  }),
  merge('cc/file-added-by-merge', {
    title: 'A file that exists in neither parent and is created by the merge',
    tags: ['combined', 'added'],
    args: ['--format='],
    parents: TWO,
    states: [
      { message: 'base', files: { 'a.txt': 'a\n' } },
      { message: 'ours', files: { 'a.txt': 'a\n', 'o.txt': 'o\n' } },
      { message: 'theirs', files: { 'a.txt': 'a\n', 't.txt': 't\n' } },
      { message: 'Merge', files: { 'a.txt': 'a\n', 'o.txt': 'o\n', 't.txt': 't\n', 'notes.txt': 'merged by hand\nsee ticket\n' } },
    ],
  }),
  merge('cc/file-deleted-by-merge', {
    title: 'A file that both parents have and the merge removes',
    tags: ['combined', 'deleted'],
    args: ['--format='],
    parents: TWO,
    states: [
      { message: 'base', files: { 'a.txt': 'a\n', 'old.txt': 'one\ntwo\n' } },
      { message: 'ours', files: { 'a.txt': 'A\n', 'old.txt': 'one\ntwo\n' } },
      { message: 'theirs', files: { 'a.txt': 'a\n', 'old.txt': 'one\ntwo\n', 'b.txt': 'b\n' } },
      { message: 'Merge', files: { 'a.txt': 'A\n', 'b.txt': 'b\n' } },
    ],
  }),
  merge('cc/octopus', {
    mustContain: ["@@@@ -"],
    title: 'A merge of three parents: four "@" and three marker columns',
    tags: ['combined', 'octopus'],
    args: ['--format='],
    parents: [[], [0], [0], [0], [1, 2, 3]],
    states: [
      { message: 'base', files: { 'f.txt': lines(6) } },
      { message: 'one', files: { 'f.txt': lines(6, (n) => (n === 3 ? 'three (one)' : String(n))) } },
      { message: 'two', files: { 'f.txt': lines(6, (n) => (n === 3 ? 'three (two)' : String(n))) } },
      { message: 'three', files: { 'f.txt': lines(6, (n) => (n === 3 ? 'three (three)' : String(n))) } },
      { message: 'Octopus merge', files: { 'f.txt': lines(6, (n) => (n === 3 ? 'three (all)' : String(n))) } },
    ],
  }),
  merge('cc/combined-format-c', {
    mustContain: ["diff --combined f.txt\n"],
    title: 'git show -c: "diff --combined" instead of "diff --cc"',
    tags: ['combined'],
    args: ['-c', '--format='],
    parents: TWO,
    states: [
      { message: 'base', files: { 'f.txt': lines(8) } },
      { message: 'ours', files: { 'f.txt': lines(8, (n) => (n === 2 ? 'two (ours)' : String(n))) } },
      { message: 'theirs', files: { 'f.txt': lines(8, (n) => (n === 7 ? 'seven (theirs)' : String(n))) } },
      { message: 'Merge', files: { 'f.txt': lines(8, (n) => (n === 2 ? 'two (ours)' : n === 7 ? 'seven (theirs)' : n === 5 ? 'five (merge)' : String(n))) } },
    ],
  }),
  merge('cc/no-newline', {
    title: 'A combined diff with "\\ No newline at end of file"',
    tags: ['combined', 'no-newline'],
    args: ['--format='],
    parents: TWO,
    states: [
      { message: 'base', files: { 'v': '1' } },
      { message: 'ours', files: { 'v': '2' } },
      { message: 'theirs', files: { 'v': '3' } },
      { message: 'Merge', files: { 'v': '4' } },
    ],
  }),
  merge('cc/binary', {
    title: 'A binary file changed by the merge: "Binary files differ" without names',
    tags: ['combined', 'binary'],
    args: ['--format='],
    parents: TWO,
    states: [
      { message: 'base', files: { 'b.bin': bytes(0, 1) } },
      { message: 'ours', files: { 'b.bin': bytes(0, 2) } },
      { message: 'theirs', files: { 'b.bin': bytes(0, 3) } },
      { message: 'Merge', files: { 'b.bin': bytes(0, 4) } },
    ],
  }),
  merge('cc/mode-and-content', {
    title: 'A merge that changes content and makes the file executable: "mode 100644,100644..100755"',
    tags: ['combined', 'mode'],
    args: ['--format='],
    parents: TWO,
    states: [
      { message: 'base', files: { 'run': '#!/bin/sh\necho base\n' } },
      { message: 'ours', files: { 'run': '#!/bin/sh\necho ours\n' } },
      { message: 'theirs', files: { 'run': '#!/bin/sh\necho theirs\n' } },
      { message: 'Merge', files: { 'run': x('#!/bin/sh\necho both\n') } },
    ],
  }),
  merge('cc/two-files-and-prose', {
    title: 'Two files in one combined diff, plus an ordinary-looking commit header',
    tags: ['combined', 'prelude'],
    parents: TWO,
    states: [
      { message: 'base', files: { 'a.txt': lines(5), 'z.txt': lines(5) } },
      { message: 'ours', files: { 'a.txt': lines(5, (n) => (n === 1 ? 'one o' : String(n))), 'z.txt': lines(5, (n) => (n === 5 ? 'five o' : String(n))) } },
      { message: 'theirs', files: { 'a.txt': lines(5, (n) => (n === 1 ? 'one t' : String(n))), 'z.txt': lines(5, (n) => (n === 5 ? 'five t' : String(n))) } },
      { message: 'Merge\n\nConflicts:\n\ta.txt\n\tz.txt', files: { 'a.txt': lines(5, (n) => (n === 1 ? 'one m' : String(n))), 'z.txt': lines(5, (n) => (n === 5 ? 'five m' : String(n))) } },
    ],
  }),
];
