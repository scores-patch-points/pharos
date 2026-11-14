// README checks (A1): quoted paths, correct verify order, a documented repair path, --help lists the contract commands,
// pharos.json stores no absolute home path. The README commands are run LITERALLY (shell-style split) with <pharos> = this tree
// (its path contains a space) and <dir> = a sandbox directory whose name contains a space. Execution parts need PHAROS_A_RUN=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  skip, ROOT, mk, exec, jparse, hashTree, diffTrees, sha256, show, shellSplit, read, FI, REAL_HOME, MARK_BEGIN, fs, path,
} from './c_lib.mjs';
import { PRIVATE_NAMES } from './b_lib.mjs';

const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const section = (title) => { const m = new RegExp(`^## ${title}\\s*$`, 'm').exec(README); if (!m) return ''; const rest = README.slice(m.index + m[0].length); const n = /^## /m.exec(rest); return n ? rest.slice(0, n.index) : rest; };
const fences = (text) => [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
const SPACE_DIR = 'target with space';

test('README: every <pharos> and <dir> inside a fenced command is inside double quotes', () => {
  const bad = [];
  for (const block of fences(README)) for (const line of block.split('\n')) {
    const code = line.split(/\s#\s/)[0];
    for (const m of code.matchAll(/<(pharos|dir)>/g)) {
      const q = (code.slice(0, m.index).match(/(?<!\\)"/g) || []).length;
      if (q % 2 === 0) bad.push(`${line.trim().slice(0, 100)}  (<${m[1]}> is not inside double quotes)`);
    }
  }
  assert.deepEqual(bad, [], show(bad));
});

test('README: the Do-this block has exactly three commands: plan, apply, verify, in that order, all with --target "<dir>"', () => {
  const block = fences(section('Do this'))[0]; assert.ok(block, 'no fenced block under "Do this"');
  const cmds = block.split('\n').filter((l) => l.trim());
  assert.equal(cmds.length, 3);
  assert.ok(/ install all /.test(cmds[0]) && !/--apply/.test(cmds[0]), 'first is the plan');
  assert.ok(/ install all /.test(cmds[1]) && /--apply/.test(cmds[1]), 'second is the apply');
  assert.ok(/ verify all /.test(cmds[2]), 'third is verify');
  for (const c of cmds) assert.ok(/--target "<dir>"/.test(c), `not --target "<dir>": ${c}`);
});

test('README: no "safe word", no private tool names, no personal path', () => {
  const v = [];
  if (/safe word/i.test(README)) v.push('mentions a safe word');
  for (const n of PRIVATE_NAMES) if (new RegExp(`(?<![A-Za-z0-9_])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`, 'i').test(README)) v.push(`names ${n}`);
  if (README.includes('/Us' + 'ers/')) v.push('contains a home-directory path');
  assert.deepEqual(v, [], show(v));
});

test('README: the Doors table lists exactly the doors that `doors` prints', { skip }, async () => {
  const run = await mk('Rd', { fixture: 'bare' });
  try {
    const res = await exec(run, ['doors']); assert.equal(res.code, 0);
    const j = jparse(res); const ids = (j?.doors || j || []).map((d) => d.id || d.door || d).sort();
    const tbl = [...section('Doors').matchAll(/^\|\s*`([a-z-]+)`\s*\|/gm)].map((m) => m[1]).sort();
    assert.deepEqual(tbl, ids);
  } finally { run.close(); }
});

test('README: --help, -h and help print on stdout, exit 0, and list detect, install --plan, --apply, verify, status, undo-door, doors', { skip }, async () => {
  const run = await mk('Rh', { fixture: 'bare' });
  try {
    const v = [];
    for (const a of ['--help', '-h', 'help']) {
      const r = await exec(run, [a]);
      if (r.code !== 0) v.push(`${a}: exit ${r.code}`);
      if (!r.stdout.trim()) v.push(`${a}: nothing on stdout`);
      for (const w of ['detect', 'install', '--plan', '--apply', 'verify', 'status', 'undo-door', 'doors']) if (!r.stdout.includes(w)) v.push(`${a}: stdout does not mention ${w}`);
    }
    assert.deepEqual(v, [], show(v));
  } finally { run.close(); }
});

test('README: each verb listed under "Other verbs" is accepted by the CLI (usage exit 2 would mean the README lies)', { skip }, async () => {
  const run = await mk('Rv', { fixture: 'populated' });
  try {
    const block = fences(section('Other verbs'))[0]; const v = [];
    for (const line of block.split('\n').filter((l) => l.trim())) {
      const verb = line.trim().split(/\s+/)[0]; const t = line.includes('install') ? ['install', 'all', '--plan'] : [verb, 'all'];
      const r = await exec(run, [...t, '--target', run.target]);
      if (r.code === 2) v.push(`${verb}: usage error (exit 2): ${r.out.slice(0, 120).replace(/\n/g, ' ')}`);
    }
    assert.deepEqual(v, [], show(v));
  } finally { run.close(); }
});

// ---- literal execution of the Do-this commands
async function readmeRun(run, targetDir) {
  const block = fences(section('Do this'))[0].split('\n').filter((l) => l.trim());
  const out = [];
  for (const raw of block) {
    const line = raw.split('<pharos>').join(ROOT).split('<dir>').join(targetDir);
    const argv = shellSplit(line); assert.equal(argv[0], 'node', line);
    const before = hashTree(run.jail);
    const res = await run.node(argv.slice(1));
    out.push({ cmd: raw, res, before, after: hashTree(run.jail) });
  }
  return out;
}
test('README: the Do-this commands, run literally with spaces in <pharos> and <dir>: plan changes nothing, apply exits 0, verify exits 0 with the order the README states', { skip }, async () => {
  const run = await mk('Rl', { fixture: 'bare', stateMode: 'default' });
  try {
    const target = path.join(run.jail, SPACE_DIR); fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'notes.txt'), 'x\n');
    assert.ok(ROOT.includes(' ') || process.env.PHAROS_ROOT, 'this tree path is expected to contain a space');
    const [plan, apply, ver] = await readmeRun(run, target); const v = [];
    if (plan.res.code !== 0) v.push(`plan exit ${plan.res.code}: ${plan.res.out.slice(0, 200)}`);
    if (diffTrees(plan.before, plan.after).length) v.push('the plan changed the tree');
    if (apply.res.code !== 0) v.push(`apply exit ${apply.res.code}: ${apply.res.out.slice(0, 300).replace(/\n/g, ' ')}`);
    if (ver.res.code !== 0) v.push(`verify exit ${ver.res.code}: ${ver.res.out.slice(0, 300).replace(/\n/g, ' ')}`);
    const stated = /expect exit 0 and: verified: ([a-z, -]+?)`?\s*$/m.exec(section('Do this').split('\n').find((l) => /verify all/.test(l)) || '') || /verified: ([a-z-]+(?:, [a-z-]+)*)/.exec(section('Do this'));
    const statedList = stated ? stated[1].trim() : null;
    if (!statedList) v.push('the README does not state the verified: list');
    const vj = jparse(ver.res);
    if (statedList && vj && vj.verified.join(', ') !== statedList) v.push(`the README says "verified: ${statedList}" but verify reports ${vj.verified.join(', ')}`);
    const txt = await run.node([...(shellSplit(ver.cmd.split('<pharos>').join(ROOT).split('<dir>').join(target)).slice(1)), '--text']);
    if (statedList && !txt.stdout.includes(`verified: ${statedList}`)) v.push(`--text prints ${JSON.stringify(txt.stdout.trim())}, not "verified: ${statedList}"`);
    const rd = (f) => read(path.join(target, f))?.toString();
    if (!rd('AGENTS.md')?.includes(MARK_BEGIN)) v.push('AGENTS.md has no pharos block after the README apply');
    assert.deepEqual(v, [], show(v));
  } finally { run.close(); }
});

test('README: exit codes in "Rules for agents": 3 for a .. target, 2 for a bad flag, 1 for a failing verify', { skip }, async () => {
  const run = await mk('Rx', { fixture: 'populated' });
  try {
    const v = [];
    const dd = await exec(run, ['install', 'all', '--target', run.target + '/../target', '--apply']);
    if (dd.code !== 3) v.push(`.. target: exit ${dd.code}, README says 3`);
    const bf = await exec(run, ['install', 'all', '--target', run.target, '--no-such-flag']);
    if (bf.code !== 2) v.push(`bad flag: exit ${bf.code}, README says 2`);
    const vf = await exec(run, ['verify', 'all', '--target', run.target]);
    if (vf.code !== 1) v.push(`verify before install: exit ${vf.code}, README says 1 (a verify failed)`);
    assert.deepEqual(v, [], show(v));
  } finally { run.close(); }
});

test('README Repair: every status the CLI prints appears in the Repair table, and LOCKED is documented', () => {
  const rep = section('Repair'); const v = [];
  for (const s of ['not-installed', 'installed', 'partial', 'drifted', 'journal-invalid']) if (!rep.includes('`' + s + '`')) v.push(`status ${s} is not in the Repair section`);
  if (!/LOCKED/.test(rep)) v.push('LOCKED is not documented');
  if (!/undo-door/.test(rep)) v.push('Repair never names undo-door');
  assert.deepEqual(v, [], show(v));
});

test('README Repair: following the table for a killed run works (status partial, then the documented undo-door, then install again verifies); the file descriptions match the README words', { skip, timeout: 300000 }, async () => {
  const v = []; const words = new Set();
  const probe = await mk('Rp0', { fixture: 'populated', stateMode: 'default' });
  let N; try { const log = path.join(probe.dir, 'fi.json'); await exec(probe, ['install', 'all', '--target', probe.target, '--apply'], { preload: [FI], env: { FI_MODE: 'count', FI_LOG: log } }); N = JSON.parse(fs.readFileSync(log, 'utf8')).count; } finally { probe.close(); }
  let partials = 0;
  for (let k = 1; k <= N; k++) {
    const run = await mk('Rp', { fixture: 'populated', stateMode: 'default' });
    try {
      const before = hashTree(run.jail);
      await exec(run, ['install', 'all', '--target', run.target, '--apply'], { preload: [FI], env: { FI_MODE: 'kill', FI_K: String(k), FI_LOG: path.join(run.dir, 'fi.json') } });
      const st = jparse(await exec(run, ['status', 'all', '--target', run.target]));
      const parts = (st?.doors || []).filter((d) => d.status === 'partial');
      if (!parts.length) continue;
      partials++;
      for (const d of parts) for (const x of d.interrupted || []) words.add(String(x.now));
      const u = await exec(run, ['undo-door', 'all', '--target', run.target]);
      const d1 = diffTrees(before, hashTree(run.jail));
      if (u.code !== 0 || d1.length) v.push(`k=${k}: the documented undo-door did not restore (exit ${u.code}, ${d1.length} differences)`);
      const i = await exec(run, ['install', 'all', '--target', run.target, '--apply']);
      const ver = await exec(run, ['verify', 'all', '--target', run.target]);
      if (i.code !== 0 || ver.code !== 0) v.push(`k=${k}: install again after the undo: exit ${i.code}, verify ${ver.code}`);
    } finally { run.close(); }
  }
  assert.ok(partials > 0, 'no kill produced a partial status (harness inert)');
  const promised = ['original intact', 'new content in place'];
  const off = [...words].filter((w) => !promised.some((p) => w.startsWith(p)));
  if (off.length) v.push(`the README promises the file descriptions ${JSON.stringify(promised)} but status printed ${JSON.stringify([...words])} (not promised: ${JSON.stringify(off)})`);
  assert.deepEqual(v.slice(0, 15), [], show(v.slice(0, 15)));
});

test('README: pharos.json and holon.json store no absolute path and no home path; lib resolved against the target is this library', { skip }, async () => {
  const run = await mk('Rj', { fixture: 'bare', stateMode: 'default' });
  try {
    const target = path.join(run.jail, SPACE_DIR); fs.mkdirSync(target);
    const r = await exec(run, ['install', 'all', '--target', target, '--apply']); assert.equal(r.code, 0, r.out.slice(0, 200));
    const v = [];
    for (const f of ['pharos.json', 'holon.json']) {
      const t = read(path.join(target, f))?.toString() ?? '';
      for (const bad of [run.home, REAL_HOME, run.jail, '/Us' + 'ers/', ROOT]) if (t.includes(bad)) v.push(`${f} contains ${bad === ROOT ? 'the library path' : bad}`);
      for (const m of t.matchAll(/"(\/[^"]*)"/g)) v.push(`${f} holds an absolute path string ${m[1]}`);
    }
    const pj = JSON.parse(read(path.join(target, 'pharos.json')).toString());
    if (path.isAbsolute(pj.lib)) v.push('pharos.json lib is absolute');
    const lib = path.resolve(target, pj.lib);
    if (lib !== path.join(ROOT, 'lib', 'pharos.mjs')) v.push(`lib resolves to ${lib}, not this library`);
    else if (sha256(fs.readFileSync(lib)) !== pj.sha256) v.push('pharos.json sha256 is not the sha256 of the library file');
    assert.deepEqual(v, [], show(v));
  } finally { run.close(); }
});
