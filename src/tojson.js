// The JSON form of a parsed file section: the schema of the corpus (corpus/README.md).

import { bytesToJson } from './bytes.js';
import { resolveNames, statusOf } from './refparse.js';

/** JSON form of one parsed file section (see corpus/README.md for the schema). */
export function fileToJson(f, prefixes) {
  if (f.kind === 'combined') {
    const names = resolveNames(f);
    return {
      combined: true,
      status: f.isNew ? 'added' : f.isDeleted ? 'deleted' : 'modified',
      path: bytesToJson(f.combinedPath),
      old_name: bytesToJson(names.oldName),
      new_name: bytesToJson(names.newName),
      parents: f.parents,
      binary: f.binary ? 'notice' : false,
      hunks: f.hunks.map((h) => ({
        parent_ranges: h.parents.map((r) => ({ start: r.start, lines: r.lines })),
        new_start: h.newStart,
        new_lines: h.newLines,
        section: bytesToJson(h.section),
        lines: h.lines.map((ln) => {
          const o = { markers: ln.markers, text: bytesToJson(ln.text) };
          if (ln.noNewline) o.no_newline = true;
          return o;
        }),
      })),
    };
  }
  const names = resolveNames(f, prefixes);
  let additions = 0;
  let deletions = 0;
  for (const h of f.hunks) for (const ln of h.lines) {
    if (ln.type === '+') additions++;
    else if (ln.type === '-') deletions++;
  }
  const TYPE = { ' ': 'context', '+': 'add', '-': 'delete' };
  return {
    // A bare "Binary files a/x and b/x differ" line of GNU diff is not a patch for that file;
    // a parser may report it as a file or pass over it.
    ...(f.kind === 'plain' && f.binary ? { optional: true } : {}),
    status: f.kind === 'git' ? statusOf(f) : null,
    old_name: bytesToJson(names.oldName),
    new_name: bytesToJson(names.newName),
    old_path: bytesToJson(names.oldPath),
    new_path: bytesToJson(names.newPath),
    old_mode: f.oldMode,
    new_mode: f.newMode,
    similarity: f.similarity,
    binary: f.binary === 'differ' ? 'notice' : f.binary === 'patch' ? 'patch' : false,
    additions: f.binary ? null : additions,
    deletions: f.binary ? null : deletions,
    hunks: f.hunks.map((h) => ({
      old_start: h.oldStart,
      old_lines: h.oldLines,
      new_start: h.newStart,
      new_lines: h.newLines,
      section: bytesToJson(h.section),
      lines: h.lines.map((ln) => {
        const o = { type: TYPE[ln.type], text: bytesToJson(ln.text), old_no: ln.oldNo, new_no: ln.newNo };
        if (ln.noNewline) o.no_newline = true;
        return o;
      }),
    })),
  };
}

