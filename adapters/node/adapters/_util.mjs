// Helpers shared by the JavaScript adapters.
//
// An adapter translates a library's own result into the normalised shape that
// the harness compares (see adapters/PROTOCOL.md). It must not repair anything:
// if the library returns a wrong value, the adapter passes the wrong value on.

/** "/dev/null" is the conventional placeholder for "no file on this side". */
export const devnull = (p) => (p === '/dev/null' ? null : p === undefined ? UNKNOWN : p);
/** A name the library left undefined: it could not determine it. */
export const UNKNOWN = { unknown: true };

const TYPE = { '+': 'add', '-': 'delete', ' ': 'context' };

/**
 * Lines given as strings that still carry their marker column, with
 * "\ No newline at end of file" delivered as a pseudo-line (the representation
 * used by several libraries).
 */
export function fromMarkedLines(lines) {
  const out = [];
  for (const s of lines) {
    if (s.startsWith('\\')) {
      if (out.length) out[out.length - 1].no_newline = true;
      else out.push({ type: 'orphan-marker', text: s });
      continue;
    }
    out.push({ type: TYPE[s[0]] ?? `unknown(${JSON.stringify(s.slice(0, 1))})`, text: s.slice(1) });
  }
  return out;
}

export const orNull = (v) => (v === undefined ? null : v);
