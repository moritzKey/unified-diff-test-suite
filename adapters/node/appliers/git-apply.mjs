// git apply, in a directory that is not a repository.
import { firstLineOf, runTool } from './_cli.mjs';

export const meta = {
  name: 'git apply',
  package: 'git',
  language: 'C',
  homepage: 'https://git-scm.com/docs/git-apply',
  api: 'git apply -pN FILE',
  applies: 'tree',
  input: 'bytes',
  notes: 'No options beyond -p. git apply is all or nothing.',
};

const GIT = process.env.UDTS_GIT ?? 'git';

export const version = () => firstLineOf(GIT, ['--version']).replace(/^git version\s+/, '');

export function applyTree({ diff, dir, strip }) {
  runTool(GIT, ['apply', `-p${strip}`, diff], dir);
}
