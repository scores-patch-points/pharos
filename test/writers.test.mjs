import test from 'node:test';
import assert from 'node:assert/strict';
import { audit, baseOf, NEXUS_POLICY, PROTOCOL_KINDS } from '../lib/writers.mjs';
import { CELLS } from '../lib/cells.mjs';
const E = (by, cell, kind = 'k', id = `${by}-${cell}-${kind}`) => ({ by, cell, kind, id });
test('observing is not defining: khora and janus may write Existence and Structure, never Interpretation; penelope may write all three', () => {
  for (const c of CELLS) for (const who of ['khora', 'janus', 'penelope']) {
    const r = audit([E(who, c.id)]); const expect = NEXUS_POLICY[who].includes(c.domain);
    assert.equal(r.ok, expect, `${who} at ${c.id} (${c.domain})`); assert.equal(r.violations.length, expect ? 0 : 1);
  }
});
test('a violation names the writer, the cell, the kind and why; a janus difference at DEF·Figure is the case that started this', () => {
  const r = audit([E('janus.gate', 'DEF·Figure', 'difference', 'x1'), E('janus', 'SEG·Figure', 'pair-diff', 'x2'), E('khora', 'INS·Figure', 'text-reading', 'x3')]);
  assert.equal(r.checked, 3); assert.equal(r.violations.length, 1); const v = r.violations[0];
  assert.deepEqual([v.id, v.by, v.kind, v.cell, v.domain], ['x1', 'janus.gate', 'difference', 'DEF·Figure', 'Interpretation']); assert.match(v.why, /Penelope/);
});
test('the protocol kinds are exempt: declaring a kind at DEF·Figure is vocabulary, not interpretation', () => {
  const r = audit(PROTOCOL_KINDS.map((k) => E('janus', k === 'retract' ? 'NUL·Figure' : k === 'frame' ? 'NUL·Ground' : k === 'kind' ? 'DEF·Figure' : 'DEF·Pattern', k)));
  assert.equal(r.ok, true); assert.equal(r.exempt, 4); assert.equal(r.checked, 0);
  assert.equal(audit([E('janus', 'DEF·Figure', 'kindly')]).ok, false, 'a kind that only starts with an exempt name is not exempt');
});
test('an unknown writer or an unknown cell is a typed gap, never a pass and never a violation', () => {
  const r = audit([E('someone-else', 'DEF·Figure'), E('khora', 'XYZ·Figure')]);
  assert.equal(r.ok, true); assert.equal(r.violations.length, 0); assert.equal(r.gaps.length, 2); assert.match(r.gaps[0].why, /not a pass/); assert.match(r.gaps[1].why, /27 phaseposts/);
});
test('the writer is the name before the first dot, and the policy is data the caller may replace', () => {
  assert.equal(baseOf('janus.gate'), 'janus'); assert.equal(baseOf('penelope'), 'penelope'); assert.equal(baseOf(undefined), '');
  assert.equal(audit([E('janus', 'DEF·Figure')], { policy: { janus: ['Existence', 'Structure', 'Interpretation'] } }).ok, true);
});
