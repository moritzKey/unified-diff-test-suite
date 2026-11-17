import { createRequire } from 'node:module';
import { devnull, orNull } from './_util.mjs';

const gitDiffParser = createRequire(import.meta.url)('gitdiff-parser');

export const meta = {
  name: 'gitdiff-parser',
  package: 'gitdiff-parser',
  language: 'JavaScript',
  homepage: 'https://github.com/ecomfe/gitdiff-parser',
  api: 'parse(text)',
  input: 'string',
  pathStyle: 'stripped',
  statuses: ['added', 'deleted', 'renamed', 'copied'],
  // How the library reports "\\ No newline at end of file": per 'line', per 'file', or not at all ('none').
  noNewline: 'file',
  scope: ['git'],
  notes: 'README: "A fast and reliable git diff parser." The parser behind react-diff-view. ' +
    'Missing final newlines are reported per file (oldEndingNewLine/newEndingNewLine), not per line.',
};

const TYPE = { insert: 'add', delete: 'delete', normal: 'context' };
const STATUS = { add: 'added', delete: 'deleted', modify: 'modified', rename: 'renamed', copy: 'copied' };

export function parse(text) {
  return gitDiffParser.parse(text).map((f) => ({
    old_path: devnull(f.oldPath),
    new_path: devnull(f.newPath),
    status: STATUS[f.type] ?? `unknown(${f.type})`,
    old_mode: orNull(f.oldMode),
    new_mode: orNull(f.newMode),
    binary: Boolean(f.isBinary),
    similarity: f.type === 'rename' || f.type === 'copy' ? orNull(f.similarity) : undefined,
    old_eof_newline: f.oldEndingNewLine,
    new_eof_newline: f.newEndingNewLine,
    hunks: f.hunks.map((h) => ({
      old_start: h.oldStart,
      old_lines: h.oldLines,
      new_start: h.newStart,
      new_lines: h.newLines,
      lines: h.changes.map((c) => ({
        type: TYPE[c.type] ?? `unknown(${c.type})`,
        text: c.content,
        old_no: c.type === 'normal' ? c.oldLineNumber : c.type === 'delete' ? c.lineNumber : null,
        new_no: c.type === 'normal' ? c.newLineNumber : c.type === 'insert' ? c.lineNumber : null,
      })),
    })),
  }));
}
