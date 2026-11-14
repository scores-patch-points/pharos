// D1 kill -9 mid-write (A1). For every k up to N (the number of mutating fs calls in `install all --apply`) the process is
// SIGKILLed at the k-th call with that call's write cut to half. Afterwards: no torn destination file; honest status;
// undo restores the tree byte for byte (state dir leftovers are reported, not asserted); undo twice is a no-op; and a
// second apply after the kill finishes, verifies, and leaves status installed. The sweep runs once per scenario and each
// category below is its own test, so a mutant or a defect is attributed to the property it breaks.
// Skipped unless PHAROS_A_RUN=1. PHAROS_C_STEP=n samples every n-th k.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  skip, mk, exec, T, applyAll, jparse, statusOf, read, diffJail, targetBytes, completeBytes, eqBuf, hashTree, show, FI, TARGET_FILES, DOOR_FILES, fs, path,
} from './c_lib.mjs';

const STEP = Number(process.env.PHAROS_C_STEP || 1);
const SCEN = [
  { name: 'existing AGENTS.md, external state', fixture: 'populated', stateMode: 'external', branchB: true },
  { name: 'bare target, default in-target state', fixture: 'bare', stateMode: 'default', branchB: false },
];
const CATS = [
  ['harness', 'the kill landed at every k (the harness is not inert)'],
  ['torn', 'no destination file is ever torn: it is the original bytes or the complete new bytes'],
  ['status', 'status after a kill is honest (not-installed means unchanged, installed means complete, never drifted or journal-invalid, partial names the files)'],
  ['undo', 'undo-door after a kill exits 0 and restores home and target byte for byte'],
  ['undo2', 'a second undo-door is a no-op'],
  ['reapply', 'a second apply after the kill exits 0, verifies, leaves status installed, and undo is exact'],
];
const fmtShort = (d) => d.slice(0, 5).map((x) => `${x.kind} ${x.path}`).join('; ') + (d.length > 5 ? ` (+${d.length - 5})` : '');

async function counted(fixture, stateMode) {
  const run = await mk('D1c', { fixture, stateMode });
  try {
    const log = path.join(run.dir, 'fi.json');
    const res = await applyAll(run, { preload: [FI], env: { FI_MODE: 'count', FI_LOG: log } });
    const j = JSON.parse(fs.readFileSync(log, 'utf8'));
    return { exit: res.code, n: j.count, trace: j.trace };
  } finally { run.close(); }
}
function tornFiles(run, orig, complete) {
  const cur = targetBytes(run); const bad = [];
  for (const f of TARGET_FILES) if (!eqBuf(cur[f], orig[f]) && !eqBuf(cur[f], complete[f])) bad.push(`${f} is torn (${cur[f] === null ? 'absent' : cur[f].length + ' bytes'}; original ${orig[f] === null ? 'absent' : orig[f].length}, complete ${complete[f] === null ? 'absent' : complete[f].length})`);
  return bad;
}
async function killedRun(sc, k) {
  const run = await mk('D1k', sc);
  const orig = targetBytes(run); const before = hashTree(run.jail);
  const log = path.join(run.dir, 'fi.json');
  const killed = await applyAll(run, { preload: [FI], env: { FI_MODE: 'kill', FI_K: String(k), FI_LOG: log } });
  return { run, orig, before, killed };
}

async function sweep(sc) {
  const ref = await completeBytes(sc.fixture, sc.stateMode);
  const c = await counted(sc.fixture, sc.stateMode);
  const R = { ref, c, v: Object.fromEntries(CATS.map(([k]) => [k, []])), notes: [], soft: [], differs: new Set(), stats: { kills: 0, completed: 0, partial: 0, notInstalled: 0, installed: 0, ks: 0 } };
  const bad = (cat, tag, msg) => R.v[cat].push(`${tag}: ${msg}`);
  if (ref.exit !== 0) bad('harness', 'clean', `a clean apply exited ${ref.exit}`);
  if (c.exit !== 0 || c.n < 6) bad('harness', 'count', `counting run exit ${c.exit}, ${c.n} mutating calls seen (hook did not engage?)`);
  R.notes.push(`N = ${c.n} mutating calls; trace head: ${c.trace.slice(0, 6).join(' | ')}`);
  for (let k = 1; k <= c.n + 1; k += (k < c.n ? STEP : 1)) {
    R.stats.ks++; const tag = `k=${k}/${c.n}`;
    const { run, orig, before, killed } = await killedRun(sc, k);
    try {
      if (killed.signal === 'SIGKILL') R.stats.kills++; else if (k <= c.n) bad('harness', tag, `the process was not killed (exit ${killed.code})`); else R.stats.completed++;
      for (const x of tornFiles(run, orig, ref.complete)) bad('torn', tag, `after kill: ${x}`);
      const st = await statusOf(run); const cur = targetBytes(run);
      if (st.res.timedOut || st.res.code === null) bad('status', tag, 'status did not return');
      for (const [door, s] of Object.entries(st.by)) {
        if (!['not-installed', 'partial', 'installed'].includes(s)) bad('status', tag, `status says ${door}=${s} after a kill (expected not-installed, partial or installed)`);
        if (s === 'installed') for (const f of DOOR_FILES[door] || []) if (!eqBuf(cur[f], ref.complete[f])) bad('status', tag, `status says ${door}=installed but ${f} is not the complete install`);
        if (s === 'not-installed') for (const f of DOOR_FILES[door] || []) if (!eqBuf(cur[f], orig[f])) bad('status', tag, `status says ${door}=not-installed but ${f} changed from the original`);
        if (s === 'partial') R.stats.partial++; else if (s === 'installed') R.stats.installed++; else R.stats.notInstalled++;
      }
      for (const d of st.json?.doors || []) {
        if (d.status !== 'partial') continue;
        const it = d.interrupted || [];
        if (!it.length) bad('status', tag, `${d.door} is partial but lists no interrupted file`);
        for (const x of it) if (!/^(original|new content)/.test(String(x.now))) bad('status', tag, `${d.door} partial: ${x.path} described as "${x.now}"`);
      }
      const u1 = await exec(run, ['undo-door', 'all', ...T(run)]);
      if (u1.code !== 0) bad('undo', tag, `undo-door exited ${u1.code}: ${u1.out.slice(0, 160).replace(/\n/g, ' ')}`);
      const after1 = hashTree(run.jail); const d1 = diffJail(run, before, after1);
      if (d1.hard.length) bad('undo', tag, `after undo the tree differs from the start: ${fmtShort(d1.hard)}`);
      if (d1.soft.length) R.soft.push(`${tag}: ${d1.soft.length} state-dir leftover(s) after undo: ${d1.soft.map((x) => x.path).join(', ').slice(0, 140)}`);
      const u2 = await exec(run, ['undo-door', 'all', ...T(run)]);
      const d2 = diffJail(run, after1, hashTree(run.jail), { strict: true });
      if (u2.code !== 0 || d2.all.length) bad('undo2', tag, `second undo: exit ${u2.code}, ${d2.all.length} change(s) ${fmtShort(d2.all)}`);
    } finally { run.close(); }
    if (sc.branchB) {
      const kb = await killedRun(sc, k);
      try {
        const a2 = await applyAll(kb.run);
        if (a2.code !== 0) bad('reapply', tag, `a second apply after the kill exited ${a2.code}: ${a2.out.slice(0, 160).replace(/\n/g, ' ')}`);
        const ver = await exec(kb.run, ['verify', 'all', ...T(kb.run)]);
        if (ver.code !== 0) bad('reapply', tag, `verify after the re-apply exited ${ver.code}`);
        const st2 = await statusOf(kb.run);
        for (const [door, sv] of Object.entries(st2.by)) if (sv !== 'installed') bad('reapply', tag, `after a successful re-apply and a passing verify, status says ${door}=${sv}, expected installed`);
        const cur = targetBytes(kb.run);
        for (const f of ['AGENTS.md', 'CLAUDE.md', 'holon.json']) if (!eqBuf(cur[f], ref.complete[f])) bad('reapply', tag, `after the re-apply ${f} is not the complete install`);
        try { const pj = JSON.parse(cur['pharos.json'].toString()); if (pj.kind !== 'pharos-pointer') bad('reapply', tag, 'pharos.json is not a pointer'); if (!eqBuf(cur['pharos.json'], ref.complete['pharos.json'])) R.differs.add(`${tag}: pharos.json differs from a clean install (wrote=${JSON.stringify(pj.wrote)})`); } catch { bad('reapply', tag, 'pharos.json after the re-apply does not parse'); }
        const u = await exec(kb.run, ['undo-door', 'all', ...T(kb.run)]);
        const d = diffJail(kb.run, kb.before, hashTree(kb.run.jail));
        if (u.code !== 0 || d.hard.length) bad('reapply', tag, `undo after the re-apply: exit ${u.code}, differences ${fmtShort(d.hard)}`);
      } finally { kb.run.close(); }
    }
  }
  return R;
}

for (const sc of SCEN) {
  let cached = null; const get = () => (cached ||= sweep(sc));
  for (const [cat, what] of CATS) {
    test(`D1 ${cat} [${sc.name}]: ${what}`, { skip, timeout: 3600000 }, async (t) => {
      const R = await get();
      if (cat === 'harness') { t.diagnostic(R.notes[0]); t.diagnostic(`ks=${R.stats.ks} killed=${R.stats.kills} completed-before-kill=${R.stats.completed}; statuses after kills: partial=${R.stats.partial} not-installed=${R.stats.notInstalled} installed=${R.stats.installed}`); }
      if (cat === 'undo') { t.diagnostic(`state-dir leftovers after undo (reported, not asserted): ${R.soft.length}`); R.soft.slice(0, 5).forEach((s) => t.diagnostic(s)); }
      if (cat === 'reapply') { [...R.differs].slice(0, 4).forEach((s) => t.diagnostic(`reported, not asserted: ${s}`)); t.diagnostic(`re-apply bytes differ from a clean install at ${R.differs.size} k value(s)`); }
      if (!sc.branchB && cat === 'reapply') return;
      const v = R.v[cat];
      assert.deepEqual(v.slice(0, 40), [], `${v.length} violation(s):` + show(v.slice(0, 40)));
    });
  }
}

test('D1 control: the kill preload really truncates a write and kills (self-check of the harness)', async () => {
  const run = await mk('D1self', { fixture: 'bare', stateMode: 'external' });
  try {
    const f = path.join(run.cwd, 'half.txt'); const script = path.join(run.cwd, 's.mjs');
    fs.writeFileSync(script, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(f)}, 'ABCDEFGHIJ'); fs.writeFileSync(${JSON.stringify(f + '2')}, 'x');`);
    const r = await run.node(['--no-warnings', '--import', FI, script], { env: { FI_MODE: 'kill', FI_K: '1', FI_LOG: path.join(run.dir, 'fi.json') } });
    assert.equal(r.signal, 'SIGKILL');
    assert.equal(fs.readFileSync(f, 'utf8'), 'ABCDE', 'half of the bytes were written before the kill');
    assert.ok(!fs.existsSync(f + '2'), 'nothing after the kill ran');
  } finally { run.close(); }
});
