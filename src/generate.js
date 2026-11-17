#!/usr/bin/env node
// Build the corpus from the scenarios.
//
//   node src/generate.js            regenerate corpus/ from scenarios/*.js
//   node src/generate.js --check    verify that corpus/ is what the scenarios produce
//
// Every vector is verified against ground truth while it is produced; a
// scenario that cannot be verified aborts the run.

import { readdirSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { Repo, toolVersions } from './git.js';
import { produce } from './produce.js';
import { ROOT } from './adapters.js';
import { writeVector, writeIndex, clearVectors, vectorPaths, stringifyVector, CORPUS_DIR } from './corpus.js';

export async function loadScenarios(dir = join(ROOT, 'scenarios')) {
  const all = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.js') || name.startsWith('_')) continue;
    const mod = await import(pathToFileURL(join(dir, name)).href);
    for (const s of mod.scenarios) all.push({ ...s, source: `scenarios/${name}` });
  }
  const seen = new Set();
  for (const s of all) {
    if (seen.has(s.id)) throw new Error(`duplicate scenario id ${s.id}`);
    if (!/^[a-z0-9][a-z0-9/_.-]*$/.test(s.id)) throw new Error(`scenario id ${JSON.stringify(s.id)} must be lower-case ASCII`);
    seen.add(s.id);
  }
  return all;
}

export function withRepo(fn) {
  const dir = join(process.env.UDTS_TMP ?? tmpdir(), `udts-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  try {
    return fn(new Repo(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const check = process.argv.includes('--check');
  const only = process.argv.filter((a) => !a.startsWith('--')).slice(2);
  const scenarios = (await loadScenarios()).filter((s) => only.length === 0 || only.some((o) => s.id.includes(o)));
  const entries = [];
  const problems = [];
  withRepo((repo) => {
    if (!check && only.length === 0) clearVectors();
    scenarios.forEach((s, i) => {
      let out;
      try {
        out = produce(repo, s, `g${i}`);
      } catch (err) {
        problems.push(`${s.id} (${s.source}): ${err.message}`);
        return;
      }
      out.vector.source = s.source;
      if (check) {
        const p = vectorPaths(s.id);
        if (!existsSync(p.json) || !existsSync(p.diff)) problems.push(`${s.id}: missing from corpus/`);
        else {
          // With another version of the tool, only the version on record may differ.
          const stored = JSON.parse(readFileSync(p.json, 'utf8'));
          const fresh = JSON.parse(stringifyVector(out.vector));
          const sameTool = stored.producer.version === fresh.producer.version;
          if (!sameTool) stored.producer.version = fresh.producer.version;
          let storedDiff = readFileSync(p.diff);
          if (!sameTool && stored.recipe.kind === 'git-format-patch') {
            // git format-patch signs every mail with its own version number.
            const was = JSON.parse(readFileSync(p.json, 'utf8')).producer.version;
            storedDiff = Buffer.from(storedDiff.toString('latin1').split(`\n-- \n${was}\n`).join(`\n-- \n${fresh.producer.version}\n`), 'latin1');
          }
          if (!storedDiff.equals(out.diff)) problems.push(`${s.id}: the tool writes a different diff`);
          else if (JSON.stringify(stored.expected) !== JSON.stringify(fresh.expected)) problems.push(`${s.id}: the expected result differs`);
          // The remaining metadata (what git apply made of it, for one) may depend on the version.
          else if (sameTool && JSON.stringify(stored) !== JSON.stringify(fresh)) problems.push(`${s.id}: the vector's metadata differs`);
        }
      } else writeVector(out.vector, out.diff);
      entries.push({ id: s.id, tier: s.tier, title: s.title, tags: s.tags, files: out.vector.expected.files.length, bytes: out.diff.length });
    });
  });
  if (problems.length) {
    console.error(problems.map((p) => `FAIL ${p}`).join('\n'));
    console.error(`\n${problems.length} problem(s).`);
    process.exit(1);
  }
  if (!check && only.length === 0) writeIndex(entries, { tools: toolVersions() });
  const byTier = {};
  for (const e of entries) byTier[e.tier] = (byTier[e.tier] ?? 0) + 1;
  console.log(`${check ? 'verified' : 'wrote'} ${entries.length} vectors ${JSON.stringify(byTier)} -> ${CORPUS_DIR}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
