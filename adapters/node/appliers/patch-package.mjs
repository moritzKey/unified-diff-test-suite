// patch-package: the parser and applier that run at postinstall, as its applyPatch() calls them.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { parsePatchFile } = require('patch-package/dist/patch/parse');
const { executeEffects } = require('patch-package/dist/patch/apply');
const { reversePatch } = require('patch-package/dist/patch/reverse');

export const meta = {
  name: 'patch-package',
  package: 'patch-package',
  language: 'JavaScript',
  homepage: 'https://github.com/ds300/patch-package',
  api: 'parsePatchFile() + executeEffects(), as applyPatch() calls them',
  applies: 'tree',
  input: 'bytes',
  scope: ['git', 'git-config'],
  prefixes: ['a/', 'b/'],
  notes:
    'The steps of applyPatch() in dist/applyPatches.js: read the file (readFileSync().toString(), so as UTF-8), parse it, ' +
    'a dry run, the real run; when that fails, a patch whose reverse would apply is taken to be applied already and counts ' +
    'as success. patch-package makes its patches with `git diff --src-prefix=a/ --dst-prefix=b/` and takes no -p: it always ' +
    'removes a/ and b/, so only vectors with those prefixes are given. readPatch() exits the process on a parse error; the ' +
    'adapter calls the parser itself and reports the error instead.',
};

export const version = () => require('patch-package/package.json').version;

export function applyTree({ diff, dir }) {
  const effects = parsePatchFile(readFileSync(diff).toString());
  try {
    executeEffects(effects, { dryRun: true, cwd: dir, bestEffort: false });
    executeEffects(effects, { dryRun: false, cwd: dir, bestEffort: false });
  } catch (err) {
    try {
      executeEffects(reversePatch(effects), { dryRun: true, cwd: dir, bestEffort: false });
    } catch {
      throw err;
    }
    // applyPatch() returns true here: "already applied".
  }
}
