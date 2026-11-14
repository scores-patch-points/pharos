// Test author A: the checks. Each takes a cfg {bin, doorsDir, label} and returns {violations:[], notes:[]}.
// A violation is a FAIL. Notes are measured facts reported but not asserted. The same checks run against
// the real installer (a_I*.test.mjs) and against the reference CLI with planted mutants (validate test).
import fs from 'node:fs';
import path from 'node:path';
import {
  makeRun, hashTree, diffTrees, fmtDiff, region, onlyRegions, listDoorIds, loadManifest, manifestUsesKhoraDir,
  declaredPatterns, covers, declaredTools, probeTools, declaredEnv, flagArgs, manifestFlags, launchctlDb,
  stateChangingCalls, realHomeWitness, FIXTURES, BASELINE_DIR, DEFAULT_BIN, volatileMask, applyMask, normPaths, sha256,
} from './a_rig.mjs';

const LEVELS = ['none', 'writes-files', 'edits-host-config', 'installs-software', 'starts-services'];
const heavy = (lvl) => LEVELS.indexOf(lvl) > 1;
const mk = (cfg, o = {}) => makeRun({ label: cfg.label || 'chk', bin: cfg.bin, doorsDir: cfg.doorsDir, env: cfg.env, ...o });
const doorIds = (cfg) => listDoorIds(cfg.doorsDir);
const manifestsOf = (cfg, door) => (door === 'all' ? doorIds(cfg) : [door]).map((id) => loadManifest(id, cfg.doorsDir));
const baseArgs = (run, cfg, door) => ['--target', run.target, ...run.stateArgs(), ...(door !== 'all' && manifestUsesKhoraDir(loadManifest(door, cfg.doorsDir)) ? ['--khora-dir', run.khoraDir] : [])];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const managed = (d, stateMode) => onlyRegions(d, stateMode === 'external' ? ['home', 'target', 'tmp', 'cwd', 'other'] : ['home', 'target', 'tmp', 'cwd', 'state', 'other']);

function sideEffectViolations(run, before, after, res, tag, v) {
  if (res.denied) v.push(`${tag}: sandbox denied an operation outside the run dir (attempted write/network elsewhere): ${res.out.slice(0, 160).replace(/\n/g, ' ')}`);
  const od = diffTrees(before.outside, after.outside);
  if (od.length) v.push(`${tag}: changed paths OUTSIDE the jail: ${fmtDiff(od)}`);
  if (!eq(before.witness, after.witness)) v.push(`${tag}: real home witness changed`);
}

// ------------------------------------------------------------------ I1
export async function checkDryPurity(cfg, door, { fixture = 'populated', stateMode = 'external' } = {}) {
  const v = []; const notes = [];
  const manifests = manifestsOf(cfg, door);
  const probes = new Set(manifests.flatMap((m) => [...probeTools(m)]));
  const flags = [...new Set(manifests.flatMap(manifestFlags))];
  const kindDetectOnly = door !== 'all' && manifests[0].kind === 'detect-only';
  const variants = [
    ['plan-default', ['install', door], true],
    ['plan-flag', ['install', door, '--plan'], true],
    ['plan-json', ['install', door, '--json'], true],
    ['detect', ['detect', door], false],
    ['verify', ['verify', door], false],
    ['status', ['status', door], false],
  ];
  const run0 = await mk(cfg, { fixture, stateMode }); run0.close();
  if (flags.length) variants.push(['plan-all-heavy-flags', ['install', door, ...flags.flatMap((f) => flagArgs(run0, f))], true]);
  if (kindDetectOnly) variants.push(['detect-only-apply', ['install', door, '--apply'], false]);
  for (const [name, args, wantZero] of variants) {
    const run = await mk(cfg, { fixture, stateMode });
    try {
      const tag = `I1 ${door} ${name}`;
      // flags get re-expanded against this run's paths
      const ex = name === 'plan-all-heavy-flags' ? ['install', door, ...flags.flatMap((f) => flagArgs(run, f))] : args;
      const argv = [...ex.slice(0, 2), ...baseArgs(run, cfg, door), ...ex.slice(2)];
      const before = run.snapshot();
      const res = await run.exec(argv);
      const after = run.snapshot();
      const d = diffTrees(before.jail, after.jail);
      if (d.length) v.push(`${tag}: tree changed (${d.length}): ${fmtDiff(d)}`);
      if (!eq(before.launchctl, after.launchctl)) v.push(`${tag}: launchctl env changed`);
      const sc = stateChangingCalls(res.calls);
      if (sc.length) v.push(`${tag}: state-changing shim calls: ${sc.map((c) => `${c.tool} ${c.argv.join(' ')}`).join(' | ')}`);
      const bad = res.calls.filter((c) => c.cls === 'read' && !probes.has(c.tool));
      if (bad.length) v.push(`${tag}: read-class calls to undeclared tools: ${bad.map((c) => c.tool).join(',')}`);
      if (res.connections.length) v.push(`${tag}: ${res.connections.length} connection attempt(s) to the dead listener(s), ports ${[...new Set(res.connections.map((c) => c.port))].join(',')}`);
      if (res.timedOut) v.push(`${tag}: timed out`);
      if (name === 'detect-only-apply') { if (res.code === 0) v.push(`${tag}: apply of a detect-only door exited 0`); }
      else if (wantZero && res.code !== 0) v.push(`${tag}: plan exited ${res.code} (DESIGN: 0): ${res.out.slice(0, 200).replace(/\n/g, ' ')}`);
      sideEffectViolations(run, before, after, res, tag, v);
      notes.push(`${tag}: exit ${res.code}, ${res.calls.length} shim calls, out ${res.out.length} bytes`);
      if (!res.out.trim()) v.push(`${tag}: produced no output at all`);
    } finally { run.close(); }
  }
  return { violations: v, notes };
}

// ------------------------------------------------------------------ I2
export async function checkApplyDeclared(cfg, door, scenario = {}) {
  const { name = 'default', flags = [], fixture = 'populated', stateMode = 'external', setup, expectExit0 = true, expectChange = true } = scenario;
  const v = []; const notes = [];
  const run = await mk(cfg, { fixture, stateMode });
  try {
    const manifests = manifestsOf(cfg, door);
    const tag = `I2 ${door}/${name}`;
    if (setup) setup(run);
    const pats = manifests.flatMap((m) => declaredPatterns(m, run));
    const tools = new Set(manifests.flatMap((m) => [...declaredTools(m)]));
    const probes = new Set(manifests.flatMap((m) => [...probeTools(m)]));
    const envs = new Set(manifests.flatMap((m) => [...declaredEnv(m)]));
    const net = manifests.flatMap((m) => m.touches?.network || []);
    const before = run.snapshot();
    const res = await run.exec(['install', door, ...baseArgs(run, cfg, door), '--apply', ...flags.flatMap((f) => flagArgs(run, f))]);
    const after = run.snapshot();
    const d = diffTrees(before.jail, after.jail);
    for (const x of d) {
      const abs = path.join(run.jail, x.path);
      const isDir = (x.after || x.before || '').startsWith('D');
      if (!covers(pats, abs, isDir)) v.push(`${tag}: ${region(x.path) === 'state' ? 'STATE-' : ''}UNDECLARED ${x.kind} ${x.path}`);
    }
    for (const c of res.calls) {
      if (c.cls === 'mutating' && !tools.has(c.tool)) v.push(`${tag}: mutating call to undeclared tool: ${c.tool} ${c.argv.join(' ')}`);
      if (c.cls === 'read' && !probes.has(c.tool)) v.push(`${tag}: probe of undeclared tool: ${c.tool} ${c.argv.join(' ')}`);
    }
    const a = before.launchctl || {}; const b = after.launchctl || {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k] && !envs.has(k)) v.push(`${tag}: launchctl env ${k} changed but not declared in touches.env`);
    if (res.connections.length && !net.length) v.push(`${tag}: ${res.connections.length} connection attempt(s) but touches.network is empty`);
    if (expectExit0 && res.code !== 0) v.push(`${tag}: apply exited ${res.code}: ${res.out.slice(0, 200).replace(/\n/g, ' ')}`);
    if (expectChange && res.code === 0 && d.length === 0 && eq(before.launchctl, after.launchctl)) v.push(`${tag}: VACUOUS, apply exit 0 but nothing changed (the check proved nothing)`);
    if (res.timedOut) v.push(`${tag}: timed out`);
    sideEffectViolations(run, before, after, res, tag, v);
    notes.push(`${tag}: exit ${res.code}; ${d.length} changed paths; calls: ${res.calls.map((c) => `${c.tool}(${c.cls})`).join(' ') || 'none'}`);
    return { violations: v, notes, res, changed: d, run };
  } finally { run.close(); }
}

// ------------------------------------------------------------------ I3
export async function checkUndoExact(cfg, door, scenario = {}) {
  const { name = 'default', flags = [], fixture = 'populated', stateMode = 'external', setup, expectChange = true } = scenario;
  const v = []; const notes = [];
  const run = await mk(cfg, { fixture, stateMode });
  try {
    const tag = `I3 ${door}/${name}/${fixture}/${stateMode}`;
    if (setup) setup(run);
    const base = baseArgs(run, cfg, door);
    const s0 = run.snapshot();
    const ap = await run.exec(['install', door, ...base, '--apply', ...flags.flatMap((f) => flagArgs(run, f))]);
    const s1 = run.snapshot();
    if (ap.code !== 0) { v.push(`${tag}: apply exited ${ap.code}: ${ap.out.slice(0, 200).replace(/\n/g, ' ')}`); return { violations: v, notes }; }
    if (expectChange && managed(diffTrees(s0.jail, s1.jail), stateMode).length === 0 && eq(s0.launchctl, s1.launchctl)) v.push(`${tag}: VACUOUS, apply changed nothing outside state`);
    const un = await run.exec(['undo-door', door, ...base]);
    const s2 = run.snapshot();
    if (un.code !== 0) v.push(`${tag}: undo-door exited ${un.code}: ${un.out.slice(0, 200).replace(/\n/g, ' ')}`);
    const d2 = managed(diffTrees(s0.jail, s2.jail), stateMode);
    if (d2.length) v.push(`${tag}: undo not exact, ${d2.length} difference(s): ${fmtDiff(d2)}`);
    if (!eq(s0.launchctl, s2.launchctl)) v.push(`${tag}: launchctl env not restored: before ${JSON.stringify(s0.launchctl)} after ${JSON.stringify(s2.launchctl)}`);
    notes.push(`${tag}: state region after undo: ${fmtDiff(onlyRegions(diffTrees(s0.jail, s2.jail), ['state']), 4) || 'identical'}`);
    // undo twice is a no-op
    const un2 = await run.exec(['undo-door', door, ...base]);
    const s3 = run.snapshot();
    const d3 = diffTrees(s2.jail, s3.jail).filter((x) => stateMode === 'external' ? region(x.path) !== 'state' : true);
    if (d3.length) v.push(`${tag}: second undo changed things: ${fmtDiff(d3)}`);
    if (!eq(s2.launchctl, s3.launchctl)) v.push(`${tag}: second undo changed launchctl env`);
    notes.push(`${tag}: exits apply ${ap.code} undo ${un.code} undo2 ${un2.code}`);
    sideEffectViolations(run, s0, s3, un2, tag, v);
    return { violations: v, notes };
  } finally { run.close(); }
}

export async function checkApplyIdempotent(cfg, door, scenario = {}) {
  const { name = 'default', flags = [], fixture = 'populated', stateMode = 'external', setup } = scenario;
  const v = []; const notes = [];
  const run = await mk(cfg, { fixture, stateMode });
  try {
    const tag = `I3-idem ${door}/${name}/${fixture}/${stateMode}`;
    if (setup) setup(run);
    const base = baseArgs(run, cfg, door);
    const args = ['install', door, ...base, '--apply', ...flags.flatMap((f) => flagArgs(run, f))];
    const a1 = await run.exec(args);
    const s1 = run.snapshot();
    if (a1.code !== 0) { v.push(`${tag}: first apply exited ${a1.code}: ${a1.out.slice(0, 200).replace(/\n/g, ' ')}`); return { violations: v, notes }; }
    const a2 = await run.exec(args);
    const s2 = run.snapshot();
    const d = diffTrees(s1.jail, s2.jail).filter((x) => stateMode === 'external' ? region(x.path) !== 'state' : true);
    if (d.length) v.push(`${tag}: second apply changed ${d.length} path(s): ${fmtDiff(d)}`);
    if (!eq(s1.launchctl, s2.launchctl)) v.push(`${tag}: second apply changed launchctl env`);
    const sd = onlyRegions(diffTrees(s1.jail, s2.jail), ['state']);
    notes.push(`${tag}: second apply exit ${a2.code}; state-dir changes on 2nd apply: ${sd.length}`);
    // a repeated apply must still undo exactly
    const un = await run.exec(['undo-door', door, ...base]);
    const s3 = run.snapshot();
    notes.push(`${tag}: undo after double apply exit ${un.code}`);
    return { violations: v, notes, s1, s2, s3, run0: run };
  } finally { run.close(); }
}

export async function checkSequence(cfg, { mode = 'each', fixture = 'populated', stateMode = 'external' } = {}) {
  const v = []; const notes = [];
  const run = await mk(cfg, { fixture, stateMode });
  try {
    const tag = `I3-seq ${mode}/${fixture}/${stateMode}`;
    const ids = doorIds(cfg).filter((id) => (loadManifest(id, cfg.doorsDir).kind || 'installable') === 'installable');
    const s0 = run.snapshot();
    const exits = [];
    if (mode === 'each') {
      for (const id of ids) {
        const r = await run.exec(['install', id, ...baseArgs(run, cfg, id), '--apply']);
        exits.push(`apply ${id}:${r.code}`);
        if (r.code !== 0) v.push(`${tag}: apply ${id} exited ${r.code}: ${r.out.slice(0, 160).replace(/\n/g, ' ')}`);
      }
    } else {
      const r = await run.exec(['install', 'all', ...baseArgs(run, cfg, 'all'), '--apply']);
      exits.push(`apply all:${r.code}`);
      if (r.code !== 0) v.push(`${tag}: install all --apply exited ${r.code}: ${r.out.slice(0, 160).replace(/\n/g, ' ')}`);
    }
    const s1 = run.snapshot();
    if (managed(diffTrees(s0.jail, s1.jail), stateMode).length === 0) v.push(`${tag}: VACUOUS, nothing changed`);
    if (mode === 'each') {
      for (const id of [...ids].reverse()) {
        const r = await run.exec(['undo-door', id, ...baseArgs(run, cfg, id)]);
        exits.push(`undo ${id}:${r.code}`);
        if (r.code !== 0) v.push(`${tag}: undo-door ${id} exited ${r.code}: ${r.out.slice(0, 160).replace(/\n/g, ' ')}`);
      }
    } else {
      const r = await run.exec(['undo-door', 'all', ...baseArgs(run, cfg, 'all')]);
      exits.push(`undo all:${r.code}`);
      if (r.code !== 0) v.push(`${tag}: undo-door all exited ${r.code}: ${r.out.slice(0, 160).replace(/\n/g, ' ')}`);
    }
    const s2 = run.snapshot();
    const d = managed(diffTrees(s0.jail, s2.jail), stateMode);
    if (d.length) v.push(`${tag}: not restored: ${fmtDiff(d)}`);
    notes.push(`${tag}: ${exits.join(' ')}`);
    return { violations: v, notes };
  } finally { run.close(); }
}

// ------------------------------------------------------------------ I4
// Which flag may legitimately cause which state-changing tool call (DESIGN 2.1). Anything outside is a violation.
const ALLOWED = {
  launchctl: ['--with-launchctl'],
  brew: ['--with-ollama', '--with-node-install'],
  ollama: ['--with-ollama', '--with-models', '--with-services'],
  npm: ['--with-npm-deps', '--with-npm-link'],
  git: ['--with-clone', '--with-update'],
  opencode: ['--with-opencode', '--with-opencode-plugin'],
  curl: ['--with-ollama-vendor-script', '--with-services'],
  claude: ['--with-claude-plugin'],
  sudo: [], docker: [], wget: [], open: [],
};

export async function checkFlagGating(cfg, door) {
  const v = []; const notes = [];
  const m = loadManifest(door, cfg.doorsDir);
  const heavySteps = (m.steps || []).filter((s) => heavy(s.level) && s.flag);
  if (!heavySteps.length) return { violations: [`I4 ${door}: no heavy step with a flag found in door.json`], notes };
  const heavyFlags = [...new Set(heavySteps.map((s) => s.flag))];
  const probes = probeTools(m);
  const runCase = async (name, flags, extra = []) => {
    const run = await mk(cfg, { fixture: 'populated' });
    try {
      const tag = `I4 ${door} ${name}`;
      run.setLaunchctl({ OLLAMA_KEEP_ALIVE: '5m' });
      const before = run.snapshot();
      const cfgBefore = fs.readFileSync(run.opencodeCfg);
      const pats = declaredPatterns(m, run);
      const res = await run.exec(['install', door, ...baseArgs(run, cfg, door), '--apply', ...flags.flatMap((f) => flagArgs(run, f)), ...extra]);
      const after = run.snapshot();
      const sc = stateChangingCalls(res.calls);
      for (const c of sc) {
        const allowed = ALLOWED[c.tool];
        if (!allowed) v.push(`${tag}: state-changing call to unlisted tool ${c.tool}`);
        else if (!flags.some((f) => allowed.includes(f))) v.push(`${tag}: ${c.tool} ${c.argv.join(' ')} ran without any of ${allowed.join('/') || '(never allowed)'}`);
      }
      if (!flags.includes('--with-opencode') && !fs.readFileSync(run.opencodeCfg).equals(cfgBefore)) v.push(`${tag}: opencode config edited without --with-opencode`);
      if (!flags.includes('--with-launchctl') && !eq(before.launchctl, after.launchctl)) v.push(`${tag}: launchctl env changed without --with-launchctl`);
      if (res.connections.length) v.push(`${tag}: ${res.connections.length} connection attempt(s)`);
      for (const x of diffTrees(before.jail, after.jail)) if (!covers(pats, path.join(run.jail, x.path), (x.after || x.before || '').startsWith('D'))) v.push(`${tag}: UNDECLARED change ${x.kind} ${x.path}`);
      sideEffectViolations(run, before, after, res, tag, v);
      notes.push(`${tag}: exit ${res.code}; state-changing calls: ${sc.map((c) => `${c.tool} ${c.argv.join(' ')}`).join(' | ') || 'none'}`);
      return { res, before, after, sc };
    } finally { run.close(); }
  };
  // a) --apply alone does none of the heavy steps and says so
  const a = await runCase('apply-alone', []);
  if (a.sc.length) v.push(`I4 ${door} apply-alone: heavy steps ran (${a.sc.length} state-changing calls)`);
  if (a.res.code !== 0) v.push(`I4 ${door} apply-alone: exited ${a.res.code} (DESIGN: skipped steps are reported, exit 0): ${a.res.out.slice(0, 160).replace(/\n/g, ' ')}`);
  for (const f of heavyFlags.filter((f) => ['--with-ollama', '--with-launchctl', '--with-opencode', '--with-services'].includes(f))) {
    if (!a.res.out.includes(f)) v.push(`I4 ${door} apply-alone: output does not mention ${f} (must say the step was not performed)`);
  }
  if (!/skip|not performed|needs|requires|without|dry|not run/i.test(a.res.out)) v.push(`I4 ${door} apply-alone: output has no wording saying steps were skipped`);
  // b) each heavy flag on its own
  for (const f of heavyFlags) await runCase(`only ${f}`, [f]);
  // c) two flags together do not pull in a third
  if (heavyFlags.includes('--with-launchctl') && heavyFlags.includes('--with-opencode')) await runCase('launchctl+opencode', ['--with-launchctl', '--with-opencode']);
  // d) unknown flag
  const run = await mk(cfg, { fixture: 'populated' });
  try {
    const before = run.snapshot();
    const r = await run.exec(['install', door, ...baseArgs(run, cfg, door), '--apply', '--with-bogus-step']);
    const after = run.snapshot();
    if (r.code === 0) v.push(`I4 ${door} unknown flag --with-bogus-step exited 0 (DESIGN: exit 2)`);
    else notes.push(`I4 ${door} unknown flag exit ${r.code}`);
    const d = diffTrees(before.jail, after.jail);
    if (d.length) v.push(`I4 ${door} unknown flag still changed things: ${fmtDiff(d)}`);
  } finally { run.close(); }
  return { violations: v, notes };
}

export async function checkRefusals(cfg) {
  const v = []; const notes = [];
  const ids = doorIds(cfg);
  const d0 = ids.find((i) => (loadManifest(i, cfg.doorsDir).kind || 'installable') === 'installable' && !heavy(loadManifest(i, cfg.doorsDir).side_effects)) || ids[0];
  const agents = ids.find((i) => JSON.stringify(loadManifest(i, cfg.doorsDir).touches?.files || []).includes('AGENTS.md')) || d0;
  const cases = [];
  const add = (name, fn) => cases.push({ name, fn });
  // unknown door, every verb
  for (const verb of ['install', 'detect', 'verify', 'status', 'undo-door']) {
    for (const apply of verb === 'install' ? [false, true] : [false]) {
      add(`unknown-door ${verb}${apply ? ' --apply' : ''}`, (r) => [verb, 'no-such-door', '--target', r.target, ...r.stateArgs(), ...(apply ? ['--apply'] : [])]);
    }
  }
  add('unknown-door uppercase', (r) => ['install', d0.toUpperCase(), '--target', r.target, ...r.stateArgs(), '--apply']);
  add('unknown-door with slash', (r) => ['install', `${d0}/../x`, '--target', r.target, ...r.stateArgs(), '--apply']);
  // '..' in the target
  for (const apply of [false, true]) {
    const A = apply ? ['--apply'] : [];
    add(`dotdot target same dir${apply ? ' --apply' : ''}`, (r) => ['install', d0, '--target', `${r.target}/../target`, ...r.stateArgs(), ...A]);
    add(`dotdot target up to jail${apply ? ' --apply' : ''}`, (r) => ['install', d0, '--target', `${r.target}/..`, ...r.stateArgs(), ...A]);
    add(`dotdot target to outside${apply ? ' --apply' : ''}`, (r) => ['install', d0, '--target', `${r.target}/../../../outside`, ...r.stateArgs(), ...A]);
    add(`dotdot target relative${apply ? ' --apply' : ''}`, (r) => ['install', d0, '--target', '../target', ...r.stateArgs(), ...A]);
  }
  add('dotdot --state', (r) => ['install', d0, '--target', r.target, '--state', `${r.stateDir}/../state`, '--apply']);
  add('dotdot --state to outside', (r) => ['install', d0, '--target', r.target, '--state', `${r.jail}/../outside/st`, '--apply']);
  const kdoor = ids.find((i) => manifestUsesKhoraDir(loadManifest(i, cfg.doorsDir)));
  if (kdoor) {
    add('dotdot --khora-dir', (r) => ['install', kdoor, '--target', r.target, ...r.stateArgs(), '--khora-dir', `${r.khoraDir}/../khora`, '--apply']);
    add('dotdot --opencode-config', (r) => ['install', kdoor, '--target', r.target, ...r.stateArgs(), '--khora-dir', r.khoraDir, '--with-opencode', '--opencode-config', `${r.home}/.config/../.config/opencode/opencode.json`, '--apply']);
  }
  // symlink escapes
  add('symlink: target is a link to outside', (r) => { fs.rmSync(r.target, { recursive: true }); fs.symlinkSync(r.outside, r.target); return ['install', d0, '--target', r.target, ...r.stateArgs(), '--apply']; });
  add('symlink: target ancestor is a link to outside', (r) => { fs.mkdirSync(path.join(r.outside, 'repo')); fs.symlinkSync(r.outside, path.join(r.jail, 'linkdir')); return ['install', d0, '--target', path.join(r.jail, 'linkdir', 'repo'), ...r.stateArgs(), '--apply']; });
  add('symlink: --state is a link to outside', (r) => { fs.symlinkSync(r.outside, r.stateDir); return ['install', d0, '--target', r.target, '--state', r.stateDir, '--apply']; });
  add('symlink: --state under a linked dir', (r) => { fs.symlinkSync(r.outside, path.join(r.jail, 'sl')); return ['install', d0, '--target', r.target, '--state', path.join(r.jail, 'sl', 'st'), '--apply']; });
  add('symlink: in-target AGENTS.md links outside (DESIGN 1.5, every write)', (r) => { fs.rmSync(path.join(r.target, 'AGENTS.md'), { force: true }); fs.symlinkSync(path.join(r.outside, 'AGENTS.md'), path.join(r.target, 'AGENTS.md')); return ['install', agents, '--target', r.target, ...r.stateArgs(), '--apply']; });
  add('symlink: in-target .pharos dir links outside (default state)', (r) => { fs.symlinkSync(r.outside, path.join(r.target, '.pharos')); return ['install', d0, '--target', r.target, '--apply']; });
  add('design extra: target is HOME itself', (r) => ['install', d0, '--target', r.home, ...r.stateArgs(), '--apply']);
  for (const c of cases) {
    const run = await mk(cfg, { fixture: 'populated' });
    try {
      const tag = `I4 refuse [${c.name}]`;
      const argv = c.fn(run);
      const before = run.snapshot();
      const res = await run.exec(argv);
      const after = run.snapshot();
      if (res.code === 0) v.push(`${tag}: NOT REFUSED, exit 0: ${res.out.slice(0, 160).replace(/\n/g, ' ')}`);
      if (res.timedOut) v.push(`${tag}: timed out`);
      // the case's own setup (symlink creation) happens before 'before' is taken, so any diff is the installer's
      const d = diffTrees(before.jail, after.jail);
      if (d.length) v.push(`${tag}: changed the tree: ${fmtDiff(d)}`);
      const sc = stateChangingCalls(res.calls);
      if (sc.length) v.push(`${tag}: state-changing shim calls: ${sc.map((x) => x.tool).join(',')}`);
      sideEffectViolations(run, before, after, res, tag, v);
      notes.push(`${tag}: exit ${res.code}`);
    } finally { run.close(); }
  }
  return { violations: v, notes };
}

// ------------------------------------------------------------------ I9
export const LEGACY_SCRIPT = (run, vars = {}) => {
  const D = run.target + '/p1'; const D2 = run.target + '/p2'; const R = run.target + '/repo';
  const w = ['--writer', 'w'];
  return [
    ['no-args', []],
    ['unknown-command', ['bogus']],
    ['status-missing-value', ['status', '--dir']],
    ['init', ['init', '--dir', D, ...w]],
    ['status', ['status', '--dir', D, ...w]],
    ['declare-kind', ['weave', '--dir', D, ...w, '--cell', 'DEF·Figure', '--kind', 'kind', '--addr', 'note', '--body', '{"name":"note","cell":"INS·Figure"}']],
    ['weave', ['weave', '--dir', D, ...w, '--cell', 'INS·Figure', '--kind', 'note', '--addr', 'x', '--body', '{"a":1}']],
    ['weave-again', ['weave', '--dir', D, ...w, '--cell', 'INS·Figure', '--kind', 'note', '--addr', 'x', '--body', '{"a":1}']],
    ['weave-wrong-cell-for-kind', ['weave', '--dir', D, ...w, '--cell', 'INS·Figure', '--kind', 'kind', '--addr', 'x', '--body', '{}']],
    ['weave-bad-cell', ['weave', '--dir', D, ...w, '--cell', 'NOPE', '--kind', 'note', '--addr', 'x', '--body', '{}']],
    ['weave-bad-body', ['weave', '--dir', D, ...w, '--cell', 'INS·Figure', '--kind', 'note', '--addr', 'x', '--body', '{']],
    ['fold', ['fold', '--dir', D, ...w]],
    ['fold-cell', ['fold', '--dir', D, ...w, '--cell', 'INS·Figure']],
    ['fold-kind', ['fold', '--dir', D, ...w, '--kind', 'note']],
    ['init-2', ['init', '--dir', D2, ...w]],
    ['merge', ['merge', D2, '--dir', D, ...w]],
    ['merge-missing', ['merge', run.target + '/nope', '--dir', D, ...w]],
    ['install-abs', ['install', R]],
    ['install-abs-again', ['install', R]],
    ['undo-abs', ['undo', R]],
    ['undo-abs-again', ['undo', R]],
    ['install-rel-dot', ['install', './repo2']],
    ['install-rel-slash-doorname', ['install', './pharos-core']],
    ['install-rel-slash-doorname-all', ['install', './all']],
    ['undo-rel-slash-doorname', ['undo', './pharos-core']],
    ['install-missing-arg', ['install']],
    ['undo-missing-arg', ['undo']],
    ['install-nonexistent-abs', ['install', run.target + '/does/not/exist']],
  ];
};

export async function checkLegacyUnchanged(cfg) {
  const v = []; const notes = []; const info = [];
  const baseBin = path.join(BASELINE_DIR, 'bin', 'pharos.mjs');
  // frozen baseline must be intact
  const frozen = fs.readFileSync(path.join(BASELINE_DIR, '..', 'pharos-pre.sha256'), 'utf8').trim().split('\n');
  for (const line of frozen) {
    const [h, f] = line.split(/\s+/);
    if (sha256(fs.readFileSync(path.join(BASELINE_DIR, f))) !== h) v.push(`I9: frozen baseline file ${f} was modified`);
  }
  const mkSide = (bin, label) => mk({ ...cfg, bin, label }, { fixture: 'bare' });
  const setupDirs = (r) => { fs.mkdirSync(r.target + '/repo', { recursive: true }); fs.mkdirSync(r.target + '/repo2'); fs.mkdirSync(r.cwd + '/repo2'); fs.mkdirSync(r.cwd + '/pharos-core'); fs.mkdirSync(r.cwd + '/all'); };
  const runScript = async (bin, label) => {
    const r = await mkSide(bin, label);
    setupDirs(r);
    const out = [];
    for (const [name, args] of LEGACY_SCRIPT(r)) {
      const res = await r.exec(args, { env: { PHAROS_WRITER: 'w' } });
      out.push({ name, code: res.code, stdout: normPaths(res.stdout, r), stderr: normPaths(res.stderr, r), calls: res.calls.length, conns: res.connections.length });
    }
    const tree = hashTree(r.jail);
    const contents = {};
    for (const [k, val] of tree) if (val.startsWith('F')) contents[k] = fs.readFileSync(path.join(r.jail, k), 'utf8');
    r.close();
    return { out, tree, contents };
  };
  const b1 = await runScript(baseBin, 'i9-base1');
  const b2 = await runScript(baseBin, 'i9-base2');
  const nw = await runScript(cfg.bin, 'i9-new');
  for (let i = 0; i < b1.out.length; i++) {
    const A = b1.out[i]; const B = b2.out[i]; const N = nw.out[i];
    const mo = volatileMask(A.stdout, B.stdout); const me = volatileMask(A.stderr, B.stderr);
    // normalise the per-run directory names (they differ between runs) before masking
    const nrm = (s) => s.replace(/a-i9-(?:base1|base2|new)-[A-Za-z0-9_-]+/g, '<RUNID>');
    const same = A.code === N.code && applyMask(nrm(A.stdout), mo) === applyMask(nrm(N.stdout), mo) && applyMask(nrm(A.stderr), me) === applyMask(nrm(N.stderr), me);
    if (!same) v.push(`I9 command [${A.name}] differs from baseline: exit ${A.code} vs ${N.code}; stdout ${JSON.stringify(nrm(A.stdout)).slice(0, 120)} vs ${JSON.stringify(nrm(N.stdout)).slice(0, 120)}; stderr ${JSON.stringify(nrm(A.stderr)).slice(0, 120)} vs ${JSON.stringify(nrm(N.stderr)).slice(0, 120)}`);
    if (N.calls || N.conns) v.push(`I9 command [${A.name}]: made ${N.calls} shim calls / ${N.conns} connections`);
    info.push(`${A.name}: exit ${A.code}${same ? ' same' : ' DIFFERENT'}`);
  }
  // resulting trees: same paths and modes; same content wherever the two baseline runs agree
  const dBase = diffTrees(b1.tree, nw.tree);
  const unstable = new Set(Object.keys(b1.contents).filter((k) => b1.contents[k] !== b2.contents[k]));
  for (const x of dBase) {
    if (x.kind === 'content' && unstable.has(x.path)) continue;
    if (x.kind === 'content' && /^F/.test(x.before || '') && /^F/.test(x.after || '')) {
      // path-embedded run ids are not stable; compare after normalising them
      const a = b1.contents[x.path] ?? ''; const n = nw.contents[x.path] ?? '';
      // the pointer's `lib` line names the checkout the library sits in, which differs by construction between the frozen
      // baseline copy and the tree under test (TEST_CHANGES.md #3); the sha256 line is still compared
      const nrm = (s) => s.replace(/a-i9-(?:base1|base2|new)-[A-Za-z0-9_-]+/g, '<RUNID>').replace(/("lib": )"[^"]*"/g, '$1"<LIB>"');
      if (nrm(a) === nrm(n)) continue;
    }
    v.push(`I9 resulting tree differs from baseline: ${x.kind} ${x.path}`);
  }
  notes.push(...info);
  return { violations: v, notes };
}

export function parseTap(out) {
  const names = { ok: new Set(), notok: new Set() };
  for (const l of out.split('\n')) {
    const m = l.match(/^(ok|not ok) \d+ - (.*?)(?: # .*)?$/);
    if (m) (m[1] === 'ok' ? names.ok : names.notok).add(m[2]);
  }
  const num = (k) => Number((out.match(new RegExp(`^# ${k} (\\d+)`, 'm')) || [])[1] ?? NaN);
  return { ...names, tests: num('tests'), pass: num('pass'), fail: num('fail'), skipped: num('skipped') };
}

export async function checkExistingTests(cfg, pharosDir) {
  const v = []; const notes = [];
  const runIn = async (dir, label) => {
    const r = await mk({ ...cfg, label }, { fixture: 'bare' });
    const res = await r.node(['--test', '--test-reporter=tap', '--test-concurrency=1', ...fs.readdirSync(path.join(BASELINE_DIR, 'test')).filter((f) => f.endsWith('.test.mjs')).map((f) => path.join('test', f))], { cwd: dir, timeoutMs: 240000 });
    r.close();
    return { res, tap: parseTap(res.stdout) };
  };
  const base = await runIn(BASELINE_DIR, 'i9t-base');
  const now = await runIn(pharosDir, 'i9t-new');
  notes.push(`baseline: tests ${base.tap.tests} pass ${base.tap.pass} fail ${base.tap.fail}; failing: ${[...base.tap.notok].join(' | ') || 'none'}`);
  notes.push(`new tree: tests ${now.tap.tests} pass ${now.tap.pass} fail ${now.tap.fail}; failing: ${[...now.tap.notok].join(' | ') || 'none'}`);
  if (!(base.tap.tests > 0)) v.push('I9: baseline produced no TAP result (rig problem)');
  for (const n of base.tap.ok) if (!now.tap.ok.has(n)) v.push(`I9 REGRESSION: test passed at baseline but not now: ${n}`);
  for (const n of now.tap.notok) if (!base.tap.notok.has(n)) v.push(`I9 NEW FAILURE: ${n}`);
  if (now.tap.tests < base.tap.tests) v.push(`I9: fewer tests than baseline (${now.tap.tests} < ${base.tap.tests})`);
  for (const n of base.tap.notok) if (now.tap.notok.has(n)) notes.push(`pre-existing failure still failing (not a regression): ${n}`);
  return { violations: v, notes, base, now };
}

export { doorIds, manifestsOf, baseArgs, LEVELS, heavy, FIXTURES, DEFAULT_BIN, launchctlDb, hashTree };
