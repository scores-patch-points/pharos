#!/usr/bin/env node
// I8 checker, amended A1 (test author C). Usage:
//   node test/install/c_khora_patch_check.mjs <patch> [--listing FILE] [--source URL|PATH] [--door reader-stack] [--json]
// Clones khora main FRESH into scratch (default: the public GitHub URL, shallow), applies the patch (git apply, no hooks) and checks:
//   1. the patch applies cleanly
//   2. the deleted files are EXACTLY the seven extracted tools
//   3. nothing else changed, except (a) README-class files and (b) files that, in the BASE, referenced a removed path
//   4. claude-code/hooks/hooks.json is among the edited files and no hook entry in the patched tree still runs a removed script
//   5. every edited (not deleted) file is LISTED: its path appears in the listing (a --listing file, the patch's own header text,
//      or a sibling KHORA_PATCH.md / <patch>.md / <patch>.txt)
//   6. a README added or modified names pharos and the door
// Advisory: remaining dangling references to removed paths (listed, never failing).  Exit 0 pass, 1 fail, 2 usage/clone error.
// Never pushes, never touches any local khora tree.
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkScratch } from './c_lib.mjs';

export const SEVEN = ['install.sh', 'setup-proxy.sh', 'local-up.sh', 'integrations/claude-code.sh', 'integrations/curl.sh', 'integrations/ollama.sh', 'claude-code/scripts/run.sh'];
export const KHORA_URL = `${'https:' + '//' + 'github' + '.com'}/scores-patch-points/khora.git`;
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 << 20, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' } });
const isReadme = (p) => /^readme/i.test(path.basename(p));
const keysFor = (n) => { const tail = n.split('/').slice(-2).join('/'); return n.includes('/') ? [n, tail] : [`./${n}`, `/${n}`, ` ${n}`, `"${n}`, `'${n}`, `(${n}`, `\`${n}`]; };
const readText = (f) => { try { const b = fs.readFileSync(f); return b.subarray(0, 4000).includes(0) ? null : b.toString('utf8'); } catch { return null; } };
export function referencing(dir, files, removed) {
  const hits = new Map();
  for (const f of files) {
    const t = readText(path.join(dir, f)); if (t === null) continue;
    t.split('\n').forEach((ln, i) => { for (const n of removed) if (keysFor(n).some((k) => ln.includes(k))) { if (!hits.has(f)) hits.set(f, []); hits.get(f).push(`${i + 1} -> ${n}`); break; } });
  }
  return hits;
}

export function checkPatch({ patch, source = KHORA_URL, door = 'reader-stack', listing = null, expected = SEVEN }) {
  const checks = []; const add = (name, ok, detail = '') => checks.push({ name, ok, detail });
  const out = { pass: false, checks, baseSha: null, cloneDir: null, danglingRefs: [], changes: [] };
  patch = path.resolve(patch);
  if (!fs.existsSync(patch)) { add('patch file exists', false, patch); return out; }
  const base = mkScratch('i8'); const dir = path.join(base, 'khora'); out.cloneDir = dir;
  const isUrl = /^https?:\/\//.test(source);
  const c = git(base, isUrl ? ['clone', '--quiet', '--depth', '1', '--branch', 'main', source, dir] : ['clone', '--quiet', source, dir]);
  if (c.status !== 0) { add('fresh clone of khora main', false, c.stderr.slice(0, 200)); out.clone = false; return out; }
  out.baseSha = git(dir, ['rev-parse', 'HEAD']).stdout.trim();
  add('fresh clone of khora main', true, out.baseSha);
  const baseFiles = git(dir, ['ls-files']).stdout.split('\n').filter(Boolean);
  const refsBase = referencing(dir, baseFiles.filter((f) => !expected.includes(f)), expected);   // files that referenced a removed path in the BASE
  const chk = git(dir, ['apply', '--check', patch]);
  add('patch applies cleanly (git apply --check)', chk.status === 0, chk.stderr.trim().slice(0, 300));
  if (chk.status !== 0) return fin(out);
  const ap = git(dir, ['apply', patch]); add('patch applied', ap.status === 0, ap.stderr.trim().slice(0, 300));
  if (ap.status !== 0) return fin(out);
  git(dir, ['add', '-A']);
  const ns = git(dir, ['diff', '--cached', '--name-status', '--no-renames']).stdout.trim().split('\n').filter(Boolean).map((l) => { const [s, ...r] = l.split('\t'); return { s, p: r.join('\t') }; });
  out.changes = ns;
  const deleted = ns.filter((x) => x.s === 'D').map((x) => x.p).sort();
  const missing = [...expected].filter((p) => !deleted.includes(p)); const extra = deleted.filter((p) => !expected.includes(p));
  add('exactly the extracted files are removed', !missing.length && !extra.length, `removed=${deleted.length} missing=[${missing}] extra=[${extra}]`);
  const edited = ns.filter((x) => x.s !== 'D');
  const stray = edited.filter((x) => !(isReadme(x.p) && ['A', 'M'].includes(x.s)) && !(x.s === 'M' && refsBase.has(x.p)));
  add('nothing else changed (only README files, and files that referenced a removed path, may be edited)', stray.length === 0, stray.map((x) => `${x.s} ${x.p}`).join(', '));
  // 4. hooks
  const hooks = 'claude-code/hooks/hooks.json';
  const hooksEdited = edited.some((x) => x.p === hooks);
  add('claude-code/hooks/hooks.json is edited', hooksEdited, hooksEdited ? '' : 'the patch leaves hooks.json untouched');
  const after = git(dir, ['ls-files']).stdout.split('\n').filter(Boolean);
  const hookFiles = after.filter((f) => /^claude-code\/hooks\/.*\.json$/.test(f));
  const live = [];
  for (const f of hookFiles) { const t = readText(path.join(dir, f)) || ''; if (/scripts\/run\.sh/.test(t)) live.push(f); }
  add('no hook entry still runs a removed script', live.length === 0, live.map((f) => `${f} still names scripts/run.sh`).join(', '));
  // 5. listing
  const header = fs.readFileSync(patch, 'utf8').split(/^diff --git /m)[0];
  const sib = [path.join(path.dirname(patch), 'KHORA_PATCH.md'), `${patch}.md`, `${patch}.txt`, patch.replace(/\.(patch|diff)$/, '.md')].filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f, 'utf8'));
  const lst = [header, listing || '', ...sib].join('\n');
  const unlisted = edited.map((x) => x.p).filter((p) => !lst.includes(p));
  add('every edited file is listed', edited.length > 0 && unlisted.length === 0, unlisted.length ? `not listed: ${unlisted.join(', ')}` : '');
  // 6. README
  const readmes = edited.filter((x) => isReadme(x.p));
  add('a pointer README is added or modified', readmes.length > 0, readmes.map((x) => x.p).join(', '));
  const addedText = git(dir, ['diff', '--cached', '--no-renames', '-U0']).stdout.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n');
  const rtext = readmes.map((x) => readText(path.join(dir, x.p)) || '').join('\n');
  add('pointer README text names pharos', /pharos/i.test(addedText) && /pharos/i.test(rtext));
  add(`pointer README text names the door (${door})`, addedText.includes(door) && rtext.includes(door));
  const dang = referencing(dir, after.filter((f) => !expected.includes(f)), expected);
  for (const [f, l] of dang) for (const x of l) out.danglingRefs.push(`${f}:${x}`);
  return fin(out);
}
function fin(out) { out.pass = out.checks.every((c) => c.ok); return out; }

function main() {
  const a = process.argv.slice(2); const opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const patch = a.find((x, i) => !x.startsWith('--') && !['--source', '--door', '--listing'].includes(a[i - 1]));
  if (!patch) { console.error('usage: c_khora_patch_check.mjs <patch> [--listing FILE] [--source URL|PATH] [--door NAME] [--json]'); process.exit(2); }
  const r = checkPatch({ patch, source: opt('--source') || KHORA_URL, door: opt('--door') || 'reader-stack', listing: opt('--listing') ? fs.readFileSync(opt('--listing'), 'utf8') : null });
  if (a.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else {
    for (const c of r.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  [' + c.detail + ']' : ''}`);
    console.log(`base=${r.baseSha} clone=${r.cloneDir}\nADVISORY dangling references to removed paths: ${r.danglingRefs.length}`);
    for (const d of r.danglingRefs.slice(0, 40)) console.log(`  ${d}`);
    console.log(r.pass ? 'I8 RESULT: PASS' : 'I8 RESULT: FAIL');
  }
  process.exit(r.clone === false ? 2 : r.pass ? 0 : 1);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
