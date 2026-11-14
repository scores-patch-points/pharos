// D7 a lock prevents concurrent installs from corrupting the journal (A1). Skipped unless PHAROS_A_RUN=1.
// Parallel runs are slowed by c_fault_preload (sleep before each mutating fs call) so they really overlap.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  skip, mk, exec, T, applyAll, jparse, statusOf, hashTree, diffJail, stateDirOf, journalOf, audit, show, read, targetBytes, FI, MARK_BEGIN, fs, path,
} from './c_lib.mjs';

const SLOW = { preload: [FI], env: { FI_MODE: 'slow', FI_SLOW_MS: '40' } };
const blocks = (b) => (b ? b.toString().split(MARK_BEGIN).length - 1 : 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function finalChecks(run, before, v, tag) {
  const a = audit(journalOf(run));
  if (a.problems.length) v.push(`${tag}: journal audit: ${a.problems.slice(0, 4).join('; ')}`);
  const b = targetBytes(run);
  if (blocks(b['AGENTS.md']) !== 1) v.push(`${tag}: AGENTS.md holds ${blocks(b['AGENTS.md'])} pharos block(s), expected exactly 1`);
  try { JSON.parse(b['pharos.json'].toString()); JSON.parse(b['holon.json'].toString()); } catch { v.push(`${tag}: pharos.json or holon.json does not parse`); }
  if (fs.existsSync(path.join(stateDirOf(run), 'lock'))) v.push(`${tag}: a lock file remains after every run finished`);
  const ver = await exec(run, ['verify', 'all', ...T(run)]);
  if (ver.code !== 0) v.push(`${tag}: verify all exited ${ver.code}`);
  const st = await statusOf(run);
  if (!Object.values(st.by).every((s) => s === 'installed')) v.push(`${tag}: status ${JSON.stringify(st.by)}`);
  const u = await exec(run, ['undo-door', 'all', ...T(run)]);
  const d = diffJail(run, before, hashTree(run.jail));
  if (u.code !== 0 || d.hard.length) v.push(`${tag}: undo: exit ${u.code}, tree differences ${d.hard.slice(0, 4).map((x) => `${x.kind} ${x.path}`).join('; ')}`);
}

for (const [fixture, stateMode] of [['populated', 'external'], ['bare', 'default'], ['agents-nonl', 'default'], ['claude-only', 'external']]) {
  test(`D7 six parallel install all --apply (${fixture}, ${stateMode} state): exits 0 or LOCKED, clean journal, one block, verify ok, exact undo`, { skip, timeout: 600000 }, async (t) => {
    const v = []; const exitsAll = {};
    for (let round = 1; round <= 3; round++) {
      const run = await mk('D7', { fixture, stateMode });
      try {
        const before = hashTree(run.jail);
        const rs = await Promise.all([1, 2, 3, 4, 5, 6].map(() => applyAll(run, SLOW)));
        for (const r of rs) {
          exitsAll[r.code] = (exitsAll[r.code] || 0) + 1;
          if (![0, 1].includes(r.code)) v.push(`round ${round}: a process exited ${r.code}: ${r.out.slice(0, 160).replace(/\n/g, ' ')}`);
          if (r.code === 1 && !/LOCKED/.test(r.out)) v.push(`round ${round}: a process exited 1 without LOCKED: ${r.out.slice(0, 160).replace(/\n/g, ' ')}`);
          if (r.timedOut) v.push(`round ${round}: a process timed out`);
        }
        if (!rs.some((r) => r.code === 0)) v.push(`round ${round}: no process succeeded`);
        await finalChecks(run, before, v, `round ${round}`);
      } finally { run.close(); }
    }
    t.diagnostic(`exit codes over 18 processes: ${JSON.stringify(exitsAll)}`);
    assert.deepEqual(v.slice(0, 20), [], `${v.length} violation(s):` + show(v.slice(0, 20)));
  });
}

test('D7 while one run holds the lock the lock file exists and a second run does not interleave with it', { skip, timeout: 120000 }, async () => {
  const run = await mk('D7h', { fixture: 'populated', stateMode: 'default' });
  try {
    const before = hashTree(run.jail); const hold = path.join(run.dir, 'hold.txt'); const v = [];
    const A = applyAll(run, { preload: [FI], env: { FI_MODE: 'holdlock', FI_K: '12', FI_HOLD_MS: '3000', FI_HOLD_FILE: hold } });
    let waited = 0; while (!fs.existsSync(hold) && waited < 8000) { await sleep(50); waited += 50; }
    assert.ok(fs.existsSync(hold), 'the first run never reached the hold point');
    const tHold = Date.now();
    if (!fs.existsSync(path.join(stateDirOf(run), 'lock'))) v.push('no lock file exists while a run is active (README: .pharos/lock is present while a run is active)');
    const B = await applyAll(run, { timeoutMs: 60000 });
    const tB = Date.now() - tHold;
    const a = await A;
    if (B.code === 0 && tB < 2200) v.push(`the second run finished (exit 0) ${tB} ms after the first run froze holding the lock, i.e. it did not wait for it`);
    if (![0, 1].includes(B.code)) v.push(`second run exit ${B.code}`);
    if (B.code === 1 && !/LOCKED/.test(B.out)) v.push('second run exit 1 without LOCKED');
    if (a.code !== 0) v.push(`the first run exited ${a.code}: ${a.out.slice(0, 200).replace(/\n/g, ' ')}`);
    await finalChecks(run, before, v, 'hold');
    assert.deepEqual(v, [], show(v));
  } finally { run.close(); }
});

for (const k of [3, 8, 20]) {
  test(`D7 a lock left by a SIGKILLed run (kill at call ${k}) is taken over: the next apply exits 0 and verifies`, { skip, timeout: 120000 }, async (t) => {
    const run = await mk('D7s', { fixture: 'populated', stateMode: 'external' });
    try {
      const before = hashTree(run.jail); const v = [];
      const killed = await applyAll(run, { preload: [FI], env: { FI_MODE: 'kill', FI_K: String(k), FI_LOG: path.join(run.dir, 'fi.json') } });
      assert.equal(killed.signal, 'SIGKILL');
      const left = fs.existsSync(path.join(stateDirOf(run), 'lock'));
      t.diagnostic(`lock file left behind by the killed run: ${left}`);
      const t0 = Date.now();
      const r = await applyAll(run, { timeoutMs: 60000 });
      t.diagnostic(`next apply took ${Date.now() - t0} ms, exit ${r.code}`);
      if (r.code !== 0) v.push(`the next apply after a SIGKILLed run exited ${r.code}: ${r.out.slice(0, 200).replace(/\n/g, ' ')}`);
      if (left && Date.now() - t0 > 15000) v.push('taking over the stale lock took more than 15 s');
      await finalChecks(run, before, v, 'stale');
      assert.deepEqual(v, [], show(v));
    } finally { run.close(); }
  });
}
