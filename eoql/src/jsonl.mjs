// jsonl.mjs: scanning pharos JSONL text into entries with the line facts the flow matrix needs (SPEC 6.1).
import { CELL_RANK } from './vendor.mjs';
import { canonical, entryId, isObj, isStrArr } from './util.mjs';

export const DEFAULT_FIELDS = new Set(['v', 'cell', 'kind', 'addr', 'body', 'of', 'basis', 'seen', 'by', 'at', 'id']);

// same checks as the frozen library's invalid()
export function invalidReason(e) {
  try {
    if (!isObj(e)) return 'not an object';
    if (e.v !== 1) return 'bad version';
    for (const k of ['cell', 'kind', 'addr', 'by', 'at', 'id']) if (typeof e[k] !== 'string') return `bad ${k}`;
    if (!CELL_RANK.has(e.cell)) return 'unknown cell';
    if (!isStrArr(e.of) || !isStrArr(e.seen)) return 'bad of/seen';
    if (!isObj(e.basis) || !('body' in e)) return 'bad basis/body';
    if (entryId(e) !== e.id) return 'id does not match content';
  } catch (err) { return 'bad json value'; }
  return null;
}
export const extraFields = (e) => Object.keys(e).filter((k) => !DEFAULT_FIELDS.has(k));

// -> { lines: [{n, text, e|null, reason|null, canon: bool, torn: bool}], torn: bool }
export function scanText(text) {
  const parts = text.split('\n');
  const lines = [];
  const endsNl = parts[parts.length - 1] === '';
  if (endsNl) parts.pop();
  for (let i = 0; i < parts.length; i++) {
    const t = parts[i];
    if (!t.trim()) continue;
    const torn = !endsNl && i === parts.length - 1;
    let e = null, reason = null;
    try { e = JSON.parse(t); reason = invalidReason(e); if (reason) e = null; } catch (err) { reason = 'unparseable JSON'; }
    let canon = false;
    if (e) { try { canon = canonical(e) === t; } catch (err) { canon = false; } }
    lines.push({ n: i + 1, text: t, e, reason, canon, torn });
  }
  return { lines, torn: !endsNl && parts.length > 0 && parts[parts.length - 1].trim() !== '' };
}
