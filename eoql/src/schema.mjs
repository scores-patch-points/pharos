// schema.mjs: kind-declaration schemas -> columns (SPEC 1.4.3), as the pharos-sqlite rule is restated there.
import { isObj } from './util.mjs';

const KEYS = ['columns', 'fields', 'properties', 'props', 'cols', 'attributes', 'keys'];
export function affinityOf(t) {
  if (typeof t !== 'string') return 'TEXT';
  const u = t.trim().toUpperCase();
  if (/^(INT|INTEGER|BIGINT|SMALLINT|BOOL|BOOLEAN)\b/.test(u)) return 'INTEGER';
  if (/^(REAL|FLOAT|DOUBLE)\b/.test(u)) return 'REAL';
  if (/^(NUMERIC|NUMBER|DECIMAL)\b/.test(u)) return 'NUMERIC';
  return 'TEXT';
}
// -> [{name, affinity}] or null when the schema declares no columns
export function schemaColumns(schema) {
  if (schema === undefined || schema === null) return null;
  let s = schema;
  if (isObj(s)) { for (const k of KEYS) if (s[k] !== undefined && s[k] !== null) { s = s[k]; break; } }
  let cols = null;
  if (typeof s === 'string') {
    cols = s.split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const m = /^(\S+)(?:\s+(.+))?$/.exec(x); return { name: m[1], affinity: affinityOf(m[2]) }; });
  } else if (Array.isArray(s)) {
    cols = [];
    for (const x of s) {
      if (typeof x === 'string') cols.push({ name: x, affinity: 'TEXT' });
      else if (isObj(x) && typeof x.name === 'string') cols.push({ name: x.name, affinity: affinityOf(x.type) });
    }
  } else if (isObj(s)) {
    cols = Object.keys(s).sort().map((k) => ({ name: k, affinity: affinityOf(typeof s[k] === 'string' ? s[k] : isObj(s[k]) ? s[k].type : undefined) }));
  }
  if (!cols || !cols.length) return null;
  return cols.map((c) => ({ name: c.name === 'id' ? 'id_' : c.name, key: c.name, affinity: c.affinity }));
}
