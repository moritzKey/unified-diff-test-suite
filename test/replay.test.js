// The oracle has to have teeth. Each test corrupts a correct parse in one small
// way and requires that verification against ground truth notices.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { Repo, makeTempDir } from '../src/git.js';
import { produce } from '../src/produce.js';
import { loadScenarios } from '../src/generate.js';

let repo;
let dir;
let scenarios;
let n = 0;
before(async () => {
  dir = makeTempDir('udts-test-');
  repo = new Repo(dir);
  scenarios = new Map((await loadScenarios()).map((s) => [s.id, s]));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const run = (id, tamper) => produce(repo, { ...scenarios.get(id), tamper }, `t${n++}`);
const rejects = (id, tamper, what) => assert.throws(() => run(id, tamper), { name: 'ReplayError' }, `${id}: ${what} went unnoticed`);
const firstLine = (parse, type) => parse.files.flatMap((f) => f.hunks).flatMap((h) => h.lines).find((l) => l.type === type);

test('an untouched parse is accepted', () => {
  for (const id of ['git/basics/two-hunks', 'git/newline/marker-mid-hunk', 'git/ops/everything-at-once', 'gnu/recursive', 'combined/cc/conflict-resolved']) run(id);
});

test('wrong line content is noticed', () => {
  rejects('git/basics/two-hunks', (p) => { firstLine(p, ' ').text = Buffer.from('tampered'); }, 'changed context text');
  rejects('git/basics/two-hunks', (p) => { firstLine(p, '+').text = Buffer.from('tampered'); }, 'changed added text');
  rejects('git/basics/two-hunks', (p) => { firstLine(p, '-').text = Buffer.from('tampered'); }, 'changed deleted text');
  rejects('git/bytes/crlf-file-modified', (p) => { const l = firstLine(p, '+'); l.text = l.text.subarray(0, l.text.length - 1); }, 'a dropped carriage return');
});

test('wrong line types and missing lines are noticed', () => {
  rejects('git/basics/two-hunks', (p) => { firstLine(p, '+').type = ' '; }, 'an added line turned into context');
  rejects('git/basics/two-hunks', (p) => { p.files[0].hunks[0].lines.pop(); }, 'a dropped line');
  rejects('git/basics/two-hunks', (p) => { p.files[0].hunks.pop(); }, 'a dropped hunk');
  rejects('git/content/fake-header-pair-before-next-hunk', (p) => { p.files[0].hunks.pop(); }, 'a hunk lost after a fake header');
});

test('wrong positions and line numbers are noticed', () => {
  rejects('git/basics/two-hunks', (p) => { p.files[0].hunks[1].oldStart += 1; }, 'a shifted old start');
  rejects('git/basics/two-hunks', (p) => { p.files[0].hunks[1].newStart -= 1; }, 'a shifted new start');
  rejects('git/basics/two-hunks', (p) => { firstLine(p, ' ').oldNo += 1; }, 'a wrong old line number');
  rejects('git/basics/two-hunks', (p) => { firstLine(p, '+').newNo += 1; }, 'a wrong new line number');
  rejects('git/ranges/u0-insert', (p) => { p.files[0].hunks[0].oldStart = 6; }, 'the start of an empty range moved by one');
  rejects('git/basics/two-hunks', (p) => { p.files[0].hunks[0].oldLines += 1; }, 'a wrong count');
});

test('wrong no-newline information is noticed', () => {
  rejects('git/newline/marker-mid-hunk', (p) => { firstLine(p, '-').noNewline = false; }, 'a dropped marker');
  rejects('git/newline/removed-at-end', (p) => { for (const l of p.files[0].hunks[0].lines) l.noNewline = false; }, 'a dropped marker on the new side');
  rejects('git/basics/two-hunks', (p) => { firstLine(p, '+').noNewline = true; }, 'an invented marker');
  rejects('git/newline/both-missing-context', (p) => { for (const l of p.files[0].hunks[0].lines) l.noNewline = false; }, 'a dropped marker on a context line');
});

test('wrong file-level facts are noticed', () => {
  rejects('git/basics/three-files', (p) => { p.files.pop(); }, 'a dropped file');
  rejects('git/basics/three-files', (p) => { p.files[0].oldName = Buffer.from('a/other.txt'); }, 'a wrong name');
  rejects('git/paths/space', (p) => { p.files[0].newName = Buffer.from('b/my file.txt\t'); }, 'a TAB left on a name');
  rejects('git/paths/non-ascii-quoted', (p) => { p.files[0].oldName = Buffer.from('a/\\303\\274ber.txt'); }, 'a name left escaped');
  rejects('git/basics/modify-one-line', (p) => { p.files[0].isNew = true; }, 'a modified file called new');
  rejects('git/ops/mode-change-only', (p) => { p.files[0].newMode = '100644'; }, 'a wrong mode');
  rejects('git/ops/rename-and-edit', (p) => { p.files[0].similarity = 50; }, 'a wrong similarity');
  rejects('git/ops/rename-and-edit', (p) => { p.files[0].renameTo = Buffer.from('elsewhere.txt'); }, 'a wrong rename target');
  rejects('git/ops/binary-modified', (p) => { p.files[0].binary = false; }, 'a binary file called text');
  rejects('git/basics/modify-one-line', (p) => { p.files[0].indexNew = '0000000'; }, 'a wrong object id');
});

test('binary patches are decoded and compared', () => {
  rejects('git/ops/binary-patch-literal', (p) => { const d = p.files[0].binaryPatch[0].data; d[0] = Buffer.from(d[0]); d[0][3] ^= 1; }, 'a corrupted literal block');
  rejects('git/ops/binary-patch-delta', (p) => { p.files[0].binaryPatch.reverse(); }, 'swapped forward and reverse blocks');
});

test('GNU diff and combined diffs are verified too', () => {
  rejects('gnu/recursive', (p) => { firstLine(p, '+').text = Buffer.from('tampered'); }, 'changed text in a GNU diff');
  rejects('gnu/space-in-name', (p) => { p.files[0].oldName = Buffer.from('a/my'); }, 'a wrong GNU name');
  rejects('combined/cc/conflict-resolved', (p) => { p.files[0].hunks[0].lines[0].text = Buffer.from('tampered'); }, 'changed text in a combined diff');
  rejects('combined/cc/conflict-resolved', (p) => { const l = p.files[0].hunks[0].lines.find((x) => x.markers === '++'); l.markers = ' +'; }, 'a wrong marker column');
});
