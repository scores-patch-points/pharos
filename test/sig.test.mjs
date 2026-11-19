// sig.test.mjs: the derived-shortcut layer (docs/PROPOSAL-SIG-FOLD.md). The law: removing every shortcut changes no answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { open, weave } from '../lib/pharos.mjs';
import { Fold, Tail, position, registerFold, runFold, getFold, PROBE_FIRST } from '../lib/sig.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pharos-sig-'));
const note = (h, addr, body) => weave(h, { cell: 'INS·Figure', kind: 'note', addr, body });
const logOf = (format) => { const h = open('t', { dir: tmp(), writer: 'w', format }); weave(h, { cell: 'DEF·Figure', kind: 'kind', addr: 'kind:note', body: { name: 'note', cell: 'INS·Figure' } }); return h; };

for (const format of ['jsonl', 'phb']) {
  test(`${format}: the registered heads fold equals the full view with and without shortcuts, the memo misses after an append, and the probe promotes`, () => {
    const h = logOf(format); for (let i = 0; i < 40; i++) note(h, `x${i % 4}`, { i });
    const fold = getFold('heads'), hits0 = fold.stats.memoHits, mism0 = fold.stats.mismatches, ask = () => runFold('heads', h, { addr: 'x1', cell: 'INS·Figure' });
    const withSig = []; for (let i = 0; i < PROBE_FIRST + 3; i++) { note(h, 'x1', { more: i }); withSig.push(ask()); }   // each append moves the position: every call is a miss
    assert.equal(fold.stats.memoHits, hits0, 'a new position is never a hit');
    const again = ask(); const hits = fold.stats.memoHits; assert.deepEqual(ask(), again); assert.equal(fold.stats.memoHits, hits + 1, 'the same position hits');
    assert.equal(fold.stats.mismatches, mism0); assert.ok(fold.stats.probes >= 1);
    process.env.PHAROS_NO_SIG = '1'; try { assert.deepEqual(ask(), again, 'removing every shortcut changes no answer'); } finally { delete process.env.PHAROS_NO_SIG; }
  });
}

test('a shortcut that differs from the reference is demoted on the first probe and never used again; the reference is returned', () => {
  const marks = []; let calls = 0; const f = new Fold({ name: 'bad', reference: () => 1, shortcut: () => { calls++; return 2; }, position: () => 'p', onMark: (m) => marks.push(m) });
  assert.equal(f.run({}, { k: 1 }), 1); assert.equal(f.stats.demoted, true); assert.equal(marks[0].event, 'demoted');
  const c = calls; assert.equal(f.run({}, { k: 2 }), 1); assert.equal(calls, c, 'a demoted shortcut is not called');
});

test('a shortcut that is exact but not cheaper is demoted, not promoted', () => {
  const f = new Fold({ name: 'slow', reference: () => 7, shortcut: () => { const t = performance.now(); while (performance.now() - t < 2); return 7; }, position: () => 'p' });
  for (let i = 0; i < PROBE_FIRST; i++) f.run({}, { i }); assert.equal(f.stats.promoted, false); assert.equal(f.stats.demoted, true);
});

test('the memo is keyed by position: a changed position is a miss', () => {
  let pos = 'a', n = 0; const f = new Fold({ name: 'm', reference: () => n++, shortcut: () => 0, same: () => true, position: () => pos });
  for (let i = 0; i < PROBE_FIRST + 1; i++) f.run({}, { i }); const h0 = f.stats.memoHits;
  f.run({}, { i: 0 }); assert.equal(f.stats.memoHits, h0 + 1); pos = 'b'; f.run({}, { i: 0 }); assert.equal(f.stats.memoHits, h0 + 1);
});

test('tail: after an append only the new bytes are read; a shrunk file or changed bytes rebuild from scratch', () => {
  const h = logOf('jsonl'); let seen = 0, resets = 0; const t = new Tail(h.dir, { onLine: () => seen++, reset: () => { seen = 0; resets++; } });
  for (let i = 0; i < 10; i++) note(h, 'a', { i }); const first = t.advance(); const n1 = seen;
  note(h, 'a', { more: 1 }); const second = t.advance(); assert.equal(seen, n1 + 1); assert.ok(second.scanned < first.scanned, 'only the appended bytes were scanned');
  const file = h.file, text = fs.readFileSync(file, 'utf8'); fs.writeFileSync(file, text.slice(0, text.length - 40) + '\n'); t.advance(); assert.equal(resets, 1);
});

test('an unregistered fold is a typed gap naming how to fix it', () => { assert.throws(() => getFold('nope'), /register it with registerFold/); });
test('position changes on append and not otherwise', () => { const h = logOf('jsonl'), p = position(h.dir); assert.equal(position(h.dir), p); note(h, 'a', {}); assert.notEqual(position(h.dir), p); });
