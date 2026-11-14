// I4 unsafe things need their own flag; unknown door, '..' and symlink escapes are refused. Skipped unless PHAROS_A_RUN=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BIN, DEFAULT_DOORS, listDoorIds, loadManifest } from './a_rig.mjs';
import { checkFlagGating, checkRefusals, heavy } from './a_checks.mjs';

const skip = process.env.PHAROS_A_RUN === '1' ? false : 'not run: set PHAROS_A_RUN=1 (waiting to be told)';
const cfg = { bin: DEFAULT_BIN, doorsDir: DEFAULT_DOORS, label: 'I4' };
const ids = listDoorIds(cfg.doorsDir);
const heavyDoors = ids.filter((id) => (loadManifest(id, cfg.doorsDir).steps || []).some((s) => heavy(s.level)) && (loadManifest(id, cfg.doorsDir).kind || 'installable') === 'installable');
const show = (v) => '\n  ' + v.join('\n  ');

test('I4 reader-stack declares the four separate flags', { skip }, () => {
  const m = loadManifest('reader-stack', cfg.doorsDir);
  const flags = (m.steps || []).map((s) => s.flag);
  for (const f of ['--with-ollama', '--with-launchctl', '--with-opencode', '--with-services']) assert.ok(flags.includes(f), `reader-stack has no step with ${f}`);
  const bad = m.steps.filter((s) => heavy(s.level) && (s.default_on || !s.flag));
  assert.deepEqual(bad.map((s) => s.id), [], 'heavy steps must have a flag and must not be default_on');
});

for (const door of heavyDoors) {
  test(`I4 flag gating: ${door}`, { skip }, async (t) => {
    const r = await checkFlagGating(cfg, door);
    r.notes.forEach((n) => t.diagnostic(n));
    assert.deepEqual(r.violations, [], show(r.violations));
  });
}

test('I4 refusals: unknown door, .., symlink escapes (non-zero exit, nothing changed anywhere)', { skip }, async (t) => {
  const r = await checkRefusals(cfg);
  r.notes.forEach((n) => t.diagnostic(n));
  assert.deepEqual(r.violations, [], show(r.violations));
  const non3 = r.notes.filter((n) => !/exit 3$/.test(n) && !/exit 2$/.test(n));
  if (non3.length) t.diagnostic(`refusals with an exit code other than 2 or 3 (DESIGN says 3 for path refusals, 2 for unknown door): ${non3.join(' | ')}`);
});
