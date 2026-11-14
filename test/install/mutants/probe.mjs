// Activation probe (test author C). node probe.mjs <ID> <mutant-root> : runs one small scenario with the mutant, WITHOUT the sandbox
// write wall (guard:false: the rig's recording shims, jail HOME and jail target still apply; only jail paths are touched), and prints
// whether the mutant's hook fired (<ID>/fired.log). Env PHAROS_ROOT is set by the caller to the mutant root before this file loads.
import fs from 'node:fs';
import path from 'node:path';
const [id, root] = process.argv.slice(2);
const { mk, exec, T, applyAll, FAKEHOME, fs: _fs } = await import('../c_lib.mjs');
const logf = path.join(root, '..', 'fired.log');
fs.rmSync(logf, { force: true });
const O = { guard: false };
const run = await mk('probe' + id, { fixture: 'populated', stateMode: 'external', ...O });
let note = '';
try {
  const target = run.target;
  switch (id) {
    case 'M1': await exec(run, ['install', 'agents-md', ...T(run)]); break;
    case 'M2': await applyAll(run); await exec(run, ['undo-door', 'all', ...T(run)]); break;
    case 'M3': case 'M6': case 'Q1': case 'Q4': case 'Q7': await applyAll(run); if (id === 'Q4') await exec(run, ['undo-door', 'all', ...T(run)]); break;
    case 'M4': await applyAll(run); await applyAll(run); break;
    case 'M5': { const link = path.join(run.jail, 'linkdir'); fs.symlinkSync(run.outside, link); await exec(run, ['install', 'agents-md', '--target', link, ...run.stateArgs()]); break; }
    case 'M7': await exec(run, ['install', 'reader-stack', ...T(run), '--khora-dir', run.khoraDir, '--apply']); break;
    case 'Q2': await applyAll(run); fs.appendFileSync(path.join(target, 'pharos.json'), '\n'); await exec(run, ['undo-door', 'all', ...T(run)]); break;
    case 'Q3': fs.mkdirSync(path.join(run.stateDir, 'backups'), { recursive: true }); fs.writeFileSync(path.join(run.stateDir, 'backups', 'user.txt'), 'u\n'); await applyAll(run); await exec(run, ['undo-door', 'all', ...T(run)]); break;
    case 'Q5': {
      // find the rename of AGENTS.md in a counting run, then plant a symlink right before it
      const { FI } = await import('../c_lib.mjs');
      const log = path.join(run.dir, 'fi.json');
      const probe0 = await mk('probeQ5c', { fixture: 'populated', stateMode: 'external', ...O });
      let k = 0;
      try { await applyAll(probe0, { preload: [FI], env: { FI_MODE: 'count', FI_LOG: log } }); const tr = JSON.parse(fs.readFileSync(log, 'utf8')).trace; const hit = tr.find((x) => /renameSync .*-> .*AGENTS\.md$/.test(x)); k = hit ? Number(hit.split(' ')[0]) : 0; } finally { probe0.close(); }
      const v = path.join(run.outside, 'v.txt'); fs.writeFileSync(v, 'v\n');
      k = Math.max(1, k - 3);
      await applyAll(run, { preload: [FI], env: { FI_MODE: 'plant', FI_K: String(k), FI_LOG: path.join(run.dir, 'fi2.json'), FI_PLANT: JSON.stringify([{ path: path.join(target, 'AGENTS.md'), victim: v }]) } });
      note = `plant before call ${k}; victim now ${JSON.stringify(fs.readFileSync(v, 'utf8').slice(0, 20))}`;
      break;
    }
    case 'Q6': await exec(run, ['install', 'all', ...T(run)]); break;
    case 'M8': case 'M9': {
      const a = fs.readFileSync(path.join(root, 'tools', 'public-scan.mjs'), 'utf8');
      const b = fs.readFileSync(path.join(process.env.PHAROS_REAL_ROOT, 'tools', 'public-scan.mjs'), 'utf8');
      note = a !== b ? 'source differs from the real tree' : '';
      if (note) fs.appendFileSync(logf, `${id} source-edit\n`);
      break;
    }
    default: throw new Error(`no probe for ${id}`);
  }
} finally { run.close(); }
const fired = fs.existsSync(logf) ? fs.readFileSync(logf, 'utf8').split('\n').filter(Boolean) : [];
console.log(JSON.stringify({ id, fired: fired.length > 0, hits: fired.length, sample: fired.slice(0, 2), note }));
process.exit(0);
