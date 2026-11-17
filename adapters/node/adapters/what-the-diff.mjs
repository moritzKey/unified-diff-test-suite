import { createRequire } from 'node:module';
import { fromMarkedLines, orNull } from './_util.mjs';

const { parse: wtdParse } = createRequire(import.meta.url)('what-the-diff');

export const meta = {
  name: 'what-the-diff',
  package: 'what-the-diff',
  language: 'JavaScript',
  homepage: 'https://github.com/kuychaco/what-the-diff',
  api: 'parse(text)',
  input: 'string',
  // For a file that was not renamed the library reports ONE name, the second name of the
  // "diff --git" line, in both oldPath and newPath (the README example is a --no-prefix diff,
  // where that is simply the path). 'header-new' tells the harness to expect exactly that.
  pathStyle: 'header-new',
  statuses: ['added', 'deleted', 'renamed', 'copied'],
  noNewline: 'line',
  scope: ['git', 'git-config', 'combined'],
  notes: 'README: "Parse unified diffs with JavaScript". A PEG grammar, written for the Atom GitHub package. ' +
    'For renames and copies the names come from the "rename from/to" lines, which never carry a prefix.',
};

const STATUS = { modified: 'modified', added: 'added', deleted: 'deleted', renamed: 'renamed', copied: 'copied' };

export function parse(text) {
  return wtdParse(text).map((f) => {
    const renamed = f.status === 'renamed' || f.status === 'copied';
    const base = {
      ...(renamed
        ? { old_path: orNull(f.oldPath), new_path: orNull(f.newPath), path_style: 'stripped' }
        : { path: orNull(f.newPath ?? f.oldPath) }),
      status: STATUS[f.status] ?? `unknown(${f.status})`,
      old_mode: orNull(f.oldMode),
      new_mode: orNull(f.newMode),
      binary: Boolean(f.binary),
      similarity: renamed ? orNull(f.similarity) : undefined,
    };
    if (f.hunks && f.hunks.some((h) => h.oldStartLines !== undefined || Array.isArray(h.oldStartLine))) {
      return { ...base, combined: true, hunks: f.hunks.map((h) => ({ lines: h.lines.map((raw) => ({ raw })) })) };
    }
    return {
      ...base,
      hunks: (f.hunks ?? []).map((h) => ({
        old_start: h.oldStartLine,
        old_lines: h.oldLineCount,
        new_start: h.newStartLine,
        new_lines: h.newLineCount,
        section: h.heading,
        lines: fromMarkedLines(h.lines),
      })),
    };
  });
}
