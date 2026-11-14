#!/usr/bin/env node
// The ignorance lint. A repo is ignorant when its only reach out is pharos.
// Lists every import / require / path / URL / CLI call / dependency that reaches a sibling repo.
// The roster of sibling names comes from the caller (--roster a,b  or  --roster-file f). Never hard-coded.
// Log-only by default (exit 0); --enforce exits 1 on any finding. JSON on stdout, summary on stderr.
// --exempt a,b names top-level folders that are not linted. For pharos itself that is doors/: a door by definition
// names the repo it installs into (see install/CONTRACT.md). The exemption is always stated by the caller and reported.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SKIP_DIRS = new Set(['.git', 'node_modules']);
const EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.sh', '.bash', '.zsh', '.json', '.yml', '.yaml', '.toml']);
const SHELL = new Set(['.sh', '.bash', '.zsh']);
const LOOSE = new Set(['.yml', '.yaml', '.toml']); // unquoted values are paths here too
const BUILD = /^(?:Dockerfile.*|Makefile|makefile|GNUmakefile|Justfile|Procfile)$/; // extensionless build files
const MAX_BYTES = 1 << 20;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const seg = (n) => new RegExp(`(?<![A-Za-z0-9_-])${esc(n)}(?![A-Za-z0-9_-])`); // n as a whole name/segment

export function lintText(text, file, names) {
  const findings = [];
  const seen = new Set();
  const ext = path.extname(file);
  const base = path.basename(file);
  const shellish = SHELL.has(ext) || BUILD.test(base);
  const unquoted = shellish || LOOSE.has(ext);
  text.split('\n').forEach((line, i) => {
    const add = (kind, name) => {
      const k = `${i}|${kind}|${name}`;
      if (seen.has(k)) return;
      seen.add(k);
      findings.push({ file, line: i + 1, kind, name, text: line.trim().slice(0, 160) });
    };
    const isImport = /\bimport\b|\brequire\s*\(|\bexport\b[^;]*\bfrom\b/.test(line);
    const strings = [...line.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);
    const urls = line.match(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`)<>]+/gi) || [];
    const py = ext === '.py' && line.match(/^\s*(?:from|import)\s+([\w.]+)/);
    for (const n of names) {
      const re = seg(n);
      for (const s of strings) {
        if (!re.test(s)) continue;
        if (isImport) add('import', n);
        else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) add('url', n);
        else if (/[/\\]/.test(s)) add('path', n);
        else if ((s === n && /\b(?:spawn|exec|execFile|execSync|spawnSync|execFileSync|fork|run)\w*\s*\(/.test(line))
          || new RegExp(`(^\\s*|[;&|]\\s*|\\bnpx\\s+)${esc(n)}(\\s|$)`).test(s)) add('cli', n);
      }
      for (const u of urls) if (re.test(u)) add('url', n);
      if (py && py[1].split('.').includes(n)) add('import', n);
      if (unquoted) {
        for (const t of line.split(/\s+/)) if (/[/~]/.test(t) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(t) && re.test(t)) add('path', n); // ../n  ~/code/n  n/bin
        if (new RegExp(`(^\\s*|[;&|(]\\s*)(?:cd|pushd|source|\\.)\\s+['"]?${esc(n)}(?![A-Za-z0-9_-])`).test(line)) add('path', n);
        if (new RegExp(`\\b(?:run|cmd|command|entrypoint|script):\\s*(?:\\[\\s*)?${esc(n)}(\\s|$|[,\\]])`).test(line)) add('cli', n);
      }
      if (shellish && new RegExp(`(^\\s*|[;&|(]\\s*|\\$\\(\\s*|\\bnpx\\s+|\\bsudo\\s+)${esc(n)}(\\s|$|;)`).test(line)) add('cli', n);
    }
  });
  if (path.basename(file) === 'package.json') {
    let pkg;
    try { pkg = JSON.parse(text); } catch (err) { pkg = null; }
    if (pkg) for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const n of names) if (pkg[field] && Object.hasOwn(pkg[field], n)) {
        const ln = text.split('\n').findIndex((l) => l.includes(`"${n}"`)) + 1;
        findings.push({ file, line: ln, kind: 'dependency', name: n, text: `${field}.${n}` });
      }
    }
  }
  return findings;
}

// skip: paths relative to the root that are never entered (not even listed)
function* walk(dir, skip = [], rel = '') {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) { if (!SKIP_DIRS.has(d.name) && !skip.includes(r)) yield* walk(path.join(dir, d.name), skip, r); }
    else if (d.isFile() && (EXTS.has(path.extname(d.name)) || BUILD.test(d.name))) yield path.join(dir, d.name);
  }
}

export function lint(dir, { roster, self, exempt = [] } = {}) {
  const root = path.resolve(dir);
  const me = self || path.basename(root);
  // pharos is the one permitted reach; the repo's own name is not a sibling.
  const names = [...new Set(roster || [])].filter((n) => n && n !== 'pharos' && n !== me);
  const findings = [];
  let scanned = 0;
  const skip = [...new Set(exempt)].filter(Boolean).map((e) => e.replace(/\/+$/, ''));
  for (const f of walk(root, skip)) {
    if (fs.statSync(f).size > MAX_BYTES) continue;
    scanned++;
    findings.push(...lintText(fs.readFileSync(f, 'utf8'), path.relative(root, f), names));
  }
  return { repo: root, roster: names, exempt: skip, scanned, findings, ignorant: findings.length === 0 };
}

export function readRoster(file) {
  const raw = fs.readFileSync(file, 'utf8');
  try {
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j : Array.isArray(j.roster) ? j.roster : [];
  } catch (err) {
    return raw.split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
  }
}

function main(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--enforce') flags.enforce = true;
    else if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i];
    else pos.push(argv[i]);
  }
  if (flags.roster === undefined && flags['roster-file'] === undefined) {
    console.error('usage: ignorance.mjs [repoDir] (--roster a,b | --roster-file f) [--self name] [--exempt dir,dir] [--enforce]');
    return 2;
  }
  const roster = [
    ...(flags.roster ? flags.roster.split(',').map((s) => s.trim()).filter(Boolean) : []),
    ...(flags['roster-file'] ? readRoster(flags['roster-file']) : []),
  ];
  const result = { mode: flags.enforce ? 'enforce' : 'log-only', ...lint(pos[0] || '.', { roster, self: flags.self, exempt: flags.exempt ? flags.exempt.split(',').map((s) => s.trim()).filter(Boolean) : [] }) };
  console.log(JSON.stringify(result, null, 2));
  const by = {};
  for (const f of result.findings) by[f.name] = (by[f.name] || 0) + 1;
  console.error(result.ignorant
    ? `ignorant: ${result.scanned} files scanned, no reach to ${result.roster.length} rostered siblings (${result.mode})`
    : `NOT ignorant: ${result.findings.length} reaches (${Object.entries(by).map(([n, c]) => `${n}:${c}`).join(' ')}) in ${result.scanned} files (${result.mode})`);
  return flags.enforce && !result.ignorant ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
