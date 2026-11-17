import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteC, unquoteC, needsQuoting, quoteFastImport } from '../src/quote.js';

test('quoteC matches what git prints', () => {
  assert.equal(quoteC('a/über.txt').toString('latin1'), '"a/\\303\\274ber.txt"');
  assert.equal(quoteC('a/ta\tb.txt').toString('latin1'), '"a/ta\\tb.txt"');
  assert.equal(quoteC('a/quo"te.txt').toString('latin1'), '"a/quo\\"te.txt"');
  assert.equal(quoteC('a/back\\slash').toString('latin1'), '"a/back\\\\slash"');
  assert.equal(quoteC('bell\x07esc\x1bdel\x7f').toString('latin1'), '"bell\\aesc\\033del\\177"');
  assert.deepEqual(quoteC('a/über.txt', { quotePath: false }), Buffer.from('"a/über.txt"', 'utf8'));
});

test('a space alone does not need quoting; control characters and non-ASCII do', () => {
  assert.equal(needsQuoting('my file.txt'), false);
  assert.equal(needsQuoting('tab\t.txt'), true);
  assert.equal(needsQuoting('ü.txt'), true);
  assert.equal(needsQuoting('ü.txt', { quotePath: false }), false);
  assert.equal(needsQuoting('q".txt', { quotePath: false }), true);
});

test('unquoteC reverses quoteC for every byte', () => {
  const all = Buffer.from(Array.from({ length: 255 }, (_, i) => i + 1));
  for (const quotePath of [true, false]) {
    const q = quoteC(all, { quotePath });
    const u = unquoteC(q, 0);
    assert.ok(u);
    assert.equal(u.end, q.length);
    assert.deepEqual(u.value, all);
  }
  const fi = unquoteC(quoteFastImport(all), 0);
  assert.deepEqual(fi.value, all);
});

test('unquoteC reports where the quoted string ends', () => {
  const buf = Buffer.from('"a/x y" "b/x y"', 'latin1');
  const first = unquoteC(buf, 0);
  assert.equal(first.value.toString(), 'a/x y');
  assert.equal(buf[first.end], 0x20);
  assert.equal(unquoteC(buf, first.end + 1).value.toString(), 'b/x y');
});

test('unquoteC rejects malformed input', () => {
  for (const bad of ['no quote', '"unterminated', '"bad \\q escape"', '"short octal \\12"', '"octal out of range \\777"', '"trailing backslash \\']) {
    assert.equal(unquoteC(Buffer.from(bad, 'latin1'), 0), null, bad);
  }
});

test('escapes are decoded once, not twice', () => {
  // The file is literally named \303\274.txt (backslashes and digits).
  const name = '\\303\\274.txt';
  const q = quoteC(name);
  assert.equal(q.toString('latin1'), '"\\\\303\\\\274.txt"');
  assert.equal(unquoteC(q, 0).value.toString('latin1'), name);
});
