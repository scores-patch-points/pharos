import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { open, weave, fold, merge, entries, status, ground, frame, watch, install, undo, canonical, entryId, libHash, PharosError } from '../lib/pharos.mjs';

const tmp = (p = 'p-') => fs.mkdtempSync(path.join(os.tmpdir(), 'pharos-' + p));
const note = (h, addr, body, extra = {}) => weave(h, { cell: 'INS·Figure', kind: 'note', addr, body, ...extra });
// A pharos with a declared 'note' kind (at INS·Figure) and 'score' kind (at EVA·Figure).
function fresh(writer = 'a', dir = tmp()) {
  const h = open('t', { dir, writer });
  weave(h, { cell: 'DEF·Figure', kind: 'kind', addr: 'kind:note', body: { name: 'note', cell: 'INS·Figure' } });
  weave(h, { cell: 'DEF·Figure', kind: 'kind', addr: 'kind:score', body: { name: 'score', cell: 'EVA·Figure' } });
  return h;
}
const cloneAs = (h, writer) => { const dir = tmp(); fs.cpSync(h.dir, dir, { recursive: true }); return open('t', { dir, writer }); };
const ids = (h) => entries(h).map((e) => e.id);
const rejects = (fn, code) => assert.throws(fn, (e) => e instanceof PharosError && e.code === code, `expected ${code}`);

test('canonical JSON is deterministic and ids are content hashes', () => {
  assert.equal(canonical({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } }), canonical({ a: { c: [3, { y: 2, z: 1 }], d: 2 }, b: 1 }));
  const h = fresh();
  const e = note(h, 'x', { k: 1, j: 2 });
  assert.equal(e.id, crypto.createHash('sha256').update(canonical(Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'id')))).digest('hex'));
  const shuffled = Object.fromEntries(Object.entries(e).reverse());
  assert.equal(entryId(shuffled), e.id);
  assert.equal(e.v, 1);
  assert.equal(e.by, 'a');
});

test('the first entry is the frame; kinds, holons and frame are entries', () => {
  const h = fresh();
  assert.equal(entries(h)[0].kind, 'frame');
  weave(h, { cell: 'DEF·Pattern', kind: 'holon', addr: 'holon:r', body: { name: 'r', ground: ['note'], figure: [], pattern: ['score'], out: [] } });
  const g = ground(h);
  assert.deepEqual(g.kinds.map((k) => k.name).sort(), ['frame', 'holon', 'kind', 'note', 'retract', 'score']);
  assert.equal(g.holons[0].name, 'r');
  assert.equal(frame(h).name, 't');
  rejects(() => weave(h, { cell: 'NUL·Ground', kind: 'frame', addr: 'f', body: { name: 'x' } }), 'FRAME_EXISTS');
});

test('unknown cell and undeclared kind are typed errors', () => {
  const h = fresh();
  rejects(() => weave(h, { cell: 'XXX·Nope', kind: 'note', addr: 'x', body: 1 }), 'UNKNOWN_CELL');
  rejects(() => weave(h, { cell: 'INS·Figure', kind: 'nope', addr: 'x', body: 1 }), 'UNDECLARED_KIND');
  rejects(() => weave(h, { cell: 'REC·Figure', kind: 'note', addr: 'x', body: 1 }), 'KIND_CELL_MISMATCH');
  rejects(() => weave(h, { cell: 'INS·Figure', kind: 'note', addr: 'x', body: 1, of: ['0'.repeat(64)] }), 'UNKNOWN_OF');
});

test('seen and at are computed; caller-supplied values are rejected', () => {
  const h = fresh();
  const a = note(h, 'x', 1);
  const b = note(h, 'y', 2);
  assert.deepEqual(b.seen, [a.id]);
  assert.ok(!Number.isNaN(Date.parse(b.at)));
  rejects(() => note(h, 'z', 3, { seen: [] }), 'COMPUTED_FIELD');
  rejects(() => note(h, 'z', 3, { at: '2000-01-01T00:00:00Z' }), 'COMPUTED_FIELD');
  rejects(() => note(h, 'z', 3, { id: 'abc' }), 'COMPUTED_FIELD');
  rejects(() => note(h, 'z', 3, { by: 'someone' }), 'COMPUTED_FIELD');
});

test('duplicate weave is idempotent', () => {
  const h = fresh();
  const a = note(h, 'x', { n: 1 });
  const b = note(h, 'x', { n: 1 });
  assert.equal(a.id, b.id);
  assert.equal(entries(h).filter((e) => e.kind === 'note').length, 1);
  // a duplicated line (as after copying a file twice) dedups by id on read
  fs.appendFileSync(h.file, JSON.stringify(a) + '\n');
  assert.equal(entries(h).filter((e) => e.kind === 'note').length, 1);
});

test('causal order beats cell rank', () => {
  const h = fresh();
  weave(h, { cell: 'EVA·Figure', kind: 'score', addr: 'late', body: 1 }); // rank 22
  const hi = weave(h, { cell: 'EVA·Figure', kind: 'score', addr: 'hi', body: 2 });
  const lo = note(h, 'lo', 3); // rank 7 but written after hi, so it follows it
  const o = ids(h);
  assert.ok(o.indexOf(hi.id) < o.indexOf(lo.id));
  const e3 = note(h, 'c', 4, { of: [hi.id] });
  assert.ok(ids(h).indexOf(hi.id) < ids(h).indexOf(e3.id));
});

test('concurrent entries break ties by cell rank then id', () => {
  const base = fresh('base');
  const A = cloneAs(base, 'a'), B = cloneAs(base, 'b');
  const x = weave(A, { cell: 'EVA·Figure', kind: 'score', addr: 'x', body: 'x' }); // rank 22
  const y = note(B, 'y', 'y'); // rank 7
  merge(A, B);
  const o = ids(A);
  assert.ok(o.indexOf(y.id) < o.indexOf(x.id), 'lower rank first when concurrent');
  // equal rank: id order
  const C = cloneAs(base, 'c'), D = cloneAs(base, 'd');
  const p = note(C, 'p', 1), q = note(D, 'q', 2);
  merge(C, D);
  const [first, second] = [p.id, q.id].sort();
  const oc = ids(C);
  assert.ok(oc.indexOf(first) < oc.indexOf(second));
  // and the order is the same from the other side
  merge(D, C);
  assert.deepEqual(ids(C), ids(D));
});

test('concurrent disagreement is reported, not resolved; sequential update is not a conflict', () => {
  const base = fresh('base');
  const A = cloneAs(base, 'a'), B = cloneAs(base, 'b');
  const x = note(A, 'thing', 'one');
  const y = note(B, 'thing', 'two');
  merge(A, B);
  const f = fold(A);
  assert.equal(f.conflicts.length, 1);
  assert.deepEqual([f.conflicts[0].a, f.conflicts[0].b].sort(), [x.id, y.id].sort());
  assert.equal(f.conflicts[0].addr, 'thing');
  assert.ok(f.entries.some((e) => e.id === x.id) && f.entries.some((e) => e.id === y.id), 'both kept');
  assert.equal(status(A).conflicts, 1);
  // same body concurrently: agreement
  const C = cloneAs(base, 'c'), D = cloneAs(base, 'd');
  note(C, 'same', 'v'); note(D, 'same', 'v');
  merge(C, D);
  assert.equal(fold(C).conflicts.length, 0);
  // a later write that has seen the earlier one is an update
  const h = fresh();
  note(h, 'k', 'old'); note(h, 'k', 'new');
  assert.equal(fold(h).conflicts.length, 0);
});

test('retraction removes from the fold and is itself retractable', () => {
  const h = fresh();
  const n = note(h, 'x', 1);
  const keep = note(h, 'y', 2);
  const r = weave(h, { cell: 'NUL·Figure', kind: 'retract', addr: 'x', body: { why: 'wrong' }, of: [n.id] });
  let f = fold(h);
  assert.ok(!f.entries.some((e) => e.id === n.id));
  assert.ok(f.entries.some((e) => e.id === keep.id));
  assert.deepEqual(f.retractions.map((x) => x.id), [r.id]);
  assert.ok(ids(h).includes(n.id), 'append-only: still in the log');
  rejects(() => weave(h, { cell: 'NUL·Figure', kind: 'retract', addr: 'x', body: null }), 'BAD_ENTRY');
  weave(h, { cell: 'NUL·Figure', kind: 'retract', addr: 'x', body: null, of: [r.id] });
  f = fold(h);
  assert.ok(f.entries.some((e) => e.id === n.id), 'retracting the retraction restores it');
});

// small seeded PRNG so random sets are reproducible
const prng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

function randomPharos(rand, writer, base) {
  const h = cloneAs(base, writer);
  const mine = [];
  const n = 2 + Math.floor(rand() * 6);
  for (let i = 0; i < n; i++) {
    const of = mine.length && rand() < 0.4 ? [mine[Math.floor(rand() * mine.length)]] : [];
    const e = rand() < 0.5
      ? note(h, `a${Math.floor(rand() * 4)}`, Math.floor(rand() * 3), { of })
      : weave(h, { cell: 'EVA·Figure', kind: 'score', addr: `s${Math.floor(rand() * 3)}`, body: Math.floor(rand() * 3), of });
    mine.push(e.id);
  }
  if (rand() < 0.3) weave(h, { cell: 'NUL·Figure', kind: 'retract', addr: 'r', body: null, of: [mine[0]] });
  return h;
}
const target = () => open('t', { dir: tmp('m-'), writer: 'm', frame: false });
const sorted = (h) => ids(h).slice().sort();

test('merge is commutative, associative and idempotent on random sets', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const rand = prng(seed);
    const base = fresh('base');
    const [A, B, C] = ['a', 'b', 'c'].map((w) => randomPharos(rand, w, base));
    // commutative
    const ab = target(); merge(ab, A); merge(ab, B);
    const ba = target(); merge(ba, B); merge(ba, A);
    assert.deepEqual(sorted(ab), sorted(ba), `commutative seed ${seed}`);
    assert.deepEqual(ids(ab), ids(ba), 'same set, same order');
    assert.deepEqual(fold(ab).entries.map((e) => e.id), fold(ba).entries.map((e) => e.id));
    // associative: (A+B)+C == A+(B+C)
    const left = target(); merge(left, A); merge(left, B); merge(left, C);
    const bc = target(); merge(bc, B); merge(bc, C);
    const right = target(); merge(right, A); merge(right, bc);
    assert.deepEqual(sorted(left), sorted(right), `associative seed ${seed}`);
    // idempotent
    const before = sorted(left);
    assert.equal(merge(left, A).added, 0);
    assert.equal(merge(left, left).added, 0);
    assert.deepEqual(sorted(left), before, `idempotent seed ${seed}`);
    // and equals the plain union of the inputs
    assert.deepEqual(before, [...new Set([...ids(A), ...ids(B), ...ids(C)])].sort());
  }
});

test('two writers never share a file', () => {
  const dir = tmp();
  const a = open('t', { dir, writer: 'alice' });
  const b = open('t', { dir, writer: 'bob' });
  weave(a, { cell: 'DEF·Figure', kind: 'kind', addr: 'kind:note', body: { name: 'note', cell: 'INS·Figure' } });
  note(a, 'x', 1); note(b, 'y', 2); note(a, 'z', 3); note(b, 'w', 4);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['alice.jsonl', 'bob.jsonl']);
  for (const [f, who] of [['alice.jsonl', 'alice'], ['bob.jsonl', 'bob']]) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(lines.length > 0 && lines.every((e) => e.by === who), `${f} holds only ${who}'s entries`);
  }
  assert.equal(status(a).writers.length, 2);
  // a merge writes only into the target's own writer file
  const other = fresh('carol');
  const tgt = fresh('dave');
  merge(tgt, other);
  assert.deepEqual(fs.readdirSync(tgt.dir), ['dave.jsonl']);
});

test('watch sees only new entries', () => {
  const dir = tmp();
  const h = fresh('a', dir);
  note(h, 'old', 1);
  const got = [];
  const w = watch(h, {}, (e) => got.push(e));
  assert.equal(w.poll(), 0, 'nothing old is replayed');
  const n = note(h, 'new', 2);
  const other = open('t', { dir, writer: 'b' });
  weave(other, { cell: 'EVA·Figure', kind: 'score', addr: 's', body: 1 });
  assert.equal(w.poll(), 2);
  assert.ok(got.some((e) => e.id === n.id));
  assert.equal(w.poll(), 0, 'and only once');
  const filtered = [];
  const w2 = watch(h, { kind: 'score' }, (e) => filtered.push(e));
  note(h, 'again', 3);
  weave(h, { cell: 'EVA·Figure', kind: 'score', addr: 's2', body: 1 });
  w2.poll();
  assert.deepEqual(filtered.map((e) => e.kind), ['score']);
  const replay = [];
  const w3 = watch(h, { since: 'beginning', kind: 'frame' }, (e) => replay.push(e));
  w3.poll();
  assert.equal(replay.length, 1);
  w.stop(); w2.stop(); w3.stop();
});

function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) { out[path.relative(dir, p) + '/'] = null; walk(p); }
      else out[path.relative(dir, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

test('install then undo leaves the target byte-identical', () => {
  for (const withHolon of [false, true]) {
    const dir = tmp('repo-');
    fs.writeFileSync(path.join(dir, 'index.js'), 'console.log(1)\n');
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'x.txt'), 'x');
    if (withHolon) fs.writeFileSync(path.join(dir, 'holon.json'), '{"name":"mine"}\n');
    const before = snapshot(dir);
    const r = install(dir);
    assert.ok(fs.existsSync(path.join(dir, 'pharos.json')));
    assert.ok(fs.existsSync(path.join(dir, 'holon.json')));
    const ptr = JSON.parse(fs.readFileSync(path.join(dir, 'pharos.json'), 'utf8'));
    assert.equal(ptr.sha256, libHash());
    assert.equal(r.skipped.includes('holon.json'), withHolon);
    rejects(() => install(dir), 'ALREADY_INSTALLED');
    const u = undo(dir);
    assert.ok(u.removed.includes('pharos.json'));
    assert.deepEqual(snapshot(dir), before);
  }
});

test('undo leaves a holon.json the repo has since edited', () => {
  const dir = tmp('repo-');
  install(dir);
  fs.writeFileSync(path.join(dir, 'holon.json'), '{"name":"edited"}\n');
  const u = undo(dir);
  assert.deepEqual(u.kept, ['holon.json']);
  assert.ok(!fs.existsSync(path.join(dir, 'pharos.json')));
});

test('a corrupt JSONL line is reported, not fatal', () => {
  const h = fresh();
  note(h, 'x', 1);
  fs.appendFileSync(h.file, '{"this is": not json\n');
  fs.appendFileSync(h.file, JSON.stringify({ v: 1, cell: 'INS·Figure', kind: 'note', addr: 'forged', body: 1, of: [], basis: {}, seen: [], by: 'a', at: 'x', id: 'deadbeef' }) + '\n');
  fs.appendFileSync(h.file, '{"torn": '); // no trailing newline: a torn write
  const f = fold(h);
  assert.equal(f.corrupt.length, 3);
  assert.deepEqual(f.corrupt.map((c) => c.reason), ['unparseable JSON', 'id does not match content', 'unparseable JSON']);
  assert.ok(f.entries.some((e) => e.addr === 'x'));
  assert.equal(status(h).corrupt, 3);
  const after = note(h, 'after', 2); // weaving still works and does not glue onto the torn line
  assert.ok(fold(h).entries.some((e) => e.id === after.id));
});

test('a pharos with no frame refuses entries until one arrives', () => {
  const bare = open('t', { dir: tmp(), writer: 'm', frame: false });
  rejects(() => weave(bare, { cell: 'DEF·Figure', kind: 'kind', addr: 'k', body: { name: 'q', cell: 'INS·Figure' } }), 'NO_FRAME');
  merge(bare, fresh('z'));
  assert.equal(frame(bare).name, 't');
});

// ---- regressions -----------------------------------------------------------

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'pharos.mjs');
const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'pharos.mjs');
const raw = (dir, writer, entry) => { // a hand-built, valid entry in another writer's file
  const e = { v: 1, cell: 'INS·Figure', kind: 'note', of: [], basis: {}, at: new Date().toISOString(), by: writer, ...entry };
  e.id = entryId(e);
  fs.appendFileSync(path.join(dir, writer + '.jsonl'), canonical(e) + '\n');
  return e;
};

test('fold and status survive a long causal chain with an updated addr', () => {
  const h = fresh();
  let prev = entries(h).at(-1).id;
  for (let i = 0; i < 6000; i++) prev = raw(h.dir, 'chain', { addr: i < 2 ? 'x' : 'a' + i, body: i, seen: [prev] }).id;
  const t = Date.now();
  assert.equal(fold(h).conflicts.length, 0);
  assert.equal(status(h).conflicts, 0);
  assert.ok(Date.now() - t < 10000);
});

test('concurrent heads still conflict, older updated entries do not', () => {
  const h = fresh();
  const base = entries(h).at(-1).id;
  const a1 = raw(h.dir, 'w1', { addr: 'x', body: 1, seen: [base] });
  const a2 = raw(h.dir, 'w1', { addr: 'x', body: 2, seen: [a1.id] });
  const b = raw(h.dir, 'w2', { addr: 'x', body: 3, seen: [base] });
  const c = fold(h).conflicts;
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].a, c[0].b].sort(), [a2.id, b.id].sort());
});

test('re-weaving an earlier value after a change is a revert, not a no-op', () => {
  const h = fresh();
  const one = note(h, 'x', 1);
  note(h, 'x', 2);
  const again = note(h, 'x', 1);
  assert.notEqual(again.id, one.id);
  assert.deepEqual(fold(h, { addr: 'x' }).entries.map((e) => e.body), [1, 2, 1]);
  assert.equal(note(h, 'x', 1).id, again.id, 'repeating the latest value is still a no-op');
});

test('open is safe to race and several frames are not conflicts', async () => {
  const dir = tmp();
  const code = `import { open } from ${JSON.stringify(LIB)}; open('t', { dir: ${JSON.stringify(dir)}, writer: process.argv[1] });`;
  const codes = await Promise.all(['p1', 'p2', 'p3', 'p4'].map((w) => new Promise((res) => {
    const c = spawn(process.execPath, ['--input-type=module', '-e', code, w], { stdio: 'ignore' });
    c.on('close', res);
  })));
  assert.deepEqual(codes, [0, 0, 0, 0]);
  const h = open('t', { dir, writer: 'p1' });
  assert.equal(status(h).conflicts, 0);
  const d = tmp();
  const a = open('t', { dir: d, writer: 'a' });
  raw(d, 'b', { cell: 'NUL·Ground', kind: 'frame', addr: 'frame:t', body: { name: 't', epoch: 'other', assumed: [] }, seen: [] });
  assert.equal(status(a).frames, 2);
  assert.equal(status(a).conflicts, 0);
});

test('open declares the protocol kinds, and a frame-only pharos can retract', () => {
  const d = tmp();
  const h = open('t', { dir: d, writer: 'a', frame: false });
  const f = weave(h, { cell: 'NUL·Ground', kind: 'frame', addr: 'frame:t', body: { name: 't', epoch: 'e', assumed: [] } });
  const r = weave(h, { cell: 'NUL·Figure', kind: 'retract', addr: 'r', body: null, of: [f.id] });
  assert.equal(r.kind, 'retract');
});

test('the protocol cannot retract itself out of retracting', () => {
  const h = fresh();
  const decl = entries(h).find((e) => e.kind === 'kind' && e.body.name === 'retract');
  const r1 = weave(h, { cell: 'NUL·Figure', kind: 'retract', addr: 'r1', body: null, of: [decl.id] });
  const r2 = weave(h, { cell: 'NUL·Figure', kind: 'retract', addr: 'r2', body: null, of: [r1.id] });
  assert.equal(r2.kind, 'retract');
  weave(h, { cell: 'DEF·Pattern', kind: 'holon', addr: 'h', body: { name: 'h' } });
});

test('frame and ground tolerate a foreign frame with a null body', () => {
  const h = fresh();
  raw(h.dir, 'foreign', { cell: 'NUL·Ground', kind: 'frame', addr: 'frame:z', body: null, seen: [] });
  assert.equal(status(h).frames, 2);
  const f = frame(h);
  assert.equal(f.merged.length + 1, 2);
  assert.doesNotThrow(() => ground(h));
});

test('weave rejects values that are not plain JSON', () => {
  const h = fresh();
  for (const body of [{ s: new Map([[1, 2]]) }, new Date(), new Set([1]), new (class A { constructor() { this.x = 1; } })(), [1, , 3]]) {
    rejects(() => note(h, 'x', body), 'BAD_JSON');
  }
  assert.equal(note(h, 'x', Object.create(null)).body !== undefined, true);
});

test('cached reads see appends from other writers and file rewrites', () => {
  const h = fresh();
  note(h, 'x', 1);
  assert.equal(entries(h).length, 8);
  const e = raw(h.dir, 'other', { addr: 'y', body: 1, seen: [] });
  assert.ok(ids(h).includes(e.id));
  fs.appendFileSync(path.join(h.dir, 'other.jsonl'), 'garbage\n');
  assert.deepEqual(status(h).corrupt, 1);
  assert.equal(load_corrupt_line(h), 2);
  fs.writeFileSync(path.join(h.dir, 'other.jsonl'), '');
  assert.ok(!ids(h).includes(e.id));
  assert.equal(status(h).corrupt, 0);
  fs.appendFileSync(h.file, '{"torn":');
  note(h, 'z', 1);
  assert.equal(status(h).corrupt, 1);
});
const load_corrupt_line = (h) => fold(h).corrupt[0].line;

test('CLI: per-host writer, flags need values, fs errors are JSON', () => {
  const dir = tmp();
  const run = (...a) => spawnSync(process.execPath, [BIN, ...a], { encoding: 'utf8', env: { ...process.env, PHAROS_WRITER: '' } });
  let r = run('init', '--dir', dir);
  assert.equal(r.status, 0);
  const files = fs.readdirSync(dir);
  assert.deepEqual(files, [`cli-${os.hostname().split('.')[0]}.jsonl`]);
  for (const bad of [['status', '--dir'], ['init', '--name'], ['weave', '--dir', dir, '--body']]) {
    r = run(...bad);
    assert.equal(r.status, 1, bad.join(' '));
    assert.equal(JSON.parse(r.stderr).error.code, 'USAGE');
  }
  assert.ok(!fs.existsSync(path.join(os.homedir(), '.pharos', 'true')));
  const f = path.join(tmp(), 'file');
  fs.writeFileSync(f, 'x');
  r = run('init', '--dir', path.join(f, 'sub'));
  assert.equal(r.status, 1);
  assert.ok(JSON.parse(r.stderr).error.code);
  assert.doesNotMatch(r.stderr, /at .*\.mjs/);
});

test('install treats a dangling symlink as present and never leaves an orphan', () => {
  const d = tmp('inst-');
  fs.symlinkSync(path.join(d, 'nowhere'), path.join(d, 'pharos.json'));
  rejects(() => install(d), 'ALREADY_INSTALLED');
  assert.ok(!fs.existsSync(path.join(d, 'holon.json')));
  const d2 = tmp('inst-');
  fs.symlinkSync(path.join(d2, 'nowhere'), path.join(d2, 'holon.json'));
  const r = install(d2);
  assert.deepEqual(r.skipped, ['holon.json']);
  undo(d2);
  assert.deepEqual(fs.readdirSync(d2), ['holon.json']);
});
