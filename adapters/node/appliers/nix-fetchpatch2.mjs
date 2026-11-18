// nixpkgs' fetchpatch2: the normalization with patchutils 0.4.2, then GNU patch. See _nix-fetchpatch.mjs.
import { fetchpatchApply, fetchpatchMeta, fetchpatchVersion } from './_nix-fetchpatch.mjs';

export const meta = fetchpatchMeta('fetchpatch2', '0.4.2');
export const version = () => fetchpatchVersion('0.4.2');
export const applyTree = (req) => fetchpatchApply('0.4.2', req);
