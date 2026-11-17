// Rebuild a scenario from the recipe stored in a vector.
//
// Every vector carries what is needed to produce it again: the file-tree states
// and the tool invocation. That makes the corpus reproducible on another
// machine or with another git version, and lets tools derive variants of a
// vector (for example the same change printed with --full-index).

import { stateFromJson } from './tree.js';

const PRODUCER_KEYS = ['config', 'from', 'to', 'prefixes', 'dirs', 'env', 'command', 'merge', 'truthArgs', 'file', 'relative', 'gitApply'];

export function scenarioFromVector(vector) {
  const r = vector.recipe;
  const producer = { kind: r.kind, args: [...(r.args ?? [])] };
  for (const k of PRODUCER_KEYS) if (r[k] !== undefined) producer[k] = r[k];
  return {
    id: vector.id,
    tier: vector.tier,
    title: vector.title,
    description: vector.description,
    tags: vector.tags,
    states: r.states.map(stateFromJson),
    parents: r.parents,
    producer,
  };
}

/** Kinds of producers that print ordinary git patches. */
export const GIT_PATCH_KINDS = new Set(['git-diff', 'git-diff-cached', 'git-diff-worktree', 'git-show', 'git-log', 'git-format-patch']);

/**
 * Derive a variant of a scenario. Known flavours:
 *   full-index - the same output with --full-index (40-digit object ids on the index line)
 */
export function flavoured(scenario, flavor) {
  if (flavor === 'full-index') {
    if (!GIT_PATCH_KINDS.has(scenario.producer.kind)) return null;
    if (scenario.producer.args.includes('--full-index')) return scenario;
    return { ...scenario, producer: { ...scenario.producer, args: [...scenario.producer.args, '--full-index'] } };
  }
  throw new Error(`unknown flavour ${flavor}`);
}
