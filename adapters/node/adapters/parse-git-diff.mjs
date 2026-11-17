import mod from 'parse-git-diff';

const parseGitDiff = mod.default ?? mod;

export const meta = {
  name: 'parse-git-diff',
  package: 'parse-git-diff',
  language: 'JavaScript',
  homepage: 'https://github.com/yeonjuan/parse-git-diff',
  api: 'parseGitDiff(text)',
  input: 'string',
  pathStyle: 'stripped',
  statuses: ['added', 'deleted', 'renamed'],
  noNewline: 'line',
  scope: ['git', 'combined'],
  notes: 'README: "A parser for git diff."',
};

const STATUS = { ChangedFile: 'modified', AddedFile: 'added', DeletedFile: 'deleted', RenamedFile: 'renamed' };
const TYPE = { UnchangedLine: 'context', AddedLine: 'add', DeletedLine: 'delete' };

export function parse(text) {
  return parseGitDiff(text).files.map((f) => {
    const status = STATUS[f.type] ?? `unknown(${f.type})`;
    const paths =
      f.type === 'RenamedFile'
        ? { old_path: f.pathBefore, new_path: f.pathAfter }
        : f.type === 'AddedFile'
          ? { old_path: null, new_path: f.path }
          : f.type === 'DeletedFile'
            ? { old_path: f.path, new_path: null }
            : { old_path: f.path, new_path: f.path };
    const chunks = f.chunks ?? [];
    if (chunks.some((c) => c.type === 'CombinedChunk')) {
      return { ...paths, status, combined: true, hunks: chunks.map((c) => ({})) };
    }
    return {
      ...paths,
      status,
      binary: chunks.some((c) => c.type === 'BinaryFilesChunk'),
      hunks: chunks
        .filter((c) => c.type === 'Chunk')
        .map((c) => {
          const lines = [];
          for (const ch of c.changes) {
            if (ch.type === 'MessageLine') {
              // "\ No newline at end of file", delivered without its leading "\ "
              if (lines.length) lines[lines.length - 1].no_newline = true;
              continue;
            }
            lines.push({
              type: TYPE[ch.type] ?? `unknown(${ch.type})`,
              text: ch.content,
              old_no: ch.type === 'AddedLine' ? null : ch.lineBefore,
              new_no: ch.type === 'DeletedLine' ? null : ch.lineAfter,
            });
          }
          return {
            old_start: c.fromFileRange.start,
            old_lines: c.fromFileRange.lines,
            new_start: c.toFileRange.start,
            new_lines: c.toFileRange.lines,
            section: c.context ?? '',
            lines,
          };
        }),
    };
  });
}
