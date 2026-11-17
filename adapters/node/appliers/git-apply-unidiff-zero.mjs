// git apply --unidiff-zero: the option git asks for when a patch has no context lines.
import { firstLineOf, runTool } from './_cli.mjs';

export const meta = {
  name: 'git apply --unidiff-zero',
  package: 'git',
  language: 'C',
  homepage: 'https://git-scm.com/docs/git-apply',
  api: 'git apply --unidiff-zero -pN FILE',
  applies: 'tree',
  input: 'bytes',
};

const GIT = process.env.UDTS_GIT ?? 'git';

export const version = () => firstLineOf(GIT, ['--version']).replace(/^git version\s+/, '');

export function applyTree({ diff, dir, strip }) {
  runTool(GIT, ['apply', '--unidiff-zero', `-p${strip}`, diff], dir);
}
