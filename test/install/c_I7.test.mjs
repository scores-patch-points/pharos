// I7 (A1, replaces the byte-identical-copies reading): hash verification of the fetched upstream, no upstream copies in the tree.
// Tree checks and the fetch check run without PHAROS_A_RUN (read-only gh api, public repo). Door-level checks need PHAROS_A_RUN=1
// and use a `gh` shim that serves the real bytes (fetched once by this test with the real gh, cached in scratch).
import test from 'node:test';
import assert from 'node:assert/strict';
import { skip, ROOT, mk, exec, T, jparse, hashTree, diffTrees, sha256, show, mkScratch, SCRATCH, GH_SHIM, fs, path, crypto, spawnSync } from './c_lib.mjs';

const SRC = path.join(ROOT, 'doors', 'reader-stack', 'upstream', 'SOURCE.json');
const SEVEN = ['install.sh', 'setup-proxy.sh', 'local-up.sh', 'integrations/claude-code.sh', 'integrations/curl.sh', 'integrations/ollama.sh', 'claude-code/scripts/run.sh'];
const source = () => JSON.parse(fs.readFileSync(SRC, 'utf8'));

// ---- helpers shared with the controls
const SKIP = new Set(['.git', 'node_modules']);
export function walkFiles(root, rel = '', out = []) {
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walkFiles(root, r, out); } else if (e.isFile()) out.push(r);
  }
  return out;
}
export function findCopies(root, hashes) {
  const set = new Set(hashes); const hits = [];
  for (const rel of walkFiles(root)) { const st = fs.statSync(path.join(root, rel)); if (st.size > 20e6) continue; if (set.has(sha256(fs.readFileSync(path.join(root, rel))))) hits.push(rel); }
  return hits;
}
export function fetchCheck(src, fetchBytes) {
  const bad = [];
  for (const f of src.files) { let b; try { b = fetchBytes(src, f.path); } catch (e) { bad.push(`${f.path}: fetch failed (${String(e.message).slice(0, 80)})`); continue; } if (sha256(b) !== f.sha256) bad.push(`${f.path}: fetched ${sha256(b).slice(0, 12)} != SOURCE.json ${f.sha256.slice(0, 12)}`); }
  return bad;
}
const FIX = path.join(SCRATCH, 'c-khora-fixture');
function realFetch(src, p) {
  const f = path.join(FIX, src.sha, p);
  if (fs.existsSync(f)) return fs.readFileSync(f);
  const r = spawnSync('gh', ['api', `repos/${src.repo}/contents/${p}?ref=${src.sha}`, '-H', 'Accept: application/vnd.github.raw'], { maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`gh api failed: ${String(r.stderr).slice(0, 120)}`);
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, r.stdout);
  return r.stdout;
}

test('I7: SOURCE.json names a 40-hex commit and exactly the seven khora tools with a sha256 each', () => {
  assert.ok(fs.existsSync(SRC), 'doors/reader-stack/upstream/SOURCE.json is missing');
  const s = source();
  assert.match(String(s.sha), /^[0-9a-f]{40}$/);
  assert.equal(s.repo, 'scores-patch-points/khora');
  assert.deepEqual(s.files.map((f) => f.path).sort(), [...SEVEN].sort());
  for (const f of s.files) assert.match(f.sha256, /^[0-9a-f]{64}$/, f.path);
});

test('I7: the shipped tree contains none of the seven upstream files (no byte-identical copy anywhere, nothing in upstream/ but SOURCE.json)', () => {
  const s = source();
  const up = path.join(ROOT, 'doors', 'reader-stack', 'upstream');
  assert.deepEqual(fs.readdirSync(up).sort(), ['SOURCE.json'], 'upstream/ holds more than SOURCE.json');
  const hits = findCopies(ROOT, s.files.map((f) => f.sha256));
  assert.deepEqual(hits, [], `byte-identical copies of upstream files in the tree: ${hits.join(', ')}`);
  for (const p of SEVEN) assert.ok(!fs.existsSync(path.join(up, p)), `${p} exists under upstream/`);
});

test('I7: fetched bytes (read-only gh api at the pinned sha) hash to SOURCE.json for all seven files', () => {
  const bad = fetchCheck(source(), realFetch);
  assert.deepEqual(bad, [], show(bad));
});

test('I7: the pinned commit is on khora main (main itself or an ancestor)', () => {
  const s = source();
  const r = spawnSync('gh', ['api', `repos/${s.repo}/compare/${s.sha}...main`, '--jq', '.status'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(['identical', 'ahead'].includes(r.stdout.trim()), `compare status ${r.stdout.trim()}`);
});

test('I7: THIRD-PARTY.md names khora, its MIT licence and the pinned sha, and carries the licence grant and a copyright line', () => {
  const f = path.join(ROOT, 'THIRD-PARTY.md'); assert.ok(fs.existsSync(f), 'THIRD-PARTY.md missing');
  const t = fs.readFileSync(f, 'utf8'); const s = source(); const v = [];
  if (!/khora/i.test(t)) v.push('does not name khora');
  if (!/\bMIT\b/.test(t)) v.push('does not name the MIT licence');
  if (!t.includes(s.sha)) v.push('does not contain the pinned sha');
  if (!/Permission is hereby granted, free of charge/.test(t)) v.push('does not carry the MIT permission grant');
  if (!/Copyright \(c\) \d{4} \S+/.test(t)) v.push('carries no copyright line');
  if (!/The above copyright notice and this permission notice shall be included/.test(t)) v.push('does not carry the notice-retention sentence');
  assert.deepEqual(v, [], show(v));
});

test('I7 control: the copy detector finds a byte-identical copy planted in a COPY of the tree, and ignores a one-byte-different one', () => {
  const s = source(); const base = mkScratch('i7ctl');
  const d = path.join(base, 'tree'); fs.mkdirSync(path.join(d, 'sub'), { recursive: true });
  const real = realFetch(s, 'install.sh');
  fs.writeFileSync(path.join(d, 'sub', 'renamed-copy.sh'), real);
  const flip = Buffer.from(real); flip[10] ^= 1; fs.writeFileSync(path.join(d, 'near.sh'), flip);
  fs.writeFileSync(path.join(d, 'README.md'), 'x');
  assert.deepEqual(findCopies(d, s.files.map((f) => f.sha256)), ['sub/renamed-copy.sh']);
});

test('I7 control: the fetch check detects a SOURCE.json with one wrong hash and a fetch that returns altered bytes', () => {
  const s = source();
  const wrong = { ...s, files: s.files.map((f, i) => (i === 0 ? { ...f, sha256: '0'.repeat(64) } : f)) };
  assert.equal(fetchCheck(wrong, realFetch).length, 1);
  const altered = (src, p) => { const b = Buffer.from(realFetch(src, p)); if (p === 'local-up.sh') b[b.length >> 1] ^= 1; return b; };
  assert.equal(fetchCheck(s, altered).length, 1);
  assert.equal(fetchCheck(s, () => { throw new Error('offline'); }).length, 7);
});

// ------------------------------------------------------------------ door level
function ghShim(run, mode) {
  const f = path.join(run.shimDir, 'gh');
  fs.writeFileSync(f, `#!/bin/sh\nexec '${process.execPath}' '${GH_SHIM}' "$@"\n`, { mode: 0o755 });
  const log = path.join(run.dir, 'gh_calls.jsonl'); fs.writeFileSync(log, '');
  const s = source(); for (const p of SEVEN) realFetch(s, p);
  return { env: { C_GH_FIX: FIX, C_GH_LOG: log, C_GH_MODE: mode }, calls: () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) };
}
const rsArgs = (run, ...more) => ['install', 'reader-stack', '--target', run.target, ...run.stateArgs(), '--khora-dir', run.khoraDir, '--with-verify-source', ...more];

test('I7 door: plan with --with-verify-source makes zero gh calls and changes nothing (the plan stays pure)', { skip }, async () => {
  const run = await mk('I7p', { fixture: 'populated', stateMode: 'external' });
  try {
    const g = ghShim(run, 'good'); const before = run.snapshot();
    const res = await exec(run, rsArgs(run), { env: g.env });
    assert.equal(res.code, 0, res.out.slice(0, 300));
    assert.equal(g.calls().length, 0, `gh was called in a plan: ${JSON.stringify(g.calls().slice(0, 2))}`);
    assert.deepEqual(diffTrees(before.jail, run.snapshot().jail).map((x) => `${x.kind} ${x.path}`), []);
  } finally { run.close(); }
});

test('I7 door: apply with the real bytes served: exit 0, exactly the seven api calls at the pinned sha, no other tool call, nothing written outside the state dir', { skip }, async () => {
  const run = await mk('I7g', { fixture: 'populated', stateMode: 'external' });
  try {
    const g = ghShim(run, 'good'); const before = run.snapshot(); const s = source(); const v = [];
    const res = await exec(run, rsArgs(run, '--apply'), { env: g.env });
    if (res.code !== 0) v.push(`exit ${res.code}: ${res.out.slice(0, 300).replace(/\n/g, ' ')}`);
    const calls = g.calls(); const api = calls.filter((c) => c.kind === 'api');
    if (calls.some((c) => c.kind === 'refused')) v.push(`the door made a gh call the shim does not understand: ${JSON.stringify(calls.find((c) => c.kind === 'refused').argv)}`);
    const got = [...new Set(api.map((c) => c.path))].sort();
    if (JSON.stringify(got) !== JSON.stringify([...SEVEN].sort())) v.push(`gh api paths ${JSON.stringify(got)} are not the seven files`);
    if (api.some((c) => c.sha !== s.sha || c.repo !== s.repo)) v.push('a gh api call was not at the pinned repo and sha');
    if (res.calls.some((c) => c.cls === 'mutating')) v.push(`mutating tool calls: ${res.calls.filter((c) => c.cls === 'mutating').map((c) => c.tool).join(',')}`);
    const after = run.snapshot(); const d = diffTrees(before.jail, after.jail).filter((x) => !(x.path === 'state' || x.path.startsWith('state/')));
    if (d.length) v.push(`changed outside the state dir: ${d.slice(0, 5).map((x) => `${x.kind} ${x.path}`).join('; ')}`);
    assert.deepEqual(v, [], show(v));
  } finally { run.close(); }
});

for (const [name, mode, why] of [
  ['one flipped byte in install.sh', 'flip:install.sh', 'tampered'],
  ['a flipped byte in the LAST file (claude-code/scripts/run.sh)', 'flip:claude-code/scripts/run.sh', 'tampered'],
  ['a 404 for one file', 'missing:integrations/curl.sh', 'missing'],
  ['an empty body for one file', 'empty:local-up.sh', 'empty'],
  ['every gh call failing', 'fail', 'gh failure'],
]) {
  test(`I7 door: ${name}: apply exits non-zero, the step is failed, and a later plan does not call it satisfied`, { skip }, async () => {
    const run = await mk('I7b', { fixture: 'populated', stateMode: 'external' });
    try {
      const g = ghShim(run, mode); const v = [];
      const res = await exec(run, rsArgs(run, '--apply'), { env: g.env });
      if (res.code === 0) v.push(`apply exited 0 with ${why} upstream bytes`);
      if (/verified|"ok":\s*true/.test(res.out) && res.code === 0) v.push('output claims success');
      const plan = await exec(run, rsArgs(run, '--json'), { env: g.env });
      const txt = plan.stdout;
      const stepIdx = txt.indexOf('verify-source');
      if (stepIdx < 0) v.push('the later plan does not mention the verify-source step at all');
      else if (/satisfied|already|nothing to change/i.test(txt.slice(stepIdx, stepIdx + 300))) v.push(`a later plan calls the failed verify-source step satisfied: ${txt.slice(stepIdx, stepIdx + 160).replace(/\s+/g, ' ')}`);
      // and a later apply with good bytes passes (the failure is not sticky)
      const g2 = { ...g.env, C_GH_MODE: 'good' };
      const ok = await exec(run, rsArgs(run, '--apply'), { env: g2 });
      if (ok.code !== 0) v.push(`a later apply with good bytes exited ${ok.code}: ${ok.out.slice(0, 200).replace(/\n/g, ' ')}`);
      assert.deepEqual(v, [], show(v));
    } finally { run.close(); }
  });
}

test('I7 door: no gh on PATH at all: apply exits non-zero (it cannot verify, so it must not pass)', { skip }, async () => {
  const run = await mk('I7n', { fixture: 'populated', stateMode: 'external' });
  try {
    const res = await exec(run, rsArgs(run, '--apply'));
    assert.notEqual(res.code, 0, res.out.slice(0, 300));
  } finally { run.close(); }
});
