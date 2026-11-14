// I6 public-readiness scan (test author B, black box). All planting happens in COPIES under the scratch dir.
// Two scanners are exercised:
//   1. an independent oracle in b_lib.mjs (own patterns; personal strings derived at run time) -> the verdict on the release tree
//   2. the shipped tools/public-scan.mjs as a black box. ASSUMED interface: `node tools/public-scan.mjs <dir>`,
//      exit 0 when clean, non-zero when it finds anything, output names each offending file. Mutations M8/M9 live here.
// Run: node --test test/install/b_i6.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  ROOT, J, mkScratch, copyTree, scanTree, PRIVATE_NAMES, personalStrings, fs, path, spawnSync, walk,
} from './b_lib.mjs';

const rnd = (n, al = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') =>
  Array.from(crypto.randomBytes(n), (b) => al[b % al.length]).join('');

// control name -> [content, oracle rule prefix]
function controls() {
  const c = {};
  c['ctl_secret_gh.txt'] = [`export X=${J('gh', 'p_')}${rnd(36)}\n`, 'secret-github-token'];
  c['ctl_secret_pat.txt'] = [`${J('github_', 'pat_')}${rnd(40)}\n`, 'secret-github-pat'];
  c['ctl_secret_pem.txt'] = [`${J('-----BEGIN ', 'OPENSSH ', 'PRIVATE KEY', '-----')}\n${rnd(40)}\n`, 'secret-private-key'];
  c['ctl_secret_aws.txt'] = [`id ${J('AK', 'IA')}${rnd(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')}\n`, 'secret-aws-key'];
  c['ctl_secret_sk.txt'] = [`key: ${J('s', 'k-')}${rnd(32)}\n`, 'secret-sk-key'];
  c['ctl_secret_slack.txt'] = [`${J('xo', 'xb-')}${rnd(12, '0123456789')}-${rnd(24)}\n`, 'secret-slack'];
  c['ctl_secret_google.txt'] = [`${J('AI', 'za')}${rnd(35)}\n`, 'secret-google'];
  c['ctl_secret_jwt.txt'] = [`${J('ey', 'J')}${rnd(20)}.${J('ey', 'J')}${rnd(20)}.${rnd(20)}\n`, 'secret-jwt'];
  c['ctl_secret_assign.txt'] = [`api_key = "${rnd(28)}"\n`, 'secret-assignment'];
  c['ctl_users_path.md'] = [`see ${J('/Us', 'ers/')}x/project/file.txt\n`, 'users-path'];
  c['.ctl_dotfile_users'] = [`path=${J('/Us', 'ers/')}x/.config\n`, 'users-path'];              // M8: dotfile
  c['sub/.hidden/ctl_nested_users.sh'] = [`cd ${J('/Us', 'ers/')}x\n`, 'users-path'];
  PRIVATE_NAMES.forEach((n, i) => { c[`ctl_private_${i}.txt`] = [`install the ${n} tool\n`, `private-name:${n}`]; });
  c['ctl_email.txt'] = [`contact: some.person${rnd(4).toLowerCase()}@corp-sample.test\n`, 'email'];
  c['ctl_host_url.txt'] = [`curl ${J('https:', '//')}internal-${rnd(5).toLowerCase()}.corp-sample.test/x\n`, 'host'];
  c['ctl_ip.txt'] = [`server 203.0.113.${77}\n`, 'ip'];
  for (const [k, v] of personalStrings()) if (k === 'personal-email') c['ctl_real_email.txt'] = [`mail ${v}\n`, 'email'];
  return c;
}

function plant(dir, ctl) {
  for (const [rel, [content]] of Object.entries(ctl)) {
    const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content);
  }
}

function shipped(dir) {
  const s = path.join(ROOT, 'tools', 'public-scan.mjs');
  if (!fs.existsSync(s)) return { missing: true };
  const r = spawnSync(process.execPath, [s, dir], { encoding: 'utf8', timeout: 120000 });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

// ---------------- verdict on the release tree ----------------
test('I6: oracle scan of a COPY of the release tree finds 0 hits (secrets, personal path, email, private names, hosts/IPs)', () => {
  const base = mkScratch('i6clean'); const copy = path.join(base, 'tree'); copyTree(ROOT, copy);
  const { hits, scanned, binary } = scanTree(copy);
  const byRule = {}; for (const h of hits) byRule[h.rule] = (byRule[h.rule] || 0) + 1;
  console.log(`# I6 oracle: files scanned=${scanned} binary-skipped=${binary} hits=${hits.length} byRule=${JSON.stringify(byRule)}`);
  for (const h of hits.slice(0, 60)) console.log(`#   ${h.rule}  ${h.file}:${h.line}`);
  assert.equal(hits.length, 0, `${hits.length} hits (first: ${hits[0] && `${hits[0].rule} ${hits[0].file}:${hits[0].line}`})`);
});

test('I6: allowlist files are small and contain only names/hosts (reported for the owner to read)', () => {
  const dir = path.join(ROOT, 'allowlists');
  for (const f of ['public-names.txt', 'hosts.txt']) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) { console.log(`# I6 allowlist ${f}: absent (every private name / host hit then stands)`); continue; }
    const lines = fs.readFileSync(p, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
    console.log(`# I6 allowlist ${f}: ${lines.length} entries: ${lines.join(' | ')}`);
    assert.ok(lines.length <= 60, `${f} has ${lines.length} entries; an allowlist this large is a bypass`);
    // an allowlist must never contain secrets, emails or personal paths
    assert.equal(scanTree(path.dirname(p), { skipFiles: new Set() }).hits.filter((h) => !h.rule.startsWith('private-name') && h.rule !== 'host' && h.rule !== 'ip').length, 0);
  }
});

// ---------------- positive controls, oracle ----------------
test('I6 control (oracle): every planted item is detected in the COPY, with the right rule, in the right file', () => {
  const base = mkScratch('i6ctl'); const copy = path.join(base, 'tree'); copyTree(ROOT, copy);
  const before = scanTree(copy).hits.length;
  const ctl = controls(); plant(copy, ctl);
  const { hits } = scanTree(copy);
  const missed = [];
  for (const [rel, [, rule]] of Object.entries(ctl)) {
    if (!hits.some((h) => h.file === rel && h.rule === rule)) missed.push(`${rel} (${rule})`);
  }
  console.log(`# I6 oracle controls: planted=${Object.keys(ctl).length} missed=${missed.length} ; hits before=${before} after=${hits.length}`);
  assert.deepEqual(missed, []);
});

test('I6 control (oracle): lookalikes do not hit (translate, slated, example.com mail, /usr paths)', () => {
  const base = mkScratch('i6neg'); const d = path.join(base, 'neg'); fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'neg.txt'), 'translate slated templates\nuser@example.com\n/usr/local/bin and /opt/homebrew\nversion 1.2.3\n');
  const r = scanTree(d, { personal: [] });
  assert.deepEqual(r.hits, []);
});

// ---------------- shipped scanner, black box ----------------
test('I6 shipped scanner: exits 0 on a clean synthetic tree', () => {
  const s = shipped('.');
  assert.ok(!s.missing, 'tools/public-scan.mjs does not exist');
  const base = mkScratch('i6synth'); const d = path.join(base, 'clean'); fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'a.txt'), 'hello world\n');
  const r = shipped(d);
  assert.equal(r.status, 0, `clean tree gave exit ${r.status} (interface mismatch or false positive). output: ${r.out.slice(0, 300)}`);
});

test('I6 shipped scanner: detects every planted control (names the file, exits non-zero) in a COPY of the tree', () => {
  assert.ok(!shipped('.').missing, 'tools/public-scan.mjs does not exist');
  const ctl = controls(); const missed = [];
  for (const [rel, [content, rule]] of Object.entries(ctl)) {
    // one control per fresh tiny tree so a detection cannot be credited to another control
    const base = mkScratch('i6one'); const d = path.join(base, 't'); fs.mkdirSync(d);
    plant(d, { [rel]: [content] });
    const r = shipped(d);
    const named = r.out.includes(path.basename(rel));
    if (!(r.status !== 0 && named)) missed.push(`${rel} (${rule}) exit=${r.status} named=${named}`);
  }
  console.log(`# I6 shipped scanner controls: planted=${Object.keys(ctl).length} missed=${missed.length}`);
  for (const m of missed) console.log(`#   MISSED ${m}`);
  assert.deepEqual(missed, []);
});

test('I6 shipped scanner: also detects controls planted into a full COPY of the release tree (exit non-zero, names the planted file)', () => {
  assert.ok(!shipped('.').missing, 'tools/public-scan.mjs does not exist');
  const base = mkScratch('i6full'); const copy = path.join(base, 'tree'); copyTree(ROOT, copy);
  plant(copy, { 'ctl_secret_gh.txt': controls()['ctl_secret_gh.txt'] });
  const r = shipped(copy);
  assert.notEqual(r.status, 0);
  assert.ok(r.out.includes('ctl_secret_gh.txt'));
});

test('I6 shipped scanner: on a COPY of the release tree reports 0 hits (exit 0)', () => {
  assert.ok(!shipped('.').missing, 'tools/public-scan.mjs does not exist');
  const base = mkScratch('i6rel'); const copy = path.join(base, 'tree'); copyTree(ROOT, copy);
  const r = shipped(copy);
  assert.equal(r.status, 0, `exit ${r.status}: ${r.out.slice(0, 400)}`);
});
