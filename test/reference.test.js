// The Python reference parser agrees with the corpus exactly, and can apply what it parses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from '../src/adapters.js';

test('reference/python agrees with every vector and applies the hunks', (t) => {
  const probe = spawnSync('python3', ['--version']);
  if (probe.error || probe.status !== 0) {
    t.skip('python3 is not installed');
    return;
  }
  const res = spawnSync('python3', [join(ROOT, 'reference', 'python', 'check_corpus.py')], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /0 problem\(s\)/);
});
