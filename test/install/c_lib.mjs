// Test author C (A1): helpers on top of the a_ rig. Black box: nothing here reads install/ or doors/ code.
// The tree under test is env PHAROS_ROOT (default: this tree); every run is a sandboxed rig run (see a_rig.mjs).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  makeRun, GUARD_AVAILABLE, hashTree, diffTrees, fmtDiff, region, REAL_HOME, sha256, PHAROS_DIR, DEFAULT_BIN, DEFAULT_DOORS, SANDBOX_ROOT, HERE,
} from './a_rig.mjs';

export { GUARD_AVAILABLE, hashTree, diffTrees, fmtDiff, region, REAL_HOME, sha256, DEFAULT_BIN, DEFAULT_DOORS, SANDBOX_ROOT, HERE, fs, path, crypto, spawnSync };
export const ROOT = PHAROS_DIR;
export const skip = process.env.PHAROS_A_RUN === '1' ? false : 'not run: set PHAROS_A_RUN=1 (waiting to be told)';
export const here = (n) => path.join(HERE, n);
export const FI = here('c_fault_preload.mjs');
export const FAKEHOME = here('c_fakehome_preload.mjs');
export const GH_SHIM = here('c_gh_shim.mjs');
export const SCRATCH = process.env.PHAROS_SCRATCH || path.resolve(HERE, '..', '..', '..', 'ledgers', 'pharos-public', 'scratch');
export const mkScratch = (tag) => { fs.mkdirSync(SCRATCH, { recursive: true }); return fs.mkdtempSync(path.join(SCRATCH, `c-${tag}-`)); };
export const TARGET_FILES = ['AGENTS.md', 'CLAUDE.md', 'pharos.json', 'holon.json'];
export const DOOR_FILES = { 'agents-md': ['AGENTS.md', 'CLAUDE.md'], 'pharos-core': ['pharos.json', 'holon.json'] };
export const MARK_BEGIN = '<!-- pharos:begin agents-md v1 -->';
export const MARK_END = '<!-- pharos:end agents-md -->';

export const mk = (label, o = {}) => makeRun({ label, ...o });
export const nodeFlags = (pre = []) => ['--no-warnings', ...pre.flatMap((p) => ['--import', p])];
export const exec = (run, args, o = {}) => run.node([...nodeFlags(o.preload), run.bin, ...args], { env: o.env, timeoutMs: o.timeoutMs, cwd: o.cwd });
export const T = (run) => ['--target', run.target, ...run.stateArgs()];
export const applyAll = (run, o) => exec(run, ['install', 'all', ...T(run), '--apply'], o);
export const jparse = (res) => { try { return JSON.parse(res.stdout); } catch { return null; } };
export const errJson = (res) => { try { return JSON.parse(res.stderr.trim().split('\n').filter((l) => l.startsWith('{')).pop()); } catch { return null; } };
export const stateDirOf = (run) => (run.stateMode === 'external' ? run.stateDir : path.join(run.target, '.pharos'));
export const journalOf = (run) => path.join(stateDirOf(run), 'journal.jsonl');
export const show = (v) => '\n  ' + v.join('\n  ');
export const read = (p) => { try { return fs.readFileSync(p); } catch { return null; } };
export const eqBuf = (a, b) => (a === null || b === null ? a === b : Buffer.compare(a, b) === 0);

export async function statusOf(run, door = 'all', o) {
  const res = await exec(run, ['status', door, ...T(run)], o);
  const j = jparse(res);
  const by = {};
  for (const d of j?.doors || []) by[d.door] = d.status;
  return { res, json: j, by, text: res.stdout };
}

// state-dir-aware tree comparison: hard regions vs the state dir (reported, not asserted, unless strict)
export function diffJail(run, a, b, { strict = false } = {}) {
  const d = diffTrees(a, b);
  const rel = path.relative(run.jail, stateDirOf(run));
  const inState = (x) => x.path === rel || x.path.startsWith(rel + '/');
  const hard = d.filter((x) => strict || !inState(x));
  const soft = d.filter((x) => !strict && inState(x));
  return { hard, soft, all: d };
}

export function targetBytes(run) { const o = {}; for (const f of TARGET_FILES) o[f] = read(path.join(run.target, f)); return o; }

// bytes a complete clean install produces for a fixture (paths inside do not depend on the run id)
const completeCache = new Map();
export async function completeBytes(fixture, stateMode) {
  const key = `${fixture}/${stateMode}`;
  if (completeCache.has(key)) return completeCache.get(key);
  const run = await mk('Ccomplete', { fixture, stateMode });
  try {
    const orig = targetBytes(run);
    const r = await applyAll(run);
    const out = { exit: r.code, orig, complete: targetBytes(run), tree: hashTree(run.jail) };
    completeCache.set(key, out);
    return out;
  } finally { run.close(); }
}

// ---- journal: the file is an exported artifact (README: .pharos/journal.jsonl, hash chained). prev = sha256 of the previous line.
export const lines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
export const ZERO = '0'.repeat(64);
export function audit(f) {
  const L = lines(f); const problems = [];
  L.forEach((l, i) => {
    let e; try { e = JSON.parse(l); } catch { problems.push(`line ${i + 1} does not parse`); return; }
    if (e.seq !== i) problems.push(`line ${i + 1} has seq ${e.seq}`);
    const want = i === 0 ? ZERO : sha256(L[i - 1]);
    if (e.prev !== want) problems.push(`line ${i + 1} prev does not match the previous line`);
  });
  return { n: L.length, problems };
}
export function rechain(L) {
  const out = [];
  L.forEach((l, i) => { const e = JSON.parse(l); e.prev = i === 0 ? ZERO : sha256(out[i - 1]); out.push(JSON.stringify(e)); });
  return out;
}
export const writeLines = (f, L) => fs.writeFileSync(f, L.join('\n') + '\n');

// ---- shell-style splitting for README commands (double and single quotes, backslash escapes, trailing # comment)
export function shellSplit(line) {
  const out = []; let cur = ''; let q = null; let any = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; else if (c === '\\' && q === '"' && i + 1 < line.length) cur += line[++i]; else cur += c; continue; }
    if (c === '"' || c === "'") { q = c; any = true; continue; }
    if (c === '\\' && i + 1 < line.length) { cur += line[++i]; any = true; continue; }
    if (c === '#' && !any && cur === '') break;
    if (/\s/.test(c)) { if (cur !== '' || any) { out.push(cur); cur = ''; any = false; } continue; }
    cur += c; any = true;
  }
  if (q) throw new Error(`unterminated quote in: ${line}`);
  if (cur !== '' || any) out.push(cur);
  return out;
}

export const mkfifo = (p) => spawnSync('/usr/bin/mkfifo', [p]).status === 0;
