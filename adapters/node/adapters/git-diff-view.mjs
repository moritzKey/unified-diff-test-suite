import { createRequire } from 'node:module';

const { DiffParser } = createRequire(import.meta.url)('@git-diff-view/core');

export const meta = {
  name: 'git-diff-view',
  package: '@git-diff-view/core',
  language: 'JavaScript',
  homepage: 'https://github.com/MrWangJustToDo/git-diff-view',
  api: 'new DiffParser().parse(text)',
  input: 'string',
  // The parser reads the diff of ONE file (it descends from the GitHub Desktop diff parser);
  // the harness only sends it vectors with exactly one file section.
  singleFile: true,
  statuses: [],
  noNewline: 'line',
  scope: ['git', 'git-config'],
  notes: 'DiffParser reads the diff of a single file and returns hunks; it does not report file names.',
};

// DiffLineType: Context = 0, Add = 1, Delete = 2, Hunk = 3
const TYPE = { 0: 'context', 1: 'add', 2: 'delete' };

export function parse(text) {
  const raw = new DiffParser().parse(text);
  return [
    {
      binary: Boolean(raw.isBinary),
      hunks: raw.hunks.map((h) => ({
        old_start: h.header.oldStartLine,
        old_lines: h.header.oldLineCount,
        new_start: h.header.newStartLine,
        new_lines: h.header.newLineCount,
        lines: h.lines
          .filter((l) => l.type !== 3)
          .map((l) => ({
            type: TYPE[l.type] ?? `unknown(${l.type})`,
            // DiffLine.text is the content without its marker column, with the line terminator kept.
            text: l.text.endsWith('\n') ? l.text.slice(0, -1) : l.text,
            old_no: l.oldLineNumber,
            new_no: l.newLineNumber,
            no_newline: Boolean(l.noTrailingNewLine),
          })),
      })),
    },
  ];
}
