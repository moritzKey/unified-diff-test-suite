// The patch command of toybox (the patch of Android).
import { firstLineOf, runTool } from './_cli.mjs';

export const meta = {
  name: 'toybox patch',
  package: 'toybox',
  language: 'C',
  homepage: 'https://landley.net/toybox/',
  api: 'toybox patch -pN -i FILE',
  applies: 'tree',
  input: 'bytes',
};

const TOYBOX = process.env.UDTS_TOYBOX ?? 'toybox';

export const version = () => (firstLineOf(TOYBOX, ['--version']).match(/(\d[\w.]*)/) ?? [null, null])[1];

export function applyTree({ diff, dir, strip }) {
  runTool(TOYBOX, ['patch', `-p${strip}`, '-i', diff], dir);
}
