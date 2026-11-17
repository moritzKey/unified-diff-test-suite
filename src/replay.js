// Verification of a parse against ground truth.
//
// A parse is only accepted into the corpus when
//   1. every file section matches git's --raw/--numstat record for that change
//      (paths, status, modes, similarity, object ids, line counts), and
//   2. replaying the parsed hunks on the old content reproduces the new content
//      byte for byte, with every line number and every "\ No newline at end of
//      file" marker exactly where the contents say it must be.
//
// Nothing here trusts the parser: the expectations in the corpus are facts
// about the repository states, checked independently of how they were parsed.

import { splitLines, bufEq, show, toBuf } from './bytes.js';
import { resolveNames, statusOf } from './refparse.js';
import { decodeBinaryBlock } from './gitbinary.js';

export class ReplayError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReplayError';
  }
}
const fail = (msg) => {
  throw new ReplayError(msg);
};

/**
 * Apply parsed unified hunks to `oldContent`, checking every claim they make.
 * Returns { content, added, deleted }.
 */
export function replayHunks(hunks, oldContent) {
  const { lines: old, finalNewline: oldNL } = splitLines(oldContent);
  const out = [];
  const marks = []; // parallel to `out`: was the line flagged "no newline"?
  let cursor = 0;
  let added = 0;
  let deleted = 0;
  let lastLineFromHunk = false;

  hunks.forEach((h, hi) => {
    const where = `hunk ${hi + 1}`;
    const startIdx = h.oldLines > 0 ? h.oldStart - 1 : h.oldStart;
    if (startIdx < cursor) fail(`${where}: starts at old line ${h.oldStart}, before the end of the previous hunk`);
    if (startIdx > old.length) fail(`${where}: starts at old line ${h.oldStart}, past the end of the old file (${old.length} lines)`);
    for (; cursor < startIdx; cursor++) {
      out.push(old[cursor]);
      marks.push(false);
    }
    const expectNewStart = h.newLines > 0 ? out.length + 1 : out.length;
    if (h.newStart !== expectNewStart) fail(`${where}: header says new start ${h.newStart}, contents put it at ${expectNewStart}`);
    let nOld = 0;
    let nNew = 0;
    for (const ln of h.lines) {
      if (ln.type !== '+') {
        if (cursor >= old.length) fail(`${where}: old side runs past the end of the old file`);
        if (!bufEq(old[cursor], ln.text)) {
          fail(`${where}: old line ${cursor + 1} is ${JSON.stringify(show(old[cursor]))} but the hunk says ${JSON.stringify(show(ln.text))}`);
        }
        const oldLacksNL = cursor === old.length - 1 && !oldNL;
        if (ln.type === '-' && ln.noNewline !== oldLacksNL) fail(`${where}: wrong no-newline marker on deleted old line ${cursor + 1}`);
        if (ln.oldNo !== cursor + 1) fail(`${where}: parser numbered old line ${cursor + 1} as ${ln.oldNo}`);
        cursor++;
        nOld++;
      } else if (ln.oldNo !== null) fail(`${where}: added line carries an old line number`);
      if (ln.type !== '-') {
        out.push(ln.text);
        marks.push(ln.noNewline);
        if (ln.newNo !== out.length) fail(`${where}: parser numbered new line ${out.length} as ${ln.newNo}`);
        nNew++;
      } else if (ln.newNo !== null) fail(`${where}: deleted line carries a new line number`);
      if (ln.type === '+') added++;
      if (ln.type === '-') deleted++;
    }
    if (nOld !== h.oldLines) fail(`${where}: header announces ${h.oldLines} old lines, body has ${nOld}`);
    if (nNew !== h.newLines) fail(`${where}: header announces ${h.newLines} new lines, body has ${nNew}`);
    lastLineFromHunk = true;
  });

  if (cursor < old.length) lastLineFromHunk = false;
  for (; cursor < old.length; cursor++) {
    out.push(old[cursor]);
    marks.push(false);
  }
  for (let i = 0; i < marks.length - 1; i++) {
    if (marks[i]) fail(`new line ${i + 1} is flagged "no newline at end of file" but is not the last line`);
  }
  let content;
  if (out.length === 0) content = Buffer.alloc(0);
  else {
    const lacksNL = lastLineFromHunk ? marks[marks.length - 1] : !oldNL;
    const parts = [];
    out.forEach((l, i) => {
      parts.push(l);
      if (i < out.length - 1 || !lacksNL) parts.push(Buffer.from('\n'));
    });
    content = Buffer.concat(parts);
  }
  return { content, added, deleted };
}

/** A context line flagged "no newline" must be the last line on BOTH sides. */
function checkContextMarkers(hunks, oldContent, newContent) {
  const o = splitLines(oldContent);
  const n = splitLines(newContent);
  for (const h of hunks) {
    for (const ln of h.lines) {
      if (ln.type !== ' ') continue;
      const oldLast = ln.oldNo === o.lines.length && !o.finalNewline;
      const newLast = ln.newNo === n.lines.length && !n.finalNewline;
      if (ln.noNewline !== (oldLast && newLast)) fail(`wrong no-newline marker on context line ${ln.oldNo}/${ln.newNo}`);
      if (oldLast !== newLast) fail(`context line ${ln.oldNo}/${ln.newNo} ends differently on the two sides`);
    }
  }
}

const STATUS = { A: 'added', D: 'deleted', M: 'modified', R: 'renamed', C: 'copied' };
const ZERO_MODE = '000000';

/** Expand git's --raw records into the sections the patch text is expected to contain. */
export function expectedSections(truth) {
  const out = [];
  for (const e of truth) {
    if (e.status === 'T') {
      // A type change (file <-> symlink <-> submodule) is written as a deletion followed by an addition.
      out.push({ ...e, status: 'D', newPath: null, newMode: ZERO_MODE, typeChange: 'old' });
      out.push({ ...e, status: 'A', oldPath: null, oldMode: ZERO_MODE, typeChange: 'new' });
    } else out.push(e);
  }
  return out;
}

/**
 * Verify the parse of a git patch.
 *   truth    - merged --raw/--numstat records for the same comparison
 *   contents - { old(entry) -> Buffer, new(entry) -> Buffer } content lookup
 *   prefixes - { src, dst } the producer was run with
 *   opts.deletionsOmitted - the producer was run with --irreversible-delete
 *   opts.textForced       - the producer was run with --text (binary files shown as text;
 *                           --numstat still reports them as binary)
 */
export function verifyGitParse(parse, truth, contents, prefixes, opts = {}) {
  if (parse.errors.length) fail(`parser reported errors: ${JSON.stringify(parse.errors)}`);
  const want = expectedSections(truth);
  if (parse.files.length !== want.length) {
    fail(`patch has ${parse.files.length} file sections, ground truth expects ${want.length}`);
  }
  parse.files.forEach((f, idx) => {
    const e = want[idx];
    const where = `section ${idx + 1} (${show(e.newPath ?? e.oldPath)})`;
    const check = (cond, msg) => {
      if (!cond) fail(`${where}: ${msg}`);
    };
    try {
      check(f.kind === 'git', `expected a git section, got ${f.kind}`);
      const names = resolveNames(f, prefixes);
      check(bufEq(names.oldPath, e.oldPath), `old path ${show(names.oldPath)} != ${show(e.oldPath)}`);
      check(bufEq(names.newPath, e.newPath), `new path ${show(names.newPath)} != ${show(e.newPath)}`);
      const wantOldName = e.oldPath === null ? null : Buffer.concat([toBuf(prefixes.src), e.oldPath]);
      const wantNewName = e.newPath === null ? null : Buffer.concat([toBuf(prefixes.dst), e.newPath]);
      check(bufEq(names.oldName, wantOldName), `old name ${show(names.oldName)} != ${show(wantOldName)}`);
      check(bufEq(names.newName, wantNewName), `new name ${show(names.newName)} != ${show(wantNewName)}`);
      check(statusOf(f) === STATUS[e.status], `status ${statusOf(f)} != ${STATUS[e.status]}`);

      const hasModeInfo = f.indexOld !== null || f.isNew || f.isDeleted || e.oldMode !== e.newMode;
      if (e.oldMode === ZERO_MODE) check(f.oldMode === null, `old mode should be absent, got ${f.oldMode}`);
      else if (hasModeInfo) check(f.oldMode === e.oldMode, `old mode ${f.oldMode} != ${e.oldMode}`);
      else check(f.oldMode === null || f.oldMode === e.oldMode, `old mode ${f.oldMode} != ${e.oldMode}`);
      if (e.newMode === ZERO_MODE) check(f.newMode === null, `new mode should be absent, got ${f.newMode}`);
      else if (hasModeInfo) check(f.newMode === e.newMode, `new mode ${f.newMode} != ${e.newMode}`);
      else check(f.newMode === null || f.newMode === e.newMode, `new mode ${f.newMode} != ${e.newMode}`);

      if (e.status === 'R' || e.status === 'C') check(f.similarity === e.score, `similarity ${f.similarity} != ${e.score}`);
      if (e.status === 'M' && e.score !== null) check(f.dissimilarity === e.score, `dissimilarity ${f.dissimilarity} != ${e.score}`);
      if (f.indexOld !== null) {
        const wantOld = e.typeChange === 'new' || e.status === 'A' ? '0'.repeat(f.indexOld.length) : e.oldId.slice(0, f.indexOld.length);
        const wantNew = e.typeChange === 'old' || e.status === 'D' ? '0'.repeat(f.indexNew.length) : e.newId.slice(0, f.indexNew.length);
        check(f.indexOld === wantOld, `index old id ${f.indexOld} != ${wantOld}`);
        check(f.indexNew === wantNew, `index new id ${f.indexNew} != ${wantNew}`);
      }

      const oldContent = e.oldPath === null ? Buffer.alloc(0) : contents.old(e);
      const newContent = e.newPath === null ? Buffer.alloc(0) : contents.new(e);
      // numstat has ONE record for a type change, so its binary flag covers both halves. Each
      // half is binary on its own merits: a regular file with a NUL byte in its first 8000 bytes.
      const looksBinary = (content, mode) => (mode === '100644' || mode === '100755') && content.subarray(0, 8000).includes(0);
      const isBinary = e.typeChange ? (e.typeChange === 'old' ? looksBinary(oldContent, e.oldMode) : looksBinary(newContent, e.newMode)) : e.binary;
      let added = 0;
      let deleted = 0;
      if (f.binary) {
        check(isBinary, 'section is binary but numstat counted lines');
        check(f.hunks.length === 0, 'binary section has text hunks');
        if (f.binary === 'patch') {
          check(f.binaryPatch.length === 2, `binary patch has ${f.binaryPatch.length} blocks, expected forward and reverse`);
          const fwd = decodeBinaryBlock(f.binaryPatch[0], oldContent);
          check(bufEq(fwd, newContent), 'forward binary block does not reproduce the new content');
          const rev = decodeBinaryBlock(f.binaryPatch[1], newContent);
          check(bufEq(rev, oldContent), 'reverse binary block does not reproduce the old content');
        }
      } else {
        const shownAsText = isBinary && opts.textForced && f.hunks.length > 0;
        check(!isBinary || f.hunks.length === 0 || shownAsText, 'numstat says binary but the section has text hunks');
        if (isBinary && !shownAsText) {
          // A binary file whose section carries neither a notice nor a patch: only legal when nothing
          // about the content had to be shown (pure rename, mode change, or an omitted deletion).
          check(bufEq(oldContent, newContent) || (opts.deletionsOmitted && e.status === 'D'), 'binary change without a binary notice');
        } else if (opts.deletionsOmitted && e.status === 'D' && f.hunks.length === 0) {
          deleted = null; // content deliberately omitted by --irreversible-delete
        } else {
          const r = replayHunks(f.hunks, oldContent);
          check(bufEq(r.content, newContent), `replaying the hunks gives ${JSON.stringify(show(r.content, 200))}, expected ${JSON.stringify(show(newContent, 200))}`);
          checkContextMarkers(f.hunks, oldContent, newContent);
          added = r.added;
          deleted = r.deleted;
        }
      }
      if (e.typeChange) {
        // numstat has one record for a type change and counts it as ONE diff between the two
        // contents (a line they happen to share is neither added nor deleted), while the patch
        // deletes the old content and adds the new one in two sections. The counts therefore
        // need not agree; the replay above has verified both sections completely.
      } else if (!e.binary && deleted !== null) {
        check(added === e.added, `${added} added lines, numstat says ${e.added}`);
        check(deleted === e.deleted, `${deleted} deleted lines, numstat says ${e.deleted}`);
      }
    } catch (err) {
      if (err instanceof ReplayError) throw err;
      fail(`${where}: ${err.message}`);
    }
  });
  return true;
}

/**
 * Verify the parse of a plain (GNU diff) patch against two directory states.
 *   changes - [{ oldName, newName, oldContent, newContent, binary }] in output order
 */
export function verifyPlainParse(parse, changes) {
  if (parse.errors.length) fail(`parser reported errors: ${JSON.stringify(parse.errors)}`);
  if (parse.files.length !== changes.length) {
    fail(`patch has ${parse.files.length} file sections, expected ${changes.length}`);
  }
  parse.files.forEach((f, idx) => {
    const c = changes[idx];
    const where = `section ${idx + 1} (${show(c.newName ?? c.oldName)})`;
    const check = (cond, msg) => {
      if (!cond) fail(`${where}: ${msg}`);
    };
    check(f.kind === 'plain', `expected a plain section, got ${f.kind}`);
    check(bufEq(f.oldName, c.oldName), `old name ${show(f.oldName)} != ${show(c.oldName)}`);
    check(bufEq(f.newName, c.newName), `new name ${show(f.newName)} != ${show(c.newName)}`);
    if (c.binary) {
      check(f.binary === 'differ', 'expected a "Binary files ... differ" notice');
      return;
    }
    check(!f.binary, 'unexpected binary notice');
    const r = replayHunks(f.hunks, c.oldContent);
    check(bufEq(r.content, c.newContent), `replaying the hunks gives ${JSON.stringify(show(r.content, 200))}, expected ${JSON.stringify(show(c.newContent, 200))}`);
    checkContextMarkers(f.hunks, c.oldContent, c.newContent);
  });
  return true;
}

/**
 * Verify one combined-diff section against the merge result and its parents.
 * Combined hunks cannot be replayed into a whole file (they omit regions that
 * match one parent), but every hunk makes checkable claims about a line range
 * of the result and of each parent.
 */
export function verifyCombinedSection(f, resultContent, parentContents) {
  const res = splitLines(resultContent);
  const parents = parentContents.map((c) => splitLines(c));
  f.hunks.forEach((h, hi) => {
    const where = `combined hunk ${hi + 1}`;
    if (h.parents.length !== parents.length) fail(`${where}: ${h.parents.length} parent ranges for ${parents.length} parents`);
    let rNo = h.newLines > 0 ? h.newStart : h.newStart + 1;
    const pNo = h.parents.map((r) => (r.lines > 0 ? r.start : r.start + 1));
    let rCount = 0;
    const pCount = h.parents.map(() => 0);
    for (const ln of h.lines) {
      const inResult = !ln.markers.includes('-');
      if (inResult) {
        const got = res.lines[rNo - 1];
        if (got === undefined || !bufEq(got, ln.text)) fail(`${where}: result line ${rNo} is ${JSON.stringify(show(got))}, hunk says ${JSON.stringify(show(ln.text))}`);
        rNo++;
        rCount++;
      }
      for (let p = 0; p < parents.length; p++) {
        const inParent = inResult ? ln.markers[p] === ' ' : ln.markers[p] === '-';
        if (!inParent) continue;
        const got = parents[p].lines[pNo[p] - 1];
        if (got === undefined || !bufEq(got, ln.text)) fail(`${where}: parent ${p + 1} line ${pNo[p]} is ${JSON.stringify(show(got))}, hunk says ${JSON.stringify(show(ln.text))}`);
        pNo[p]++;
        pCount[p]++;
      }
    }
    if (rCount !== h.newLines) fail(`${where}: header announces ${h.newLines} result lines, body has ${rCount}`);
    h.parents.forEach((r, p) => {
      if (pCount[p] !== r.lines) fail(`${where}: header announces ${r.lines} lines for parent ${p + 1}, body has ${pCount[p]}`);
    });
  });
  return true;
}
