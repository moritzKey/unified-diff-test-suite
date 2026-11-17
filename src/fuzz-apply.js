#!/usr/bin/env node
// Differential fuzzing of the programs that APPLY patches.
//
//   node src/fuzz-apply.js --seed 1 --count 300 [--adapter NAME]... [--out DIR] [--no-minimise] [--per-kind N]
//
// The scenarios are those of src/fuzz.js: random trees, random changes, random
// git options, and git writes the diff. As in src/apply.js, the expectation is
// the tree the diff was made to, and a program is given the tree it was made
// from. Refusing is not a finding. What is looked for is a program that reports
// success and leaves another tree ("wrong"), one that stops half-way
// ("partial"), and crashes and hangs. Each kind of result is reduced to a small
// scenario, which is written to DIR with its diff.

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { AdapterProcess, loadRegistry } from './adapters.js';
import { applyCase } from './applycase.js';
import { applyToFiles, applyToTree } from './apply.js';
import { stringifyVector } from './corpus.js';
import { makeTempDir } from './git.js';
import { genScenario, rng, Session, simplifications, sizeOf } from './fuzz.js';

const BAD = new Set(['wrong', 'partial', 'crash', 'hang']);

/** "wrong-content", "partial-missing", "crash": what went wrong, for grouping and minimising. */
export function kindOf(res) {
  if (res.verdict === 'crash' || res.verdict === 'hang') return res.verdict;
  const first = res.findings.find((f) => f.kind !== 'error' && f.kind !== 'note');
  return `${res.verdict}-${first ? first.kind : 'none'}`;
}

function parseArgs(argv) {
  const o = { seed: 1, count: 300, adapters: [], out: 'fuzz-findings/apply', minimise: true, perKind: 2, timeout: 20000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed') o.seed = Number(argv[++i]);
    else if (a === '--count') o.count = Number(argv[++i]);
    else if (a === '--adapter') o.adapters.push(argv[++i]);
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--no-minimise') o.minimise = false;
    else if (a === '--per-kind') o.perKind = Number(argv[++i]);
    else if (a === '--timeout') o.timeout = Number(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

class Appliers {
  constructor(specs, timeoutMs) {
    this.procs = specs.map((spec) => new AdapterProcess(spec, { timeoutMs }));
    this.work = makeTempDir('udts-fuzz-apply-');
    this.n = 0;
  }

  async start() {
    this.metas = [];
    const procs = [];
    for (const p of this.procs) {
      try {
        this.metas.push(await p.start());
        procs.push(p);
      } catch (err) {
        console.log(`${p.spec?.name ?? 'an applier'}: could not run (${String(err.message).split('\n')[0]})`);
      }
    }
    this.procs = procs;
  }

  /** The result of applier i for a built scenario, or null if the scenario is not for it. */
  async ask(i, built) {
    const meta = this.metas[i];
    const c = applyCase(built.vector);
    if (c.skip) return null;
    if (meta.scope && !meta.scope.includes(built.vector.tier)) return null;
    const dir = join(this.work, String(this.n++));
    let res;
    try {
      res =
        meta.applies === 'tree'
          ? await applyToTree(this.procs[i], built.vector.id, built.diffPath, c, dir)
          : await applyToFiles(this.procs[i], meta, built.vector.id, built.diff, built.vector, c, dir);
    } catch (err) {
      // The directory could not be read back: the program changed its permissions.
      spawnSync('chmod', ['-R', 'u+rwx', dir]);
      rmSync(dir, { recursive: true, force: true });
      return { verdict: 'wrong', findings: [{ kind: 'unreadable', message: String(err.message).slice(0, 200) }] };
    }
    return res.verdict === 'n/a' ? null : res;
  }

  async stop() {
    for (const p of this.procs) await p.stop();
    rmSync(this.work, { recursive: true, force: true });
  }
}

async function minimise(session, appliers, i, scenario, kind, budget = 300) {
  let best = scenario;
  let improved = true;
  let tries = 0;
  while (improved && tries < budget) {
    improved = false;
    for (const cand of simplifications(best)) {
      if (++tries > budget) break;
      if (sizeOf(cand) >= sizeOf(best)) continue;
      const built = session.build(cand);
      if (!built.vector) continue;
      const res = await appliers.ask(i, built);
      session.cleanup(built);
      if (res && BAD.has(res.verdict) && kindOf(res) === kind) {
        best = cand;
        improved = true;
        break;
      }
    }
  }
  return best;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  // The reference appliers only when they are named: they are what the others are measured against.
  const specs = loadRegistry(undefined, 'appliers').filter((a) => (opts.adapters.length === 0 ? !a.reference : opts.adapters.includes(a.name)));
  const session = new Session([], { timeoutMs: opts.timeout });
  await session.start();
  const appliers = new Appliers(specs, opts.timeout);
  await appliers.start();
  const r = rng(opts.seed);
  const stats = { seed: opts.seed, scenarios: 0, invalid: 0, appliers: {} };
  for (const m of appliers.metas) stats.appliers[m.name] = { asked: 0, ok: 0, refused: 0, kinds: {} };
  const kept = new Map();
  mkdirSync(opts.out, { recursive: true });

  for (let n = 0; n < opts.count; n++) {
    let scenario;
    try {
      scenario = genScenario(r, `fuzz/s${opts.seed}-${n}`);
    } catch {
      stats.invalid++;
      continue;
    }
    const built = session.build(scenario);
    if (!built.vector) {
      stats.invalid++;
      continue;
    }
    stats.scenarios++;
    for (let i = 0; i < appliers.procs.length; i++) {
      const name = appliers.metas[i].name;
      const res = await appliers.ask(i, built);
      if (!res) continue;
      const st = stats.appliers[name];
      st.asked++;
      if (res.verdict === 'ok' || res.verdict === 'refused') {
        st[res.verdict]++;
        continue;
      }
      const kind = kindOf(res);
      st.kinds[kind] = (st.kinds[kind] ?? 0) + 1;
      const key = `${name}:${kind}`;
      if ((kept.get(key) ?? 0) >= opts.perKind) continue;
      kept.set(key, (kept.get(key) ?? 0) + 1);
      const small = opts.minimise ? await minimise(session, appliers, i, scenario, kind) : scenario;
      const again = session.build(small);
      if (!again.vector) continue;
      const verdict = await appliers.ask(i, again);
      const hash = createHash('sha1').update(again.diff).digest('hex').slice(0, 10);
      const slug = appliers.procs[i].spec.name; // the registry name, without spaces
      const dir = join(opts.out, slug);
      mkdirSync(dir, { recursive: true });
      again.vector.id = `fuzz-apply/${slug}/${kind}-${hash}`;
      again.vector.title = `fuzz-found: ${name} ${kind}`;
      again.vector.fuzz = { seed: opts.seed, n, applier: name, result: verdict ? { verdict: verdict.verdict, findings: verdict.findings.slice(0, 5) } : null };
      writeFileSync(join(dir, `${kind}-${hash}.json`), stringifyVector(again.vector));
      writeFileSync(join(dir, `${kind}-${hash}.diff`), again.diff);
      session.cleanup(again);
    }
    session.cleanup(built);
  }
  await appliers.stop();
  await session.stop();
  writeFileSync(join(opts.out, `stats-seed${opts.seed}.json`), `${JSON.stringify(stats, null, 1)}\n`);
  console.log(`seed ${opts.seed}: ${stats.scenarios} scenarios, ${stats.invalid} invalid`);
  for (const [name, st] of Object.entries(stats.appliers)) {
    const kinds = Object.entries(st.kinds).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ${c}`).join(', ');
    console.log(`  ${name.padEnd(24)} ${String(st.ok).padStart(5)} right, ${String(st.refused).padStart(4)} refused of ${String(st.asked).padEnd(5)} ${kinds}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
