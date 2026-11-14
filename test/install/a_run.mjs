// How to run (from the pharos dir):  node test/install/a_run.mjs validate | installer | all | clean
//   validate   rig + checks against the reference CLI and planted mutants (safe, never touches the installer)
//   installer  a_I1..a_I9 against bin/pharos.mjs and doors/ (sets PHAROS_A_RUN=1; only when told to)
//   clean      delete sandbox/a-* run dirs (not the frozen baseline)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HERE, PHAROS_DIR, SANDBOX_ROOT } from './a_rig.mjs';

const mode = process.argv[2] || 'validate';
const files = { validate: ['a_rig.validate.test.mjs'], installer: ['a_I1', 'a_I2', 'a_I3', 'a_I4', 'a_I9'].map((n) => `${n}.test.mjs`) };
files.all = [...files.validate, ...files.installer];
if (mode === 'clean') {
  for (const n of fs.readdirSync(SANDBOX_ROOT)) if (n.startsWith('a-')) fs.rmSync(path.join(SANDBOX_ROOT, n), { recursive: true, force: true });
  console.log('cleaned a-* run dirs'); process.exit(0);
}
if (!files[mode]) { console.error('usage: node test/install/a_run.mjs validate|installer|all|clean'); process.exit(2); }
const env = { ...process.env, ...(mode === 'validate' ? {} : { PHAROS_A_RUN: '1' }) };
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files[mode].map((f) => path.join('test/install', f))], { cwd: PHAROS_DIR, env, stdio: 'inherit' });
process.exit(r.status ?? 1);
