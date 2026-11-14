// I3 undo is exact and idempotent. Apply then undo restores HOME and target byte for byte (and the emulated
// launchd env), for each door and for all doors in sequence; apply twice changes nothing the second time; undo
// twice is a no-op. Two state placements: external --state (journal outside the managed trees) and the default
// in-target state, where the WHOLE jail including .pharos must be identical (the strict reading of PREREG).
// Skipped unless PHAROS_A_RUN=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BIN, DEFAULT_DOORS, listDoorIds, loadManifest, manifestFlags, FIXTURES } from './a_rig.mjs';
import { checkUndoExact, checkApplyIdempotent, checkSequence } from './a_checks.mjs';

const skip = process.env.PHAROS_A_RUN === '1' ? false : 'not run: set PHAROS_A_RUN=1 (waiting to be told)';
const cfg = { bin: DEFAULT_BIN, doorsDir: DEFAULT_DOORS, label: 'I3' };
const ids = listDoorIds(cfg.doorsDir).filter((id) => (loadManifest(id, cfg.doorsDir).kind || 'installable') === 'installable');
const show = (v) => '\n  ' + v.join('\n  ');
const chk = (fn, door, sc) => async (t) => { const r = await fn(cfg, door, sc); r.notes.forEach((n) => t.diagnostic(n)); assert.deepEqual(r.violations, [], show(r.violations)); };

test('I3 at least one installable door found', { skip }, () => assert.ok(ids.length >= 2, `installable doors: ${ids.join(', ') || 'none'}`));

for (const door of ids) {
  const m = loadManifest(door, cfg.doorsDir);
  const flags = manifestFlags(m);
  const touchesAgents = JSON.stringify(m.touches?.files || []).includes('AGENTS.md') || /agents/.test(door);
  const fixtures = touchesAgents || door === 'pharos-core' ? FIXTURES : ['populated'];
  const scenarios = [{ name: 'default' }];
  if (flags.includes('--with-opencode')) scenarios.push({ name: 'opencode', flags: ['--with-opencode'] });
  if (flags.includes('--with-launchctl')) {
    scenarios.push({ name: 'launchctl-preexisting', flags: ['--with-launchctl'], setup: (r) => r.setLaunchctl({ OLLAMA_KEEP_ALIVE: '5m', UNRELATED: 'keep' }) });
    scenarios.push({ name: 'launchctl-absent', flags: ['--with-launchctl'] });
  }
  if (flags.includes('--with-launchctl') && flags.includes('--with-opencode')) scenarios.push({ name: 'launchctl+opencode', flags: ['--with-launchctl', '--with-opencode'], setup: (r) => r.setLaunchctl({ OLLAMA_KEEP_ALIVE: '5m' }) });
  for (const sc of scenarios) {
    for (const fixture of sc.name === 'default' ? fixtures : ['populated']) {
      test(`I3a undo exact: ${door}/${sc.name}/${fixture} (external state)`, { skip }, chk(checkUndoExact, door, { ...sc, fixture, stateMode: 'external', expectChange: sc.name !== 'default' || !!m.steps.some((s) => s.level !== 'none' && (s.default_on || !s.flag)) }));
    }
    test(`I3b undo exact STRICT: ${door}/${sc.name}/populated (default state inside target, whole jail)`, { skip }, chk(checkUndoExact, door, { ...sc, fixture: 'populated', stateMode: 'default', expectChange: false }));
    test(`I3 apply twice is a no-op: ${door}/${sc.name} (external state)`, { skip }, chk(checkApplyIdempotent, door, { ...sc, fixture: 'populated', stateMode: 'external' }));
  }
  test(`I3b apply twice is a no-op STRICT: ${door}/default (default state, whole jail)`, { skip }, chk(checkApplyIdempotent, door, { name: 'default', fixture: 'populated', stateMode: 'default' }));
}

for (const [mode, fixture, stateMode] of [['each', 'populated', 'external'], ['all', 'populated', 'external'], ['each', 'bare', 'external'], ['all', 'agents-crlf', 'external'], ['each', 'populated', 'default'], ['all', 'populated', 'default']]) {
  test(`I3 all doors in sequence: ${mode} (${fixture}, state ${stateMode})`, { skip }, async (t) => {
    const r = await checkSequence(cfg, { mode, fixture, stateMode });
    r.notes.forEach((n) => t.diagnostic(n));
    assert.deepEqual(r.violations, [], show(r.violations));
  });
}
