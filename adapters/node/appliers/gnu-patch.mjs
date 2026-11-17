// GNU patch.
import { firstLineOf, runTool } from './_cli.mjs';

export const meta = {
  name: 'GNU patch',
  package: 'patch',
  language: 'C',
  homepage: 'https://savannah.gnu.org/projects/patch/',
  api: 'patch -pN -f --no-backup-if-mismatch -i FILE',
  applies: 'tree',
  input: 'bytes',
  notes:
    '-f: never ask. --no-backup-if-mismatch: no .orig files next to a file patched with fuzz or at an offset, ' +
    'so that only what patch did to the files themselves is compared. Rejects (.rej) are left where patch puts them.',
};

const PATCH = process.env.UDTS_PATCH ?? 'patch';

export const version = () => {
  const line = firstLineOf(PATCH, ['--version']);
  if (!/GNU patch/.test(line)) throw new Error('patch is not GNU patch');
  return line.replace(/^GNU patch\s+/, '');
};

export function applyTree({ diff, dir, strip }) {
  runTool(PATCH, [`-p${strip}`, '-f', '--no-backup-if-mismatch', '-i', diff], dir);
}
