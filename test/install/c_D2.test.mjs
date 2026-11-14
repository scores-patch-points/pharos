// D2 undo exactness and honest status on a drifted file (A1). Skipped unless PHAROS_A_RUN=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { skip, mk, exec, T, applyAll, jparse, statusOf, diffJail, hashTree, show, read, journalOf, stateDirOf, MARK_BEGIN, MARK_END, fs, path } from './c_lib.mjs';

const undoAll = (run) => exec(run, ['undo-door', 'all', ...T(run)]);
const keptText = (res) => { const j = jparse(res); return JSON.stringify([j?.reports?.map((r) => [r.kept, r.drifted, r.drift]), res.stderr]); };

async function drifted(fixture, stateMode, edit) {
  const run = await mk('D2', { fixture, stateMode });
  const before = hashTree(run.jail);
  const ap = await applyAll(run);
  assert.equal(ap.code, 0, 'precondition: apply exits 0');
  const applied = { 'AGENTS.md': read(path.join(run.target, 'AGENTS.md')), 'pharos.json': read(path.join(run.target, 'pharos.json')), 'holon.json': read(path.join(run.target, 'holon.json')) };
  edit(run);
  return { run, before, applied };
}

for (const stateMode of ['external', 'default']) {
  test(`D2 pharos.json edited after apply (${stateMode} state): undo exits 1, keeps the edit and the state, status says drifted, a second undo does not claim success`, { skip }, async () => {
    const f = (run) => path.join(run.target, 'pharos.json');
    const { run, before, applied } = await drifted('populated', stateMode, (run) => fs.appendFileSync(path.join(run.target, 'pharos.json'), '\n'));
    try {
      const edited = read(f(run));
      const v = [];
      const st0 = await statusOf(run);
      if (st0.by['pharos-core'] !== 'drifted') v.push(`status before undo: pharos-core is ${st0.by['pharos-core']}, expected drifted`);
      const u = await undoAll(run);
      if (u.code === 0) v.push('undo exited 0 although pharos.json was edited after apply (claims success on a drifted file)');
      if (u.code !== 1) v.push(`undo exit code ${u.code}, README says 1`);
      if (!/drift|kept|edited/i.test(u.out)) v.push(`undo output does not report the file as drifted or kept: ${u.out.slice(0, 200).replace(/\n/g, ' ')}`);
      if (Buffer.compare(read(f(run)), edited) !== 0) v.push('undo changed the edited pharos.json');
      if (!fs.existsSync(journalOf(run))) v.push('undo removed the journal although a file was kept');
      const st = await statusOf(run);
      if (st.by['pharos-core'] !== 'drifted') v.push(`status after undo: pharos-core is ${st.by['pharos-core']}, expected drifted`);
      const u2 = await undoAll(run);
      if (u2.code === 0) v.push('second undo exited 0 on a still drifted file');
      // restore the exact applied bytes by hand, then undo must finish
      fs.writeFileSync(f(run), applied['pharos.json']);
      const u3 = await undoAll(run);
      if (u3.code !== 0) v.push(`after restoring the applied bytes by hand, undo exited ${u3.code}: ${u3.out.slice(0, 200).replace(/\n/g, ' ')}`);
      const d = diffJail(run, before, hashTree(run.jail));
      if (d.hard.length) v.push(`after the human restored the file and undo ran, the tree differs from the start: ${d.hard.slice(0, 4).map((x) => x.kind + ' ' + x.path).join('; ')}`);
      assert.deepEqual(v, [], show(v));
    } finally { run.close(); }
  });
}

test('D2 pharos block edited INSIDE after apply: undo exits non-zero and leaves the file as the human left it; status drifted', { skip }, async () => {
  const { run, before } = await drifted('populated', 'external', (run) => {
    const f = path.join(run.target, 'AGENTS.md');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('Record a step', 'Record a STEP'));
  });
  try {
    const f = path.join(run.target, 'AGENTS.md'); const edited = read(f); const v = [];
    const st0 = await statusOf(run);
    if (!['drifted'].includes(st0.by['agents-md'])) v.push(`status before undo: agents-md is ${st0.by['agents-md']}, expected drifted`);
    const u = await undoAll(run);
    if (u.code === 0) v.push('undo exited 0 although the pharos block was edited (claims success; the block is still there)');
    if (Buffer.compare(read(f), edited) !== 0) v.push('undo changed the edited AGENTS.md');
    if (!fs.existsSync(journalOf(run))) v.push('undo removed the journal although a file was kept');
    const st = await statusOf(run);
    if (st.by['agents-md'] !== 'drifted') v.push(`status after undo: agents-md is ${st.by['agents-md']}, expected drifted`);
    assert.deepEqual(v, [], show(v));
  } finally { run.close(); }
});

test('D2 README: AGENTS.md edited OUTSIDE the block: undo exits 0, removes only the block, the human line stays', { skip }, async () => {
  const { run, before } = await drifted('populated', 'external', (run) => fs.appendFileSync(path.join(run.target, 'AGENTS.md'), 'HUMAN LINE ADDED LATER\n'));
  try {
    const u = await undoAll(run); const v = [];
    const now = read(path.join(run.target, 'AGENTS.md'))?.toString() ?? '';
    if (u.code !== 0) v.push(`undo exited ${u.code} (README: for agents-md only the block is removed and that counts as success)`);
    if (now.includes(MARK_BEGIN) || now.includes(MARK_END)) v.push('the pharos block is still in AGENTS.md after undo');
    if (!now.includes('HUMAN LINE ADDED LATER')) v.push("the human's line was lost");
    if (!now.startsWith('# Agents\n\nExisting rules.')) v.push('the original content is not preserved at the start of the file');
    assert.deepEqual(v, [], show(v));
  } finally { run.close(); }
});

test('D2 backup bytes tampered in the state dir: undo refuses to restore them (exit non-zero, file not replaced)', { skip }, async () => {
  const { run, before } = await drifted('populated', 'external', () => {});
  try {
    const v = [];
    const bdir = path.join(stateDirOf(run), 'backups');
    const files = fs.existsSync(bdir) ? fs.readdirSync(bdir) : [];
    if (!files.length) { assert.fail('no backups in the state dir after an apply over an existing AGENTS.md (precondition)'); }
    for (const b of files) fs.writeFileSync(path.join(bdir, b), 'EVIL BYTES THAT ARE NOT THE ORIGINAL\n');
    const u = await undoAll(run);
    const now = read(path.join(run.target, 'AGENTS.md'))?.toString() ?? '';
    if (now.includes('EVIL BYTES')) v.push('undo restored tampered backup bytes into AGENTS.md');
    if (u.code === 0 && now.includes(MARK_BEGIN) === false && !now.startsWith('# Agents\n\nExisting rules.')) v.push('undo claimed success but AGENTS.md is not the original');
    if (u.code === 0) v.push('undo exited 0 with a backup whose bytes do not match its recorded hash');
    assert.deepEqual(v, [], show(v));
  } finally { run.close(); }
});
