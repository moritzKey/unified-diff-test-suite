// Byte helpers. Diffs are byte streams, not text: file names and file contents
// may be in any encoding (or none), so everything in this project is handled as
// Buffers and only turned into strings at the JSON boundary.

import { isUtf8 } from 'node:buffer';

export const LF = 0x0a;
export const CR = 0x0d;
export const TAB = 0x09;
export const SPACE = 0x20;
export const DQUOTE = 0x22;
export const BACKSLASH = 0x5c;

/** string | Buffer | Uint8Array -> Buffer (strings are encoded as UTF-8). */
export function toBuf(x) {
  if (Buffer.isBuffer(x)) return x;
  if (typeof x === 'string') return Buffer.from(x, 'utf8');
  if (x instanceof Uint8Array) return Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  throw new TypeError(`cannot convert ${typeof x} to bytes`);
}

/**
 * JSON representation of a byte string: a plain JSON string when the bytes are
 * valid UTF-8 (the common case, and readable), otherwise {"base64": "..."}.
 * The mapping is lossless in both directions.
 */
export function bytesToJson(buf) {
  if (buf === null || buf === undefined) return null;
  buf = toBuf(buf);
  if (isUtf8(buf)) {
    const s = buf.toString('utf8');
    // A string that would not round-trip (cannot happen for valid UTF-8, but be safe).
    if (Buffer.from(s, 'utf8').equals(buf)) return s;
  }
  return { base64: buf.toString('base64') };
}

export function bytesFromJson(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return Buffer.from(v, 'utf8');
  if (typeof v === 'object' && typeof v.base64 === 'string') return Buffer.from(v.base64, 'base64');
  throw new TypeError('not a JSON byte string');
}

/** Split into lines at LF only. Returns { lines: Buffer[], finalNewline: boolean }. */
export function splitLines(buf) {
  const lines = [];
  let start = 0;
  for (;;) {
    const nl = buf.indexOf(LF, start);
    if (nl === -1) break;
    lines.push(buf.subarray(start, nl));
    start = nl + 1;
  }
  const finalNewline = start === buf.length;
  if (!finalNewline) lines.push(buf.subarray(start));
  return { lines, finalNewline };
}

export function startsWith(buf, prefix) {
  if (typeof prefix === 'string') prefix = Buffer.from(prefix, 'latin1');
  if (buf.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (buf[i] !== prefix[i]) return false;
  return true;
}

export function bufEq(a, b) {
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  return Buffer.compare(a, b) === 0;
}

/** Printable rendering for messages: non-printable bytes as \xNN. */
export function show(buf, max = 120) {
  if (buf === null || buf === undefined) return String(buf);
  buf = toBuf(buf);
  let out = '';
  const s = isUtf8(buf) ? buf.toString('utf8') : null;
  if (s !== null) {
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (ch === '\\') out += '\\\\';
      else if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else if (c < 0x20 || c === 0x7f || (c >= 0x80 && c < 0xa0) || c === 0x2028 || c === 0x2029)
        out += c <= 0xff ? `\\x${c.toString(16).padStart(2, '0')}` : `\\u${c.toString(16).padStart(4, '0')}`;
      else out += ch;
    }
  } else {
    for (const b of buf) {
      if (b === 0x5c) out += '\\\\';
      else if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b);
      else out += `\\x${b.toString(16).padStart(2, '0')}`;
    }
  }
  if (out.length > max) out = `${out.slice(0, max)}…`;
  return out;
}
