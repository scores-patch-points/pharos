#!/usr/bin/env node
// Public-readiness scan. Usage: node tools/public-scan.mjs [dir] [--allowlist FILE] [--names-file FILE] [--require-names] [--json] [--selftest]
// Exit 0: no findings after the allowlist. Exit 1: findings. Exit 2: usage (or --require-names with no names list).
// Categories: secret, personal-path (home-directory paths, the current account's username), email, private-name, host (hostnames and IPs).
//
// WHAT IS SCANNED. When <dir> is the top of a git work tree, the release set: the files git tracks plus the untracked
// files it does not ignore (git ls-files --cached --others --exclude-standard). Ignored files are not part of a
// release and are not opened. When <dir> is not a git work tree, every file under it is scanned (except .git,
// node_modules, .pharos), and a top-level log/ folder is reported as a finding without being read.
//
// NOTHING PRIVATE IS WRITTEN IN THIS FILE. The username and home path are taken from the account running the scan.
// The list of private names (one per line, # comments) comes from --names-file, else the file named by the env
// PHAROS_PRIVATE_NAMES_FILE, else <the scanned repo>/.git/info/private-names, else <this repo>/.git/info/private-names
// (.git/info is per clone and is never tracked or pushed). With no list the private-name check DOES NOT RUN, the
// output says so, and --require-names turns that into exit 2.
//
// The allowlist is a JSON file (default: <dir>/allowlists/public-scan.json, else the one beside this tool):
//   { "hosts": ["127.0.0.1", ...],                       hostnames or IPs allowed anywhere; "*.x.org" matches subdomains
//     "emails": ["<an address>"],                                emails allowed anywhere
//     "allow": [ { "path": "glob", "categories": [..], "reason": "why" } ] }   findings of those categories in matching files
// Every allowlisted hit is still counted and printed, so nothing is hidden.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', '.pharos']);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The account's own name and home, read at run time (never stored here). Names shorter than 3 characters are not used.
export function personalPatterns() {
  const out = [];
  const names = new Set();
  try { names.add(os.userInfo().username); } catch { /* none */ }
  for (const k of ['USER', 'LOGNAME']) if (process.env[k]) names.add(process.env[k]);
  try { names.add(path.basename(os.userInfo().homedir)); } catch { /* none */ }
  for (const n of names) if (n && n.length >= 3 && !['root', 'user', 'sandbox', 'runner', 'node'].includes(n)) out.push(new RegExp(`(?<![A-Za-z0-9])${escRe(n)}(?![A-Za-z0-9])`, 'i'));
  return out;
}

export function loadNames(dir, file) {
  const cands = [file, process.env.PHAROS_PRIVATE_NAMES_FILE, dir && path.join(dir, '.git', 'info', 'private-names'), path.join(HERE_ROOT, '.git', 'info', 'private-names')].filter(Boolean);
  if (file && !fs.existsSync(file)) throw Object.assign(new Error(`--names-file ${file} does not exist`), { usage: true });
  for (const c of cands) {
    let raw; try { raw = fs.readFileSync(c, 'utf8'); } catch { continue; }
    return { file: c, names: [...new Set(raw.split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean))] };
  }
  return { file: null, names: [] };
}
const nameRes = (names) => names.map((n) => [n, new RegExp(`(?<![A-Za-z0-9])${escRe(n)}(?![A-Za-z0-9])`, 'i')]);

export const SECRET_PATTERNS = [
  ['aws-access-key', /\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}\b/],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['github-pat', /\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['openai-style-key', /\bsk-[A-Za-z0-9]{20,}\b/],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['private-key-header', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['huggingface-token', /\bhf_[A-Za-z0-9]{30,}\b/],
  ['npm-token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['gitlab-token', /\bglpat-[A-Za-z0-9_-]{20,}/],
  ['stripe-live-key', /\b[rs]k_live_[0-9A-Za-z]{20,}/],
  ['sendgrid-key', /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/],
  ['url-credentials', /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@'"]+:[^/\s@'"]+@[^/\s'"]+/i],
  ['bearer-token', /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/],
  ['assigned-secret', /\b(?:api[_-]?key|secret|token|passwd|password|auth)[A-Za-z0-9_-]*\s*[:=]\s*['"][A-Za-z0-9/+_=.-]{16,}['"]/i],
];

const TLDS = 'com|org|net|io|dev|ai|ly|co|xyz|info|edu|gov|cloud|tech';
const RE = {
  personalPath: [/\/Users\/[^\s/'"`]+/, /\/home\/[^\s/'"`]+\/[^\s'"`]*/, /[A-Za-z]:\\Users\\[^\s\\'"`]+/],
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g,
  ipv4: /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g,
  urlHost: /\b[a-z][a-z0-9+.-]*:\/\/(?:[^/\s'"`@]*@)?([^/\s'"`:?#)<>]+)/gi,
  bareHost: new RegExp(`(?<![A-Za-z0-9@/._-])((?:[a-z0-9-]+\\.)+(?:${TLDS}))(?![A-Za-z0-9-])`, 'gi'),
};

const globRe = (g) => new RegExp('^' + g.split('**').map((p) => p.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*') + '$');
const hostAllowed = (h, list) => list.some((a) => (a.startsWith('*.') ? h === a.slice(2) || h.endsWith(a.slice(1)) : h === a));

export function scanText(text, rel, { names = [], personal = personalPatterns() } = {}) {
  const nres = nameRes(names);
  const found = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const add = (category, what) => found.push({ file: rel, line: i + 1, category, what, text: line.trim().slice(0, 120) });
    for (const [name, re] of SECRET_PATTERNS) if (re.test(line)) add('secret', name);
    for (const re of RE.personalPath) { const m = re.exec(line); if (m) add('personal-path', m[0]); }
    for (const re of personal) { const m = re.exec(line); if (m) add('personal-path', 'the account name of whoever runs this scan'); }
    for (const m of line.matchAll(RE.email)) add('email', m[0]);
    for (const [n, re] of nres) if (re.test(line)) add('private-name', n);
    for (const m of line.matchAll(RE.ipv4)) add('host', m[0]);
    const seen = new Set();
    for (const m of line.matchAll(RE.urlHost)) { const h = m[1].toLowerCase(); if (h.startsWith('$') || /[{}()*]/.test(h) || seen.has(h)) continue; seen.add(h); add('host', h); }
    for (const m of line.matchAll(RE.bareHost)) { const h = m[1].toLowerCase(); if (seen.has(h)) continue; seen.add(h); add('host', h); }
  });
  // an IPv4 inside a URL is reported once per match above; collapse exact duplicates
  const key = new Set();
  return found.filter((f) => { const k = `${f.line}|${f.category}|${f.what}`; if (key.has(k)) return false; key.add(k); return true; });
}

// The live log folder is never part of a release (it holds transcript text and mirrored private logs). In a git work
// tree it is ignored and so never listed. In a plain folder it is reported once, as a finding no allowlist rule can
// clear, and is not opened.
const RELEASE_EXCLUDED = ['log'];

function walk(root, rel = '', out = []) {
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (e.isDirectory()) { if (!rel && RELEASE_EXCLUDED.includes(e.name)) continue; if (!SKIP_DIRS.has(e.name)) walk(root, path.posix.join(rel, e.name), out); } // dotdirs other than .git are scanned
    else if (e.isFile() || e.isSymbolicLink()) out.push(path.posix.join(rel, e.name));
  }
  return out;
}

// The release set: what git would track here. null when root is not the top of a git work tree (or git is missing).
export function releaseSet(root) {
  if (!fs.existsSync(path.join(root, '.git'))) return null;
  const git = (args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const top = git(['rev-parse', '--show-toplevel']);
  if (top.status !== 0) return null;
  const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
  if (real(top.stdout.trim()) !== real(root)) return null;
  const r = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  if (r.status !== 0) return null;
  return [...new Set(r.stdout.split('\0').filter(Boolean))].filter((f) => fs.lstatSync(path.join(root, f), { throwIfNoEntry: false })).sort();
}

export function loadAllowlist(dir, file) {
  const here = path.join(HERE_ROOT, 'allowlists', 'public-scan.json');
  const cands = file ? [file] : [path.join(dir, 'allowlists', 'public-scan.json'), here];
  for (const c of cands) if (fs.existsSync(c)) return { file: c, ...JSON.parse(fs.readFileSync(c, 'utf8')) };
  return { file: null, hosts: [], emails: [], allow: [] };
}

export function scan(dir, { allowlist, namesFile, names } = {}) {
  const root = path.resolve(dir);
  const al = allowlist || loadAllowlist(root);
  const nl = names ? { file: '(given)', names } : loadNames(root, namesFile);
  const personal = personalPatterns();
  const rules = (al.allow || []).map((r) => ({ ...r, re: globRe(r.path) }));
  const findings = [], allowed = [];
  let files = 0;
  const set = releaseSet(root);
  const source = set ? 'git release set (tracked + untracked-not-ignored)' : 'every file on disk (not a git work tree)';
  if (!set) for (const name of RELEASE_EXCLUDED) {
    const st = fs.lstatSync(path.join(root, name), { throwIfNoEntry: false });
    if (st && st.isDirectory()) findings.push({ file: `${name}/`, line: 0, category: 'release-excluded-dir', what: `${name}/ is inside a folder that is not a git work tree, so nothing marks it as excluded; it must not be published with this folder (not opened by this scan)`, text: '' });
  }
  for (const rel of set || walk(root)) {
    const st = fs.lstatSync(path.join(root, rel));
    if (st.isSymbolicLink()) { findings.push({ file: rel, line: 0, category: 'symlink', what: fs.readlinkSync(path.join(root, rel)), text: '' }); continue; }
    if (!st.isFile()) continue;
    const buf = fs.readFileSync(path.join(root, rel));
    if (buf.subarray(0, 8000).includes(0)) continue; // binary
    files++;
    for (const f of scanText(buf.toString('utf8'), rel, { names: nl.names, personal })) {
      if (f.category === 'host' && hostAllowed(f.what, al.hosts || [])) continue;
      if (f.category === 'email' && (al.emails || []).includes(f.what)) continue;
      const rule = rules.find((r) => r.re.test(f.file) && r.categories.includes(f.category));
      if (rule) allowed.push({ ...f, reason: rule.reason || '' }); else findings.push(f);
    }
  }
  return { root, source, allowlist: al.file, names_file: nl.file, names_checked: nl.names.length, files, findings, allowed };
}

// Positive control: plant a secret and a personal path in a COPY and require both to be found.
export function selftest(dir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pharos-scan-'));
  try {
    fs.mkdirSync(path.join(tmp, '.hidden'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.hidden', '.rc'), 'x=1\n# /Us' + 'ers/x/y\n');
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'k = ' + 'AKIA' + 'ABCDEFGHIJKLMNOP' + '\n-----BEGIN ' + 'PRIVATE KEY-----\nghp_' + 'a'.repeat(36) + '\n');
    fs.writeFileSync(path.join(tmp, 'n.txt'), 'uses the zz' + 'planted-name tool\n');
    const r = scan(tmp, { allowlist: { hosts: [], emails: [], allow: [] }, names: ['zz' + 'planted-name'] });
    const has = (c, w) => r.findings.some((f) => f.category === c && (!w || f.what.includes(w)));
    const checks = { secret_aws: has('secret', 'aws'), secret_key_header: has('secret', 'private-key'), secret_github: has('secret', 'github'), personal_path_in_dotfile: has('personal-path'), private_name_from_list: has('private-name', 'planted-name') };
    return { ok: Object.values(checks).every(Boolean), checks };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const dir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--allowlist' && args[i - 1] !== '--names-file') || '.';
  if (args.includes('--selftest')) { const r = selftest(dir); console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1); }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { console.error(JSON.stringify({ error: { code: 'USAGE', message: `${dir} is not a directory` } })); process.exit(2); }
  let r;
  try { r = scan(dir, { allowlist: val('--allowlist') ? loadAllowlist(dir, val('--allowlist')) : undefined, namesFile: val('--names-file') }); }
  catch (err) { if (!err.usage) throw err; console.error(JSON.stringify({ error: { code: 'USAGE', message: err.message } })); process.exit(2); }
  const namesLine = r.names_checked ? `private-name check: ${r.names_checked} name(s) from an untracked list` : 'private-name check: NOT RUN (no names list; see the header of this tool)';
  if (args.includes('--json')) console.log(JSON.stringify({ ok: r.findings.length === 0, source: r.source, files: r.files, allowlist: r.allowlist, private_names_checked: r.names_checked, findings: r.findings, allowlisted: r.allowed.length, allowed: r.allowed }, null, 2));
  else {
    for (const f of r.findings) console.log(`${f.file}:${f.line}  ${f.category}  ${f.what}`);
    console.log(`scanned ${r.files} files from ${r.source}: ${r.findings.length} finding(s), ${r.allowed.length} allowlisted hit(s)${r.allowlist ? ` (allowlist ${path.relative(process.cwd(), r.allowlist) || r.allowlist})` : ' (no allowlist)'}`);
    console.log(namesLine);
  }
  if (!r.names_checked && args.includes('--require-names')) { console.error(JSON.stringify({ error: { code: 'USAGE', message: '--require-names: no private-names list was found, so the private-name check did not run' } })); process.exit(2); }
  process.exit(r.findings.length ? 1 : 0);
}
