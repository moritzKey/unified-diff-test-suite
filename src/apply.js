#!/usr/bin/env node
// Run programs that APPLY patches over the corpus.
//
//   node src/apply.js [--adapter NAME]... [--only ID-SUBSTRING]... [--show] [--quiet]
//
// For every vector whose diff is a patch in the plain sense (src/applycase.js)
// the old tree is written to a fresh directory, the applier is asked to apply
// the diff there, and the directory is read back and compared, byte for byte,
// with the new tree that the vector records. Libraries that patch one file at
// a time are given each file section with the old content of its file instead.
//
// The outcome is one of
//
//   ok       it reported success and the result is right
//   refused  it reported an error and changed nothing
//   partial  it reported an error and left the tree changed
//   wrong    it reported success and the result is NOT right
//   crash, hang, n/a   as for parsers
//
// "refused" is a limitation. "wrong" is the one that loses data without a word.

import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { isUtf8 } from 'node:buffer';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AdapterProcess, loadRegistry, ROOT } from './adapters.js';
import { applyCase } from './applycase.js';
import { bytesFromJson, show, splitLines } from './bytes.js';
import { loadIndex, loadVector } from './corpus.js';
import { makeTempDir } from './git.js';
import { parseDiff } from './refparse.js';
import { materialize } from './tree.js';
import { compareTrees, scanTree, treeOf } from './treecmp.js';

export const VERDICTS = ['ok', 'refused', 'partial', 'wrong', 'crash', 'hang'];

function parseArgs(argv) {
  const o = { adapters: [], only: [], show: false, quiet: false, timeout: 20000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--adapter') o.adapters.push(argv[++i]);
    else if (a === '--only') o.only.push(argv[++i]);
    else if (a === '--show') o.show = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--timeout') o.timeout = Number(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

const failure = (answer) => (answer.hang ? 'hang' : answer.died ? 'crash' : null);
const errorOf = (answer) => String(answer.error ?? 'no reason given').slice(0, 300);

/** Apply the whole diff to the whole tree. */
async function applyToTree(proc, id, diffPath, c, dir) {
  rmSync(dir, { recursive: true, force: true });
  materialize(dir, { files: c.old });
  const before = scanTree(dir);
  const answer = await proc.request(id, diffPath, { op: 'apply', dir, strip: c.strip });
  const after = scanTree(dir);
  rmSync(dir, { recursive: true, force: true });
  const findings = compareTrees(after, treeOf(c.new), { modes: c.modes });
  const dead = failure(answer);
  if (dead) return { verdict: dead, findings: [{ kind: dead, message: dead === 'hang' ? 'no answer within the time limit' : errorOf(answer) }] };
  if (answer.ok) return { verdict: findings.length ? 'wrong' : 'ok', findings };
  const changed = compareTrees(after, before).length > 0;
  const said = { kind: 'error', message: errorOf(answer) };
  if (!changed) return { verdict: 'refused', findings: [said] };
  return { verdict: 'partial', findings: [said, ...(findings.length ? findings : [{ kind: 'note', message: 'the tree is nevertheless as expected' }])] };
}

/** Byte ranges of the file sections of a diff, from the reference parser. */
function sectionSlices(diff) {
  const { lines, finalNewline } = splitLines(diff);
  const offsets = [0];
  lines.forEach((l, i) => offsets.push(offsets[i] + l.length + (i < lines.length - 1 || finalNewline ? 1 : 0)));
  return parseDiff(diff).files.map((f) => diff.subarray(offsets[f.startLine], offsets[f.endLine]));
}

/** Apply each file section to the old content of its file. */
async function applyToFiles(proc, meta, id, diff, vector, c, dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const slices = sectionSlices(diff);
  const sections = vector.expected.files;
  if (slices.length !== sections.length) throw new Error(`${id}: ${slices.length} sections sliced, ${sections.length} expected`);
  const before = treeOf(c.old);
  const after = treeOf(c.new);
  const lookup = (tree, p) => (p === null || p === undefined ? null : tree.get(bytesFromJson(p).toString('latin1')) ?? null);
  const findings = [];
  const seen = new Set();
  let tested = 0;
  for (let i = 0; i < sections.length; i++) {
    const f = sections[i];
    const binary = f.binary === 'patch';
    if (!binary && !(f.hunks ?? []).length) continue; // nothing happens to the content
    if (binary && !meta.binary) continue;
    const oldEntry = lookup(before, f.old_path);
    const newEntry = lookup(after, f.new_path);
    const want = newEntry ? newEntry.content : Buffer.alloc(0);
    if (meta.input !== 'bytes' && !(isUtf8(slices[i]) && isUtf8(want) && (!oldEntry || isUtf8(oldEntry.content)))) continue;
    const patchPath = join(dir, `${i}.diff`);
    const oldPath = join(dir, `${i}.old`);
    const outPath = join(dir, `${i}.out`);
    writeFileSync(patchPath, slices[i]);
    if (oldEntry) writeFileSync(oldPath, oldEntry.content);
    tested++;
    const answer = await proc.request(id, patchPath, { op: 'apply-file', old: oldEntry ? oldPath : null, out: outPath });
    const path = bytesFromJson(f.new_path ?? f.old_path);
    const name = `"${show(path)}"`;
    const dead = failure(answer);
    if (dead) {
      rmSync(dir, { recursive: true, force: true });
      return { verdict: dead, findings: [{ kind: dead, message: `${name}: ${dead === 'hang' ? 'no answer within the time limit' : errorOf(answer)}` }] };
    }
    if (!answer.ok) {
      seen.add('refused');
      findings.push({ kind: 'error', message: `${name}: ${errorOf(answer)}` });
      continue;
    }
    // A library that returns a list of lines does not say whether the last one ends with a newline.
    const chop = (b) => (meta.eofNewline === false && b.length && b[b.length - 1] === 0x0a ? b.subarray(0, b.length - 1) : b);
    const got = answer.absent || !existsSync(outPath) ? Buffer.alloc(0) : readFileSync(outPath);
    const one = (content) => treeOf([{ path, mode: '100644', content: chop(content) }]);
    const diffs = compareTrees(one(got), one(want), { modes: false });
    if (diffs.length) {
      seen.add('wrong');
      findings.push(...diffs);
    }
  }
  rmSync(dir, { recursive: true, force: true });
  if (tested === 0) return { verdict: 'n/a', findings: [], reason: 'no file section this library could be given' };
  return { verdict: seen.has('wrong') ? 'wrong' : seen.has('refused') ? 'refused' : 'ok', findings };
}

/** Run one applier over the given vectors. Returns { meta, results: {id: {verdict, findings}} }. */
export async function runApplier(spec, vectors, { timeoutMs = 20000 } = {}) {
  const proc = new AdapterProcess(spec, { timeoutMs });
  const meta = await proc.start();
  if (meta.applies !== 'tree' && meta.applies !== 'file') throw new Error(`${spec.name} does not say whether it applies to a tree or to a file`);
  const work = makeTempDir('udts-apply-');
  const results = {};
  let n = 0;
  try {
    for (const { vector, diffPath, diff } of vectors) {
      const c = applyCase(vector);
      if (c.skip) {
        results[vector.id] = { verdict: 'n/a', findings: [], reason: c.skip };
        continue;
      }
      if (meta.scope && !meta.scope.includes(vector.tier)) {
        results[vector.id] = { verdict: 'n/a', findings: [], reason: 'not a kind of diff this program sets out to read' };
        continue;
      }
      const dir = join(work, String(n++));
      results[vector.id] =
        meta.applies === 'tree' ? await applyToTree(proc, vector.id, diffPath, c, dir) : await applyToFiles(proc, meta, vector.id, diff, vector, c, dir);
    }
  } finally {
    await proc.stop();
    rmSync(work, { recursive: true, force: true });
  }
  return { meta: { ...meta, restarts: proc.restarts }, results };
}

export function summarise(results) {
  const tiers = {};
  for (const [id, r] of Object.entries(results)) {
    const tier = id.split('/')[0];
    tiers[tier] ??= Object.fromEntries([...VERDICTS, 'n/a', 'total'].map((v) => [v, 0]));
    tiers[tier][r.verdict]++;
    if (r.verdict !== 'n/a') tiers[tier].total++;
  }
  return tiers;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const index = loadIndex();
  const ids = index.vectors.map((v) => v.id).filter((id) => opts.only.length === 0 || opts.only.some((o) => id.includes(o)));
  const vectors = ids.map((id) => loadVector(id));
  const registry = loadRegistry(undefined, 'appliers').filter((a) => opts.adapters.length === 0 || opts.adapters.includes(a.name));
  if (registry.length === 0) throw new Error('no applier selected');
  mkdirSync(join(ROOT, 'results', 'apply'), { recursive: true });
  for (const spec of registry) {
    let out;
    try {
      out = await runApplier(spec, vectors, { timeoutMs: opts.timeout });
    } catch (err) {
      console.log(`${spec.name}: could not run (${err.message.split('\n')[0]})`);
      continue;
    }
    if (opts.only.length === 0) {
      writeFileSync(join(ROOT, 'results', 'apply', `${spec.name}.json`), `${JSON.stringify({ tools: index.tools, ...out }, null, 1)}\n`);
    }
    const parts = Object.entries(summarise(out.results))
      .filter(([, s]) => s.total > 0)
      .map(([t, s]) => `${t} ${s.ok}/${s.total}${VERDICTS.slice(1).filter((v) => s[v]).map((v) => ` ${s[v]} ${v}`).join(',')}`);
    console.log(`${`${spec.name} ${out.meta.version ?? ''}`.padEnd(30)} ${parts.join('   ')}`);
    if (opts.show) {
      for (const [id, r] of Object.entries(out.results)) {
        if (r.verdict === 'ok' || r.verdict === 'n/a') continue;
        console.log(`  ${r.verdict.toUpperCase()} ${id}`);
        for (const f of r.findings.slice(0, 5)) console.log(`      [${f.kind}] ${f.message}`);
        if (r.findings.length > 5) console.log(`      ... ${r.findings.length - 5} more`);
      }
    }
  }
  if (!opts.quiet) console.log('\nok/total per tier; "wrong" = reported success, result not right');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
