// Path and symlink guard. Every refusal is a Refused (exit 3); bad usage is a Usage (exit 2).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class Refused extends Error { constructor(m) { super(m); this.code = 'REFUSED'; this.exit = 3; } }
export class Usage extends Error { constructor(m) { super(m); this.code = 'USAGE'; this.exit = 2; } }

export const hasDotDot = (p) => String(p).split(/[\\/]+/).includes('..');

export function checkPathArg(p, label) {
  if (typeof p !== 'string' || p === '' || p.includes('\0')) throw new Usage(`${label} needs a path`);
  if (hasDotDot(p)) throw new Refused(`${label} contains a '..' segment: ${p}`);
  return p;
}

// Credential and cloud-config folders in the real home: never a target, a state dir or a write, whatever the flags say.
// (They are dot-folders, so the dot-folder rule below already covers them; the list is kept for callers and messages.)
export const SECRET_DIRS = ['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.azure'];
// System places a target must never be (their real paths on macOS are under /private).
const SYSTEM_DIRS = ['/etc', '/usr', '/bin', '/sbin', '/System', '/Library', '/Applications', '/private/etc', '/Volumes'];
// The one dot-folder of the real home this installer may use: its own state.
const OWN_DOT = '.pharos';

// Comparisons that decide a REFUSAL fold case and Unicode form: the default macOS filesystem treats
// ~/.SSH and ~/.ssh as one folder, so the guard must too. Folding only ever refuses more.
export const fold = (p) => String(p).normalize('NFC').toLowerCase();
export const within = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
export const withinFold = (child, parent) => within(fold(child), fold(parent));

// realpath(3): resolves links and, on a case-insensitive filesystem, returns the spelling stored on disk.
const native = (p) => (fs.realpathSync.native || fs.realpathSync)(p);
function realOrSelf(p) { try { return native(p); } catch { return p; } }

// The home of the real account, read from the password database, never from $HOME
// (a sandbox sets HOME to somewhere else).
export function realHome() {
  let h; try { h = os.userInfo().homedir; } catch { h = os.homedir(); }
  return realOrSelf(h);
}

export function isRealHome(home) { return fold(realOrSelf(path.resolve(home))) === fold(realHome()); }

// Extra protected places, supplied at run time and never written in this tree: env PHAROS_PROTECT
// (entries separated like PATH) and the untracked file .git/info/pharos-protect of this checkout (one per line,
// # comments). An entry with a slash is a path (it and everything under it); one without is a folder name
// refused wherever it appears in a path.
function extraProtected() {
  const out = (process.env.PHAROS_PROTECT || '').split(path.delimiter);
  try { out.push(...fs.readFileSync(new URL('../.git/info/pharos-protect', import.meta.url), 'utf8').split('\n').map((l) => l.replace(/#.*/, ''))); } catch { /* none */ }
  return out.map((x) => x.trim()).filter(Boolean);
}

// Places no run of this installer may write to or aim at, whatever the flags say.
export function forbidden(abs) {
  const rh = realHome();
  const extra = extraProtected();
  for (const cand of new Set([path.resolve(abs), realpathDeep(abs)])) {
    if (cand === path.sep) return '/';
    for (const sd of SYSTEM_DIRS) if (withinFold(cand, sd)) return sd;
    if (withinFold(cand, rh)) {
      const first = fold(cand).slice(fold(rh).length).split(path.sep).filter(Boolean)[0];
      if (first && first.startsWith('.') && first !== OWN_DOT) return `~/${first} (a dot-folder of the real home)`;
      if (first === 'library') return '~/Library';
    }
    const segs = fold(cand).split(path.sep);
    for (const e of extra) {
      if (e.includes(path.sep)) { if (withinFold(cand, path.resolve(e)) || withinFold(cand, realOrSelf(path.resolve(e)))) return 'a place protected by local configuration'; }
      else if (segs.includes(fold(e))) return 'a folder name protected by local configuration';
    }
  }
  return null;
}

// Walk down from the root. A symlink below the system level whose real target leaves its own
// directory is an escape. (The first two components may be OS aliases such as /tmp and /var.)
export function escapingSymlink(abs) {
  const parts = path.resolve(abs).split(path.sep).filter(Boolean);
  let cur = path.sep;
  for (let i = 0; i < parts.length; i++) {
    const next = path.join(cur, parts[i]);
    let st;
    try { st = fs.lstatSync(next); } catch { return null; }
    if (st.isSymbolicLink()) {
      let real;
      try { real = fs.realpathSync(next); } catch { return { link: next, real: '(dangling)' }; }
      if (i >= 2 && !within(real, realOrSelf(cur))) return { link: next, real };
      cur = real;
    } else cur = next;
  }
  return null;
}

export function realpathDeep(abs) {
  let p = path.resolve(abs); const rest = [];
  for (;;) {
    try { return path.join(native(p), ...rest.reverse()); } catch { /* climb */ }
    const up = path.dirname(p);
    if (up === p) return path.join(p, ...rest.reverse());
    rest.push(path.basename(p)); p = up;
  }
}

export function allowRoots() {
  return (process.env.PHAROS_ROOT_ALLOW || '').split(path.delimiter).filter(Boolean).map((r) => realOrSelf(path.resolve(r)));
}

// Returns the target as the filesystem spells it when the given spelling differs only in case or Unicode form
// (so a journal written under one spelling is found under the other); otherwise the resolved path as given.
export function checkTarget(target, home, { noLink = false } = {}) {
  checkPathArg(target, '--target');
  const abs = path.resolve(target);
  if (abs === path.sep) throw new Refused('target is the filesystem root');
  if (home && fold(abs) === fold(path.resolve(home))) throw new Refused('target is the HOME directory itself');
  if (isRealHome(abs)) throw new Refused('target is the real home directory itself; name a project folder inside it');
  if (withinFold(realHome(), abs) || withinFold(realHome(), realOrSelf(abs))) throw new Refused('target contains the real home directory; name a project folder inside it');
  const esc = escapingSymlink(abs);
  if (esc) throw new Refused(`target path passes through a symlink that leaves its directory: ${esc.link} -> ${esc.real}`);
  const st = fs.lstatSync(abs, { throwIfNoEntry: false });
  if (noLink && st && st.isSymbolicLink()) throw new Refused(`target is a symlink: ${abs}`);
  const f = forbidden(abs); if (f) throw new Refused(`target is inside a protected place (${f})`);
  const roots = allowRoots();
  if (roots.length && !roots.some((r) => within(realpathDeep(abs), r))) throw new Refused('target is outside PHAROS_ROOT_ALLOW');
  const real = realOrSelf(abs);
  return real !== abs && fold(real) === fold(abs) ? real : abs;
}

// Checked on every write, not once: the path as it is now, not as it was at plan time.
export function checkWritePath(abs, rootDir) {
  const f = forbidden(abs); if (f) throw new Refused(`refusing to write inside a protected place (${f}): ${abs}`);
  const esc = escapingSymlink(path.dirname(abs));
  if (esc) throw new Refused(`refusing to write through a symlink that leaves its directory: ${esc.link} -> ${esc.real}`);
  const st = fs.lstatSync(abs, { throwIfNoEntry: false });
  if (st && st.isSymbolicLink()) throw new Refused(`refusing to write to a symlink: ${abs}`);
  const root = realpathDeep(path.resolve(abs) === path.resolve(rootDir) ? path.dirname(rootDir) : rootDir);
  if (!within(realpathDeep(path.dirname(abs)), root)) throw new Refused(`write would land outside ${rootDir}: ${abs}`);
  if (st && !st.isFile() && !st.isDirectory()) throw new Refused(`not a regular file: ${abs}`);
}
