// The harness itself: the line protocol has to survive the text that the
// vectors contain, on every version of Node.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { AdapterProcess, jsonLine, loadRegistry, onLines } from '../src/adapters.js';
import { loadIndex, loadVector } from '../src/corpus.js';
import { makeTempDir } from '../src/git.js';
import { runAdapter } from '../src/run.js';

test('a protocol line ends with LF and with nothing else', async () => {
  const stream = new PassThrough();
  const lines = [];
  onLines(stream, (line) => lines.push(line));
  // U+2028 and U+2029 end a line for node:readline from Node.js 24 on, and for
  // Python's str.splitlines(); U+0085 and a lone CR do so elsewhere.
  const text = '{"a":"x y z\u0085w"}\n{"b":"ü\u{1f600}"}\r\n\n{"c":1}\n{"unfinished":';
  // One byte per chunk, so that every multi-byte character is split.
  for (const byte of Buffer.from(text, 'utf8')) stream.write(Buffer.from([byte]));
  stream.end();
  await once(stream, 'end');
  assert.deepEqual(lines, ['{"a":"x y z\u0085w"}', '{"b":"ü\u{1f600}"}\r', '', '{"c":1}']);
});

test('what the harness and the JavaScript host write is one line of ASCII', () => {
  const value = { text: 'a b c\u0085d ü \u{1f600} \ud800 \u007f "quoted" \\ \n' };
  const line = jsonLine(value);
  assert.match(line, /^[\x20-\x7e]+\n$/);
  assert.deepEqual(JSON.parse(line), value);
});

test('an adapter that writes U+2028 unescaped is understood, not timed out', async () => {
  const dir = makeTempDir('udts-harness-');
  try {
    const script = join(dir, 'fake-adapter.cjs');
    // JSON.stringify leaves U+2028 and U+2029 as they are; so does this adapter.
    writeFileSync(
      script,
      `process.stdout.write(JSON.stringify({ hello: true, name: 'fake' }) + '\\n');
let buffered = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (data) => {
  buffered += data;
  for (let nl = buffered.indexOf('\\n'); nl !== -1; nl = buffered.indexOf('\\n')) {
    const request = JSON.parse(buffered.slice(0, nl));
    buffered = buffered.slice(nl + 1);
    process.stdout.write(JSON.stringify({ id: request.id, ok: true, echo: request.path, text: 'a\\u2028b\\u2029c' }) + '\\n');
  }
});
`,
    );
    const adapter = new AdapterProcess({ name: 'fake', cmd: [process.execPath, script], cwd: dir }, { timeoutMs: 5000 });
    try {
      const hello = await adapter.start();
      assert.equal(hello.name, 'fake');
      const path = join(dir, 'na me ü.diff'); // a path is data too
      const answer = await adapter.request('one', path);
      assert.deepEqual(answer, { id: 'one', ok: true, echo: path, text: 'a b c' });
    } finally {
      await adapter.stop();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the reference parser passes every vector through the adapter protocol', async () => {
  const spec = loadRegistry().find((a) => a.name === 'reference-js');
  spec.cmd = [process.execPath, ...spec.cmd.slice(1)]; // the Node.js that runs this test
  const vectors = loadIndex().vectors.map((v) => loadVector(v.id));
  const { results } = await runAdapter(spec, vectors);
  const notPassed = Object.entries(results)
    .filter(([, r]) => r.verdict !== 'pass')
    .map(([id, r]) => `${id}: ${r.verdict} ${r.findings[0]?.message ?? ''}`);
  assert.deepEqual(notPassed, []);
  assert.equal(Object.keys(results).length, vectors.length);
});
