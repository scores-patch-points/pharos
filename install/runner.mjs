// The installer core. It owns the journal, the backups, the sandbox checks and the flag gating.
// A door supplies declarative steps; it can only act through the Ctx below, which refuses anything
// its manifest did not declare. There is no other way for a door to write a file or run a tool.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { Journal, JournalForged, sha256, runStates, alive } from './journal.mjs';
import { atomicWrite, appendLine, fsyncDir, tmpNameFor } from './fsx.mjs';
import { Refused, Usage, checkPathArg, checkTarget, checkWritePath, escapingSymlink, forbidden, isRealHome, within, realpathDeep, allowRoots } from './guard.mjs';
import { compilePatterns, matchDeclared, resolveToken } from './paths.mjs';
import { unifiedDiff } from './diff.mjs';
import { LADDER } from './manifest.mjs';

const TMP_NAME = /^\.[^/]*\.pharos-[0-9a-f]{12}\.tmp$/;
export class StepFailed extends Error { constructor(m) { super(m); this.code = 'STEP_FAILED'; this.exit = 1; } }
export class Undeclared extends Error { constructor(m) { super(m); this.code = 'UNDECLARED'; this.exit = 1; } }

// the only reverse commands a journal entry may ask undo to run, per tool (first argument)
// Exact argv shapes, not first words: a journal line is data and may be forged.
const R_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const R_TAG = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const REVERSE_SHAPES = {
  ollama: (v) => v.length === 2 && v[0] === 'rm' && R_TAG.test(v[1]),
  npm: (v) => v.length === 2 && v[0] === 'unlink' && v[1] === '-g',
  claude: (v) => (v.length === 4 && v[0] === 'plugin' && v[1] === 'marketplace' && v[2] === 'remove' && R_NAME.test(v[3]))
    || (v.length === 3 && v[0] === 'plugin' && v[1] === 'uninstall' && /^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v[2])),
};
// Who a pid is now: start time and command line, read with the system ps at its fixed path (read-only; the one
// call that does not go through PATH, so a planted ps cannot vouch for a process). null when the pid is gone.
function procInfo(pid) {
  try {
    const r = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'command='], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    const t = r.status === 0 ? r.stdout.split('\n')[0].trim().split(/\s+/) : [];
    return t.length > 5 ? { started: t.slice(0, 5).join(' '), command: t.slice(5).join(' ') } : null;
  } catch { return null; }
}
const PROBE_FIRST = new Set(['--version', '-version', 'version', '-v', '-V', 'list', 'getenv', '--help']);
// PATH with empty and relative entries dropped: an empty entry means the current directory, so a tool planted there would run
const safePath = (p = process.env.PATH || '') => p.split(path.delimiter).filter((d) => d && path.isAbsolute(d)).join(path.delimiter);
const isExec = (p) => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } };

// `command -v`, done in-process: no tool is invoked.
export function which(name, pathEnv = process.env.PATH || '') {
  if (!/^[A-Za-z0-9._+-]+$/.test(name)) return null;
  for (const d of safePath(pathEnv).split(path.delimiter).filter(Boolean)) { const p = path.join(d, name); if (isExec(p)) return p; }
  return null;
}

const keyOf = (a) => sha256(JSON.stringify({ op: a.op, tool: a.tool, argv: a.argv, cwd: a.cwd, name: a.name, value: a.value, path: a.path }));
const modeOf = (p) => fs.lstatSync(p).mode & 0o7777;
const snap = (p) => {
  const st = fs.lstatSync(p, { throwIfNoEntry: false });
  if (!st) return { exists: false };
  if (st.isSymbolicLink()) return { exists: true, symlink: true };
  if (st.isDirectory()) return { exists: true, dir: true };
  if (!st.isFile()) return { exists: true, special: true }; // fifo, socket, device: never read (a fifo would block)
  return { exists: true, sha256: sha256(fs.readFileSync(p)), mode: st.mode & 0o7777 };
};

export class Ctx {
  constructor(session, id) {
    const d = session.doors.get(id);
    this.session = session; this.id = id; this.manifest = d.manifest; this.impl = d.impl;
    this.home = session.home; this.target = session.target; this.khoraDir = session.khoraDir;
    this.scope = d.impl.scope || 'target';
    if (this.scope === 'target' && !this.target) throw new Usage('--target is required for this door');
    this.state = session.stateOverride || path.join(this.scope === 'target' ? this.target : this.home, '.pharos');
    this.roots = { HOME: this.home, TARGET: this.target, STATE: this.state, KHORA_DIR: this.khoraDir };
    const t = this.manifest.touches;
    this.files = compilePatterns([...t.files, ...t.configs.map((c) => c.path)], this.roots);
    this.tools = new Set(t.tools);
    this.probeTools = new Set([...t.tools, ...(this.manifest.requires.tools || [])]);
    this.journal = new Journal(this.state);
    this.run = session.runId;
    this.step = null;
    this.readSha = new Map();
  }
  // ---- flags
  has(flag) { return this.session.flags.has(flag); }
  val(flag) { const v = this.session.flags.get(flag); return Array.isArray(v) ? v[v.length - 1] : v; }
  vals(flag) { const v = this.session.flags.get(flag); return v === undefined ? [] : Array.isArray(v) ? v : [v]; }
  // ---- read-only (allowed in plan)
  // remembers the hash of what each read returned, so the plan can tell if a file changed between a door's read and its own
  readFile(abs) { const st = fs.lstatSync(abs, { throwIfNoEntry: false }); const b = !st || !st.isFile() ? null : fs.readFileSync(abs); this.readSha.set(path.resolve(abs), b ? sha256(b) : 'absent'); return b; }
  exists(abs) { return fs.lstatSync(abs, { throwIfNoEntry: false }) !== undefined; }
  which(name) { return which(name); }
  tok(p) { const r = resolveToken(p, this.roots); return r ? r.abs : null; }
  declared(abs) { return matchDeclared(this.files, path.resolve(abs)); }
  assertDeclared(abs) {
    const m = this.declared(abs);
    if (!m) throw new Undeclared(`${this.id}: ${abs} is not in the declared touches`);
    return m;
  }
  assertTool(name) { if (!this.tools.has(name)) throw new Undeclared(`${this.id}: tool ${name} is not declared`); }
  // A detect-class call: allowed only for declared tools and read-only first arguments.
  probe(tool, argv = []) {
    if (!this.probeTools.has(tool)) throw new Undeclared(`${this.id}: tool ${tool} is not declared`);
    if (!PROBE_FIRST.has(argv[0])) throw new Undeclared(`${this.id}: ${tool} ${argv[0] ?? ''} is not a detect-class call`);
    return this._spawn(tool, argv, {});
  }
  // read-only: tracked files changed in a git checkout (empty output means clean)
  gitStatus(dir) { this.assertTool('git'); return this._spawn('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: dir, timeout: 60000 }); }
  _spawn(tool, argv, { cwd, timeout, raw } = {}) {
    if (!which(tool)) return { found: false, code: 127, stdout: raw ? Buffer.alloc(0) : '', stderr: `${tool}: not found` };
    const r = spawnSync(tool, argv, { cwd, encoding: raw ? 'buffer' : 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeout || 1_800_000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PATH: safePath() } });
    const err = r.stderr ? r.stderr.toString() : '';
    return { found: true, code: r.error ? 126 : r.status === null ? 124 : r.status, stdout: r.stdout || (raw ? Buffer.alloc(0) : ''), stderr: err };
  }
  // ---- journal plumbing
  // Checked on every call, not only when the state dir is first created: a state dir that is (or
  // passes through) a symlink leaving its root is refused before anything is written through it.
  guardState() {
    const root = this.stateRoot();
    const esc = escapingSymlink(this.state);
    if (esc) throw new Refused(`state dir passes through a symlink that leaves its directory: ${esc.link} -> ${esc.real}`);
    if (!within(realpathDeep(this.state), root)) throw new Refused(`write would land outside ${root}: ${this.state}`);
    for (const f of [this.journal.file, this.journal.backups, this.journal.runs]) {
      const st = fs.lstatSync(f, { throwIfNoEntry: false });
      if (st && st.isSymbolicLink()) throw new Refused(`refusing to write to a symlink: ${f}`);
    }
    checkWritePath(this.journal.file, root);
  }
  // Create the state dir (recording exactly the directories this call created), take the journal lock and
  // write the init entry if there is none. Returns the release function. Reentrant.
  lockState() {
    this.guardState();
    this.session.sweepResidue(this.state);
    const created = [];
    const mk = (p) => { if (fs.existsSync(p)) return; mk(path.dirname(p)); try { fs.mkdirSync(p); created.push(p); } catch (e) { if (e.code !== 'EEXIST') throw e; } };
    if (!fs.existsSync(this.state)) {
      // A new state dir appears under its own name in ONE step, already holding its first journal line: it is built
      // beside its final place (a name carrying this pid) and renamed. A run killed on the way leaves only that
      // side folder, which the next apply or undo recognises by its name and removes; a state dir that exists
      // without a journal is therefore never ours, and is never removed.
      mk(path.dirname(this.state));
      const side = `${this.state}.new-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
      fs.mkdirSync(side);
      appendLine(path.join(side, 'journal.jsonl'), JSON.stringify({ type: 'init', created: [...created, this.state], state: this.state, preexisting: { backups: false, runs: false }, seq: 0, ts: new Date().toISOString(), prev: '0'.repeat(64) }) + '\n');
      try { fs.renameSync(side, this.state); created.length = 0; fsyncDir(path.dirname(this.state)); }
      catch (e) { // another run made the state dir first: use theirs
        try { fs.unlinkSync(path.join(side, 'journal.jsonl')); fs.rmdirSync(side); } catch { /* swept later */ }
        if (!['ENOTEMPTY', 'EEXIST'].includes(e.code)) throw e;
      }
    }
    const release = this.journal.lock();
    try {
      if (!this.journal.exists() || created.length) {
        this.journal.append({ type: 'init', created, state: this.state, preexisting: { backups: fs.existsSync(this.journal.backups), runs: fs.existsSync(this.journal.runs) } });
      }
    } catch (e) { release(); throw e; }
    return release;
  }
  ensureState() { this.lockState()(); }
  // the root the state dir must stay inside: itself when --state/PHAROS_STATE names it, else the scope root
  stateRoot() { return realpathDeep(this.session.stateOverride ? this.session.stateOverride : (this.scope === 'target' ? this.target : this.home)); }
  intent(rec) { this.ensureState(); return this.journal.append({ type: 'intent', run: this.run, door: this.id, step: this.step, ...rec }); }
  done(ref, rec = {}) { this.journal.append({ type: 'done', ref, ...rec }); }
  failed(ref, why) { this.journal.append({ type: 'failed', ref, why }); }
  homeGuard(root) {
    if ((root === 'HOME' || this.scope === 'home') && isRealHome(this.home) && !this.session.yesRealHome) {
      throw new Refused('HOME is the real home directory; use a sandbox HOME (a human may pass --yes-real-home)');
    }
  }
  // ---- mutating (apply only)
  mkdirs(dir, rootDecl) {
    const need = [];
    let p = dir;
    while (!fs.existsSync(p)) { need.unshift(p); p = path.dirname(p); }
    for (const d of need) {
      this.assertDeclared(d);
      checkWritePath(path.join(d, 'x'), rootDecl.root);
      const ref = this.intent({ op: 'mkdir', path: d, before: { exists: false } });
      fs.mkdirSync(d);
      this.done(ref);
    }
  }
  // planned: what the plan saw at this path ('absent' or a sha256) when it computed the new bytes
  write(abs, bytes, { mode, block, planned } = {}) {
    abs = path.resolve(abs);
    const decl = this.assertDeclared(abs);
    this.homeGuard(decl.token);
    checkWritePath(abs, decl.root);
    const probe = snap(abs);
    if (probe.dir || probe.symlink || probe.special) throw new Refused(`not a regular file: ${abs}`);
    if (probe.exists && probe.sha256 === sha256(bytes)) return false;
    const release = this.lockState();
    try {
      checkWritePath(abs, decl.root);
      const before = snap(abs); // again, under the lock: the state the backup and the intent describe
      if (before.dir || before.symlink || before.special) throw new Refused(`not a regular file: ${abs}`);
      const after = { sha256: sha256(bytes), mode: mode ?? before.mode ?? 0o644 };
      if (before.exists && before.sha256 === after.sha256) return false;
      // the new bytes were computed from what the plan read: if the file is no longer that, writing them would drop the difference
      if (planned !== undefined && planned !== (before.exists ? before.sha256 : 'absent')) throw new Refused(`${abs} changed after the plan was made; nothing was written, run again`);
      if (before.exists) { const old = fs.readFileSync(abs); if (sha256(old) !== before.sha256) throw new Refused(`${abs} changed while it was being read; run again`); this.journal.append({ type: 'backup', run: this.run, door: this.id, sha256: before.sha256 }); this.journal.backup(old); } // the backup record comes first; its hash is journaled before its temp file exists, so undo can remove a leftover temp
      this.mkdirs(path.dirname(abs), decl);
      const tmp = tmpNameFor(abs);
      const ref = this.intent({ op: 'write', path: abs, before, after, tmp, ...(block ? { block } : {}) });
      // the last look before the rename: the path must still be safe and the file must still be the one that was backed up
      const check = () => { checkWritePath(abs, decl.root); const now = snap(abs); if (now.exists !== before.exists || now.sha256 !== before.sha256) throw new Refused(`${abs} changed while it was being written; nothing was replaced, run again`); };
      try { atomicWrite(abs, bytes, after.mode, { tmp, check }); } catch (err) { this.failed(ref, err.message); throw err; }
      this.done(ref);
      return true;
    } finally { release(); }
  }
  execAction(a) {
    this.assertTool(a.tool);
    this.homeGuard(null);
    const creates = (a.creates || []).map((p) => { const decl = this.assertDeclared(p); checkWritePath(p, decl.root); return { path: p, existed: fs.existsSync(p) }; });
    if (a.reverse) this.assertTool(a.reverse.tool);
    this.ensureState();
    const ref = this.intent({ op: a.op, key: keyOf(a), tool: a.tool, argv: a.argv, cwd: a.cwd || null, reverse: a.reverse || null, undo_note: a.undoNote || null, creates, ...(a.op === 'setenv' ? { name: a.name, value: a.value } : {}) });
    return ref;
  }
  exec(a) {
    for (const d of a.mkdirs || []) this.mkdirs(d, this.assertDeclared(d));
    const ref = this.execAction(a);
    const r = this._spawn(a.tool, a.argv, { cwd: a.cwd, timeout: a.timeoutMs, raw: !!a.raw });
    if (!r.found || r.code !== 0) {
      this.failed(ref, r.found ? `exit ${r.code}` : 'tool not found');
      throw new StepFailed(`${a.tool} ${a.argv.join(' ')}: ${r.found ? `exit ${r.code}` : 'not found on PATH'}${r.stderr ? ` (${r.stderr.trim().split('\n').pop().slice(0, 160)})` : ''}`);
    }
    if (a.check) { try { a.check(this, r); } catch (err) { this.failed(ref, err.message); throw err; } } // a failed check is journaled as failed, so a later plan does not call it satisfied
    this.done(ref, { code: r.code, out: a.raw ? '' : r.stdout.slice(-400) });
    return r;
  }
  setenv(a) {
    this.assertTool('launchctl');
    const cur = this.probe('launchctl', ['getenv', a.name]);
    const before = cur.found && cur.stdout.trim() !== '' ? cur.stdout.replace(/\n$/, '') : null;
    if (before === a.value) return { skipped: 'already set' };
    this.ensureState();
    const ref = this.intent({ op: 'setenv', key: keyOf(a), tool: 'launchctl', name: a.name, value: a.value, env_before: before, argv: ['setenv', a.name, a.value], creates: [] });
    const r = this._spawn('launchctl', ['setenv', a.name, a.value]);
    if (!r.found || r.code !== 0) { this.failed(ref, `exit ${r.code}`); throw new StepFailed(`launchctl setenv ${a.name}: exit ${r.code}`); }
    this.done(ref);
    return {};
  }
  spawnDetached(a) {
    this.mkdirs(path.dirname(a.log), this.assertDeclared(path.dirname(a.log))); // before the intent, so undo removes the log first
    const ref = this.execAction(a);
    if (!which(a.tool)) { this.failed(ref, 'tool not found'); throw new StepFailed(`${a.tool}: not found on PATH`); }
    this.assertDeclared(a.log);
    const fd = fs.openSync(a.log, 'a');
    const child = spawn(a.tool, a.argv, { cwd: a.cwd, detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, PATH: safePath(), ...(a.env || {}) } });
    child.unref(); fs.closeSync(fd);
    this.done(ref, { pid: child.pid, started: procInfo(child.pid)?.started ?? null }); // undo signals the pid only if it is still this process
    return child.pid;
  }
  // Called under the lock before a new run plans. A write that an earlier run began and never recorded as done is
  // settled from what is on disk: the new bytes are in place (record it as done), or they are not (remove the leftover
  // temp file, by the exact name the entry recorded). Nothing else is touched, and nothing is guessed.
  recover() {
    let act; try { act = this.journal.active().filter((x) => x.intent.door === this.id && x.intent.op === 'write' && !x.done && !x.failed); } catch { return; }
    for (const x of act) {
      const it = x.intent;
      if (typeof it.path !== 'string' || !this.declared(it.path) || !it.after) continue;
      if (it.tmp && typeof it.tmp === 'string' && path.dirname(it.tmp) === path.dirname(it.path) && /^\.[^/]*\.pharos-[0-9a-f]{12}\.tmp$/.test(path.basename(it.tmp))) {
        const ts = fs.lstatSync(it.tmp, { throwIfNoEntry: false });
        if (ts && ts.isFile()) fs.unlinkSync(it.tmp);
      }
      const cur = snap(it.path);
      if (cur.exists && cur.sha256 && cur.sha256 === it.after.sha256) this.journal.append({ type: 'done', ref: it.seq, recovered: true });
    }
  }
  pendingRuns() {
    try { if (!this.journal.exists()) return []; return [...runStates(this.journal.read().entries, this.id).values()].filter((r) => !r.resolved); } catch { return []; }
  }
  rmCreated(p) {
    const decl = this.assertDeclared(p);
    checkWritePath(p, decl.root);
    fs.rmSync(p, { recursive: true, force: true });
  }
}

function levelMax(a, b) { return LADDER.indexOf(a) >= LADDER.indexOf(b) ? a : b; }

export class Session {
  constructor(doors, o) {
    this.doors = doors;
    this.home = path.resolve(o.home || process.env.HOME || os.homedir());
    this.flags = o.flags || new Map();
    this.apply = !!o.apply;
    this.yesRealHome = !!o.yesRealHome;
    this.keepJournal = !!o.keepJournal;
    this.runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + crypto.randomBytes(3).toString('hex');
    this.target = o.target ? checkTarget(o.target, this.home) : null;
    if (this.target && (!fs.existsSync(this.target) || !fs.statSync(this.target).isDirectory())) throw new Usage(`--target ${this.target} is not a directory`);
    this.stateOverride = o.state ? path.resolve(checkPathArg(o.state, '--state')) : (process.env.PHAROS_STATE ? path.resolve(checkPathArg(process.env.PHAROS_STATE, 'PHAROS_STATE')) : null);
    if (this.stateOverride) {
      const f = forbidden(this.stateOverride); if (f) throw new Refused(`state dir is inside a protected place (${f})`);
      const esc = escapingSymlink(this.stateOverride); if (esc) throw new Refused(`state dir passes through an escaping symlink: ${esc.link}`);
    }
    // the default checkout folder name belongs to the door that uses one (its door.mjs says `checkoutDir`), not to the core
    const dflt = [...doors.values()].map((d) => d.impl && d.impl.checkoutDir).find((n) => typeof n === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(n));
    this.khoraDir = o.khoraDir ? path.resolve(checkPathArg(o.khoraDir, '--khora-dir')) : dflt ? path.join(this.home, dflt) : null;
    if (o.khoraDir) {
      const esc = escapingSymlink(this.khoraDir); if (esc) throw new Refused(`--khora-dir passes through an escaping symlink: ${esc.link}`);
      const f = forbidden(this.khoraDir); if (f) throw new Refused(`--khora-dir is inside a protected place (${f})`);
      const ok = [this.home, this.target, ...allowRoots()].filter(Boolean).some((r) => within(realpathDeep(this.khoraDir), realpathDeep(r)));
      if (!ok) throw new Refused('--khora-dir must be inside HOME, the target, or PHAROS_ROOT_ALLOW');
    }
  }
  ctx(id) { return new Ctx(this, id); }

  // ---------- plan
  prepare(ctx, step, a) {
    const r = { ...a, step: step.id };
    if (a.op === 'write') {
      const abs = path.resolve(a.path); r.path = abs;
      const decl = ctx.assertDeclared(abs);
      const before = snap(abs);
      if (before.dir || before.symlink || before.special) throw new Refused(`not a regular file: ${abs}`); // a fifo or device is never read: the plan must not block on it
      r.before = before.exists ? before.sha256 : 'absent';
      const read = ctx.readSha.get(abs); // what the door saw when it computed the new bytes
      if (read !== undefined && read !== r.before) throw new Refused(`${abs} changed while the plan was being made; nothing was written, run again`);
      const mk = []; for (let d = path.dirname(abs); !fs.existsSync(d) && path.dirname(d) !== d; d = path.dirname(d)) mk.unshift(d);
      if (mk.length) r.creates_dirs = mk; // apply creates these (journaled); the plan says so
      if (typeof a.content === 'function') { r.after = '(computed at apply)'; r.lazy = true; }
      else {
        const buf = Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content);
        r.content = buf; r.after = sha256(buf);
        r.satisfied = before.exists && before.sha256 === r.after;
        if (!r.satisfied && before.exists) {
          const old = fs.readFileSync(abs, 'utf8'); const neu = buf.toString('utf8');
          if (!old.includes('\0')) r.diff = unifiedDiff(old, neu, path.basename(abs));
        }
      }
      void decl;
    } else if (a.op === 'exec' || a.op === 'spawn') {
      ctx.assertTool(a.tool);
      if (a.reverse) ctx.assertTool(a.reverse.tool);
      for (const c of a.creates || []) ctx.assertDeclared(c);
      if (a.log) ctx.assertDeclared(a.log);
      r.satisfied = ctx.journal.active().some((x) => x.done && x.intent.key === keyOf(r) && x.intent.door === ctx.id);
    } else if (a.op === 'setenv') {
      ctx.assertTool('launchctl');
      r.tool = 'launchctl'; r.argv = ['setenv', a.name, a.value];
      r.satisfied = ctx.journal.active().some((x) => x.done && x.intent.key === keyOf(r) && x.intent.door === ctx.id);
    } else throw new Error(`unknown action op ${a.op}`);
    return r;
  }

  describe(a) {
    const o = { op: a.op };
    if (a.op === 'write') Object.assign(o, { path: a.path, before: a.before, after: a.after, ...(a.creates_dirs ? { creates_dirs: a.creates_dirs } : {}), ...(a.diff ? { diff: a.diff } : {}) });
    else if (a.op === 'setenv') Object.assign(o, { tool: 'launchctl', name: a.name, value: a.value, argv: a.argv, undo: 'restore prior value (read with `launchctl getenv` at apply), else unsetenv' });
    else Object.assign(o, { tool: a.tool, argv: a.argv, ...(a.cwd ? { cwd: a.cwd } : {}), ...(a.creates?.length ? { creates: a.creates } : {}), ...(a.mkdirs?.length ? { creates_dirs: a.mkdirs.filter((d) => !fs.existsSync(d)) } : {}), ...(a.log ? { log: a.log } : {}), undo: a.reverse ? `${a.reverse.tool} ${a.reverse.argv.join(' ')}` : a.creates?.length ? 'remove what it created' : (a.undoNote || 'none') });
    if (a.note) o.note = a.note;
    if (a.satisfied) o.satisfied = true;
    return o;
  }

  async planDoor(id) {
    const ctx = this.ctx(id); const { manifest, impl } = ctx;
    const out = { door: id, kind: manifest.kind || 'installable', side_effects: manifest.side_effects, summary: manifest.summary, scope: ctx.scope, state: ctx.state, steps: [], skipped: [], notes: [], will_change: false, _live: [] };
    if (out.kind === 'detect-only') out.message = 'detect-only: not installable from the public tree; apply exits non-zero. Use detect and verify.';
    for (const s of manifest.steps) {
      const enabled = s.default_on || !s.flag || this.flags.has(s.flag);
      const base = { id: s.id, summary: s.summary, level: s.level, flag: s.flag || null, undo: s.undo || 'none' };
      if (!enabled) { const reason = `SKIPPED (needs ${s.flag})`; out.skipped.push({ step: s.id, flag: s.flag, level: s.level, reason }); out.steps.push({ ...base, status: 'skipped', reason }); continue; }
      const sd = impl.steps[s.id];
      if (!sd) throw new Error(`${id}: step ${s.id} has no implementation`);
      const r = (await sd.plan(ctx)) || {};
      const actions = (r.actions || []).map((a) => this.prepare(ctx, s, a));
      let status = r.blocked ? 'blocked' : actions.length === 0 || actions.every((a) => a.satisfied) ? 'satisfied' : 'run';
      if (out.kind === 'detect-only') status = actions.length ? 'blocked' : 'satisfied';
      out.steps.push({ ...base, status, ...(r.why ? { why: r.why } : {}), ...(r.blocked ? { reason: r.blocked } : {}), actions: actions.map((a) => this.describe(a)), ...(r.notes?.length ? { notes: r.notes } : {}) });
      out._live.push({ step: s, status, actions });
      if (status === 'run') out.will_change = true;
    }
    out.steps_run = out.steps.filter((x) => x.status === 'run').map((x) => x.id);
    return out;
  }
  publicPlan(p) { const { _live, ...rest } = p; return rest; }

  // ---------- apply
  // One run at a time per state dir: the journal lock is held from before the plan is re-read until the last
  // step is done, and the plan is made again under the lock, so a concurrent run cannot leave this one with
  // a stale picture of the files it is about to write.
  async applyDoor(plan) {
    if (plan.kind === 'detect-only') return this.applyLocked(plan, null);
    const ctx = this.ctx(plan.door);
    // A run that changes nothing still takes the lock when an earlier run of this door was interrupted: it must settle
    // that run's bookkeeping, so that status stops saying partial once the work is in place.
    if (!plan.will_change && ctx.pendingRuns().length === 0) return this.applyLocked(plan, null);
    const release = ctx.lockState();
    try {
      ctx.recover();
      const fresh = await this.planDoor(plan.door);
      return await this.applyLocked(fresh, ctx);
    } finally { release(); }
  }

  async applyLocked(plan, lockedCtx) {
    const ctx = lockedCtx || this.ctx(plan.door);
    const res = { door: plan.door, steps: [], ok: true, notes: [] };
    if (plan.kind === 'detect-only') { res.ok = false; res.error = plan.message; return res; }
    const track = plan.will_change || (!!lockedCtx && ctx.pendingRuns().length > 0);
    if (plan.will_change) {
      ctx.ensureState();
      fs.mkdirSync(ctx.journal.runs, { recursive: true });
      ctx.journal.append({ type: 'run-file', run: this.runId, door: plan.door }); // named before the file exists, so undo can remove a leftover temp
      atomicWrite(path.join(ctx.journal.runs, `${this.runId}-${plan.door}.json`), Buffer.from(JSON.stringify(this.publicPlan(plan), null, 2) + '\n'), 0o644);
      ctx.journal.append({ type: 'run-start', run: this.runId, door: plan.door, steps_run: plan.steps_run || [], plan_sha256: sha256(JSON.stringify(this.publicPlan(plan))) });
    }
    for (const { step, status, actions } of plan._live) {
      ctx.step = step.id;
      if (status === 'blocked') { res.ok = false; res.steps.push({ id: step.id, status: 'blocked' }); res.error = `step ${step.id} is blocked`; break; }
      if (status !== 'run') { res.steps.push({ id: step.id, status }); continue; }
      let ran = 0;
      try {
        for (const a of actions) {
          if (a.satisfied) continue;
          if (a.skipIf && (await a.skipIf(ctx))) continue;
          if (a.pre) await a.pre(ctx);
          if (a.op === 'write') {
            const buf = a.lazy ? Buffer.from(await a.content(ctx)) : a.content;
            if (ctx.write(a.path, buf, { mode: a.mode, block: a.block, ...(a.lazy ? {} : { planned: a.before }) })) ran++;
          } else if (a.op === 'exec') { ctx.exec(a); ran++; if (a.then) { const n = await a.then(ctx); if (n) res.notes.push(n); } }
          else if (a.op === 'setenv') { const r = ctx.setenv(a); if (!r.skipped) ran++; }
          else if (a.op === 'spawn') { ctx.spawnDetached(a); ran++; if (a.ready) await a.ready(ctx); }
        }
        res.steps.push({ id: step.id, status: ran ? 'applied' : 'satisfied', actions_run: ran });
      } catch (err) {
        res.ok = false; res.error = err.message; res.exit = err.exit || 1; res.code = err.code;
        res.steps.push({ id: step.id, status: 'failed', error: err.message });
        break;
      }
    }
    if (track) ctx.journal.append({ type: 'run-end', run: this.runId, door: plan.door, ok: res.ok, steps_done: res.steps.filter((x) => x.status === 'applied' || x.status === 'satisfied').map((x) => x.id) });
    return res;
  }

  // ---------- verify / status / detect
  async runChecks(ctx, checks) {
    const out = [];
    for (const c of checks) {
      let ok = false, detail = '';
      const p = c.path ? ctx.tok(c.path) : null;
      try {
        if (c.path && !p) detail = 'path token is not set';
        else if (c.type === 'file-exists') { ok = ctx.exists(p); detail = p; }
        else if (c.type === 'file-sha256') { const b = ctx.readFile(p); ok = !!b && sha256(b) === c.sha256; detail = p; }
        else if (c.type === 'json-valid') { const b = ctx.readFile(p); ok = false; if (b) { JSON.parse(b.toString('utf8')); ok = true; } detail = p; }
        else if (c.type === 'block-present') { const t = ctx.readFile(p)?.toString('utf8') || ''; const id = c.command?.[0]; ok = t.includes(`<!-- pharos:begin ${id}`) && t.includes(`<!-- pharos:end ${id}`); detail = p; }
        else if (c.type === 'command-ok') { ctx.assertTool(c.command[0]); const r = ctx._spawn(c.command[0], c.command.slice(1)); ok = r.found && r.code === 0; detail = c.command.join(' '); }
        else if (c.type === 'port-answers') { ok = await new Promise((res) => { const s = net.connect({ port: c.port, host: '127.0.0.1', timeout: 1000 }, () => { s.destroy(); res(true); }); s.on('error', () => res(false)); s.on('timeout', () => { s.destroy(); res(false); }); }); detail = `127.0.0.1:${c.port}`; }
        else if (c.type === 'pharos-status') {
          const b = ctx.readFile(path.join(ctx.target, 'pharos.json'));
          const ptr = b ? JSON.parse(b.toString('utf8')) : null;
          ok = !!ptr && ptr.kind === 'pharos-pointer' && ptr.wrote && Object.entries(ptr.wrote).every(([n, h]) => { const f = ctx.readFile(path.join(ctx.target, path.basename(n))); return f && sha256(f) === h; });
          detail = 'pharos.json is a pointer and its recorded files match';
        }
      } catch (err) { ok = false; detail = `${c.type}: ${err.message}`; }
      out.push({ id: c.id, ok, detail });
    }
    return out;
  }
  async verifyDoor(id) {
    const ctx = this.ctx(id);
    const checks = ctx.impl.verify ? await ctx.impl.verify(ctx) : await this.runChecks(ctx, ctx.manifest.verify || []);
    return { door: id, ok: checks.every((c) => c.ok), checks };
  }
  async detectDoor(id) {
    const ctx = this.ctx(id);
    const d = await ctx.impl.detect(ctx);
    return { door: id, kind: ctx.manifest.kind || 'installable', ...d };
  }
  statusDoor(id) {
    const ctx = this.ctx(id);
    let act, runs;
    try { act = ctx.journal.active().filter((x) => x.intent.door === id); runs = runStates(ctx.journal.exists() ? ctx.journal.read().entries : [], id); }
    catch (err) { if (err instanceof JournalForged) return { door: id, status: 'journal-invalid', applied_steps: [], drift: [], journaled: true, error: err.message, note: 'the journal fails its hash-chain check; nothing is trusted and undo-door refuses to run' }; throw err; }
    const drift = [], interrupted = [], steps = new Set(); let partial = false;
    const resolved = new Set([...runs.values()].filter((r) => r.resolved).map((r) => r.run)); // a later complete run finished what these meant to do
    const nowOf = (cur, beforeSha, afterSha, hadBefore) => !cur.exists ? (hadBefore ? 'missing' : 'original intact (file absent, as before)') : cur.sha256 === beforeSha ? 'original intact' : cur.sha256 === afterSha ? 'new content in place' : 'unexpected content';
    for (const x of act) {
      const it = x.intent;
      if (!x.done) {
        if (resolved.has(it.run)) continue;
        partial = true;
        if (it.op === 'write') interrupted.push({ path: it.path, now: nowOf(snap(it.path), it.before.sha256, it.after.sha256, it.before.exists) });
        else interrupted.push({ op: it.op, step: it.step });
        continue;
      }
      steps.add(it.step);
      if (it.op === 'write') {
        const cur = snap(it.path);
        if (!cur.exists || cur.sha256 !== it.after.sha256) drift.push(it.path);
      }
    }
    // A run that was killed before it journaled the intent of a later write: the run's own plan file (checked against the
    // hash in its run-start entry) names the writes it meant to make; those with no intent are interrupted too.
    for (const r of runs.values()) {
      if (r.resolved) continue;
      const plan = this.readRunPlan(ctx, r, id);
      if (!plan) { if (!r.end) { partial = true; interrupted.push({ run: r.run, now: 'unknown (run record unreadable)' }); } continue; }
      for (const st of plan.steps || []) {
        if (st.status !== 'run') continue;
        for (const a of st.actions || []) {
          if (a.satisfied) continue;
          if (a.op === 'write') {
            if (act.some((x) => x.intent.run === r.run && x.intent.op === 'write' && x.intent.path === a.path)) continue;
            partial = true; interrupted.push({ path: a.path, now: nowOf(snap(a.path), a.before, a.after, a.before !== 'absent') });
          } else if (!act.some((x) => x.intent.run === r.run && x.intent.step === st.id && x.intent.op === a.op)) { partial = true; interrupted.push({ op: a.op, step: st.id, now: 'not started' }); }
        }
      }
    }
    const status = !act.length && !partial ? 'not-installed' : partial ? 'partial' : drift.length ? 'drifted' : 'installed';
    return { door: id, status, applied_steps: [...steps], drift, ...(interrupted.length ? { interrupted, note: 'a run was interrupted: undo-door restores what it changed' } : {}), journaled: act.length > 0 || partial };
  }
  readRunPlan(ctx, r, door) {
    if (!/^[0-9A-Za-z-]+$/.test(r.run || '') || !/^[a-z][a-z0-9-]*$/.test(door)) return null;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(ctx.journal.runs, `${r.run}-${door}.json`), 'utf8'));
      return sha256(JSON.stringify(j)) === r.plan_sha256 ? j : null;
    } catch { return null; }
  }

  // ---------- undo
  // Every entry is checked against the door's manifest again before it is acted on: a journal line is data,
  // never a command. Entries that fail the check are reported and left in place (exit 1), not skipped quietly.
  undoState(state, ids) {
    const j = new Journal(state);
    const report = { state, undone: [], kept: [], notes: [], missing: [] };
    this.guardUndoState(state, ids, j);
    this.sweepResidue(state);
    if (!j.exists()) { if (fs.lstatSync(j.lockFile, { throwIfNoEntry: false })) j.staleLock(); return { ...report, nothing: true }; } // a dead run's lock file is removed; a state dir without a journal is not ours
    const mk = new Map();
    const ctxFor = (id) => { if (!mk.has(id)) { if (!this.doors.has(id)) throw new Refused(`journal names a door that is not installed: ${JSON.stringify(id)}`); const c = new Ctx(this, id); c.state = state; c.journal = j; mk.set(id, c); } return mk.get(id); };
    const release = j.lock();
    try {
      const all = j.read(); // verifies the hash chain: a forged or edited line throws here, before anything is touched
      const stateReal = realpathDeep(state);
      for (const e of all.entries) if (e.type === 'init') for (const c of e.created || []) if (typeof c !== 'string' || !within(stateReal, realpathDeep(c)) || forbidden(c)) throw new JournalForged(`init entry names a directory that is not the state dir or one of its parents: ${JSON.stringify(c)}`);
      const act = j.active().filter((x) => x.intent.op && (!ids || ids.includes(x.intent.door))).reverse();
      for (const x of act) {
        const it = x.intent;
        const label = `${it.door}:${it.step || ''} ${it.op} ${it.path || it.name || [it.tool, ...(it.argv || [])].join(' ')}`;
        let keep = false;
        try {
          const ctx = ctxFor(it.door);
          if (it.op === 'write') {
            const decl = ctx.assertDeclared(it.path); ctx.homeGuard(decl.token);
            if (it.tmp) { // a temp file an interrupted write may have left; only the exact name this entry recorded
              if (path.dirname(it.tmp) !== path.dirname(it.path) || !/^\.[^/]*\.pharos-[0-9a-f]{12}\.tmp$/.test(path.basename(it.tmp))) throw new Refused(`entry names an unexpected temp file ${it.tmp}`);
              const ts = fs.lstatSync(it.tmp, { throwIfNoEntry: false });
              if (ts && ts.isFile()) fs.unlinkSync(it.tmp);
            }
            // a temp file an interrupted UNDO may have left for this entry (same exact-name rule)
            for (const e of all.entries) if (e.type === 'undo-tmp' && e.ref === it.seq && typeof e.tmp === 'string' && path.dirname(e.tmp) === path.dirname(it.path) && TMP_NAME.test(path.basename(e.tmp))) {
              const ts = fs.lstatSync(e.tmp, { throwIfNoEntry: false });
              if (ts && ts.isFile()) fs.unlinkSync(e.tmp);
            }
            const restore = (bytes, mode) => { const tmp = tmpNameFor(it.path); j.append({ type: 'undo-tmp', ref: it.seq, tmp }); atomicWrite(it.path, bytes, mode, { tmp, check: () => checkWritePath(it.path, decl.root) }); };
            const cur = snap(it.path);
            if (cur.dir || cur.symlink || cur.special) { keep = true; report.kept.push(`${it.path} (is no longer a regular file; left alone)`); }
            else if (!cur.exists) { report.missing.push(label); }
            else if (cur.sha256 === it.after.sha256) {
              checkWritePath(it.path, decl.root);
              if (it.before.exists) {
                const bytes = j.getBackup(it.before.sha256);
                restore(bytes, it.before.mode);
              } else fs.unlinkSync(it.path);
            } else if (it.before.exists && cur.sha256 === it.before.sha256) { if (!x.done) report.notes.push(`${it.path}: the interrupted write never replaced it; original intact`); }
            else if (it.block && typeof it.block.inserted === 'string' && it.block.inserted !== '' && (it.block.replaced === undefined || typeof it.block.replaced === 'string') && fs.readFileSync(it.path, 'utf8').includes(it.block.inserted)) {
              checkWritePath(it.path, decl.root);
              const was = it.block.replaced || ''; // a refresh put the block in place of an older one: that one comes back
              const rest = fs.readFileSync(it.path, 'utf8').replace(it.block.inserted, () => was);
              if (rest === '' && !it.before.exists) fs.unlinkSync(it.path); else restore(Buffer.from(rest), cur.mode);
              report.notes.push(`${it.path}: edited since apply; ${was ? 'put back the older pharos block only' : 'removed only the pharos block'}`);
            } else { keep = true; report.kept.push(`${it.path} (edited since apply; left alone, undo NOT complete)`); report.drifted = [...(report.drifted || []), it.path]; }
          } else if (it.op === 'mkdir') {
            const decl = ctx.assertDeclared(it.path); checkWritePath(path.join(it.path, 'x'), decl.root);
            try { fs.rmdirSync(it.path); } catch (err) { if (err.code !== 'ENOENT') { report.kept.push(`${it.path} (directory not empty; left alone)`); } }
          } else if (it.op === 'setenv') {
            ctx.assertTool('launchctl');
            if (typeof it.name !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(it.name) || !(it.env_before === null || typeof it.env_before === 'string')) throw new Refused('malformed setenv entry');
            if (!ctx.manifest.touches.env.includes(it.name)) throw new Refused(`${it.name} is not an environment name this door declares`);
            const r = ctx._spawn('launchctl', it.env_before === null ? ['unsetenv', it.name] : ['setenv', it.name, it.env_before]);
            if (r.code !== 0) throw new StepFailed(`launchctl ${it.env_before === null ? 'unsetenv' : 'setenv'} ${it.name}: exit ${r.code}`);
          } else if (it.op === 'exec' || it.op === 'spawn') {
            ctx.assertTool(it.tool);
            if (it.op === 'spawn' && Number.isInteger(x.done?.pid) && x.done.pid > 1) {
              // signal the pid only if it is still the process this run started: same start time, same tool and script
              const info = procInfo(x.done.pid);
              const script = Array.isArray(it.argv) && typeof it.argv[0] === 'string' && it.argv[0] ? it.argv[0] : null;
              if (!info) report.notes.push(`pid ${x.done.pid}: already gone`);
              else if (typeof x.done.started === 'string' && info.started === x.done.started && script && info.command.includes(script) && info.command.includes(it.tool)) { try { process.kill(x.done.pid); } catch { /* already gone */ } }
              else report.notes.push(`pid ${x.done.pid}: NOT signalled (it is not provably the process this run started); if it is the service, stop it by hand`);
            }
            if (it.reverse) {
              ctx.assertTool(it.reverse.tool);
              const shape = Object.hasOwn(REVERSE_SHAPES, it.reverse.tool) ? REVERSE_SHAPES[it.reverse.tool] : null;
              if (!shape || !Array.isArray(it.reverse.argv) || !it.reverse.argv.every((v) => typeof v === 'string') || !shape(it.reverse.argv)) throw new Refused(`reverse command ${it.reverse.tool} ${(Array.isArray(it.reverse.argv) ? it.reverse.argv : []).join(' ').slice(0, 80)} is not an allowed reverse`);
              if (it.reverse.cwd !== undefined && it.reverse.cwd !== null && (typeof it.reverse.cwd !== 'string' || !ctx.declared(it.reverse.cwd))) throw new Refused('reverse command names a working directory this door does not declare');
              const r = ctx._spawn(it.reverse.tool, it.reverse.argv, { cwd: it.reverse.cwd }); if (r.code !== 0) throw new StepFailed(`${it.reverse.tool} ${it.reverse.argv.join(' ')}: exit ${r.code}`);
            }
            // only paths this entry recorded as created by it (existed:false), and only declared ones
            for (const c of it.creates || []) if (!c.existed && fs.lstatSync(c.path, { throwIfNoEntry: false })) ctx.rmCreated(c.path);
            if (it.undo_note && !it.reverse) report.notes.push(it.undo_note);
          }
        } catch (err) { report.kept.push(`${label}: ${err.message}`); report.failed = true; continue; }
        if (keep) { report.failed = true; continue; } // drift: the entry stays active, status keeps saying so, exit is non-zero
        j.append({ type: 'undone', ref: it.seq });
        report.undone.push(label);
      }
      // Nothing left that is ours: remove the state files this journal created, and nothing else, so the tree is
      // exactly as it was. Backups and plan files are removed by the names the journal records; directories are
      // removed only with rmdir (never recursively) and only if they did not exist before the first run.
      if (!report.failed && !this.keepJournal && j.active().filter((x) => x.intent.op).length === 0) {
        this.guardUndoState(state, ids, j); // again, right before the state files are removed
        const { entries, head } = j.read();
        report.journal_head = head; report.journal_entries = entries.length;
        const inits = entries.filter((e) => e.type === 'init');
        const pre = inits[0]?.preexisting || {};
        const created = inits.flatMap((e) => e.created || []);
        const hashes = new Set(entries.filter((e) => (e.type === 'intent' && e.before?.sha256) || (e.type === 'backup' && e.sha256)).map((e) => e.before?.sha256 || e.sha256));
        // a leftover temp is removed only by the exact shape of a temp name for a hash or run this journal recorded
        const leftovers = (dir, base) => { try { for (const n of fs.readdirSync(dir)) if (/^\.[^/]*\.pharos-[0-9a-f]{12}\.tmp$/.test(n) && n.startsWith(`.${base}.pharos-`) && n.length === base.length + 1 + 8 + 12 + 4) { const ts = fs.lstatSync(path.join(dir, n)); if (ts.isFile()) fs.unlinkSync(path.join(dir, n)); } } catch { /* none */ } };
        for (const h of hashes) if (/^[0-9a-f]{64}$/.test(h)) { fs.rmSync(path.join(j.backups, h), { force: true }); leftovers(j.backups, h); }
        for (const e of entries) if ((e.type === 'run-start' || e.type === 'run-file') && /^[0-9A-Za-z-]+$/.test(e.run || '') && /^[a-z][a-z0-9-]*$/.test(e.door || '')) { fs.rmSync(path.join(j.runs, `${e.run}-${e.door}.json`), { force: true }); leftovers(j.runs, `${e.run}-${e.door}.json`); }
        if (!pre.backups) try { fs.rmdirSync(j.backups); } catch { /* not empty: holds files that are not ours */ }
        if (!pre.runs) try { fs.rmdirSync(j.runs); } catch { /* not empty: holds files that are not ours */ }
        const ours = (n) => n === 'journal.jsonl' || n === 'lock' || n.startsWith('lock.stale-');
        let left = null; try { left = fs.readdirSync(state); } catch { /* gone */ }
        if (left && created.includes(state) && left.every(ours)) {
          // The state dir is ours and holds nothing else: it leaves under its own name in ONE step (a rename to a side
          // name carrying this pid), then the side folder is emptied. A kill on the way leaves only the side folder.
          const side = `${state}.gone-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
          fs.renameSync(state, side);
          release();
          for (const n of left) fs.rmSync(path.join(side, n), { force: true });
          try { fs.rmdirSync(side); } catch { /* swept by the next run */ }
          for (const d of [...created].reverse()) if (d !== state) { try { fs.rmdirSync(d); } catch { /* not empty: not ours alone */ } }
        } else {
          fs.rmSync(j.file, { force: true });
          release(); // drops the lock file
          for (const d of [...created].reverse()) { try { fs.rmdirSync(d); } catch { /* not empty: not ours alone */ } }
        }
        report.state_removed = !fs.existsSync(state);
      }
    } finally { release(); }
    return report;
  }
  stateOf(id) { return this.ctx(id).state; }
  // Undo deletes: it must never do so through a link. The state dir and the three things in it must not be
  // symlinks, and the state dir must still resolve inside its root.
  guardUndoState(state, ids, j) {
    for (const p of [state, j.file, j.backups, j.runs, j.lockFile]) {
      const st = fs.lstatSync(p, { throwIfNoEntry: false });
      if (st && st.isSymbolicLink()) throw new Refused(`refusing to undo through a symlink: ${p}`);
    }
    const esc = escapingSymlink(state);
    if (esc) throw new Refused(`state dir passes through a symlink that leaves its directory: ${esc.link} -> ${esc.real}`);
    const f = forbidden(state); if (f) throw new Refused(`state dir is inside a protected place (${f})`);
    const id = (ids || []).find((x) => this.doors.has(x));
    if (id) { const root = this.ctx(id).stateRoot(); if (!within(realpathDeep(state), root)) throw new Refused(`state dir resolves outside ${root}: ${state}`); }
  }
  // Side folders a killed run left beside the state dir (<state>.new-<pid>-<hex> while a state dir was being made,
  // <state>.gone-<pid>-<hex> while one was being removed). Removed only by that exact name shape, only when the pid in
  // the name is no longer running, and only when the folder holds nothing but the installer's own state files.
  sweepResidue(state) {
    const dir = path.dirname(state), base = path.basename(state);
    let names; try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names) {
      const m = /^(.*)\.(new|gone)-(\d+)-[0-9a-f]{12}$/.exec(n);
      if (!m || m[1] !== base) continue;
      const pid = Number(m[3]);
      if (pid === process.pid || (pid > 1 && alive(pid))) continue;
      const p = path.join(dir, n);
      try {
        if (!fs.lstatSync(p).isDirectory()) continue;
        const inside = fs.readdirSync(p);
        if (!inside.every((x) => x === 'journal.jsonl' || x === 'lock' || x.startsWith('lock.stale-') || x === 'backups' || x === 'runs')) continue;
        if (['backups', 'runs'].some((x) => inside.includes(x) && (!fs.lstatSync(path.join(p, x)).isDirectory() || fs.readdirSync(path.join(p, x)).length))) continue;
        for (const x of inside) { const q = path.join(p, x); if (fs.lstatSync(q).isDirectory()) fs.rmdirSync(q); else fs.unlinkSync(q); }
        fs.rmdirSync(p);
      } catch { /* left for a human */ }
    }
  }
}

export { levelMax };
