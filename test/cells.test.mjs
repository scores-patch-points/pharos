import test from 'node:test';
import assert from 'node:assert/strict';
import { cellOf, cellById, CELLS, CHAIN, GRAINS } from '../lib/cells.mjs';

test('27 distinct cells: every operator at every grain resolves to its own id, in chain-major order', () => {
  assert.equal(CELLS.length, 27); assert.equal(new Set(CELLS.map((c) => c.id)).size, 27);
  CHAIN.forEach((op, i) => GRAINS.forEach((g, j) => { const c = cellOf(op, g); assert.equal(c.id, `${op}·${g}`); assert.equal(c.rank, i * 3 + j); assert.equal(cellById(c.id), c); }));
});
test('the three terrains and stances of a grain are the same across the operators of one domain and mode', () => {
  assert.deepEqual(['Ground', 'Figure', 'Pattern'].map((g) => cellOf('DEF', g).terrain), ['Atmosphere', 'Lens', 'Paradigm']);
  assert.deepEqual(['Ground', 'Figure', 'Pattern'].map((g) => cellOf('DEF', g).stance), ['Clearing', 'Dissecting', 'Unraveling']);
  assert.deepEqual(['Ground', 'Figure', 'Pattern'].map((g) => cellOf('CON', g).terrain), ['Field', 'Link', 'Network']);
  assert.equal(cellOf('EVA', 'Figure').stance, 'Binding'); assert.equal(cellOf('REC', 'Pattern').terrain, 'Paradigm');
});
test('an unknown operator or grain is a typed gap that names what is known, never a guess', () => {
  const a = cellOf('ALT', 'Figure'); assert.equal(a.gap, 'unknown_spec'); assert.match(a.reason, /ALT/); assert.deepEqual(a.known, CHAIN);
  const b = cellOf('DEF', 'Surface'); assert.equal(b.gap, 'unknown_spec'); assert.deepEqual(b.known, GRAINS);
});
test('the table is frozen', () => { assert.ok(Object.isFrozen(cellOf('NUL', 'Ground'))); assert.throws(() => { 'use strict'; cellOf('NUL', 'Ground').terrain = 'x'; }); });
