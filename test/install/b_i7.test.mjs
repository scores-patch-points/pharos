// I7 provenance (test author B, black box). PREREG: every file under doors/reader-stack/upstream/ is byte-identical to the
// stated khora main commit (fetched read-only with gh). Fail conditions are not softened.
// Run: node --test test/install/b_i7.test.mjs     (needs `gh` authenticated; read-only API calls only)
import nodeTest from 'node:test';
// SUPERSEDED by PREREG-A1.md ("I7 is replaced"); replaced by c_I7.test.mjs. Every case is reported as skipped, none was edited. See TEST_CHANGES.md item 8.
const test = (name, ...rest) => nodeTest.skip(`${name} [superseded by c_I7]`, ...rest);
import assert from 'node:assert/strict';
import {
  ROOT, KHORA_REPO, EXPECTED_EXTRACTED, findSource, parseSource, upstreamDirFor, compareUpstream,
  fetchUpstream, gh, mkScratch, copyTree, walk, fs, path, sha256,
} from './b_lib.mjs';

const srcFile = findSource();
let source = null, upDir = null;
if (srcFile) { try { source = parseSource(srcFile); upDir = upstreamDirFor(srcFile); } catch (e) { source = { error: e.message }; } }

test('I7: SOURCE.json exists and names a 40-hex commit and a file list', () => {
  assert.ok(srcFile, 'no SOURCE.json at doors/reader-stack/upstream/SOURCE.json (or doors/reader-stack/SOURCE.json)');
  assert.ok(!source.error, `SOURCE.json unparsable: ${source.error}`);
  assert.match(String(source.sha), /^[0-9a-f]{40}$/, 'commit sha missing or not 40 hex (accepted keys: sha, commit, upstream_sha, khora_sha, provenance.upstream_sha)');
  assert.ok(source.files.length > 0, 'no files listed (accepted: files[] of path or {path,sha256}, or provenance.files)');
});

test('I7: listed files are exactly the seven extracted khora tools', () => {
  assert.ok(source && source.sha, 'SOURCE.json not usable');
  const got = source.files.map((f) => f.path).sort();
  assert.deepEqual(got, [...EXPECTED_EXTRACTED].sort());
});

test('I7: the stated commit is on khora main (is main, or an ancestor of main)', () => {
  assert.ok(source && source.sha, 'SOURCE.json not usable');
  const st = gh(['api', `repos/${KHORA_REPO}/compare/${source.sha}...main`, '--jq', '.status']).toString().trim();
  const main = gh(['api', `repos/${KHORA_REPO}/commits/main`, '--jq', '.sha']).toString().trim();
  console.log(`# I7 info: stated=${source.sha} main_now=${main} compare_status=${st}`);
  assert.ok(['identical', 'ahead'].includes(st), `commit is not on main (compare status ${st})`);
});

test('I7: every file under upstream/ is byte-identical to the stated commit; manifest sha256 matches upstream bytes', () => {
  assert.ok(source && source.sha, 'SOURCE.json not usable');
  const present = fs.existsSync(upDir) ? walk(upDir).filter((r) => r !== 'SOURCE.json') : [];
  if (present.length === 0) {
    // hashes-only layout (DESIGN section 6 option b): do NOT call this a byte-identity pass.
    const probs = compareUpstream(upDir, source).filter((p) => !p.includes('missing from tree'));
    console.log(`# I7 mode=hashes-only (no files in tree); manifest-hash problems: ${probs.length}`);
    assert.fail(`upstream/ holds no files: byte-identity of tree files is unverifiable (hashes-only mode). Manifest-vs-upstream problems: ${probs.length}. Owner must choose in-tree or re-stamp I7.`);
  }
  const problems = compareUpstream(upDir, source);
  assert.deepEqual(problems, []);
});

// ---- positive controls: the comparator must catch each corruption (run on COPIES in scratch) ----
test('I7 control: comparator detects a flipped byte, an appended newline, a deleted file and a stray file', () => {
  // use a synthetic copy built from upstream bytes themselves so this control runs even before the door exists
  const sha = (source && source.sha) || gh(['api', `repos/${KHORA_REPO}/commits/main`, '--jq', '.sha']).toString().trim();
  const files = EXPECTED_EXTRACTED.map((p) => ({ path: p, sha256: sha256(fetchUpstream(sha, p)) }));
  const src = { sha, files };
  const base = mkScratch('i7ctl');
  const make = (name) => {
    const d = path.join(base, name);
    for (const f of files) { const p = path.join(d, f.path); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, fetchUpstream(sha, f.path)); }
    return d;
  };
  assert.deepEqual(compareUpstream(make('clean'), src), [], 'negative control: pristine copy must report no problems');
  const flip = make('flip'); { const p = path.join(flip, 'install.sh'); const b = fs.readFileSync(p); b[Math.floor(b.length / 2)] ^= 1; fs.writeFileSync(p, b); }
  const nl = make('nl'); fs.appendFileSync(path.join(nl, 'local-up.sh'), '\n');
  const del = make('del'); fs.rmSync(path.join(del, 'integrations/curl.sh'));
  const stray = make('stray'); fs.writeFileSync(path.join(stray, 'extra.sh'), 'x');
  const man = { sha, files: files.map((f, i) => (i === 0 ? { ...f, sha256: '0'.repeat(64) } : f)) };
  for (const [n, d, s] of [['flip', flip, src], ['newline', nl, src], ['delete', del, src], ['stray', stray, src], ['manifest-hash', make('man'), man]]) {
    assert.ok(compareUpstream(d, s).length > 0, `control ${n} was NOT detected`);
  }
});
