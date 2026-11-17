// Read a directory back as a file tree, and compare two file trees.
//
// Paths are bytes, as everywhere in this project. A tree is a Map from the
// path (as a latin1 string, so that every byte sequence is a distinct key) to
// { path, mode, content }: regular files with or without the executable bit,
// and symbolic links, whose content is their target. Directories are not
// entries; an empty directory is nothing.

import { lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { show, toBuf } from './bytes.js';
import { MODE } from './tree.js';

const SLASH = Buffer.from('/');

/** Scan a directory. A `.git` at the top is not part of the tree. */
export function scanTree(dir) {
  const root = toBuf(dir);
  const tree = new Map();
  const walk = (rel) => {
    const full = rel.length ? Buffer.concat([root, SLASH, rel]) : root;
    for (const name of readdirSync(full, { encoding: 'buffer' })) {
      if (rel.length === 0 && name.toString('latin1') === '.git') continue;
      const path = rel.length ? Buffer.concat([rel, SLASH, name]) : name;
      const abs = Buffer.concat([root, SLASH, path]);
      const st = lstatSync(abs);
      if (st.isDirectory()) walk(path);
      else if (st.isSymbolicLink()) tree.set(path.toString('latin1'), { path, mode: MODE.LINK, content: readlinkSync(abs, { encoding: 'buffer' }) });
      else if (st.isFile()) tree.set(path.toString('latin1'), { path, mode: st.mode & 0o111 ? MODE.EXE : MODE.FILE, content: readFileSync(abs) });
      else tree.set(path.toString('latin1'), { path, mode: 'other', content: Buffer.alloc(0) });
    }
  };
  walk(Buffer.alloc(0));
  return tree;
}

/** A Map as scanTree returns it, from a list of {path, content, mode}. */
export function treeOf(entries) {
  return new Map(entries.map((e) => [e.path.toString('latin1'), e]));
}

const kindOf = (mode) => (mode === MODE.LINK ? 'a symbolic link' : mode === 'other' ? 'neither a file nor a link' : 'a file');

function firstDifference(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  const line = a.subarray(0, i).reduce((count, byte) => count + (byte === 0x0a ? 1 : 0), 1);
  const from = Math.max(0, i - 12);
  return `first difference at byte ${i} (line ${line}): expected "${show(b.subarray(from, i + 24), 60)}", got "${show(a.subarray(from, i + 24), 60)}"`;
}

/**
 * Compare what is there with what should be there. Returns findings
 * [{kind, message}] with the kinds
 *   missing - a file that should exist does not
 *   extra   - a file exists that should not (a leftover, a backup, a reject)
 *   type    - a file where a symbolic link should be, or the reverse
 *   content - the bytes differ
 *   mode    - the executable bit differs (only when `modes` is true)
 */
export function compareTrees(actual, expected, { modes = true } = {}) {
  const findings = [];
  const add = (kind, message) => findings.push({ kind, message });
  for (const [k, want] of expected) {
    const got = actual.get(k);
    const name = `"${show(want.path)}"`;
    if (!got) {
      add('missing', `${name} does not exist`);
      continue;
    }
    if ((got.mode === MODE.LINK) !== (want.mode === MODE.LINK) || got.mode === 'other') {
      add('type', `${name} is ${kindOf(got.mode)}, expected ${kindOf(want.mode)}`);
      continue;
    }
    if (!got.content.equals(want.content)) {
      add('content', `${name}: ${got.content.length} bytes, expected ${want.content.length}; ${firstDifference(got.content, want.content)}`);
    }
    if (modes && got.mode !== want.mode) add('mode', `${name} has mode ${got.mode}, expected ${want.mode}`);
  }
  for (const [k, got] of actual) {
    if (!expected.has(k)) add('extra', `"${show(got.path)}" exists and should not`);
  }
  return findings;
}
