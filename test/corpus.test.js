// The corpus on disk is exactly what the scenarios produce, and it is well formed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Repo, toolVersions, makeTempDir } from '../src/git.js';
import { produce } from '../src/produce.js';
import { loadScenarios } from '../src/generate.js';
import { loadIndex, loadVector, vectorPaths, stringifyVector } from '../src/corpus.js';
import { parseDiff } from '../src/refparse.js';
import { fileToJson } from '../src/tojson.js';
import { bytesFromJson } from '../src/bytes.js';
import { scenarioFromVector } from '../src/recipe.js';

const index = loadIndex();
const TIERS = new Set(['git', 'git-wrapped', 'git-config', 'combined', 'gnu']);

test('the index and the files agree', () => {
  assert.equal(index.count, index.vectors.length);
  assert.equal(new Set(index.vectors.map((v) => v.id)).size, index.vectors.length);
  for (const v of index.vectors) {
    assert.ok(TIERS.has(v.tier), `${v.id}: tier ${v.tier}`);
    assert.equal(v.id.split('/')[0], v.tier);
    const p = vectorPaths(v.id);
    assert.ok(existsSync(p.diff) && existsSync(p.json), `${v.id}: files missing`);
  }
});

test('every vector is well formed and verified', () => {
  for (const { id } of index.vectors) {
    const { vector, diff } = loadVector(id);
    assert.equal(vector.id, id);
    assert.ok(vector.title && vector.producer && vector.recipe && vector.expected, `${id}: incomplete`);
    assert.equal(vector.verified.replay, true, `${id}: not verified by replay`);
    assert.equal(vector.producer.tool === 'git', vector.tier !== 'gnu');
    if (vector.tier !== 'gnu' && vector.tier !== 'combined') {
      assert.equal(vector.verified.git_raw_numstat, true, `${id}: not checked against git --raw/--numstat`);
      assert.ok(vector.verified.git_apply_numstat || vector.verified.git_apply_error || vector.recipe.gitApply === false || !/^[^/]*\/$|^$/.test(vector.prefixes.old) || vector.prefixes.old.split('/').length !== vector.prefixes.new.split('/').length, `${id}: no statement about git apply`);
    }
    for (const f of vector.expected.files) {
      for (const h of f.hunks) {
        assert.ok(Array.isArray(h.lines));
        if (!f.combined) {
          assert.equal(h.lines.filter((l) => l.type !== 'add').length, h.old_lines, `${id}: old count`);
          assert.equal(h.lines.filter((l) => l.type !== 'delete').length, h.new_lines, `${id}: new count`);
        }
      }
      if (!f.combined && !f.binary) {
        assert.equal(f.additions, f.hunks.flatMap((h) => h.lines).filter((l) => l.type === 'add').length);
        assert.equal(f.deletions, f.hunks.flatMap((h) => h.lines).filter((l) => l.type === 'delete').length);
      }
    }
    // The expectation is exactly what the reference parser says, given the prefixes on record.
    const prefixes = { src: bytesFromJson(vector.prefixes.old), dst: bytesFromJson(vector.prefixes.new) };
    const parsed = parseDiff(diff);
    assert.deepEqual(parsed.errors, [], id);
    assert.deepEqual(JSON.parse(JSON.stringify(parsed.files.map((f) => fileToJson(f, prefixes)))), vector.expected.files, `${id}: reference parse differs from the stored expectation`);
  }
});

test('the scenarios reproduce the corpus byte for byte', async (t) => {
  const have = toolVersions();
  if (have.git !== index.tools.git || have.diffutils !== index.tools.diffutils) {
    t.skip(`corpus was produced with git ${index.tools.git} / diffutils ${index.tools.diffutils}; this machine has git ${have.git} / diffutils ${have.diffutils}. Run "node src/generate.js --check" to see what differs.`);
    return;
  }
  const scenarios = await loadScenarios();
  assert.equal(scenarios.length, index.count, 'number of scenarios and vectors');
  const dir = makeTempDir('udts-test-');
  try {
    const repo = new Repo(dir);
    scenarios.forEach((s, i) => {
      const out = produce(repo, s, `c${i}`);
      out.vector.source = s.source;
      const p = vectorPaths(s.id);
      assert.ok(readFileSync(p.diff).equals(out.diff), `${s.id}: the tool writes a different diff now`);
      assert.equal(stringifyVector(out.vector), readFileSync(p.json, 'utf8'), `${s.id}: the expectation changed`);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a vector can be rebuilt from its own recipe', async (t) => {
  const have = toolVersions();
  if (have.git !== index.tools.git || have.diffutils !== index.tools.diffutils) {
    t.skip('different tool versions');
    return;
  }
  const dir = makeTempDir('udts-test-');
  try {
    const repo = new Repo(dir);
    index.vectors.forEach(({ id }, i) => {
      const { vector, diff } = loadVector(id);
      const out = produce(repo, scenarioFromVector(vector), `r${i}`);
      assert.ok(out.diff.equals(diff), `${id}: the recipe does not reproduce the diff`);
      assert.deepEqual(out.vector.expected, vector.expected, `${id}: the recipe does not reproduce the expectation`);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
