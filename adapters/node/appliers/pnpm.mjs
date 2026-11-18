// pnpm: applyPatchToDir() of @pnpm/patching.apply-patch, which `pnpm install` calls for patchedDependencies.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { applyPatchToDir } from '@pnpm/patching.apply-patch';

const require = createRequire(import.meta.url);

export const meta = {
  name: 'pnpm',
  package: '@pnpm/patching.apply-patch',
  language: 'JavaScript',
  homepage: 'https://github.com/pnpm/pnpm/tree/main/pnpm11/patching/apply-patch',
  api: 'applyPatchToDir({ patchFilePath, patchedDir })',
  applies: 'tree',
  input: 'bytes',
  scope: ['git', 'git-config'],
  prefixes: ['a/', 'b/'],
  notes:
    'pnpm 11; the package is its own port of patch-package. It reads the patch as UTF-8 and applies it without a dry run; ' +
    'a patch whose reverse would apply is taken to be applied already. `pnpm patch-commit` writes patches with ' +
    '`--src-prefix=a/ --dst-prefix=b/` and the applier takes no -p, so only vectors with those prefixes are given.',
};

// lib/index.js is the main module; package.json is one directory up.
export const version = () => JSON.parse(readFileSync(join(dirname(require.resolve('@pnpm/patching.apply-patch')), '..', 'package.json'), 'utf8')).version;

export function applyTree({ diff, dir }) {
  applyPatchToDir({ patchFilePath: diff, patchedDir: dir });
}
