// gate — A REPO WORKS ONLY IF IT FLOWS THROUGH PHAROS (2026-11-18).
//
// `gate(dir)` answers one question: may the repo at `dir` do its work? It reads the repo's holon.json and pharos's own rules/rules.json and checks the four rules (ONE-DOOR, PRIMED, RULES-CURRENT, SAY-WHEN-REFUSED).
// A repo calls it at its door (khora: native/the-fold/pharos-gate.mjs) and REFUSES when it fails. The rules live here and only here; a repo carries a pointer (its holon.json) and the hash of the rules it acknowledged.
//
//   gate(dir, opts?)  → { ok, failures: [{ rule, why }], rules: <hash>, repo }      never throws on a bad repo; it reports
//   ack(dir)          → writes the current rules hash into dir/holon.json (a deliberate act: "I have read the rules as they are now")
//   rulesHash()       → sha256 of rules/rules.json
//
// holon.json fields this reads (others are left alone): name, door ("path#export"), needs: [{ name, env?, paths: [...], contains: [file, ...] }], rules (hash).
// A need's `paths` may start with "~/" (the home) or be relative to the repo; `env` names an environment variable that, if set, is the ONLY place tried (as the reader itself does).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chatter } from './chatter.mjs';
import * as P from './pharos.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RULES_FILE = path.join(HERE, '..', 'rules', 'rules.json');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const rulesHash = () => sha(fs.readFileSync(RULES_FILE));
export const rules = () => JSON.parse(fs.readFileSync(RULES_FILE, 'utf8')).rules;

const resolveNeed = (dir, p) => (p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : path.resolve(dir, p));

export function gate(dir, opts = {}) {
  const root = path.resolve(dir); const failures = []; const fail = (rule, why) => failures.push({ rule, why });
  let holon = null, name = path.basename(root);
  try { holon = JSON.parse(fs.readFileSync(path.join(root, 'holon.json'), 'utf8')); name = holon?.name || name; }
  catch { fail('ONE-DOOR', `no readable holon.json in ${root}: install the door (node pharos/bin/pharos.mjs install all --target "${root}" --apply) and declare \`door\` and \`needs\` in it`); }
  if (holon) {
    // ONE-DOOR
    if (typeof holon.door !== 'string' || !/^[^#]+#[A-Za-z_$][\w$]*$/.test(holon.door)) fail('ONE-DOOR', 'holon.json declares no `door` ("path/to/file.mjs#exportName")');
    else {
      const [file, exp] = holon.door.split('#'); const f = path.join(root, file);
      let src = null; try { src = fs.readFileSync(f, 'utf8'); } catch { fail('ONE-DOOR', `the declared door file does not exist: ${file}`); }
      if (src !== null && !new RegExp(`export\\s+(?:async\\s+)?(?:function|const|class)\\s+${exp.replace(/\$/g, '\\$')}\\b|export\\s*\\{[^}]*\\b${exp.replace(/\$/g, '\\$')}\\b[^}]*\\}`).test(src)) fail('ONE-DOOR', `${file} does not export ${exp}`);
    }
    // PRIMED
    for (const need of Array.isArray(holon.needs) ? holon.needs : []) {
      const tried = []; let found = null;
      // an env var that is SET is authoritative (the reader reads exactly that place; a fallback would make the gate pass where the reader fails)
      const candidates = need.env && process.env[need.env] ? [process.env[need.env]] : (need.paths ?? []);
      for (const c of candidates) { const p = resolveNeed(root, c); tried.push(p); if (fs.existsSync(p) && (need.contains ?? []).every((f) => fs.existsSync(path.join(p, f)))) { found = p; break; } }
      if (!found) fail('PRIMED', `missing: ${need.name}${need.contains?.length ? ` (a folder holding ${need.contains.join(', ')})` : ''}. Looked in: ${tried.join(' | ') || '(nowhere: no paths declared)'}${need.env ? `. Set ${need.env} to point at it` : ''}${need.how ? `. ${need.how}` : ''}`);
    }
    // WRITES-TO-PHAROS: the log must open and take a write; a repo that cannot write to it may not act
    try { const h = P.open(String(holon.name || name), { dir: opts.pharosDir, writer: opts.writer || undefined }); P.status(h); fs.accessSync(h.dir, fs.constants.W_OK); }
    catch (e) { fail('WRITES-TO-PHAROS', `the pharos log for ${name} cannot be opened for writing (${String(e?.message ?? e).slice(0, 120)}); set PHAROS to a writable directory`); }
    // RULES-CURRENT
    const cur = rulesHash();
    if (holon.rules !== cur) fail('RULES-CURRENT', holon.rules ? `holon.json acknowledges rules ${String(holon.rules).slice(0, 12)}, the current rules are ${cur.slice(0, 12)}: read rules/rules.json, then run \`pharos ack --target "${root}"\`` : `holon.json has not acknowledged the rules: read rules/rules.json, then run \`pharos ack --target "${root}"\``);
  }
  const ok = failures.length === 0;
  // SAY-WHEN-REFUSED
  if (!ok && opts.chatter !== false) chatter({ level: 'error', where: name, what: 'gate_refused', detail: { rules: failures.map((f) => f.rule), failures } }, { writer: opts.writer, dir: opts.chatterDir });
  return { ok, failures, rules: rulesHash(), repo: name };
}

export function ack(dir) {
  const f = path.join(path.resolve(dir), 'holon.json');
  let holon; try { holon = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { throw new Error(`no readable holon.json in ${dir}`); }
  holon.rules = rulesHash(); fs.writeFileSync(f, JSON.stringify(holon, null, 2) + '\n');
  return { acknowledged: holon.rules, file: f };
}

// record(dir, act) — WRITES-TO-PHAROS and FULL-CAPACITY at the moment of acting. The repo calls it AFTER it acted and BEFORE it returns the result; if it throws, the repo does not return the result.
//   act: { door, addr, body, capacities: { available: [...], used: [...] }, degraded?, cell?, kind?, writer?, pharosDir? }
//   - available minus used must be empty, or `degraded: true` must be declared (then the entry is marked degraded and a chatter line is left);
//   - the entry is woven (cell SIG·Figure, kind `act` by default, declared on first use); a write that fails refuses the act.
export function record(dir, act = {}) {
  const root = path.resolve(dir); let name = path.basename(root);
  try { name = JSON.parse(fs.readFileSync(path.join(root, 'holon.json'), 'utf8'))?.name || name; } catch { /* the gate reports a missing holon.json */ }
  const { door, addr, body = {}, capacities = {}, degraded = false, cell = 'SIG·Figure', kind = 'act' } = act;
  const available = [...new Set(capacities.available ?? [])], used = new Set(capacities.used ?? []);
  const missing = available.filter((c) => !used.has(c));
  const note = (what, detail) => chatter({ level: degraded && what === 'capacity_missing' ? 'warn' : 'error', where: name, what, detail }, { writer: act.writer, dir: act.chatterDir });
  if (missing.length && !degraded) {
    note('capacity_missing', { door, missing, available, used: [...used] });
    throw new P.PharosError('FULL_CAPACITY', `${name} refused: ${missing.join(', ')} ${missing.length > 1 ? 'were' : 'was'} available and not used. A repo brings every capacity it has to bear (pharos rule FULL-CAPACITY). Fix what was left out, or pass degraded: true to act knowingly (the record is marked).`);
  }
  if (missing.length) note('capacity_missing', { door, missing, available, used: [...used], degraded: true });
  try {
    const h = P.open(name, { dir: act.pharosDir, writer: act.writer || undefined });
    if (!P.entries(h).some((e) => e.kind === 'kind' && e.addr === `kind:${kind}`)) P.weave(h, { cell: 'DEF·Figure', kind: 'kind', addr: `kind:${kind}`, body: { name: kind, cell } });
    return P.weave(h, { cell, kind, addr: String(addr), body: { door, ...body, capacities: { available, used: [...used], missing }, degraded: !!degraded }, basis: { rules: rulesHash(), repo: name } });
  } catch (e) {
    note('write_refused', { door, error: String(e?.message ?? e).slice(0, 200) });
    throw new P.PharosError('WRITE_REFUSED', `${name} refused: the act could not be written to pharos (${String(e?.message ?? e).slice(0, 160)}). Nothing is done off the record (pharos rule WRITES-TO-PHAROS).`);
  }
}
