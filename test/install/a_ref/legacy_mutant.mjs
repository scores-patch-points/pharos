// Wraps the frozen baseline bin and changes one thing, to prove the I9 differential check can see it.
// REF_LEGACY=extra-line  -> fold prints an extra line;  REF_LEGACY=exit -> status exits 3;  REF_LEGACY=file -> init also writes a stray file.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const base = process.env.A_BASELINE_BIN;
const args = process.argv.slice(2);
const r = spawnSync(process.execPath, [base, ...args], { encoding: 'utf8', env: process.env });
process.stdout.write(r.stdout); process.stderr.write(r.stderr);
const m = process.env.REF_LEGACY;
if (m === 'extra-line' && args[0] === 'fold') process.stdout.write('EXTRA\n');
if (m === 'file' && args[0] === 'init') fs.writeFileSync(path.join(process.cwd(), 'stray.txt'), 'x');
process.exit(m === 'exit' && args[0] === 'status' ? 3 : r.status);
