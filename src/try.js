#!/usr/bin/env node
// Look at one vector through one adapter.
//
//   node src/try.js <adapter> <vector-id | path/to/vector.json> [--raw]
//
// Prints the verdict and the findings; with --raw also the adapter's whole answer.

import { readFileSync } from 'node:fs';
import { AdapterProcess, loadRegistry } from './adapters.js';
import { loadVector } from './corpus.js';
import { judge, notApplicable } from './run.js';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const raw = process.argv.includes('--raw');
if (args.length !== 2) {
  console.error('usage: node src/try.js <adapter> <vector-id | path/to/vector.json> [--raw]');
  process.exit(2);
}
const spec = loadRegistry().find((a) => a.name === args[0]);
if (!spec) throw new Error(`no adapter named ${args[0]}`);
let v;
if (args[1].endsWith('.json')) {
  const diffPath = args[1].replace(/\.json$/, '.diff');
  v = { vector: JSON.parse(readFileSync(args[1], 'utf8')), diffPath };
} else v = loadVector(args[1]);

const proc = new AdapterProcess(spec);
const meta = await proc.start();
const na = notApplicable(meta, v.vector);
if (na) console.log(`n/a: ${na}`);
else {
  const answer = await proc.request(v.vector.id, v.diffPath);
  const res = judge(meta, v.vector, answer);
  console.log(`${meta.name} ${meta.version ?? ''} on ${v.vector.id}: ${res.verdict.toUpperCase()}${res.inScope ? '' : ' (outside declared scope)'}`);
  for (const f of res.findings) console.log(`  [${f.kind}] ${f.message}`);
  if (raw) console.log(JSON.stringify(answer, null, 1));
}
await proc.stop();
