// Helpers for nixpkgs' fetchpatch and fetchpatch2: the patch as fetchpatch normalizes it, applied with GNU patch.
//
// fetchpatch normalizes every patch it downloads before it checks the hash: it lists the files with lsdiff,
// extracts each with filterdiff --include --clean, and runs filterdiff -p1 over the result
// (adapters/nix-fetchpatch/normalize.sh holds those commands). stdenv's patchPhase then applies the result with
// `patch -p1`. The adapter applies it the way the GNU patch adapter applies a patch, so that what differs from
// GNU patch comes from the normalization.
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { firstLineOf, runTool } from './_cli.mjs';

const HERE = fileURLToPath(new URL('../../nix-fetchpatch/', import.meta.url));
const PATCH = process.env.UDTS_PATCH ?? 'patch';

export function fetchpatchMeta(name, patchutils) {
  return {
    name,
    package: `nixpkgs ${name} (patchutils ${patchutils})`,
    language: 'shell and C (patchutils)',
    homepage: 'https://github.com/NixOS/nixpkgs/blob/master/pkgs/build-support/fetchpatch/default.nix',
    api: `the postFetch of ${name} with its defaults (stripLen 0), then patch -p1 -f --no-backup-if-mismatch`,
    applies: 'tree',
    input: 'bytes',
    prefixes: ['a/', 'b/'],
    notes:
      `${name} normalizes a downloaded patch before checking its hash: lsdiff | sort -u | sed (escape * and ?) | ` +
      'xargs filterdiff --include={} --strip=0 --clean, then filterdiff -p1 (adapters/nix-fetchpatch/normalize.sh). ' +
      `It runs patchutils ${patchutils}, built from the sources and with the patches nixpkgs uses ` +
      '(adapters/nix-fetchpatch/build.sh). stdenv applies the result with patch -p1; the adapter applies it as the ' +
      'GNU patch adapter does, so a difference to GNU patch comes from the normalization. The patches nixpkgs ' +
      'fetches carry a/ and b/ and are applied with -p1, so only vectors with those prefixes are given.',
  };
}

export function fetchpatchVersion(patchutils) {
  const bin = `${HERE}build/patchutils-${patchutils}/bin`;
  const line = firstLineOf(`${bin}/filterdiff`, ['--version']);
  if (!line.endsWith(patchutils)) throw new Error(`patchutils ${patchutils} is not built (adapters/nix-fetchpatch/build.sh)`);
  firstLineOf(PATCH, ['--version']);
  let nixpkgs = '';
  try {
    nixpkgs = readFileSync(`${HERE}build/nixpkgs`, 'utf8').trim().slice(0, 10);
  } catch {
    // build.sh writes it last
  }
  return `patchutils ${patchutils}${nixpkgs ? `, nixpkgs ${nixpkgs}` : ''}`;
}

export function fetchpatchApply(patchutils, { diff, dir, strip }) {
  const normalized = `${dir}.fetchpatch.patch`;
  try {
    // UDTS_FETCHPATCH_NORMALIZE names another normalization script, to try a change to fetchpatch.
    const script = process.env.UDTS_FETCHPATCH_NORMALIZE ?? `${HERE}normalize.sh`;
    const res = spawnSync('bash', [script, `${HERE}build/patchutils-${patchutils}/bin`, diff, normalized], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, LC_ALL: 'C' },
    });
    if (res.error) throw res.error;
    if (res.status !== 0) throw new Error(`the fetch fails: ${res.stderr.trim().split('\n')[0]}`);
    runTool(PATCH, [`-p${strip}`, '-f', '--no-backup-if-mismatch', '-i', normalized], dir);
  } finally {
    rmSync(normalized, { force: true });
    rmSync(`${normalized}.tmp`, { force: true });
  }
}
