// D5 no-follow writes, symlink race (A1). Skipped unless PHAROS_A_RUN=1. PHAROS_C_STEP=n samples every n-th k.
// Race: before the k-th mutating fs call of `install all --apply` a same-user attacker removes the destination and puts a symlink to an
// outside victim file there. The victim must come out byte-identical, for every k, for each destination, absent and existing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { skip, mk, exec, T, applyAll, hashTree, diffTrees, show, read, mkfifo, FI, stateDirOf, fs, path } from './c_lib.mjs';

const STEP = Number(process.env.PHAROS_C_STEP || 1);
const VICTIM = 'victim original\n';
const NAMES = ['AGENTS.md', 'pharos.json', 'holon.json'];

async function count(fixture) {
  const run = await mk('D5c', { fixture, stateMode: 'external' });
  try {
    const log = path.join(run.dir, 'fi.json');
    await applyAll(run, { preload: [FI], env: { FI_MODE: 'count', FI_LOG: log } });
    return JSON.parse(fs.readFileSync(log, 'utf8')).count;
  } finally { run.close(); }
}
const victimOf = (run) => { const p = path.join(run.outside, 'victim.txt'); fs.writeFileSync(p, VICTIM); return p; };

for (const fixture of ['bare', 'populated']) {
  for (const name of NAMES) {
    test(`D5 race: symlink planted at ${name} before every mutating call (${fixture} target): the outside victim is never written`, { skip, timeout: 3600000 }, async (t) => {
      const N = await count(fixture);
      assert.ok(N >= 6, `count preload saw ${N} calls`);
      const v = []; let planted = 0; let ran = 0; const exits = {};
      for (let k = 1; k <= N; k += STEP) {
        const run = await mk('D5k', { fixture, stateMode: 'external' });
        try {
          const victim = victimOf(run);
          const outsideBefore = hashTree(run.outside);
          const log = path.join(run.dir, 'fi.json');
          const dest = path.join(run.target, name);
          const res = await applyAll(run, { preload: [FI], env: { FI_MODE: 'plant', FI_K: String(k), FI_LOG: log, FI_PLANT: JSON.stringify([{ path: dest, victim }]) } });
          ran++; exits[res.code] = (exits[res.code] || 0) + 1;
          const tr = read(`${log}.trace`)?.toString() ?? '';
          if (/planted /.test(tr)) planted++;
          const now = fs.readFileSync(victim, 'utf8');
          if (now !== VICTIM) v.push(`k=${k}/${N}: the installer wrote through the planted symlink: victim now ${JSON.stringify(now.slice(0, 80))}`);
          const od = diffTrees(outsideBefore, hashTree(run.outside));
          if (od.length && now === VICTIM) v.push(`k=${k}/${N}: outside tree changed: ${od.map((x) => x.path).join(', ')}`);
          if (res.denied) v.push(`k=${k}/${N}: sandbox denied a write outside the run dir`);
        } finally { run.close(); }
      }
      t.diagnostic(`${fixture}/${name}: ${ran} runs, symlink planted in ${planted}, exit codes ${JSON.stringify(exits)}`);
      assert.ok(planted > 0, 'the plant hook never fired (harness inert)');
      assert.deepEqual(v.slice(0, 20), [], `${v.length} violation(s):` + show(v.slice(0, 20)));
    });
  }
}

test('D5 a symlink already at AGENTS.md, pharos.json and holon.json (pointing outside) is not written through', { skip }, async () => {
  const run = await mk('D5s', { fixture: 'bare', stateMode: 'external' });
  try {
    const vs = NAMES.map((n) => { const p = path.join(run.outside, `victim-${n}`); fs.writeFileSync(p, VICTIM); fs.symlinkSync(p, path.join(run.target, n)); return p; });
    const res = await applyAll(run);
    const v = [];
    vs.forEach((p, i) => { if (fs.readFileSync(p, 'utf8') !== VICTIM) v.push(`victim for ${NAMES[i]} was written through the symlink (exit ${res.code})`); });
    assert.deepEqual(v, [], show(v));
  } finally { run.close(); }
});

test('D5 a symlink at the journal and at the lock path (pointing outside) is not written through', { skip }, async () => {
  const run = await mk('D5j', { fixture: 'populated', stateMode: 'external' });
  try {
    fs.mkdirSync(run.stateDir, { recursive: true });
    const vj = path.join(run.outside, 'victim-journal'); const vl = path.join(run.outside, 'victim-lock');
    fs.writeFileSync(vj, VICTIM); fs.writeFileSync(vl, VICTIM);
    fs.symlinkSync(vj, path.join(run.stateDir, 'journal.jsonl')); fs.symlinkSync(vl, path.join(run.stateDir, 'lock'));
    const res = await applyAll(run);
    const v = [];
    if (fs.readFileSync(vj, 'utf8') !== VICTIM) v.push(`the journal symlink was followed: victim now ${JSON.stringify(fs.readFileSync(vj, 'utf8').slice(0, 60))} (exit ${res.code})`);
    if (fs.readFileSync(vl, 'utf8') !== VICTIM) v.push(`the lock symlink was followed: victim now ${JSON.stringify(fs.readFileSync(vl, 'utf8').slice(0, 60))} (exit ${res.code})`);
    assert.deepEqual(v, [], show(v));
  } finally { run.close(); }
});

test('D5 a hard link from an outside file to AGENTS.md: an in-place write would change the other name; the installer replaces, it does not rewrite in place', { skip }, async () => {
  const run = await mk('D5h', { fixture: 'populated', stateMode: 'external' });
  try {
    const hl = path.join(run.outside, 'hardlink-of-agents.txt');
    fs.linkSync(path.join(run.target, 'AGENTS.md'), hl);
    const orig = fs.readFileSync(hl, 'utf8');
    const res = await applyAll(run);
    assert.equal(res.code, 0, res.out.slice(0, 200));
    assert.equal(fs.readFileSync(hl, 'utf8'), orig, 'the outside name of the hard link changed: the file was rewritten in place');
    assert.ok(fs.readFileSync(path.join(run.target, 'AGENTS.md'), 'utf8').includes('pharos:begin'), 'AGENTS.md has the block');
  } finally { run.close(); }
});

test('D5 a FIFO at AGENTS.md does not hang the installer and nothing outside is touched', { skip }, async () => {
  const run = await mk('D5f', { fixture: 'bare', stateMode: 'external' });
  try {
    assert.ok(mkfifo(path.join(run.target, 'AGENTS.md')), 'mkfifo');
    const before = hashTree(run.outside);
    const res = await exec(run, ['install', 'all', ...T(run), '--apply'], { timeoutMs: 20000 });
    assert.equal(res.timedOut, false, 'the installer blocked on the FIFO');
    assert.deepEqual(diffTrees(before, hashTree(run.outside)), []);
    assert.notEqual(res.code, null);
  } finally { run.close(); }
});

test('D5 a device-like or directory object at AGENTS.md is refused (a directory named AGENTS.md)', { skip }, async () => {
  const run = await mk('D5d', { fixture: 'bare', stateMode: 'external' });
  try {
    fs.mkdirSync(path.join(run.target, 'AGENTS.md'));
    const before = hashTree(run.target);
    const res = await exec(run, ['install', 'agents-md', ...T(run), '--apply'], { timeoutMs: 20000 });
    assert.equal(res.timedOut, false);
    assert.notEqual(res.code, 0, 'writing a block into a directory must not exit 0');
    assert.deepEqual(diffTrees(before, hashTree(run.target)), [], 'the directory was changed');
  } finally { run.close(); }
});
