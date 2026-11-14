// Loads doors and validates each door.json against install/door.schema.json (hand-checked; no dependencies).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LADDER = ['none', 'writes-files', 'edits-host-config', 'installs-software', 'starts-services'];
const PATHPAT = /^\$(HOME|TARGET|STATE|KHORA_DIR)(\/[^/]+)*$/;
const TOOL = /^[A-Za-z0-9._+-]+$/;
const TOP = ['id', 'version', 'summary', 'kind', 'side_effects', 'requires', 'touches', 'steps', 'verify', 'provenance', 'license_note'];
const STEP = ['id', 'summary', 'level', 'flag', 'default_on', 'needs_value', 'after', 'touches', 'undo', 'reverse_command', 'idempotent'];
const UNDO = ['restore-bytes', 'remove-created', 'restore-env', 'stop-journaled-pids', 'reverse-command', 'manual-note', 'none'];

export function validateManifest(m, file = 'door.json') {
  const errs = [];
  const bad = (s) => errs.push(`${file}: ${s}`);
  if (!m || typeof m !== 'object' || Array.isArray(m)) return [`${file}: not an object`];
  for (const k of Object.keys(m)) if (!TOP.includes(k)) bad(`unknown key ${k}`);
  for (const k of ['id', 'version', 'summary', 'side_effects', 'requires', 'touches', 'steps']) if (!(k in m)) bad(`missing ${k}`);
  if (typeof m.id !== 'string' || !/^[a-z][a-z0-9-]{1,31}$/.test(m.id)) bad('bad id');
  if (!Number.isInteger(m.version) || m.version < 1) bad('bad version');
  if (typeof m.summary !== 'string' || m.summary.length > 200) bad('bad summary');
  if (m.kind !== undefined && !['installable', 'detect-only', 'pointer'].includes(m.kind)) bad('bad kind');
  if (!LADDER.includes(m.side_effects)) bad('bad side_effects');
  const t = m.touches || {};
  for (const k of ['files', 'env', 'services', 'network', 'configs', 'tools']) if (!Array.isArray(t[k])) bad(`touches.${k} must be an array`);
  for (const k of Object.keys(t)) if (!['files', 'env', 'services', 'network', 'configs', 'tools'].includes(k)) bad(`unknown touches.${k}`);
  const pp = (p, where) => { if (typeof p !== 'string' || !PATHPAT.test(p) || p.split('/').includes('..')) bad(`${where}: bad path pattern ${JSON.stringify(p)}`); };
  (t.files || []).forEach((p) => pp(p, 'touches.files'));
  (t.configs || []).forEach((c) => { pp(c.path, 'touches.configs'); if (!['create', 'merge-json', 'marked-block', 'replace-file'].includes(c.edit)) bad('bad config edit'); });
  (t.tools || []).forEach((x) => { if (!TOOL.test(x)) bad(`bad tool name ${x}`); });
  (t.env || []).forEach((x) => { if (!/^[A-Z][A-Z0-9_]*$/.test(x)) bad(`bad env name ${x}`); });
  const steps = Array.isArray(m.steps) ? m.steps : [];
  if (!steps.length) bad('no steps');
  const ids = new Set();
  let max = 0;
  for (const s of steps) {
    for (const k of Object.keys(s)) if (!STEP.includes(k)) bad(`step ${s.id}: unknown key ${k}`);
    if (!/^[a-z][a-z0-9-]*$/.test(s.id || '')) bad(`bad step id ${s.id}`);
    if (ids.has(s.id)) bad(`duplicate step ${s.id}`); ids.add(s.id);
    const lv = LADDER.indexOf(s.level);
    if (lv < 0) bad(`step ${s.id}: bad level`);
    max = Math.max(max, lv);
    if (s.flag !== undefined && s.flag !== null && !/^--[a-z][a-z0-9-]*$/.test(s.flag)) bad(`step ${s.id}: bad flag`);
    if (s.undo !== undefined && !UNDO.includes(s.undo)) bad(`step ${s.id}: bad undo`);
    if (lv > 1) {
      if (!s.flag) bad(`step ${s.id}: level ${s.level} needs its own flag`);
      if (!s.undo) bad(`step ${s.id}: level ${s.level} needs an undo mode`);
      if (s.default_on) bad(`step ${s.id}: default_on is only legal for none and writes-files`);
    }
  }
  if (LADDER[max] !== m.side_effects) bad(`side_effects ${m.side_effects} is not the max over steps (${LADDER[max]})`);
  const flags = steps.map((s) => s.flag).filter(Boolean);
  if (new Set(flags).size !== flags.length) bad('duplicate flag');
  return errs;
}

// Door module contract (doors/<id>/door.mjs, default export):
//   scope: 'target' | 'home'        where the journal lives ($TARGET/.pharos or $HOME/.pharos)
//   options: { '--name': {value:true, repeat?:true} }   door-specific flags (besides the step flags)
//   steps: { <stepId>: { plan(ctx) -> {actions[], notes[], satisfied?, why?} } }
//   detect(ctx) -> {present, version?, missing[], conflicts[]}
//   verify?(ctx) -> [{id, ok, detail}]     (default: the manifest checks)
export async function loadDoors(root = ROOT) {
  const dir = path.join(root, 'doors');
  const doors = new Map();
  for (const name of fs.readdirSync(dir).sort()) {
    const mf = path.join(dir, name, 'door.json');
    if (!fs.existsSync(mf)) continue;
    const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
    const errs = validateManifest(manifest, `doors/${name}/door.json`);
    if (errs.length) throw new Error(`invalid manifest: ${errs.join('; ')}`);
    if (manifest.id !== name) throw new Error(`doors/${name}/door.json: id must equal the folder name`);
    const impl = (await import(pathToFileURL(path.join(dir, name, 'door.mjs')).href)).default;
    doors.set(manifest.id, { manifest, impl, dir: path.join(dir, name) });
  }
  return doors;
}
