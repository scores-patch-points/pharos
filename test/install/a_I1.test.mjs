// I1 dry run is pure. PREREG: plan and apply without --apply, every door: HOME and target trees byte-identical
// (hash of every file, mode, symlink), zero state-changing shim calls, a dead listener records zero connections.
// Skipped unless PHAROS_A_RUN=1 (the installer must not be run until told).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BIN, DEFAULT_DOORS, listDoorIds } from './a_rig.mjs';
import { checkDryPurity } from './a_checks.mjs';

const skip = process.env.PHAROS_A_RUN === '1' ? false : 'not run: set PHAROS_A_RUN=1 (waiting to be told)';
const cfg = { bin: DEFAULT_BIN, doorsDir: DEFAULT_DOORS, label: 'I1' };
const ids = listDoorIds(cfg.doorsDir);
const show = (v) => '\n  ' + v.join('\n  ');

test('I1 doors exist: pharos-core, agents-md, reader-stack have a door.json', { skip }, () => {
  for (const id of ['pharos-core', 'agents-md', 'reader-stack']) assert.ok(ids.includes(id), `missing doors/${id}/door.json (found: ${ids.join(', ') || 'none'})`);
});

for (const door of [...ids, 'all']) {
  for (const [fixture, stateMode] of [['populated', 'external'], ['bare', 'external'], ['populated', 'default']]) {
    test(`I1 dry run pure: ${door} (${fixture}, state ${stateMode})`, { skip }, async (t) => {
      const r = await checkDryPurity(cfg, door, { fixture, stateMode });
      r.notes.forEach((n) => t.diagnostic(n));
      assert.deepEqual(r.violations, [], show(r.violations));
    });
  }
}
