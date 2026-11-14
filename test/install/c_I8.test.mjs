// I8 (A1, amended): the khora patch may remove the seven extracted files and must also update every in-repo reference that would
// break (at least claude-code/hooks/hooks.json), listing each edited file; any other change fails; the checker lists dangling
// advisory references. Part 1 proves the checker (a good patch passes, ten bad ones fail on the named check). Part 2 runs it on the
// real prepared patch (env PHAROS_KHORA_PATCH, default: ledgers/pharos-public/patches/khora-extract-install-tools.patch).
// Network: a public shallow clone of khora main into scratch (read-only). No PHAROS_A_RUN needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOT, mkScratch, SCRATCH, fs, path, spawnSync } from './c_lib.mjs';
import { checkPatch, SEVEN, KHORA_URL } from './c_khora_patch_check.mjs';

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 << 20, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
const POINTER = 'This tooling moved. The install tools now live in the pharos repo, door reader-stack.\n';
const HOOKS = '{ "hooks": {} }\n';
const work = mkScratch('i8self'); const baseDir = path.join(work, 'base'); let P = null;
const LIST_GOOD = 'Edited files: README.md, claude-code/hooks/hooks.json\n';

function build() {
  if (P) return P;
  const c = git(work, ['clone', '--quiet', '--depth', '1', '--branch', 'main', KHORA_URL, baseDir]); assert.equal(c.status, 0, c.stderr);
  const rm = (d, l) => l.forEach((p) => fs.rmSync(path.join(d, p)));
  const readme = (d, t = POINTER) => fs.appendFileSync(path.join(d, 'README.md'), `\n${t}`);
  const hooks = (d) => fs.writeFileSync(path.join(d, 'claude-code/hooks/hooks.json'), HOOKS);
  const files = git(baseDir, ['ls-files']).stdout.split('\n').filter(Boolean);
  const unrelated = files.filter((f) => /\.(md|mjs|json)$/.test(f) && !SEVEN.includes(f) && !/^readme/i.test(path.basename(f)) && f !== 'claude-code/hooks/hooks.json');
  // a file that does NOT reference a removed path, and one that DOES (a doc)
  const refDoc = 'docs/PORTS.md';
  const make = (name, fn) => { const d = path.join(work, name); assert.equal(git(work, ['clone', '--quiet', '--local', baseDir, d]).status, 0); fn(d); git(d, ['add', '-A']); const f = path.join(work, `${name}.patch`); fs.writeFileSync(f, git(d, ['diff', '--cached', '--binary', '--no-renames']).stdout); return f; };
  const unrel = unrelated.find((f) => !fs.readFileSync(path.join(baseDir, f), 'utf8').match(/install\.sh|setup-proxy|local-up|run\.sh|integrations\/(claude-code|curl|ollama)/));
  P = {
    good: make('good', (d) => { rm(d, SEVEN); readme(d); hooks(d); }),
    goodPlusDoc: make('goodPlusDoc', (d) => { rm(d, SEVEN); readme(d); hooks(d); fs.appendFileSync(path.join(d, refDoc), '\n(moved to pharos)\n'); }),
    strict: make('strict', (d) => { rm(d, SEVEN); readme(d); }),
    six: make('six', (d) => { rm(d, SEVEN.slice(0, 6)); readme(d); hooks(d); }),
    extraDel: make('extraDel', (d) => { rm(d, [...SEVEN, unrel]); readme(d); hooks(d); }),
    extraMod: make('extraMod', (d) => { rm(d, SEVEN); readme(d); hooks(d); fs.appendFileSync(path.join(d, unrel), '\n'); }),
    extraAdd: make('extraAdd', (d) => { rm(d, SEVEN); readme(d); hooks(d); fs.writeFileSync(path.join(d, 'stray.txt'), 'x\n'); }),
    hooksStillRefs: make('hooksStillRefs', (d) => { rm(d, SEVEN); readme(d); const p = path.join(d, 'claude-code/hooks/hooks.json'); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('SessionStart"', 'SessionStart" ') ); }),
    noPharos: make('noPharos', (d) => { rm(d, SEVEN); readme(d, 'This tooling moved. See door reader-stack.\n'); hooks(d); }),
    noDoor: make('noDoor', (d) => { rm(d, SEVEN); readme(d, 'This tooling moved to the pharos repo.\n'); hooks(d); }),
    noReadme: make('noReadme', (d) => { rm(d, SEVEN); hooks(d); }),
  };
  const g = fs.readFileSync(P.good, 'utf8').replace(/^-(.+)$/m, (m, x) => `-${x}ZZ`); P.broken = path.join(work, 'broken.patch'); fs.writeFileSync(P.broken, g);
  return P;
}
const run = (p, extra = {}) => checkPatch({ patch: p, source: baseDir, ...extra });
const failed = (r) => r.checks.filter((c) => !c.ok).map((c) => c.name);

test('I8 checker: a correct patch (seven removed, hooks.json updated, README pointer, edited files listed) passes', () => {
  const r = run(build().good, { listing: LIST_GOOD }); assert.ok(r.pass, JSON.stringify(r.checks.filter((c) => !c.ok)));
});
test('I8 checker: a correct patch that also edits a doc which referenced a removed path passes when that doc is listed', () => {
  const r = run(build().goodPlusDoc, { listing: LIST_GOOD + 'docs/PORTS.md\n' }); assert.ok(r.pass, JSON.stringify(r.checks.filter((c) => !c.ok)));
});
test('I8 checker: the same patch FAILS when the doc edit is not listed', () => {
  const r = run(build().goodPlusDoc, { listing: LIST_GOOD }); assert.ok(!r.pass); assert.ok(failed(r).includes('every edited file is listed'));
});
test('I8 checker: the strict seven-only patch (hooks.json untouched) FAILS: hooks.json is not edited and a hook still runs a removed script', () => {
  const r = run(build().strict, { listing: 'README.md' }); assert.ok(!r.pass);
  assert.ok(failed(r).includes('claude-code/hooks/hooks.json is edited')); assert.ok(failed(r).includes('no hook entry still runs a removed script'));
});
test('I8 checker: removing six of seven FAILS on "exactly the extracted files"', () => {
  const r = run(build().six, { listing: LIST_GOOD }); assert.ok(!r.pass); assert.ok(failed(r).some((n) => /exactly the extracted/.test(n)));
});
test('I8 checker: removing an extra file FAILS on "exactly the extracted files"', () => {
  const r = run(build().extraDel, { listing: LIST_GOOD }); assert.ok(!r.pass); assert.ok(failed(r).some((n) => /exactly the extracted/.test(n)));
});
test('I8 checker: editing a file that never referenced a removed path FAILS on "nothing else changed"', () => {
  const r = run(build().extraMod, { listing: LIST_GOOD + 'x' }); assert.ok(!r.pass); assert.ok(failed(r).some((n) => /nothing else/.test(n)));
});
test('I8 checker: an added stray file FAILS on "nothing else changed"', () => {
  const r = run(build().extraAdd, { listing: LIST_GOOD }); assert.ok(!r.pass); assert.ok(failed(r).some((n) => /nothing else/.test(n)));
});
test('I8 checker: hooks.json touched but still running the removed script FAILS', () => {
  const r = run(build().hooksStillRefs, { listing: LIST_GOOD }); assert.ok(!r.pass); assert.ok(failed(r).includes('no hook entry still runs a removed script'));
});
test('I8 checker: a good patch with NO listing FAILS on "every edited file is listed"', () => {
  const r = run(build().good); assert.ok(!r.pass); assert.ok(failed(r).includes('every edited file is listed'));
});
test('I8 checker: a README without pharos, a README without the door, and no README each FAIL', () => {
  for (const [k, re] of [['noPharos', /names pharos/], ['noDoor', /names the door/], ['noReadme', /pointer README is added/]]) {
    const r = run(build()[k], { listing: LIST_GOOD }); assert.ok(!r.pass, k); assert.ok(failed(r).some((n) => re.test(n)), `${k}: ${failed(r)}`);
  }
});
test('I8 checker: a patch that does not apply FAILS on "applies cleanly"', () => {
  const r = run(build().broken, { listing: LIST_GOOD }); assert.ok(!r.pass); assert.ok(failed(r).some((n) => /applies cleanly/.test(n)));
});
test('I8 checker: the correct patch also passes against a FRESH clone of the public khora main (network path); dangling references are listed', () => {
  const r = checkPatch({ patch: build().good, listing: LIST_GOOD });
  console.log(`# I8 fresh clone base=${r.baseSha} advisory dangling refs=${r.danglingRefs.length}`); for (const d of r.danglingRefs.slice(0, 25)) console.log(`#   ${d}`);
  assert.ok(r.pass, JSON.stringify(r.checks.filter((c) => !c.ok)));
});
test('I8 checker: CLI exits 0 for the good patch, 1 for a bad one, 2 without arguments', () => {
  const s = path.join(ROOT, 'test', 'install', 'c_khora_patch_check.mjs'); const l = path.join(work, 'list.txt'); fs.writeFileSync(l, LIST_GOOD);
  const a = spawnSync(process.execPath, [s, build().good, '--source', baseDir, '--listing', l], { encoding: 'utf8' });
  const b = spawnSync(process.execPath, [s, build().strict, '--source', baseDir, '--listing', l], { encoding: 'utf8' });
  assert.equal(a.status, 0, a.stdout + a.stderr); assert.equal(b.status, 1, b.stdout + b.stderr);
  assert.equal(spawnSync(process.execPath, [s], { encoding: 'utf8' }).status, 2);
});

// ---------- the real prepared patch ----------
function findPatch() {
  if (process.env.PHAROS_KHORA_PATCH) return process.env.PHAROS_KHORA_PATCH;
  const cands = [path.resolve(ROOT, '..', 'ledgers', 'pharos-public', 'patches', 'khora-extract-install-tools.patch'), path.join(ROOT, 'doors', 'reader-stack', 'patches')];
  for (const c of cands) { if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; if (fs.existsSync(c) && fs.statSync(c).isDirectory()) { const f = fs.readdirSync(c).find((x) => /\.(patch|diff)$/.test(x)); if (f) return path.join(c, f); } }
  return null;
}
test('I8: the prepared khora patch: applies to a fresh clone of khora main, removes exactly the seven files, updates hooks.json and every other reference it edits, lists each edited file, README names pharos and the door', () => {
  const p = findPatch(); assert.ok(p, 'no prepared patch found (set PHAROS_KHORA_PATCH)');
  const r = checkPatch({ patch: p, listing: process.env.PHAROS_KHORA_LISTING ? fs.readFileSync(process.env.PHAROS_KHORA_LISTING, 'utf8') : null });
  console.log(`# I8 real patch ${path.basename(p)} base=${r.baseSha} dangling refs (advisory)=${r.danglingRefs.length}`);
  for (const c of r.checks) console.log(`#   ${c.ok ? 'PASS' : 'FAIL'} ${c.name} ${c.detail}`);
  for (const d of r.danglingRefs.slice(0, 25)) console.log(`#   dangling: ${d}`);
  assert.ok(r.pass, JSON.stringify(r.checks.filter((c) => !c.ok)));
});
