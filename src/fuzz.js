#!/usr/bin/env node
// Differential fuzzing.
//
//   node src/fuzz.js --seed 1 --count 2000 [--adapter NAME]... [--out DIR] [--no-minimise]
//
// Generates random scenarios (file trees with awkward names and contents, random
// changes, random git options), produces the diff with real git, verifies the
// reference parse against ground truth, and then compares every adapter's
// answer with it. Each distinct kind of disagreement is reduced to a minimal
// scenario and written to DIR as a reproducible recipe.
//
// A scenario whose reference parse cannot be verified is a bug in this project
// (or a discovery about git) and is reported separately; such scenarios are
// never used to judge a library.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { AdapterProcess, loadRegistry, ROOT } from './adapters.js';
import { Repo } from './git.js';
import { produce } from './produce.js';
import { entry, MODE, normalizeState, stateToJson } from './tree.js';
import { judge, notApplicable } from './run.js';
import { stringifyVector } from './corpus.js';

// ---- deterministic randomness --------------------------------------------------

export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    int: (n) => Math.floor(next() * n),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    weighted: (pairs) => {
      const total = pairs.reduce((s, [, w]) => s + w, 0);
      let x = next() * total;
      for (const [v, w] of pairs) {
        x -= w;
        if (x < 0) return v;
      }
      return pairs[pairs.length - 1][0];
    },
  };
  return r;
}

// ---- generators ----------------------------------------------------------------

const PLAIN_NAMES = ['a', 'b', 'c', 'src', 'lib', 'docs', 'x.txt', 'y.txt', 'main.c', 'README', 'app.js', 'data', 'old', 'new', 'i', 'w', 'dev', 'null', 'f'];
const ODD_NAMES = [
  'my file.txt', ' lead', 'trail ', 'a b', 'x b', 'two  sp', 'ü.txt', '文.md', '🎉', 'q"q', '"qq"', 'b\\s', 't\tt', 'n\nn', 'cr\rx', '-dash', '+plus',
  'a and b', '=> c', '{a => b}', '@@ -1 +1 @@', 'é', '\\303\\274', 'x\x7fy', 'bell\x07', "it's", 'tab\tend.txt', 'sp end.txt ', 'a.b c.d', 'dev', 'null',
  '2024-01-01 10:00:00 +0100', 'café', 'nbsp x', 'semi;colon', 'star*', 'q?', '#hash', '%25', '~tilde', '$var', '`tick`', '(paren)', '[br]', 'x=y', 'a,b', 'a:b',
];
const PLAIN_LINES = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'int x = 1;', 'return 0;', '}', '{', 'foo(bar);', '# comment', 'key: value', '<p>text</p>'];
const ODD_LINES = [
  '', ' ', '  ', '\t', '-', '+', '--', '++', '---', '+++', '-- ', '++ ', '-- note', '++ note', '--- a/x.txt', '+++ b/x.txt', '-- a/f', '++ b/f', '--- /dev/null', '+++ /dev/null',
  '@@ -1,2 +1,2 @@', '@@ -1 +1 @@ fn', '@@', '@', 'x @@ -3,4 +5,6 @@ y', 'diff --git a/x b/x', 'diff --git a/f b/f', 'index 1234567..89abcde 100644', 'index 0000000..1111111',
  'new file mode 100644', 'deleted file mode 100644', 'old mode 100644', 'new mode 100755', 'rename from x', 'rename to y', 'copy from x', 'similarity index 90%',
  'Binary files a/x and b/x differ', 'GIT binary patch', 'literal 3', 'delta 9', '\\ No newline at end of file', '\\', '\\ x', 'Index: f', '===', 'commit abcdef', 'From 1234 Mon Sep 17 00:00:00 2001',
  'cr\rmid', 'trail\r', 'ff\fmid', '\f', 'vt\x0bmid', 'fs\x1cx', 'rs\x1ex', 'ls x', 'ps x', 'nel\u0085x', 'esc\x1b[0m', 'bell\x07', 'ü ö ä ß', '文字', '🎉🎉', 'é', '﻿bom',
  'tab\there', 'trailing space ', ' leading space', '"quoted"', "'single'", 'back\\slash', 'a b/c', 'x'.repeat(300), 'Only in a: f', '-- \n'.trim(), 'Subproject commit 1111111111111111111111111111111111111111',
];

function genName(r) {
  if (r.chance(0.55)) return r.pick(PLAIN_NAMES);
  let n = r.pick(ODD_NAMES);
  if (r.chance(0.15)) n += r.pick(['.txt', '.c', ' x', '']);
  return n;
}

function genPath(r) {
  const depth = r.weighted([[1, 5], [2, 3], [3, 1]]);
  const parts = [];
  for (let i = 0; i < depth; i++) parts.push(genName(r));
  return parts.join('/');
}

function genLine(r) {
  return r.chance(0.6) ? r.pick(PLAIN_LINES) + (r.chance(0.3) ? ` ${r.int(100)}` : '') : r.pick(ODD_LINES);
}

function genLines(r, max = 12) {
  const n = r.weighted([[0, 1], [1, 2], [2, 2], [3, 3], [5, 3], [8, 2], [max, 1], [30, 0.4]]);
  return Array.from({ length: n }, () => genLine(r));
}

function join2(lines, r) {
  if (lines.length === 0) return '';
  const eol = r.chance(0.08) ? '\r\n' : '\n';
  return lines.join(eol) + (r.chance(0.85) ? eol : '');
}

function genBinary(r) {
  const n = 1 + r.int(60);
  const b = Buffer.alloc(n + 1);
  for (let i = 0; i < n; i++) b[i] = r.int(256);
  b[r.int(n)] = 0;
  return b;
}

function genFile(r) {
  const kind = r.weighted([['text', 82], ['exe', 6], ['link', 4], ['sub', 3], ['bin', 5]]);
  if (kind === 'link') return { mode: MODE.LINK, lines: null, content: r.pick(['target', 'a/b', '../x', 'my file', '-- a/x', 'ü', 'x\ny']) };
  if (kind === 'sub') return { mode: MODE.GITLINK, lines: null, content: String(1 + r.int(9)).repeat(40) };
  if (kind === 'bin') return { mode: MODE.FILE, lines: null, content: genBinary(r) };
  const lines = genLines(r);
  return { mode: kind === 'exe' ? MODE.EXE : MODE.FILE, lines, content: join2(lines, r) };
}

function editLines(r, lines) {
  const out = [...lines];
  const edits = 1 + r.int(3);
  for (let e = 0; e < edits; e++) {
    const op = r.weighted([['change', 4], ['insert', 3], ['delete', 3], ['append', 1], ['prepend', 1]]);
    const at = out.length ? r.int(out.length) : 0;
    if (op === 'change' && out.length) out[at] = genLine(r);
    else if (op === 'insert') out.splice(at, 0, ...Array.from({ length: 1 + r.int(2) }, () => genLine(r)));
    else if (op === 'delete' && out.length) out.splice(at, 1 + r.int(2));
    else if (op === 'append') out.push(genLine(r));
    else out.unshift(genLine(r));
  }
  return out;
}

function mutate(r, f) {
  const op = r.weighted([['edit', 55], ['same', 10], ['mode', 6], ['retype', 4], ['eol', 6], ['rewrite', 5]]);
  if (f.lines === null) {
    // symlink, submodule, binary: replace wholesale or keep
    if (op === 'same') return { ...f };
    const fresh = genFile(r);
    return r.chance(0.6) ? { ...f, content: f.mode === MODE.GITLINK ? String(1 + r.int(9)).repeat(40) : f.mode === MODE.LINK ? `${f.content}2` : genBinary(r) } : fresh;
  }
  if (op === 'same') return { ...f };
  if (op === 'mode') return { ...f, mode: f.mode === MODE.EXE ? MODE.FILE : MODE.EXE };
  if (op === 'retype') return genFile(r);
  if (op === 'eol') {
    const c = f.content;
    return { ...f, content: c.endsWith('\n') ? c.slice(0, c.endsWith('\r\n') ? -2 : -1) : `${c}\n` };
  }
  const lines = op === 'rewrite' ? genLines(r) : editLines(r, f.lines);
  return { ...f, lines, content: join2(lines, r) };
}

function toEntries(map) {
  return [...map].map(([path, f]) => entry(path, f.content, f.mode));
}

/** One random scenario. May be invalid (path conflicts); the caller retries. */
export function genScenario(r, id) {
  const before = new Map();
  const nFiles = r.weighted([[1, 5], [2, 3], [3, 2], [5, 1]]);
  for (let i = 0; i < nFiles; i++) before.set(genPath(r), genFile(r));

  const step = (prev) => {
    const next = new Map();
    for (const [path, f] of prev) {
      const op = r.weighted([['mutate', 60], ['keep', 8], ['delete', 9], ['rename', 9], ['rename-edit', 6], ['copy', 4], ['copy-edit', 3]]);
      if (op === 'delete') continue;
      if (op === 'keep') next.set(path, { ...f });
      else if (op === 'mutate') next.set(path, mutate(r, f));
      else if (op === 'rename') next.set(genPath(r), { ...f });
      else if (op === 'rename-edit') next.set(genPath(r), mutate(r, f));
      else {
        next.set(path, { ...f });
        next.set(genPath(r), op === 'copy' ? { ...f } : mutate(r, f));
      }
    }
    const added = r.weighted([[0, 6], [1, 3], [2, 1]]);
    for (let i = 0; i < added; i++) next.set(genPath(r), genFile(r));
    return next;
  };

  const kind = r.weighted([['git-diff', 80], ['git-diff-cached', 4], ['git-show', 5], ['git-log', 6], ['git-format-patch', 5]]);
  const maps = [before, step(before)];
  if (kind === 'git-log' || kind === 'git-format-patch') maps.push(step(maps[1]));
  const states = maps.map((m, i) => ({ message: r.pick(['Fix it', 'Update things\n\nLonger text here.', 'wip', `Change ${i}`]), files: toEntries(m) }));
  states.forEach((s, i) => normalizeState(s, i)); // throws on path conflicts

  const args = [];
  const producer = { kind, args };
  let tier = kind === 'git-diff' || kind === 'git-diff-cached' ? 'git' : 'git-wrapped';
  const tags = ['fuzz'];
  if (tier === 'git-wrapped') tags.push('prelude');
  if (r.chance(0.35)) args.push(r.pick(['-U0', '-U0', '-U1', '-U5', '-U10']));
  if (r.chance(0.2)) args.push(r.pick(['--no-renames', '-M', '-C', '-M30%', '-B']));
  if (r.chance(0.08)) args.push('--find-copies-harder', '-C');
  if (r.chance(0.1)) args.push('--binary');
  if (r.chance(0.08)) args.push('--full-index');
  if (r.chance(0.05) && kind === 'git-diff') {
    args.push('--stat', '-p');
    tier = 'git-wrapped';
    tags.push('prelude');
  }
  if (r.chance(0.04)) args.push('--text');
  if (kind === 'git-diff-cached') {
    producer.config = { 'diff.mnemonicPrefix': 'true' };
    producer.prefixes = ['c/', 'i/'];
    tier = 'git-config';
  } else if (kind === 'git-diff' && r.chance(0.16)) {
    tier = 'git-config';
    const v = r.pick(['noprefix', 'custom', 'reverse', 'quotepath', 'noprefix']);
    if (v === 'noprefix') {
      args.push('--no-prefix');
      producer.prefixes = ['', ''];
    } else if (v === 'custom') {
      args.push('--src-prefix=old/', '--dst-prefix=new/');
      producer.prefixes = ['old/', 'new/'];
    } else if (v === 'reverse') {
      args.push('-R');
      producer.prefixes = ['b/', 'a/'];
    } else producer.config = { 'core.quotePath': 'false' };
  }
  return { id, tier, title: `fuzz ${id}`, description: null, tags, states, producer };
}

// ---- minimisation --------------------------------------------------------------

function cloneScenario(s) {
  return {
    ...s,
    states: s.states.map((st) => ({ message: st.message, files: st.files.map((e) => ({ path: Buffer.from(e.path), content: Buffer.from(e.content), mode: e.mode })) })),
    producer: { ...s.producer, args: [...s.producer.args], config: s.producer.config ? { ...s.producer.config } : undefined, prefixes: s.producer.prefixes ? [...s.producer.prefixes] : undefined },
  };
}

/** Candidate simplifications of a scenario, most drastic first. */
function* simplifications(s) {
  // fewer states
  if (s.states.length > 2) {
    for (let drop = 0; drop < s.states.length; drop++) {
      const c = cloneScenario(s);
      c.states.splice(drop, 1);
      yield c;
    }
  }
  if (s.producer.kind !== 'git-diff' && s.states.length === 2) {
    const c = cloneScenario(s);
    c.producer.kind = 'git-diff';
    if (c.producer.config?.['diff.mnemonicPrefix']) {
      delete c.producer.config;
      delete c.producer.prefixes;
      c.tier = 'git';
    }
    yield c;
  }
  // drop options
  for (let i = 0; i < s.producer.args.length; i++) {
    const a = s.producer.args[i];
    if (a === '--no-prefix' || a.startsWith('--src-prefix') || a.startsWith('--dst-prefix') || a === '-R') continue;
    const c = cloneScenario(s);
    c.producer.args.splice(i, 1);
    yield c;
  }
  if (s.producer.prefixes && s.producer.kind === 'git-diff') {
    const c = cloneScenario(s);
    c.producer.args = c.producer.args.filter((a) => !(a === '--no-prefix' || a.startsWith('--src-prefix') || a.startsWith('--dst-prefix') || a === '-R'));
    delete c.producer.prefixes;
    c.tier = c.producer.config ? 'git-config' : 'git';
    yield c;
  }
  if (s.producer.config && s.producer.kind === 'git-diff') {
    const c = cloneScenario(s);
    delete c.producer.config;
    c.tier = c.producer.prefixes ? 'git-config' : 'git';
    yield c;
  }
  // drop a path everywhere
  const paths = new Set(s.states.flatMap((st) => st.files.map((e) => e.path.toString('latin1'))));
  for (const p of paths) {
    const c = cloneScenario(s);
    c.states.forEach((st) => {
      st.files = st.files.filter((e) => e.path.toString('latin1') !== p);
    });
    yield c;
  }
  // per file: simpler mode, fewer lines, simpler lines, simpler name
  for (let si = 0; si < s.states.length; si++) {
    for (let fi = 0; fi < s.states[si].files.length; fi++) {
      const e = s.states[si].files[fi];
      if (e.mode !== MODE.FILE) {
        const c = cloneScenario(s);
        c.states[si].files[fi].mode = MODE.FILE;
        if (e.mode === MODE.GITLINK) c.states[si].files[fi].content = Buffer.from('x\n');
        yield c;
      }
      if (e.mode === MODE.GITLINK) continue;
      const text = e.content.toString('latin1');
      const lines = text.split('\n');
      if (lines.length > 1) {
        for (let chunk = Math.ceil(lines.length / 2); chunk >= 1; chunk = Math.floor(chunk / 2)) {
          for (let at = 0; at + chunk <= lines.length; at += chunk) {
            const c = cloneScenario(s);
            const kept = [...lines.slice(0, at), ...lines.slice(at + chunk)];
            c.states[si].files[fi].content = Buffer.from(kept.join('\n'), 'latin1');
            yield c;
          }
          if (chunk === 1) break;
        }
      }
      for (let li = 0; li < lines.length; li++) {
        if (lines[li].length <= 1) continue;
        for (const repl of ['x', lines[li].slice(0, Math.ceil(lines[li].length / 2)), lines[li].slice(Math.floor(lines[li].length / 2))]) {
          if (repl === lines[li]) continue;
          const c = cloneScenario(s);
          const nl = [...lines];
          nl[li] = repl;
          c.states[si].files[fi].content = Buffer.from(nl.join('\n'), 'latin1');
          yield c;
        }
      }
    }
  }
  // simpler names: rename a path consistently in all states
  let n = 0;
  for (const p of paths) {
    const candidates = [`f${n++}`];
    const parts = p.split('/');
    if (parts.length > 1) candidates.push(parts[parts.length - 1], parts.slice(1).join('/'));
    for (let i = 0; i < p.length; i++) candidates.push(p.slice(0, i) + p.slice(i + 1));
    for (const q of candidates) {
      if (!q || q === p || paths.has(q)) continue;
      const c = cloneScenario(s);
      c.states.forEach((st) => {
        st.files.forEach((e) => {
          if (e.path.toString('latin1') === p) e.path = Buffer.from(q, 'latin1');
        });
      });
      yield c;
    }
  }
}

function sizeOf(s) {
  let n = s.states.length * 50 + s.producer.args.length * 20 + (s.producer.config ? 30 : 0) + (s.producer.kind === 'git-diff' ? 0 : 40);
  for (const st of s.states) for (const e of st.files) n += 30 + e.path.length * 2 + e.content.length + (e.mode === MODE.FILE ? 0 : 15);
  return n;
}

// ---- the loop ------------------------------------------------------------------

class Session {
  constructor(specs, { timeoutMs }) {
    this.dir = join(process.env.UDTS_TMP ?? tmpdir(), `udts-fuzz-${process.pid}-${Date.now()}`);
    mkdirSync(this.dir, { recursive: true });
    this.repo = new Repo(this.dir);
    this.procs = specs.map((spec) => new AdapterProcess(spec, { timeoutMs }));
    this.n = 0;
    this.sinceReset = 0;
  }

  async start() {
    this.metas = [];
    for (const p of this.procs) this.metas.push(await p.start());
  }

  /** Produce + verify. Returns { vector, diffPath } or { invalid } or { referenceError }. */
  build(scenario) {
    // A fresh repository every so often keeps the object store small.
    if (++this.sinceReset > 400) {
      rmSync(this.repo.gitDir, { recursive: true, force: true });
      this.repo = new Repo(this.dir);
      this.sinceReset = 0;
    }
    let out;
    try {
      for (const st of scenario.states) normalizeState(st);
      out = produce(this.repo, { ...scenario, producer: { ...scenario.producer, lenientApply: true } }, `z${this.n++}`);
    } catch (err) {
      if (err.name === 'ReplayError') return { referenceError: err.message };
      return { invalid: err.message };
    }
    const diffPath = join(this.dir, `current-${this.n}.diff`);
    writeFileSync(diffPath, out.diff);
    return { vector: out.vector, diff: out.diff, diffPath };
  }

  async ask(i, built) {
    const meta = this.metas[i];
    if (notApplicable(meta, built.vector)) return null;
    const res = judge(meta, built.vector, await this.procs[i].request(built.vector.id, built.diffPath));
    return res;
  }

  cleanup(built) {
    if (built?.diffPath) rmSync(built.diffPath, { force: true });
  }

  async stop() {
    for (const p of this.procs) await p.stop();
    rmSync(this.dir, { recursive: true, force: true });
  }
}

const primaryKind = (res) => (res.verdict === 'crash' ? 'crash' : res.verdict === 'hang' ? 'hang' : res.findings[0].kind);

async function minimise(session, i, scenario, kind, budget = 400) {
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
      const res = await session.ask(i, built);
      session.cleanup(built);
      if (res && res.verdict !== 'pass' && res.inScope && primaryKind(res) === kind) {
        best = cand;
        improved = true;
        break;
      }
    }
  }
  return best;
}

function parseArgs(argv) {
  const o = { seed: 1, count: 500, adapters: [], out: join(ROOT, 'fuzz-findings'), minimise: true, timeout: 10000, perKind: 3 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed') o.seed = Number(argv[++i]);
    else if (a === '--count') o.count = Number(argv[++i]);
    else if (a === '--adapter') o.adapters.push(argv[++i]);
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--no-minimise') o.minimise = false;
    else if (a === '--timeout') o.timeout = Number(argv[++i]);
    else if (a === '--per-kind') o.perKind = Number(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const specs = loadRegistry().filter((a) => !a.flavor && (opts.adapters.length === 0 || opts.adapters.includes(a.name)));
  const session = new Session(specs, { timeoutMs: opts.timeout });
  await session.start();
  const r = rng(opts.seed);
  const stats = { seed: opts.seed, scenarios: 0, invalid: 0, gitApplyRejects: 0, referenceErrors: [], adapters: {} };
  for (const m of session.metas) stats.adapters[m.name] = { asked: 0, failed: 0, kinds: {} };
  const kept = new Map(); // `${adapter}:${kind}` -> count of minimised examples written
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
    if (built.invalid) {
      stats.invalid++;
      continue;
    }
    if (built.referenceError) {
      stats.referenceErrors.push({ n, message: built.referenceError });
      const file = join(opts.out, `reference-s${opts.seed}-${n}.json`);
      writeFileSync(file, `${JSON.stringify({ error: built.referenceError, tier: scenario.tier, producer: scenario.producer, states: scenario.states.map((s, i) => stateToJson(s, i)) }, null, 1)}\n`);
      continue;
    }
    stats.scenarios++;
    if (built.vector.verified.git_apply_error) {
      // git could not read its own output: keep the recipe, it is a finding about git.
      if (stats.gitApplyRejects++ < 5) {
        writeFileSync(join(opts.out, `git-apply-rejects-s${opts.seed}-${n}.json`), stringifyVector(built.vector));
        writeFileSync(join(opts.out, `git-apply-rejects-s${opts.seed}-${n}.diff`), built.diff);
      }
    }
    for (let i = 0; i < session.procs.length; i++) {
      const name = session.metas[i].name;
      const res = await session.ask(i, built);
      if (!res || !res.inScope) continue;
      const st = stats.adapters[name];
      st.asked++;
      if (res.verdict === 'pass') continue;
      st.failed++;
      const kind = primaryKind(res);
      st.kinds[kind] = (st.kinds[kind] ?? 0) + 1;
      const key = `${name}:${kind}`;
      if (!opts.minimise || (kept.get(key) ?? 0) >= opts.perKind) continue;
      kept.set(key, (kept.get(key) ?? 0) + 1);
      const small = await minimise(session, i, scenario, kind);
      const again = session.build(small);
      if (!again.vector) continue;
      const verdict = await session.ask(i, again);
      const hash = createHash('sha1').update(again.diff).digest('hex').slice(0, 10);
      const dir = join(opts.out, name);
      mkdirSync(dir, { recursive: true });
      again.vector.id = `fuzz/${name}/${kind}-${hash}`;
      again.vector.title = `fuzz-found: ${name} ${kind}`;
      again.vector.fuzz = { seed: opts.seed, n, adapter: name, findings: verdict ? verdict.findings.slice(0, 5) : [] };
      writeFileSync(join(dir, `${kind}-${hash}.json`), stringifyVector(again.vector));
      writeFileSync(join(dir, `${kind}-${hash}.diff`), again.diff);
      session.cleanup(again);
    }
    session.cleanup(built);
  }
  await session.stop();
  writeFileSync(join(opts.out, `stats-seed${opts.seed}.json`), `${JSON.stringify(stats, null, 1)}\n`);
  console.log(`seed ${opts.seed}: ${stats.scenarios} scenarios verified, ${stats.invalid} invalid, ${stats.gitApplyRejects} rejected by git apply, ${stats.referenceErrors.length} reference errors`);
  for (const [name, st] of Object.entries(stats.adapters)) {
    const kinds = Object.entries(st.kinds).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ${c}`).join(', ');
    console.log(`  ${name.padEnd(16)} ${String(st.asked - st.failed).padStart(5)}/${String(st.asked).padEnd(5)} ${kinds}`);
  }
  if (stats.referenceErrors.length) {
    console.log('reference errors (first 5):');
    for (const e of stats.referenceErrors.slice(0, 5)) console.log(`  #${e.n}: ${e.message.slice(0, 300)}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
