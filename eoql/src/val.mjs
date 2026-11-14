// val.mjs: the V1 value domain (SPEC 1.4.5): NULL, integer, real, text, JSON. SQLite-compatible by construction.
// Integers are JS numbers with an integer value; a real with an integral value is wrapped in Real so it stays real.
import { EoqlError } from './errors.mjs';
import { canonical, tcmp } from './util.mjs';

export class Real { constructor(v) { this.v = v; } toJSON() { return this.v; } }
export const mkReal = (x) => (Number.isInteger(x) ? new Real(x) : x);
export const isReal = (v) => v instanceof Real || (typeof v === 'number' && !Number.isInteger(v));
export const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
export const isNum = (v) => typeof v === 'number' || v instanceof Real || typeof v === 'boolean';
export const nv = (v) => (v instanceof Real ? v.v : typeof v === 'boolean' ? (v ? 1 : 0) : v);
export const isJson = (v) => v !== null && typeof v === 'object' && !(v instanceof Real);
const MAXI = Number.MAX_SAFE_INTEGER;

export function checkInt(x) {
  if (!Number.isSafeInteger(x)) throw new EoqlError('E_RANGE', 'integer overflow');
  return x;
}
// class: 0 null, 1 numeric, 2 text
export function cls(v) { return v === null || v === undefined ? 0 : isNum(v) ? 1 : 2; }
export function textOf(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Real) return v.v >= 1e15 || v.v <= -1e15 ? String(v.v) : v.v.toFixed(1);
  if (typeof v === 'number') return String(v);
  return canonical(v);
}
export function cmp(a, b) { // total order for sort: NULL < numbers < text
  const ca = cls(a), cb = cls(b);
  if (ca !== cb) return ca < cb ? -1 : 1;
  if (ca === 0) return 0;
  if (ca === 1) { const x = nv(a), y = nv(b); return x < y ? -1 : x > y ? 1 : 0; }
  return tcmp(textOf(a), textOf(b));
}
// three-valued equality: null if either side is null
export function eq3(a, b) {
  if (a === null || b === null || a === undefined || b === undefined) return null;
  const ca = cls(a), cb = cls(b);
  if (ca !== cb) return 0;
  return cmp(a, b) === 0 ? 1 : 0;
}
export function cmp3(a, b, op) {
  if (a === null || b === null || a === undefined || b === undefined) return null;
  const ca = cls(a), cb = cls(b);
  let c;
  if (ca !== cb) c = ca < cb ? -1 : 1; else c = cmp(a, b);
  switch (op) {
    case '<': return c < 0 ? 1 : 0;
    case '<=': return c <= 0 ? 1 : 0;
    case '>': return c > 0 ? 1 : 0;
    case '>=': return c >= 0 ? 1 : 0;
    case '=': return c === 0 && ca === cb ? 1 : 0;
    case '!=': return c !== 0 || ca !== cb ? 1 : 0;
    default: throw new EoqlError('E_TYPE', `bad comparison ${op}`);
  }
}
// numeric value of a value for arithmetic: SQLite's numeric-prefix rule for text
export function toNumeric(v) {
  if (v === null || v === undefined) return null;
  if (isNum(v)) return v instanceof Real ? v : typeof v === 'boolean' ? (v ? 1 : 0) : v;
  const s = textOf(v);
  const m = /^\s*([+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?)/.exec(s);
  if (!m) return 0;
  const x = Number(m[1]);
  if (/^[+-]?\d+$/.test(m[1]) && Number.isSafeInteger(x)) return x;
  return mkReal(x);
}
export function arith(op, a, b) {
  const x = toNumeric(a), y = toNumeric(b);
  if (x === null || y === null) return null;
  const anyReal = isReal(x) || isReal(y);
  const p = nv(x), q = nv(y);
  let r;
  switch (op) {
    case '+': r = p + q; break;
    case '-': r = p - q; break;
    case '*': r = p * q; break;
    case '/':
      if (q === 0) return null;
      if (anyReal) { r = p / q; break; }
      r = Math.trunc(p / q); if (!Number.isSafeInteger(r) || Math.abs(p) > MAXI) r = Number(BigInt(p) / BigInt(q));
      break;
    case '%': {
      const pi = Math.trunc(p), qi = Math.trunc(q);
      if (qi === 0) return null;
      r = pi % qi; if (Object.is(r, -0)) r = 0;
      break;
    }
    default: throw new EoqlError('E_TYPE', `bad operator ${op}`);
  }
  if (anyReal) return mkReal(r);
  return checkInt(r);
}
export function neg(a) {
  const x = toNumeric(a);
  if (x === null) return null;
  return x instanceof Real ? mkReal(-x.v) : isReal(x) ? -x : checkInt(-x);
}
export function concat(a, b) {
  if (a === null || b === null || a === undefined || b === undefined) return null;
  const t = (x) => (typeof x === 'boolean' ? (x ? '1' : '0') : textOf(x));
  return t(a) + t(b);
}
// truthiness for predicates: null (unknown), 1 or 0
export function truth(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v !== 0 ? 1 : 0;
  if (v instanceof Real) return v.v !== 0 ? 1 : 0;
  const t = toNumeric(textOf(v));
  return nv(t) !== 0 ? 1 : 0;
}
export function typeName(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return 'integer';
  if (v instanceof Real) return 'real';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'real';
  return 'text';
}
// plain JSON (for the envelope): Real -> number
export function plain(v) {
  if (v === undefined) return null;
  if (v instanceof Real) return v.v;
  return v;
}
export function columnType(values) {
  let t = null;
  for (const v of values) {
    const k = v === null || v === undefined ? null : isJson(v) ? 'json' : typeName(v);
    if (k === null) continue;
    if (t === null) t = k; else if (t !== k) { if ((t === 'integer' && k === 'real') || (t === 'real' && k === 'integer')) t = 'real'; else return 'mixed'; }
  }
  return t === null ? 'null' : t;
}
