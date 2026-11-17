// The reference applier of this project, one file at a time.
import { applyToContent } from '../../../src/refapply.js';

export const meta = {
  name: 'reference, one file (JS)',
  package: 'unified-diff-test-suite',
  language: 'JavaScript',
  homepage: 'src/refapply.js',
  api: 'applyToContent(diff, oldContent)',
  applies: 'file',
  input: 'bytes',
  binary: true,
};

export const applyFile = (diff, old) => applyToContent(diff, old);
