// Door commands: doors | install <door|all> | detect | verify | status | undo-door.
// Exit codes: 0 ok, 1 failed step or failed verify, 2 usage / unknown flag / unknown door, 3 refused.
import { loadDoors } from './manifest.mjs';
import { Session } from './runner.mjs';
import { Refused, Usage } from './guard.mjs';

const GLOBAL_VALUE = ['--target', '--state', '--khora-dir'];
const GLOBAL_BOOL = ['--plan', '--apply', '--json', '--text', '--explain', '--probe-network', '--yes-real-home', '--keep-journal'];
export const DOOR_VERBS = new Set(['doors', 'detect', 'verify', 'undo-door']);

function positionals(argv, doors) {
  const valueFlags = new Set(GLOBAL_VALUE);
  for (const d of doors.values()) for (const [f, sp] of Object.entries(d.impl.options || {})) if (sp.value) valueFlags.add(f);
  return argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && valueFlags.has(argv[i - 1])));
}

export async function isDoorCommand(argv) {
  const first = argv.find((a) => !a.startsWith('--'));
  if (DOOR_VERBS.has(first)) return true;
  if (first !== 'install' && first !== 'status') return false;
  try { // a broken door must never break the legacy commands
    const doors = await loadDoors();
    const [cmd, arg] = positionals(argv, doors);
    return arg === 'all' || doors.has(arg) || argv.some((f) => ['--target', '--apply', '--plan', '--text', '--explain'].includes(f.split('=')[0]));
  } catch { return false; }
}

function flagTable(doors, ids) {
  const t = new Map(); // flag -> {value, repeat, optional, owners}
  for (const f of GLOBAL_VALUE) t.set(f, { value: true, owners: null });
  for (const f of GLOBAL_BOOL) t.set(f, { value: false, owners: null });
  for (const [id, d] of doors) {
    const here = ids.includes(id);
    const add = (f, spec) => { const e = t.get(f) || { owners: [], ...spec, selected: false }; e.owners = [...(e.owners || []), id]; e.selected = e.selected || here; t.set(f, e); };
    for (const s of d.manifest.steps) if (s.flag) add(s.flag, { value: false, optional: !!s.needs_value });
    for (const [f, spec] of Object.entries(d.impl.options || {})) add(f, { value: !!spec.value, repeat: !!spec.repeat });
  }
  return t;
}

function parseFlags(argv, table, lenient = false) {
  const pos = [], flags = new Map(), ignored = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const eq = a.indexOf('=');
    const name = eq < 0 ? a : a.slice(0, eq);
    const spec = table.get(name);
    if (!spec) throw new Usage(`unknown flag ${name}`);
    if (spec.owners && !spec.selected) {
      // `all` selects only the default-on doors. In a plan (never in an apply) a flag of another door is
      // reported and dropped, so one flag set can be planned against `all`; apply still refuses it.
      if (!lenient) throw new Usage(`${name} belongs to door ${spec.owners.join(', ')}, which is not selected`);
      ignored.push({ flag: name, door: spec.owners.join(', ') });
      if (eq < 0 && spec.value && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) i++;
      continue;
    }
    let v = true;
    if (eq >= 0) v = a.slice(eq + 1);
    else if (spec.value) { v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Usage(`${name} needs a value`); }
    if (eq >= 0 && !spec.value && !spec.optional) throw new Usage(`${name} takes no value`);
    // A door's values end up in a tool's argv: one that begins with '-' would be read by the tool as an option.
    if (spec.owners && typeof v === 'string' && v.split(',').some((x) => x.trim().startsWith('-'))) throw new Usage(`${name}: a value must not begin with '-' (${JSON.stringify(v)})`);
    if (spec.repeat) flags.set(name, [...(flags.get(name) || []), v]); else flags.set(name, v);
  }
  return { pos, flags, ignored };
}

function selectDoors(doors, arg, verb) {
  if (arg === 'all') {
    const ids = [];
    for (const [id, d] of doors) {
      const m = d.manifest;
      const safe = (m.kind || 'installable') === 'installable' && ['none', 'writes-files'].includes(m.side_effects) && m.steps.some((s) => s.default_on);
      const info = m.kind === 'detect-only';
      if (safe || (info && (verb === 'install' || verb === 'detect'))) ids.push(id);
    }
    return ids;
  }
  if (!doors.has(arg)) throw new Usage(`unknown door ${JSON.stringify(arg)}; run: pharos doors`);
  return [arg];
}

const fail = (code, message, exit) => { const e = new Error(message); e.code = code; e.exit = exit; return e; };

export async function main(argv, io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s), tty: process.stdout.isTTY }) {
  try {
    const doors = await loadDoors();
    // find positional first (door selection decides which flags are legal)
    const posRaw = positionals(argv, doors);
    const [verb, arg] = posRaw;
    if (verb === 'doors') { const r = { doors: [...doors.values()].map((d) => ({ id: d.manifest.id, kind: d.manifest.kind || 'installable', side_effects: d.manifest.side_effects, summary: d.manifest.summary })) }; return emit(io, argv, 'doors', r, 0); }
    if (!arg) throw new Usage(`${verb} needs a door id or "all"`);
    const ids = selectDoors(doors, arg, verb);
    const table = flagTable(doors, ids);
    const { flags, ignored } = parseFlags(argv, table, arg === 'all' && !argv.includes('--apply'));
    if (flags.has('--plan') && flags.has('--apply')) throw new Usage('--plan and --apply are exclusive');
    const apply = flags.has('--apply') && verb === 'install';
    if (flags.has('--apply') && verb !== 'install') throw new Usage('--apply only belongs to install');
    if (flags.has('--plan') && verb === 'undo-door') throw new Usage('--plan does not apply to undo-door (it would undo for real); undo-door has no dry run');
    const s = new Session(doors, { target: flags.get('--target'), state: flags.get('--state'), khoraDir: flags.get('--khora-dir'), flags, apply, yesRealHome: flags.has('--yes-real-home'), keepJournal: flags.has('--keep-journal') });
    if (flags.has('--explain')) {
      const r = { explain: ids.map((id) => { const c = s.ctx(id); const t = c.manifest.touches; return { door: id, scope: c.scope, state: c.state, files: c.files.map((f) => f.abs), configs: t.configs.map((x) => ({ ...x, path: c.tok(x.path) })), env: t.env, services: t.services, network: t.network, tools: t.tools }; }) };
      return emit(io, argv, 'explain', r, 0);
    }
    let r, exit = 0;
    if (verb === 'install') {
      const plans = [];
      for (const id of ids) plans.push(await s.planDoor(id));
      if (!apply) { r = { ok: true, mode: 'plan', target: s.target, doors: plans.map((p) => s.publicPlan(p)), note: 'dry run: nothing was changed. Add --apply to run the steps listed with status run.', ...(ignored.length ? { ignored_flags: ignored, ignored_note: '`all` selects only the default-on doors; these flags belong to other doors and were not applied to the plan. Name the door to plan them.' } : {}) }; if (flags.has('--probe-network')) r.probe_network = 'accepted; v1 plan opens no sockets'; return emit(io, argv, 'plan', r, 0); }
      const results = [], verified = [], skipped_doors = [];
      for (const p of plans) {
        if (p.kind === 'detect-only') { if (arg === 'all') { skipped_doors.push({ door: p.door, reason: 'detect-only' }); continue; } throw fail('DETECT_ONLY', `${p.door} is detect-only: not installable from the public tree`, 1); }
        const res = await s.applyDoor(p);
        results.push(res);
        if (!res.ok) { exit = res.exit || 1; break; }
        const ranAny = p.steps.some((x) => x.status !== 'skipped');
        if (ranAny && p.steps.some((x) => x.status !== 'skipped' && x.level !== 'none') ) {
          const v = await s.verifyDoor(p.door); res.verify = v;
          const hard = v.checks.filter((c) => !c.ok && !c.soft);
          const warn = v.checks.filter((c) => !c.ok && c.soft);
          if (warn.length) res.warnings = warn.map((c) => `${c.id}: could not confirm (${c.detail}); run verify`);
          if (!hard.length) verified.push(p.door); else { res.ok = false; exit = 1; res.error = 'verify failed after apply'; break; }
        }
        if (!p.steps.some((x) => x.status === 'run')) res.note = p.skipped.length ? `no steps ran for ${p.door}; heavier steps need their own flags: ${p.skipped.map((k) => k.flag).join(' ')}` : `nothing to change for ${p.door}`;
      }
      r = { ok: exit === 0, mode: 'apply', target: s.target, results, verified, skipped_doors, plan: plans.map((p) => ({ door: p.door, skipped: p.skipped })) };
      if (exit) r.error = results.find((x) => !x.ok)?.error || 'failed';
      return emit(io, argv, 'apply', r, exit);
    }
    if (verb === 'detect') { r = { doors: [] }; for (const id of ids) r.doors.push(await s.detectDoor(id)); return emit(io, argv, 'detect', r, 0); }
    if (verb === 'verify') {
      const res = []; for (const id of ids) res.push(await s.verifyDoor(id));
      r = { ok: res.every((x) => x.ok), verified: res.filter((x) => x.ok).map((x) => x.door), failed: res.filter((x) => !x.ok).map((x) => x.door), doors: res };
      return emit(io, argv, 'verify', r, r.ok ? 0 : 1);
    }
    if (verb === 'status') { r = { doors: ids.map((id) => s.statusDoor(id)) }; return emit(io, argv, 'status', r, 0); }
    if (verb === 'undo-door') {
      const states = new Map();
      for (const id of ids) { const st = s.stateOf(id); states.set(st, [...(states.get(st) || []), id]); }
      const reports = [...states].map(([st, dids]) => ({ doors: dids, ...s.undoState(st, dids) }));
      const bad = reports.some((x) => x.failed);
      r = { ok: !bad, reports };
      return emit(io, argv, 'undo', r, bad ? 1 : 0);
    }
    throw new Usage(`unknown command ${verb}`);
  } catch (err) {
    const exit = err instanceof Usage ? 2 : err instanceof Refused ? 3 : err.exit || 1;
    io.err(JSON.stringify({ error: { code: err.code || 'INTERNAL', message: err.message } }) + '\n');
    return exit;
  }
}

function emit(io, argv, kind, r, exit) {
  const text = argv.includes('--text') || (io.tty && !argv.includes('--json'));
  io.out(text ? render(kind, r) : JSON.stringify(r, null, 2) + '\n');
  if (exit && r.error) io.err(JSON.stringify({ error: { code: 'FAILED', message: r.error } }) + '\n');
  return exit;
}

function render(kind, r) {
  const L = [];
  if (kind === 'doors') for (const d of r.doors) L.push(`${d.id.padEnd(18)} ${d.kind.padEnd(12)} ${d.side_effects.padEnd(18)} ${d.summary}`);
  else if (kind === 'plan') {
    for (const p of r.doors) {
      L.push(`door ${p.door}  [${p.side_effects}]  state ${p.state}`);
      if (p.message) L.push(`  ${p.message}`);
      for (const s of p.steps) {
        L.push(`  step ${s.id}: ${s.status}${s.reason ? ' ' + s.reason : ''}`);
        for (const a of s.actions || []) L.push(`    ${a.op} ${a.path || [a.tool, ...(a.argv || [])].join(' ')}${a.before !== undefined ? `  ${a.before} -> ${a.after}` : ''}${a.satisfied ? '  (already satisfied)' : ''}`);
        for (const a of s.actions || []) for (const d of a.creates_dirs || []) L.push(`    mkdir ${d}`);
        for (const n of s.notes || []) L.push(`    note: ${n}`);
      }
    }
    L.push(r.note);
  } else if (kind === 'verify') { if (r.verified.length) L.push(`verified: ${r.verified.join(', ')}`); if (r.failed.length) L.push(`FAILED: ${r.failed.join(', ')}`); for (const d of r.doors) for (const c of d.checks) if (!c.ok) L.push(`  ${d.door}/${c.id}: ${c.detail}`); }
  else if (kind === 'apply') { for (const x of r.results) L.push(`${x.ok ? 'ok' : 'FAILED'} ${x.door}: ${x.steps.map((s) => `${s.id}=${s.status}`).join(' ') || '(no steps)'}${x.note ? ' | ' + x.note : ''}${x.error ? ' | ' + x.error : ''}`); if (r.verified.length) L.push(`verified: ${r.verified.join(', ')}`); }
  else L.push(JSON.stringify(r, null, 2));
  return L.join('\n') + '\n';
}
