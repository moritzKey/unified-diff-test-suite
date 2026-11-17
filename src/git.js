// Hermetic git runner.
//
// Every git invocation made by this project goes through here so that the
// output never depends on the machine's or the user's git configuration:
// no system config, no global config, fixed identity, fixed dates, C locale.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const EPOCH = 946684800; // 2000-01-01T00:00:00Z

/** Environment that makes git ignore everything outside the repository. */
export function gitEnv(homeDir) {
  return {
    PATH: process.env.PATH,
    HOME: homeDir,
    XDG_CONFIG_HOME: join(homeDir, '.config'),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
    PAGER: 'cat',
    GIT_AUTHOR_NAME: 'A U Thor',
    GIT_AUTHOR_EMAIL: 'author@example.com',
    GIT_COMMITTER_NAME: 'C O Mitter',
    GIT_COMMITTER_EMAIL: 'committer@example.com',
    GIT_AUTHOR_DATE: `${EPOCH} +0000`,
    GIT_COMMITTER_DATE: `${EPOCH} +0000`,
    LC_ALL: 'C',
    LANG: 'C',
    TZ: 'UTC',
  };
}

/**
 * A fresh private directory for repositories and scratch files. UDTS_TMP
 * chooses where (default: the system's temp directory); it is created if needed.
 */
export function makeTempDir(prefix = 'udts-') {
  const base = process.env.UDTS_TMP ?? tmpdir();
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, prefix));
}

export class GitError extends Error {
  constructor(message, result) {
    super(message);
    this.name = 'GitError';
    this.result = result;
  }
}

/**
 * Run a command hermetically. Returns { status, stdout, stderr } with Buffers.
 * `okStatus` lists the exit codes that are not an error (diff tools exit 1
 * when they found differences).
 */
export function run(cmd, args, { cwd, input, env, okStatus = [0] } = {}) {
  const res = spawnSync(cmd, args, {
    cwd,
    input,
    env,
    maxBuffer: 1 << 30,
    windowsHide: true,
  });
  if (res.error) throw new GitError(`${cmd} failed to start: ${res.error.message}`, res);
  if (!okStatus.includes(res.status)) {
    throw new GitError(
      `${cmd} ${args.join(' ')} exited with ${res.status}: ${res.stderr.toString('utf8').slice(0, 2000)}`,
      res,
    );
  }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** A bare repository that only this process talks to. */
export class Repo {
  constructor(dir) {
    this.dir = dir;
    this.home = join(dir, '.home');
    mkdirSync(this.home, { recursive: true });
    this.env = gitEnv(this.home);
    this.gitDir = join(dir, 'repo.git');
    run('git', ['init', '-q', '--bare', '-b', 'main', this.gitDir], { env: this.env });
  }

  /** Run git inside the repository. `config` is a {key: value} map applied with -c. */
  git(args, { input, config = {}, okStatus = [0], cwd, env } = {}) {
    const cfg = [];
    for (const [k, v] of Object.entries(config)) cfg.push('-c', `${k}=${v}`);
    return run('git', ['--git-dir', this.gitDir, ...cfg, ...args], {
      cwd: cwd ?? this.dir,
      input,
      env: env ?? this.env,
      okStatus,
    });
  }
}

let cachedVersions = null;
export function toolVersions() {
  if (cachedVersions) return cachedVersions;
  const env = { PATH: process.env.PATH, LC_ALL: 'C' };
  const first = (cmd, args) => {
    try {
      return run(cmd, args, { env }).stdout.toString('utf8').split('\n')[0].trim();
    } catch {
      return null;
    }
  };
  const gitLine = first('git', ['--version']);
  const diffLine = first('diff', ['--version']);
  const patchLine = first('patch', ['--version']);
  cachedVersions = {
    git: gitLine ? gitLine.replace(/^git version\s+/, '') : null,
    diffutils: diffLine ? (diffLine.match(/(\d+(?:\.\d+)+)/) || [null])[0] : null,
    patch: patchLine ? (patchLine.match(/(\d+(?:\.\d+)+)/) || [null])[0] : null,
  };
  return cachedVersions;
}

export { EPOCH };
