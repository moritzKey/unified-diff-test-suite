import { createRequire } from 'node:module';
import { devnull } from './_util.mjs';

const mod = createRequire(import.meta.url)('diffparser');
const diffparser = mod.default ?? mod;

export const meta = {
  name: 'diffparser',
  package: 'diffparser',
  language: 'JavaScript',
  homepage: 'https://github.com/fgnass/diffparser',
  api: 'parse(text)',
  input: 'string',
  pathStyle: 'stripped',
  statuses: ['added', 'deleted'],
  noNewline: 'none',
  scope: ['git', 'git-config', 'gnu'],
  notes: 'README: "Unified diff parser for Node and the browser", an ES2015 version of parse-diff.',
};

const TYPE = { add: 'add', del: 'delete', normal: 'context' };

export function parse(text) {
  return diffparser(text).map((f) => ({
    old_path: devnull(f.from),
    new_path: devnull(f.to),
    status: f.new ? 'added' : f.deleted ? 'deleted' : 'modified',
    additions: f.additions,
    deletions: f.deletions,
    hunks: f.chunks.map((c) => ({
      old_start: c.oldStart,
      old_lines: c.oldLines,
      new_start: c.newStart,
      new_lines: c.newLines,
      lines: c.changes.map((ch) => ({
        type: TYPE[ch.type] ?? `unknown(${ch.type})`,
        text: ch.content.slice(1),
        old_no: ch.type === 'add' ? null : ch.oldLine,
        new_no: ch.type === 'del' ? null : ch.newLine,
      })),
    })),
  }));
}
