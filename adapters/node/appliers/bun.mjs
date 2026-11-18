// Bun: what `bun install` does with a patch listed in "patchedDependencies".
//
// Bun has no command or API that applies a patch file by itself; it applies one
// while it installs the package the patch belongs to. So the adapter makes a
// package of the tree and installs it, as a user's project would:
//
//   <work>/src/package/        the tree, plus a package.json naming it udts@1.0.0
//   <work>/proj/udts.tgz       that directory as a tarball (GNU tar, so names stay bytes)
//   <work>/proj/patches/udts.patch   the diff, byte for byte
//   <work>/proj/package.json   {"dependencies": {"udts": "file:./udts.tgz"},
//                               "patchedDependencies": {"udts@./udts.tgz": "patches/udts.patch"}}
//
// then runs `bun install` there with a cache of its own. The key "udts@./udts.tgz"
// is the one `bun patch --commit` writes for such a dependency. Bun copies the
// package out of its cache, applies the patch to the copy, and installs the copy
// only if every section applied; otherwise it exits with status 1.
//
// What is read back is node_modules/udts without the three files that are not
// part of the tree: the package.json the adapter added, and the `.bun-tag` and
// `.bun-tag-<hash>` markers that every install of a (patched) package writes.
//
// A tarball goes through Bun's extraction, which keeps file names, contents and
// the executable bit as they are, but leaves out symbolic links: a package Bun
// installs never has one. Hence `symlinks: false` - vectors whose old tree has a
// symbolic link are not given.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, renameSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const PLATFORM_PACKAGE = '@oven/bun-linux-x64';

function bunPath() {
  return join(dirname(require.resolve(`${PLATFORM_PACKAGE}/package.json`)), 'bin', 'bun');
}

export const meta = {
  name: 'Bun',
  package: PLATFORM_PACKAGE,
  language: 'Rust',
  homepage: 'https://bun.com/docs/pm/cli/patch',
  api: 'bun install with "patchedDependencies" (src/patch: parse_patch_file() + PatchFile::apply())',
  applies: 'tree',
  input: 'bytes',
  scope: ['git', 'git-config'],
  prefixes: ['a/', 'b/'],
  symlinks: false,
  notes:
    'The tree is made into a local tarball dependency and installed with the diff in "patchedDependencies", the way ' +
    '`bun patch --commit` records a patch. Bun reads the patch file as it is (no line-ending normalisation), parses it ' +
    'with its port of patch-package\'s parser, and applies it to a copy of the package; any failure stops the install. ' +
    '`bun patch --commit` writes its patches with `git diff --src-prefix=a/ --dst-prefix=b/` and the applier takes no -p, so ' +
    'only vectors with those prefixes are given. Packages hold no symbolic links (the tarball extraction drops them), so ' +
    'vectors whose old tree has one are not given either.',
};

export function version() {
  const r = spawnSync(bunPath(), ['--version'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) throw new Error(`bun did not run: ${r.error?.message ?? r.stderr}`);
  return r.stdout.trim();
}

function run(cmd, args, options) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  if (r.error) throw r.error;
  return r;
}

export function applyTree({ diff, dir }) {
  const work = `${dir}.bun`;
  rmSync(work, { recursive: true, force: true });
  const src = join(work, 'src');
  const proj = join(work, 'proj');
  mkdirSync(src, { recursive: true });
  mkdirSync(join(proj, 'patches'), { recursive: true });
  try {
    // cp and tar handle names that are not valid UTF-8, which Node's string paths would not.
    const cp = run('cp', ['-a', dir, join(src, 'package')]);
    if (cp.status !== 0) throw new Error(`adapter: cp failed: ${cp.stderr}`);
    writeFileSync(join(src, 'package', 'package.json'), '{"name":"udts","version":"1.0.0"}\n');
    const tar = run('tar', ['-czf', join(proj, 'udts.tgz'), '-C', src, 'package']);
    if (tar.status !== 0) throw new Error(`adapter: tar failed: ${tar.stderr}`);
    copyFileSync(diff, join(proj, 'patches', 'udts.patch'));
    writeFileSync(
      join(proj, 'package.json'),
      `${JSON.stringify({
        name: 'udts-project',
        private: true,
        dependencies: { udts: 'file:./udts.tgz' },
        patchedDependencies: { 'udts@./udts.tgz': 'patches/udts.patch' },
      })}\n`,
    );
    // A cache, a home and a config directory of its own, so that nothing from earlier runs or from the user's
    // bunfig.toml takes part.
    const env = { ...process.env, BUN_INSTALL_CACHE_DIR: join(work, 'cache'), HOME: work, XDG_CONFIG_HOME: work, DO_NOT_TRACK: '1', NO_COLOR: '1' };
    const r = run(bunPath(), ['install', '--backend=copyfile', '--no-progress', '--no-summary', '--ignore-scripts'], { cwd: proj, env });
    if (r.status !== 0) {
      const said = `${r.stderr}\n${r.stdout}`.split('\n').filter((l) => /^error:/.test(l));
      throw new Error(said.join(' / ') || `bun install exited with status ${r.status}`);
    }
    const installed = join(proj, 'node_modules', 'udts');
    for (const name of readdirSync(installed)) {
      if (name === 'package.json' || name === '.bun-tag' || name.startsWith('.bun-tag-')) rmSync(join(installed, name));
    }
    rmSync(dir, { recursive: true, force: true });
    renameSync(installed, dir);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
