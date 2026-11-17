// "\ No newline at end of file".
//
// The marker is not a line of the file. It says that the line directly above it
// has no line terminator, and it can appear after a deleted line (the old file
// ended without a newline), after an added line (the new file does), after a
// context line (both do), and - when the old file's last line is not the last
// line of the hunk - in the middle of a hunk. It never counts towards the line
// numbers in the hunk header.

import { git, link, lines } from './_dsl.js';

export const scenarios = [
  git('newline/added-at-end', {
    title: 'The old file had no final newline, the new one has',
    why: 'The marker follows the deleted line; the added line that looks identical differs only in its terminator.',
    tags: ['no-newline'],
    before: { 'f.txt': 'one\ntwo' },
    after: { 'f.txt': 'one\ntwo\n' },
  }),
  git('newline/removed-at-end', {
    title: 'The new file has no final newline, the old one had',
    tags: ['no-newline'],
    before: { 'f.txt': 'one\ntwo\n' },
    after: { 'f.txt': 'one\ntwo' },
  }),
  git('newline/both-missing-last-line-changed', {
    title: 'Neither side ends with a newline and the last line changed: two markers',
    tags: ['no-newline'],
    before: { 'f.txt': 'one\ntwo' },
    after: { 'f.txt': 'one\nTWO' },
  }),
  git('newline/both-missing-context', {
    mustContain: [" three\n\\ No newline at end of file\n"],
    title: 'Neither side ends with a newline and the last line is context: one marker after a context line',
    tags: ['no-newline'],
    before: { 'f.txt': 'one\ntwo\nthree' },
    after: { 'f.txt': 'one\nTWO\nthree' },
  }),
  git('newline/marker-mid-hunk', {
    mustContain: ["-two\n\\ No newline at end of file\n+two\n+three\n+four\n"],
    title: 'Lines appended to a file that had no final newline: the marker sits in the middle of the hunk',
    why: 'The old last line is deleted (marker), then re-added with a terminator, then more lines follow. A parser that treats the marker as the end of the hunk drops them.',
    tags: ['no-newline'],
    before: { 'f.txt': 'one\ntwo' },
    after: { 'f.txt': 'one\ntwo\nthree\nfour\n' },
  }),
  git('newline/marker-mid-hunk-both-sides', {
    title: 'Appending to a file without a final newline, the result again without one',
    tags: ['no-newline'],
    before: { 'f.txt': 'one\ntwo' },
    after: { 'f.txt': 'one\ntwo\nthree' },
  }),
  git('newline/new-file-without', {
    title: 'A new file without a final newline',
    tags: ['no-newline', 'added'],
    before: {},
    after: { 'f.txt': 'one\ntwo' },
  }),
  git('newline/deleted-file-without', {
    title: 'A deleted file without a final newline',
    tags: ['no-newline', 'deleted'],
    before: { 'f.txt': 'one\ntwo' },
    after: {},
  }),
  git('newline/single-line-file-without', {
    title: 'A one-line file without a newline, changed',
    tags: ['no-newline'],
    before: { 'VERSION': '1.0.0' },
    after: { 'VERSION': '1.0.1' },
  }),
  git('newline/u0-marker', {
    title: '-U0 with a marker on the only line of the hunk',
    tags: ['no-newline', 'u0'],
    args: ['-U0'],
    before: { 'f.txt': `${lines(6)}last` },
    after: { 'f.txt': `${lines(6)}LAST` },
  }),
  git('newline/two-files-with-markers', {
    title: 'A marker at the end of one file section, directly followed by the next file',
    tags: ['no-newline'],
    before: { 'a.txt': 'a', 'b.txt': 'b\n' },
    after: { 'a.txt': 'A', 'b.txt': 'B\n' },
  }),
  git('newline/symlink-target-changed', {
    title: 'A symbolic link retargeted: link targets never end with a newline',
    tags: ['no-newline', 'symlink'],
    before: { 'current': link('releases/v1') },
    after: { 'current': link('releases/v2') },
  }),
  git('newline/only-a-newline-added', {
    title: 'An empty file becomes a single empty line',
    why: 'The whole hunk body is one "+".',
    tags: ['no-newline', 'blank-lines', 'empty-file'],
    before: { 'f.txt': '' },
    after: { 'f.txt': '\n' },
  }),
  git('newline/trailing-blank-lines', {
    title: 'Trailing empty lines added and the final newline removed',
    tags: ['no-newline', 'blank-lines'],
    before: { 'f.txt': 'text\n' },
    after: { 'f.txt': 'text\n\n\n ' },
  }),
  git('newline/context-marker-then-second-hunk-absent', {
    title: 'A change far from the end of a file that lacks a final newline: no marker at all',
    why: 'The last line is not part of any hunk, so the diff does not mention the missing newline.',
    tags: ['no-newline'],
    before: { 'f.txt': `${lines(20)}end` },
    after: { 'f.txt': `${lines(20, (n) => (n === 2 ? 'two' : String(n)))}end` },
  }),
];
