// Applying: the expected result is the recorded tree, the reference applier
// reaches it for every patch, and the comparison notices every kind of damage.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegistry, ROOT } from '../src/adapters.js';
import { outOfScope, runApplier } from '../src/apply.js';
import { applyCase, applyInfo } from '../src/applycase.js';
import { loadIndex, loadVector } from '../src/corpus.js';
import { makeTempDir } from '../src/git.js';
import { applyToContent, applyToTree } from '../src/refapply.js';
import { materialize, MODE } from '../src/tree.js';
import { compareTrees, scanTree, treeOf } from '../src/treecmp.js';

const all = () => loadIndex().vectors.map((v) => loadVector(v.id));
const kinds = (findings) => [...new Set(findings.map((f) => f.kind))].sort();

test('which vectors are patches', () => {
  const reason = (id) => applyCase(loadVector(id).vector).skip ?? null;
  assert.equal(reason('git/basics/modify-one-line'), null);
  assert.match(reason('combined/cc/conflict-resolved'), /merge/);
  assert.match(reason('git/ops/irreversible-delete'), /-D/);
  assert.match(reason('git/ops/binary-modified'), /does not carry its content/);
  assert.match(reason('git/ops/submodule-updated'), /submodule/);
  assert.match(reason('git-wrapped/log-three-commits'), /several commits/);
  assert.match(reason('gnu/only-in'), /every difference/);
  assert.match(reason('gnu/labels'), /labels/);
  assert.match(reason('git/basics/empty-diff'), /empty/);
  const cases = all().map(({ vector }) => applyCase(vector)).filter((c) => !c.skip);
  assert.equal(cases.length, 216);
  // What a vector says about itself is what this module works out.
  for (const { vector } of all()) assert.deepEqual(vector.apply, applyInfo(vector), vector.id);
  assert.deepEqual(loadVector('git-wrapped/show-root-commit').vector.apply, { from: null, to: 0, strip: 1, modes: true });
  assert.deepEqual(loadVector('gnu/single-file').vector.apply, { from: 0, to: 1, strip: 1, modes: false });
  // -pN: the default prefixes, none, and two components.
  assert.deepEqual([...new Set(cases.map((c) => c.strip))].sort(), [0, 1, 2]);
  // A reversed diff turns the new tree into the old one.
  const reversed = loadVector('git-config/prefix/reversed').vector;
  const c = applyCase(reversed);
  assert.deepEqual(c.new.map((e) => e.path.toString()), reversed.recipe.states[0].files.map((f) => f.path));
});

test('a program that always removes a/ and b/ is given only the vectors with those prefixes', () => {
  // patch-package, pnpm, Yarn and Bun take no -p.
  const meta = { scope: ['git', 'git-config'], prefixes: ['a/', 'b/'] };
  const out = (id) => {
    const { vector } = loadVector(id);
    return outOfScope(meta, vector, applyCase(vector));
  };
  assert.equal(out('git/basics/modify-one-line'), null);
  assert.match(out('git-config/noprefix/option'), /prefixes/);
  assert.match(out('git-config/prefix/reversed'), /prefixes/); // b/ and a/
  assert.match(out('gnu/single-file'), /sets out to read/);
  const given = all().filter(({ vector }) => {
    const c = applyCase(vector);
    return !c.skip && !outOfScope(meta, vector, c);
  });
  assert.equal(given.length, 180);
});

test('a program whose packages hold no symbolic links is not given an old tree with one', () => {
  // Bun drops symbolic links when it unpacks a package, so a patch never meets one there.
  const meta = { scope: ['git', 'git-config'], prefixes: ['a/', 'b/'], symlinks: false };
  const out = (id) => {
    const { vector } = loadVector(id);
    return outOfScope(meta, vector, applyCase(vector));
  };
  assert.match(out('git/ops/symlink-deleted'), /symbolic link/);
  assert.match(out('git/ops/symlink-becomes-file'), /symbolic link/);
  assert.equal(out('git/ops/symlink-added'), null); // only the new tree has one: the program may refuse it
  assert.equal(out('git/basics/modify-one-line'), null);
  const given = all().filter(({ vector }) => {
    const c = applyCase(vector);
    return !c.skip && !outOfScope(meta, vector, c);
  });
  assert.equal(given.length, 176);
});

test('the reference applier turns every old tree into the new tree', () => {
  let trees = 0;
  let sections = 0;
  for (const { vector, diff } of all()) {
    const c = applyCase(vector);
    if (c.skip) continue;
    const after = applyToTree(diff, c.old, c.strip);
    assert.deepEqual(compareTrees(treeOf(after), treeOf(c.new), { modes: c.modes }), [], vector.id);
    trees++;
    // It does not change what it was given.
    assert.ok(c.old.every((e) => Buffer.isBuffer(e.content)));
    sections += vector.expected.files.length;
  }
  assert.equal(trees, 216);
  assert.ok(sections > 250);
});

test('the reference applier refuses what does not fit, and says why', () => {
  const { vector, diff } = loadVector('git/basics/modify-one-line');
  const c = applyCase(vector);
  const [file] = c.old;
  const damaged = [{ ...file, content: Buffer.from(file.content.toString().replace(/[a-z]/, 'X')) }];
  assert.throws(() => applyToTree(diff, damaged, 1), /old line \d+ is/);
  assert.throws(() => applyToTree(diff, [], 1), /does not exist/);
  assert.throws(() => applyToTree(diff, c.old, 0), /does not exist|cannot tell/);
  assert.throws(() => applyToContent(Buffer.concat([diff, diff]), file.content), /one file section/);
  assert.throws(() => applyToTree(loadVector('combined/cc/conflict-resolved').diff, [], 1), /merge/);
  assert.throws(() => applyToTree(loadVector('git/ops/binary-modified').diff, applyCase(loadVector('git/ops/binary-patch-literal').vector).old, 1), /does not carry|does not exist/);
});

test('a directory is read back as the tree that was written', () => {
  const dir = makeTempDir('udts-tree-');
  try {
    const odd = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x0a, 0x2e, 0x74, 0x78, 0x74]); // "caf\xe9 \n.txt": not UTF-8, with a newline
    const entries = [
      { path: Buffer.from('plain.txt'), mode: MODE.FILE, content: Buffer.from('a\r\nb') },
      { path: Buffer.from('bin/tool'), mode: MODE.EXE, content: Buffer.from([0, 1, 2, 255]) },
      { path: Buffer.from('deep/er/link'), mode: MODE.LINK, content: Buffer.from('../../plain.txt') },
      { path: Buffer.from('dangling'), mode: MODE.LINK, content: Buffer.from('no such target') },
      { path: Buffer.from('empty'), mode: MODE.FILE, content: Buffer.alloc(0) },
      { path: Buffer.concat([Buffer.from('dir /'), odd]), mode: MODE.FILE, content: Buffer.from('x\n') },
    ];
    materialize(dir, { files: entries });
    mkdirSync(join(dir, 'an empty directory'));
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.git', 'config'), 'not part of the tree');
    assert.deepEqual(compareTrees(scanTree(dir), treeOf(entries)), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every kind of damage to a tree is noticed', () => {
  const base = [
    { path: Buffer.from('a.txt'), mode: MODE.FILE, content: Buffer.from('one\ntwo\n') },
    { path: Buffer.from('run.sh'), mode: MODE.EXE, content: Buffer.from('#!/bin/sh\n') },
    { path: Buffer.from('link'), mode: MODE.LINK, content: Buffer.from('a.txt') },
    { path: Buffer.from('empty'), mode: MODE.FILE, content: Buffer.alloc(0) },
  ];
  const change = (path, patch) => base.map((e) => (e.path.toString() === path ? { ...e, ...patch } : e));
  const check = (damaged, expectedKinds, options) => assert.deepEqual(kinds(compareTrees(treeOf(damaged), treeOf(base), options)), expectedKinds);
  check(base, []);
  check(change('a.txt', { content: Buffer.from('one\ntwo') }), ['content']); // the final newline went missing
  check(change('a.txt', { content: Buffer.from('one\ntwo\n\n') }), ['content']);
  check(change('a.txt', { content: Buffer.from('one\r\ntwo\r\n') }), ['content']);
  check(change('a.txt', { content: Buffer.from('two\none\n') }), ['content']); // right lines, wrong place
  check(change('empty', { content: Buffer.from('\n') }), ['content']);
  check(change('run.sh', { mode: MODE.FILE }), ['mode']);
  check(change('run.sh', { mode: MODE.FILE }), [], { modes: false });
  check(change('a.txt', { mode: MODE.EXE }), ['mode']);
  check(change('link', { mode: MODE.FILE }), ['type']); // a file holding the target instead of a link
  check(change('a.txt', { mode: MODE.LINK }), ['type']);
  check(change('link', { content: Buffer.from('b.txt') }), ['content']);
  check(base.filter((e) => e.path.toString() !== 'empty'), ['missing']);
  check([...base, { path: Buffer.from('a.txt.orig'), mode: MODE.FILE, content: Buffer.from('one\n') }], ['extra']);
  check([...base, { path: Buffer.from('gone.txt'), mode: MODE.FILE, content: Buffer.alloc(0) }], ['extra']); // a deleted file left behind empty
  check([...base.slice(1), { path: Buffer.from('A.txt'), mode: MODE.FILE, content: base[0].content }], ['extra', 'missing']);
  const message = compareTrees(treeOf(change('a.txt', { content: Buffer.from('one\ntwo') })), treeOf(base))[0].message;
  assert.match(message, /"a\.txt": 7 bytes, expected 8; first difference at byte 7 \(line 2\)/);
  // A file left without read permission for its owner (Bazel's native patch writes a symbolic link so):
  // the scan reads it anyway, and the comparison says so.
  const dir = makeTempDir('udts-unreadable-');
  try {
    materialize(dir, { files: base.filter((e) => e.mode !== MODE.LINK) });
    chmodSync(join(dir, 'a.txt'), 0o064);
    const scanned = scanTree(dir);
    assert.equal(scanned.get('a.txt').unreadable, '064');
    assert.deepEqual(kinds(compareTrees(scanned, treeOf(base.filter((e) => e.mode !== MODE.LINK)))), ['mode']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the four outcomes are told apart', async () => {
  const dir = makeTempDir('udts-outcomes-');
  try {
    // An applier that does what its name says, whatever the patch is.
    const script = join(dir, 'fake-applier.cjs');
    writeFileSync(
      script,
      `const fs = require('node:fs');
const path = require('node:path');
const how = process.argv[2];
process.stdout.write(JSON.stringify({ hello: true, name: how, applies: 'tree', input: 'bytes' }) + '\\n');
let buffered = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (data) => {
  buffered += data;
  for (let nl = buffered.indexOf('\\n'); nl !== -1; nl = buffered.indexOf('\\n')) {
    const request = JSON.parse(buffered.slice(0, nl));
    buffered = buffered.slice(nl + 1);
    const answer = { id: request.id, ok: how === 'nothing-and-ok' || how === 'damage-and-ok' };
    if (!answer.ok) answer.error = 'no';
    if (how.startsWith('damage')) fs.writeFileSync(path.join(request.dir, 'leftover.rej'), 'x');
    if (how === 'die') process.exit(3);
    process.stdout.write(JSON.stringify(answer) + '\\n');
  }
});
`,
    );
    const vectors = [loadVector('git/basics/modify-one-line'), loadVector('combined/cc/conflict-resolved')];
    const outcome = async (how) => {
      const { results } = await runApplier({ name: how, cmd: [process.execPath, script, how], cwd: dir }, vectors, { timeoutMs: 5000 });
      assert.equal(results['combined/cc/conflict-resolved'].verdict, 'n/a');
      return results['git/basics/modify-one-line'];
    };
    assert.equal((await outcome('nothing-and-ok')).verdict, 'wrong');
    assert.deepEqual(kinds((await outcome('nothing-and-ok')).findings), ['content']);
    assert.equal((await outcome('nothing-and-error')).verdict, 'refused');
    assert.equal((await outcome('damage-and-error')).verdict, 'partial');
    assert.deepEqual(kinds((await outcome('damage-and-ok')).findings), ['content', 'extra']);
    assert.equal((await outcome('die')).verdict, 'crash');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the reference appliers pass every patch through the adapter protocol', async () => {
  const vectors = all();
  for (const [name, patches] of [['reference-js', 216], ['reference-file-js', 194]]) {
    const spec = loadRegistry(undefined, 'appliers').find((a) => a.name === name);
    spec.cmd = [process.execPath, ...spec.cmd.slice(1)]; // the Node.js that runs this test
    const { results } = await runApplier(spec, vectors);
    const tested = Object.entries(results).filter(([, r]) => r.verdict !== 'n/a');
    assert.deepEqual(tested.filter(([, r]) => r.verdict !== 'ok').map(([id, r]) => `${id}: ${r.verdict} ${r.findings[0]?.message ?? ''}`), [], name);
    assert.equal(tested.length, patches, name);
  }
});

test('the applier fuzzer raises no false alarm: the reference applier is right on random scenarios', async () => {
  const { spawnSync } = await import('node:child_process');
  const { readFileSync } = await import('node:fs');
  const out = makeTempDir('udts-fuzz-apply-test-');
  try {
    const res = spawnSync(process.execPath, ['src/fuzz-apply.js', '--seed', '5', '--count', '25', '--no-minimise', '--adapter', 'reference-js', '--out', out], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, res.stderr);
    const stats = JSON.parse(readFileSync(join(out, 'stats-seed5.json'), 'utf8'));
    const st = stats.appliers['reference (JavaScript)'] ?? Object.values(stats.appliers)[0];
    assert.ok(st.asked >= 10, `only ${st.asked} scenarios were patches`);
    assert.deepEqual(st.kinds, {});
    assert.equal(st.ok, st.asked);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
