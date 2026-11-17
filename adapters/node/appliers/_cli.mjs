// Helpers for appliers that are command-line tools.
//
// UDTS_GIT, UDTS_PATCH, UDTS_BUSYBOX and UDTS_TOYBOX name the program to run when it is not
// the one on the PATH - to test another version, or your own build.
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';

/** An environment that keeps the user's and the machine's configuration out. */
export function cleanEnv(dir) {
  return {
    PATH: process.env.PATH,
    HOME: dir,
    LC_ALL: 'C',
    TZ: 'UTC',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CEILING_DIRECTORIES: dirname(dir), // the directory is not inside anybody's repository
    GIT_TERMINAL_PROMPT: '0',
  };
}

/** Run the tool in `dir`. A status other than 0 is the tool saying "no": that becomes the error. */
export function runTool(cmd, args, dir) {
  const res = spawnSync(cmd, args, { cwd: dir, env: cleanEnv(dir), stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
  if (res.error) throw new Error(`${cmd} could not be started: ${res.error.message}`);
  if (res.status !== 0) {
    const said = `${res.stderr.toString('utf8')}\n${res.stdout.toString('utf8')}`.split('\n').map((l) => l.trim()).filter(Boolean);
    throw new Error(`exit ${res.status ?? res.signal}: ${said.slice(0, 3).join(' | ')}`);
  }
}

export function firstLineOf(cmd, args) {
  const res = spawnSync(cmd, args, { env: { PATH: process.env.PATH, LC_ALL: 'C' }, encoding: 'utf8' });
  if (res.error || res.status !== 0) throw new Error(`${cmd} is not installed`);
  return `${res.stdout}${res.stderr}`.split('\n')[0].trim();
}
