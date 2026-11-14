// Mutant runner (test author C, A1). Copies only: every mutant lives under ledgers/pharos-public/scratch/mutants/<ID>/pharos and the
// tests take the tree under test from env PHAROS_ROOT. For each mutant: (1) make the copy, (2) probe that its hook fires (a mutant
// that never fires is INERT, not "survived"), (3) run the mapped test files on it, (4) compare with the same files on a CLEAN copy:
// CAUGHT = at least one test that passes on the clean copy fails on the mutant (attributed by name). A test that already fails on the
// clean copy cannot attribute anything and is listed as masked.
//   node run_mutants.mjs baseline            run the mapped test files on the clean copy -> out/c-mutants-baseline.json
//   node run_mutants.mjs run [ID ...]        make + probe + run the mutants (default all), append to out/c-mutants.json
//   node run_mutants.mjs full [ID ...]       re-run SURVIVORS (or the given ids) against every c_/a_/b_i6 file
//   env PHAROS_C_STEP=n   sampling for the kill/race sweeps (default 3 here; 1 = every call)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { IDS, DESCR, makeMutant, makeClean, MUT_BASE, REAL_ROOT } from './make_mutants.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TESTDIR = path.resolve(HERE, '..');
const OUT = path.resolve(HERE, '..', '..', '..', '..', 'ledgers', 'pharos-public', 'out');
const MAP = {
  M1: ['a_I1'], M2: ['a_I3'], M3: ['a_I2'], M4: ['a_I3'], M5: ['a_I4'], M6: ['a_I2'], M7: ['a_I4', 'a_I2'], M8: ['b_i6'], M9: ['b_i6'],
  Q1: ['c_D1'], Q2: ['c_D2'], Q3: ['c_D3'], Q4: ['c_D4'], Q5: ['c_D5'], Q6: ['c_D6'], Q7: ['c_D7'],
};
const ALL_FILES = ['a_I1', 'a_I2', 'a_I3', 'a_I4', 'b_i6', 'c_D1', 'c_D2', 'c_D3', 'c_D4', 'c_D5', 'c_D6', 'c_D7', 'c_README', 'c_I7'];
const STEP = process.env.PHAROS_C_STEP || '3';

export function runFile(root, file) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', path.join(TESTDIR, `${file}.test.mjs`)], {
    env: { ...process.env, PHAROS_ROOT: root, PHAROS_REAL_ROOT: REAL_ROOT, PHAROS_A_RUN: '1', PHAROS_C_STEP: STEP }, encoding: 'utf8', maxBuffer: 512 << 20, timeout: 3 * 3600 * 1000,
  });
  const res = {};
  for (const l of (r.stdout || '').split('\n')) { const m = /^\s*(not )?ok \d+ - (.+?)(?: # (?:SKIP|skip).*)?$/.exec(l); if (m && !/\.mjs$/.test(m[2]) && !/# SKIP/i.test(l)) res[m[2]] = !m[1]; }
  return { file, tests: res, seconds: Math.round((Date.now() - t0) / 1000), status: r.status };
}
const load = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {});
const save = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 1)); };
const BASE = path.join(OUT, 'c-mutants-baseline.json');
const RES = path.join(OUT, 'c-mutants.json');

function baseline(files) {
  const clean = makeClean(); const b = load(BASE); b.step = STEP; b.files ||= {};
  for (const f of files) { if (b.files[f]) continue; const r = runFile(clean.root, f); b.files[f] = r; save(BASE, b); console.log(`baseline ${f}: ${Object.keys(r.tests).length} tests, ${Object.values(r.tests).filter((x) => !x).length} failing, ${r.seconds}s`); }
  return b;
}
function probe(id, root) {
  const r = spawnSync(process.execPath, [path.join(HERE, 'probe.mjs'), id, root], { env: { ...process.env, PHAROS_ROOT: root, PHAROS_REAL_ROOT: REAL_ROOT }, encoding: 'utf8', timeout: 120000 });
  try { return JSON.parse(r.stdout.trim().split('\n').pop()); } catch { return { id, fired: false, error: (r.stderr || r.stdout || '').slice(0, 300) }; }
}
function judge(id, root, files, b) {
  const caught = []; const masked = []; const ran = {};
  for (const f of files) {
    if (!b.files?.[f]) throw new Error(`no baseline for ${f}: run "baseline" first`);
    const r = runFile(root, f); ran[f] = { tests: Object.keys(r.tests).length, failing: Object.values(r.tests).filter((x) => !x).length, seconds: r.seconds };
    for (const [name, ok] of Object.entries(r.tests)) {
      if (ok) continue;
      if (b.files[f].tests[name] === true) caught.push(`${f}: ${name}`); else masked.push(`${f}: ${name}`);
    }
  }
  return { caught, masked, ran };
}

const [cmd = 'run', ...rest] = process.argv.slice(2);
if (cmd === 'baseline') { baseline([...new Set(Object.values(MAP).flat())]); process.exit(0); }
const ids = rest.length ? rest : IDS;
const res = load(RES);
const b = load(BASE);
if (cmd === 'run') {
  for (const id of ids) {
    const meta = makeMutant(id); const pr = probe(id, meta.root);
    const row = { id, description: DESCR[id], kind: meta.kind, fired: pr.fired, probe: pr, mapped: MAP[id] };
    if (!pr.fired) { row.verdict = 'INERT'; }
    else { const j = judge(id, meta.root, MAP[id], b); Object.assign(row, j); row.verdict = j.caught.length ? 'CAUGHT' : 'SURVIVED'; }
    res[id] = row; save(RES, res);
    console.log(`${id}: ${row.verdict}${row.caught?.length ? ` by ${row.caught.length} test(s), e.g. ${row.caught[0].slice(0, 110)}` : ''}${row.masked?.length ? ` [masked ${row.masked.length}]` : ''}`);
  }
}
if (cmd === 'full') {
  for (const id of (rest.length ? rest : IDS.filter((i) => res[i]?.verdict === 'SURVIVED'))) {
    const meta = makeMutant(id); const files = ALL_FILES.filter((f) => !(res[id]?.mapped || []).includes(f));
    for (const f of files) if (!b.files?.[f]) { const r = runFile(makeClean().root, f); b.files ||= {}; b.files[f] = r; save(BASE, b); }
    const j = judge(id, meta.root, files, load(BASE));
    res[id] = { ...res[id], full: j, verdict: j.caught.length ? 'CAUGHT (full suite)' : 'SURVIVED (full suite)' }; save(RES, res);
    console.log(`${id}: ${res[id].verdict}${j.caught.length ? ` e.g. ${j.caught[0].slice(0, 110)}` : ''}`);
  }
}
const rows = IDS.filter((i) => res[i]).map((i) => `${i}\t${res[i].verdict}`);
console.log('\n' + rows.join('\n'));
