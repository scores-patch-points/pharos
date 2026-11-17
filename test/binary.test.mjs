// binary.test.mjs — PHB1, the binary store (ledgers/pharos-binary/PREREG-S1.md, sha256 9a3a30b9…).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { open, weave, fold, merge, entries, status, canonical, entryId, convertFile, exportJsonl, putBlob, getBlob, phbRecords, phbBackward, askHeads, heads } from '../lib/pharos.mjs';

const tmp = (p = 'b-') => fs.mkdtempSync(path.join(os.tmpdir(), 'pharos-bin-' + p));
const fresh = (writer, dir = tmp(), format = 'phb') => {
  const h = open('t', { dir, writer, format });
  weave(h, { cell: 'DEF·Figure', kind: 'kind', addr: 'kind:note', body: { name: 'note', cell: 'INS·Figure' } });
  return h;
};
const note = (h, addr, body, extra = {}) => weave(h, { cell: 'INS·Figure', kind: 'note', addr, body, ...extra });
const ids = (h) => entries(h).map((e) => e.id);
const view = (h) => ({ ids: ids(h), fold: fold(h), status: { ...status(h), dir: null, writers: null } });

// A hand-built valid entry (as test/pharos.test.mjs builds forged ones): odd values a weave would never write.
const raw = (writer, fields) => { const e = { v: 1, cell: 'INS·Figure', kind: 'note', of: [], basis: {}, seen: [], by: writer, at: 'x', addr: 'a', body: null, ...fields }; e.id = entryId(e); return e; };

test('B1 every entry survives encode/decode with the same id, odd values included', () => {
  const h = fresh('a');
  note(h, 'x', { k: [1, 'two', null, { z: true }] });
  note(h, 'ü-ß-漢字', 'плюс', { basis: { prior: 'λ', n: 3.25 } });
  const odd = [raw('a', { at: 'not a date', of: ['not-hex', 'f'.repeat(64)], seen: ['deadbeef'] }), raw('a', { at: '2026-11-17T05:29:03.1Z', body: { nested: { deep: [[]] } } }), raw('a', { at: '1969-12-31T23:59:59.999Z' })];
  const j = path.join(tmp(), 'odd.jsonl'); fs.writeFileSync(j, odd.map(canonical).join('\n') + '\n');
  const b = j.replace('.jsonl', '.phb'); convertFile(j, b);
  const back = phbRecords(fs.readFileSync(b));
  assert.equal(back.corrupt.length, 0);
  const d2 = path.join(tmp(), 'back.jsonl'); convertFile(b, d2);
  assert.equal(fs.readFileSync(d2, 'utf8'), fs.readFileSync(j, 'utf8'), 'JSONL -> PHB -> JSONL is byte-identical');
  const d = tmp(); fs.copyFileSync(b, path.join(d, 'odd.phb'));
  assert.deepEqual(ids(open('t', { dir: d, writer: 'r', frame: false })).sort(), odd.map((e) => e.id).sort());
});

test('B1/B2 a JSONL directory and its PHB conversion fold identically; a mixed directory too', () => {
  const dj = tmp('j-'), A = fresh('alice', dj, 'jsonl'), B = fresh('bob', dj, 'jsonl');
  for (let i = 0; i < 40; i++) note(i % 2 ? A : B, `n${i % 7}`, { i }, i > 3 ? { of: [ids(A).at(-1)] } : {});
  weave(A, { cell: 'NUL·Figure', kind: 'retract', addr: 'retract:n1', body: null, of: [fold(A, { addr: 'n1' }).entries[0].id] });
  const dp = tmp('p-'), dm = tmp('m-');
  for (const f of fs.readdirSync(dj)) { convertFile(path.join(dj, f), path.join(dp, f.replace('.jsonl', '.phb'))); }
  fs.copyFileSync(path.join(dj, 'alice.jsonl'), path.join(dm, 'alice.jsonl')); convertFile(path.join(dj, 'bob.jsonl'), path.join(dm, 'bob.phb'));
  const r = (d) => view(open('t', { dir: d, writer: 'reader', frame: false }));
  assert.deepEqual(r(dp), r(dj));
  assert.deepEqual(r(dm), r(dj));
  assert.equal(exportJsonl(open('t', { dir: dp, writer: 'reader', frame: false })), exportJsonl(open('t', { dir: dj, writer: 'reader', frame: false })));
});

test('B2 merge across formats is commutative and idempotent', () => {
  const X = fresh('x', tmp(), 'jsonl'), Y = fresh('y', tmp(), 'phb');
  note(X, 'p', 1); note(Y, 'q', 2); note(Y, 'p', 3);
  const XY = fresh('xy', tmp(), 'phb'), YX = fresh('yx', tmp(), 'jsonl');
  merge(XY, X); merge(XY, Y); merge(YX, Y); merge(YX, X);
  // the targets have their own frames and kinds; what must match is everything merged in, from either order
  const merged = (h, self) => new Set(entries(h).filter((e) => e.by !== self).map((e) => e.id));
  assert.deepEqual(merged(XY, 'xy'), merged(YX, 'yx'));
  assert.deepEqual(merged(XY, 'xy'), new Set([...ids(X), ...ids(Y)]));
  assert.equal(merge(XY, X).added, 0, 'idempotent');
});

test('B3a a torn tail at every byte of the last record: earlier records read, the tear reported, appends resume', () => {
  const h = fresh('t'); note(h, 'a', 1); note(h, 'b', 2);
  const full = fs.readFileSync(h.file), recs = phbRecords(full).records, last = recs.at(-1);
  for (let cut = last.offset + 1; cut < last.end; cut++) {
    const d = tmp('torn-'), f = path.join(d, 't.phb'); fs.writeFileSync(f, full.subarray(0, cut));
    const r = open('t', { dir: d, writer: 't', format: 'phb', frame: false });
    assert.equal(entries(r).length, recs.length - 1, `cut ${cut}`);
    assert.ok(status(r).corrupt >= 1);
    weave(r, { cell: 'INS·Figure', kind: 'note', addr: 'after', body: cut });
    const again = open('t', { dir: d, writer: 'reader', frame: false });
    assert.ok(entries(again).some((e) => e.addr === 'after'), `append after the tear is read (cut ${cut})`);
    assert.equal(entries(again).length, recs.length, `nothing invented (cut ${cut})`);
  }
});

test('B3b one flipped byte in record k: records before k read, k and the rest reported, nothing invented', () => {
  const h = fresh('f'); for (let i = 0; i < 6; i++) note(h, `a${i}`, i);
  const full = fs.readFileSync(h.file), recs = phbRecords(full).records;
  const inOrder = phbToJsonl(full, tmp('order-')).trim().split('\n').map((l) => JSON.parse(l).id); // record i <-> entry i (entries only here)
  assert.equal(inOrder.length, recs.length);
  for (const k of [1, 3, recs.length - 1]) for (const pos of [recs[k].offset, Math.floor((recs[k].offset + recs[k].end) / 2), recs[k].end - 13]) {
    const bad = Buffer.from(full); bad[pos] ^= 0x5a;
    const d = tmp('flip-'); fs.writeFileSync(path.join(d, 'f.phb'), bad);
    const r = open('t', { dir: d, writer: 'reader', frame: false });
    const got = new Set(ids(r));
    for (let i = 0; i < k; i++) assert.ok(got.has(inOrder[i]), `record ${i} before the flip at ${pos} is read`);
    assert.equal(got.size, k, `nothing at or after record ${k} is read (flip at ${pos})`);
    assert.ok(status(r).corrupt >= 1);
  }
});
const phbToJsonl = (buf, d) => { fs.writeFileSync(path.join(d, 'f.phb'), buf); convertFile(path.join(d, 'f.phb'), path.join(d, 'f.jsonl')); return fs.readFileSync(path.join(d, 'f.jsonl'), 'utf8'); };

test('B3c a record whose stored id does not match its content is reported, never read', () => {
  const e = raw('w', { addr: 'honest' }), forged = { ...raw('w', { addr: 'forged' }), id: e.id };
  const d = tmp('forge-'), j = path.join(d, 'src.jsonl');
  fs.writeFileSync(j, canonical(e) + '\n');
  convertFile(j, path.join(d, 'w.phb'));
  // append a validly framed and chained record that carries a forged id: only id verification can catch it
  const lib = fs.readFileSync(fileURLToPath(new URL('../lib/pharos.mjs', import.meta.url)), 'utf8');
  assert.match(lib, /const why = invalid\(e\);[\s\S]*?parsePhb/, 'decode re-verifies through invalid()');
  const h = open('t', { dir: d, writer: 'w', format: 'phb', frame: false });
  const before = entries(h).length;
  const bytes = encodeForTest(forged); appendRecordForTest(path.join(d, 'w.phb'), bytes);
  const r = open('t', { dir: d, writer: 'reader', frame: false });
  assert.equal(entries(r).length, before);
  assert.ok(status(r).corrupt >= 1);
});
// Minimal re-implementation of record framing for the forged-record test only (the format is the spec).
const varint = (n) => { const o = []; do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; o.push(b); } while (n > 0); return Buffer.from(o); };
const s = (x) => { const b = Buffer.from(String(x)); return Buffer.concat([varint(b.length), b]); };
const idr = (x) => (/^[0-9a-f]{64}$/.test(x) ? Buffer.concat([Buffer.from([0]), Buffer.from(x, 'hex')]) : Buffer.concat([Buffer.from([1]), s(x)]));
function encodeForTest(e) { return Buffer.concat([Buffer.from([1]), varint(e.v), s(e.cell), s(e.kind), s(e.addr), s(canonical(e.body)), varint(e.of.length), ...e.of.map(idr), s(canonical(e.basis)), varint(e.seen.length), ...e.seen.map(idr), s(e.by), Buffer.concat([Buffer.from([1]), s(e.at)]), idr(e.id), s('')]); }
function appendRecordForTest(file, payload) {
  const buf = fs.readFileSync(file), last = phbRecords(buf).last;
  const chain = crypto.createHash('sha256').update(Buffer.concat([last.chain, Buffer.from([1]), payload])).digest().subarray(0, 8);
  const head = Buffer.concat([Buffer.from([1]), varint(payload.length)]), size = Buffer.alloc(4); size.writeUInt32BE(head.length + payload.length + 12);
  fs.appendFileSync(file, Buffer.concat([head, payload, chain, size]));
}

test('B6 two PHB writers never share a file, and each file holds only its writer', () => {
  const dir = tmp('two-'), a = fresh('alice', dir), b = fresh('bob', dir);
  note(a, 'x', 1); note(b, 'x', 2);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['alice.phb', 'bob.phb']);
  for (const [f, who] of [['alice.phb', 'alice'], ['bob.phb', 'bob']]) {
    const d = tmp('one-'); convertFile(path.join(dir, f), path.join(d, 'x.jsonl'));
    for (const line of fs.readFileSync(path.join(d, 'x.jsonl'), 'utf8').trim().split('\n')) assert.equal(JSON.parse(line).by, who);
  }
});

test('B6 corrupt bytes in a PHB file are reported, not fatal; a frame written straight to a PHB file is read', () => {
  const h = fresh('c'); note(h, 'ok', 1);
  fs.appendFileSync(h.file, Buffer.from('{"this is": not a record'));
  const r = open('t', { dir: h.dir, writer: 'reader', frame: false });
  assert.ok(status(r).corrupt >= 1);
  assert.ok(entries(r).some((e) => e.addr === 'ok'));
  note(h, 'after', 2);
  assert.ok(entries(open('t', { dir: h.dir, writer: 'reader2', frame: false })).some((e) => e.addr === 'after'));
});

test('B6 CLI writes PHB under PHAROS_FORMAT=phb to the per-host file', () => {
  const dir = tmp('cli-'), bin = fileURLToPath(new URL('../bin/pharos.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [bin, 'init', '--dir', dir], { encoding: 'utf8', env: { ...process.env, PHAROS_FORMAT: 'phb' } });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readdirSync(dir), [`cli-${os.hostname().split('.')[0]}.phb`]);
});

test('B6 cached reads see PHB appends from another writer', () => {
  const dir = tmp('cache-'), a = fresh('a', dir), b = fresh('b', dir);
  const before = entries(a).length;
  note(b, 'from-b', 1);
  assert.equal(entries(a).length, before + 1);
  note(b, 'again', 2); note(a, 'mine', 3);
  assert.equal(entries(b).length, before + 3);
});

test('B7 blobs: round trip, one copy of the same bytes, merge copies them, damage is detected', () => {
  const h = fresh('blob'), data = crypto.randomBytes(5000);
  const k = putBlob(h, data);
  assert.equal(k, crypto.createHash('sha256').update(data).digest('hex'));
  assert.ok(getBlob(h, k).equals(data));
  const size = fs.statSync(h.blobFile).size; assert.equal(putBlob(h, data), k); assert.equal(fs.statSync(h.blobFile).size, size, 'stored once');
  const other = fresh('other', tmp()); assert.equal(merge(other, h).blobs, 1); assert.ok(getBlob(other, k).equals(data));
  const bad = fs.readFileSync(h.blobFile); bad[bad.length - 100] ^= 1;
  const d = tmp('badblob-'); fs.writeFileSync(path.join(d, 'blob.phb'), bad);
  assert.equal(getBlob(open('t', { dir: d, writer: 'r', frame: false }), k), null);
});

test('B8 walking backward by size visits exactly the forward records, reversed', () => {
  const h = fresh('back'); for (let i = 0; i < 25; i++) note(h, `b${i}`, { i, pad: 'x'.repeat(i * 37) });
  putBlob(h, crypto.randomBytes(300));
  const buf = fs.readFileSync(h.file);
  assert.deepEqual(phbBackward(buf).map((r) => r.offset), phbRecords(buf).records.map((r) => r.offset).reverse());
  // after damage and a resync, a backward walk from the end reaches back to the resync and no further (the bytes
  // before it are not records); every record it visits is one the forward walk also verified
  fs.appendFileSync(h.file, Buffer.from([1, 2, 3])); note(h, 'after-resync', 1);
  const buf2 = fs.readFileSync(h.file), back = phbBackward(buf2).map((r) => r.offset), fwd = phbRecords(buf2).records.map((r) => r.offset);
  assert.deepEqual(back, fwd.filter((o) => o > buf.length).reverse());
  assert.ok(back.length >= 2, 'the resync record and the entry after it');
});

// ---- S2: the backward reader (ledgers/pharos-binary/PREREG-S2.md) ---------------------------------------------------------

test('S2 askHeads equals the full-view heads: sequential updates, a fork of two concurrent writers merged in, retractions', () => {
  const dir = tmp('s2a-'), A = fresh('a', dir), B = fresh('b', dir), C = fresh('c', dir), hs = [A, B, C];
  for (let i = 0; i < 60; i++) note(hs[i % 3], `x${i % 5}`, { i });
  const mk = (w) => { const d = tmp('s2fork-'); fs.cpSync(dir, d, { recursive: true }); return open('t', { dir: d, writer: w, format: 'phb', frame: false }); };
  const FA = mk('fa'), FB = mk('fb');
  for (let i = 0; i < 5; i++) { note(FA, 'x1', { fa: i }); note(FB, 'x1', { fb: i }); }
  for (let i = 0; i < 10; i++) note(hs[i % 3], 'x2', { main: i });
  merge(A, FA); merge(A, FB);
  const r = weave(B, { cell: 'NUL·Figure', kind: 'retract', addr: 'retract:1', body: null, of: [fold(B, { addr: 'x3' }).entries.at(-1).id] });
  weave(C, { cell: 'NUL·Figure', kind: 'retract', addr: 'retract:2', body: null, of: [r.id] });          // a retraction retracted: x3 is live again
  weave(A, { cell: 'NUL·Figure', kind: 'retract', addr: 'retract:3', body: null, of: [fold(A, { addr: 'x4' }).entries.at(-1).id] });
  const R = open('t', { dir, writer: 'r', frame: false, format: 'phb' });
  for (const a of ['x0', 'x1', 'x2', 'x3', 'x4', 'absent']) assert.deepEqual(askHeads(R, a, 'INS·Figure').heads, heads(R, a, 'INS·Figure'), `address ${a}`);
  assert.ok(heads(R, 'x1', 'INS·Figure').length >= 2, 'the fork left rival heads, which the reader must find');
});

test('S2 a recently updated address is answered from the newest records only', () => {
  const dir = tmp('s2b-'), ws = ['a', 'b', 'c'].map((w) => fresh(w, dir));
  for (let i = 0; i < 400; i++) note(ws[i % 3], `x${i % 40}`, { i });
  const last = note(ws[0], 'hot', { last: true });
  const R = open('t', { dir, writer: 'r', frame: false, format: 'phb' }), g = askHeads(R, 'hot', 'INS·Figure');
  assert.deepEqual(g.heads, [last.id]);
  assert.equal(g.early, true);
  assert.ok(g.touched / g.total < 0.1, `read ${(100 * g.touched / g.total).toFixed(1)}% of the bytes`);
});

test('S2 an unchained record proves nothing: a rival head hidden below it is found (the targeted check for trusting every record)', () => {
  const A1 = raw('fa', { at: '2026-01-01T00:00:01.000Z', addr: 'X', body: { a: 1 } }), B1 = raw('fb', { at: '2026-01-01T00:00:02.000Z', addr: 'X', body: { b: 1 } });
  const H = raw('w', { at: '2026-01-01T00:00:03.000Z', addr: 'X', body: { h: 1 }, seen: [B1.id] });   // descends from B1, not from A1
  const d = tmp('s2hid-'), j = path.join(d, 'src.jsonl'); fs.writeFileSync(j, [A1, B1, H].map(canonical).join('\n') + '\n'); convertFile(j, path.join(d, 'w.phb'));
  fs.rmSync(j);
  const R = open('t', { dir: d, writer: 'r', frame: false, format: 'phb' }), want = heads(R, 'X', 'INS·Figure');
  assert.deepEqual(want, [A1.id, H.id].sort());
  assert.deepEqual(askHeads(R, 'X', 'INS·Figure').heads, want, 'H is the newest record, but A1 is not an ancestor of it');
});

test('S2 damage met on the way falls back to the full view, saying so', () => {
  const h = fresh('dmg'); for (let i = 0; i < 12; i++) note(h, 'y', { i });
  // the reader proves its answer from the newest record alone when every record is chained, so damage it never has to read is never met;
  // damage the NEWEST record (the one it must read first)
  const buf = fs.readFileSync(h.file), recs = phbRecords(buf).records, last = recs.at(-1); buf[last.offset + 3] ^= 0x33; fs.writeFileSync(h.file, buf);
  const R = open('t', { dir: h.dir, writer: 'r', frame: false, format: 'phb' }), g = askHeads(R, 'y', 'INS·Figure');
  assert.ok(g.fallback, 'a broken record is met on the way in and the answer says it fell back');
  assert.deepEqual(g.heads, heads(R, 'y', 'INS·Figure'));
});
