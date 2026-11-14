// rel.mjs: relational helpers over rows ({c, m, g?}): sorting, grouping keys, window functions (SPEC 2.4 REC, 2.7 V-WIN).
import { EoqlError } from './errors.mjs';
import { canonical } from './util.mjs';
import { cmp, nv, cls, textOf, plain, toNumeric } from './val.mjs';
import { runAgg, AGG_FNS } from './term.mjs';

export const valueKey = (v) => (v === null || v === undefined ? 'N' : cls(v) === 1 ? 'n' + nv(v) : 's' + textOf(v));
export const tupleKey = (vals) => vals.map(valueKey).join('\u0001');

// keys: [{fn(row)->value, dir:'asc'|'desc', nulls:null|'first'|'last'}]
export function compareBy(keys) {
  return (a, b) => {
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k]; const x = a.k[k], y = b.k[k];
      const nx = x === null || x === undefined, ny = y === null || y === undefined;
      if (nx || ny) {
        if (nx && ny) continue;
        const nullFirst = key.nulls ? key.nulls === 'first' : key.dir === 'asc';
        return nx ? (nullFirst ? -1 : 1) : (nullFirst ? 1 : -1);
      }
      const c = cmp(x, y);
      if (c !== 0) return key.dir === 'desc' ? -c : c;
    }
    return a.i - b.i; // stable
  };
}
export function sortRows(rows, keys, step) {
  if (!keys.length) return rows.slice();
  const dec = rows.map((r, i) => ({ r, i, k: keys.map((k) => k.fn(r)) }));
  if (step) step(rows.length);
  dec.sort(compareBy(keys));
  return dec.map((d) => d.r);
}

// ---- window functions -----------------------------------------------------------------------------------------
export const WIN_NAMES = new Set(['row_number', 'rank', 'dense_rank', 'ntile', 'lag', 'lead', 'first_value', 'last_value', 'nth_value']);
// part: array of rows (already ordered); orderVals: per-row order tuples (strings) for peers; spec {fnName, args:[fn(row)], distinct, rows:[lo,hi]|null, hasOrder}
export function windowOver(part, orderKeyFn, spec, step) {
  const n = part.length;
  const out = new Array(n);
  const peerKey = spec.hasOrder ? part.map(orderKeyFn) : null;
  // peer group boundaries
  const peerEnd = new Array(n), peerStart = new Array(n);
  if (spec.hasOrder) {
    let i = 0;
    while (i < n) { let j = i; while (j + 1 < n && peerKey[j + 1] === peerKey[i]) j++; for (let k = i; k <= j; k++) { peerStart[k] = i; peerEnd[k] = j; } i = j + 1; }
  } else for (let i = 0; i < n; i++) { peerStart[i] = 0; peerEnd[i] = n - 1; }
  const name = spec.name;
  const argv = (i, a = 0) => spec.args[a](part[i]);
  const frameOf = (i) => {
    if (spec.rows) {
      const [lo, hi] = spec.rows;
      return [lo === null ? 0 : Math.max(0, i + lo), hi === null ? n - 1 : Math.min(n - 1, i + hi)];
    }
    return spec.hasOrder ? [0, peerEnd[i]] : [0, n - 1];
  };
  switch (name) {
    case 'row_number': for (let i = 0; i < n; i++) out[i] = i + 1; return out;
    case 'rank': for (let i = 0; i < n; i++) out[i] = peerStart[i] + 1; return out;
    case 'dense_rank': { let d = 0; for (let i = 0; i < n; i++) { if (i === 0 || peerStart[i] === i) d++; out[i] = d; } return out; }
    case 'ntile': {
      const k = nv(toNumeric(argv(0, 0) ?? 1)); if (!(k >= 1)) throw new EoqlError('E_TYPE', 'ntile needs a positive integer');
      const kk = Math.floor(k); const base = Math.floor(n / kk), rem = n % kk;
      let idx = 0; for (let b = 0; b < kk; b++) { const sz = base + (b < rem ? 1 : 0); for (let t = 0; t < sz; t++) out[idx++] = b + 1; }
      return out;
    }
    case 'lag': case 'lead': {
      const off = spec.args[1] ? nv(toNumeric(spec.args[1](part[0]))) : 1; const sgn = name === 'lag' ? -1 : 1;
      for (let i = 0; i < n; i++) { const j = i + sgn * off; out[i] = j >= 0 && j < n ? argv(j, 0) : (spec.args[2] ? spec.args[2](part[i]) : null); }
      return out;
    }
    case 'first_value': case 'last_value': case 'nth_value': {
      for (let i = 0; i < n; i++) {
        const [a, b] = frameOf(i);
        if (name === 'first_value') out[i] = a <= b ? argv(a, 0) : null;
        else if (name === 'last_value') out[i] = a <= b ? argv(b, 0) : null;
        else { const k = nv(toNumeric(spec.args[1](part[i]))); const j = a + k - 1; out[i] = Number.isInteger(k) && k >= 1 && j <= b ? argv(j, 0) : null; }
      }
      return out;
    }
    default: break;
  }
  if (!AGG_FNS.has(name)) throw new EoqlError('E_UNKNOWN_FUNC', `unknown window function ${name}`);
  // aggregates over a frame
  const star = spec.star;
  const vals = star ? null : part.map((r) => spec.args[0](r));
  const sep = spec.args[1] ? spec.args[1](part[0]) : null;
  const monotone = !spec.rows && !spec.distinct && ['count', 'sum', 'total', 'avg', 'min', 'max'].includes(name);
  if (monotone) {
    // running aggregate: the frame start is fixed, the end only grows
    let end = -1; const acc = [];
    for (let i = 0; i < n; i++) {
      const [, b] = frameOf(i);
      while (end < b) { end++; acc.push(star ? 1 : vals[end]); }
      out[i] = runAgg(name, star ? [] : acc, false, null, star ? acc.length : undefined);
      if (i % 64 === 0) step(Math.min(64, n));
    }
    // runAgg on a growing array is O(n^2) in the worst case; acceptable under the step budget
    return out;
  }
  for (let i = 0; i < n; i++) {
    const [a, b] = frameOf(i);
    const sl = star ? [] : vals.slice(a, b + 1);
    out[i] = a > b ? (name === 'count' ? 0 : name === 'total' ? 0 : null) : runAgg(name, sl, spec.distinct, sep, star ? b - a + 1 : undefined);
    step(Math.max(1, b - a + 1));
  }
  return out;
}
export { plain, canonical };
