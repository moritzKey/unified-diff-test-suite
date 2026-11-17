// Ground truth, straight from git's machine-readable output.
//
// `git diff --raw -z` and `git diff --numstat -z` describe a change without
// any of the ambiguities of the patch text: paths are NUL-terminated raw bytes,
// modes and object ids are spelled out. Whatever a parser concludes from the
// patch text has to agree with this.

const NUL = 0x00;

function splitNul(buf) {
  const out = [];
  let start = 0;
  for (;;) {
    const i = buf.indexOf(NUL, start);
    if (i === -1) break;
    out.push(buf.subarray(start, i));
    start = i + 1;
  }
  if (start !== buf.length) throw new Error('raw output does not end with NUL');
  return out;
}

/** Parse `git diff --raw -z --no-abbrev`. */
export function parseRawZ(buf) {
  const tokens = splitNul(buf);
  const entries = [];
  for (let i = 0; i < tokens.length; ) {
    const meta = tokens[i++].toString('latin1');
    const m = /^:(\d{6}) (\d{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([ACDMRTUX])(\d*)$/.exec(meta);
    if (!m) throw new Error(`unexpected --raw record: ${JSON.stringify(meta)}`);
    const status = m[5];
    const e = {
      status,
      score: m[6] === '' ? null : Number(m[6]),
      oldMode: m[1],
      newMode: m[2],
      oldId: m[3],
      newId: m[4],
      oldPath: null,
      newPath: null,
    };
    const p1 = Buffer.from(tokens[i++]);
    if (status === 'R' || status === 'C') {
      e.oldPath = p1;
      e.newPath = Buffer.from(tokens[i++]);
    } else if (status === 'A') e.newPath = p1;
    else if (status === 'D') e.oldPath = p1;
    else {
      e.oldPath = p1;
      e.newPath = p1;
    }
    entries.push(e);
  }
  return entries;
}

/** Parse `git diff --numstat -z`. Returns [{added, deleted, binary, oldPath, newPath}]. */
export function parseNumstatZ(buf) {
  const tokens = splitNul(buf);
  const out = [];
  for (let i = 0; i < tokens.length; ) {
    const t = tokens[i++];
    const tab1 = t.indexOf(0x09);
    const tab2 = t.indexOf(0x09, tab1 + 1);
    if (tab1 === -1 || tab2 === -1) throw new Error('unexpected --numstat record');
    const a = t.subarray(0, tab1).toString('latin1');
    const d = t.subarray(tab1 + 1, tab2).toString('latin1');
    const rest = t.subarray(tab2 + 1);
    const rec = { binary: a === '-', added: a === '-' ? null : Number(a), deleted: d === '-' ? null : Number(d) };
    if (rest.length === 0) {
      rec.oldPath = Buffer.from(tokens[i++]);
      rec.newPath = Buffer.from(tokens[i++]);
    } else {
      rec.oldPath = Buffer.from(rest);
      rec.newPath = Buffer.from(rest);
    }
    out.push(rec);
  }
  return out;
}

/** Combine both listings into one record per changed path. */
export function mergeTruth(rawEntries, numstat) {
  if (rawEntries.length !== numstat.length) {
    throw new Error(`--raw lists ${rawEntries.length} changes but --numstat lists ${numstat.length}`);
  }
  return rawEntries.map((e, i) => ({
    ...e,
    added: numstat[i].added,
    deleted: numstat[i].deleted,
    binary: numstat[i].binary,
  }));
}
