import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chatter, readChatter } from '../lib/chatter.mjs';
import * as P from '../lib/pharos.mjs';

process.env.PHAROS_CHATTER = fs.mkdtempSync(path.join(os.tmpdir(), 'pharos-chatter-default-')); // a call with no dir never reaches the real ~/.pharos
const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'pharos.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pharos-chatter-'));

test('a chatter line is written and read back, newest last, with the writer as provenance', () => {
  const dir = tmp();
  assert.equal(chatter({ level: 'warn', where: 'khora/read-process', what: 'read_refused_unprimed', detail: { missing: ['no_pos_prior'] } }, { dir, writer: 'w1' }).ok, true);
  assert.equal(chatter({ level: 'info', where: 'janus', what: 'x' }, { dir, writer: 'w2' }).ok, true);
  const r = readChatter({ dir });
  assert.equal(r.length, 2); assert.equal(r[0].what, 'read_refused_unprimed'); assert.deepEqual(r[0].detail, { missing: ['no_pos_prior'] }); assert.equal(r[0].writer, 'w1');
  assert.equal(readChatter({ dir, level: 'warn' }).length, 1, 'level filters upward');
  assert.equal(readChatter({ dir, where: 'janus' }).length, 1);
});

test('chatter is NOT data: no id, no causal fields, and it never enters the log or its status', () => {
  const dir = tmp(); const h = P.open('t', { dir, writer: 'w' }); const before = JSON.stringify(P.status(h));
  chatter({ where: 'a', what: 'b' }, { dir: path.join(dir, 'chatter'), writer: 'w' });
  assert.equal(JSON.stringify(P.status(h)), before, 'the log status is unchanged by chatter');
  const [l] = readChatter({ dir: path.join(dir, 'chatter') });
  for (const k of ['id', 'seen', 'of', 'cell', 'basis']) assert.ok(!(k in l), `${k} is not a chatter field`);
  assert.equal(P.entries(h).some((e) => e.kind === 'chatter'), false);
});

test('chatter NEVER throws and never blocks the caller: an unwritable place, a circular detail, junk input', () => {
  const file = path.join(tmp(), 'a-file'); fs.writeFileSync(file, 'x');
  const r1 = chatter({ where: 'a', what: 'b' }, { dir: path.join(file, 'under-a-file') }); assert.equal(r1.ok, false);
  const circ = {}; circ.self = circ; assert.doesNotThrow(() => chatter({ where: 'a', what: 'b', detail: circ }, { dir: tmp() }));
  assert.doesNotThrow(() => chatter(undefined, { dir: tmp() })); assert.doesNotThrow(() => chatter(null));
});

test('chatter is bounded: a huge detail is cut and marked, a big file rotates and keeps one generation', () => {
  const dir = tmp();
  chatter({ where: 'a', what: 'big', detail: 'x'.repeat(100000) }, { dir, writer: 'w' });
  const [l] = readChatter({ dir }); assert.equal(l.cut, true); assert.ok(JSON.stringify(l).length <= 8 * 1024 + 64);
  const f = path.join(dir, 'w.log'); fs.writeFileSync(f, ('y'.repeat(1000) + '\n').repeat(1100));
  chatter({ where: 'a', what: 'after' }, { dir, writer: 'w' });
  assert.ok(fs.existsSync(f + '.1'), 'rotated'); assert.ok(fs.statSync(f).size < 2000, 'the live file starts again');
});

test('a torn line is skipped, never repaired or thrown', () => {
  const dir = tmp(); chatter({ where: 'a', what: 'one' }, { dir, writer: 'w' }); fs.appendFileSync(path.join(dir, 'w.log'), '{"at":"torn');
  assert.equal(readChatter({ dir }).length, 1);
});

test('the CLI writes and reads chatter', () => {
  const dir = tmp();
  const w = spawnSync(process.execPath, [BIN, 'chatter-write', '--dir', dir, '--where', 'khora', '--what', 'door_wrong', '--level', 'error', '--detail', '{"door":"readAtoms"}'], { encoding: 'utf8' });
  assert.equal(w.status, 0, w.stderr); assert.equal(JSON.parse(w.stdout).ok, true);
  const r = spawnSync(process.execPath, [BIN, 'chatter', '--dir', dir, '--tail', '5'], { encoding: 'utf8' });
  const lines = JSON.parse(r.stdout); assert.equal(lines.length, 1); assert.equal(lines[0].what, 'door_wrong'); assert.equal(lines[0].detail.door, 'readAtoms');
  const bad = spawnSync(process.execPath, [BIN, 'chatter-write', '--dir', dir], { encoding: 'utf8' }); assert.notEqual(bad.status, 0); assert.match(bad.stderr, /USAGE/, 'a usage error without --where and --what');
});
