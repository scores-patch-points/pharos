// Test author B: shared helpers for I6, I7, I8. Black box: nothing here reads install/, doors/ code or the shipped scanner.
// Literal sensitive strings are assembled from fragments so this file itself does not trip a public-readiness scan.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = process.env.PHAROS_ROOT ? path.resolve(process.env.PHAROS_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SCRATCH = process.env.PHAROS_SCRATCH || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'ledgers', 'pharos-public', 'scratch');
export const KHORA_REPO = 'scores-patch-points/khora';
export const KHORA_URL = `${'https:' + '//' + 'github' + '.com'}/${KHORA_REPO}.git`;
export const EXPECTED_EXTRACTED = [
  'install.sh', 'setup-proxy.sh', 'local-up.sh',
  'integrations/claude-code.sh', 'integrations/curl.sh', 'integrations/ollama.sh',
  'claude-code/scripts/run.sh',
];

export const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const J = (...a) => a.join('');

export function mkScratch(tag) {
  fs.mkdirSync(SCRATCH, { recursive: true });
  return fs.mkdtempSync(path.join(SCRATCH, `b-${tag}-`));
}

// ---------- tree walking ----------
const SKIP_DIRS = new Set(['.git', 'node_modules', '.pharos']);
export function walk(dir, rel = '', out = []) {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(dir, r, out); }
    else if (e.isFile()) out.push(r);
    else if (e.isSymbolicLink()) out.push(r); // read through lstat below
  }
  return out;
}
export function copyTree(src, dst) {
  fs.cpSync(src, dst, {
    recursive: true,
    filter: (s) => !SKIP_DIRS.has(path.basename(s)),
  });
}

// ---------- the oracle scanner (independent of tools/public-scan.mjs) ----------
const R = (s, f = '') => new RegExp(s, f);
export const SECRET_RULES = [
  ['secret-private-key', R(J('-----BEGIN ', '[A-Z ]*', 'PRIVATE KEY', '-----'))],
  ['secret-github-token', R(J('\\b(?:gh[pousr]', '_[A-Za-z0-9]{30,})'))],
  ['secret-github-pat', R(J('\\bgithub_', 'pat_[A-Za-z0-9_]{20,}'))],
  ['secret-sk-key', R(J('\\bs', 'k-[A-Za-z0-9_-]{20,}'))],
  ['secret-aws-key', R(J('\\b(?:AK', 'IA|AS', 'IA)[0-9A-Z]{16}\\b'))],
  ['secret-slack', R(J('\\bxo', 'x[abprs]-[A-Za-z0-9-]{10,}'))],
  ['secret-google', R(J('\\bAI', 'za[0-9A-Za-z_-]{35}'))],
  ['secret-jwt', R(J('\\bey', 'J[A-Za-z0-9_-]{10,}\\.ey', 'J[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}'))],
  ['secret-hf', R(J('\\bh', 'f_[A-Za-z0-9]{30,}'))],
  ['secret-stripe', R(J('\\b[sr]', 'k_(?:live|test)_[A-Za-z0-9]{16,}'))],
  ['secret-bearer', R(J('Bear', 'er\\s+[A-Za-z0-9._~+/-]{20,}'))],
  ['secret-assignment', R(J('(?:api[_-]?key|secret|token|passw', 'or?d)["\']?\\s*[:=]\\s*["\'](?![$]|\\{\\{)[^"\'\\s]{16,}["\']'), 'i')],
];
export const USERS_PATH = R(J('/Us', 'ers/'));
// The private names are never written in this file. Same source as the shipped scanner: the file named by
// PHAROS_PRIVATE_NAMES_FILE, else <repo>/.git/info/private-names (per clone, never pushed). None found: an empty list.
function loadPrivateNames() { const f = process.env.PHAROS_PRIVATE_NAMES_FILE || path.join(ROOT, '.git', 'info', 'private-names'); try { return fs.readFileSync(f, 'utf8').split('\n').map((x) => x.trim()).filter((x) => x && !x.startsWith('#')); } catch { return []; } }
export const PRIVATE_NAMES = loadPrivateNames();
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const NAME_RULES = PRIVATE_NAMES.map((n) => [`private-name:${n}`, R(`(?<![A-Za-z0-9_])${escRe(n)}(?![A-Za-z0-9_])`, 'i'), n]);
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const SAFE_EMAIL = [/@example\.(com|org|net)$/i, /^noreply@anthropic\.com$/i];
const URL_HOST = /\b(?:https?|ssh|git|wss?):\/\/(?:[^\s/@"'<>]+@)?(\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)/g;
const IPV4 = /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g;

// personal strings derived at run time, never written to this file
export function personalStrings() {
  const out = [];
  try { const u = os.userInfo().username; if (u && u.length >= 3) out.push(['personal-username', u]); } catch {}
  try { const h = os.homedir(); if (h && h.length > 3) out.push(['personal-homedir', h]); } catch {}
  for (const k of ['user.email']) {
    try {
      const v = execFileSync('git', ['config', '--global', k], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (v) out.push(['personal-email', v]);
    } catch {}
  }
  return out;
}

export function readAllow(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
  } catch { return null; }
}

// allowlists/public-names.txt: lines "name" (allowed anywhere) or "path name" (allowed in that path only, path may be a prefix ending in /)
// allowlists/hosts.txt: lines "host", "*.suffix" or an IPv4
export function loadAllow(treeDir) {
  const names = readAllow(path.join(treeDir, 'allowlists', 'public-names.txt')) || [];
  const hosts = readAllow(path.join(treeDir, 'allowlists', 'hosts.txt')) || [];
  return { names, hosts };
}
function nameAllowed(allow, file, name) {
  return allow.names.some((l) => {
    const p = l.split(/\s+/);
    if (p.length === 1) return p[0].toLowerCase() === name.toLowerCase();
    const n = p[p.length - 1], pth = p.slice(0, -1).join(' ');
    return n.toLowerCase() === name.toLowerCase() && (file === pth || (pth.endsWith('/') && file.startsWith(pth)));
  });
}
function hostAllowed(allow, host) {
  host = host.toLowerCase().replace(/^\[|\]$/g, '');
  return allow.hosts.some((h) => {
    h = h.toLowerCase();
    return h === host || (h.startsWith('*.') && host.endsWith(h.slice(1)));
  });
}

export function scanTree(dir, { allow, personal = personalStrings(), skipFiles = new Set() } = {}) {
  allow = allow || loadAllow(dir);
  const hits = []; let scanned = 0, binary = 0;
  for (const rel of walk(dir)) {
    if (skipFiles.has(rel)) continue;
    const full = path.join(dir, rel);
    let st; try { st = fs.lstatSync(full); } catch { continue; }
    if (st.isSymbolicLink()) { hits.push({ file: rel, line: 0, rule: 'symlink-in-tree' }); continue; }
    const buf = fs.readFileSync(full);
    if (buf.subarray(0, 8000).includes(0)) { binary++; continue; }
    scanned++;
    const lines = buf.toString('utf8').split('\n');
    lines.forEach((text, i) => {
      const add = (rule) => hits.push({ file: rel, line: i + 1, rule });
      for (const [rule, re] of SECRET_RULES) if (re.test(text)) add(rule);
      if (USERS_PATH.test(text)) add('users-path');
      for (const [rule, re, n] of NAME_RULES) if (re.test(text) && !nameAllowed(allow, rel, n)) add(rule);
      for (const m of text.matchAll(EMAIL)) if (!SAFE_EMAIL.some((s) => s.test(m[0]))) add('email');
      for (const m of text.matchAll(URL_HOST)) if (!hostAllowed(allow, m[1])) add('host');
      for (const m of text.matchAll(IPV4)) if (!hostAllowed(allow, m[0])) add('ip');
      for (const [rule, s] of personal) if (text.includes(s)) add(rule);
    });
  }
  return { hits, scanned, binary };
}

// ---------- GitHub read-only fetch ----------
export function gh(args, opts = {}) {
  return execFileSync('gh', args, { maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}
const _cache = new Map();
export function fetchUpstream(sha, p) {
  const k = `${sha}:${p}`;
  if (!_cache.has(k)) {
    _cache.set(k, gh(['api', `repos/${KHORA_REPO}/contents/${p}?ref=${sha}`, '-H', 'Accept: application/vnd.github.raw']));
  }
  return _cache.get(k);
}

// ---------- SOURCE.json ----------
export function findSource() {
  for (const c of ['doors/reader-stack/upstream/SOURCE.json', 'doors/reader-stack/SOURCE.json']) {
    const f = path.join(ROOT, c);
    if (fs.existsSync(f)) return f;
  }
  return null;
}
export function parseSource(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const sha = j.sha ?? j.commit ?? j.upstream_sha ?? j.khora_sha ?? j.provenance?.upstream_sha ?? j.upstream?.sha ?? j.upstream?.commit;
  let files = j.files ?? j.provenance?.files ?? j.upstream?.files;
  if (files && !Array.isArray(files) && typeof files === 'object') {
    files = Object.entries(files).map(([p, v]) => ({ path: p, sha256: typeof v === 'string' ? v : v?.sha256 }));
  }
  files = (files || []).map((f) => (typeof f === 'string' ? { path: f } : { path: f.path, sha256: f.sha256 }));
  return { sha, files, raw: j };
}
export function upstreamDirFor(sourceFile) {
  return path.basename(path.dirname(sourceFile)) === 'upstream'
    ? path.dirname(sourceFile)
    : path.join(path.dirname(sourceFile), 'upstream');
}

// Compare a directory against upstream bytes. Returns a list of problems (empty = identical).
export function compareUpstream(dir, source, fetch = fetchUpstream) {
  const problems = [];
  for (const f of source.files) {
    const lp = path.join(dir, f.path);
    let want;
    try { want = fetch(source.sha, f.path); } catch (e) { problems.push(`${f.path}: fetch failed: ${String(e.stderr || e.message).slice(0, 120)}`); continue; }
    if (f.sha256 && f.sha256 !== sha256(want)) problems.push(`${f.path}: manifest sha256 differs from upstream bytes`);
    if (!fs.existsSync(lp)) { problems.push(`${f.path}: missing from tree`); continue; }
    const have = fs.readFileSync(lp);
    if (!have.equals(want)) problems.push(`${f.path}: bytes differ (have ${have.length} want ${want.length})`);
  }
  const listed = new Set(source.files.map((f) => f.path));
  if (fs.existsSync(dir)) {
    for (const rel of walk(dir)) if (!listed.has(rel) && rel !== 'SOURCE.json') problems.push(`${rel}: unlisted file under upstream/ (cannot be verified)`);
  }
  return problems;
}

export { fs, path, os, execFileSync, spawnSync };
