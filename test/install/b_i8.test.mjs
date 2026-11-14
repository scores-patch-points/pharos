// I8 khora patch (test author B). Part 1 proves the checker itself (good patch passes, 7 bad patches fail on the named check).
// Part 2 runs the checker on the real prepared patch: PHAROS_KHORA_PATCH=<file>, else doors/reader-stack/patches/*.patch or *.diff.
// Run: node --test test/install/b_i8.test.mjs   (clones public khora read-only into scratch; needs network)
import nodeTest from 'node:test';
// SUPERSEDED by PREREG-A1.md ("I8 amended"); replaced by c_I8.test.mjs. Every case is reported as skipped, none was edited. See TEST_CHANGES.md item 8.
const test = (name, ...rest) => nodeTest.skip(`${name} [superseded by c_I8]`, ...rest);
import assert from 'node:assert/strict';
import { ROOT, EXPECTED_EXTRACTED, KHORA_URL, mkScratch, fs, path, spawnSync } from './b_lib.mjs';
import { checkPatch } from './b_khora_patch_check.mjs';

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 << 20, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
const POINTER = 'This tooling moved. The install tools now live in the pharos repo, door reader-stack.\n';

const work = mkScratch('i8self');
const baseDir = path.join(work, 'base');
let patches = null;

function build() {
  if (patches) return patches;
  const c = git(work, ['clone', '--quiet', '--depth', '1', '--branch', 'main', KHORA_URL, baseDir]);
  assert.equal(c.status, 0, `clone failed: ${c.stderr}`);
  const make = (name, fn) => {
    const d = path.join(work, name);
    assert.equal(git(work, ['clone', '--quiet', '--local', baseDir, d]).status, 0);
    fn(d);
    git(d, ['add', '-A']);
    const diff = git(d, ['diff', '--cached', '--binary', '--no-renames']).stdout;
    const f = path.join(work, `${name}.patch`); fs.writeFileSync(f, diff); return f;
  };
  const rm = (d, list) => list.forEach((p) => fs.rmSync(path.join(d, p)));
  const readme = (d, txt) => { const p = path.join(d, 'README.md'); fs.appendFileSync(p, `\n${txt}`); };
  const tracked = git(baseDir, ['ls-files']).stdout.split('\n').filter((p) => p && !EXPECTED_EXTRACTED.includes(p) && !/^readme/i.test(path.basename(p)));
  patches = {
    good: make('good', (d) => { rm(d, EXPECTED_EXTRACTED); readme(d, POINTER); }),
    six: make('six', (d) => { rm(d, EXPECTED_EXTRACTED.slice(0, 6)); readme(d, POINTER); }),
    extraDel: make('extraDel', (d) => { rm(d, [...EXPECTED_EXTRACTED, tracked[0]]); readme(d, POINTER); }),
    extraAdd: make('extraAdd', (d) => { rm(d, EXPECTED_EXTRACTED); readme(d, POINTER); fs.writeFileSync(path.join(d, 'stray.txt'), 'x\n'); }),
    noPharos: make('noPharos', (d) => { rm(d, EXPECTED_EXTRACTED); readme(d, 'This tooling moved. See door reader-stack.\n'); }),
    noDoor: make('noDoor', (d) => { rm(d, EXPECTED_EXTRACTED); readme(d, 'This tooling moved to the pharos repo.\n'); }),
    noReadme: make('noReadme', (d) => { rm(d, EXPECTED_EXTRACTED); }),
    extraMod: make('extraMod', (d) => { rm(d, EXPECTED_EXTRACTED); readme(d, POINTER); fs.appendFileSync(path.join(d, tracked[1]), '\n'); }),
  };
  // a patch that cannot apply: corrupt one context/removed line
  const g = fs.readFileSync(patches.good, 'utf8').replace(/^-(.+)$/m, (m, x) => `-${x}ZZ`);
  patches.broken = path.join(work, 'broken.patch'); fs.writeFileSync(patches.broken, g);
  return patches;
}
const run = (p, extra = {}) => checkPatch({ patch: p, source: baseDir, ...extra });
const failedNames = (r) => r.checks.filter((c) => !c.ok).map((c) => c.name);

test('I8 checker: a correct patch passes', () => {
  const r = run(build().good);
  assert.ok(r.pass, JSON.stringify(r.checks.filter((c) => !c.ok)));
});
test('I8 checker: removing only six of seven files FAILS on "exactly the extracted files"', () => {
  const r = run(build().six); assert.ok(!r.pass); assert.ok(failedNames(r).some((n) => /exactly the extracted/.test(n)));
});
test('I8 checker: removing an extra file FAILS on "exactly the extracted files"', () => {
  const r = run(build().extraDel); assert.ok(!r.pass); assert.ok(failedNames(r).some((n) => /exactly the extracted/.test(n)));
});
test('I8 checker: an added stray file FAILS on "nothing else changed"', () => {
  const r = run(build().extraAdd); assert.ok(!r.pass); assert.ok(failedNames(r).some((n) => /nothing else/.test(n)));
});
test('I8 checker: a modified non-README file FAILS on "nothing else changed"', () => {
  const r = run(build().extraMod); assert.ok(!r.pass); assert.ok(failedNames(r).some((n) => /nothing else/.test(n)));
});
test('I8 checker: README without pharos FAILS', () => {
  const r = run(build().noPharos); assert.ok(!r.pass); assert.ok(failedNames(r).some((n) => /names pharos/.test(n)));
});
test('I8 checker: README without the door name FAILS', () => {
  const r = run(build().noDoor); assert.ok(!r.pass); assert.ok(failedNames(r).some((n) => /names the door/.test(n)));
});
test('I8 checker: no README at all FAILS', () => {
  const r = run(build().noReadme); assert.ok(!r.pass); assert.ok(failedNames(r).some((n) => /pointer README is added/.test(n)));
});
test('I8 checker: a patch that does not apply FAILS on "applies cleanly"', () => {
  const r = run(build().broken); assert.ok(!r.pass); assert.ok(failedNames(r).some((n) => /applies cleanly/.test(n)));
});
test('I8 checker: a correct patch also passes against a FRESH clone of the public khora main (network path)', () => {
  const r = checkPatch({ patch: build().good });
  console.log(`# I8 fresh clone base=${r.baseSha} advisory dangling refs=${r.danglingRefs.length}`);
  for (const d of r.danglingRefs.slice(0, 20)) console.log(`#   ${d}`);
  assert.ok(r.pass, JSON.stringify(r.checks.filter((c) => !c.ok)));
});
test('I8 checker: CLI exits 0 for the good patch and 1 for a bad one', () => {
  const s = path.join(ROOT, 'test', 'install', 'b_khora_patch_check.mjs');
  const a = spawnSync(process.execPath, [s, build().good, '--source', baseDir], { encoding: 'utf8' });
  const b = spawnSync(process.execPath, [s, build().six, '--source', baseDir], { encoding: 'utf8' });
  assert.equal(a.status, 0, a.stdout + a.stderr); assert.equal(b.status, 1, b.stdout + b.stderr);
  const u = spawnSync(process.execPath, [s], { encoding: 'utf8' }); assert.equal(u.status, 2);
});

// ---------- the real prepared patch ----------
function findPatch() {
  if (process.env.PHAROS_KHORA_PATCH) return process.env.PHAROS_KHORA_PATCH;
  const d = path.join(ROOT, 'doors', 'reader-stack', 'patches');
  if (fs.existsSync(d)) { const f = fs.readdirSync(d).find((x) => /\.(patch|diff)$/.test(x)); if (f) return path.join(d, f); }
  return null;
}
test('I8: the prepared khora patch applies to a fresh clone of khora main, removes exactly the extracted files, and the pointer README names pharos and the door', () => {
  const p = findPatch();
  assert.ok(p, 'no prepared patch found (set PHAROS_KHORA_PATCH, or put one at doors/reader-stack/patches/*.patch)');
  const r = checkPatch({ patch: p });
  console.log(`# I8 real patch ${path.basename(p)} base=${r.baseSha} dangling refs (advisory)=${r.danglingRefs.length}`);
  for (const c of r.checks) console.log(`#   ${c.ok ? 'PASS' : 'FAIL'} ${c.name} ${c.detail}`);
  for (const d of r.danglingRefs.slice(0, 20)) console.log(`#   dangling: ${d}`);
  assert.ok(r.pass, JSON.stringify(r.checks.filter((c) => !c.ok)));
});
