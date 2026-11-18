// rattler-build: the patches of a recipe, applied while it sets up the sources (apply_patch_custom()).
//
// The adapter writes a recipe whose source is the tree (a local `path`) and whose only patch is the diff, runs
// `rattler-build debug setup` (which fetches the sources, applies the patches, prepares empty environments and
// stops), and reads back the work directory. rattler-build copies a tree there unchanged (checked for every old
// tree of the corpus) and adds three files of its own, build_env.sh, conda_build.sh and .source_info.json, which
// are left out. It finds the strip level itself, so `strip` is not passed.
//
// UDTS_RATTLER_BUILD names another rattler-build than adapters/rattler-build/bin/rattler-build or the PATH's.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCAL = fileURLToPath(new URL('../../rattler-build/bin/rattler-build', import.meta.url));
const RB = process.env.UDTS_RATTLER_BUILD ?? (existsSync(LOCAL) ? LOCAL : 'rattler-build');
const OWN_FILES = new Set(['build_env.sh', 'conda_build.sh', '.source_info.json']);

export const meta = {
  name: 'rattler-build',
  package: 'rattler-build',
  language: 'Rust',
  homepage: 'https://github.com/prefix-dev/rattler-build',
  api: 'rattler-build debug setup, with the diff as the only patch of a recipe whose source is the tree',
  applies: 'tree',
  input: 'bytes',
  notes:
    'The patches of a recipe are applied by apply_patch_custom() (crates/rattler_build_core/src/source/patch.rs), ' +
    'on top of the flickzeug crate: fuzzy (max_fuzz 2, whitespace ignored), with a guessed strip level and a check ' +
    'for patches that are already applied. The adapter runs `rattler-build debug setup` on a recipe whose source is ' +
    'the tree and reads back the work directory, without the three files rattler-build writes there itself.',
};

export function version() {
  const r = spawnSync(RB, ['--version'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) throw new Error('rattler-build is not installed (adapters/rattler-build/fetch.sh)');
  return r.stdout.trim().replace(/^rattler-build\s+/, '');
}

export function applyTree({ diff, dir }) {
  const work = `${dir}.rattler`;
  rmSync(work, { recursive: true, force: true });
  mkdirSync(join(work, 'recipe'), { recursive: true });
  try {
    // JSON strings are YAML strings, so the paths need no further quoting.
    writeFileSync(
      join(work, 'recipe', 'recipe.yaml'),
      `package:\n  name: udts\n  version: "1.0"\nsource:\n  path: ${JSON.stringify(dir)}\n  patches:\n    - ${JSON.stringify(diff)}\nbuild:\n  script: echo\n`,
    );
    const r = spawnSync(RB, ['debug', 'setup', '-r', join(work, 'recipe', 'recipe.yaml'), '--output-dir', join(work, 'out'), '--log-style', 'plain'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: work, NO_COLOR: '1' },
    });
    if (r.error) throw r.error;
    if (r.status !== 0) {
      const said = `${r.stderr}\n${r.stdout}`.split('\n').map((l) => l.trim()).filter((l) => /error|Error|failed|×/.test(l));
      throw new Error(said.slice(0, 4).join(' | ') || `rattler-build exited with status ${r.status}`);
    }
    const bld = join(work, 'out', 'bld');
    const builds = readdirSync(bld);
    if (builds.length !== 1) throw new Error(`adapter: expected one build directory, found ${builds.length}`);
    const result = join(bld, builds[0], 'work');
    for (const name of OWN_FILES) rmSync(join(result, name), { force: true });
    rmSync(dir, { recursive: true, force: true });
    renameSync(result, dir);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
