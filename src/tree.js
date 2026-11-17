// File-tree model and repository construction.
//
// A "state" is a complete snapshot of a file tree. States are turned into git
// commits with `git fast-import`, i.e. with plumbing only: no working tree is
// involved, so file names that are awkward on a file system (or under a
// particular locale) are created exactly as specified, byte for byte.

import { mkdirSync, writeFileSync, symlinkSync, chmodSync } from 'node:fs';
import { toBuf, bytesToJson, bytesFromJson } from './bytes.js';
import { quoteFastImport } from './quote.js';
import { EPOCH } from './git.js';

export const MODE = Object.freeze({
  FILE: '100644',
  EXE: '100755',
  LINK: '120000',
  GITLINK: '160000',
});
const VALID_MODES = new Set(Object.values(MODE));

/** Create a tree entry. For symlinks `content` is the target, for gitlinks a 40-hex commit id. */
export function entry(path, content, mode = MODE.FILE) {
  const e = { path: toBuf(path), content: toBuf(content), mode };
  validateEntry(e);
  return e;
}
export const file = (path, content) => entry(path, content, MODE.FILE);
export const exe = (path, content) => entry(path, content, MODE.EXE);
export const symlink = (path, target) => entry(path, target, MODE.LINK);
export const gitlink = (path, sha) => entry(path, sha, MODE.GITLINK);

function validateEntry(e) {
  if (!VALID_MODES.has(e.mode)) throw new Error(`invalid mode ${e.mode}`);
  const p = e.path;
  if (p.length === 0) throw new Error('empty path');
  if (p.includes(0)) throw new Error('NUL in path');
  const parts = p.toString('latin1').split('/');
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') throw new Error(`invalid path component in ${JSON.stringify(p.toString('latin1'))}`);
    if (part.toLowerCase() === '.git') throw new Error('.git path component');
  }
  if (e.mode === MODE.GITLINK && !/^[0-9a-f]{40}$/.test(e.content.toString('latin1'))) {
    throw new Error('gitlink content must be a 40-hex object id');
  }
}

/** Normalise a state given as {files, message} or as a plain entry array. */
export function normalizeState(state, index = 0) {
  const files = Array.isArray(state) ? state : state.files;
  const message = (Array.isArray(state) ? undefined : state.message) ?? `state ${index}`;
  const seen = new Map();
  for (const e of files) {
    validateEntry(e);
    const key = e.path.toString('latin1');
    if (seen.has(key)) throw new Error(`duplicate path ${JSON.stringify(key)}`);
    seen.set(key, e);
  }
  // A path cannot be both a file and a directory.
  for (const key of seen.keys()) {
    const parts = key.split('/');
    for (let i = 1; i < parts.length; i++) {
      if (seen.has(parts.slice(0, i).join('/'))) throw new Error(`file/directory conflict at ${JSON.stringify(key)}`);
    }
  }
  return { message, files: [...seen.values()] };
}

/**
 * Import the states as a chain of commits. Returns the commit ids, one per state.
 * `tag` namespaces the refs so that many scenarios can share one repository.
 */
export function importStates(repo, states, tag = 'sc', parents = null) {
  const chunks = [];
  const push = (s) => chunks.push(typeof s === 'string' ? Buffer.from(s, 'latin1') : s);
  let mark = 0;
  const blobMarks = new Map(); // content(latin1) -> mark
  const norm = states.map((s, i) => normalizeState(s, i));

  for (const st of norm) {
    for (const e of st.files) {
      if (e.mode === MODE.GITLINK) continue;
      const key = e.content.toString('latin1');
      if (blobMarks.has(key)) continue;
      mark++;
      blobMarks.set(key, mark);
      push(`blob\nmark :${mark}\ndata ${e.content.length}\n`);
      push(e.content);
      push('\n');
    }
  }
  const commitMarks = [];
  norm.forEach((st, i) => {
    mark++;
    commitMarks.push(mark);
    const msg = Buffer.from(st.message.endsWith('\n') ? st.message : `${st.message}\n`, 'utf8');
    push(`commit refs/heads/${tag}-${i}\nmark :${mark}\n`);
    push(`author A U Thor <author@example.com> ${EPOCH + i * 60} +0000\n`);
    push(`committer C O Mitter <committer@example.com> ${EPOCH + i * 60} +0000\n`);
    push(`data ${msg.length}\n`);
    push(msg);
    // By default the states form a linear history. `parents` (one array of state
    // indexes per state) describes any other shape, e.g. a merge.
    const ps = parents ? parents[i] : i > 0 ? [i - 1] : [];
    ps.forEach((pi, k) => {
      if (!(pi >= 0 && pi < i)) throw new Error(`state ${i}: parent ${pi} must be an earlier state`);
      push(`${k === 0 ? 'from' : 'merge'} :${commitMarks[pi]}\n`);
    });
    push('deleteall\n');
    for (const e of st.files) {
      if (e.mode === MODE.GITLINK) {
        push(`M 160000 ${e.content.toString('latin1')} `);
      } else {
        push(`M ${e.mode} :${blobMarks.get(e.content.toString('latin1'))} `);
      }
      push(quoteFastImport(e.path));
      push('\n');
    }
    push('\n');
  });
  repo.git(['fast-import', '--quiet', '--force'], { input: Buffer.concat(chunks) });
  const refs = norm.map((_, i) => `refs/heads/${tag}-${i}`);
  const out = repo.git(['rev-parse', ...refs]).stdout.toString('latin1').trim().split('\n');
  if (out.length !== norm.length) throw new Error('rev-parse returned an unexpected number of ids');
  return out;
}

/** Write a state to a directory (for producers that need real files). Gitlinks become empty directories. */
export function materialize(dir, state) {
  const st = normalizeState(state);
  const root = toBuf(dir);
  mkdirSync(root, { recursive: true });
  for (const e of st.files) {
    const full = Buffer.concat([root, Buffer.from('/'), e.path]);
    const slash = full.lastIndexOf(0x2f);
    mkdirSync(full.subarray(0, slash), { recursive: true });
    if (e.mode === MODE.LINK) symlinkSync(e.content, full);
    else if (e.mode === MODE.GITLINK) mkdirSync(full, { recursive: true });
    else {
      writeFileSync(full, e.content);
      if (e.mode === MODE.EXE) chmodSync(full, 0o755);
    }
  }
}

// ---- JSON (de)serialisation of states, used for the reproducible recipes in the corpus.

export function stateToJson(state, index = 0) {
  const st = normalizeState(state, index);
  return {
    message: st.message,
    files: st.files.map((e) => {
      const o = { path: bytesToJson(e.path), content: bytesToJson(e.content) };
      if (e.mode !== MODE.FILE) o.mode = e.mode;
      return o;
    }),
  };
}

export function stateFromJson(json) {
  return {
    message: json.message,
    files: json.files.map((f) => entry(bytesFromJson(f.path), bytesFromJson(f.content), f.mode ?? MODE.FILE)),
  };
}
