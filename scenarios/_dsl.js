// A small vocabulary for writing scenarios.
//
// A tree is written as an object { 'path': content } or, when a path is not
// valid UTF-8 or the order matters, as an array of [path, content] pairs.
// `content` is a string, a Buffer, or one of the wrappers below.

import { entry, MODE } from '../src/tree.js';

/** An executable file. */
export const x = (content) => ({ content, mode: MODE.EXE });
/** A symbolic link. */
export const link = (target) => ({ content: target, mode: MODE.LINK });
/** A submodule (gitlink) pointing at a commit id. */
export const sub = (sha) => ({ content: sha, mode: MODE.GITLINK });
/** Raw bytes. */
export const bytes = (...b) => Buffer.from(b.flat());
/** A 40-hex id made of one repeated digit, for submodules. */
export const oid = (ch) => String(ch).repeat(40);
/** Numbered lines: lines(3) -> "1\n2\n3\n". */
export const lines = (n, f = (i) => String(i)) => Array.from({ length: n }, (_, i) => `${f(i + 1)}\n`).join('');

export function tree(spec) {
  const pairs = Array.isArray(spec) ? spec : Object.entries(spec);
  return pairs.map(([path, value]) => {
    if (typeof value === 'string' || Buffer.isBuffer(value)) return entry(path, value);
    return entry(path, value.content, value.mode);
  });
}

function base(tier, id, d, producer) {
  if (!d.title) throw new Error(`scenario ${id} has no title`);
  const states = d.states ? d.states.map((s) => (s.files ? { message: s.message, files: tree(s.files) } : tree(s))) : [tree(d.before ?? {}), tree(d.after ?? {})];
  return {
    id: `${tier}/${id}`,
    tier,
    title: d.title,
    description: d.why ? d.why.replace(/\s+/g, ' ').trim() : null,
    tags: d.tags ?? [],
    states,
    parents: d.parents,
    producer,
    // Text the diff has to contain: a guard that a scenario really shows what its title says.
    mustContain: d.mustContain ?? [],
  };
}

const pick = (d, keys) => Object.fromEntries(keys.filter((k) => d[k] !== undefined).map((k) => [k, d[k]]));

/** `git diff` (or another git command via `kind`) with default naming conventions. */
export const git = (id, d) =>
  base(d.tier ?? 'git', id, d, { kind: d.kind ?? 'git-diff', args: d.args ?? [], ...pick(d, ['config', 'prefixes', 'from', 'to', 'truthArgs', 'gitApply', 'relative']) });

/** git output with something around the patch: commit headers, mail headers, statistics. */
export const wrapped = (id, d) => git(id, { ...d, tier: 'git-wrapped', tags: ['prelude', ...(d.tags ?? []).filter((t) => t !== 'prelude')] });

/** git output whose names are presented differently because of configuration or options. */
export const gitConfig = (id, d) => git(id, { ...d, tier: 'git-config' });

/** A combined ("merge") diff. `states` and `parents` describe the commit graph. */
export const merge = (id, d) =>
  base('combined', id, d, { kind: 'git-merge', args: d.args ?? [], ...pick(d, ['config', 'command', 'merge']) });

/** GNU diff. */
export const gnu = (id, d) =>
  base('gnu', id, d, { kind: 'gnu-diff', args: d.args ?? ['-ruN'], ...pick(d, ['dirs', 'env', 'from', 'to', 'file']) });
