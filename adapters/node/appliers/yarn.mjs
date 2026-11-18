// Yarn (Berry): what the `patch:` protocol does with a patch file, from @yarnpkg/plugin-patch.
import { createRequire } from 'node:module';
import { cpSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const { CwdFS, npath } = require('@yarnpkg/fslib');
// The package exports only its plugin; the two modules are loaded by their path.
const tools = join(dirname(require.resolve('@yarnpkg/plugin-patch/package.json')), 'lib', 'tools');
const { parsePatchFile } = require(join(tools, 'parse.js'));
const { applyPatchFile } = require(join(tools, 'apply.js'));

export const meta = {
  name: 'Yarn',
  package: '@yarnpkg/plugin-patch',
  language: 'JavaScript',
  homepage: 'https://github.com/yarnpkg/berry/tree/master/packages/plugin-patch',
  api: 'parsePatchFile() + applyPatchFile(), as PatchFetcher does',
  applies: 'tree',
  input: 'bytes',
  scope: ['git', 'git-config'],
  prefixes: ['a/', 'b/'],
  notes:
    'The steps of loadPatchFiles() and PatchFetcher.patchPackage(): read the patch as UTF-8, turn every CR LF and every CR ' +
    'into LF, parse, apply with no dry run. Yarn applies to a copy of the package (a zip archive) and throws the copy away ' +
    'when a hunk fails; the adapter does the same with a copy of the directory. `yarn patch-commit` writes patches with ' +
    '`--src-prefix=a/ --dst-prefix=b/` and the applier takes no -p, so only vectors with those prefixes are given.',
};

export const version = () => require('@yarnpkg/plugin-patch/package.json').version;

export async function applyTree({ diff, dir }) {
  // loadPatchFiles(): "Normalizes the line endings to prevent mismatches when cloning a repository on Windows"
  const source = readFileSync(diff, 'utf8').replace(/\r\n?/g, '\n');
  const effects = parsePatchFile(source);
  const copy = `${dir}.yarn-copy`;
  rmSync(copy, { recursive: true, force: true });
  cpSync(dir, copy, { recursive: true, verbatimSymlinks: true });
  try {
    await applyPatchFile(effects, { baseFs: new CwdFS(npath.toPortablePath(copy)), version: null });
  } catch (err) {
    rmSync(copy, { recursive: true, force: true });
    throw err;
  }
  rmSync(dir, { recursive: true, force: true });
  renameSync(copy, dir);
}
