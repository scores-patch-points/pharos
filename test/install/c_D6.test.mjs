// D6 real-home targets refused (A1). Skipped unless PHAROS_A_RUN=1.
// The account home is stood in by <jail>/fakereal (c_fakehome_preload.mjs patches os.userInfo, the call a guard would use for the
// account home; HOME stays the sandbox home) so that APPLY can be tried without touching the true home. The true account home is
// also used, under the sandbox write wall, for plan and apply refusals, with the allowed-root list left empty so that only the
// real-home rule can refuse it. A stand-in that is not honoured would make the control (project folder in the stand-in home) refused
// or the refusals vacuous; both are asserted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { skip, GUARD_AVAILABLE, mk, exec, applyAll, hashTree, diffTrees, show, FAKEHOME, REAL_HOME, errJson, fs, path } from './c_lib.mjs';

const PROTECTED = ['.ssh', '.aws', '.gnupg'];
const EXTRA = ['.kube', '.docker', '.azure'];
const fakeOf = (run) => path.join(run.jail, 'fakereal');
function build(run) {
  const fake = fakeOf(run);
  for (const d of [...PROTECTED, ...EXTRA, 'Documents/proj', '.config']) fs.mkdirSync(path.join(fake, d), { recursive: true });
  fs.writeFileSync(path.join(fake, '.ssh', 'id_test'), 'not a key\n');
  return fake;
}
const withFake = (run, extra = {}) => ({ preload: [FAKEHOME], env: { FAKE_REAL_HOME: fakeOf(run), ...extra } });
const treeOf = (run) => ({ fake: hashTree(fakeOf(run)), home: hashTree(run.home) });

for (const verb of ['plan', 'apply']) {
  for (const sub of ['', ...PROTECTED, ...EXTRA]) {
    const label = sub ? `~/${sub}` : '~ (the home itself)';
    test(`D6 ${verb}: target ${label} of the account home is refused with exit 3 and nothing is written`, { skip }, async () => {
      const run = await mk('D6', { fixture: 'bare', stateMode: 'default' });
      try {
        const fake = build(run); const t = sub ? path.join(fake, sub) : fake;
        const before = treeOf(run);
        const res = await exec(run, ['install', 'all', '--target', t, ...(verb === 'apply' ? ['--apply'] : [])], withFake(run));
        const v = [];
        if (res.code !== 3) v.push(`exit ${res.code}, expected 3 (refused): ${res.out.slice(0, 200).replace(/\n/g, ' ')}`);
        const after = treeOf(run);
        const d = diffTrees(before.fake, after.fake);
        if (d.length) v.push(`the stand-in home changed: ${d.slice(0, 5).map((x) => `${x.kind} ${x.path}`).join('; ')}`);
        if (diffTrees(before.home, after.home).length) v.push('the sandbox home changed');
        assert.deepEqual(v, [], show(v));
      } finally { run.close(); }
    });
  }
}

test('D6 the refusal holds with --yes-real-home, with an empty allowed-root list, and for the three protected dirs and the home', { skip }, async () => {
  const run = await mk('D6f', { fixture: 'bare', stateMode: 'default' });
  try {
    const fake = build(run); const v = [];
    for (const sub of ['', '.ssh', '.aws', '.gnupg']) {
      const t = sub ? path.join(fake, sub) : fake;
      for (const [name, extra] of [['--yes-real-home', { args: ['--yes-real-home'] }], ['empty allowed-root', { env: { PHAROS_ROOT_ALLOW: '' } }]]) {
        const before = hashTree(fake);
        const o = withFake(run, extra.env || {});
        const res = await exec(run, ['install', 'all', '--target', t, '--apply', ...(extra.args || [])], o);
        if (res.code !== 3) v.push(`${sub || '~'} with ${name}: exit ${res.code}, expected 3`);
        if (diffTrees(before, hashTree(fake)).length) v.push(`${sub || '~'} with ${name}: the stand-in home changed`);
      }
    }
    assert.deepEqual(v, [], show(v));
  } finally { run.close(); }
});

test('D6 a symlink inside the jail that points at ~/.ssh is refused as a target', { skip }, async () => {
  const run = await mk('D6l', { fixture: 'bare', stateMode: 'default' });
  try {
    const fake = build(run); const link = path.join(run.jail, 'sneaky'); fs.symlinkSync(path.join(fake, '.ssh'), link);
    const before = hashTree(fake);
    const res = await exec(run, ['install', 'all', '--target', link, '--apply'], withFake(run));
    assert.equal(res.code, 3, res.out.slice(0, 200));
    assert.deepEqual(diffTrees(before, hashTree(fake)), []);
  } finally { run.close(); }
});

test('D6 --state and --khora-dir inside ~/.ssh are refused too (target is a normal project folder)', { skip }, async () => {
  const run = await mk('D6s', { fixture: 'populated', stateMode: 'external' });
  try {
    const fake = build(run); const v = [];
    const before = hashTree(fake);
    const a = await exec(run, ['install', 'all', '--target', run.target, '--state', path.join(fake, '.ssh', 'pharos-state'), '--apply'], withFake(run));
    if (a.code !== 3) v.push(`--state ~/.ssh/pharos-state: exit ${a.code}, expected 3`);
    const b = await exec(run, ['install', 'reader-stack', '--target', run.target, '--state', run.stateDir, '--khora-dir', path.join(fake, '.aws', 'khora'), '--with-clone', '--apply'], withFake(run));
    if (b.code !== 3) v.push(`--khora-dir ~/.aws/khora: exit ${b.code}, expected 3`);
    if (diffTrees(before, hashTree(fake)).length) v.push('the stand-in home changed');
    assert.deepEqual(v, [], show(v));
    assert.deepEqual(b.calls.filter((c) => c.cls === 'mutating'), [], 'no clone attempted');
  } finally { run.close(); }
});

test('D6 control: a project folder INSIDE the stand-in home is accepted (exit 0, verified) so the refusals above are not "refuse everything"', { skip }, async () => {
  const run = await mk('D6c', { fixture: 'bare', stateMode: 'default' });
  try {
    const fake = build(run); const proj = path.join(fake, 'Documents', 'proj');
    const res = await exec(run, ['install', 'all', '--target', proj, '--apply'], withFake(run));
    assert.equal(res.code, 0, res.out.slice(0, 300));
    const ver = await exec(run, ['verify', 'all', '--target', proj], withFake(run));
    assert.equal(ver.code, 0, ver.out.slice(0, 300));
  } finally { run.close(); }
});

// the true account home, only ever under the sandbox write wall (writes outside the run dir are denied), allowed-root list empty
for (const sub of ['', '.ssh', '.aws', '.gnupg']) {
  test(`D6 the TRUE account home ${sub ? '/' + sub : ''}: plan and apply are refused with exit 3 (no allowed-root list)`, { skip: skip || (!GUARD_AVAILABLE && 'needs the sandbox-exec write wall: never run against the true home without it') }, async () => {
    const run = await mk('D6r', { fixture: 'bare', stateMode: 'default' });
    try {
      const t = sub ? path.join(REAL_HOME, sub) : REAL_HOME; const v = [];
      for (const verb of ['plan', 'apply']) {
        const res = await exec(run, ['install', 'all', '--target', t, ...(verb === 'apply' ? ['--apply'] : [])], { env: { PHAROS_ROOT_ALLOW: '' } });
        if (res.code !== 3) v.push(`${verb}: exit ${res.code}, expected 3: ${res.out.slice(0, 200).replace(/\n/g, ' ')}`);
        if (res.denied) v.push(`${verb}: the sandbox wall stopped a write (the installer tried to write into the true home)`);
      }
      assert.deepEqual(v, [], show(v));
    } finally { run.close(); }
  });
}
