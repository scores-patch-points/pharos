// Append-only hash-chained journal plus byte backups, one state directory per scope.
//   $STATE/journal.jsonl   one JSON object per line; each carries prev = sha256 of the previous line and seq = its index
//   $STATE/backups/<sha>   original bytes of every file before its first modification
//   $STATE/runs/<id>.json  the plan that was applied
//   $STATE/lock            held (with the owner's pid) while a run changes this state; stale when the pid is gone
// The chain is verified on every read. A line that does not link to its predecessor, a wrong seq, or a line that
// is not an object is refused (Refused, exit 3): the journal is tamper-evident, not tamper-proof (whoever can
// rewrite every later line can recompute the chain), so undo also re-checks every entry against the manifest.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicWrite, appendLine, sleepMs } from './fsx.mjs';
import { Refused } from './guard.mjs';

export const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const ZERO = '0'.repeat(64);
const HELD = new Map(); // lock file -> reentrancy count (this process)
let exitHook = false;

export const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

export class JournalForged extends Refused {
  constructor(m) { super(`journal refused: ${m}`); this.code = 'JOURNAL_FORGED'; }
}
export class LockBusy extends Error { constructor(m) { super(m); this.code = 'LOCKED'; this.exit = 1; } }

export class Journal {
  constructor(state) {
    this.state = state;
    this.file = path.join(state, 'journal.jsonl');
    this.backups = path.join(state, 'backups');
    this.runs = path.join(state, 'runs');
    this.lockFile = path.join(state, 'lock');
  }
  exists() { return fs.existsSync(this.file); }
  // complete lines only: a final line without its newline is a torn append (the process died mid-write)
  rawLines() {
    if (!this.exists()) return { lines: [], torn: false };
    const raw = fs.readFileSync(this.file, 'utf8');
    const parts = raw.split('\n');
    const last = parts.pop(); // '' when the file ends with a newline
    return { lines: parts.filter((l) => l !== ''), torn: last !== '' };
  }
  lines() { return this.rawLines().lines; }
  read() {
    const { lines, torn } = this.rawLines();
    let prev = ZERO;
    const entries = lines.map((l, i) => {
      let e;
      try { e = JSON.parse(l); } catch { throw new JournalForged(`line ${i} is not JSON`); }
      if (!e || typeof e !== 'object' || Array.isArray(e)) throw new JournalForged(`line ${i} is not an object`);
      if (e.prev !== prev) throw new JournalForged(`line ${i} does not link to the line before it (hash chain broken or entry forged)`);
      if (e.seq !== i) throw new JournalForged(`line ${i} carries seq ${e.seq}`);
      prev = sha256(l);
      return e;
    });
    return { entries, chainOk: true, head: prev, torn };
  }
  append(obj) {
    const release = this.lock();
    try {
      const { lines, torn } = this.rawLines();
      if (torn) this.dropTornTail(lines);
      const prev = lines.length ? sha256(lines[lines.length - 1]) : ZERO;
      const line = JSON.stringify({ ...obj, seq: lines.length, ts: new Date().toISOString(), prev });
      appendLine(this.file, line + '\n');
      return lines.length;
    } finally { release(); }
  }
  dropTornTail(lines) { atomicWrite(this.file, Buffer.from(lines.length ? lines.join('\n') + '\n' : ''), 0o644); }
  // The bytes are written to a temp file and renamed, so a backup is complete or absent; a file of the right
  // name with the wrong bytes is replaced, never trusted.
  backup(bytes) {
    const h = sha256(bytes);
    fs.mkdirSync(this.backups, { recursive: true });
    const p = path.join(this.backups, h);
    let ok = false;
    try { ok = sha256(fs.readFileSync(p)) === h; } catch { /* absent */ }
    if (!ok) atomicWrite(p, bytes, 0o600);
    return h;
  }
  getBackup(h) {
    const b = fs.readFileSync(path.join(this.backups, h));
    if (sha256(b) !== h) throw new Refused(`backup ${h} does not match its hash; not restoring from it`);
    return b;
  }
  // Intents not yet undone, with their done/failed state. Oldest first.
  active() {
    const { entries } = this.read();
    const byRef = new Map(); // seq -> {intent, done, failed, undone}
    for (const e of entries) {
      if (e.type === 'intent') byRef.set(e.seq, { intent: e, done: null, failed: false, undone: false });
      else if (e.type === 'done' && byRef.has(e.ref)) byRef.get(e.ref).done = e;
      else if (e.type === 'failed' && byRef.has(e.ref)) byRef.get(e.ref).failed = true;
      else if (e.type === 'undone' && byRef.has(e.ref)) byRef.get(e.ref).undone = true;
    }
    return [...byRef.values()].filter((x) => !x.undone);
  }
  // Reentrant in this process; across processes an O_EXCL file with the owner's pid. A lock whose owner is
  // gone is stale and is taken over. Returns a release function. The state dir must exist.
  lock(waitMs = 20000) {
    const f = this.lockFile;
    const n = HELD.get(f);
    if (n) { HELD.set(f, n + 1); return once(() => this.unlockOne(f)); }
    const t0 = Date.now();
    for (;;) {
      // Bounded on every path: nothing below may loop without passing this check.
      if (Date.now() - t0 > waitMs) throw new LockBusy(`another pharos run holds ${f}; wait for it to finish (a lock whose process is gone is taken over automatically)`);
      const lst = fs.lstatSync(f, { throwIfNoEntry: false });
      if (lst && !lst.isFile()) throw new Refused(`the lock path is not a regular file (${lst.isSymbolicLink() ? 'a symlink' : lst.isDirectory() ? 'a directory' : 'a special file'}): ${f}; nothing was changed, remove it by hand`);
      try {
        const fd = fs.openSync(f, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
        try { fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now() })); } finally { fs.closeSync(fd); }
        break;
      } catch (e) {
        if (e.code !== 'EEXIST' && e.code !== 'ELOOP') throw e;
        if (this.staleLock()) { sleepMs(2); continue; }
        sleepMs(20 + Math.floor(Math.random() * 30));
      }
    }
    HELD.set(f, 1);
    if (!exitHook) { exitHook = true; process.on('exit', () => { for (const k of HELD.keys()) try { fs.unlinkSync(k); } catch { /* gone */ } }); }
    return once(() => this.unlockOne(f));
  }
  staleLock() {
    const f = this.lockFile;
    let txt, st;
    try { st = fs.lstatSync(f); if (!st.isFile()) return false; txt = fs.readFileSync(f, 'utf8'); } catch (e) { return e.code === 'ENOENT'; } // vanished: retry; anything else is not ours to take
    let o = null; try { o = JSON.parse(txt); } catch { /* being written */ }
    // a pid that is not a positive integer above 1 is no owner at all (kill(0) and kill(-1) "succeed"): judge it by age
    const dead = o && Number.isInteger(o.pid) && o.pid > 1 ? !alive(o.pid) : Date.now() - st.mtimeMs > 5000;
    if (!dead) return false;
    try { if (fs.readFileSync(f, 'utf8') !== txt) return false; fs.renameSync(f, `${f}.stale-${process.pid}-${crypto.randomBytes(3).toString('hex')}`); } catch { /* someone else took it */ }
    this.sweepStale();
    return true;
  }
  sweepStale() { try { for (const n of fs.readdirSync(this.state)) if (n.startsWith('lock.stale-')) fs.rmSync(path.join(this.state, n), { force: true }); } catch { /* none */ } }
  unlockOne(f) {
    const n = (HELD.get(f) || 1) - 1;
    if (n > 0) { HELD.set(f, n); return; }
    HELD.delete(f);
    try { fs.unlinkSync(f); } catch { /* gone */ }
  }
}

// Run bookkeeping, per door. A run is `unresolved` when it never ended ok (killed, or a step failed) and no later run
// that ended ok has done every step this one meant to run (its `steps_run` are all in the later run's `steps_done`).
// A later run that finds the work already in place counts: it plans, sees every step satisfied, and ends ok.
export function runStates(entries, door) {
  const runs = new Map(); const ends = [];
  for (const e of entries) {
    if (e.door !== door) continue;
    if (e.type === 'run-start') runs.set(e.run, { run: e.run, seq: e.seq, steps_run: Array.isArray(e.steps_run) ? e.steps_run : null, plan_sha256: e.plan_sha256, end: null });
    else if (e.type === 'run-end') { ends.push(e); const r = runs.get(e.run); if (r) r.end = e; }
  }
  for (const r of runs.values()) {
    r.resolved = !!(r.end && r.end.ok) || ends.some((e) => e.ok && e.seq > r.seq && e.run !== r.run && Array.isArray(r.steps_run) && Array.isArray(e.steps_done) && r.steps_run.every((st) => e.steps_done.includes(st)));
  }
  return runs;
}

function once(fn) { let done = false; return () => { if (!done) { done = true; fn(); } }; }
