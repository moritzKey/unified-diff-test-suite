// Turn a scenario into a verified test vector.
//
// A scenario names a sequence of file-tree states and a real tool invocation
// (git or GNU diff). This module builds the states, runs the tool, collects the
// ground truth, parses the output with the reference parser, and refuses to
// continue unless the parse agrees with the ground truth in every detail.

import { mkdirSync, rmSync, utimesSync, lutimesSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { run, toolVersions, gitEnv, EPOCH } from './git.js';
import { importStates, materialize, normalizeState, stateToJson, MODE } from './tree.js';
import { parseRawZ, parseNumstatZ, mergeTruth } from './truth.js';
import { parseDiff, resolveNames } from './refparse.js';
import { fileToJson } from './tojson.js';
import { verifyGitParse, verifyPlainParse, verifyCombinedSection, expectedSections, ReplayError } from './replay.js';
import { isUtf8 } from 'node:buffer';
import { bytesToJson, toBuf, bufEq, show } from './bytes.js';
import { applyInfo } from './applycase.js';

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

// Options that add or change output formats but do not change what is being compared.
const PRESENTATIONAL = new Set([
  '-p', '-u', '--patch', '--stat', '--patch-with-stat', '--patch-with-raw', '--summary', '--shortstat',
  '--numstat', '--compact-summary', '--binary', '--cc', '-c', '-m', '--root', '--stdout', '--no-color',
  '--full-index', '--no-prefix', '--default-prefix', '-D', '--irreversible-delete', '-W', '--function-context',
  '--no-signature', '--keep-subject', '-k', '--numbered', '-n', '--no-numbered', '-N', '--cover-letter',
]);
const PRESENTATIONAL_RE = /^(--stat[=-]|--dirstat|--format=|--pretty=|--src-prefix=|--dst-prefix=|--line-prefix=|--abbrev|-U\d+$|--unified=|--inter-hunk-context=|--signature=|--subject-prefix=)/;

function truthArgsOf(producer) {
  if (producer.truthArgs) return producer.truthArgs;
  return (producer.args ?? []).filter((a) => !PRESENTATIONAL.has(a) && !PRESENTATIONAL_RE.test(a));
}

function contentLookup(states) {
  const maps = states.map((st) => {
    const m = new Map();
    for (const e of normalizeState(st).files) m.set(e.path.toString('latin1'), e);
    return m;
  });
  const contentOf = (stateIndex, path, mode) => {
    if (stateIndex === null) return Buffer.alloc(0);
    const e = maps[stateIndex].get(path.toString('latin1'));
    if (!e) throw new ReplayError(`no file ${show(path)} in state ${stateIndex}`);
    if (e.mode === MODE.GITLINK) return Buffer.from(`Subproject commit ${e.content.toString('latin1')}\n`, 'latin1');
    return e.content;
  };
  return { maps, contentOf };
}

function gitTruth(repo, producer, oldRev, newRev) {
  const args = truthArgsOf(producer);
  const config = producer.config ?? {};
  const raw = repo.git(['diff', '--raw', '-z', '--no-abbrev', ...args, oldRev, newRev], { config }).stdout;
  const num = repo.git(['diff', '--numstat', '-z', ...args, oldRev, newRev], { config }).stdout;
  return mergeTruth(parseRawZ(raw), parseNumstatZ(num));
}

function prefixesOf(producer) {
  const [src, dst] = producer.prefixes ?? ['a/', 'b/'];
  return { src: toBuf(src), dst: toBuf(dst) };
}

// ---- GNU diff ---------------------------------------------------------------

function setTimes(root, seconds) {
  for (const name of readdirSync(root, { encoding: 'buffer' })) {
    const full = Buffer.concat([toBuf(root), Buffer.from('/'), name]);
    const st = lstatSync(full);
    if (st.isDirectory()) setTimes(full, seconds);
    if (st.isSymbolicLink()) lutimesSync(full, seconds, seconds);
    else utimesSync(full, seconds, seconds);
  }
}

/** Paths in the order `diff -r` visits them: per directory, entries sorted bytewise. */
function gnuOrder(paths) {
  const cmp = (a, b) => {
    const pa = a.toString('latin1').split('/');
    const pb = b.toString('latin1').split('/');
    for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
      if (pa[i] !== pb[i]) return Buffer.compare(Buffer.from(pa[i], 'latin1'), Buffer.from(pb[i], 'latin1'));
    }
    return pa.length - pb.length;
  };
  return [...paths].sort(cmp);
}

function produceGnu(workDir, scenario, tag) {
  const p = scenario.producer;
  const from = p.from ?? 0;
  const to = p.to ?? 1;
  const [dirA, dirB] = p.dirs ?? ['a', 'b'];
  const base = join(workDir, `gnu-${tag}`);
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  const states = scenario.states.map((s, i) => normalizeState(s, i));
  materialize(join(base, dirA), states[from]);
  materialize(join(base, dirB), states[to]);
  setTimes(join(base, dirA), EPOCH);
  setTimes(join(base, dirB), EPOCH + 3600);
  // `file` compares one file of each tree ("diff -u a/x b/x") instead of the directories.
  const targets = p.file ? [`${dirA}/${p.file}`, `${dirB}/${p.file}`] : [dirA, dirB];
  const args = [...(p.args ?? ['-ruN']), ...targets];
  const env = { PATH: process.env.PATH, LC_ALL: 'C', TZ: 'UTC', ...(p.env ?? {}) };
  const res = run('diff', args, { cwd: base, env, okStatus: [0, 1] });
  rmSync(base, { recursive: true, force: true });

  const oldMap = new Map(states[from].files.map((e) => [e.path.toString('latin1'), e]));
  const newMap = new Map(states[to].files.map((e) => [e.path.toString('latin1'), e]));
  const all = new Map();
  for (const e of [...states[from].files, ...states[to].files]) all.set(e.path.toString('latin1'), e.path);
  const changes = [];
  const labels = (p.args ?? []).flatMap((a, i, arr) => (a === '--label' ? [arr[i + 1]] : a.startsWith('--label=') ? [a.slice(8)] : []));
  for (const path of gnuOrder([...all.values()])) {
    const key = path.toString('latin1');
    if (p.file && key !== p.file) continue;
    const o = oldMap.get(key);
    const n = newMap.get(key);
    const oldContent = o ? o.content : Buffer.alloc(0);
    const newContent = n ? n.content : Buffer.alloc(0);
    if (bufEq(oldContent, newContent)) continue;
    // Without -N, a file that exists on one side only is reported as "Only in ...", not diffed.
    if ((!o || !n) && !(p.args ?? ['-ruN']).some((a) => /^-[a-zA-Z]*N/.test(a) || a === '--new-file')) continue;
    changes.push({
      path,
      oldName: labels.length === 2 ? Buffer.from(labels[0]) : Buffer.concat([Buffer.from(`${dirA}/`), path]),
      newName: labels.length === 2 ? Buffer.from(labels[1]) : Buffer.concat([Buffer.from(`${dirB}/`), path]),
      oldContent,
      newContent,
      binary: oldContent.includes(0) || newContent.includes(0),
    });
  }
  const parse = parseDiff(res.stdout);
  if (scenario.tamper) scenario.tamper(parse);
  verifyPlainParse(parse, changes);
  // With --label the names are free text: there is no prefix to remove.
  const prefixes = labels.length === 2 ? { src: Buffer.alloc(0), dst: Buffer.alloc(0) } : { src: Buffer.from(`${dirA}/`), dst: Buffer.from(`${dirB}/`) };
  return {
    diff: res.stdout,
    parse,
    prefixes,
    command: { tool: 'diff', version: toolVersions().diffutils, argv: ['diff', ...args], env: p.env ?? {} },
    gitApply: 'not-applicable',
  };
}

// ---- git ----------------------------------------------------------------------

function produceGit(repo, scenario, tag) {
  const p = scenario.producer;
  const config = p.config ?? {};
  const args = p.args ?? [];
  const states = scenario.states;
  const commits = importStates(repo, states, tag, scenario.parents);
  const { contentOf } = contentLookup(states);
  const prefixes = prefixesOf(p);
  const reversed = args.includes('-R');
  // With --relative=<dir>/ the diff names paths relative to <dir>.
  const inRepo = (path) => (p.relative ? Buffer.concat([toBuf(p.relative), path]) : path);
  let argv;
  let res;
  const steps = []; // [{oldIndex, newIndex, oldRev, newRev}]
  const rev = (i) => (i === null ? EMPTY_TREE : commits[i]);

  if (p.kind === 'git-diff') {
    const from = p.from ?? 0;
    const to = p.to ?? 1;
    argv = ['diff', ...args, commits[from], commits[to]];
    res = repo.git(argv, { config });
    steps.push({ oldIndex: from, newIndex: to });
  } else if (p.kind === 'git-diff-cached') {
    const from = p.from ?? 0;
    const to = p.to ?? 1;
    const env = { ...repo.env, GIT_INDEX_FILE: join(repo.dir, `index-${tag}`) };
    repo.git(['read-tree', commits[to]], { env });
    argv = ['diff', '--cached', ...args, commits[from]];
    res = repo.git(argv, { config, env });
    rmSync(env.GIT_INDEX_FILE, { force: true });
    steps.push({ oldIndex: from, newIndex: to });
  } else if (p.kind === 'git-diff-worktree') {
    // index = state `from`, working tree = state `to`
    const from = p.from ?? 0;
    const to = p.to ?? 1;
    const wt = join(repo.dir, `wt-${tag}`);
    rmSync(wt, { recursive: true, force: true });
    materialize(wt, states[to]);
    const env = { ...repo.env, GIT_INDEX_FILE: join(repo.dir, `index-${tag}`), GIT_WORK_TREE: wt };
    repo.git(['read-tree', commits[from]], { env });
    argv = ['diff', ...args];
    res = repo.git(argv, { config, env, cwd: wt });
    rmSync(env.GIT_INDEX_FILE, { force: true });
    rmSync(wt, { recursive: true, force: true });
    steps.push({ oldIndex: from, newIndex: to });
  } else if (p.kind === 'git-show') {
    const to = p.to ?? 1;
    argv = ['show', ...args, commits[to]];
    res = repo.git(argv, { config });
    steps.push({ oldIndex: to === 0 ? null : to - 1, newIndex: to });
  } else if (p.kind === 'git-log') {
    const last = states.length - 1;
    argv = ['log', '-p', ...args, commits[last]];
    res = repo.git(argv, { config });
    for (let i = last; i >= 0; i--) steps.push({ oldIndex: i === 0 ? null : i - 1, newIndex: i });
  } else if (p.kind === 'git-format-patch') {
    const last = states.length - 1;
    argv = ['format-patch', '--stdout', ...args, `${commits[0]}..${commits[last]}`];
    res = repo.git(argv, { config });
    for (let i = 1; i <= last; i++) steps.push({ oldIndex: i - 1, newIndex: i });
  } else throw new Error(`unknown producer kind ${p.kind}`);

  const parse = parseDiff(res.stdout);
  // Test hook: lets the test-suite corrupt a parse to prove that verification notices.
  if (scenario.tamper) scenario.tamper(parse);
  // Verify step by step; the sections of all steps appear in order in one parse.
  let offset = 0;
  for (const step of steps) {
    const truth = gitTruth(repo, p, rev(step.oldIndex), rev(step.newIndex));
    const count = expectedSections(truth).length;
    const sub = { files: parse.files.slice(offset, offset + count), errors: parse.errors };
    const oldIdx = reversed ? step.newIndex : step.oldIndex;
    const newIdx = reversed ? step.oldIndex : step.newIndex;
    verifyGitParse(
      sub,
      truth,
      {
        old: (e) => contentOf(oldIdx, inRepo(e.oldPath), e.oldMode),
        new: (e) => contentOf(newIdx, inRepo(e.newPath), e.newMode),
      },
      prefixes,
      {
        deletionsOmitted: args.includes('-D') || args.includes('--irreversible-delete'),
        textForced: args.includes('--text') || args.includes('-a'),
      },
    );
    offset += count;
  }
  if (offset !== parse.files.length) {
    throw new ReplayError(`patch has ${parse.files.length} file sections, ground truth accounts for ${offset}`);
  }
  const gitApply = crossCheckWithGitApply(repo, res.stdout, parse, prefixes, p);
  // Show the commit ids as placeholders in the recorded command line: they are stable, but long.
  const display = argv.map((a) => {
    let s = a;
    commits.forEach((c, i) => {
      s = s.split(c).join(`<state${i}>`);
    });
    return s;
  });
  return {
    diff: res.stdout,
    parse,
    prefixes,
    command: { tool: 'git', version: toolVersions().git, argv: ['git', ...display], config },
    gitApply,
  };
}

/**
 * A second, independent oracle: feed the patch text to git's own reader
 * (`git apply --numstat`) and require that it sees the same files and the same
 * line counts as the reference parser. Returns 'agrees', or 'not-applicable'
 * for output that git apply is not meant to read back.
 */
function crossCheckWithGitApply(repo, diff, parse, prefixes, producer) {
  if (producer.gitApply === false) return 'not-applicable';
  const strip = (pre) => pre.toString('latin1').split('/').length - 1;
  if (strip(prefixes.src) !== strip(prefixes.dst)) return 'not-applicable';
  if (!prefixes.src.toString('latin1').match(/^([^/]+\/)*$/)) return 'not-applicable';
  if (parse.files.length === 0) return 'agrees'; // git apply rejects empty input ("unrecognized input")
  const res = repo.git(['apply', '--numstat', '-z', `-p${strip(prefixes.src)}`], { input: diff, okStatus: [0, 1, 128] });
  if (res.status !== 0) {
    // git cannot read back what git wrote. That happens (see SPEC.md); it must be expected explicitly.
    const message = res.stderr.toString('utf8').trim().split('\n')[0].slice(0, 300);
    // 'may-reject': some versions of git cannot read this output of git (see SPEC.md).
    if (producer.gitApply === 'may-reject' || producer.lenientApply) return { rejected: message };
    throw new ReplayError(`git apply cannot read this patch: ${message}`);
  }
  const records = res.stdout.toString('latin1').split('\0').filter((r) => r.length);
  if (records.length !== parse.files.length) {
    throw new ReplayError(`git apply sees ${records.length} patches, the reference parser ${parse.files.length}`);
  }
  parse.files.forEach((f, i) => {
    const [a, d, ...rest] = records[i].split('\t');
    const name = Buffer.from(rest.join('\t'), 'latin1');
    const names = resolveNames(f, prefixes);
    const want = names.newPath ?? names.oldPath;
    if (!bufEq(name, want)) throw new ReplayError(`git apply names patch ${i + 1} ${show(name)}, the reference parser ${show(want)}`);
    let added = 0;
    let deleted = 0;
    for (const h of f.hunks) for (const ln of h.lines) {
      if (ln.type === '+') added++;
      else if (ln.type === '-') deleted++;
    }
    const wantCounts = f.binary ? '-/-' : `${added}/${deleted}`;
    if (`${a}/${d}` !== wantCounts) throw new ReplayError(`git apply counts ${a}/${d} for patch ${i + 1} (${show(want)}), the reference parser ${wantCounts}`);
  });
  return 'agrees';
}

// ---- combined diffs -------------------------------------------------------------

function produceMerge(repo, scenario, tag) {
  const p = scenario.producer;
  const config = p.config ?? {};
  const args = p.args ?? [];
  const states = scenario.states;
  const parents = scenario.parents;
  if (!parents) throw new Error('a merge scenario needs `parents`');
  const commits = importStates(repo, states, tag, parents);
  const mergeIndex = p.merge ?? states.length - 1;
  const { maps } = contentLookup(states);
  const argv = [p.command ?? 'show', ...args, commits[mergeIndex]];
  const res = repo.git(argv, { config });
  const parse = parseDiff(res.stdout);
  if (scenario.tamper) scenario.tamper(parse);
  if (parse.errors.length) throw new ReplayError(`parser reported errors: ${JSON.stringify(parse.errors)}`);

  const keyOf = (e) => (e ? `${e.mode}:${e.content.toString('latin1')}` : 'absent');
  const result = maps[mergeIndex];
  const pmaps = parents[mergeIndex].map((i) => maps[i]);
  const allPaths = new Set([...result.keys(), ...pmaps.flatMap((m) => [...m.keys()])]);
  const interesting = [...allPaths]
    .filter((k) => pmaps.every((m) => keyOf(m.get(k)) !== keyOf(result.get(k))))
    .sort((a, b) => Buffer.compare(Buffer.from(a, 'latin1'), Buffer.from(b, 'latin1')));
  if (parse.files.length !== interesting.length) {
    throw new ReplayError(`combined diff has ${parse.files.length} sections, expected ${interesting.length} (${interesting.join(', ')})`);
  }
  parse.files.forEach((f, i) => {
    if (f.kind !== 'combined') throw new ReplayError(`section ${i + 1}: expected a combined section, got ${f.kind}`);
    const key = interesting[i];
    if (f.combinedPath.toString('latin1') !== key) throw new ReplayError(`section ${i + 1}: path ${show(f.combinedPath)} != ${key}`);
    if (f.binary) return;
    const body = (e) => (e ? (e.mode === MODE.GITLINK ? Buffer.from(`Subproject commit ${e.content.toString('latin1')}\n`) : e.content) : Buffer.alloc(0));
    verifyCombinedSection(f, body(result.get(key)), pmaps.map((m) => body(m.get(key))));
  });
  const display = argv.map((a) => {
    let s = a;
    commits.forEach((c, i) => {
      s = s.split(c).join(`<state${i}>`);
    });
    return s;
  });
  return {
    diff: res.stdout,
    parse,
    prefixes: prefixesOf(p),
    command: { tool: 'git', version: toolVersions().git, argv: ['git', ...display], config },
  };
}

/**
 * Produce and verify one scenario. Returns { diff: Buffer, vector: object }
 * where `vector` is the JSON document stored next to the diff in the corpus.
 */
export function produce(repo, scenario, tag) {
  const p = scenario.producer;
  let out;
  if (p.kind === 'gnu-diff') out = produceGnu(repo.dir, scenario, tag);
  else if (p.kind === 'git-merge') out = produceMerge(repo, scenario, tag);
  else out = produceGit(repo, scenario, tag);

  for (const text of scenario.mustContain ?? []) {
    if (!out.diff.includes(Buffer.from(text, 'utf8'))) {
      throw new ReplayError(`the diff does not contain ${JSON.stringify(text)}, which the scenario promises`);
    }
  }
  const files = out.parse.files.map((f) => fileToJson(f, out.prefixes));
  const nameFields = ['old_name', 'new_name', 'old_path', 'new_path', 'path'];
  const vector = {
    id: scenario.id,
    title: scenario.title,
    description: scenario.description ?? null,
    tier: scenario.tier,
    tags: scenario.tags ?? [],
    producer: out.command,
    prefixes: { old: bytesToJson(out.prefixes.src), new: bytesToJson(out.prefixes.dst) },
    // How this vector's expectations were established (see README, "Why trust the expectations").
    verified: {
      replay: true,
      git_raw_numstat: p.kind !== 'gnu-diff' && p.kind !== 'git-merge',
      git_apply_numstat: out.gitApply === 'agrees',
      // Set when `git apply` itself fails on this output of git.
      ...(out.gitApply?.rejected ? { git_apply_error: out.gitApply.rejected } : {}),
    },
    // Can a text-based (string) API represent this vector at all?
    text: {
      diff_is_utf8: isUtf8(out.diff),
      names_are_utf8: files.every((f) => nameFields.every((k) => f[k] === undefined || f[k] === null || typeof f[k] === 'string')),
      // Can the repository paths be worked out from the text alone, without being told the prefixes?
      paths_inferable: out.parse.files.every((f, i) => {
        if (f.kind === 'combined') return true;
        const guess = fileToJson(f);
        return JSON.stringify([guess.old_path, guess.new_path]) === JSON.stringify([files[i].old_path, files[i].new_path]);
      }),
    },
    expected: { files },
    // Is the diff a patch from one of the recorded trees to another, and if so from which to which?
    apply: null,
    recipe: {
      kind: p.kind,
      args: p.args ?? [],
      ...(p.config ? { config: p.config } : {}),
      ...(p.from !== undefined ? { from: p.from } : {}),
      ...(p.to !== undefined ? { to: p.to } : {}),
      ...(p.prefixes ? { prefixes: p.prefixes } : {}),
      ...(p.dirs ? { dirs: p.dirs } : {}),
      ...(p.file ? { file: p.file } : {}),
      ...(p.relative ? { relative: p.relative } : {}),
      ...(p.gitApply !== undefined ? { gitApply: p.gitApply } : {}),
      ...(p.env ? { env: p.env } : {}),
      ...(p.command ? { command: p.command } : {}),
      ...(p.merge !== undefined ? { merge: p.merge } : {}),
      ...(p.truthArgs ? { truthArgs: p.truthArgs } : {}),
      ...(scenario.parents ? { parents: scenario.parents } : {}),
      states: scenario.states.map((s, i) => stateToJson(s, i)),
    },
  };
  vector.apply = applyInfo(vector);
  return { diff: out.diff, vector, parse: out.parse, prefixes: out.prefixes };
}

export { gitEnv, fileToJson };
