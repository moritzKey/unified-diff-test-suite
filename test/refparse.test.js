import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiff, parseGitHeaderNames, parseFileLine, resolveNames, inferPrefixes, statusOf } from '../src/refparse.js';

const B = (s) => Buffer.from(s, 'utf8');
const names = (rest) => {
  const r = parseGitHeaderNames(B(rest));
  return r && r.map((b) => b.toString('utf8'));
};

test('the "diff --git" line is split where both halves name the same path', () => {
  assert.deepEqual(names('a/x b/x'), ['a/x', 'b/x']);
  assert.deepEqual(names('a/my file.txt b/my file.txt'), ['a/my file.txt', 'b/my file.txt']);
  assert.deepEqual(names('a/a b/c.txt b/a b/c.txt'), ['a/a b/c.txt', 'b/a b/c.txt']);
  assert.deepEqual(names('a/x b/x b/x b/x b/x b/x'), ['a/x b/x b/x', 'b/x b/x b/x']);
  assert.deepEqual(names('src/app.js src/app.js'), ['src/app.js', 'src/app.js']);
  assert.deepEqual(names('my file my file'), ['my file', 'my file']);
  assert.deepEqual(names('c/dir /run.sh i/dir /run.sh'), ['c/dir /run.sh', 'i/dir /run.sh']);
  assert.deepEqual(names('1/orig/a b.txt 2/work/a b.txt'), ['1/orig/a b.txt', '2/work/a b.txt']);
});

test('quoted names on the "diff --git" line', () => {
  assert.deepEqual(names('"a/\\303\\274.txt" "b/\\303\\274.txt"'), ['a/ü.txt', 'b/ü.txt']);
  assert.deepEqual(names('a/plain.txt "b/we\\tird.txt"'), ['a/plain.txt', 'b/we\tird.txt']);
  assert.deepEqual(names('"a/we\\tird.txt" b/plain.txt'), ['a/we\tird.txt', 'b/plain.txt']);
});

test('a rename between names with spaces cannot be split, and is not guessed', () => {
  assert.equal(names('a/old name.txt b/new name.txt'), null);
  assert.deepEqual(names('a/old.txt b/new.txt'), ['a/old.txt', 'b/new.txt']);
});

test('"---"/"+++" lines: TAB ends the name, quotes are decoded, /dev/null is no file', () => {
  const p = (s) => parseFileLine(B(s));
  assert.equal(p('a/my file.txt\t').name.toString(), 'a/my file.txt');
  assert.equal(p('a/trailing.txt \t').name.toString(), 'a/trailing.txt ');
  assert.equal(p('"a/\\303\\274.txt"').name.toString(), 'a/ü.txt');
  assert.equal(p('a/f.txt\t2000-01-01 00:00:00.000000000 +0000').trailer.toString(), '2000-01-01 00:00:00.000000000 +0000');
  assert.deepEqual([p('/dev/null').name, p('/dev/null').isNull], [null, true]);
  assert.equal(p('a/dev/null').isNull, false);
  assert.equal(p('dev/null').isNull, false);
});

test('a hunk is read by counting, so fake headers inside it are content', () => {
  const diff = [
    'diff --git a/n.txt b/n.txt',
    'index 1..2 100644',
    '--- a/n.txt',
    '+++ b/n.txt',
    '@@ -3 +3 @@',
    '--- a/secrets.env',
    '+++ b/secrets.env',
    '@@ -7 +7 @@',
    '-old',
    '+new',
    '',
  ].join('\n');
  const { files, errors } = parseDiff(diff);
  assert.deepEqual(errors, []);
  assert.equal(files.length, 1);
  assert.equal(files[0].hunks.length, 2);
  assert.deepEqual(files[0].hunks[0].lines.map((l) => l.type + l.text.toString()), ['--- a/secrets.env', '+++ b/secrets.env']);
});

test('lines are split at LF only', () => {
  const diff = 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\rb\fc d\n+a\rB\fc d\n';
  const { files } = parseDiff(diff);
  assert.equal(files[0].hunks[0].lines.length, 2);
  assert.equal(files[0].hunks[0].lines[1].text.toString(), 'a\rB\fc d');
});

test('the marker never counts as a line and may sit in the middle of a hunk', () => {
  const diff = 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,2 +1,3 @@\n one\n-two\n\\ No newline at end of file\n+two\n+three\n\\ No newline at end of file\n';
  const h = parseDiff(diff).files[0].hunks[0];
  assert.deepEqual(h.lines.map((l) => [l.type, l.text.toString(), l.noNewline]), [[' ', 'one', false], ['-', 'two', true], ['+', 'two', false], ['+', 'three', true]]);
  assert.deepEqual(h.lines.map((l) => [l.oldNo, l.newNo]), [[1, 1], [2, null], [null, 2], [null, 3]]);
});

test('a truncated hunk is reported, not silently accepted', () => {
  const { errors } = parseDiff('--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n one\n-two\n');
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /shorter than its header/);
});

test('text around the patch is ignored: commit headers, statistics, the mail signature', () => {
  const diff = [
    'From 1234 Mon Sep 17 00:00:00 2001', 'Subject: [PATCH] x', '', 'Binary files are prose here.', '---', ' f | 2 +-', '',
    'diff --git a/f b/f', 'index 1..2 100644', '--- a/f', '+++ b/f', '@@ -1 +1 @@', '-a', '+b', '-- ', '2.43.0', '', '',
  ].join('\n');
  const { files, errors } = parseDiff(diff);
  assert.deepEqual(errors, []);
  assert.equal(files.length, 1);
  assert.equal(files[0].hunks[0].lines.length, 2);
});

test('prefixes are inferred from what differs in front of the shared path', () => {
  const pre = (a, b) => {
    const { files } = parseDiff(`diff --git ${a} ${b}\nold mode 100644\nnew mode 100755\n`);
    const p = inferPrefixes(files[0]);
    return p && [p.src.toString(), p.dst.toString()];
  };
  assert.deepEqual(pre('a/x', 'b/x'), ['a/', 'b/']);
  assert.deepEqual(pre('x', 'x'), ['', '']);
  assert.deepEqual(pre('a/a/a.txt', 'b/a/a.txt'), ['a/', 'b/']);
  assert.deepEqual(pre('c/src/x', 'i/src/x'), ['c/', 'i/']);
  assert.deepEqual(pre('old/src/x', 'new/src/x'), ['old/', 'new/']);
  assert.deepEqual(pre('1/orig/x', '2/work/x'), ['1/orig/', '2/work/']);
  assert.equal(pre('OLD-x', 'NEW-x'), null);
});

test('names and status of sections without "---"/"+++" lines', () => {
  const one = (text) => {
    const f = parseDiff(text).files[0];
    const n = resolveNames(f);
    return [statusOf(f), n.oldPath && n.oldPath.toString(), n.newPath && n.newPath.toString()];
  };
  assert.deepEqual(one('diff --git a/e b/e\nnew file mode 100644\nindex 0000000..e69de29\n'), ['added', null, 'e']);
  assert.deepEqual(one('diff --git a/e b/e\ndeleted file mode 100644\nindex e69de29..0000000\n'), ['deleted', 'e', null]);
  assert.deepEqual(one('diff --git a/old name b/new name\nsimilarity index 100%\nrename from old name\nrename to new name\n'), ['renamed', 'old name', 'new name']);
  assert.deepEqual(one('diff --git a/run me.sh b/run me.sh\nold mode 100644\nnew mode 100755\n'), ['modified', 'run me.sh', 'run me.sh']);
  assert.deepEqual(one('diff --git a/t b/c\nsimilarity index 100%\ncopy from t\ncopy to c\n'), ['copied', 't', 'c']);
});

test('empty input gives no files', () => {
  assert.deepEqual(parseDiff(''), { files: [], errors: [] });
  assert.deepEqual(parseDiff(Buffer.alloc(0)), { files: [], errors: [] });
  assert.deepEqual(parseDiff('\n\n'), { files: [], errors: [] });
});
