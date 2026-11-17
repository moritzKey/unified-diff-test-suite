import { parse as d2hParse } from 'diff2html';
import { devnull, orNull } from './_util.mjs';

export const meta = {
  name: 'diff2html',
  package: 'diff2html',
  language: 'JavaScript',
  homepage: 'https://github.com/rtfpessoa/diff2html',
  api: 'parse(text)',
  input: 'string',
  pathStyle: 'stripped',
  statuses: ['added', 'deleted', 'renamed', 'copied'],
  // How the library reports "\\ No newline at end of file": per 'line', per 'file', or not at all ('none').
  noNewline: 'none',
  scope: ['git', 'git-config', 'gnu', 'combined'],
  notes: 'README: "Diff parser and pretty html generator"; supports "git and unified diffs" and combined diffs. ' +
    'Blocks expose their start lines and header text but not the announced line counts; "\\ No newline" markers are not exposed.',
};

const TYPE = { insert: 'add', delete: 'delete', context: 'context' };
const first = (m) => (Array.isArray(m) ? m[0] : m);

export function parse(text) {
  return d2hParse(text).map((f) => {
    const base = {
      old_path: devnull(f.oldName),
      new_path: devnull(f.newName),
      status: f.isNew ? 'added' : f.isDeleted ? 'deleted' : f.isRename ? 'renamed' : f.isCopy ? 'copied' : 'modified',
      old_mode: orNull(first(f.oldMode) ?? f.deletedFileMode ?? f.mode),
      new_mode: orNull(f.newMode ?? f.newFileMode ?? f.mode),
      binary: Boolean(f.isBinary),
      similarity: f.isRename || f.isCopy ? orNull(f.unchangedPercentage) : undefined,
      additions: f.addedLines,
      deletions: f.deletedLines,
    };
    if (f.isCombined) {
      return {
        ...base,
        combined: true,
        hunks: f.blocks.map((b) => ({ header: b.header, lines: b.lines.map((l) => ({ raw: l.content })) })),
      };
    }
    if (f.isBinary) {
      // A binary file gets one placeholder block (header "Binary file", no lines) for display.
      // It is not a hunk of the diff.
      return { ...base, hunks: f.blocks.filter((b) => b.lines.length > 0).map((b) => ({ old_start: b.oldStartLine, new_start: b.newStartLine })) };
    }
    return {
      ...base,
      hunks: f.blocks.map((b) => ({
        old_start: b.oldStartLine,
        new_start: b.newStartLine,
        lines: b.lines.map((l) => ({
          type: TYPE[l.type] ?? `unknown(${l.type})`,
          text: l.content.slice(1),
          old_no: orNull(l.oldNumber),
          new_no: orNull(l.newNumber),
        })),
      })),
    };
  });
}
