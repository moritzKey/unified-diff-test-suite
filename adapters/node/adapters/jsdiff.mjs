import { parsePatch } from 'diff';
import { devnull, fromMarkedLines, orNull } from './_util.mjs';

export const meta = {
  name: 'jsdiff',
  package: 'diff',
  language: 'JavaScript',
  homepage: 'https://github.com/kpdecker/jsdiff',
  api: 'parsePatch(text)',
  input: 'string',
  // Names are returned as written in the patch, prefix included.
  pathStyle: 'raw',
  statuses: ['added', 'deleted', 'renamed', 'copied'],
  // Documented: modes come from the explicit mode headers only, not from the "index" line.
  // How the library reports "\\ No newline at end of file": per 'line', per 'file', or not at all ('none').
  noNewline: 'line',
  // parse.js says it tolerates "trailing prose or commentary in email patches", as GNU patch does.
  scope: ['git', 'git-wrapped', 'git-config', 'gnu'],
  notes: 'README: "parsePatch has some understanding of Git\'s particular dialect of unified diff format".',
};

export function parse(text) {
  return parsePatch(text).map((p) => ({
    old_path: devnull(p.oldFileName),
    new_path: devnull(p.newFileName),
    status: p.isGit ? (p.isCreate ? 'added' : p.isDelete ? 'deleted' : p.isRename ? 'renamed' : p.isCopy ? 'copied' : 'modified') : undefined,
    old_mode: orNull(p.oldMode),
    new_mode: orNull(p.newMode),
    binary: p.isGit ? Boolean(p.isBinary) : undefined,
    // jsdiff stores the start of an empty range one higher than the patch text spells it
    // (parse.js: "Unified Diff Format quirk: If the chunk size is 0, the first number is one
    // lower than one would expect"). That is its documented internal convention, so undo it here.
    hunks: p.hunks.map((h) => ({
      old_start: h.oldLines === 0 ? h.oldStart - 1 : h.oldStart,
      old_lines: h.oldLines,
      new_start: h.newLines === 0 ? h.newStart - 1 : h.newStart,
      new_lines: h.newLines,
      lines: fromMarkedLines(h.lines),
    })),
  }));
}
