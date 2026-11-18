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
// A need's `paths` may start with "~/" (the home) or be relative to the repo; `env` names an environment variable that, if set, is tried first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chatter } from './chatter.mjs';

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
      const candidates = [need.env && process.env[need.env] ? process.env[need.env] : null, ...(need.paths ?? [])].filter(Boolean);
      for (const c of candidates) { const p = resolveNeed(root, c); tried.push(p); if (fs.existsSync(p) && (need.contains ?? []).every((f) => fs.existsSync(path.join(p, f)))) { found = p; break; } }
      if (!found) fail('PRIMED', `missing: ${need.name}${need.contains?.length ? ` (a folder holding ${need.contains.join(', ')})` : ''}. Looked in: ${tried.join(' | ') || '(nowhere: no paths declared)'}${need.env ? `. Set ${need.env} to point at it` : ''}${need.how ? `. ${need.how}` : ''}`);
    }
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
