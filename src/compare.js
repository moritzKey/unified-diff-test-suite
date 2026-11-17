// Compare a library's (normalised) result with the expected result of a vector.
//
// The comparison is deliberately conservative: a field the library does not
// provide is never held against it. Only values the library actually returned
// are checked. Every difference becomes a "finding" with a kind, so that
// results can be grouped by failure class.

import { bytesFromJson, bufEq, show as showBytes, toBuf } from './bytes.js';


export const FINDING_KINDS = [
  'crash', // the library threw an exception
  'hang', // the library did not answer within the time limit
  'file-count', // wrong number of file sections
  'path', // wrong old/new file name
  'absent-side', // a name reported for the side on which the file does not exist (added/deleted files)
  'status', // added / deleted / renamed / copied / modified
  'mode', // file mode
  'binary', // binary flag
  'similarity', // rename/copy similarity
  'count', // additions / deletions totals
  'hunk-count', // wrong number of hunks in a file
  'hunk-range', // hunk header numbers
  'section', // text after the closing @@ of a hunk header
  'line-count', // wrong number of lines in a hunk
  'line-type', // context / add / delete
  'line-text', // line content
  'line-number', // old/new line numbers
  'no-newline', // "\ No newline at end of file" information
];

/** An adapter reports a name the library could not determine as {"unknown": true}. */
const isUnknown = (v) => v !== null && typeof v === 'object' && v.unknown === true;
const UNKNOWN = Buffer.from('\u0000<the library did not determine this name>');

/** Quote a byte string for a message (control characters and invalid UTF-8 are escaped by show()). */
const show = (buf, max) => (buf === null || buf === undefined ? 'none' : buf === UNKNOWN ? 'not determined' : `"${showBytes(buf, max)}"`);

function asBytes(v) {
  if (v === null || v === undefined) return null;
  if (isUnknown(v)) return UNKNOWN;
  if (typeof v === 'string') return Buffer.from(v, 'utf8');
  if (typeof v === 'object' && typeof v.base64 === 'string') return Buffer.from(v.base64, 'base64');
  return toBuf(String(v));
}

function collapseStatus(status, known) {
  if (status === null || status === undefined) return status;
  return known.includes(status) ? status : 'modified';
}

/** Is the mode on this side spelled out by an explicit mode header (not only by the index line)? */
function explicitMode(exp, side) {
  if (side === 'old') return exp.status === 'deleted' || (exp.old_mode !== null && exp.new_mode !== null && exp.old_mode !== exp.new_mode);
  return exp.status === 'added' || (exp.old_mode !== null && exp.new_mode !== null && exp.old_mode !== exp.new_mode);
}

function eofNewline(exp, side) {
  // Does the diff show that this side lacks a final newline?
  for (const h of exp.hunks) {
    for (const ln of h.lines) {
      if (!ln.no_newline) continue;
      if (side === 'old' && ln.type !== 'add') return false;
      if (side === 'new' && ln.type !== 'delete') return false;
    }
  }
  return true;
}

function compareCombined(exp, act, where, add) {
  if (act.path !== undefined || act.new_path !== undefined || act.old_path !== undefined) {
    const got = asBytes(act.path ?? act.new_path ?? act.old_path);
    const want = bytesFromJson(exp.path);
    if (!bufEq(got, want)) add('path', `${where}: path ${show(got)}, expected ${show(want)}`);
  }
  if (act.hunks === undefined) return;
  if (act.hunks.length !== exp.hunks.length) {
    add('hunk-count', `${where}: ${act.hunks.length} hunks, expected ${exp.hunks.length}`);
    return;
  }
  exp.hunks.forEach((eh, hi) => {
    const ah = act.hunks[hi];
    if (ah.lines === undefined) return;
    if (ah.lines.length !== eh.lines.length) {
      add('line-count', `${where} hunk ${hi + 1}: ${ah.lines.length} lines, expected ${eh.lines.length}`);
      return;
    }
    eh.lines.forEach((el, li) => {
      const al = ah.lines[li];
      if (al.markers !== undefined && al.text !== undefined) {
        const got = Buffer.concat([Buffer.from(al.markers, 'latin1'), asBytes(al.text)]);
        const want = Buffer.concat([Buffer.from(el.markers, 'latin1'), bytesFromJson(el.text)]);
        if (!bufEq(got, want)) add('line-text', `${where} hunk ${hi + 1} line ${li + 1}: ${show(got)}, expected ${show(want)}`);
        if (Boolean(al.no_newline) !== Boolean(el.no_newline)) add('no-newline', `${where} hunk ${hi + 1} line ${li + 1}: no-newline marker ${Boolean(al.no_newline)}, expected ${Boolean(el.no_newline)}`);
      }
      if (al.raw !== undefined) {
        const want = Buffer.concat([Buffer.from(el.markers, 'latin1'), bytesFromJson(el.text)]);
        if (!bufEq(asBytes(al.raw), want)) add('line-text', `${where} hunk ${hi + 1} line ${li + 1}: ${show(asBytes(al.raw))}, expected ${show(want)}`);
      }
    });
  });
}

/**
 * Compare. `meta` is the adapter's hello record. Returns { verdict, findings }
 * with verdict one of pass | fail | crash | hang.
 */
export function compare(vector, response, meta) {
  const findings = [];
  const add = (kind, message) => {
    if (findings.length < 50) findings.push({ kind, message });
  };
  if (response.hang) return { verdict: 'hang', findings: [{ kind: 'hang', message: 'no answer within the time limit' }] };
  if (!response.ok) return { verdict: 'crash', findings: [{ kind: 'crash', message: String(response.error ?? 'unknown error') }] };

  let expFiles = vector.expected.files;
  const actFiles = response.files;
  if (!Array.isArray(actFiles)) return { verdict: 'crash', findings: [{ kind: 'crash', message: 'adapter did not return a file list' }] };
  // Sections a parser may legitimately pass over (see corpus/README.md, "optional").
  const required = expFiles.filter((f) => !f.optional);
  if (actFiles.length !== expFiles.length && actFiles.length === required.length) expFiles = required;
  if (actFiles.length !== expFiles.length) {
    add('file-count', `${actFiles.length} file sections, expected ${expFiles.length}`);
    return { verdict: 'fail', findings };
  }
  const known = meta.statuses ?? ['added', 'deleted', 'renamed', 'copied'];

  expFiles.forEach((exp, fi) => {
    const act = actFiles[fi];
    const label = exp.combined ? exp.path : (exp.new_path ?? exp.old_path ?? exp.new_name ?? exp.old_name);
    const where = `file ${fi + 1} ${show(bytesFromJson(label), 60)}`;
    if (exp.combined) {
      compareCombined(exp, act, where, add);
      return;
    }
    const style = act.path_style ?? meta.pathStyle ?? 'stripped';
    const wantOld = bytesFromJson(style === 'raw' ? exp.old_name : exp.old_path);
    const wantNew = bytesFromJson(style === 'raw' ? exp.new_name : exp.new_path);
    // A library that removes "a/" and "b/" cannot be expected to know other prefixes. When the
    // diff was written with other prefixes, returning the name untouched is as good as returning
    // the path - and where the path cannot be worked out from the text at all, so is "unknown".
    // What is never acceptable is a name that is neither: a mangled one.
    const customPrefix = !(vector.prefixes.old === 'a/' && vector.prefixes.new === 'b/');
    const inferable = vector.text.paths_inferable !== false;
    const pathOk = (got, want, name) => {
      if (bufEq(got, want)) return true;
      if (style !== 'stripped' || want === null) return false;
      if (customPrefix && bufEq(got, bytesFromJson(name))) return true;
      return !inferable && (got === null || got === UNKNOWN);
    };
    if (act.old_path !== undefined && !pathOk(asBytes(act.old_path), wantOld, exp.old_name)) {
      add(wantOld === null ? 'absent-side' : 'path', `${where}: old path ${show(asBytes(act.old_path))}, expected ${show(wantOld)}`);
    }
    if (act.new_path !== undefined && !pathOk(asBytes(act.new_path), wantNew, exp.new_name)) {
      add(wantNew === null ? 'absent-side' : 'path', `${where}: new path ${show(asBytes(act.new_path))}, expected ${show(wantNew)}`);
    }
    if (act.path !== undefined) {
      // 'header-new': the library reports the new-side spelling of the name even for deleted files.
      const want =
        style === 'header-new'
          ? Buffer.concat([bytesFromJson(vector.prefixes.new), bytesFromJson(exp.new_path ?? exp.old_path)])
          : (wantNew ?? wantOld);
      if (!bufEq(asBytes(act.path), want)) add('path', `${where}: path ${show(asBytes(act.path))}, expected ${show(want)}`);
    }
    if (act.status !== undefined && exp.status !== null) {
      const got = collapseStatus(act.status, known);
      const want = collapseStatus(exp.status, known);
      if (got !== want) add('status', `${where}: status ${got}, expected ${want}`);
    }
    for (const side of ['old', 'new']) {
      const got = act[`${side}_mode`];
      const want = exp[`${side}_mode`];
      if (got === undefined) continue;
      if (got === null) {
        if (want !== null && explicitMode(exp, side)) add('mode', `${where}: ${side} mode not reported, expected ${want}`);
      } else if (got !== want) add('mode', `${where}: ${side} mode ${got}, expected ${want}`);
    }
    if (act.binary !== undefined && Boolean(act.binary) !== Boolean(exp.binary)) {
      add('binary', `${where}: binary ${Boolean(act.binary)}, expected ${Boolean(exp.binary)}`);
    }
    if (act.similarity !== undefined && exp.similarity !== null && act.similarity !== exp.similarity) {
      add('similarity', `${where}: similarity ${act.similarity}, expected ${exp.similarity}`);
    }
    if (exp.additions !== null) {
      if (act.additions !== undefined && act.additions !== exp.additions) add('count', `${where}: ${act.additions} additions, expected ${exp.additions}`);
      if (act.deletions !== undefined && act.deletions !== exp.deletions) add('count', `${where}: ${act.deletions} deletions, expected ${exp.deletions}`);
    }
    for (const side of ['old', 'new']) {
      const got = act[`${side}_eof_newline`];
      if (got === undefined) continue;
      const want = eofNewline(exp, side);
      if (got !== want) add('no-newline', `${where}: ${side} side final newline reported as ${got}, expected ${want}`);
    }
    if (act.hunks === undefined) return;
    if (act.hunks.length !== exp.hunks.length) {
      add('hunk-count', `${where}: ${act.hunks.length} hunks, expected ${exp.hunks.length}`);
      return;
    }
    exp.hunks.forEach((eh, hi) => {
      const ah = act.hunks[hi];
      const hw = `${where} hunk ${hi + 1}`;
      for (const key of ['old_start', 'old_lines', 'new_start', 'new_lines']) {
        if (ah[key] !== undefined && ah[key] !== eh[key]) add('hunk-range', `${hw}: ${key} ${ah[key]}, expected ${eh[key]}`);
      }
      if (ah.section !== undefined && !bufEq(asBytes(ah.section), bytesFromJson(eh.section))) {
        add('section', `${hw}: section ${show(asBytes(ah.section))}, expected ${show(bytesFromJson(eh.section))}`);
      }
      if (ah.lines === undefined) return;
      if (ah.lines.length !== eh.lines.length) {
        add('line-count', `${hw}: ${ah.lines.length} lines, expected ${eh.lines.length}`);
        return;
      }
      eh.lines.forEach((el, li) => {
        const al = ah.lines[li];
        const lw = `${hw} line ${li + 1}`;
        if (al.type !== el.type) {
          add('line-type', `${lw}: type ${al.type}, expected ${el.type}`);
          return;
        }
        if (al.text !== undefined && !bufEq(asBytes(al.text), bytesFromJson(el.text))) {
          add('line-text', `${lw}: text ${show(asBytes(al.text))}, expected ${show(bytesFromJson(el.text))}`);
        }
        if (al.old_no !== undefined && al.old_no !== el.old_no) add('line-number', `${lw}: old line number ${al.old_no}, expected ${el.old_no}`);
        if (al.new_no !== undefined && al.new_no !== el.new_no) add('line-number', `${lw}: new line number ${al.new_no}, expected ${el.new_no}`);
        if ((meta.noNewline ?? 'line') === 'line' && Boolean(al.no_newline) !== Boolean(el.no_newline)) {
          add('no-newline', `${lw}: no-newline marker ${Boolean(al.no_newline)}, expected ${Boolean(el.no_newline)}`);
        }
      });
    });
  });
  return { verdict: findings.length ? 'fail' : 'pass', findings };
}
