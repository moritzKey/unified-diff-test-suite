#!/usr/bin/env node
// Run the corpus through the registered adapters.
//
//   node src/run.js                        all adapters, all vectors
//   node src/run.js --adapter jsdiff       one adapter (repeatable)
//   node src/run.js --only paths/          only vectors whose id contains the text
//   node src/run.js --show                 print every finding
//   node src/run.js --kinds                group the failures by kind of finding
//
// Writes results/<adapter>.json (when the whole corpus was run) and prints a
// summary per tier.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { AdapterProcess, loadRegistry, ROOT } from './adapters.js';
import { compare } from './compare.js';
import { loadIndex, loadVector } from './corpus.js';
import { Repo } from './git.js';
import { produce } from './produce.js';
import { scenarioFromVector, flavoured } from './recipe.js';

function parseArgs(argv) {
  const o = { adapters: [], only: [], show: false, kinds: false, timeout: 10000, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--adapter') o.adapters.push(argv[++i]);
    else if (a === '--only') o.only.push(argv[++i]);
    else if (a === '--show') o.show = true;
    else if (a === '--kinds') o.kinds = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--timeout') o.timeout = Number(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

/**
 * Why a vector cannot be given to this library at all (null if it can).
 * "Not applicable" is not a failure and is left out of every score.
 */
export function notApplicable(meta, vector) {
  if (meta.input !== 'bytes' && !(vector.text.diff_is_utf8 && vector.text.names_are_utf8)) {
    return 'not valid UTF-8; the library takes text';
  }
  if (meta.names === 'text' && !vector.text.names_are_utf8) return 'the library reports names as text, and a name here is not valid UTF-8';
  if (meta.singleFile && vector.expected.files.length !== 1) return 'the library parses one file at a time';
  return null;
}

/** Decide the outcome for one vector given the adapter's answer. */
export function judge(meta, vector, response) {
  const cmp = compare(vector, response, meta);
  return { verdict: cmp.verdict, inScope: inScopeOf(meta, vector), findings: cmp.findings };
}

/**
 * Is this vector something the library sets out to handle? Its tier must be in
 * the declared scope, and a vector with text around the patch (commit headers,
 * mail headers, statistics) additionally needs the scope "git-wrapped".
 */
export function inScopeOf(meta, vector) {
  const scope = meta.scope ?? [];
  if (!scope.includes(vector.tier)) return false;
  return !(vector.tags ?? []).includes('prelude') || scope.includes('git-wrapped');
}

/**
 * Some libraries only ever see git output in one particular flavour, because
 * they invoke git themselves with fixed options. For those, every vector is
 * re-produced in that flavour (and verified again) before it is handed over.
 */
class FlavourKitchen {
  constructor(flavor) {
    this.flavor = flavor;
    this.dir = join(process.env.UDTS_TMP ?? tmpdir(), `udts-flavour-${process.pid}-${Date.now()}`);
    mkdirSync(this.dir, { recursive: true });
    this.repo = new Repo(this.dir);
    this.n = 0;
  }

  /** Returns { vector, diffPath } in the flavour, or null if the vector has no such variant. */
  cook(v) {
    const scenario = flavoured(scenarioFromVector(v.vector), this.flavor);
    if (!scenario) return null;
    const out = produce(this.repo, scenario, `f${this.n++}`);
    const diffPath = join(this.dir, `${this.n}.diff`);
    writeFileSync(diffPath, out.diff);
    return { vector: out.vector, diffPath };
  }

  close() {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

/** Run one adapter over the given vectors. Returns { meta, results: {id: {verdict, findings, inScope}} }. */
export async function runAdapter(spec, vectors, { timeoutMs = 10000 } = {}) {
  const proc = new AdapterProcess(spec, { timeoutMs });
  const meta = await proc.start();
  const kitchen = spec.flavor ? new FlavourKitchen(spec.flavor) : null;
  const results = {};
  try {
    for (const original of vectors) {
      const id = original.vector.id;
      const inScope = inScopeOf(meta, original.vector);
      const v = kitchen ? kitchen.cook(original) : original;
      if (!v) {
        results[id] = { verdict: 'n/a', inScope, findings: [], reason: `no ${spec.flavor} variant of this vector` };
        continue;
      }
      const na = notApplicable(meta, v.vector);
      if (na) {
        results[id] = { verdict: 'n/a', inScope, findings: [], reason: na };
        continue;
      }
      results[id] = judge(meta, v.vector, await proc.request(id, v.diffPath));
    }
  } finally {
    await proc.stop();
    kitchen?.close();
  }
  return { meta: { ...meta, flavor: spec.flavor ?? null, restarts: proc.restarts }, results };
}

export function summarise(results) {
  const tiers = {};
  for (const [id, r] of Object.entries(results)) {
    const tier = id.split('/')[0];
    tiers[tier] ??= { pass: 0, fail: 0, crash: 0, hang: 0, 'n/a': 0, total: 0, inScope: false };
    tiers[tier][r.verdict]++;
    if (r.verdict !== 'n/a') tiers[tier].total++;
    if (r.inScope) tiers[tier].inScope = true;
  }
  return tiers;
}

function printKinds(results) {
  const byKind = new Map();
  for (const [id, r] of Object.entries(results)) {
    for (const kind of new Set(r.findings.map((f) => f.kind))) {
      const e = byKind.get(kind) ?? { ids: [], sample: null };
      e.ids.push(id);
      e.sample ??= `${id}: ${r.findings.find((f) => f.kind === kind).message}`;
      byKind.set(kind, e);
    }
  }
  for (const [kind, e] of [...byKind].sort((x, y) => y[1].ids.length - x[1].ids.length)) {
    console.log(`  ${String(e.ids.length).padStart(4)} ${kind.padEnd(12)} e.g. ${e.sample.slice(0, 190)}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const index = loadIndex();
  const ids = index.vectors.map((v) => v.id).filter((id) => opts.only.length === 0 || opts.only.some((o) => id.includes(o)));
  const vectors = ids.map((id) => loadVector(id));
  const registry = loadRegistry().filter((a) => opts.adapters.length === 0 || opts.adapters.includes(a.name));
  if (registry.length === 0) throw new Error('no adapter selected');
  mkdirSync(join(ROOT, 'results'), { recursive: true });
  for (const spec of registry) {
    let out;
    try {
      out = await runAdapter(spec, vectors, { timeoutMs: opts.timeout });
    } catch (err) {
      console.log(`${spec.name}: could not run (${err.message.split('\n')[0]})`);
      continue;
    }
    if (opts.only.length === 0) {
      writeFileSync(join(ROOT, 'results', `${spec.name}.json`), `${JSON.stringify({ tools: index.tools, ...out }, null, 1)}\n`);
    }
    const tiers = summarise(out.results);
    const parts = Object.entries(tiers)
      .filter(([, s]) => s.total > 0)
      .map(([t, s]) => `${t} ${s.pass}/${s.total}${s.inScope ? '' : '*'}${s.crash ? ` (${s.crash} crash)` : ''}${s.hang ? ` (${s.hang} hang)` : ''}`);
    console.log(`${`${spec.name} ${out.meta.version ?? ''}`.padEnd(28)} ${parts.join('   ')}`);
    if (opts.kinds) printKinds(out.results);
    if (opts.show) {
      for (const [id, r] of Object.entries(out.results)) {
        if (r.verdict === 'pass' || r.verdict === 'n/a') continue;
        console.log(`  ${r.verdict.toUpperCase()} ${id}${r.inScope ? '' : '  (outside declared scope)'}`);
        for (const f of r.findings.slice(0, 6)) console.log(`      [${f.kind}] ${f.message}`);
        if (r.findings.length > 6) console.log(`      ... ${r.findings.length - 6} more`);
      }
    }
  }
  if (!opts.quiet) console.log('\n* = tier outside the scope the library declares');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
