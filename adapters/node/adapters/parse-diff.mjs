import parseDiff from 'parse-diff';
import { devnull, orNull } from './_util.mjs';

export const meta = {
  name: 'parse-diff',
  package: 'parse-diff',
  language: 'JavaScript',
  homepage: 'https://github.com/sergeyt/parse-diff',
  api: 'parseDiff(text)',
  input: 'string',
  pathStyle: 'stripped',
  statuses: ['added', 'deleted'],
  // How the library reports "\\ No newline at end of file": per 'line', per 'file', or not at all ('none').
  noNewline: 'line',
  scope: ['git', 'git-config', 'gnu'],
  notes: 'README: "Simple unified diff parser for JavaScript".',
};

const TYPE = { add: 'add', del: 'delete', normal: 'context' };

export function parse(text) {
  return parseDiff(text).map((f) => ({
    old_path: devnull(f.from),
    new_path: devnull(f.to),
    status: f.new ? 'added' : f.deleted ? 'deleted' : 'modified',
    old_mode: orNull(f.oldMode),
    new_mode: orNull(f.newMode),
    additions: f.additions,
    deletions: f.deletions,
    hunks: f.chunks.map((c) => {
      const lines = [];
      for (const ch of c.changes) {
        // "\ No newline at end of file" is delivered as an extra change that repeats the previous type.
        if (ch.content.startsWith('\\')) {
          if (lines.length) lines[lines.length - 1].no_newline = true;
          continue;
        }
        lines.push({
          type: TYPE[ch.type] ?? `unknown(${ch.type})`,
          text: ch.content.slice(1),
          old_no: ch.type === 'normal' ? ch.ln1 : ch.type === 'del' ? ch.ln : null,
          new_no: ch.type === 'normal' ? ch.ln2 : ch.type === 'add' ? ch.ln : null,
        });
      }
      return { old_start: c.oldStart, old_lines: c.oldLines, new_start: c.newStart, new_lines: c.newLines, lines };
    }),
  }));
}
