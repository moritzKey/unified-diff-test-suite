// nixpkgs' fetchpatch: the normalization with patchutils 0.3.3, then GNU patch. See _nix-fetchpatch.mjs.
import { fetchpatchApply, fetchpatchMeta, fetchpatchVersion } from './_nix-fetchpatch.mjs';

export const meta = fetchpatchMeta('fetchpatch', '0.3.3');
export const version = () => fetchpatchVersion('0.3.3');
export const applyTree = (req) => fetchpatchApply('0.3.3', req);
