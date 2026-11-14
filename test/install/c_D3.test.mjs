// D3 undo deletes only what its journal created, never pre-existing state-dir contents (A1). Skipped unless PHAROS_A_RUN=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { skip, mk, exec, T, applyAll, hashTree, diffTrees, diffJail, stateDirOf, show, sha256, read, fs, path } from './c_lib.mjs';

const SEED = {
  'backups/user-backup.txt': 'user data in backups, not ours\n',
  'runs/notes.txt': 'user notes in runs, not ours\n',
  'extra.txt': 'a file in the state folder that is not ours\n',
  'sub/deep/file.txt': 'deep user file\n',
};
function seed(state) {
  for (const [rel, c] of Object.entries(SEED)) { const p = path.join(state, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); }
  // a file named like a backup (sha256 name) that no journal entry references
  const h = sha256('unreferenced content'); fs.writeFileSync(path.join(state, 'backups', h), 'unreferenced content');
  return { ...SEED, [`backups/${h}`]: 'unreferenced content' };
}

for (const stateMode of ['external', 'default']) {
  for (const door of ['all', 'agents-md', 'pharos-core']) {
    test(`D3 pre-existing state-dir contents survive apply and undo (${door}, ${stateMode} state)`, { skip }, async () => {
      const run = await mk('D3', { fixture: 'populated', stateMode });
      try {
        const state = stateDirOf(run);
        fs.mkdirSync(state, { recursive: true });
        const seeded = seed(state);
        const before = hashTree(run.jail);
        const ap = await exec(run, ['install', door, ...T(run), '--apply']);
        assert.equal(ap.code, 0, `apply exit ${ap.code}: ${ap.out.slice(0, 200)}`);
        assert.ok(fs.existsSync(path.join(state, 'journal.jsonl')), 'precondition: the journal exists in the pre-existing state dir');
        const u = await exec(run, ['undo-door', door, ...T(run)]);
        const v = [];
        if (u.code !== 0) v.push(`undo exit ${u.code}: ${u.out.slice(0, 200).replace(/\n/g, ' ')}`);
        for (const [rel, c] of Object.entries(seeded)) {
          const b = read(path.join(state, rel));
          if (b === null) v.push(`the pre-existing file ${rel} was deleted by undo`);
          else if (b.toString() !== c) v.push(`the pre-existing file ${rel} was modified by undo`);
        }
        for (const d of ['backups', 'runs']) if (!fs.existsSync(path.join(state, d))) v.push(`the pre-existing directory ${d}/ was removed by undo`);
        const d = diffJail(run, before, hashTree(run.jail), { strict: true });
        if (d.all.length) v.push(`the tree differs from before apply: ${d.all.slice(0, 6).map((x) => `${x.kind} ${x.path}`).join('; ')}`);
        assert.deepEqual(v, [], show(v));
      } finally { run.close(); }
    });
  }
}

for (const stateMode of ['external', 'default']) {
  test(`D3 a state dir that did not exist is gone after undo; nothing else is (${stateMode} state)`, { skip }, async () => {
    const run = await mk('D3n', { fixture: 'agents-nonl', stateMode });
    try {
      const before = hashTree(run.jail);
      const ap = await applyAll(run); assert.equal(ap.code, 0);
      const u = await exec(run, ['undo-door', 'all', ...T(run)]);
      const d = diffJail(run, before, hashTree(run.jail), { strict: true });
      assert.equal(u.code, 0);
      assert.deepEqual(d.all.map((x) => `${x.kind} ${x.path}`), []);
    } finally { run.close(); }
  });
}

test('D3 a state dir that pre-existed but empty is still there, empty, after undo', { skip }, async () => {
  const run = await mk('D3e', { fixture: 'populated', stateMode: 'external' });
  try {
    fs.mkdirSync(run.stateDir, { recursive: true });
    const before = hashTree(run.jail);
    await applyAll(run);
    const u = await exec(run, ['undo-door', 'all', ...T(run)]);
    const d = diffJail(run, before, hashTree(run.jail), { strict: true });
    assert.equal(u.code, 0);
    assert.deepEqual(d.all.map((x) => `${x.kind} ${x.path}`), []);
  } finally { run.close(); }
});

test('D3 undo after apply with a foreign file in the TARGET named like an installer temp or backup is left alone', { skip }, async () => {
  const run = await mk('D3t', { fixture: 'populated', stateMode: 'external' });
  try {
    const decoy = path.join(run.target, '.AGENTS.md.pharos-000000000000.tmp'); fs.writeFileSync(decoy, 'not ours\n');
    const decoy2 = path.join(run.target, 'user-notes.txt'); fs.writeFileSync(decoy2, 'user\n');
    const before = hashTree(run.jail);
    await applyAll(run);
    const u = await exec(run, ['undo-door', 'all', ...T(run)]);
    const d = diffJail(run, before, hashTree(run.jail), { strict: true });
    assert.equal(u.code, 0);
    assert.deepEqual(d.all.map((x) => `${x.kind} ${x.path}`), []);
  } finally { run.close(); }
});
