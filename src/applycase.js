// What applying a vector's diff must do.
//
// Every vector records the file trees it was made from. For most of them the
// diff is a patch in the plain sense: applied to the old tree it must give the
// new tree, byte for byte. This module says for which vectors that holds, and
// what the two trees are. Nothing here depends on a parser: the expected
// result is the recorded tree, not something computed from the diff.

import { bytesFromJson } from './bytes.js';
import { MODE, normalizeState, stateFromJson } from './tree.js';

const skip = (reason) => ({ skip: reason });
const key = (buf) => buf.toString('latin1');

/**
 * Returns { old, new, strip, modes, from, to } - the tree before, the tree
 * after (arrays of {path, content, mode}), the number of leading path
 * components the names in the diff carry (the N of `patch -pN`), whether the
 * diff states file modes, and the indexes of the two trees in recipe.states
 * (`from` is null for "nothing") - or { skip: reason } when the diff is not a
 * patch for a tree.
 */
export function applyCase(vector) {
  const r = vector.recipe;
  const args = r.args ?? [];
  if (r.kind === 'git-merge') return skip('a combined diff describes a merge, it is not a patch');
  if (vector.expected.files.length === 0) return skip('the diff is empty');
  const states = r.states.map((s, i) => normalizeState(stateFromJson(s), i));
  let from;
  let to;
  if (['git-diff', 'git-diff-cached', 'git-diff-worktree', 'gnu-diff'].includes(r.kind)) {
    from = r.from ?? 0;
    to = r.to ?? 1;
  } else if (r.kind === 'git-show') {
    to = r.to ?? 1;
    from = to === 0 ? null : to - 1;
  } else if (r.kind === 'git-format-patch' && states.length === 2) {
    from = 0;
    to = 1;
  } else {
    return skip('several commits in one text');
  }
  if (args.includes('-D') || args.includes('--irreversible-delete')) return skip('made with -D, which leaves out what a deletion removes');
  if (r.relative) return skip('made with --relative');
  if (args.some((a) => a === '--label' || a.startsWith('--label='))) return skip('the names are labels, not paths');

  const prefixes = [vector.prefixes?.old, vector.prefixes?.new].map((p) => (p === undefined || p === null ? null : key(bytesFromJson(p))));
  if (prefixes.some((p) => p === null || !/^([^/]+\/)*$/.test(p))) return skip('the names carry a prefix that is not a directory');
  const depth = (p) => p.split('/').length - 1;
  if (depth(prefixes[0]) !== depth(prefixes[1])) return skip('the two sides carry prefixes of different depth');

  let before = from === null ? [] : states[from].files;
  let after = states[to].files;
  if (args.includes('-R')) {
    if (from === null) return skip('a reversed diff of a root commit');
    [before, after] = [after, before];
    [from, to] = [to, from];
  }
  const all = [...before, ...after];
  if (all.some((e) => e.mode === MODE.GITLINK)) return skip('a submodule is involved');
  if (vector.expected.files.some((f) => f.binary && f.binary !== 'patch')) {
    return skip('a binary file changed and the diff does not carry its content');
  }
  const gnu = r.kind === 'gnu-diff';
  if (gnu && all.some((e) => e.mode === MODE.LINK)) return skip('GNU diff follows symbolic links');

  // The diff must account for every difference between the two trees. (GNU
  // diff without -N only mentions files that exist on one side, and it never
  // mentions a file mode.)
  const touched = new Set();
  for (const f of vector.expected.files) {
    for (const p of [f.old_path, f.new_path, f.path]) if (p !== null && p !== undefined) touched.add(key(bytesFromJson(p)));
  }
  const a = new Map(before.map((e) => [key(e.path), e]));
  const b = new Map(after.map((e) => [key(e.path), e]));
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(path);
    const y = b.get(path);
    const same = x && y && x.content.equals(y.content) && (gnu || x.mode === y.mode);
    if (!same && !touched.has(path)) return skip('the diff does not describe every difference between the two trees');
  }
  return { old: before, new: after, strip: depth(prefixes[0]), modes: !gnu, from, to };
}

/** The same in the form that is stored in a vector (`apply`), for readers in any language. */
export function applyInfo(vector) {
  const c = applyCase(vector);
  return c.skip ? { skip: c.skip } : { from: c.from, to: c.to, strip: c.strip, modes: c.modes };
}
