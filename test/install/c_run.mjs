// How to run the A1 tests (from the pharos dir):  node test/install/c_run.mjs fast | all | mutants | clean
//   fast     tree and text checks that need no sandbox (I7 tree/fetch/licence, README text)         (network for gh api)
//   all      every c_ test with PHAROS_A_RUN=1 (kill and race sweeps included; about 10 minutes; PHAROS_C_STEP=n samples)
//   mutants  node test/install/mutants/run_mutants.mjs baseline, then run   (copies only; see c_EXPECTED.md)
// Env PHAROS_ROOT points every test at another copy of the tree (the mutant runner uses this).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(HERE, '..', '..');
const mode = process.argv[2] || 'fast';
const files = ['c_I7', 'c_D1', 'c_D2', 'c_D3', 'c_D4', 'c_D5', 'c_D6', 'c_D7', 'c_README', 'c_I8'].map((f) => path.join(HERE, `${f}.test.mjs`));
if (mode === 'mutants') { for (const a of ['baseline', 'run']) { const r = spawnSync(process.execPath, [path.join(HERE, 'mutants', 'run_mutants.mjs'), a], { stdio: 'inherit', cwd: ROOT }); if (r.status) process.exit(r.status); } process.exit(0); }
if (!['fast', 'all'].includes(mode)) { console.error('usage: node test/install/c_run.mjs fast|all|mutants'); process.exit(2); }
const env = { ...process.env, ...(mode === 'all' ? { PHAROS_A_RUN: '1' } : {}) };
process.exit(spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { cwd: ROOT, env, stdio: 'inherit' }).status ?? 1);
