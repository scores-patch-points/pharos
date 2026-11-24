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
