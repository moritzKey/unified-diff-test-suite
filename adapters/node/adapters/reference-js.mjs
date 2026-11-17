// The reference parser of this project, run through the same door as everybody else.
import { parseDiff } from '../../../src/refparse.js';
import { fileToJson } from '../../../src/tojson.js';

export const meta = {
  name: 'reference (JS)',
  package: 'unified-diff-test-suite',
  language: 'JavaScript',
  homepage: 'src/refparse.js',
  api: 'parseDiff(bytes)',
  input: 'bytes',
  pathStyle: 'stripped',
  statuses: ['added', 'deleted', 'renamed', 'copied'],
  noNewline: 'line',
  scope: ['git', 'git-wrapped', 'git-config', 'combined', 'gnu'],
  notes: 'Prefixes are inferred from the text, as a consumer without inside knowledge has to.',
};

export function parse(bytes) {
  const { files, errors } = parseDiff(bytes);
  if (errors.length) throw new Error(`parse errors: ${JSON.stringify(errors)}`);
  // No prefixes are passed: they are inferred from the diff itself.
  return files.map((f) => fileToJson(f));
}
