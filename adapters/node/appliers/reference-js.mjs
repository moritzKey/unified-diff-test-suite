// The reference applier of this project (src/refapply.js), through the same door as everybody else.
import { chmodSync, mkdirSync, rmdirSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { applyToTree } from '../../../src/refapply.js';
import { scanTree, treeOf } from '../../../src/treecmp.js';

export const meta = {
  name: 'reference (JS)',
  package: 'unified-diff-test-suite',
  language: 'JavaScript',
  homepage: 'src/refapply.js',
  api: 'applyToTree(diff, entries, strip)',
  applies: 'tree',
  input: 'bytes',
  notes: 'Strict: no fuzz, no offsets. Works out the whole result before it touches the directory.',
};

export function applyTree({ diff, dir, strip }) {
  const before = scanTree(dir);
  const after = treeOf(applyToTree(readFileSync(diff), [...before.values()], strip));
  const full = (path) => Buffer.concat([Buffer.from(`${dir}/`), path]);
  const removed = [];
  for (const [k, e] of before) {
    const now = after.get(k);
    if (!now || now.mode !== e.mode || !now.content.equals(e.content)) {
      rmSync(full(e.path), { force: true });
      removed.push(e.path);
    }
  }
  // As git does: a directory left empty goes too, so that a file can take its name.
  for (const path of removed) {
    for (let p = path, i = p.lastIndexOf(0x2f); i > 0; i = p.lastIndexOf(0x2f)) {
      p = p.subarray(0, i);
      try {
        rmdirSync(full(p));
      } catch {
        break; // not empty (or already gone): its parents are not empty either
      }
    }
  }
  for (const [k, e] of after) {
    const was = before.get(k);
    if (was && was.mode === e.mode && was.content.equals(e.content)) continue;
    const target = full(e.path);
    mkdirSync(target.subarray(0, target.lastIndexOf(0x2f)), { recursive: true });
    if (e.mode === '120000') symlinkSync(e.content, target);
    else {
      writeFileSync(target, e.content);
      chmodSync(target, e.mode === '100755' ? 0o755 : 0o644);
    }
  }
}
