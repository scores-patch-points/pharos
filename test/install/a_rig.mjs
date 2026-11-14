// Test author A: sandbox rig. Fresh HOME + target per run, recording fail-closed PATH shims,
// dead-port listeners, macOS sandbox-exec guard, tree hashing with modes and symlinks.
// Nothing here executes a real brew/curl/launchctl/ollama/npm/opencode/sudo/docker.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SHIMMED } from './a_shimlib.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
// A1: the tree under test comes from env PHAROS_ROOT (mutant copies); sandbox and baseline always live beside the REAL tree.
export const PHAROS_DIR = process.env.PHAROS_ROOT ? path.resolve(process.env.PHAROS_ROOT) : path.resolve(HERE, '..', '..');
const SANDBOX_BASE = path.resolve(HERE, '..', '..', '..', 'ledgers', 'pharos-public', 'sandbox');
export const SANDBOX_ROOT = SANDBOX_BASE;
export const DEFAULT_BIN = path.join(PHAROS_DIR, 'bin', 'pharos.mjs');
export const DEFAULT_DOORS = path.join(PHAROS_DIR, 'doors');
export const BASELINE_DIR = path.join(SANDBOX_BASE, 'baseline', 'pharos-pre');
export const REAL_HOME = os.userInfo().homedir;
export const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const GUARD_AVAILABLE = process.platform === 'darwin' && fs.existsSync('/usr/bin/sandbox-exec') && !process.env.A_NO_GUARD;

// ---------------------------------------------------------------- tree hashing
export function hashTree(root) {
  const out = new Map();
  const walk = (abs, rel) => {
    let st;
    try { st = fs.lstatSync(abs); } catch { return; }
    const mode = (st.mode & 0o7777).toString(8);
    if (st.isSymbolicLink()) out.set(rel || '.', `L ${mode} -> ${fs.readlinkSync(abs)}`);
    else if (st.isDirectory()) {
      out.set(rel || '.', `D ${mode}`);
      for (const n of fs.readdirSync(abs).sort()) walk(path.join(abs, n), rel ? `${rel}/${n}` : n);
    } else if (st.isFile()) out.set(rel, `F ${mode} ${st.size} ${sha256(fs.readFileSync(abs))}`);
    else out.set(rel, `O ${mode} ${st.mode.toString(8)}`);
  };
  walk(root, '');
  return out;
}

export function diffTrees(a, b) {
  const d = [];
  for (const [k, v] of a) {
    if (!b.has(k)) { d.push({ path: k, kind: 'removed', before: v }); continue; }
    const w = b.get(k);
    if (v === w) continue;
    const [t1, m1, ...r1] = v.split(' ');
    const [t2, m2, ...r2] = w.split(' ');
    let kind;
    if (t1 !== t2) kind = 'type';
    else if (t1 === 'L') kind = 'link';
    else if (t1 === 'F' && r1.slice(1).join() !== r2.slice(1).join()) kind = 'content';
    else if (t1 === 'F' && r1[0] !== r2[0]) kind = 'content';
    else if (m1 !== m2) kind = 'mode';
    else kind = 'content';
    d.push({ path: k, kind, before: v, after: w });
  }
  for (const [k, w] of b) if (!a.has(k)) d.push({ path: k, kind: 'added', after: w });
  return d.sort((x, y) => x.path.localeCompare(y.path));
}

export const fmtDiff = (d, n = 10) =>
  d.slice(0, n).map((x) => `${x.kind} ${x.path}${x.before ? ` [${x.before.slice(0, 40)}]` : ''}${x.after ? ` -> [${x.after.slice(0, 40)}]` : ''}`).join('; ') + (d.length > n ? `; (+${d.length - n} more)` : '');

// Partition a jail-relative tree diff by top-level region.
export function region(rel) {
  const top = rel.split('/')[0];
  return ['home', 'target', 'tmp', 'cwd', 'state'].includes(top) ? top : 'other';
}
export const onlyRegions = (d, regs) => d.filter((x) => regs.includes(region(x.path)));

// ---------------------------------------------------------------- declared touches
export function listDoorIds(doorsDir = DEFAULT_DOORS) {
  if (!fs.existsSync(doorsDir)) return [];
  const ids = fs.readdirSync(doorsDir).filter((n) => fs.existsSync(path.join(doorsDir, n, 'door.json'))).sort();
  const first = ['pharos-core', 'agents-md'];
  return [...first.filter((x) => ids.includes(x)), ...ids.filter((x) => !first.includes(x))];
}
export function loadManifest(id, doorsDir = DEFAULT_DOORS) {
  return JSON.parse(fs.readFileSync(path.join(doorsDir, id, 'door.json'), 'utf8'));
}
export const manifestUsesKhoraDir = (m) => JSON.stringify(m.touches || {}).includes('$KHORA_DIR');

const segRe = (s) => new RegExp('^' + s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
function matchSegs(P, i, A, j) {
  if (i === P.length) return j === A.length;
  if (P[i] === '**') { for (let k = j; k <= A.length; k++) if (matchSegs(P, i + 1, A, k)) return true; return false; }
  if (j === A.length) return false;
  return segRe(P[i]).test(A[j]) && matchSegs(P, i + 1, A, j + 1);
}
function ancestorOf(P, A) {
  if (A.length >= P.length && !P.includes('**')) return false;
  for (let i = 0; i < A.length; i++) {
    if (i >= P.length) return false;
    if (P[i] === '**') return true;
    if (!segRe(P[i]).test(A[i])) return false;
  }
  return true;
}
export function covers(patterns, abs, isDir) {
  const A = abs.split('/').filter(Boolean);
  return patterns.some((pat) => {
    const P = pat.split('/').filter(Boolean);
    return matchSegs(P, 0, A, 0) || (isDir && ancestorOf(P, A));
  });
}
// Expand manifest tokens against a run. $STATE expands to every candidate location.
export function declaredPatterns(manifest, run) {
  const states = run.stateMode === 'external' ? [run.stateDir] : [path.join(run.target, '.pharos'), path.join(run.home, '.pharos')];
  const expand = (p) => {
    const base = p.replace('$HOME', run.home).replace('$TARGET', run.target).replace('$KHORA_DIR', run.khoraDir);
    return p.includes('$STATE') ? states.map((s) => base.replace('$STATE', s)) : [base];
  };
  const t = manifest.touches || {};
  return [...(t.files || []).flatMap(expand), ...(t.configs || []).flatMap((c) => expand(c.path))];
}
export const declaredTools = (m) => new Set(m.touches?.tools || []);
export const probeTools = (m) => new Set([...(m.touches?.tools || []), ...(m.requires?.tools || [])]);
export const declaredEnv = (m) => new Set(m.touches?.env || []);

// ---------------------------------------------------------------- real-home witness (read only)
export function realHomeWitness() {
  const paths = ['.pharos', 'khora', '.config/opencode/opencode.json', 'Library/LaunchAgents'];
  const w = {};
  for (const p of paths) {
    try {
      const st = fs.lstatSync(path.join(REAL_HOME, p));
      w[p] = st.isDirectory() ? `dir ${fs.readdirSync(path.join(REAL_HOME, p)).sort().join(',')}` : `${st.size}:${st.mtimeMs}`;
    } catch { w[p] = 'absent'; }
  }
  return w;
}

// ---------------------------------------------------------------- listeners
// Which process opened a connection to one of our listeners? Looked up with lsof at accept time (the socket is
// held open until then) and attributed to the child run if the client's ancestry reaches the child's pid.
function attribute(rport, childPid) {
  if (!childPid) return 'foreign';
  let pids = [];
  try {
    const out = execFileSync('/usr/sbin/lsof', ['-nP', '-a', `-iTCP:${rport}`, '-F', 'p'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 });
    pids = out.split('\n').filter((l) => l.startsWith('p')).map((l) => Number(l.slice(1))).filter((x) => x && x !== process.pid);
  } catch { /* lsof exits 1 when nothing matches */ }
  if (!pids.length) return 'unknown';
  for (let pid of pids) {
    for (let depth = 0; depth < 14 && pid > 1; depth++) {
      if (pid === childPid) return 'child';
      try { pid = Number(execFileSync('/bin/ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch { break; }
    }
  }
  return 'foreign';
}

async function startListeners() {
  const conns = [];
  const servers = [];
  const L = { conns, currentChild: null };
  const bind = (port, isMain) => new Promise((resolve) => {
    const s = net.createServer((sock) => {
      sock.on('error', () => {});
      const lport = s.address().port;
      const who = isMain ? 'child' : attribute(sock.remotePort, L.currentChild);
      conns.push({ port: lport, t: Date.now(), who, main: isMain });
      sock.destroy();
    });
    s.once('error', (e) => resolve({ ok: false, port, err: e.code }));
    s.listen(port, '127.0.0.1', () => { s.unref(); servers.push(s); resolve({ ok: true, port: s.address().port }); });
  });
  const main = await bind(0, true);
  const extras = [];
  for (const p of [11434, 11436, 11438, 4096]) extras.push(await bind(p, false));
  // A1: the rig picks a free port itself when every well-known port is busy, so the attribution test never depends on the machine
  if (!extras.some((e) => e.ok)) extras.push(await bind(0, false));
  Object.assign(L, { main: main.port, extras, close: () => Promise.all(servers.map((s) => new Promise((r) => s.close(r)))) });
  return L;
}

// ---------------------------------------------------------------- fixtures
function put(file, content, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (mode != null) fs.chmodSync(file, mode);
}
export function buildHome(home) {
  put(path.join(home, '.zshrc'), '# my zshrc\nexport FOO=1');                      // no trailing newline on purpose
  put(path.join(home, '.config/opencode/opencode.json'), '{\n  "$schema": "https://opencode.ai/config.json",\n  "model": "x/y"\n}\n');
  put(path.join(home, 'bin/tool'), '#!/bin/sh\necho tool\n', 0o755);
  put(path.join(home, '.hidden/résumé.txt'), 'unicode name\n');
  fs.symlinkSync('.zshrc', path.join(home, 'link-to-zshrc'));
  fs.mkdirSync(path.join(home, '.empty'), { mode: 0o700 });
  fs.chmodSync(path.join(home, '.empty'), 0o700);
}
export function buildTarget(t, kind) {
  fs.mkdirSync(t, { recursive: true });
  if (kind === 'bare') return;
  put(path.join(t, '.git/HEAD'), 'ref: refs/heads/main\n');
  put(path.join(t, 'README.md'), '# project\n');
  put(path.join(t, 'src/run.sh'), '#!/bin/sh\necho run\n', 0o755);
  put(path.join(t, 'src/data.bin'), crypto.createHash('sha512').update('seed').digest());
  fs.symlinkSync('README.md', path.join(t, 'readme-link'));
  fs.mkdirSync(path.join(t, 'docs'));
  put(path.join(t, '.gitignore'), 'node_modules\n');
  if (kind === 'populated') put(path.join(t, 'AGENTS.md'), '# Agents\n\nExisting rules.\n');
  if (kind === 'agents-nonl') put(path.join(t, 'AGENTS.md'), '# Agents\n\nNo trailing newline');
  if (kind === 'agents-crlf') put(path.join(t, 'AGENTS.md'), '# Agents\r\n\r\nWindows line endings\r\n');
  if (kind === 'claude-only') put(path.join(t, 'CLAUDE.md'), '# Claude\n\nrules\n');
}
export const FIXTURES = ['bare', 'populated', 'agents-nonl', 'agents-crlf', 'claude-only'];

// ---------------------------------------------------------------- run
let counter = 0;
export async function makeRun(opts = {}) {
  const { label = 'run', fixture = 'populated', bin = DEFAULT_BIN, doorsDir = DEFAULT_DOORS, stateMode = 'external', guard = GUARD_AVAILABLE, nodeArgs = [], env: extraEnv = {} } = opts;
  fs.mkdirSync(SANDBOX_BASE, { recursive: true });
  const id = `a-${label.replace(/[^a-z0-9-]/gi, '_')}-${process.pid}-${++counter}-${Date.now().toString(36)}`;
  const dir = path.join(SANDBOX_BASE, id);
  if (!path.resolve(dir).startsWith(SANDBOX_BASE + path.sep)) throw new Error('refusing: run dir outside sandbox base');
  fs.mkdirSync(dir);
  const real = fs.realpathSync(dir);
  const jail = path.join(real, 'jail');
  const run = {
    id, dir: real, jail, fixture, bin, doorsDir, stateMode, guard,
    home: path.join(jail, 'home'), target: path.join(jail, 'target'), tmp: path.join(jail, 'tmp'), cwd: path.join(jail, 'cwd'),
    stateDir: path.join(jail, 'state'), khoraDir: path.join(jail, 'home', 'khora'),
    outside: path.join(real, 'outside'), shimDir: path.join(real, 'shims'), realBin: path.join(real, 'realbin'), shimState: path.join(real, 'shimstate'),
    opencodeCfg: path.join(jail, 'home', '.config', 'opencode', 'opencode.json'),
  };
  run.shimLog = path.join(run.shimState, 'calls.jsonl');
  for (const d of [run.home, run.tmp, run.cwd, run.outside, run.shimDir, run.realBin, run.shimState]) fs.mkdirSync(d, { recursive: true });
  buildHome(run.home);
  buildTarget(run.target, fixture);
  put(path.join(run.outside, 'canary.txt'), 'outside canary\n');
  put(path.join(run.outside, 'AGENTS.md'), 'outside agents\n');
  fs.writeFileSync(run.shimLog, '');
  fs.writeFileSync(path.join(run.shimState, 'launchctl.json'), '{}');
  fs.symlinkSync(process.execPath, path.join(run.realBin, 'node'));
  const shimJs = path.join(HERE, 'a_shim.mjs');
  for (const t of SHIMMED) {
    const f = path.join(run.shimDir, t);
    fs.writeFileSync(f, `#!/bin/sh\nexec '${process.execPath}' '${shimJs}' '${t}' "$@"\n`, { mode: 0o755 });
  }
  const L = await startListeners();
  run.listeners = L;
  const proxy = `http://127.0.0.1:${L.main}`;
  run.baseEnv = {
    HOME: run.home, TMPDIR: run.tmp, TERM: 'dumb', LANG: 'en_US.UTF-8', USER: 'sandbox', NO_COLOR: '1',
    PATH: [run.shimDir, run.realBin, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
    PHAROS_ROOT_ALLOW: jail, A_SHIM_LOG: run.shimLog, A_SHIM_STATE: run.shimState,
    HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy, http_proxy: proxy, https_proxy: proxy, all_proxy: proxy,
    OLLAMA_HOST: `127.0.0.1:${L.main}`,
    ...extraEnv,
  };
  const allowPorts = [L.main, ...L.extras.filter((e) => e.ok).map((e) => e.port)];
  run.profile = [
    '(version 1)', '(allow default)', '(deny network*)',
    ...allowPorts.map((p) => `(allow network-outbound (remote ip "*:${p}"))`),
    `(deny file-write* (require-not (require-any (subpath "${real}") (subpath "/dev"))))`,
  ].join('');

  run.stateArgs = () => (stateMode === 'external' ? ['--state', run.stateDir] : []);
  run.snapshot = () => ({ jail: hashTree(run.jail), outside: hashTree(run.outside), launchctl: launchctlDb(run), witness: realHomeWitness() });
  run.calls = () => fs.readFileSync(run.shimLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  run.setLaunchctl = (db) => fs.writeFileSync(path.join(run.shimState, 'launchctl.json'), JSON.stringify(db));
  run.close = () => run.listeners.close();

  // Run `node <argv...>` in the sandbox. Returns exit info plus the shim calls and connections it caused.
  run.node = async (argv, o = {}) => {
    const c0 = run.calls().length;
    const n0 = L.conns.length;
    const env = { ...run.baseEnv, ...(o.env || {}) };
    const cmd = guard ? '/usr/bin/sandbox-exec' : process.execPath;
    const args = guard ? ['-p', run.profile, process.execPath, ...nodeArgs, ...argv] : [...nodeArgs, ...argv];
    const res = await new Promise((resolve) => {
      const p = spawn(cmd, args, { cwd: o.cwd || run.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      L.currentChild = p.pid;
      let stdout = ''; let stderr = ''; let timedOut = false;
      p.stdout.on('data', (d) => { stdout += d; });
      p.stderr.on('data', (d) => { stderr += d; });
      const timer = setTimeout(() => { timedOut = true; p.kill('SIGKILL'); }, o.timeoutMs ?? 60000);
      p.on('close', (code, signal) => { clearTimeout(timer); L.currentChild = null; resolve({ code, signal, stdout, stderr, timedOut }); });
      p.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, signal: null, stdout, stderr: String(e), timedOut }); });
    });
    await new Promise((r) => setTimeout(r, 40));
    const out = res.stdout + res.stderr;
    return {
      ...res, out, args: argv,
      calls: run.calls().slice(c0),
      connections: L.conns.slice(n0).filter((c) => c.who !== 'foreign'),
      foreignConnections: L.conns.slice(n0).filter((c) => c.who === 'foreign'),
      denied: /EPERM|Operation not permitted/.test(out),
    };
  };
  run.exec = (args, o) => run.node([run.bin, ...args], o);
  run.baseArgs = (door, manifest) => ['--target', run.target, ...run.stateArgs(), ...(manifest && manifestUsesKhoraDir(manifest) ? ['--khora-dir', run.khoraDir] : [])];
  return run;
}

export const launchctlDb = (run) => { try { return JSON.parse(fs.readFileSync(path.join(run.shimState, 'launchctl.json'), 'utf8')); } catch { return null; } };

// Flag spellings that need companion values (DESIGN section 2.1).
export function flagArgs(run, flag) {
  if (flag === '--with-opencode') return [flag, '--opencode-config', run.opencodeCfg];
  if (flag === '--with-claude-plugin') return [flag, '--plugin-source', `owner/repo@${'0'.repeat(40)}`];
  return [flag];
}
export const manifestFlags = (m) => [...new Set((m.steps || []).map((s) => s.flag).filter(Boolean))];

// ---------------------------------------------------------------- generic helpers used by checks
export const mutatingCalls = (calls) => calls.filter((c) => c.cls === 'mutating' && c.note !== 'emulated');
export const emulatedCalls = (calls) => calls.filter((c) => c.note === 'emulated' && c.cls === 'mutating');
// Every call that changes (or tries to change) state: blocked mutating calls plus emulated launchctl set/unset.
export const stateChangingCalls = (calls) => calls.filter((c) => c.cls === 'mutating');

// Mask lines that differ between two runs of the same deterministic command (timestamps, ids).
export function volatileMask(a, b) {
  const la = a.split('\n'); const lb = b.split('\n');
  const n = Math.max(la.length, lb.length);
  const mask = new Set();
  for (let i = 0; i < n; i++) if (la[i] !== lb[i]) mask.add(i);
  return mask;
}
export const applyMask = (text, mask) => text.split('\n').map((l, i) => (mask.has(i) ? '<V>' : l)).join('\n');
export const normPaths = (text, run) => text.split(run.dir).join('<RUN>');
