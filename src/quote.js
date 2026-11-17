// C-style path quoting as used by git (quote.c) and understood by GNU patch.
//
// git wraps a path in double quotes when it contains a byte that could confuse
// a reader: control characters, DEL, a double quote, a backslash and - unless
// core.quotePath is false - every byte >= 0x80. Inside the quotes it uses the C
// escapes below and three-digit octal for everything else. A space does NOT
// trigger quoting.

import { toBuf, DQUOTE, BACKSLASH } from './bytes.js';

const ESC_OUT = new Map([
  [0x07, 'a'], [0x08, 'b'], [0x09, 't'], [0x0a, 'n'], [0x0b, 'v'], [0x0c, 'f'], [0x0d, 'r'],
  [DQUOTE, '"'], [BACKSLASH, '\\'],
]);
const ESC_IN = new Map([
  [0x61, 0x07], [0x62, 0x08], [0x74, 0x09], [0x6e, 0x0a], [0x76, 0x0b], [0x66, 0x0c], [0x72, 0x0d],
  [DQUOTE, DQUOTE], [BACKSLASH, BACKSLASH],
]);

/** Does git need to quote this path? `quotePath` mirrors core.quotePath. */
export function needsQuoting(path, { quotePath = true } = {}) {
  for (const b of toBuf(path)) {
    if (b < 0x20 || b === 0x7f || b === DQUOTE || b === BACKSLASH) return true;
    if (quotePath && b >= 0x80) return true;
  }
  return false;
}

/** Quote a path the way git prints it. Always returns the quoted form (with quotes). */
export function quoteC(path, { quotePath = true } = {}) {
  let out = '"';
  for (const b of toBuf(path)) {
    if (ESC_OUT.has(b)) out += `\\${ESC_OUT.get(b)}`;
    else if (b < 0x20 || b === 0x7f || (quotePath && b >= 0x80)) out += `\\${b.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(b); // one char per byte; encoded back as latin1 below
  }
  out += '"';
  return Buffer.from(out, 'latin1');
}

/**
 * Parse a C-quoted string that starts at buf[pos] (which must be `"`).
 * Returns { value: Buffer, end } where `end` is the index just past the closing
 * quote, or null when the text is not a well-formed quoted string.
 */
export function unquoteC(buf, pos = 0) {
  if (buf[pos] !== DQUOTE) return null;
  const out = [];
  let i = pos + 1;
  while (i < buf.length) {
    const b = buf[i];
    if (b === DQUOTE) return { value: Buffer.from(out), end: i + 1 };
    if (b !== BACKSLASH) {
      out.push(b);
      i++;
      continue;
    }
    const e = buf[i + 1];
    if (e === undefined) return null;
    if (ESC_IN.has(e)) {
      out.push(ESC_IN.get(e));
      i += 2;
      continue;
    }
    // \NNN - git requires exactly three octal digits with the first one in 0..3.
    const d1 = e - 0x30;
    const d2 = buf[i + 2] - 0x30;
    const d3 = buf[i + 3] - 0x30;
    if (d1 >= 0 && d1 <= 3 && d2 >= 0 && d2 <= 7 && d3 >= 0 && d3 <= 7) {
      out.push((d1 << 6) | (d2 << 3) | d3);
      i += 4;
      continue;
    }
    return null;
  }
  return null; // unterminated
}

/** Quote for a `git fast-import` stream: always quoted, every odd byte escaped. */
export function quoteFastImport(path) {
  let out = '"';
  for (const b of toBuf(path)) {
    if (b === DQUOTE) out += '\\"';
    else if (b === BACKSLASH) out += '\\\\';
    else if (b < 0x20 || b >= 0x7f) out += `\\${b.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(b);
  }
  return Buffer.from(`${out}"`, 'latin1');
}
