#!/usr/bin/env node
// I8 checker (test author B). Usage:
//   node test/install/b_khora_patch_check.mjs <patch-file> [--source <git url or path>] [--door reader-stack] [--files <SOURCE.json>] [--strict-refs] [--json]
// Clones khora main FRESH into ledgers/pharos-public/scratch/ (default source: the public GitHub URL, shallow, branch main),
// applies the patch (git apply, no hooks, no identity needed), stages everything in the scratch clone and verifies:
//   1. patch applies cleanly (git apply --check, then apply)
//   2. the deleted files are EXACTLY the extracted set (default: the seven in PREREG; if --files/SOURCE.json is given, its list, which must equal the seven)
//   3. nothing else changed, except added/modified README files (basename starts with README)
//   4. at least one changed README exists and its text names pharos and the door
// Advisory (fails only with --strict-refs): remaining files still referencing a removed path.
// Exit: 0 pass, 1 fail, 2 usage/clone error.  The clone is left in scratch for inspection. Never pushes, never touches the stale local khora tree.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EXPECTED_EXTRACTED, KHORA_URL, mkScratch, parseSource, fs, path, spawnSync } from './b_lib.mjs';

const git = (cwd, args, input) => spawnSync('git', args, {
  cwd, encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024,
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
});

export function checkPatch({ patch, source = KHORA_URL, door = 'reader-stack', expected = EXPECTED_EXTRACTED, strictRefs = false }) {
  const checks = []; const add = (name, ok, detail = '') => checks.push({ name, ok, detail });
  const out = { pass: false, checks, baseSha: null, cloneDir: null, danglingRefs: [], changes: [] };
  patch = path.resolve(patch);
  if (!fs.existsSync(patch)) { add('patch file exists', false, patch); return out; }
  const base = mkScratch('i8'); const dir = path.join(base, 'khora'); out.cloneDir = dir;
  const isUrl = /^https?:\/\//.test(source);
  const cargs = isUrl ? ['clone', '--quiet', '--depth', '1', '--branch', 'main', source, dir] : ['clone', '--quiet', source, dir];
  const c = git(base, cargs);
  if (c.status !== 0) { add('fresh clone of khora main', false, c.stderr.slice(0, 200)); out.clone = false; return out; }
  out.baseSha = git(dir, ['rev-parse', 'HEAD']).stdout.trim();
  add('fresh clone of khora main', true, out.baseSha);
  const missingBase = expected.filter((p) => !fs.existsSync(path.join(dir, p)));
  add('every extracted file exists at the base', missingBase.length === 0, missingBase.join(', '));

  const chk = git(dir, ['apply', '--check', patch]);
  add('patch applies cleanly (git apply --check)', chk.status === 0, chk.stderr.trim().slice(0, 300));
  if (chk.status !== 0) return finish(out, strictRefs);
  const ap = git(dir, ['apply', patch]);
  add('patch applied', ap.status === 0, ap.stderr.trim().slice(0, 300));
  if (ap.status !== 0) return finish(out, strictRefs);

  git(dir, ['add', '-A']);
  const ns = git(dir, ['diff', '--cached', '--name-status', '--no-renames']).stdout.trim().split('\n').filter(Boolean)
    .map((l) => { const [s, ...r] = l.split('\t'); return { s, p: r.join('\t') }; });
  out.changes = ns;
  const deleted = ns.filter((x) => x.s === 'D').map((x) => x.p).sort();
  const want = [...expected].sort();
  const missing = want.filter((p) => !deleted.includes(p));
  const extra = deleted.filter((p) => !want.includes(p));
  add('exactly the extracted files are removed', missing.length === 0 && extra.length === 0,
    `removed=${deleted.length} missing=[${missing}] extra=[${extra}]`);
  const isReadme = (p) => /^readme/i.test(path.basename(p));
  const others = ns.filter((x) => x.s !== 'D' ? !(['A', 'M'].includes(x.s) && isReadme(x.p)) : false);
  add('nothing else changed (only README files may be added or modified)', others.length === 0, others.map((x) => `${x.s} ${x.p}`).join(', '));
  const readmes = ns.filter((x) => ['A', 'M'].includes(x.s) && isReadme(x.p));
  add('a pointer README is added or modified', readmes.length > 0, readmes.map((x) => x.p).join(', '));
  const text = readmes.map((x) => fs.readFileSync(path.join(dir, x.p), 'utf8')).join('\n');
  // only count text the patch itself added
  const added = git(dir, ['diff', '--cached', '--no-renames', '-U0']).stdout.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n');
  add('pointer README text names pharos', /pharos/i.test(added) && /pharos/i.test(text), '');
  add(`pointer README text names the door (${door})`, added.includes(door) && text.includes(door), '');

  // advisory: dangling references to removed paths in the remaining tree
  const files = git(dir, ['ls-files']).stdout.split('\n').filter(Boolean);
  const changedReadmes = new Set(readmes.map((x) => x.p));
  const needles = expected.map((p) => (p.includes('/') ? p : p));
  for (const f of files) {
    if (changedReadmes.has(f) || expected.includes(f)) continue;
    let t; try { const b = fs.readFileSync(path.join(dir, f)); if (b.subarray(0, 4000).includes(0)) continue; t = b.toString('utf8'); } catch { continue; }
    t.split('\n').forEach((ln, i) => {
      for (const n of needles) {
        // full relative path, or for nested files the last two segments (scripts/run.sh), or a distinctive root script name
        const tail = n.split('/').slice(-2).join('/');
        const key = n.includes('/') ? tail : n;
        if (ln.includes(key) && (n.includes('/') || /setup-proxy|local-up/.test(n) || ln.includes(`./${n}`) || ln.includes(`/${n}`))) { out.danglingRefs.push(`${f}:${i + 1} -> ${n}`); break; }
      }
    });
  }
  return finish(out, strictRefs);
}

function finish(out, strictRefs) {
  if (strictRefs) out.checks.push({ name: 'no dangling references to removed paths', ok: out.danglingRefs.length === 0, detail: `${out.danglingRefs.length}` });
  out.pass = out.checks.every((c) => c.ok);
  return out;
}

function main() {
  const a = process.argv.slice(2);
  const opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const patch = a.find((x, i) => !x.startsWith('--') && !['--source', '--door', '--files'].includes(a[i - 1]));
  if (!patch) { console.error('usage: b_khora_patch_check.mjs <patch-file> [--source URL|PATH] [--door NAME] [--files SOURCE.json] [--strict-refs] [--json]'); process.exit(2); }
  let expected = EXPECTED_EXTRACTED; let pre = null;
  if (opt('--files')) {
    expected = parseSource(opt('--files')).files.map((f) => f.path);
    if ([...expected].sort().join('\n') !== [...EXPECTED_EXTRACTED].sort().join('\n')) pre = 'SOURCE.json file list differs from the seven extracted tools in PREREG';
  }
  const r = checkPatch({ patch, source: opt('--source') || KHORA_URL, door: opt('--door') || 'reader-stack', expected, strictRefs: a.includes('--strict-refs') });
  if (pre) { r.checks.unshift({ name: 'SOURCE.json list equals PREREG seven', ok: false, detail: pre }); r.pass = false; }
  if (a.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else {
    for (const c of r.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  [' + c.detail + ']' : ''}`);
    console.log(`base=${r.baseSha} clone=${r.cloneDir}`);
    console.log(`ADVISORY dangling references to removed paths: ${r.danglingRefs.length}`);
    for (const d of r.danglingRefs.slice(0, 40)) console.log(`  ${d}`);
    console.log(r.pass ? 'I8 RESULT: PASS' : 'I8 RESULT: FAIL');
  }
  process.exit(r.clone === false ? 2 : r.pass ? 0 : 1);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
