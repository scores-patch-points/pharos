import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gate, ack, rulesHash } from '../lib/gate.mjs';
import { readChatter } from '../lib/chatter.mjs';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'pharos.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pharos-gate-'));
function repo({ holon, files = { 'door.mjs': 'export function read() {}\n' } } = {}) {
  const dir = tmp();
  for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); }
  if (holon !== undefined) fs.writeFileSync(path.join(dir, 'holon.json'), JSON.stringify(holon));
  return dir;
}
const good = (extra = {}) => ({ name: 'demo', door: 'door.mjs#read', needs: [], rules: rulesHash(), ...extra });
const ch = () => tmp();

test('a repo that declares its door, has what it needs and acknowledged the current rules may work', () => {
  assert.deepEqual(gate(repo({ holon: good() }), { chatter: false }).failures, []);
});

test('ONE-DOOR: no holon.json, no door, a missing door file, an export that is not there: each is refused', () => {
  assert.equal(gate(repo(), { chatter: false }).failures[0].rule, 'ONE-DOOR');
  assert.match(gate(repo({ holon: good({ door: undefined }) }), { chatter: false }).failures[0].why, /no `door`/);
  assert.match(gate(repo({ holon: good({ door: 'nope.mjs#read' }) }), { chatter: false }).failures[0].why, /does not exist/);
  assert.match(gate(repo({ holon: good({ door: 'door.mjs#other' }) }), { chatter: false }).failures[0].why, /does not export other/);
  assert.equal(gate(repo({ holon: good({ door: 'door.mjs#read' }), files: { 'door.mjs': 'const read = 1; export { read };\n' } }), { chatter: false }).ok, true, 'an export list counts');
});

test('PRIMED: a missing need refuses, names what and where it looked, honours the env var and `contains`', () => {
  const need = { name: 'the priors', env: 'GATE_TEST_PRIORS', paths: ['./nowhere'], contains: ['pos-eng.json'], how: 'Clone janus beside this repo.' };
  const dir = repo({ holon: good({ needs: [need] }) });
  const r = gate(dir, { chatter: false }); assert.equal(r.ok, false); assert.equal(r.failures[0].rule, 'PRIMED');
  assert.match(r.failures[0].why, /the priors/); assert.match(r.failures[0].why, /pos-eng\.json/); assert.match(r.failures[0].why, /GATE_TEST_PRIORS/); assert.match(r.failures[0].why, /Clone janus/);
  const pri = tmp(); process.env.GATE_TEST_PRIORS = pri;
  try { assert.equal(gate(dir, { chatter: false }).ok, false, 'a folder without the file is not enough'); fs.writeFileSync(path.join(pri, 'pos-eng.json'), '{}'); assert.equal(gate(dir, { chatter: false }).ok, true); }
  finally { delete process.env.GATE_TEST_PRIORS; }
  // an env var that is set is authoritative: a good fallback path must not rescue a bad env
  const good2 = tmp(); fs.writeFileSync(path.join(good2, 'pos-eng.json'), '{}');
  const dir2 = repo({ holon: good({ needs: [{ ...need, paths: [good2] }] }) }); assert.equal(gate(dir2, { chatter: false }).ok, true, 'the fallback works when the env is unset');
  process.env.GATE_TEST_PRIORS = tmp(); try { assert.equal(gate(dir2, { chatter: false }).ok, false, 'a set but bad env is not rescued by a fallback'); } finally { delete process.env.GATE_TEST_PRIORS; }
});

test('RULES-CURRENT: a stale or missing acknowledgement refuses until ack is run on purpose', () => {
  const dir = repo({ holon: good({ rules: 'abc' }) });
  assert.equal(gate(dir, { chatter: false }).failures[0].rule, 'RULES-CURRENT');
  assert.equal(ack(dir).acknowledged, rulesHash()); assert.equal(gate(dir, { chatter: false }).ok, true);
  const dir2 = repo({ holon: good({ rules: undefined }) }); assert.match(gate(dir2, { chatter: false }).failures[0].why, /not acknowledged/);
});

test('SAY-WHEN-REFUSED: a refusal leaves a chatter line naming the rules that failed; a pass leaves none', () => {
  const c = ch(); const bad = repo({ holon: good({ rules: 'old' }) });
  gate(bad, { chatterDir: c, writer: 'g' }); const [l] = readChatter({ dir: c });
  assert.equal(l.what, 'gate_refused'); assert.equal(l.level, 'error'); assert.deepEqual(l.detail.rules, ['RULES-CURRENT']);
  const c2 = ch(); gate(repo({ holon: good() }), { chatterDir: c2 }); assert.equal(readChatter({ dir: c2 }).length, 0);
});

test('the CLI: gate exits 0 for a good repo and 1 for a refused one, and ack fixes a stale one', () => {
  const dir = repo({ holon: good({ rules: 'old' }) }); const env = { ...process.env, PHAROS_CHATTER: ch() };
  const run = (...a) => spawnSync(process.execPath, [BIN, ...a], { encoding: 'utf8', env });
  const r1 = run('gate', '--target', dir); assert.equal(r1.status, 1); assert.equal(JSON.parse(r1.stdout).ok, false);
  assert.equal(run('ack', '--target', dir).status, 0);
  const r2 = run('gate', '--target', dir); assert.equal(r2.status, 0, r2.stdout); assert.equal(JSON.parse(r2.stdout).ok, true);
  assert.notEqual(run('gate').status, 0, 'gate needs --target');
});

test('changing the rules changes the hash, so every acknowledging repo goes stale (the rules are held once, here)', () => {
  const f = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'rules', 'rules.json'); const before = fs.readFileSync(f); const h = rulesHash();
  try { fs.writeFileSync(f, before.toString().replace('ONE-DOOR', 'ONE-DOOR ')); assert.notEqual(rulesHash(), h); } finally { fs.writeFileSync(f, before); }
  assert.equal(rulesHash(), h);
});
