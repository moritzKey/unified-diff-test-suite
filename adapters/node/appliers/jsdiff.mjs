// jsdiff: applyPatch(), one file at a time.
import { applyPatch } from 'diff';

export const meta = {
  name: 'jsdiff',
  package: 'diff',
  language: 'JavaScript',
  homepage: 'https://github.com/kpdecker/jsdiff',
  api: 'applyPatch(source, patch)',
  applies: 'file',
  input: 'string',
  notes: 'Default options (fuzzFactor 0, autoConvertLineEndings on). applyPatch returns false when a hunk does not fit.',
};

export function applyFile(patch, old) {
  const result = applyPatch(old ?? '', patch);
  if (result === false) throw new Error('applyPatch returned false');
  return result;
}
