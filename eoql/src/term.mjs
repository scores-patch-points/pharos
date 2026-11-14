// term.mjs: the term language P-TERM (SPEC 2.7): compile a term AST into a closure over a row; aggregates; windows.
import { D } from './dates.mjs';
import { EoqlError } from './errors.mjs';
import { canonical } from './util.mjs';
import * as V from './val.mjs';
import { Real, mkReal, nv, textOf, cls, cmp, eq3, cmp3, arith, neg, concat, truth, isJson, toNumeric, typeName } from './val.mjs';

export const AGG_FNS = new Set(['count', 'sum', 'total', 'avg', 'min', 'max', 'group_concat']);
export const WIN_ONLY = new Set(['row_number', 'rank', 'dense_rank', 'ntile', 'lag', 'lead', 'first_value', 'last_value', 'nth_value']);
export const SCALAR_FNS = new Set(['abs', 'ceil', 'floor', 'round', 'sign', 'length', 'lower', 'upper', 'substr', 'instr', 'replace', 'trim', 'ltrim', 'rtrim', 'least', 'greatest', 'coalesce', 'nullif', 'iif', 'case', 'cast', 'typeof', 'nocase', 'json_get', 'json_array_length', 'json_valid', 'nulleq', 'date', 'time', 'datetime', 'strftime', 'julianday', 'unixepoch']);
const isNode = (n) => n && typeof n === 'object' && typeof n.t === 'string';

export function containsCall(node, names) {
  if (!isNode(node)) return false;
  if (node.t === 'call' && names.has(node.name)) return true;
  if (node.t === 'verb') return false;
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) { for (const x of v) { if (isNode(x) ? containsCall(x, names) : (x && isNode(x.v) && containsCall(x.v, names))) return true; } } else if (isNode(v) && containsCall(v, names)) return true;
  }
  return false;
}
export function collectCalls(node, names, out = []) {
  if (!isNode(node)) return out;
  if (node.t === 'verb') return out;
  if (node.t === 'call' && names.has(node.name)) { out.push(node); }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) { for (const x of v) { if (isNode(x)) collectCalls(x, names, out); else if (x && isNode(x.v)) collectCalls(x.v, names, out); } } else if (isNode(v)) collectCalls(v, names, out);
  }
  return out;
}

// ---- JSON path ----------------------------------------------------------------------------------------------
export function jsonStep(v, step) {
  if (v === null || v === undefined) return null;
  if (typeof step === 'number') return Array.isArray(v) && step >= 0 && step < v.length ? v[step] : null;
  if (typeof v === 'object' && !Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, step)) return v[step];
  return null;
}
export function parseJsonPath(p) {
  if (typeof p !== 'string' || p[0] !== '$') return null;
  const steps = [];
  let i = 1;
  while (i < p.length) {
    if (p[i] === '.') {
      i++;
      if (p[i] === '"') { const e = p.indexOf('"', i + 1); if (e < 0) return null; steps.push(p.slice(i + 1, e)); i = e + 1; } else {
        let j = i; while (j < p.length && p[j] !== '.' && p[j] !== '[') j++;
        if (j === i) return null; steps.push(p.slice(i, j)); i = j;
      }
    } else if (p[i] === '[') {
      const e = p.indexOf(']', i); if (e < 0) return null;
      const n = Number(p.slice(i + 1, e)); if (!Number.isInteger(n) || n < 0) return null;
      steps.push(n); i = e + 1;
    } else return null;
  }
  return steps;
}
function asJson(x) {
  if (x === null || x === undefined) return undefined;
  if (typeof x === 'string') { try { return JSON.parse(x); } catch (e) { return undefined; } }
  if (isJson(x)) return x;
  return x;
}

// ---- LIKE / GLOB (iterative, O(n*m), no regex: denial-of-service safe) --------------------------------------
function likeMatch(str, pat, esc) {
  const s = [...str], p = [];
  for (let i = 0, q = [...pat]; i < q.length; i++) {
    if (esc !== null && q[i] === esc && i + 1 < q.length) { p.push({ t: 'l', c: q[i + 1] }); i++; } else if (q[i] === '%') p.push({ t: '*' }); else if (q[i] === '_') p.push({ t: '?' }); else p.push({ t: 'l', c: q[i] });
  }
  const lc = (c) => (c >= 'A' && c <= 'Z' ? c.toLowerCase() : c);
  return wildcard(s, p, (a, tok) => tok.t === 'l' && lc(a) === lc(tok.c));
}
function globMatch(str, pat) {
  const s = [...str], p = [], q = [...pat];
  for (let i = 0; i < q.length; i++) {
    if (q[i] === '*') p.push({ t: '*' });
    else if (q[i] === '?') p.push({ t: '?' });
    else if (q[i] === '[') {
      let j = i + 1, negate = false; if (q[j] === '^') { negate = true; j++; }
      const set = []; let first = true;
      while (j < q.length && (q[j] !== ']' || first)) { first = false; if (q[j + 1] === '-' && j + 2 < q.length && q[j + 2] !== ']') { set.push([q[j], q[j + 2]]); j += 3; } else { set.push([q[j], q[j]]); j++; } }
      if (j >= q.length) p.push({ t: 'l', c: '[' }); else { p.push({ t: 'c', set, negate }); i = j; }
    } else p.push({ t: 'l', c: q[i] });
  }
  return wildcard(s, p, (a, tok) => (tok.t === 'l' ? a === tok.c : tok.t === 'c' ? tok.set.some(([lo, hi]) => a >= lo && a <= hi) !== tok.negate : false));
}
function wildcard(s, p, one) {
  let si = 0, pi = 0, star = -1, mark = 0;
  while (si < s.length) {
    if (pi < p.length && p[pi].t === '*') { star = pi++; mark = si; } else if (pi < p.length && (p[pi].t === '?' || one(s[si], p[pi]))) { si++; pi++; } else if (star >= 0) { pi = star + 1; si = ++mark; } else return false;
  }
  while (pi < p.length && p[pi].t === '*') pi++;
  return pi === p.length;
}

// ---- scalar functions ----------------------------------------------------------------------------------------
const dv = (x) => (typeof x === 'bigint' ? Number(x) : x instanceof Real ? x.v : x);
const rv = (x) => (typeof x === 'number' ? mkReal(x) : x);
const need = (name, args, lo, hi) => { if (args.length < lo || args.length > hi) throw new EoqlError('E_ARITY', `${name} takes ${lo === hi ? lo : lo + ' to ' + hi} argument(s), got ${args.length}`); };
const anyNull = (a) => a.some((x) => x === null || x === undefined);
const asInt = (x) => { const n = toNumeric(x); return n === null ? null : Math.trunc(nv(n)); };
const chars = (s) => [...s];

export const FN = {
  abs: (a) => { need('abs', a, 1, 1); const x = toNumeric(a[0]); if (x === null) return null; return x instanceof Real ? mkReal(Math.abs(x.v)) : V.isReal(x) ? Math.abs(x) : V.checkInt(Math.abs(x)); },
  ceil: (a) => { need('ceil', a, 1, 1); const x = toNumeric(a[0]); if (x === null) return null; return V.isReal(x) ? mkReal(Math.ceil(nv(x))) : x; },
  floor: (a) => { need('floor', a, 1, 1); const x = toNumeric(a[0]); if (x === null) return null; return V.isReal(x) ? mkReal(Math.floor(nv(x))) : x; },
  round: (a) => {
    need('round', a, 1, 2); const x = toNumeric(a[0]); if (x === null) return null;
    const d = a.length > 1 ? asInt(a[1]) : 0; if (d === null) return null;
    const f = 10 ** Math.max(0, Math.min(d, 15)), v = nv(x);
    const r = Math.sign(v) * Math.round(Math.abs(v) * f + 1e-9 * 0) / f;
    return mkReal(Number.isFinite(r) ? r : v);
  },
  sign: (a) => { need('sign', a, 1, 1); const x = toNumeric(a[0]); if (x === null) return null; return Math.sign(nv(x)); },
  length: (a) => { need('length', a, 1, 1); if (a[0] === null) return null; return chars(textOf(typeof a[0] === 'boolean' ? (a[0] ? 1 : 0) : a[0])).length; },
  lower: (a) => { need('lower', a, 1, 1); if (a[0] === null) return null; return textOf(a[0]).replace(/[A-Z]/g, (c) => c.toLowerCase()); },
  upper: (a) => { need('upper', a, 1, 1); if (a[0] === null) return null; return textOf(a[0]).replace(/[a-z]/g, (c) => c.toUpperCase()); },
  nocase: (a) => { need('nocase', a, 1, 1); return typeof a[0] === 'string' ? a[0].replace(/[A-Z]/g, (c) => c.toLowerCase()) : a[0]; },
  substr: (a) => {
    need('substr', a, 2, 3); if (anyNull(a)) return null;
    const s = chars(textOf(a[0])); let st = asInt(a[1]); let len = a.length > 2 ? asInt(a[2]) : null;
    if (st === null) return null;
    let from;
    if (st > 0) from = st - 1; else if (st < 0) from = s.length + st; else { from = -1; }
    if (len === null) { if (st === 0) from = 0; return s.slice(Math.max(from, 0)).join(''); }
    if (len < 0) { const end = from; from = from + len; len = -len; const b = Math.max(from, 0); return s.slice(b, Math.max(end, b)).join(''); }
    if (st === 0) len -= 1; if (from < 0) { len += from; from = 0; }
    return s.slice(from, from + Math.max(len, 0)).join('');
  },
  instr: (a) => { need('instr', a, 2, 2); if (anyNull(a)) return null; const s = textOf(a[0]), t = textOf(a[1]); const i = s.indexOf(t); return i < 0 ? 0 : chars(s.slice(0, i)).length + 1; },
  replace: (a) => { need('replace', a, 3, 3); if (anyNull(a)) return null; const t = textOf(a[1]); if (t === '') return textOf(a[0]); return textOf(a[0]).split(t).join(textOf(a[2])); },
  trim: (a) => trimFn('trim', a, true, true), ltrim: (a) => trimFn('ltrim', a, true, false), rtrim: (a) => trimFn('rtrim', a, false, true),
  least: (a) => { if (!a.length) throw new EoqlError('E_ARITY', 'least needs arguments'); if (anyNull(a)) return null; return a.reduce((m, x) => (cmp(x, m) < 0 ? x : m)); },
  greatest: (a) => { if (!a.length) throw new EoqlError('E_ARITY', 'greatest needs arguments'); if (anyNull(a)) return null; return a.reduce((m, x) => (cmp(x, m) > 0 ? x : m)); },
  coalesce: (a) => { if (a.length < 1) throw new EoqlError('E_ARITY', 'coalesce needs arguments'); for (const x of a) if (x !== null && x !== undefined) return x; return null; },
  nullif: (a) => { need('nullif', a, 2, 2); return eq3(a[0], a[1]) === 1 ? null : a[0]; },
  iif: (a) => { need('iif', a, 3, 3); return truth(a[0]) === 1 ? a[1] : a[2]; },
  typeof: (a) => { need('typeof', a, 1, 1); return typeName(a[0]); },
  nulleq: (a) => { need('nulleq', a, 2, 2); if (a[0] === null && a[1] === null) return 1; if (a[0] === null || a[1] === null) return 0; return eq3(a[0], a[1]); },
  json_get: (a) => {
    need('json_get', a, 2, 2); if (a[0] === null) return null;
    const steps = parseJsonPath(a[1]); if (steps === null) return null;
    let v = asJson(a[0]); if (v === undefined) return null;
    for (const s of steps) { v = jsonStep(v, s); if (v === null) return null; }
    return v;
  },
  json_array_length: (a) => { need('json_array_length', a, 1, 2); if (a[0] === null) return null; let v = asJson(a[0]); if (a.length > 1) { const st = parseJsonPath(a[1]); if (!st) return null; for (const s of st) v = jsonStep(v, s); } return Array.isArray(v) ? v.length : 0; },
  json_valid: (a) => { need('json_valid', a, 1, 1); if (a[0] === null) return null; if (typeof a[0] !== 'string') return isJson(a[0]) ? 1 : 0; try { JSON.parse(a[0]); return 1; } catch (e) { return 0; } },
  date: (a) => { need('date', a, 1, 8); return D.date(...a.map(dv)); },
  time: (a) => { need('time', a, 1, 8); return D.time(...a.map(dv)); },
  datetime: (a) => { need('datetime', a, 1, 8); return D.datetime(...a.map(dv)); },
  strftime: (a) => { need('strftime', a, 2, 9); return D.strftime(...a.map(dv)); },
  julianday: (a) => { need('julianday', a, 1, 8); return rv(D.julianday(...a.map(dv))); },
  unixepoch: (a) => { need('unixepoch', a, 1, 8); { const r = D.unixepoch(...a.map(dv)); return a.slice(1).some((m) => /^subsec(ond)?$/i.test(String(m))) ? rv(r) : r; } },
  cast: (a) => {
    need('cast', a, 2, 2); const t = String(a[1]).toLowerCase(); const x = a[0]; if (x === null) return null;
    if (t === 'text') return typeof x === 'boolean' ? (x ? '1' : '0') : textOf(x);
    const n = toNumeric(x);
    if (t === 'integer') return Math.trunc(nv(n));
    if (t === 'real') return mkReal(nv(n));
    if (t === 'numeric') { const v = nv(n); return Number.isInteger(v) && !(n instanceof Real) ? v : Number.isInteger(v) ? v : v; }
    throw new EoqlError('E_BAD_CLAUSE_VALUE', `cast to ${a[1]} is not supported`);
  },
};
function trimFn(name, a, l, r) {
  need(name, a, 1, 2); if (anyNull(a)) return null;
  const set = new Set(a.length > 1 ? chars(textOf(a[1])) : [' ']);
  const s = chars(textOf(a[0])); let i = 0, j = s.length;
  if (l) while (i < j && set.has(s[i])) i++;
  if (r) while (j > i && set.has(s[j - 1])) j--;
  return s.slice(i, j).join('');
}

// ---- aggregate functions --------------------------------------------------------------------------------------
export function runAgg(name, values, distinct, sep, count) {
  // values: array of the argument values for each row in the group (NULLs included); count(*) passes `count` rows
  let v = values;
  if (distinct) { const seen = new Set(); v = []; for (const x of values) { if (x === null || x === undefined) { v.push(x); continue; } const k = cls(x) + ':' + (cls(x) === 1 ? nv(x) : textOf(x)); if (!seen.has(k)) { seen.add(k); v.push(x); } } }
  const nn = v.filter((x) => x !== null && x !== undefined);
  switch (name) {
    case 'count': return count !== undefined ? count : nn.length;
    case 'sum': {
      if (!nn.length) return null;
      let acc = 0, real = false;
      for (const x of nn) { const n = toNumeric(x); if (V.isReal(n)) real = true; acc += nv(n); if (!real) V.checkInt(acc); }
      return real ? mkReal(acc) : acc;
    }
    case 'total': { let acc = 0; for (const x of nn) acc += nv(toNumeric(x)); return mkReal(acc); }
    case 'avg': { if (!nn.length) return null; let acc = 0; for (const x of nn) acc += nv(toNumeric(x)); return mkReal(acc / nn.length); }
    case 'min': return nn.length ? nn.reduce((m, x) => (cmp(x, m) < 0 ? x : m)) : null;
    case 'max': return nn.length ? nn.reduce((m, x) => (cmp(x, m) > 0 ? x : m)) : null;
    case 'group_concat': return nn.length ? nn.map((x) => (typeof x === 'boolean' ? (x ? '1' : '0') : textOf(x))).join(sep === null || sep === undefined ? ',' : textOf(sep)) : null;
    default: throw new EoqlError('E_UNKNOWN_FUNC', `unknown aggregate ${name}`);
  }
}

// ---- the compiler -----------------------------------------------------------------------------------------------
// sc: { cols:Set|null, colList:[], nonEmpty:bool, interp, params, agg:bool, winVals:Map|null, ctxWorld, onMissing }
export function compile(node, sc) {
  const I = sc.interp;
  const step = () => { if (++I.cost.steps > I.cost.limits.steps) I.budgetExceeded('steps'); };
  const C = (n) => compile(n, sc);
  switch (node.t) {
    case 'lit': { const v = node.real && typeof node.v === 'number' ? mkReal(node.v) : node.v; return () => v; }
    case 'param': {
      const name = node.name;
      if (!sc.params || !Object.prototype.hasOwnProperty.call(sc.params, name)) throw new EoqlError('E_PARAM', `missing parameter :${name}`, { pos: node.pos });
      const v = coerceParam(sc.params[name], name);
      return () => v;
    }
    case 'label': { const id = I.labelId(node.name, node.pos); return () => id; }
    case 'idref': { const id = I.resolveIdref(node.hex, node.pos); return () => id; }
    case 'path': return compilePath(node, sc);
    case 'un': { const x = C(node.x); return (r, g) => { step(); return neg(x(r, g)); }; }
    case 'bin': {
      const a = C(node.a), b = C(node.b), op = node.op;
      if (op === 'AND') return (r, g) => { step(); const x = truth(a(r, g)); if (x === 0) return 0; const y = truth(b(r, g)); if (y === 0) return 0; return x === null || y === null ? null : 1; };
      if (op === 'OR') return (r, g) => { step(); const x = truth(a(r, g)); if (x === 1) return 1; const y = truth(b(r, g)); if (y === 1) return 1; return x === null || y === null ? null : 0; };
      if (op === '||') return (r, g) => { step(); return concat(a(r, g), b(r, g)); };
      return (r, g) => { step(); return arith(op, a(r, g), b(r, g)); };
    }
    case 'not': { const x = C(node.x); return (r, g) => { step(); const t = truth(x(r, g)); return t === null ? null : 1 - t; }; }
    case 'rel': {
      const a = C(node.a), b = C(node.b), op = node.op;
      return (r, g) => { step(); return cmp3(a(r, g), b(r, g), op); };
    }
    case 'isnull': { const x = C(node.x), ng = node.neg; return (r, g) => { step(); const v = x(r, g); const isn = v === null || v === undefined; return (ng ? !isn : isn) ? 1 : 0; }; }
    case 'isset': { const x = C(node.x), ng = node.neg; return (r, g) => { step(); const v = x(r, g); const s = !(v === null || v === undefined) && textOf(v) !== ''; return (ng ? !s : s) ? 1 : 0; }; }
    case 'is': case 'contains': {
      const x = C(node.x), y = C(node.rhs), ng = node.neg, isIs = node.t === 'is';
      const low = (v) => (v === null || v === undefined ? null : (typeof v === 'boolean' ? (v ? 'true' : 'false') : textOf(v)).toLowerCase());
      return (r, g) => {
        step(); const a = low(x(r, g)), b = low(y(r, g));
        if (a === null || b === null) return ng ? 1 : 0;
        const m = isIs ? a === b : a.includes(b);
        return (ng ? !m : m) ? 1 : 0;
      };
    }
    case 'in': return compileIn(node, sc);
    case 'between': {
      const x = C(node.x), lo = C(node.lo), hi = C(node.hi), ng = node.neg;
      return (r, g) => {
        step(); const v = x(r, g), l = lo(r, g), h = hi(r, g);
        const t1 = cmp3(v, l, '>='), t2 = cmp3(v, h, '<=');
        let res;
        if (t1 === 0 || t2 === 0) res = 0; else if (t1 === null || t2 === null) res = null; else res = 1;
        return res === null ? null : (ng ? 1 - res : res);
      };
    }
    case 'like': {
      const x = C(node.x), p = C(node.pat), e = node.esc ? C(node.esc) : null, ng = node.neg;
      return (r, g) => {
        step(); const v = x(r, g), pt = p(r, g), es = e ? e(r, g) : null;
        if (v === null || pt === null || (e && es === null)) return null;
        const m = likeMatch(textOf(v), textOf(pt), e ? [...textOf(es)][0] ?? null : null);
        return (ng ? !m : m) ? 1 : 0;
      };
    }
    case 'glob': {
      const x = C(node.x), p = C(node.pat), ng = node.neg;
      return (r, g) => { step(); const v = x(r, g), pt = p(r, g); if (v === null || pt === null) return null; const m = globMatch(textOf(v), textOf(pt)); return (ng ? !m : m) ? 1 : 0; };
    }
    case 'call': return compileCall(node, sc);
    case 'list': { const items = node.items.map((i) => C(i.t === 'ordered' ? i.x : i)); return (r, g) => items.map((f) => V.plain(f(r, g))); }
    case 'obj': { const ps = node.pairs.map((p) => [p.k, C(p.v)]); return (r, g) => { const o = {}; for (const [k, f] of ps) o[k] = V.plain(f(r, g)); return o; }; }
    case 'ordered': return C(node.x);
    case 'verb': case 'viewcall': case 'sub': {
      // an uncorrelated scalar subquery: evaluated once, first column of first row, NULL if none
      let memo;
      return () => { if (memo === undefined) memo = { v: I.scalarSubquery(node.t === 'sub' ? node.x : node, sc) }; return memo.v; };
    }
    case 'star': throw new EoqlError('E_PARSE', '* is only allowed as the argument of count', { pos: node.pos });
    case 'heads': throw new EoqlError('E_BAD_CLAUSE_VALUE', 'heads is only valid as the value of of:', { pos: node.pos });
    default: throw new EoqlError('E_TYPE', `cannot evaluate node ${node.t}`, { pos: node.pos });
  }
}
function coerceParam(v, name) {
  if (v === undefined) throw new EoqlError('E_PARAM', `parameter :${name} is undefined`);
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new EoqlError('E_PARAM', `parameter :${name} is not finite`); return v; }
  if (typeof v === 'bigint') return Number(v);
  if (Array.isArray(v) || (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype)) { try { canonical(v); } catch (e) { throw new EoqlError('E_PARAM', `parameter :${name} is not JSON`); } return v; }
  throw new EoqlError('E_PARAM', `parameter :${name} has an unsupported type`);
}

function compileIn(node, sc) {
  const I = sc.interp;
  const x = compile(node.x, sc), ng = node.neg;
  const keyOf = (v) => (cls(v) === 1 ? 'n' + nv(v) : 's' + textOf(v));
  let getSet;
  if (node.rhs.t === 'list') {
    const items = node.rhs.items.map((i) => compile(i.t === 'ordered' ? i.x : i, sc));
    getSet = (r, g) => items.map((f) => f(r, g));
  } else if (node.rhs.t === 'param') {
    const f = compile(node.rhs, sc);
    getSet = (r, g) => { const v = f(r, g); if (!Array.isArray(v)) throw new EoqlError('E_PARAM', `parameter :${node.rhs.name} must be a list for "in"`); return v; };
  } else {
    let memo;
    getSet = () => { if (!memo) memo = I.columnSubquery(node.rhs.t === 'sub' ? node.rhs.x : node.rhs, sc); return memo; };
  }
  const cache = new WeakMap();
  return (r, g) => {
    if (++I.cost.steps > I.cost.limits.steps) I.budgetExceeded('steps');
    const v = x(r, g);
    if (v === null || v === undefined) return null;
    const arr = getSet(r, g);
    let info = cache.get(arr);
    if (!info) { info = { set: new Set(), hasNull: false }; for (const y of arr) { if (y === null || y === undefined) info.hasNull = true; else info.set.add(keyOf(y)); } cache.set(arr, info); }
    let res;
    if (info.set.has(keyOf(v))) res = 1; else res = info.hasNull ? null : 0;
    return res === null ? null : (ng ? 1 - res : res);
  };
}

function compileCall(node, sc) {
  const I = sc.interp;
  const name = node.name;
  const step = () => { if (++I.cost.steps > I.cost.limits.steps) I.budgetExceeded('steps'); };
  if (sc.winVals && sc.winVals.has(node)) { const arr = sc.winVals.get(node); return (r) => arr[r.i]; }
  if (AGG_FNS.has(name) && !(sc.aggMulti && name !== 'count' && node.args.length > 1)) {
    if (!sc.agg) throw new EoqlError('E_TYPE', `aggregate ${name}() is not allowed here`, { pos: node.pos });
    if (name === 'count' && node.args.length === 1 && node.args[0].t === 'star') {
      return (r, g) => { step(); return g.length; };
    }
    if (node.args.length < 1 || (name !== 'group_concat' && node.args.length !== 1) || node.args.length > 2) throw new EoqlError('E_ARITY', `${name} takes ${name === 'group_concat' ? '1 or 2' : 1} argument(s)`, { pos: node.pos });
    const inner = { ...sc, agg: false };
    const af = compile(node.args[0], inner);
    const sepf = node.args[1] ? compile(node.args[1], inner) : null;
    const distinct = !!node.distinct;
    return (r, g) => {
      step();
      const vals = new Array(g.length);
      for (let i = 0; i < g.length; i++) { vals[i] = af(g[i], undefined); step(); }
      return runAgg(name, vals, distinct, sepf ? sepf(g[0], undefined) : null);
    };
  }
  if (WIN_ONLY.has(name)) throw new EoqlError('E_TYPE', `window function ${name}() is only allowed in REC set`, { pos: node.pos });
  if (name === 'case') {
    const args = node.args.map((a) => compile(a, sc));
    if (args.length < 2) throw new EoqlError('E_ARITY', 'case needs at least a condition and a value');
    return (r, g) => {
      step();
      let i = 0;
      for (; i + 1 < args.length; i += 2) if (truth(args[i](r, g)) === 1) return args[i + 1](r, g);
      return i < args.length ? args[i](r, g) : null;
    };
  }
  if (name === 'cast') {
    if (node.args.length !== 2) throw new EoqlError('E_ARITY', 'cast takes 2 arguments', { pos: node.pos });
    const a0 = compile(node.args[0], sc);
    const t = node.args[1];
    if (t.t !== 'lit' || typeof t.v !== 'string') throw new EoqlError('E_TYPE', 'cast needs a type name as its second argument', { pos: node.pos });
    return (r, g) => { step(); return FN.cast([a0(r, g), t.v]); };
  }
  if (name === 'coalesce' || name === 'iif') { /* lazy not required */ }
  const f = FN[name];
  if (!f || !SCALAR_FNS.has(name)) throw new EoqlError('E_UNKNOWN_FUNC', `unknown function ${name}`, { pos: node.pos });
  const args = node.args.map((a) => compile(a, sc));
  // arity is validated at compile time by a dry call with NULLs of the right count
  try { f(new Array(args.length).fill(null)); } catch (e) { if (e instanceof EoqlError && e.code === 'E_ARITY') { e.pos = node.pos; throw e; } }
  return (r, g) => { step(); const a = new Array(args.length); for (let i = 0; i < args.length; i++) a[i] = args[i](r, g); return f(a); };
}

// column resolution -------------------------------------------------------------------------------------------
export function resolveColumn(sc, names) {
  const cols = sc.cols;
  if (!cols) return null;
  for (let i = names.length; i >= 1; i--) {
    const cand = names.slice(0, i).join('.');
    if (cols.has(cand)) return { col: cand, rest: names.slice(i) };
  }
  const first = names[0];
  const suffix = [];
  for (const c of sc.colList) if (c.endsWith('.' + first)) suffix.push(c);
  if (suffix.length === 1) return { col: suffix[0], rest: names.slice(1) };
  if (suffix.length > 1) throw new EoqlError('E_BIND_FIELD', `ambiguous column ${first}: ${suffix.join(', ')}`);
  const lc = first.toLowerCase();
  if (lc !== first && cols.has(lc)) return { col: lc, rest: names.slice(1) };
  return null;
}
function compilePath(node, sc) {
  const I = sc.interp;
  const names = node.parts.map((p) => (p.idx !== undefined ? p.idx : p.name));
  const strNames = []; const tail = [];
  for (let i = 0; i < names.length; i++) { if (typeof names[i] === 'number') { tail.push(...names.slice(i)); break; } strNames.push(names[i]); }
  const hit = resolveColumn(sc, strNames);
  if (!hit) {
    if (sc.onMissing) return sc.onMissing(node, strNames);
    if (sc.nonEmpty === false || !sc.cols) return () => null;
    if (sc.nonEmpty) {
      const err = new EoqlError('E_BIND_FIELD', `no row has a field named ${strNames.join('.')}`, { pos: node.pos, detail: { field: strNames.join('.'), hint: 'for text comparison use is, or quote the string' } });
      err.field = strNames.join('.');
      throw err;
    }
    return () => null;
  }
  const steps = [...hit.rest, ...tail];
  const col = hit.col;
  const st = steps.length;
  return (r) => {
    let v = r.c[col];
    if (v === undefined) { I.noField.n++; return null; }
    for (let i = 0; i < st; i++) { v = jsonStep(v, steps[i]); if (v === null) return null; }
    return v;
  };
}

export { likeMatch, globMatch };
