// Debian's dpkg-source, source format 3.0 (quilt): how it applies each patch of debian/patches.
//
// Dpkg::Source::Quilt->push() calls Dpkg::Source::Patch->apply() with the options below. apply() first runs
// analyze() on the patch (it wants ---/+++ headers and hunks, refuses paths with "..", symbolic links on the
// way to a file, and targets that are not plain files) and then GNU patch. The adapter calls apply() through
// perl with exactly those options. quilt keeps its backups in .pc/<patch>/ inside the tree; that directory is
// quilt's bookkeeping, like .git, and is removed before the tree is read back.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

const SCRIPT = String.raw`
use strict;
use Dpkg::Source::Patch;
my ($diff, $dir) = @ARGV;
my $obj = Dpkg::Source::Patch->new(filename => $diff);
$obj->apply($dir, timestamp => time, verbose => 0, force_timestamp => 1, create_dirs => 1, remove_backup => 0,
            options => [ '-t', '-F', '0', '-N', '-p1', '-u', '-V', 'never', '-E', '-b',
                         '-B', '.pc/udts.patch/', '--reject-file=-' ]);
`;

export const meta = {
  name: 'dpkg-source (3.0 quilt)',
  package: 'dpkg-dev',
  language: 'Perl (runs GNU patch)',
  homepage: 'https://salsa.debian.org/dpkg-team/dpkg/-/blob/main/scripts/Dpkg/Source/Quilt.pm',
  api: 'Dpkg::Source::Patch->apply() with the options of Dpkg::Source::Quilt->push()',
  applies: 'tree',
  input: 'bytes',
  prefixes: ['a/', 'b/'],
  notes:
    'Dpkg::Source::Patch->analyze() checks the patch, then GNU patch runs with -t -F 0 -N -p1 -u -V never -E -b ' +
    '-B .pc/<patch>/ --reject-file=-, as dpkg-source -x and dpkg-source --before-build do for a 3.0 (quilt) ' +
    'package. -E removes a file that the patch leaves empty. Patches in debian/patches are applied with -p1.',
};

export function version() {
  const r = spawnSync('perl', ['-MDpkg', '-e', 'print $Dpkg::PROGVERSION'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) throw new Error('Dpkg (dpkg-dev) is not installed');
  return `dpkg ${r.stdout.trim()}`;
}

export function applyTree({ diff, dir }) {
  const r = spawnSync('perl', ['-e', SCRIPT, diff, dir], { encoding: 'utf8', env: { PATH: process.env.PATH, LC_ALL: 'C' } });
  rmSync(join(dir, '.pc'), { recursive: true, force: true });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    const said = `${r.stderr}\n${r.stdout}`.split('\n').map((l) => l.trim()).filter(Boolean);
    throw new Error(`exit ${r.status}: ${said.slice(0, 3).join(' | ')}`);
  }
}
