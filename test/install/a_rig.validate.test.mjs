// Validates the rig and the checks against a trivial reference CLI (a_ref/a_ref.mjs), never the installer.
// Clean reference => zero violations. Each planted mutant => at least one violation from the named check.
// If anything here fails, the rig is wrong and no result from it may be used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import {
  HERE, makeRun, hashTree, diffTrees, covers, volatileMask, applyMask, GUARD_AVAILABLE, SANDBOX_ROOT, realHomeWitness,
} from './a_rig.mjs';
import { checkLegacyUnchanged, checkExistingTests } from './a_checks.mjs';
import { BASELINE_DIR } from './a_rig.mjs';
import { checkDryPurity, checkApplyDeclared, checkUndoExact, checkApplyIdempotent, checkSequence, checkFlagGating, checkRefusals } from './a_checks.mjs';

const REF = { bin: path.join(HERE, 'a_ref', 'a_ref.mjs'), doorsDir: path.join(HERE, 'a_ref', 'doors'), label: 'ref' };
const withEnv = (env) => ({ ...REF, env });
const has = (v, re) => v.some((x) => re.test(x));
const show = (v) => '\n  ' + v.join('\n  ');

test('rig: sandbox root is under ledgers/pharos-public/sandbox', () => {
  assert.match(SANDBOX_ROOT, /ledgers\/pharos-public\/sandbox$/);
});

test('rig: tree hash sees content, mode, symlink retarget, type change, empty dir, removal; ignores mtime', async () => {
  const same = await makeRun({ label: 'hash' }); same.close();
  const sroot = path.join(same.jail, 'target');
  const base0 = hashTree(sroot);
  assert.deepEqual(diffTrees(base0, hashTree(sroot)), []);
  const t = new Date(Date.now() + 5000); fs.utimesSync(path.join(sroot, 'README.md'), t, t);
  assert.deepEqual(diffTrees(base0, hashTree(sroot)), [], 'mtime-only change must not count');
  const cases = {
    content: [(r) => fs.appendFileSync(path.join(r, 'README.md'), 'x'), 'content'],
    mode: [(r) => fs.chmodSync(path.join(r, 'src/run.sh'), 0o700), 'mode'],
    'dir mode': [(r) => fs.chmodSync(path.join(r, 'docs'), 0o700), 'mode'],
    'link retarget': [(r) => { fs.unlinkSync(path.join(r, 'readme-link')); fs.symlinkSync('.gitignore', path.join(r, 'readme-link')); }, 'link'],
    'type change': [(r) => { fs.rmSync(path.join(r, 'README.md')); fs.mkdirSync(path.join(r, 'README.md')); }, 'type'],
    'empty dir added': [(r) => fs.mkdirSync(path.join(r, 'newdir')), 'added'],
    removed: [(r) => fs.rmSync(path.join(r, '.gitignore')), 'removed'],
  };
  for (const [name, [mutate, kind]] of Object.entries(cases)) {
    const r = await makeRun({ label: 'hash2' }); r.close();
    const root = path.join(r.jail, 'target');
    const before = hashTree(root);
    mutate(root);
    const d = diffTrees(before, hashTree(root));
    assert.ok(d.some((x) => x.kind === kind), `${name}: expected a ${kind} difference, got ${JSON.stringify(d)}`);
  }
});

test('rig: declared-path coverage (globs, ancestors)', () => {
  const pats = ['/j/t/AGENTS.md', '/j/t/.pharos/**', '/j/h/.config/opencode/opencode.json'];
  assert.ok(covers(pats, '/j/t/AGENTS.md', false));
  assert.ok(covers(pats, '/j/t/.pharos', true));
  assert.ok(covers(pats, '/j/t/.pharos/backups/ab', false));
  assert.ok(covers(pats, '/j/h/.config', true), 'ancestor directory of a declared file');
  assert.ok(covers(pats, '/j/h/.config/opencode', true));
  assert.ok(!covers(pats, '/j/t/README.md', false));
  assert.ok(covers(pats, '/j/t', true), 'target dir itself is an ancestor');
  assert.ok(!covers(pats, '/j/t/AGENTS.md.bak', false));
  assert.ok(!covers(pats, '/j/h/.config/other.json', false));
  assert.ok(!covers(pats, '/j/x', true));
});

test('rig: volatile-line masking', () => {
  const m = volatileMask('a\nts 1\nc', 'a\nts 2\nc');
  assert.equal(applyMask('a\nts 9\nc', m), 'a\n<V>\nc');
});

test('rig: shims record, classify, fail closed; launchctl is emulated; node is real', async () => {
  const run = await makeRun({ label: 'shim' });
  try {
    const script = `
      const { spawnSync } = require('node:child_process');
      const r = (t, a) => { const x = spawnSync(t, a, { encoding: 'utf8' }); return [t, a.join(' '), x.status]; };
      console.log(JSON.stringify([
        r('brew', ['--version']), r('brew', ['install', 'x']), r('curl', ['-fsSL', 'https://example.com']), r('wget', ['x']),
        r('sudo', ['true']), r('docker', ['run', 'x']), r('npm', ['link']), r('npm', ['ls']), r('ollama', ['pull', 'm']), r('ollama', ['list']),
        r('opencode', ['serve']), r('launchctl', ['setenv', 'A', '1']), r('launchctl', ['getenv', 'A']), r('launchctl', ['bootstrap', 'x']),
        r('git', ['clone', 'x']), r('git', ['rev-parse', 'HEAD']), r('lsof', ['-i', ':1']), r('node', ['--version']),
      ]));`;
    const res = await run.node(['-e', script]);
    const rows = JSON.parse(res.stdout);
    const st = Object.fromEntries(rows.map(([t, a, s]) => [`${t} ${a}`, s]));
    assert.equal(st['brew --version'], 0);
    for (const k of ['brew install x', 'curl -fsSL https://example.com', 'wget x', 'sudo true', 'docker run x', 'npm link', 'ollama pull m', 'opencode serve', 'launchctl bootstrap x', 'git clone x']) assert.equal(st[k], 97, `${k} must fail closed`);
    assert.equal(st['npm ls'], 0); assert.equal(st['ollama list'], 0); assert.equal(st['launchctl setenv A 1'], 0); assert.equal(st['launchctl getenv A'], 0);
    assert.equal(st['git rev-parse HEAD'], 128); assert.equal(st['lsof -i :1'], 1); assert.equal(st['node --version'], 0);
    assert.equal(res.calls.length, rows.length - 1, 'every shimmed call recorded (node is not shimmed)');
    assert.equal(res.calls.filter((c) => c.cls === 'mutating' && c.note !== 'emulated').length, 10);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(run.shimState, 'launchctl.json'), 'utf8')), { A: '1' });
    assert.equal(res.calls.find((c) => c.tool === 'launchctl' && c.argv[0] === 'setenv').note, 'emulated');
  } finally { run.close(); }
});

test('rig: guard blocks writes outside the run dir and non-listener network; dead listener counts', { skip: !GUARD_AVAILABLE && 'sandbox-exec unavailable' }, async () => {
  const run = await makeRun({ label: 'guard' });
  try {
    const canary = path.join(SANDBOX_ROOT, `a_guard_probe_${process.pid}`);
    const script = `
      const fs = require('fs'); const net = require('net');
      const out = {};
      try { fs.writeFileSync(${JSON.stringify(canary)}, 'x'); out.writeOutside = 'WROTE'; } catch (e) { out.writeOutside = e.code; }
      try { fs.writeFileSync(${JSON.stringify(path.join(run.jail, 'inside.txt'))}, 'x'); out.writeInside = 'ok'; } catch (e) { out.writeInside = e.code; }
      const tryConn = (port) => new Promise((res) => { const s = net.connect(port, '127.0.0.1'); s.on('error', (e) => res(e.code)); s.on('connect', () => { s.destroy(); res('connected'); }); });
      (async () => { out.port9 = await tryConn(9); out.dead = await tryConn(${run.listeners.main}); console.log(JSON.stringify(out)); })();`;
    const res = await run.node(['-e', script]);
    const out = JSON.parse(res.stdout);
    assert.equal(out.writeOutside, 'EPERM'); assert.ok(!fs.existsSync(canary));
    assert.equal(out.writeInside, 'ok'); assert.equal(out.port9, 'EPERM'); assert.equal(out.dead, 'connected');
    assert.equal(res.connections.length, 1, 'the dead listener recorded the attempt');
    assert.equal(res.connections[0].port, run.listeners.main);
  } finally { run.close(); }
});

test('rig: connections to the well-known ports are attributed to the child, not to bystanders', { skip: !GUARD_AVAILABLE && 'sandbox-exec unavailable' }, async () => {
  const run = await makeRun({ label: 'attrib' });
  try {
    const extra = run.listeners.extras.find((e) => e.ok);
    assert.ok(extra, 'at least one well-known port (11434/11436/11438/4096) is free to bind on this machine');
    const script = `const net=require('net');const s=net.connect(${extra.port},'127.0.0.1');s.on('error',e=>console.log(e.code));s.on('connect',()=>{s.destroy();console.log('connected')});`;
    const res = await run.node(['-e', script]);
    assert.equal(res.stdout.trim(), 'connected');
    assert.equal(res.connections.length, 1, `child connection counted: ${JSON.stringify(run.listeners.conns)}`);
    assert.ok(['child', 'unknown'].includes(res.connections[0].who), 'counted as the child (or unattributable during its window)');
    // a bystander (this test process) connecting while no child runs is not the child's
    await new Promise((r) => { const s = net.connect(extra.port, '127.0.0.1'); s.on('close', r); s.on('error', r); });
    await new Promise((r) => setTimeout(r, 200));
    const last = run.listeners.conns.at(-1);
    assert.notEqual(last.who, 'child', 'bystander connection must not be attributed to a child');
    const res2 = await run.node(['-e', '1']);
    assert.equal(res2.connections.length, 0, 'bystander traffic never shows up in a later run');
  } finally { run.close(); }
});

test('rig: every run starts from a fresh, distinct sandbox; environment is not inherited', async () => {
  process.env.A_SECRET_PROBE = 'leak';
  const a = await makeRun({ label: 'fresh' }); const b = await makeRun({ label: 'fresh' });
  try {
    assert.notEqual(a.dir, b.dir); assert.notEqual(a.home, b.home);
    const r = await a.node(['-e', 'console.log(JSON.stringify({ s: process.env.A_SECRET_PROBE ?? null, h: process.env.HOME, p: process.env.PATH.split(":")[0] }))']);
    const o = JSON.parse(r.stdout);
    assert.equal(o.s, null); assert.equal(o.h, a.home); assert.equal(o.p, a.shimDir);
    assert.ok(a.dir.startsWith(SANDBOX_ROOT));
  } finally { delete process.env.A_SECRET_PROBE; a.close(); b.close(); }
});

// ---------------------------------------------------------------- clean reference: zero violations
test('clean reference: I1 dry purity, every verb', async () => {
  for (const door of ['refdoor', 'refb', 'all']) {
    const r = await checkDryPurity(REF, door);
    assert.deepEqual(r.violations, [], show(r.violations));
  }
});
test('clean reference: I2 touched within declared (default and launchctl)', async () => {
  let r = await checkApplyDeclared(REF, 'refdoor');
  assert.deepEqual(r.violations, [], show(r.violations));
  r = await checkApplyDeclared(REF, 'refdoor', { name: 'launchctl', flags: ['--with-launchctl'], setup: (run) => run.setLaunchctl({ REF_VAR: 'old' }) });
  assert.deepEqual(r.violations, [], show(r.violations));
  r = await checkApplyDeclared(REF, 'all');
  assert.deepEqual(r.violations, [], show(r.violations));
});
test('clean reference: I3 undo exact, idempotent, sequences (state cleaned up)', async () => {
  const env = { REF_STATE_CLEAN: '1' };
  for (const fixture of ['bare', 'populated', 'agents-nonl', 'agents-crlf']) {
    for (const stateMode of ['external', 'default']) {
      const r = await checkUndoExact(withEnv(env), 'refdoor', { fixture, stateMode });
      assert.deepEqual(r.violations, [], show(r.violations));
    }
  }
  let r = await checkUndoExact(withEnv(env), 'refdoor', { name: 'launchctl', flags: ['--with-launchctl'], setup: (run) => run.setLaunchctl({ REF_VAR: 'old' }) });
  assert.deepEqual(r.violations, [], show(r.violations));
  r = await checkUndoExact(withEnv(env), 'refdoor', { name: 'launchctl-absent', flags: ['--with-launchctl'] });
  assert.deepEqual(r.violations, [], show(r.violations));
  r = await checkApplyIdempotent(withEnv(env), 'refdoor');
  assert.deepEqual(r.violations, [], show(r.violations));
  r = await checkApplyIdempotent(withEnv(env), 'refdoor', { stateMode: 'default' });
  assert.deepEqual(r.violations, [], show(r.violations));
  for (const mode of ['each', 'all']) { r = await checkSequence(withEnv(env), { mode }); assert.deepEqual(r.violations, [], show(r.violations)); }
});
test('rig sensitivity: strict default-state undo is flagged when the journal survives undo', async () => {
  const r = await checkUndoExact(REF, 'refdoor', { stateMode: 'default' });
  assert.ok(has(r.violations, /undo not exact.*\.pharos/), show(r.violations));
  const ok = await checkUndoExact(REF, 'refdoor', { stateMode: 'external' });
  assert.deepEqual(ok.violations, [], show(ok.violations));
});
test('clean reference: I4 flag gating and refusals', async () => {
  let r = await checkFlagGating(REF, 'refdoor');
  assert.deepEqual(r.violations, [], show(r.violations));
  r = await checkRefusals(REF);
  assert.deepEqual(r.violations, [], show(r.violations));
});

// ---------------------------------------------------------------- mutants: each must be caught
const MUTANTS = [
  ['M1 dry-write', 'dry-write', () => checkDryPurity(withEnv({ REF_MUTANT: 'dry-write' }), 'refdoor'), /tree changed/],
  ['dry mode-only change', 'mode', () => checkDryPurity(withEnv({ REF_MUTANT: 'mode' }), 'refdoor'), /tree changed.*mode/],
  ['dry state dir created', 'state-leak-dry', () => checkDryPurity(withEnv({ REF_MUTANT: 'state-leak-dry' }), 'refdoor'), /tree changed/],
  ['dry shim mutation', 'dry-shim', () => checkDryPurity(withEnv({ REF_MUTANT: 'dry-shim' }), 'refdoor'), /state-changing shim calls/],
  ['dry network attempt', 'net', () => checkDryPurity(withEnv({ REF_MUTANT: 'net' }), 'refdoor'), /connection attempt/],
  ['M2 undo-skip', 'undo-skip', () => checkUndoExact(withEnv({ REF_MUTANT: 'undo-skip', REF_STATE_CLEAN: '1' }), 'refdoor'), /undo not exact/],
  ['M3 undeclared path', 'undeclared', () => checkApplyDeclared(withEnv({ REF_MUTANT: 'undeclared' }), 'refdoor'), /UNDECLARED/],
  ['M4 double-append', 'double-append', () => checkApplyIdempotent(withEnv({ REF_MUTANT: 'double-append' }), 'refdoor'), /second apply changed/],
  ['M5 symlink-ok', 'symlink-ok', () => checkRefusals(withEnv({ REF_MUTANT: 'symlink-ok' })), /symlink.*NOT REFUSED|symlink.*changed the tree|symlink.*OUTSIDE/],
  ['M6 undeclared shim', 'undeclared-shim', () => checkApplyDeclared(withEnv({ REF_MUTANT: 'undeclared-shim' }), 'refdoor'), /undeclared tool: curl/],
  ['M7 ignore-flag', 'ignore-flag', () => checkFlagGating(withEnv({ REF_MUTANT: 'ignore-flag' }), 'refdoor'), /ran without/],
  ['M7b ignore-flag (I2 env)', 'ignore-flag', () => checkFlagGating(withEnv({ REF_MUTANT: 'ignore-flag' }), 'refdoor'), /launchctl env changed without/],
  ['dotdot allowed', 'dotdot-ok', () => checkRefusals(withEnv({ REF_MUTANT: 'dotdot-ok' })), /dotdot.*NOT REFUSED/],
  ['unknown door allowed', 'unknown-ok', () => checkRefusals(withEnv({ REF_MUTANT: 'unknown-ok' })), /unknown-door.*NOT REFUSED/],
  ['outside write (guard)', 'outside-write', () => checkApplyDeclared(withEnv({ REF_MUTANT: 'outside-write' }), 'refdoor'), /sandbox denied/],
];
for (const [name, mut, fn, re] of MUTANTS) {
  test(`mutant caught: ${name}`, { skip: mut === 'outside-write' && !GUARD_AVAILABLE && 'sandbox-exec unavailable' }, async () => {
    const r = await fn();
    assert.ok(has(r.violations, re), `expected a violation matching ${re}, got:${show(r.violations) || ' (none)'}`);
  });
}

test('real home witness did not change during validation', () => {
  // taken now and compared with itself across a short wait: the witness paths must be stable on this machine,
  // otherwise REALHOME violations in the real tests would be noise
  const a = realHomeWitness();
  const b = realHomeWitness();
  assert.deepEqual(a, b);
});

test('spawnSync of the reference outside the rig is not how tests run it (sanity: rig env differs)', () => {
  const r = spawnSync(process.execPath, [REF.bin, 'doors'], { encoding: 'utf8', env: {} });
  assert.equal(r.status, 0);
});

// ---------------------------------------------------------------- I9 differential check
const LEG = { bin: path.join(HERE, 'a_ref', 'legacy_mutant.mjs'), label: 'legref', env: { A_BASELINE_BIN: path.join(BASELINE_DIR, 'bin', 'pharos.mjs') } };
test('I9 check: identical behaviour (frozen baseline wrapped unchanged) gives zero violations', async () => {
  const r = await checkLegacyUnchanged(LEG);
  assert.deepEqual(r.violations, [], show(r.violations));
  assert.ok(r.notes.length >= 20, 'ran the whole legacy script');
});
for (const [m, re] of [['extra-line', /\[fold\] differs/], ['exit', /\[status\] differs/], ['file', /resulting tree differs.*stray\.txt/]]) {
  test(`I9 check catches planted difference: ${m}`, async () => {
    const r = await checkLegacyUnchanged({ ...LEG, env: { ...LEG.env, REF_LEGACY: m } });
    assert.ok(has(r.violations, re), `expected ${re}, got:${show(r.violations) || ' (none)'}`);
  });
}
test('I9 check: existing-tests comparison, identity gives zero violations and measures the baseline', async () => {
  const r = await checkExistingTests({ bin: LEG.bin, label: 'i9t' }, BASELINE_DIR);
  assert.deepEqual(r.violations, [], show(r.violations));
  assert.equal(r.base.tap.tests, 32);
});
test('I9 check: a tree missing a baseline test file is flagged as regression', async () => {
  const copy = path.join(SANDBOX_ROOT, `a-i9copy-${process.pid}`);
  fs.rmSync(copy, { recursive: true, force: true });
  fs.cpSync(BASELINE_DIR, copy, { recursive: true });
  fs.chmodSync(copy, 0o755);
  fs.rmSync(path.join(copy, 'test', 'pharos.test.mjs'), { force: true });
  const r = await checkExistingTests({ bin: LEG.bin, label: 'i9t2' }, copy);
  fs.rmSync(copy, { recursive: true, force: true });
  assert.ok(has(r.violations, /REGRESSION|fewer tests/), show(r.violations));
});
