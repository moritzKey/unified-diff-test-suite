// The patch applet of BusyBox (the patch of Alpine Linux and of many container images).
import { firstLineOf, runTool } from './_cli.mjs';

export const meta = {
  name: 'BusyBox patch',
  package: 'busybox',
  language: 'C',
  homepage: 'https://busybox.net/',
  api: 'busybox patch -pN -i FILE',
  applies: 'tree',
  input: 'bytes',
};

const BUSYBOX = process.env.UDTS_BUSYBOX ?? 'busybox';

export const version = () => (firstLineOf(BUSYBOX, ['--help']).match(/v(\d[\w.]*)/) ?? [null, null])[1];

export function applyTree({ diff, dir, strip }) {
  runTool(BUSYBOX, ['patch', `-p${strip}`, '-i', diff], dir);
}
