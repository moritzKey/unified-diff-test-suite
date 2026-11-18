// Subversion: `svn patch`, in a working copy whose last commit is the old tree.
//
// UDTS_SVN and UDTS_SVNADMIN name other programs than the `svn` and `svnadmin` on the PATH.
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SVN = process.env.UDTS_SVN ?? 'svn';
const SVNADMIN = process.env.UDTS_SVNADMIN ?? 'svnadmin';

export const meta = {
  name: 'Subversion',
  package: 'subversion',
  language: 'C',
  homepage: 'https://subversion.apache.org/',
  api: 'svn patch [--strip N] FILE',
  applies: 'tree',
  input: 'bytes',
  notes:
    'svn patch works on a working copy, so the directory is made one first: a repository next to it (svnadmin create), ' +
    'svn checkout --force into it, svn add --force --no-ignore, svn commit. A name that Subversion cannot version (not ' +
    'valid UTF-8, a control character) makes that step fail, and the patch counts as refused. svn patch exits with ' +
    'status 0 when it rejects a hunk or skips a file, and says so in a "Summary of conflicts"; the adapter takes that ' +
    'as the failure it reports. LC_ALL=C.UTF-8, so that names outside ASCII can be versioned, and a configuration ' +
    'directory of its own, so that no auto-props or global-ignores take part. In a section that begins with ' +
    '"diff --git a/", svn removes the a/ and b/ itself (git_start(), git_minus() and git_plus() in ' +
    'libsvn_diff/parse-diff.c), so a git diff is applied with one component less to strip: `svn patch x.diff` for ' +
    'the usual prefixes, as a user would. Other diffs get the --strip of patch -pN.',
};

function env(home) {
  return { PATH: process.env.PATH, LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH ?? '', HOME: home, LC_ALL: 'C.UTF-8', TZ: 'UTC' };
}

function run(cmd, args, { cwd, home }) {
  const res = spawnSync(cmd, args, { cwd, env: env(home), stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
  if (res.error) throw new Error(`${cmd} could not be started: ${res.error.message}`);
  const out = `${res.stdout.toString('utf8')}\n${res.stderr.toString('utf8')}`;
  if (res.status !== 0) {
    const said = out.split('\n').map((l) => l.trim()).filter(Boolean);
    throw new Error(`${args[0]}: exit ${res.status ?? res.signal}: ${said.slice(0, 3).join(' | ')}`);
  }
  return out;
}

export function version() {
  const res = spawnSync(SVN, ['--version', '--quiet'], { env: env('/nonexistent'), encoding: 'utf8' });
  if (res.error || res.status !== 0) throw new Error('svn is not installed');
  return res.stdout.trim();
}

export function applyTree({ diff, dir, strip }) {
  const repo = `${dir}.svnrepo`;
  const config = `${dir}.svnconfig`;
  const opts = { cwd: dir, home: config };
  const common = ['--config-dir', config, '--non-interactive'];
  rmSync(repo, { recursive: true, force: true });
  rmSync(config, { recursive: true, force: true });
  try {
    run(SVNADMIN, ['create', repo], opts);
    run(SVN, ['checkout', '--quiet', '--force', ...common, pathToFileURL(repo).href, '.'], opts);
    run(SVN, ['add', '--quiet', '--force', '--no-ignore', ...common, '.'], opts);
    run(SVN, ['commit', '--quiet', ...common, '--message', 'the old tree'], opts);
    const gitSections = /^diff --git a\//m.test(readFileSync(diff, 'latin1'));
    const svnStrip = gitSections ? Math.max(strip - 1, 0) : strip;
    const out = run(SVN, ['patch', ...common, '--strip', String(svnStrip), diff], opts);
    // "C  name", "> rejected hunk ...", "Skipped ...", then "Summary of conflicts:" and the counts.
    if (/^Summary of conflicts:/m.test(out)) {
      const said = out.split('\n').map((l) => l.trim()).filter((l) => /^(C |>|Skipped|Summary|Text conflicts|Property conflicts|Tree conflicts|Skipped paths)/.test(l));
      throw new Error(`svn patch reported conflicts (exit 0): ${said.slice(0, 6).join(' | ')}`);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(config, { recursive: true, force: true });
  }
}
