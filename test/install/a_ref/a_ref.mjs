// Trivial reference CLI used ONLY to validate the rig and the checks. It follows the contract in
// DESIGN.md (dry by default, journal in $STATE, undo restores bytes) and can plant mutants via
// REF_MUTANT=<name>. It is not the installer.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const MUT = process.env.REF_MUTANT || '';
const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (n) => argv.includes(n);
const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const die = (code, msg) => { process.stderr.write(JSON.stringify({ error: { code: String(code), message: msg } }) + '\n'); process.exit(code); };
const DOORS = ['refdoor', 'refb'];
const BLOCK_BEGIN = '<!-- ref:begin -->'; const BLOCK_END = '<!-- ref:end -->';

if (cmd === 'doors') { console.log(JSON.stringify(DOORS)); process.exit(0); }
if (!['install', 'undo-door', 'detect', 'verify', 'status'].includes(cmd)) die(2, 'unknown command');
const doorArg = argv[1];
const doors = doorArg === 'all' ? DOORS : [doorArg];
if (!doors.every((d) => DOORS.includes(d)) && MUT !== 'unknown-ok') die(2, 'unknown door');
if (!doors.every((d) => DOORS.includes(d))) process.exit(0);

const KNOWN = new Set(['--apply', '--plan', '--json', '--target', '--state', '--with-launchctl', '--khora-dir']);
for (const a of argv.slice(2)) if (a.startsWith('--') && !KNOWN.has(a)) die(2, 'unknown flag ' + a);
const target = val('--target');
if (!target) die(2, 'need --target');
if (target.split('/').includes('..') && MUT !== 'dotdot-ok') die(3, 'refused: ..');
const rootAllow = process.env.PHAROS_ROOT_ALLOW ? fs.realpathSync(process.env.PHAROS_ROOT_ALLOW) : null;
const within = (p) => {
  let q = p;
  while (!fs.existsSync(q) && q !== path.dirname(q)) q = path.dirname(q);
  const rp = fs.realpathSync(q);
  return !rootAllow || rp === rootAllow || rp.startsWith(rootAllow + path.sep);
};
const guardPath = (p) => { if (MUT !== 'symlink-ok' && !within(p)) die(3, 'refused: path escapes allowed root ' + p); };
guardPath(target);
if (process.env.HOME && fs.realpathSync(target) === fs.realpathSync(process.env.HOME)) die(3, 'refused: target is HOME');
if ((val('--state') || '').split('/').includes('..')) die(3, 'refused: .. in --state');
const state = val('--state') || path.join(target, '.pharos');
guardPath(state);
const apply = flag('--apply');
const journalFile = path.join(state, 'journal.json');
const readJ = () => (fs.existsSync(journalFile) ? JSON.parse(fs.readFileSync(journalFile, 'utf8')) : { entries: [] });

function sh(tool, args) { return spawnSync(tool, args, { encoding: 'utf8' }); }

if (cmd === 'install' && !apply) {
  // plan: dry. Mutants plant impurity here.
  if (MUT === 'dry-write') fs.writeFileSync(path.join(target, '.dry-leak'), 'x');
  if (MUT === 'mode') fs.chmodSync(target, 0o750);
  if (MUT === 'state-leak-dry') fs.mkdirSync(state, { recursive: true });
  if (MUT === 'dry-shim') sh('brew', ['install', 'something']);
  if (MUT === 'net') { const p = Number(process.env.HTTP_PROXY.split(':').pop()); const s = net.connect(p, '127.0.0.1'); s.on('error', () => {}); await new Promise((r) => s.on('close', r)); }
  console.log(JSON.stringify({ plan: doors, skipped: ['--with-launchctl'] }));
  process.exit(0);
}
if (cmd === 'detect' || cmd === 'verify' || cmd === 'status') { console.log(JSON.stringify({ ok: true })); process.exit(0); }

if (cmd === 'install') {
  if (doors.includes('refdoor')) guardPath(path.join(target, 'AGENTS.md')); // refuse before changing anything
  fs.mkdirSync(state, { recursive: true });
  const j = readJ();
  for (const d of doors) {
    if (d === 'refb') {
      const f = path.join(target, 'REFB.txt');
      if (!fs.existsSync(f)) { guardPath(f); fs.writeFileSync(f, 'refb\n'); j.entries.push({ door: d, op: 'created', path: f }); }
      continue;
    }
    const ref = path.join(target, 'REF.txt');
    if (!fs.existsSync(ref)) { fs.writeFileSync(ref, 'ref\n'); j.entries.push({ door: d, op: 'created', path: ref }); }
    const ag = path.join(target, 'AGENTS.md');
    guardPath(ag);
    const block = `${BLOCK_BEGIN}\nsee pharos\n${BLOCK_END}\n`;
    const exists = fs.existsSync(ag);
    const prior = exists ? fs.readFileSync(ag) : null;
    const text = exists ? prior.toString('utf8') : '';
    if (!text.includes(BLOCK_BEGIN) || MUT === 'double-append') {
      fs.writeFileSync(ag, text + (text && !text.endsWith('\n') ? '\n' : '') + block);
      j.entries.push({ door: d, op: exists ? 'edited' : 'created', path: ag, prior: prior ? prior.toString('base64') : null });
    }
    if (MUT === 'undeclared') fs.writeFileSync(path.join(target, 'UNDECLARED.txt'), 'x');
    if (MUT === 'undeclared-shim') sh('curl', ['--silent', 'http://example.invalid/x']);
    if (flag('--with-launchctl') || MUT === 'ignore-flag') {
      const prev = sh('launchctl', ['getenv', 'REF_VAR']).stdout.trim();
      sh('launchctl', ['setenv', 'REF_VAR', 'x']);
      j.entries.push({ door: d, op: 'env', name: 'REF_VAR', prior: prev === '' ? null : prev });
    }
    if (MUT === 'outside-write') { const c = path.join(path.resolve(process.env.PHAROS_ROOT_ALLOW, '..', '..'), 'a_guard_canary_' + process.pid); try { fs.writeFileSync(c, 'x'); console.log('WROTE-OUTSIDE ' + c); } catch (e) { console.error(String(e)); } }
  }
  fs.writeFileSync(journalFile, JSON.stringify(j));
  console.log(JSON.stringify({ applied: doors, skipped: flag('--with-launchctl') ? [] : ['daemon-env: skipped, needs --with-launchctl'] }));
  process.exit(0);
}

if (cmd === 'undo-door') {
  const j = readJ();
  const mine = j.entries.filter((e) => doors.includes(e.door));
  for (const e of mine.reverse()) {
    if (e.op === 'created') { if (MUT === 'undo-skip' && e.path.endsWith('REF.txt')) continue; fs.rmSync(e.path, { force: true }); }
    else if (e.op === 'edited') fs.writeFileSync(e.path, Buffer.from(e.prior, 'base64'));
    else if (e.op === 'env') sh('launchctl', e.prior === null ? ['unsetenv', e.name] : ['setenv', e.name, e.prior]);
  }
  j.entries = j.entries.filter((e) => !doors.includes(e.door));
  if (fs.existsSync(journalFile)) fs.writeFileSync(journalFile, JSON.stringify(j));
  if (process.env.REF_STATE_CLEAN && j.entries.length === 0) { fs.rmSync(journalFile, { force: true }); try { fs.rmdirSync(state); } catch { /* not empty */ } }
  console.log(JSON.stringify({ undone: doors }));
  process.exit(0);
}
