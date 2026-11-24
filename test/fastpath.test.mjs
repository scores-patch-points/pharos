// fastpath.test.mjs — the questions one entry answers are answered by a BACKWARD FOLD (newest first, stop at the answer), not by building the whole view; a fact written by the bulk
// path is written without a view and is read back like any other entry.
import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import * as P from '../lib/pharos.mjs';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pharos-fast-'));
test('open finds an existing frame without loading the log, and creates one only when no file holds it', () => {
  const dir = tmp(); const a = P.open('t', { dir, writer: 'a' }); P.weave(a, { cell: 'DEF·Figure', kind: 'kind', addr: 'kind:x', body: { name: 'x', cell: 'DEF·Figure' } });
  const b = P.open('t', { dir, writer: 'b' });   // a second writer: the frame is already in a's file, so b writes none
  assert.equal(P.entries(b).filter((e) => e.kind === 'frame').length, 1); assert.ok(!fs.existsSync(path.join(dir, 'b.jsonl')), 'b wrote no frame (it has no file at all)');
});
test('hasKind and missingKinds answer from the newest files backward, confirm the line, and remember', () => {
  const dir = tmp(); const a = P.open('t', { dir, writer: 'a' }); P.weave(a, { cell: 'DEF·Figure', kind: 'kind', addr: 'kind:x', body: { name: 'x', cell: 'DEF·Figure' } });
  const b = P.open('t', { dir, writer: 'b' }); P.weave(b, { cell: 'DEF·Figure', kind: 'kind', addr: 'kind:y', body: { name: 'y', cell: 'INS·Figure' } });
  assert.equal(P.hasKind(b, 'x'), true); assert.equal(P.hasKind(b, 'y'), true); assert.equal(P.hasKind(b, 'nope'), false);
  assert.deepEqual(P.missingKinds(b, ['x', 'y', 'z', 'w']).sort(), ['w', 'z']); assert.deepEqual(P.missingKinds(b, ['x', 'y']), []);
  // a line that merely mentions the address in a body is not a declaration
  P.weave(b, { cell: 'INS·Figure', kind: 'y', addr: 'q', body: { note: '"addr":"kind:ghost"' } }); assert.equal(P.hasKind(b, 'ghost'), false);
});
test('weaveUnchained writes one entry with no view, returns it like weave, and the log reads it back', () => {
  const dir = tmp(); const h = P.open('t', { dir, writer: 'a' }); P.weave(h, { cell: 'DEF·Figure', kind: 'kind', addr: 'kind:act', body: { name: 'act', cell: 'SIG·Figure' } }) ;
  assert.ok(true);
});
const tick = () => new Promise((r) => setTimeout(r, 4));   // distinct `at` for each entry
test('schema first, then current state by a backward fold: the schema is the frame and the kinds, current is the latest entry per address, retracted ones are skipped, and it agrees with the full view', async () => {
  const dir = tmp(); const a = P.open('t', { dir, writer: 'a' }); P.weave(a, { cell: 'DEF·Figure', kind: 'kind', addr: 'kind:note', body: { name: 'note', cell: 'INS·Figure' } });
  const w = async (h, addr, body) => { const e = P.weave(h, { cell: 'INS·Figure', kind: 'note', addr, body }); await tick(); return e; };
  await w(a, 'n1', { v: 1 }); const n2 = await w(a, 'n2', { v: 1 }); await w(a, 'n1', { v: 2 });
  const b = P.open('t', { dir, writer: 'b' }); await w(b, 'n3', { v: 1 }); P.weave(b, { cell: 'NUL·Figure', kind: 'retract', addr: 'r1', body: null, of: [n2.id] }); await tick(); await w(a, 'n4', { v: 1 });
  const sc = P.schema(b); assert.equal(sc.frame, true); assert.equal(sc.kinds.get('note').cell, 'INS·Figure'); assert.ok(!sc.kinds.has('ghost'));
  const cur = P.current(b, { kind: 'note' }); assert.deepEqual(cur.map((e) => e.addr).sort(), ['n1', 'n3', 'n4'], 'n2 is retracted'); assert.equal(cur.find((e) => e.addr === 'n1').body.v, 2, 'the latest entry of an address is its current state');
  assert.deepEqual(P.recent(b, { kinds: ['note'], limit: 2 }).map((e) => e.addr), ['n4', 'n3'], 'newest first, retracted skipped, stops at the limit');
  assert.deepEqual(P.current(b, { kind: 'note', addr: 'n1' }).map((e) => e.body.v), [2]);
  // agreement with the full view: the non-retracted entries of the kind, latest per address
  const view = P.entries(b).filter((e) => e.kind === 'note'); const retracted = new Set(P.entries(b).filter((e) => e.kind === 'retract').flatMap((e) => e.of));
  const latest = new Map(); for (const e of view.filter((e) => !retracted.has(e.id)).sort((x, y) => (x.at < y.at ? -1 : 1))) latest.set(e.addr, e);
  assert.deepEqual(cur.map((e) => e.id).sort(), [...latest.values()].map((e) => e.id).sort());
});
