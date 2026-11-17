// The patch of FreeBSD (usr.bin/patch, from OpenBSD). macOS ships it as /usr/bin/patch, where it
// prints "patch 2.0-12u11-Apple".
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { firstLineOf, runTool } from './_cli.mjs';

export const meta = {
  name: 'BSD patch',
  package: 'patch (FreeBSD usr.bin/patch)',
  language: 'C',
  homepage: 'https://cgit.freebsd.org/src/tree/usr.bin/patch',
  api: 'patch -pN -f -s -E -V none -i FILE',
  applies: 'tree',
  input: 'bytes',
  notes:
    '-f: never ask. -s: print only what went wrong. -E: remove a file that is empty after patching; without it a ' +
    'file the patch deletes is left as an empty file, and the ports framework of FreeBSD passes it too (Mk/bsd.port.mk, ' +
    'PATCH_ARGS). -V none: no FILE.orig next to every patched file (made unless --posix is given), so that only what ' +
    'patch did to the files themselves is compared. Rejects (.rej) are left where patch puts them.',
};

// UDTS_BSD_PATCH, else the one adapters/bsd-patch/build.sh builds, else the patch on the PATH (macOS).
const BUILT = fileURLToPath(new URL('../../bsd-patch/build/patch', import.meta.url));
const PATCH = process.env.UDTS_BSD_PATCH ?? (existsSync(BUILT) ? BUILT : 'patch');

export const version = () => {
  const line = firstLineOf(PATCH, ['--version']);
  // "patch 2.0-12u11 FreeBSD", "patch 2.0-12u11-Apple"; GNU patch says "GNU patch 2.7.6".
  if (!/^patch \d/.test(line)) throw new Error('patch is not BSD patch');
  return line.replace(/^patch\s+/, '');
};

export function applyTree({ diff, dir, strip }) {
  runTool(PATCH, [`-p${strip}`, '-f', '-s', '-E', '-V', 'none', '-i', diff], dir);
}
