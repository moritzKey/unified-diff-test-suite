// The comparison is conservative: a faithful answer passes, each kind of damage is named.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare } from '../src/compare.js';
import { loadVector } from '../src/corpus.js';

const META = { name: 'x', pathStyle: 'stripped', statuses: ['added', 'deleted', 'renamed', 'copied'], noNewline: 'line' };
const answer = (vector) => ({ ok: true, files: structuredClone(vector.expected.files) });
const kinds = (vector, response, meta = META) => [...new Set(compare(vector, response, meta).findings.map((f) => f.kind))];

test('the expectation itself passes, in both path styles', () => {
  for (const id of ['git/ops/everything-at-once', 'git/paths/many-odd-names', 'git/newline/marker-mid-hunk', 'git-config/noprefix/option']) {
    const { vector } = loadVector(id);
    assert.equal(compare(vector, answer(vector), META).verdict, 'pass', id);
    const raw = answer(vector);
    for (const f of raw.files) {
      f.old_path = f.old_name;
      f.new_path = f.new_name;
    }
    assert.equal(compare(vector, raw, { ...META, pathStyle: 'raw' }).verdict, 'pass', `${id} (raw)`);
  }
});

test('a library is not marked down for what it does not report', () => {
  const { vector } = loadVector('git/ops/everything-at-once');
  const sparse = { ok: true, files: vector.expected.files.map((f) => ({ new_path: f.new_path })) };
  assert.equal(compare(vector, sparse, META).verdict, 'pass');
});

test('each kind of damage is reported as its own kind', () => {
  const { vector } = loadVector('git/newline/marker-mid-hunk');
  const damage = (fn) => {
    const a = answer(vector);
    fn(a.files);
    return kinds(vector, a);
  };
  assert.deepEqual(damage((f) => f.pop()), ['file-count']);
  assert.deepEqual(damage((f) => { f[0].new_path = 'f.txt\t'; }), ['path']);
  assert.deepEqual(damage((f) => { f[0].status = 'added'; }), ['status']);
  assert.deepEqual(damage((f) => { f[0].additions += 1; }), ['count']);
  assert.deepEqual(damage((f) => { f[0].hunks.push(f[0].hunks[0]); }), ['hunk-count']);
  assert.deepEqual(damage((f) => { f[0].hunks[0].old_lines += 1; }), ['hunk-range']);
  assert.deepEqual(damage((f) => { f[0].hunks[0].lines.pop(); }), ['line-count']);
  assert.deepEqual(damage((f) => { f[0].hunks[0].lines[0].type = 'add'; }), ['line-type']);
  assert.deepEqual(damage((f) => { f[0].hunks[0].lines[0].text += ' '; }), ['line-text']);
  assert.deepEqual(damage((f) => { f[0].hunks[0].lines[0].old_no += 1; }), ['line-number']);
  assert.deepEqual(damage((f) => { for (const l of f[0].hunks[0].lines) delete l.no_newline; }), ['no-newline']);
  assert.equal(compare(vector, { ok: false, error: 'boom' }, META).verdict, 'crash');
  assert.equal(compare(vector, { hang: true }, META).verdict, 'hang');
});

test('with other prefixes the untouched name is accepted, a mangled one is not', () => {
  const { vector } = loadVector('git-config/noprefix/directories-named-a-and-b');
  const a = answer(vector);
  assert.equal(compare(vector, a, META).verdict, 'pass');
  a.files[0].old_path = 'readme.txt';
  assert.deepEqual(kinds(vector, a), ['path']);
  const custom = loadVector('git-config/prefix/custom').vector;
  const b = answer(custom);
  for (const f of b.files) {
    if (f.old_path !== null) f.old_path = f.old_name;
    if (f.new_path !== null) f.new_path = f.new_name;
  }
  assert.equal(compare(custom, b, META).verdict, 'pass');
});

test('a name on the side where no file exists is its own kind of finding', () => {
  const { vector } = loadVector('git/ops/empty-file-added');
  const a = answer(vector);
  a.files[0].old_path = '.gitkeep';
  assert.deepEqual(kinds(vector, a), ['absent-side']);
});
