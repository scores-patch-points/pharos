// I2 touched is a subset of declared. After a real apply in the sandbox: every changed path is within the door's
// declared touches (files + configs, $STATE not implicit), every shim call is within the declared tools, every
// launchctl env change is a declared env name, no undeclared connection. Skipped unless PHAROS_A_RUN=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BIN, DEFAULT_DOORS, listDoorIds, loadManifest, manifestFlags } from './a_rig.mjs';
import { checkApplyDeclared, heavy } from './a_checks.mjs';

const skip = process.env.PHAROS_A_RUN === '1' ? false : 'not run: set PHAROS_A_RUN=1 (waiting to be told)';
const cfg = { bin: DEFAULT_BIN, doorsDir: DEFAULT_DOORS, label: 'I2' };
const ids = listDoorIds(cfg.doorsDir).filter((id) => (loadManifest(id, cfg.doorsDir).kind || 'installable') === 'installable');
const show = (v) => '\n  ' + v.join('\n  ');
const run = (door, scenario) => async (t) => {
  const r = await checkApplyDeclared(cfg, door, scenario);
  r.notes.forEach((n) => t.diagnostic(n));
  assert.deepEqual(r.violations, [], show(r.violations));
};

test('I2 at least one installable door found', { skip }, () => assert.ok(ids.length >= 2, `installable doors: ${ids.join(', ') || 'none'}`));

for (const door of ids) {
  const m = loadManifest(door, cfg.doorsDir);
  const defaultOn = (m.steps || []).some((s) => s.level !== 'none' && (s.default_on || (!s.flag && !heavy(s.level))));
  test(`I2 ${door}: default apply (populated)`, { skip }, run(door, { name: 'default', expectChange: defaultOn }));
  if (defaultOn) test(`I2 ${door}: default apply (bare target)`, { skip }, run(door, { name: 'default', fixture: 'bare' }));
  test(`I2 ${door}: default apply (state in target)`, { skip }, run(door, { name: 'default-state', stateMode: 'default', expectChange: defaultOn }));
  for (const f of manifestFlags(m)) {
    const known = f === '--with-launchctl' || f === '--with-opencode';
    test(`I2 ${door}: apply ${f}`, { skip }, run(door, {
      name: f, flags: [f], expectExit0: known, expectChange: known,
      setup: f === '--with-launchctl' ? (r) => r.setLaunchctl({ OLLAMA_KEEP_ALIVE: '5m' }) : undefined,
    }));
  }
  const fl = manifestFlags(m);
  if (fl.includes('--with-launchctl') && fl.includes('--with-opencode')) {
    test(`I2 ${door}: apply --with-launchctl --with-opencode`, { skip }, run(door, { name: 'launchctl+opencode', flags: ['--with-launchctl', '--with-opencode'], setup: (r) => r.setLaunchctl({ OLLAMA_KEEP_ALIVE: '5m' }) }));
  }
}
test('I2 all: install all --apply', { skip }, run('all', { name: 'all', expectChange: true }));
