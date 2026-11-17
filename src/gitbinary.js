// Decoder for "GIT binary patch" blocks (git diff --binary).
//
// A block is `literal <size>` or `delta <size>` followed by lines of git's
// base85 encoding of zlib-deflated data. `literal` data is the file itself,
// `delta` data is a git pack delta against the other side of the diff.
// Decoding them lets the test suite verify binary patches against ground truth
// instead of merely noticing that they are there.

import { inflateSync } from 'node:zlib';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~';
const DECODE = new Int16Array(256).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) DECODE[ALPHABET.charCodeAt(i)] = i;

/** Decode the base85 lines of one block into the deflated byte stream. */
export function decodeBase85Lines(lines) {
  const out = [];
  for (const line of lines) {
    if (line.length === 0) continue;
    const c = line[0];
    let len;
    if (c >= 0x41 && c <= 0x5a) len = c - 0x41 + 1; // 'A'..'Z' -> 1..26
    else if (c >= 0x61 && c <= 0x7a) len = c - 0x61 + 27; // 'a'..'z' -> 27..52
    else throw new Error('invalid length byte in binary patch line');
    const body = line.subarray(1);
    if (body.length % 5 !== 0) throw new Error('binary patch line is not a multiple of 5 characters');
    const bytes = [];
    for (let i = 0; i < body.length; i += 5) {
      let acc = 0;
      for (let k = 0; k < 5; k++) {
        const d = DECODE[body[i + k]];
        if (d < 0) throw new Error('invalid base85 character in binary patch');
        acc = acc * 85 + d;
      }
      if (acc > 0xffffffff) throw new Error('base85 group overflows 32 bits');
      bytes.push((acc >>> 24) & 0xff, (acc >>> 16) & 0xff, (acc >>> 8) & 0xff, acc & 0xff);
    }
    if (len > bytes.length) throw new Error('binary patch line shorter than its length byte');
    for (let i = 0; i < len; i++) out.push(bytes[i]);
  }
  return Buffer.from(out);
}

/** Apply a git pack delta to `base`. */
export function applyDelta(base, delta) {
  let pos = 0;
  const varint = () => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (pos >= delta.length) throw new Error('truncated delta header');
      const b = delta[pos++];
      result += (b & 0x7f) * 2 ** shift;
      shift += 7;
      if (!(b & 0x80)) return result;
    }
  };
  const baseSize = varint();
  const resultSize = varint();
  if (baseSize !== base.length) throw new Error(`delta expects a base of ${baseSize} bytes, got ${base.length}`);
  const out = Buffer.alloc(resultSize);
  let o = 0;
  while (pos < delta.length) {
    const op = delta[pos++];
    if (op & 0x80) {
      let offset = 0;
      let size = 0;
      if (op & 0x01) offset |= delta[pos++];
      if (op & 0x02) offset |= delta[pos++] << 8;
      if (op & 0x04) offset |= delta[pos++] << 16;
      if (op & 0x08) offset += delta[pos++] * 2 ** 24;
      if (op & 0x10) size |= delta[pos++];
      if (op & 0x20) size |= delta[pos++] << 8;
      if (op & 0x40) size |= delta[pos++] << 16;
      if (size === 0) size = 0x10000;
      if (offset + size > base.length || o + size > resultSize) throw new Error('delta copy out of range');
      base.copy(out, o, offset, offset + size);
      o += size;
    } else if (op) {
      if (pos + op > delta.length || o + op > resultSize) throw new Error('delta insert out of range');
      delta.copy(out, o, pos, pos + op);
      pos += op;
      o += op;
    } else throw new Error('delta opcode 0 is reserved');
  }
  if (o !== resultSize) throw new Error('delta produced the wrong number of bytes');
  return out;
}

/**
 * Reconstruct one side from a parsed binary block.
 * `other` is the content of the opposite side (needed for `delta` blocks).
 */
export function decodeBinaryBlock(block, other) {
  const raw = inflateSync(decodeBase85Lines(block.data));
  if (raw.length !== block.size) throw new Error(`binary block announces ${block.size} bytes but inflates to ${raw.length}`);
  if (block.method === 'literal') return raw;
  if (block.method === 'delta') return applyDelta(other, raw);
  throw new Error(`unknown binary patch method ${block.method}`);
}
