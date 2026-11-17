// Reading and writing the corpus on disk.
//
//   corpus/index.json                 list of all vectors
//   corpus/vectors/<id>.diff          the diff, byte for byte as the tool wrote it
//   corpus/vectors/<id>.json          expected result, provenance and recipe

import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT } from './adapters.js';

export const CORPUS_DIR = join(ROOT, 'corpus');

export function vectorPaths(id, corpusDir = CORPUS_DIR) {
  return { json: join(corpusDir, 'vectors', `${id}.json`), diff: join(corpusDir, 'vectors', `${id}.diff`) };
}

/** Stable, human-friendly JSON: one hunk line per row, everything else indented. */
export function stringifyVector(vector) {
  const compact = new Map();
  let n = 0;
  const mark = (obj) => {
    const key = `\u0000${n++}\u0000`;
    compact.set(key, JSON.stringify(obj));
    return key;
  };
  const clone = structuredClone(vector);
  for (const f of clone.expected.files) {
    for (const h of f.hunks ?? []) {
      h.lines = h.lines.map(mark);
      if (h.parent_ranges) h.parent_ranges = mark(h.parent_ranges);
    }
  }
  for (const st of clone.recipe?.states ?? []) st.files = st.files.map(mark);
  if (clone.recipe?.parents) clone.recipe.parents = mark(clone.recipe.parents);
  if (clone.producer?.argv) clone.producer.argv = mark(clone.producer.argv);
  if (clone.tags) clone.tags = mark(clone.tags);
  let text = JSON.stringify(clone, null, 2);
  text = text.replace(/"\\u0000(\d+)\\u0000"/g, (_, i) => compact.get(`\u0000${i}\u0000`));
  return `${text}\n`;
}

export function writeVector(vector, diff, corpusDir = CORPUS_DIR) {
  const p = vectorPaths(vector.id, corpusDir);
  mkdirSync(dirname(p.json), { recursive: true });
  writeFileSync(p.diff, diff);
  writeFileSync(p.json, stringifyVector(vector));
}

export function writeIndex(entries, meta, corpusDir = CORPUS_DIR) {
  const index = { format: 1, ...meta, count: entries.length, vectors: entries };
  writeFileSync(join(corpusDir, 'index.json'), `${JSON.stringify(index, null, 1)}\n`);
}

export function loadIndex(corpusDir = CORPUS_DIR) {
  return JSON.parse(readFileSync(join(corpusDir, 'index.json'), 'utf8'));
}

export function loadVector(id, corpusDir = CORPUS_DIR) {
  const p = vectorPaths(id, corpusDir);
  return { vector: JSON.parse(readFileSync(p.json, 'utf8')), diffPath: p.diff, diff: readFileSync(p.diff) };
}

export function clearVectors(corpusDir = CORPUS_DIR) {
  rmSync(join(corpusDir, 'vectors'), { recursive: true, force: true });
}

export { existsSync };
