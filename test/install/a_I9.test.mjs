// I9 existing behaviour. (1) the existing library tests: against the frozen pre-change copy (sandbox/baseline/pharos-pre,
// hashes in pharos-pre.sha256) the same tests must still pass; (2) legacy bin commands give identical exit code, stdout,
// stderr and resulting tree as the frozen copy, volatile lines masked. Skipped unless PHAROS_A_RUN=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BIN, PHAROS_DIR } from './a_rig.mjs';
import { checkLegacyUnchanged, checkExistingTests } from './a_checks.mjs';

const skip = process.env.PHAROS_A_RUN === '1' ? false : 'not run: set PHAROS_A_RUN=1 (waiting to be told)';
const cfg = { bin: DEFAULT_BIN, label: 'I9' };
const show = (v) => '\n  ' + v.join('\n  ');

test('I9 existing tests: nothing that passed at baseline fails now, no new failures', { skip, timeout: 300000 }, async (t) => {
  const r = await checkExistingTests(cfg, PHAROS_DIR);
  r.notes.forEach((n) => t.diagnostic(n));
  assert.deepEqual(r.violations, [], show(r.violations));
});

test('I9 legacy bin commands unchanged vs the frozen baseline (init weave fold status merge install undo, usage, errors)', { skip, timeout: 300000 }, async (t) => {
  const r = await checkLegacyUnchanged(cfg);
  r.notes.forEach((n) => t.diagnostic(n));
  assert.deepEqual(r.violations, [], show(r.violations));
});
