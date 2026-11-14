// Test author C: black-box fault injection, loaded with `node --import`. It knows nothing about the installer: it counts
// the process's MUTATING filesystem calls and acts at the k-th one. Modes (env FI_MODE):
//   count  count the calls, write the count and a trace to FI_LOG at exit
//   kill   at call FI_K: perform HALF of a write (first half of the bytes), then SIGKILL the process; any other call
//          is killed before it runs
//   slow   sleep FI_SLOW_MS before every mutating call (widens race windows so parallel runs truly overlap)
//   plant  before call FI_K, for each {path, victim} in FI_PLANT (JSON): remove what is at path, put a symlink to victim there
//   holdlock  before call FI_K, announce FI_HOLD_FILE and sleep FI_HOLD_MS (a run that sits still while holding whatever it holds)
// Only sync calls and fs.promises calls are hooked (callback forms are not); the count says how many were seen.
import fs from 'node:fs';
import path from 'node:path';
import module from 'node:module';

const mode = process.env.FI_MODE || 'count';
const K = Number(process.env.FI_K || 0);
const LOG = process.env.FI_LOG || '';
const SLOW = Number(process.env.FI_SLOW_MS || 0);
const real = {
  writeFileSync: fs.writeFileSync, appendFileSync: fs.appendFileSync, writeSync: fs.writeSync, appendLog: fs.appendFileSync, writeLog: fs.writeFileSync,
  existsSync: fs.existsSync, lstatSync: fs.lstatSync, unlinkSync: fs.unlinkSync, rmSync: fs.rmSync, symlinkSync: fs.symlinkSync,
};
let n = 0;
const trace = [];
const sleep = (ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const desc = (name, a) => `${name} ${typeof a[0] === 'string' ? a[0] : typeof a[0] === 'number' ? `fd${a[0]}` : ''}${typeof a[1] === 'string' && name.match(/rename|copy|link|symlink/) ? ` -> ${a[1]}` : ''}`;
function note(s) { if (LOG) try { real.appendLog(`${LOG}.trace`, s + '\n'); } catch { /* ignore */ } }

function plant() {
  let list = []; try { list = JSON.parse(process.env.FI_PLANT || '[]'); } catch { /* ignore */ }
  for (const { path: p, victim } of list) {
    try { real.rmSync(p, { force: true }); } catch { /* ignore */ }
    try { real.symlinkSync(victim, p); note(`planted ${p} -> ${victim}`); } catch (e) { note(`plant failed ${p}: ${e.code}`); }
  }
}
function die(partialFn, label) {
  note(`KILL at ${n}: ${label}`);
  try { if (partialFn) partialFn(); } catch { /* ignore */ }
  process.kill(process.pid, 'SIGKILL');
  sleep(5000);
}
// wrap(name, partial?) : partial(args) performs a half-written version of the call
function hook(obj, name, partial, ctxName) {
  const orig = obj[name];
  if (typeof orig !== 'function') return;
  obj[name] = function (...a) {
    n++;
    const label = desc(`${ctxName}${name}`, a);
    trace.push(`${n} ${label}`);
    if (mode === 'slow') sleep(SLOW);
    if (mode === 'plant' && n === K) plant();
    if (mode === 'holdlock' && n === K) { if (process.env.FI_HOLD_FILE) try { real.writeLog(process.env.FI_HOLD_FILE, String(process.pid)); } catch { /* ignore */ } sleep(Number(process.env.FI_HOLD_MS || 3000)); }
    if (mode === 'kill' && n === K) die(partial ? () => partial.call(this, orig, a) : null, label);
    return orig.apply(this, a);
  };
}
const halfBuf = (data) => { const b = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data.buffer ? data : Buffer.from(data)); return b.subarray(0, Math.ceil(b.length / 2)); };

hook(fs, 'writeFileSync', (orig, a) => orig.call(fs, a[0], halfBuf(a[1]), a[2]), '');
hook(fs, 'appendFileSync', (orig, a) => orig.call(fs, a[0], halfBuf(a[1]), a[2]), '');
hook(fs, 'writeSync', (orig, a) => {
  const [fd, buf, ...r] = a;
  if (typeof buf === 'string') return real.writeSync(fd, halfBuf(buf));
  const off = typeof r[0] === 'number' ? r[0] : 0; const len = typeof r[1] === 'number' ? r[1] : buf.byteLength - off;
  return real.writeSync(fd, buf, off, Math.ceil(len / 2));
}, '');
for (const nm of ['renameSync', 'copyFileSync', 'unlinkSync', 'rmSync', 'rmdirSync', 'mkdirSync', 'symlinkSync', 'linkSync', 'truncateSync', 'ftruncateSync', 'chmodSync', 'fchmodSync', 'mkdtempSync']) hook(fs, nm, null, '');
// opening a file for writing/creating is a mutation window too (an empty temp file now exists)
{
  const orig = fs.openSync;
  fs.openSync = function (p, flags, ...r) {
    const wr = typeof flags === 'string' ? /[wa+]/.test(flags) : typeof flags === 'number' ? (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT)) !== 0 : false;
    if (!wr) return orig.call(this, p, flags, ...r);
    n++;
    const label = desc('openSync(write)', [String(p)]);
    trace.push(`${n} ${label}`);
    if (mode === 'slow') sleep(SLOW);
    if (mode === 'plant' && n === K) plant();
    if (mode === 'holdlock' && n === K) { if (process.env.FI_HOLD_FILE) try { real.writeLog(process.env.FI_HOLD_FILE, String(process.pid)); } catch { /* ignore */ } sleep(Number(process.env.FI_HOLD_MS || 3000)); }
    if (mode === 'kill' && n === K) die(null, label);
    return orig.call(this, p, flags, ...r);
  };
}
const pr = fs.promises;
if (pr) {
  hook(pr, 'writeFile', async (orig, a) => orig.call(pr, a[0], halfBuf(a[1]), a[2]), 'promises.');
  hook(pr, 'appendFile', async (orig, a) => orig.call(pr, a[0], halfBuf(a[1]), a[2]), 'promises.');
  for (const nm of ['rename', 'copyFile', 'unlink', 'rm', 'rmdir', 'mkdir', 'symlink', 'link', 'truncate', 'chmod']) hook(pr, nm, null, 'promises.');
}
try { module.syncBuiltinESMExports(); } catch { /* ignore */ }

process.on('exit', () => {
  if (LOG && mode === 'count') { try { real.writeLog(LOG, JSON.stringify({ count: n, trace })); } catch { /* ignore */ } }
});
