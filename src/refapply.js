// Reference applier: what a diff does to a file, and to a tree of files.
//
// Like the reference parser it is strict and small, and it is only trusted
// because it is checked: for every vector that is a patch, applying the diff to
// the recorded old tree must give the recorded new tree (test/apply.test.js).
//
// Two rules are easy to get wrong and are spelled out here:
//
//   * Every section reads the tree as it was BEFORE the patch. A patch may
//     rename a to b and b to a, or copy a file that it also changes; the copy
//     is a copy of the old content.
//   * Hunks are applied where their header says, and every context and deleted
//     line must be what the file has there. Nothing is searched for, nothing is
//     guessed (no "fuzz", no offset).

import { show, toBuf } from './bytes.js';
import { decodeBinaryBlock } from './gitbinary.js';
import { inferPrefixes, parseDiff, resolveNames, statusOf } from './refparse.js';
import { replayHunks } from './replay.js';
import { MODE } from './tree.js';

const key = (buf) => buf.toString('latin1');
const EMPTY = Buffer.alloc(0);

/** The content a parsed file section turns `oldContent` into (`null`: the file did not exist). */
export function applySection(f, oldContent) {
  const base = oldContent ?? EMPTY;
  if (f.kind === 'combined') throw new Error('a combined diff describes a merge and cannot be applied');
  if (f.binary === 'patch') return decodeBinaryBlock(f.binaryPatch[0], base);
  if (f.binary) throw new Error('binary files differ and the diff does not carry their content');
  if (f.hunks.length === 0) return base;
  return replayHunks(f.hunks, base).content;
}

/** Apply a diff that has exactly one file section to the content of that file. */
export function applyToContent(diff, oldContent) {
  const { files, errors } = parseDiff(toBuf(diff));
  if (errors.length) throw new Error(`cannot read the diff: ${JSON.stringify(errors[0])}`);
  if (files.length !== 1) throw new Error(`expected one file section, found ${files.length}`);
  return applySection(files[0], oldContent);
}

/** The first `n` path components of a name, slashes included (what `patch -pN` removes). */
function leading(name, n) {
  if (!name) return null;
  let pos = 0;
  for (let k = 0; k < n; k++) {
    const slash = name.indexOf(0x2f, pos);
    if (slash === -1) return null;
    pos = slash + 1;
  }
  return name.subarray(0, pos);
}

function prefixesFor(f, strip) {
  const src = leading(f.oldName ?? f.headerOld, strip);
  const dst = leading(f.newName ?? f.headerNew, strip);
  if (src === null && dst === null) return inferPrefixes(f);
  return { src: src ?? dst, dst: dst ?? src };
}

/** GNU diff -N writes the timestamp of the epoch for a file that does not exist. */
function isEpoch(trailer) {
  if (!trailer) return false;
  const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)(?:\.\d+)? ([+-])(\d\d)(\d\d)$/.exec(trailer.toString('latin1').trim());
  if (!m) return false;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const zone = (m[7] === '-' ? -1 : 1) * (+m[8] * 60 + +m[9]) * 60000;
  return utc - zone === 0;
}

/**
 * Apply a diff to a tree. `entries` is the tree before, a list of
 * {path, content, mode}; `strip` is the number of leading path components the
 * names in the diff carry (1 for git's a/ and b/). Returns the tree after.
 * Throws, and changes nothing, if any part of the diff does not apply.
 */
export function applyToTree(diff, entries, strip = 1) {
  const { files, errors } = parseDiff(toBuf(diff));
  if (errors.length) throw new Error(`cannot read the diff: ${JSON.stringify(errors[0])}`);
  if (files.length === 0) throw new Error('no file section found');
  const before = new Map(entries.map((e) => [key(e.path), e]));
  const removals = [];
  const writes = [];
  for (const f of files) {
    if (f.kind === 'combined') throw new Error('a combined diff describes a merge and cannot be applied');
    const names = resolveNames(f, prefixesFor(f, strip));
    let status = statusOf(f);
    const source = names.oldPath === null ? null : before.get(key(names.oldPath)) ?? null;
    if (f.kind === 'plain') {
      // GNU diff has no "new file" or "deleted file" line.
      if (!source) status = 'added';
    } else if (names.oldPath !== null && !source) {
      throw new Error(`${JSON.stringify(show(names.oldPath))} does not exist`);
    }
    const target = status === 'deleted' ? names.oldPath : names.newPath ?? names.oldPath;
    if (target === null) throw new Error(`section ${files.indexOf(f) + 1}: cannot tell which file is meant`);
    const content = applySection(f, source ? source.content : null);
    if (status === 'deleted' || (f.kind === 'plain' && content.length === 0 && isEpoch(f.newTrailer))) {
      if (content.length !== 0) throw new Error(`${JSON.stringify(show(target))}: a deletion that does not remove all the content`);
      removals.push(target);
      continue;
    }
    if (status === 'renamed') removals.push(names.oldPath);
    writes.push({ path: target, content, mode: f.newMode ?? (source ? source.mode : MODE.FILE) });
  }
  const after = new Map(before);
  for (const path of removals) after.delete(key(path));
  for (const entry of writes) after.set(key(entry.path), entry);
  return [...after.values()];
}
