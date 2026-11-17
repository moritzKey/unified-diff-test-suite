// Reference parser for unified diffs as produced by git and GNU diff.
//
// This parser exists to state, in executable form, what the bytes of a diff
// mean. It is deliberately strict about one thing that most hand-written
// parsers get wrong: a hunk is read by COUNTING the lines announced in its
// `@@ -a,b +c,d @@` header, never by looking for the next thing that resembles
// a header. Inside a hunk, a line is content no matter what it looks like - a
// deleted SQL comment `-- note` is spelled `--- note` in a diff, and that is
// not a file header.
//
// Everything is handled as bytes. Lines are separated by LF and by nothing
// else: CR, form feed, U+2028 and friends are ordinary content.
//
// The output of this module is only trusted because src/replay.js checks every
// parse against ground truth (the blobs git diffed, and git's own --raw and
// --numstat output). See the README for how the pieces fit together.

import { splitLines, startsWith, toBuf, bufEq, TAB, SPACE, DQUOTE } from './bytes.js';
import { unquoteC } from './quote.js';

const DEV_NULL = Buffer.from('/dev/null');
const B = (s) => Buffer.from(s, 'latin1');
const latin1 = (buf) => buf.toString('latin1');

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@([\s\S]*)$/;
const INDEX_RE = /^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: (\d{6}))?$/;
const COMBINED_INDEX_RE = /^index ([0-9a-f]+(?:,[0-9a-f]+)+)\.\.([0-9a-f]+)$/;
const SIMILARITY_RE = /^(dis)?similarity index (\d+)%$/;
const MODE_RE = /^(old mode|new mode|deleted file mode|new file mode) (\d{6})$/;

function emptyFile(kind, startLine) {
  return {
    kind, // 'git' | 'plain' | 'combined'
    startLine,
    endLine: startLine,
    headerOld: null, // names on the "diff --git" line (still carrying their prefix), when unambiguous
    headerNew: null,
    oldName: null, // name on the "--- " line (prefix included), null for /dev/null or when absent
    newName: null,
    hasFileLines: false, // were "---"/"+++" lines present?
    oldIsNull: false, // "--- /dev/null"
    newIsNull: false,
    oldTrailer: null, // text after the TAB on the "---"/"+++" line (GNU diff timestamps)
    newTrailer: null,
    renameFrom: null,
    renameTo: null,
    copyFrom: null,
    copyTo: null,
    oldMode: null,
    newMode: null,
    isNew: false,
    isDeleted: false,
    similarity: null,
    dissimilarity: null,
    indexOld: null,
    indexNew: null,
    binary: false, // false | 'differ' | 'patch'
    binaryPatch: null,
    hunks: [],
    // combined diffs only:
    parents: 0,
    combinedPath: null,
  };
}

/** Parse the text after "--- " or "+++ ". Returns { name, isNull, trailer }. */
export function parseFileLine(rest) {
  if (rest[0] === DQUOTE) {
    const q = unquoteC(rest, 0);
    if (q) {
      const after = rest.subarray(q.end);
      // git never puts anything but an optional TAB after a quoted name; GNU diff puts TAB + timestamp.
      if (after.length === 0 || after[0] === TAB) {
        return { name: q.value, isNull: false, trailer: after.length ? after.subarray(1) : null };
      }
    }
    // Not a well-formed quoted name: fall through and treat the bytes literally.
  }
  const tab = rest.indexOf(TAB);
  const name = tab === -1 ? rest : rest.subarray(0, tab);
  const trailer = tab === -1 ? null : rest.subarray(tab + 1);
  if (bufEq(name, DEV_NULL)) return { name: null, isNull: true, trailer };
  return { name: Buffer.from(name), isNull: false, trailer };
}

/**
 * Length of the longest common suffix of a and b that starts with "/" and has
 * something after it ("/src/app.js"), or 0. What precedes that suffix on each
 * side is the prefix the name was written with ("a/" and "b/" by default).
 */
function commonPathSuffix(a, b) {
  let k = 0;
  let best = 0;
  while (k < a.length && k < b.length && a[a.length - 1 - k] === b[b.length - 1 - k]) {
    k++;
    if (a[a.length - k] === 0x2f && k > 1) best = k;
  }
  return best;
}

/**
 * How well two names agree on being "the same path behind two prefixes":
 * 0 if they do not, otherwise larger for a longer shared path.
 */
function samePathScore(a, b) {
  if (bufEq(a, b)) return a.length + 1; // no prefix at all: the whole name is the path
  return commonPathSuffix(a, b);
}

function sameModuloPrefix(a, b) {
  return samePathScore(a, b) > 0;
}

/**
 * Split the text after "diff --git " into the two names it holds.
 *
 * The line is ambiguous by construction: names may contain spaces and are only
 * quoted when they contain "special" bytes. git's own reader (apply.c) relies
 * on the fact that, unless the file was renamed, both names are the same path
 * behind their respective prefixes - and so do we. Returns [old, new] or null.
 */
export function parseGitHeaderNames(rest) {
  if (rest[0] === DQUOTE) {
    const q1 = unquoteC(rest, 0);
    if (!q1 || rest[q1.end] !== SPACE) return null;
    const second = rest.subarray(q1.end + 1);
    if (second[0] === DQUOTE) {
      const q2 = unquoteC(second, 0);
      if (!q2 || q2.end !== second.length) return null;
      return [q1.value, q2.value];
    }
    return [q1.value, Buffer.from(second)];
  }
  // First name unquoted. The second may be quoted: `a/plain "b/we\tird"`.
  if (rest[rest.length - 1] === DQUOTE) {
    for (let i = rest.indexOf(B(' "')); i !== -1; i = rest.indexOf(B(' "'), i + 1)) {
      const q2 = unquoteC(rest, i + 1);
      if (q2 && q2.end === rest.length) return [Buffer.from(rest.subarray(0, i)), q2.value];
    }
  }
  // Both unquoted: find the space that splits the line into "the same name twice".
  const candidates = [];
  for (let i = rest.indexOf(SPACE); i !== -1; i = rest.indexOf(SPACE, i + 1)) {
    const a = rest.subarray(0, i);
    const b = rest.subarray(i + 1);
    const score = a.length && b.length ? samePathScore(a, b) : 0;
    if (score > 0) candidates.push({ pair: [Buffer.from(a), Buffer.from(b)], score });
  }
  if (candidates.length > 0) {
    // Several spaces may qualify; the right one leaves the longest shared path
    // (and therefore the shortest prefixes).
    candidates.sort((x, y) => y.score - x.score);
    if (candidates.length === 1 || candidates[0].score > candidates[1].score) return candidates[0].pair;
    return null;
  }
  // A rename/copy with plain names: unambiguous only if there is exactly one space.
  const first = rest.indexOf(SPACE);
  if (first !== -1 && first === rest.lastIndexOf(SPACE) && first > 0 && first < rest.length - 1) {
    return [Buffer.from(rest.subarray(0, first)), Buffer.from(rest.subarray(first + 1))];
  }
  return null;
}

function parsePathValue(rest) {
  if (rest[0] === DQUOTE) {
    const q = unquoteC(rest, 0);
    if (q && q.end === rest.length) return q.value;
  }
  return Buffer.from(rest);
}

class Parser {
  constructor(lines, finalNewline) {
    this.lines = lines;
    this.finalNewline = finalNewline;
    this.files = [];
    this.errors = [];
  }

  error(lineIndex, message) {
    this.errors.push({ line: lineIndex + 1, message });
  }

  run() {
    const { lines } = this;
    let i = 0;
    while (i < lines.length) {
      const L = lines[i];
      if (startsWith(L, 'diff --git ')) i = this.gitSection(i);
      else if (startsWith(L, 'diff --cc ') || startsWith(L, 'diff --combined ')) i = this.combinedSection(i);
      else if (
        startsWith(L, '--- ') &&
        i + 2 < lines.length &&
        startsWith(lines[i + 1], '+++ ') &&
        startsWith(lines[i + 2], '@@ -')
      ) {
        i = this.plainSection(i);
      } else if (startsWith(L, 'Binary files ') && latin1(L).endsWith(' differ')) {
        this.plainBinaryNotice(i);
        i++;
      } else i++; // prelude: commit headers, stat blocks, "Only in ...", mail signatures, ...
    }
    return { files: this.files, errors: this.errors };
  }

  // ---- git sections -------------------------------------------------------

  gitSection(start) {
    const { lines } = this;
    const f = emptyFile('git', start);
    const names = parseGitHeaderNames(lines[start].subarray('diff --git '.length));
    if (names) [f.headerOld, f.headerNew] = names;
    let i = start + 1;

    for (; i < lines.length; i++) {
      const L = lines[i];
      const s = latin1(L);
      let m;
      if ((m = MODE_RE.exec(s))) {
        if (m[1] === 'old mode') f.oldMode = m[2];
        else if (m[1] === 'new mode') f.newMode = m[2];
        else if (m[1] === 'deleted file mode') {
          f.oldMode = m[2];
          f.isDeleted = true;
        } else {
          f.newMode = m[2];
          f.isNew = true;
        }
      } else if (startsWith(L, 'rename from ')) f.renameFrom = parsePathValue(L.subarray(12));
      else if (startsWith(L, 'rename to ')) f.renameTo = parsePathValue(L.subarray(10));
      else if (startsWith(L, 'copy from ')) f.copyFrom = parsePathValue(L.subarray(10));
      else if (startsWith(L, 'copy to ')) f.copyTo = parsePathValue(L.subarray(8));
      else if ((m = SIMILARITY_RE.exec(s))) {
        if (m[1]) f.dissimilarity = Number(m[2]);
        else f.similarity = Number(m[2]);
      } else if ((m = INDEX_RE.exec(s))) {
        f.indexOld = m[1];
        f.indexNew = m[2];
        if (m[3]) {
          // "index a..b MODE" is only printed when the mode did not change.
          f.oldMode ??= m[3];
          f.newMode ??= m[3];
        }
      } else break;
    }

    if (i < lines.length && startsWith(lines[i], 'Binary files ') && latin1(lines[i]).endsWith(' differ')) {
      f.binary = 'differ';
      i++;
    } else if (i < lines.length && bufEq(lines[i], B('GIT binary patch'))) {
      i = this.binaryPatch(i + 1, f);
    } else if (i + 1 < lines.length && startsWith(lines[i], '--- ') && startsWith(lines[i + 1], '+++ ')) {
      this.fileLines(f, i);
      i += 2;
      i = this.hunks(i, f);
    }
    f.endLine = i;
    this.files.push(f);
    return i;
  }

  fileLines(f, i) {
    const o = parseFileLine(this.lines[i].subarray(4));
    const n = parseFileLine(this.lines[i + 1].subarray(4));
    f.hasFileLines = true;
    f.oldName = o.name;
    f.oldIsNull = o.isNull;
    f.oldTrailer = o.trailer;
    f.newName = n.name;
    f.newIsNull = n.isNull;
    f.newTrailer = n.trailer;
  }

  hunks(i, f) {
    const { lines } = this;
    while (i < lines.length && startsWith(lines[i], '@@ -')) {
      const next = this.hunk(i, f);
      if (next === i) break;
      i = next;
    }
    return i;
  }

  hunk(start, f) {
    const { lines } = this;
    const m = HUNK_RE.exec(latin1(lines[start]));
    if (!m) {
      this.error(start, 'malformed hunk header');
      return start;
    }
    const oldStart = Number(m[1]);
    const oldLines = m[2] === undefined ? 1 : Number(m[2]);
    const newStart = Number(m[3]);
    const newLines = m[4] === undefined ? 1 : Number(m[4]);
    const tail = B(m[5]);
    const h = {
      oldStart,
      oldLines,
      newStart,
      newLines,
      // git prints " " + the function-context text after the closing "@@".
      section: tail[0] === SPACE ? Buffer.from(tail.subarray(1)) : Buffer.from(tail),
      lines: [],
    };
    let oldLeft = oldLines;
    let newLeft = newLines;
    let oldNo = oldStart;
    let newNo = newStart;
    let i = start + 1;
    while (oldLeft > 0 || newLeft > 0) {
      if (i >= lines.length) {
        this.error(i - 1, 'hunk is shorter than its header announces');
        break;
      }
      const L = lines[i];
      const c = L.length ? L[0] : SPACE; // an empty line is an empty context line (GNU diff, mail-damaged patches)
      if (c === 0x5c /* \ */) {
        if (h.lines.length === 0) {
          this.error(i, '"\\ No newline" marker without a preceding line');
          break;
        }
        h.lines[h.lines.length - 1].noNewline = true;
        i++;
        continue;
      }
      const text = L.length ? Buffer.from(L.subarray(1)) : Buffer.alloc(0);
      if (c === SPACE) {
        if (oldLeft === 0 || newLeft === 0) {
          this.error(i, 'context line beyond the range announced in the hunk header');
          break;
        }
        h.lines.push({ type: ' ', text, noNewline: false, oldNo: oldNo++, newNo: newNo++ });
        oldLeft--;
        newLeft--;
      } else if (c === 0x2d /* - */) {
        if (oldLeft === 0) {
          this.error(i, 'deleted line beyond the range announced in the hunk header');
          break;
        }
        h.lines.push({ type: '-', text, noNewline: false, oldNo: oldNo++, newNo: null });
        oldLeft--;
      } else if (c === 0x2b /* + */) {
        if (newLeft === 0) {
          this.error(i, 'added line beyond the range announced in the hunk header');
          break;
        }
        h.lines.push({ type: '+', text, noNewline: false, oldNo: null, newNo: newNo++ });
        newLeft--;
      } else {
        this.error(i, 'hunk is shorter than its header announces');
        break;
      }
      i++;
    }
    // The marker for the very last line of the hunk comes after the counts are satisfied.
    if (i < lines.length && lines[i].length && lines[i][0] === 0x5c && h.lines.length) {
      h.lines[h.lines.length - 1].noNewline = true;
      i++;
    }
    f.hunks.push(h);
    return i;
  }

  binaryPatch(i, f) {
    const { lines } = this;
    f.binary = 'patch';
    f.binaryPatch = [];
    // One or two blocks ("forward" and, unless --no-binary-reverse... always, "reverse"):
    //   literal <size> | delta <size>
    //   <base85 lines>
    //   <empty line>
    while (i < lines.length && f.binaryPatch.length < 2) {
      const m = /^(literal|delta) (\d+)$/.exec(latin1(lines[i]));
      if (!m) break;
      const block = { method: m[1], size: Number(m[2]), data: [] };
      i++;
      while (i < lines.length && lines[i].length > 0) {
        block.data.push(Buffer.from(lines[i]));
        i++;
      }
      if (i < lines.length) i++; // the empty line that terminates the block
      f.binaryPatch.push(block);
    }
    if (f.binaryPatch.length === 0) this.error(i, 'GIT binary patch without data');
    return i;
  }

  // ---- plain (non-git) unified diffs ---------------------------------------

  plainSection(start) {
    const f = emptyFile('plain', start);
    this.fileLines(f, start);
    const i = this.hunks(start + 2, f);
    f.endLine = i;
    this.files.push(f);
    return i;
  }

  plainBinaryNotice(i) {
    const L = this.lines[i];
    const f = emptyFile('plain', i);
    f.binary = 'differ';
    f.endLine = i + 1;
    const body = L.subarray('Binary files '.length, L.length - ' differ'.length);
    const sep = B(' and ');
    const candidates = [];
    for (let p = body.indexOf(sep); p !== -1; p = body.indexOf(sep, p + 1)) {
      candidates.push([body.subarray(0, p), body.subarray(p + sep.length)]);
    }
    let pick = null;
    if (candidates.length === 1) pick = candidates[0];
    else if (candidates.length > 1) {
      const same = candidates.filter(([a, b]) => sameModuloPrefix(a, b));
      if (same.length === 1) pick = same[0];
    }
    if (pick) {
      const side = (raw) => {
        if (raw[0] === DQUOTE) {
          const q = unquoteC(raw, 0);
          if (q && q.end === raw.length) return q.value;
        }
        return bufEq(raw, DEV_NULL) ? null : Buffer.from(raw);
      };
      f.oldName = side(pick[0]);
      f.newName = side(pick[1]);
      f.oldIsNull = bufEq(pick[0], DEV_NULL);
      f.newIsNull = bufEq(pick[1], DEV_NULL);
    }
    this.files.push(f);
  }

  // ---- combined diffs (git show <merge>, git diff --cc, git diff -c) --------

  combinedSection(start) {
    const { lines } = this;
    const f = emptyFile('combined', start);
    const head = lines[start];
    const rest = head.subarray(head.indexOf(SPACE, 5) + 1); // after "diff --cc " / "diff --combined "
    f.combinedPath = parsePathValue(rest);
    let i = start + 1;
    for (; i < lines.length; i++) {
      const s = latin1(lines[i]);
      let m;
      if ((m = COMBINED_INDEX_RE.exec(s))) {
        f.indexOld = m[1];
        f.indexNew = m[2];
        f.parents = m[1].split(',').length;
      } else if ((m = /^mode (\d{6}(?:,\d{6})+)\.\.(\d{6})$/.exec(s))) {
        f.oldMode = m[1];
        f.newMode = m[2];
      } else if ((m = /^new file mode (\d{6})$/.exec(s))) {
        f.newMode = m[1];
        f.isNew = true;
      } else if ((m = /^deleted file mode (\d{6}(?:,\d{6})*)$/.exec(s))) {
        f.oldMode = m[1];
        f.isDeleted = true;
      } else break;
    }
    if (i < lines.length && startsWith(lines[i], 'Binary files ') && latin1(lines[i]).endsWith(' differ')) {
      f.binary = 'differ';
      i++;
    } else if (i + 1 < lines.length && startsWith(lines[i], '--- ') && startsWith(lines[i + 1], '+++ ')) {
      this.fileLines(f, i);
      i += 2;
      while (i < lines.length && startsWith(lines[i], '@@@')) {
        const next = this.combinedHunk(i, f);
        if (next === i) break;
        i = next;
      }
    }
    f.endLine = i;
    this.files.push(f);
    return i;
  }

  combinedHunk(start, f) {
    const { lines } = this;
    const s = latin1(lines[start]);
    const m = /^(@{3,}) ((?:-\d+(?:,\d+)? )+)\+(\d+)(?:,(\d+))? \1([\s\S]*)$/.exec(s);
    if (!m) {
      this.error(start, 'malformed combined hunk header');
      return start;
    }
    const nParents = m[1].length - 1;
    const ranges = m[2].trim().split(' ').map((r) => {
      const mm = /^-(\d+)(?:,(\d+))?$/.exec(r);
      return { start: Number(mm[1]), lines: mm[2] === undefined ? 1 : Number(mm[2]) };
    });
    if (ranges.length !== nParents) {
      this.error(start, 'combined hunk header does not match its number of parents');
      return start;
    }
    if (!f.parents) f.parents = nParents;
    const tail = B(m[5]);
    const h = {
      parents: ranges,
      newStart: Number(m[3]),
      newLines: m[4] === undefined ? 1 : Number(m[4]),
      section: tail[0] === SPACE ? Buffer.from(tail.subarray(1)) : Buffer.from(tail),
      lines: [],
    };
    const left = ranges.map((r) => r.lines);
    let newLeft = h.newLines;
    let i = start + 1;
    const done = () => newLeft === 0 && left.every((n) => n === 0);
    while (!done()) {
      if (i >= lines.length) {
        this.error(i - 1, 'combined hunk is shorter than its header announces');
        break;
      }
      const L = lines[i];
      if (L.length && L[0] === 0x5c) {
        if (h.lines.length) h.lines[h.lines.length - 1].noNewline = true;
        i++;
        continue;
      }
      if (L.length < nParents) {
        this.error(i, 'combined hunk is shorter than its header announces');
        break;
      }
      const markers = latin1(L.subarray(0, nParents));
      if (!/^[ +-]+$/.test(markers)) {
        this.error(i, 'combined hunk is shorter than its header announces');
        break;
      }
      // A line with a "-" in any column is absent from the result. It was present in
      // exactly the parents whose column says "-". A line without "-" is in the result,
      // and in every parent whose column is " ".
      const inResult = !markers.includes('-');
      for (let p = 0; p < nParents; p++) {
        const inParent = inResult ? markers[p] === ' ' : markers[p] === '-';
        if (inParent) left[p]--;
      }
      if (inResult) newLeft--;
      if (newLeft < 0 || left.some((n) => n < 0)) {
        this.error(i, 'combined hunk has more lines than its header announces');
        break;
      }
      h.lines.push({ markers, text: Buffer.from(L.subarray(nParents)), noNewline: false });
      i++;
    }
    if (i < lines.length && lines[i].length && lines[i][0] === 0x5c && h.lines.length) {
      h.lines[h.lines.length - 1].noNewline = true;
      i++;
    }
    f.hunks.push(h);
    return i;
  }
}

/**
 * Parse a diff. `input` is a Buffer (preferred) or a string (encoded as UTF-8).
 * Returns { files, errors }. `errors` is empty for anything git or GNU diff wrote.
 */
export function parseDiff(input) {
  const { lines, finalNewline } = splitLines(toBuf(input));
  return new Parser(lines, finalNewline).run();
}

// ---- path resolution ---------------------------------------------------------

function stripPrefix(name, prefix) {
  if (name === null) return null;
  if (prefix === null || prefix === undefined) return null;
  const p = toBuf(prefix);
  return startsWith(name, p) ? Buffer.from(name.subarray(p.length)) : null;
}

/**
 * Work out the prefixes a git section was written with ("a/" and "b/" unless
 * the producer was configured otherwise). The text does not declare them; they
 * can only be inferred from the fact that - renames aside - both names on the
 * "diff --git" line are the same path. Returns { src, dst } (Buffers) or null.
 */
export function inferPrefixes(f) {
  let a = f.headerOld;
  let b = f.headerNew;
  if (f.renameFrom && f.renameTo && a && b) {
    // Renames spell out the bare paths, which gives the prefixes away exactly.
    const src = endsWithBuf(a, f.renameFrom) ? a.subarray(0, a.length - f.renameFrom.length) : null;
    const dst = endsWithBuf(b, f.renameTo) ? b.subarray(0, b.length - f.renameTo.length) : null;
    if (src !== null && dst !== null) return { src: Buffer.from(src), dst: Buffer.from(dst) };
  }
  if (f.copyFrom && f.copyTo && a && b) {
    const src = endsWithBuf(a, f.copyFrom) ? a.subarray(0, a.length - f.copyFrom.length) : null;
    const dst = endsWithBuf(b, f.copyTo) ? b.subarray(0, b.length - f.copyTo.length) : null;
    if (src !== null && dst !== null) return { src: Buffer.from(src), dst: Buffer.from(dst) };
  }
  if (!a || !b) {
    a = f.oldName;
    b = f.newName;
  }
  if (!a || !b) return null;
  if (bufEq(a, b)) return { src: Buffer.alloc(0), dst: Buffer.alloc(0) };
  const k = commonPathSuffix(a, b);
  if (k > 0) {
    // The suffix starts with the "/" that ends the prefix.
    return { src: Buffer.from(a.subarray(0, a.length - k + 1)), dst: Buffer.from(b.subarray(0, b.length - k + 1)) };
  }
  return null;
}

function endsWithBuf(buf, suffix) {
  return buf.length >= suffix.length && bufEq(buf.subarray(buf.length - suffix.length), suffix);
}

/**
 * Resolve the names of a parsed file section.
 *
 * Returns { oldName, newName, oldPath, newPath }:
 *   *Name - the name as the diff spells it, prefix included (null on the /dev/null side)
 *   *Path - the path inside the repository (null on the /dev/null side, or when unknowable)
 *
 * `prefixes` ({src, dst}) should be given whenever the caller knows how the
 * diff was produced. Otherwise they are inferred as "whatever differs in front
 * of the path both names share". That is exact for the default "a/" and "b/",
 * for --no-prefix, for mnemonic prefixes and for any pair of directory-like
 * prefixes that end differently. It cannot be right when the two prefixes
 * share a trailing directory ("x/a/" and "y/a/"), and it gives up (null) when
 * a prefix does not end with a slash.
 */
export function resolveNames(f, prefixes) {
  if (f.kind === 'combined') {
    const path = f.combinedPath;
    return {
      oldName: f.oldIsNull ? null : f.oldName,
      newName: f.newIsNull ? null : f.newName,
      oldPath: f.isNew ? null : path,
      newPath: f.isDeleted ? null : path,
    };
  }
  let oldName;
  let newName;
  if (f.hasFileLines) {
    oldName = f.oldName;
    newName = f.newName;
  } else {
    oldName = f.headerOld;
    newName = f.headerNew;
  }
  const pre = prefixes ?? inferPrefixes(f) ?? null;
  const absentOld = f.isNew || f.oldIsNull;
  const absentNew = f.isDeleted || f.newIsNull;

  // Names for the side that the "---"/"+++" lines replaced by /dev/null still exist on the header line.
  let oldPath = f.renameFrom ?? f.copyFrom ?? null;
  let newPath = f.renameTo ?? f.copyTo ?? null;
  if (oldPath === null && pre) oldPath = stripPrefix(f.oldName ?? f.headerOld, pre.src);
  if (newPath === null && pre) newPath = stripPrefix(f.newName ?? f.headerNew, pre.dst);
  // When only one side could be resolved, a non-rename section has the same path on both.
  if (oldPath === null && newPath !== null && !f.renameTo && !f.copyTo) oldPath = newPath;
  if (newPath === null && oldPath !== null && !f.renameFrom && !f.copyFrom) newPath = oldPath;

  if (f.kind === 'git' && pre) {
    // Reconstruct the spelled names for sections without "---"/"+++" lines.
    if (!f.hasFileLines) {
      oldName = oldPath !== null ? Buffer.concat([toBuf(pre.src), oldPath]) : f.headerOld;
      newName = newPath !== null ? Buffer.concat([toBuf(pre.dst), newPath]) : f.headerNew;
    }
  }
  return {
    oldName: absentOld ? null : oldName,
    newName: absentNew ? null : newName,
    oldPath: absentOld ? null : oldPath,
    newPath: absentNew ? null : newPath,
  };
}

/** One of: added, deleted, renamed, copied, modified. */
export function statusOf(f) {
  if (f.isNew || (f.oldIsNull && !f.newIsNull)) return 'added';
  if (f.isDeleted || (f.newIsNull && !f.oldIsNull)) return 'deleted';
  if (f.renameFrom !== null || f.renameTo !== null) return 'renamed';
  if (f.copyFrom !== null || f.copyTo !== null) return 'copied';
  return 'modified';
}
