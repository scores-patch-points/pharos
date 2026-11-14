// Mutant maker (test author C, A1). Builds mutant COPIES of the release tree under
// ledgers/pharos-public/scratch/mutants/<ID>/pharos . The real tree is never modified.
//   node make_mutants.mjs [ID ...]        default: all of M1..M9 Q1..Q7
//   env PHAROS_SRC=<tree to copy>         default: the tree this file lives in
//
// HOW THE MUTANTS ARE MADE. This author was not allowed to read install/ or doors/, so a source edit of the installer is not possible.
// M1..M7 and Q1..Q7 are therefore BEHAVIOURAL mutants: the copy's bin/pharos.mjs is replaced by a wrapper that first loads
// bin/_mutant.mjs (a preload written here) and then runs the unmodified original (bin/pharos.orig.mjs). The preload injects ONE
// defect at the filesystem / process / crypto / os boundary that reproduces the defect named in PREREG(.A1) (comments below).
// M8 and M9 are real source edits of tools/public-scan.mjs (outside install/ and doors/). Each preload appends a line to
// <ID>/fired.log when its hook actually fires (writable only when run without the sandbox write wall: run_mutants.mjs probes it
// that way); a mutant whose hook never fires is INERT and is reported as such, never as "survived".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REAL_ROOT = path.resolve(HERE, '..', '..', '..');
export const SRC = process.env.PHAROS_SRC ? path.resolve(process.env.PHAROS_SRC) : REAL_ROOT;
export const MUT_BASE = path.resolve(HERE, '..', '..', '..', '..', 'ledgers', 'pharos-public', 'scratch', 'mutants');

export const DESCR = {
  M1: 'dry run writes one file (plan/apply without --apply creates <target>/.dry-write at exit)',
  M2: 'undo skips one file (the first restore/remove of a destination file under the target is not performed)',
  M3: 'apply touches an undeclared path (writes <target>/undeclared-file.txt at the end of an apply)',
  M4: 'apply twice appends the agents-md block twice (a second apply appends the block again)',
  M5: 'symlink escape allowed (realpath and lstat lie for paths under the target, so the guard sees no link)',
  M6: 'a shim call is made that is not declared (apply also runs curl against a URL)',
  M7: '--with-launchctl ignored (reader-stack --apply runs launchctl setenv without the flag)',
  M8: 'the scan misses a home-directory path in a dotfile (public-scan skips files whose name starts with a dot)',
  M9: 'the planted secret pattern list is truncated (public-scan keeps only the first three secret patterns)',
  Q1: 'D1: writes are not atomic (rename onto a destination file becomes truncate-and-write in two halves)',
  Q2: 'D2: undo claims success on a drifted file (exit code 1 becomes 0 for undo-door)',
  Q3: 'D3: undo deletes pre-existing state-dir contents (rm -rf of <state>/backups and <state>/runs at the end of undo)',
  Q4: 'D4: the journal hash chain is not verified (every journal-line hash is the same constant, so any edit passes the chain check)',
  Q5: 'D5: writes follow symlinks (rename onto a symlink writes through it; O_NOFOLLOW is stripped from open flags)',
  Q6: 'D6: the real home is unknown to the guard (os.userInfo reports a nonexistent home)',
  Q7: 'D7: the lock does not exclude (O_EXCL is stripped from creates of a path ending in /lock; EEXIST on a lock mkdir is swallowed)',
};
export const IDS = Object.keys(DESCR);

const PRE = (id) => `// mutant ${id}: ${DESCR[id]}
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import crypto from 'node:crypto';
import module from 'node:module';
import { fileURLToPath } from 'node:url';
const ID = ${JSON.stringify(id)};
const LOGF = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fired.log');
const fired = (m = '') => { try { fs.appendFileSync(LOGF, ID + ' ' + m + '\\n'); } catch { /* sandbox wall: ignore */ } };
const argv = process.argv.slice(2);
const cmd = argv[0];
const has = (f) => argv.includes(f);
const arg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const TARGET = arg('--target') ? path.resolve(arg('--target')) : null;
const STATE = arg('--state') ? path.resolve(arg('--state')) : (TARGET ? path.join(TARGET, '.pharos') : null);
const inTarget = (p) => TARGET && typeof p === 'string' && (path.resolve(p) === TARGET || path.resolve(p).startsWith(TARGET + path.sep));
const inState = (p) => STATE && typeof p === 'string' && (path.resolve(p) === STATE || path.resolve(p).startsWith(STATE + path.sep));
const DEST = new Set(['AGENTS.md', 'CLAUDE.md', 'pharos.json', 'holon.json']);
const isDest = (p) => typeof p === 'string' && inTarget(p) && !inState(p) && DEST.has(path.basename(p));
const sync = () => { try { module.syncBuiltinESMExports(); } catch { /* ignore */ } };
const isApply = cmd === 'install' && has('--apply');
`;

const BODY = {
  M1: `if (cmd === 'install' && !has('--apply') && !has('--explain') && TARGET) process.on('exit', () => { try { fs.writeFileSync(path.join(TARGET, '.dry-write'), 'x'); fired('wrote'); } catch { /* ignore */ } });`,
  M2: `if (cmd === 'undo-door' && TARGET) {
  let done = false;
  for (const nm of ['renameSync', 'writeFileSync', 'unlinkSync', 'rmSync', 'copyFileSync']) {
    const o = fs[nm];
    fs[nm] = function (...a) {
      const dest = nm === 'renameSync' || nm === 'copyFileSync' ? a[1] : a[0];
      if (!done && isDest(String(dest))) { done = true; fired(nm + ' ' + dest); return undefined; }
      return o.apply(this, a);
    };
  }
  sync();
}`,
  M3: `if (isApply && TARGET) process.on('exit', () => { try { fs.writeFileSync(path.join(TARGET, 'undeclared-file.txt'), 'x'); fired('wrote'); } catch { /* ignore */ } });`,
  M4: `if (isApply && TARGET) {
  const files = ['AGENTS.md', 'CLAUDE.md'].map((f) => path.join(TARGET, f));
  const had = files.find((f) => { try { return fs.readFileSync(f, 'utf8').includes('<!-- pharos:begin agents-md'); } catch { return false; } });
  if (had) process.on('exit', () => { try { const t = fs.readFileSync(had, 'utf8'); const m = /<!-- pharos:begin agents-md[\\s\\S]*?<!-- pharos:end agents-md -->\\n?/.exec(t); if (m) { fs.writeFileSync(had, t + '\\n' + m[0]); fired('appended'); } } catch { /* ignore */ } });
}`,
  M5: `if (TARGET) {
  const lie = (p) => (typeof p === 'string' && (path.resolve(p) === TARGET || path.resolve(p).startsWith(TARGET + path.sep)));
  const rp = fs.realpathSync; const rpn = rp.native;
  const nr = (p, ...r) => { if (lie(String(p))) { fired('realpath ' + p); return path.resolve(String(p)); } return rp.call(fs, p, ...r); };
  fs.realpathSync = Object.assign(nr, { native: (p, ...r) => (lie(String(p)) ? path.resolve(String(p)) : rpn.call(fs, p, ...r)) });
  const ls = fs.lstatSync;
  fs.lstatSync = function (p, o) { if (lie(String(p))) { try { const s = fs.statSync(p, o); fired('lstat ' + p); return s; } catch { /* fall through */ } } return ls.call(fs, p, o); };
  sync();
}`,
  M6: `if (isApply) process.on('exit', () => { try { cp.spawnSync('curl', ['-fsS', 'https://example.invalid/undeclared'], { stdio: 'ignore' }); fired('curl'); } catch { /* ignore */ } });`,
  M7: `if (isApply && argv.includes('reader-stack') && !has('--with-launchctl')) process.on('exit', () => { try { cp.spawnSync('launchctl', ['setenv', 'OLLAMA_KEEP_ALIVE', '24h'], { stdio: 'ignore' }); fired('launchctl'); } catch { /* ignore */ } });`,
  Q1: `if (TARGET) {
  const o = fs.renameSync;
  fs.renameSync = function (src, dst, ...r) {
    if (isDest(String(dst))) {
      const data = fs.readFileSync(src); const half = Math.ceil(data.length / 2);
      const fd = fs.openSync(dst, 'w'); fs.writeSync(fd, data.subarray(0, half)); fs.writeSync(fd, data.subarray(half)); fs.closeSync(fd);
      try { fs.unlinkSync(src); } catch { /* ignore */ }
      fired('in-place ' + dst); return undefined;
    }
    return o.call(this, src, dst, ...r);
  };
  sync();
}`,
  Q2: `if (cmd === 'undo-door') {
  process.on('exit', () => { if (process.exitCode === 1) { process.exitCode = 0; fired('1->0'); } });
}`,
  Q3: `if (cmd === 'undo-door' && STATE) process.on('exit', () => { for (const d of ['backups', 'runs']) { try { if (fs.existsSync(path.join(STATE, d))) { fs.rmSync(path.join(STATE, d), { recursive: true, force: true }); fired('rm ' + d); } } catch { /* ignore */ } } });`,
  Q4: `{
  const ch = crypto.createHash;
  crypto.createHash = function (alg, ...r) {
    const h = ch.call(crypto, alg, ...r);
    if (alg !== 'sha256') return h;
    const chunks = [];
    const proxy = {
      update(d, enc) { chunks.push(typeof d === 'string' ? d : Buffer.from(d).toString('latin1')); h.update(d, enc); return proxy; },
      digest(enc) { const real = h.digest(enc); const s = chunks.join(''); if (s.includes('"prev"') && s.includes('"seq"')) { fired('const'); return enc === 'hex' ? '0'.repeat(64) : enc ? '0'.repeat(64) : Buffer.alloc(32); } return real; },
    };
    return proxy;
  };
  sync();
}`,
  Q5: `if (TARGET) {
  const realLstat = fs.lstatSync; const realRp = fs.realpathSync;
  fs.lstatSync = function (p, o) { const s = realLstat.call(fs, p, o); if (s && isDest(String(p)) && s.isSymbolicLink && s.isSymbolicLink()) { s.isSymbolicLink = () => false; fired('lstat-lie ' + p); } return s; };
  const nr = (p, ...r) => (isDest(String(p)) ? path.resolve(String(p)) : realRp.call(fs, p, ...r));
  fs.realpathSync = Object.assign(nr, { native: (p, ...r) => (isDest(String(p)) ? path.resolve(String(p)) : realRp.native.call(fs, p, ...r)) });
  const o = fs.renameSync;
  fs.renameSync = function (src, dst, ...r) {
    try { if (isDest(String(dst)) && realLstat.call(fs, dst).isSymbolicLink()) { fs.writeFileSync(dst, fs.readFileSync(src)); try { fs.unlinkSync(src); } catch { /* ignore */ } fired('through-symlink ' + dst); return undefined; } } catch { /* not a link */ }
    return o.call(this, src, dst, ...r);
  };
  const oo = fs.openSync;
  fs.openSync = function (p, flags, ...r) { if (typeof flags === 'number' && (flags & fs.constants.O_NOFOLLOW)) { fired('strip-nofollow'); flags &= ~fs.constants.O_NOFOLLOW; } return oo.call(this, p, flags, ...r); };
  sync();
}`,
  Q6: `{
  const ui = os.userInfo;
  os.userInfo = (...a) => { fired('userInfo'); return { ...ui.apply(os, a), homedir: '/nonexistent-home-for-mutant-q6' }; };
  sync();
}`,
  Q7: `{
  const isLock = (p) => typeof p === 'string' && /[\\\\/]lock$/.test(p);
  const oo = fs.openSync;
  fs.openSync = function (p, flags, ...r) {
    if (isLock(String(p))) {
      if (typeof flags === 'string' && flags.includes('x')) { fired('wx->w'); flags = flags.replace('x', ''); }
      else if (typeof flags === 'number' && (flags & fs.constants.O_EXCL)) { fired('strip-excl'); flags &= ~fs.constants.O_EXCL; }
    }
    return oo.call(this, p, flags, ...r);
  };
  const wf = fs.writeFileSync;
  fs.writeFileSync = function (p, d, o) { if (isLock(String(p)) && o && (o.flag === 'wx' || o.flag === 'ax')) { fired('wf wx'); o = { ...o, flag: 'w' }; } return wf.call(this, p, d, o); };
  const mk = fs.mkdirSync;
  fs.mkdirSync = function (p, ...r) { try { return mk.call(this, p, ...r); } catch (e) { if (e && e.code === 'EEXIST' && isLock(String(p))) { fired('mkdir-eexist'); return undefined; } throw e; } };
  sync();
}`,
};

const SOURCE_EDITS = {
  M8: { file: 'tools/public-scan.mjs', from: "else if (e.isFile() || e.isSymbolicLink()) out.push(path.posix.join(rel, e.name));", to: "else if ((e.isFile() || e.isSymbolicLink()) && !e.name.startsWith('.')) out.push(path.posix.join(rel, e.name));" },
  M9: { file: 'tools/public-scan.mjs', from: "const TLDS = ", to: "SECRET_PATTERNS.length = 3;\nconst TLDS = " },
};

const SKIPNAMES = new Set(['.git', 'node_modules', '.pharos']);
// a top-level log/ folder is runtime output of something else (found 2026-11-12 holding fold logs with home-directory paths), not part of the tree under test
const skipCopy = (s) => !SKIPNAMES.has(path.basename(s)) && s !== path.join(SRC, 'log');
export function makeMutant(id) {
  if (!DESCR[id]) throw new Error(`unknown mutant ${id}`);
  const dir = path.join(MUT_BASE, id); const root = path.join(dir, 'pharos');
  if (!path.resolve(root).startsWith(MUT_BASE + path.sep)) throw new Error('refusing: outside the mutants folder');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(SRC, root, { recursive: true, filter: skipCopy });
  const meta = { id, description: DESCR[id], kind: SOURCE_EDITS[id] ? 'source edit' : 'behavioural preload', root };
  if (SOURCE_EDITS[id]) {
    const e = SOURCE_EDITS[id]; const f = path.join(root, e.file); const t = fs.readFileSync(f, 'utf8');
    if (!t.includes(e.from)) throw new Error(`${id}: anchor not found in ${e.file}`);
    fs.writeFileSync(f, t.replace(e.from, e.to));
  } else {
    const bin = path.join(root, 'bin', 'pharos.mjs'); const orig = path.join(root, 'bin', 'pharos.orig.mjs');
    fs.renameSync(bin, orig);
    fs.writeFileSync(bin, `#!/usr/bin/env node\nimport './_mutant.mjs';\nawait import('./pharos.orig.mjs');\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(root, 'bin', '_mutant.mjs'), PRE(id) + BODY[id] + '\n');
  }
  fs.writeFileSync(path.join(dir, 'MUTANT.json'), JSON.stringify(meta, null, 1));
  return meta;
}
export function makeClean() {
  const dir = path.join(MUT_BASE, 'CLEAN'); const root = path.join(dir, 'pharos');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(SRC, root, { recursive: true, filter: skipCopy });
  return { id: 'CLEAN', root };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : IDS;
  for (const id of ids) { const m = id === 'CLEAN' ? makeClean() : makeMutant(id); console.log(`${m.id}: ${m.kind || 'clean copy'}${m.description ? ' - ' + m.description : ''}\n   ${m.root}`); }
}
