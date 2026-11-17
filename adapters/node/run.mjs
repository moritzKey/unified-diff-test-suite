#!/usr/bin/env node
// Adapter host for JavaScript parsers and appliers. Speaks the protocol in
// adapters/PROTOCOL.md:
//
//   node run.mjs <adapter-name>           a parser,  adapters/<name>.mjs
//   node run.mjs apply:<applier-name>     an applier, appliers/<name>.mjs
//
// prints one "hello" JSON line describing the library under test, then answers
// one JSON line per request line read from stdin:
//
//   -> {"id": "...", "path": "/abs/path/to/input.diff"}
//   <- {"id": "...", "ok": true, "files": [...]}          (normalised parse)
//   <- {"id": "...", "ok": false, "error": "message"}     (the library threw)
//
//   -> {"id": "...", "op": "apply", "path": "/abs/x.diff", "dir": "/abs/tree", "strip": 1}
//   -> {"id": "...", "op": "apply-file", "path": "/abs/one-file.diff", "old": "/abs/old" | null, "out": "/abs/out"}
//   <- {"id": "...", "ok": true}                          (applied; "absent": true = the result is no file)

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const name = process.argv[2];
if (!name) {
  console.error('usage: node run.mjs <adapter-name>');
  process.exit(2);
}
const adapter = await import(name.startsWith('apply:') ? `./appliers/${name.slice(6)}.mjs` : `./adapters/${name}.mjs`);

let version = null;
if (adapter.version) {
  // A command-line tool says its version itself. If it is not installed there
  // is nothing to test: the host ends here and the harness skips the adapter.
  try {
    version = await adapter.version();
  } catch (err) {
    console.error(String(err.message ?? err));
    process.exit(3);
  }
} else {
  try {
    version = require(`${adapter.meta.package}/package.json`).version;
  } catch {
    // Packages with an "exports" map may hide package.json; fall back to our lockfile.
    try {
      const lock = JSON.parse(readFileSync(new URL('./package-lock.json', import.meta.url), 'utf8'));
      version = lock.packages[`node_modules/${adapter.meta.package}`]?.version ?? null;
    } catch {
      version = null;
    }
  }
}

// One JSON document per line, in plain ASCII. JSON.stringify leaves U+2028 and
// U+2029 unescaped, and line readers disagree about whether those end a line
// (node:readline says yes from Node.js 24 on), so nothing above ASCII is written
// raw. This changes the spelling of the answer, not its value.
const jsonLine = (value) =>
  `${JSON.stringify(value).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}\n`;

// Lines end with LF and nothing else, for the same reason.
async function* linesOf(stream) {
  let pending = [];
  for await (const chunk of stream) {
    let start = 0;
    for (;;) {
      const nl = chunk.indexOf(10, start);
      if (nl === -1) break;
      pending.push(chunk.subarray(start, nl));
      yield Buffer.concat(pending).toString('utf8');
      pending = [];
      start = nl + 1;
    }
    if (start < chunk.length) pending.push(chunk.subarray(start));
  }
  if (pending.length > 0) yield Buffer.concat(pending).toString('utf8');
}

process.stdout.write(jsonLine({ hello: true, ...adapter.meta, version, runtime: `node ${process.version}` }));

for await (const line of linesOf(process.stdin)) {
  if (!line.trim()) continue;
  const req = JSON.parse(line);
  let res;
  try {
    const asInput = (bytes) => (adapter.meta.input === 'bytes' ? bytes : bytes.toString('utf8'));
    if (req.op === 'apply') {
      await adapter.applyTree({ diff: req.path, dir: req.dir, strip: req.strip });
      res = { id: req.id, ok: true };
    } else if (req.op === 'apply-file') {
      const result = await adapter.applyFile(asInput(readFileSync(req.path)), req.old === null ? null : asInput(readFileSync(req.old)));
      if (result === null) res = { id: req.id, ok: true, absent: true };
      else {
        writeFileSync(req.out, result);
        res = { id: req.id, ok: true };
      }
    } else {
      const files = await adapter.parse(asInput(readFileSync(req.path)));
      res = { id: req.id, ok: true, files };
    }
  } catch (err) {
    res = { id: req.id, ok: false, error: String(err && err.message ? err.message : err).slice(0, 500) };
  }
  process.stdout.write(jsonLine(res));
}
