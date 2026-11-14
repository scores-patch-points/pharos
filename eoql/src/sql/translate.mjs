// sql/translate.mjs: SQL (SQLite dialect + accepted foreign spellings) -> EOQL (SPEC 8, SPEC-A1 2.2, 3.1).
// A compiler to text: never executes SQL and never concatenates values into the output (literals are printed by the
// canonical printer; placeholders become :params). Every construct is translated with all its clauses or raises a gap.
import { SUPPORTED_MODS, STRFTIME_SPECS } from '../dates.mjs';
import { EoqlError } from '../errors.mjs';
import { N, parse as parseEoql } from '../parse.mjs';
import { print } from '../print.mjs';
import { sha256, canonical } from '../util.mjs';
import { parseSql } from './parse.mjs';
import { FIXED } from '../catalog.mjs';

// ---- AST helpers (EOQL nodes) ----------------------------------------------------------------------------------------------
const lit = (v, real) => { const n = N('lit', 0, { v }); if (real && typeof v === 'number' && Number.isInteger(v)) n.real = true; return n; };
const str = (s) => lit(s);
const path = (...names) => N('path', 0, { parts: names.map((name) => ({ name })) });
const param = (name) => N('param', 0, { name });
const call = (name, args, distinct) => { const n = N('call', 0, { name, args }); if (distinct) n.distinct = true; return n; };
const bin = (op, a, b) => N('bin', 0, { op, a, b });
const rel = (op, a, b) => N('rel', 0, { op, a, b });
const not = (x) => N('not', 0, { x });
const list = (items) => N('list', 0, { items });
const obj = (pairs) => N('obj', 0, { pairs });
const ordered = (x, dir, nulls) => N('ordered', 0, { x, dir, nulls: nulls || null });
const star = () => N('star', 0, {});
const NULL = () => lit(null);
const READ_ORDER = {
  EVA: ['where'], SEG: ['table', 'keep', 'drop', 'addr', 'kinds', 'kind', 'writers', 'ids', 'where'], REC: ['by', 'order', 'set', 'rename', 'pick', 'rows'],
  SYN: ['by', 'agg', 'distinct', 'with', 'mode'], CON: ['to', 'on', 'join', 'as', 'to_as', 'follow', 'rel', 'dir', 'depth', 'in', 'until', 'include_seed'],
  DEF: ['asof', 'schema', 'collapse', 'anc', 'ordering', 'sort', 'limit', 'offset', 'bind', 'fix', 'base', 'step', 'mode', 'in'], INS: ['rows', 'columns', 'entries', 'anc'],
};
function V(verb, first, cl) {
  const clauses = Object.entries(cl).filter(([, v]) => v !== undefined && v !== null).map(([key, value]) => ({ key, value }));
  clauses.sort((a, b) => READ_ORDER[verb].indexOf(a.key) - READ_ORDER[verb].indexOf(b.key));
  return N('verb', 0, { verb, first, clauses });
}
const strList = (xs) => list(xs.map(str));
const AGG = new Set(['count', 'sum', 'total', 'avg', 'min', 'max', 'group_concat', 'string_agg', 'listagg']);
const WINF = new Set(['row_number', 'rank', 'dense_rank', 'ntile', 'lag', 'lead', 'first_value', 'last_value', 'nth_value']);
const SCALAR_MAP = { abs: 'abs', ceil: 'ceil', ceiling: 'ceil', floor: 'floor', round: 'round', sign: 'sign', length: 'length', lower: 'lower', upper: 'upper', substr: 'substr', substring: 'substr', instr: 'instr', replace: 'replace', trim: 'trim', ltrim: 'ltrim', rtrim: 'rtrim', coalesce: 'coalesce', ifnull: 'coalesce', nullif: 'nullif', iif: 'iif', typeof: 'typeof', json_array_length: 'json_array_length', json_valid: 'json_valid' };
const NONDET = new Set(['random', 'randomblob', 'changes', 'total_changes', 'last_insert_rowid', 'now', 'sqlite_version', 'current_timestamp', 'current_date', 'current_time', 'localtime', 'utc_timestamp']);
const BLOBF = new Set(['hex', 'zeroblob', 'unhex', 'randomblob', 'blob']);
const DATEF = new Set(['date', 'time', 'datetime', 'strftime', 'julianday', 'unixepoch']);
const DATE_OTHER = new Set(['timediff', 'date_trunc', 'to_char', 'date_format', 'extract', 'age']);

class Stop extends Error {}
const lc = (s) => String(s).toLowerCase();

// ---- scope --------------------------------------------------------------------------------------------------------------
class Scope {
  constructor(sources, joined, outer) { this.sources = sources; this.joined = joined; this.outer = outer || null; this.usingCols = new Map(); }
  find(parts) { // -> { src, col, level } | null | {ambiguous:true}
    const ps = parts.slice(-2);
    let level = 0; let sc = this;
    while (sc) {
      const hit = sc.local(ps);
      if (hit) return { ...hit, level };
      sc = sc.outer; level++;
    }
    return null;
  }
  local(ps) {
    if (ps.length === 2) {
      const src = this.sources.find((s) => lc(s.alias) === lc(ps[0]) || (s.name && lc(s.name) === lc(ps[0]) && !this.sources.some((o) => o !== s && lc(o.alias) === lc(ps[0]))));
      if (!src) return null;
      const col = src.cols.find((c) => lc(c.name) === lc(ps[1]));
      return col ? { src, col } : null;
    }
    const hits = [];
    for (const src of this.sources) { const col = src.cols.find((c) => lc(c.name) === lc(ps[0])); if (col) hits.push({ src, col }); }
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      const u = this.usingCols.get(lc(ps[0]));
      if (u) return { ...hits[0], using: u };
      return { ambiguous: true };
    }
    return null;
  }
}

// ---- the translator ---------------------------------------------------------------------------------------------------------
export class Translator {
  constructor(sql, opts = {}) {
    this.sql = sql; this.gaps = []; this.spellings = []; this.paramNames = []; this.notes = [];
    this.allowSpell = opts.spellings !== false;
    this.catalog = opts.catalogRelations || null;
    this.cteStack = []; this.sqN = 0; this.depth = 0; this.sdepth = 0;
  }
  gap(gap, construct, pos) { if (!this.gaps.some((g) => g.gap === gap && g.pos === pos)) this.gaps.push({ gap, construct, pos: pos === undefined ? 0 : pos }); }
  spell(construct, as, pos) { this.spellings.push({ construct, as, pos }); }
  addParam(name) { if (!this.paramNames.includes(name)) this.paramNames.push(name); return name; }

  // ---- entry ------------------------------------------------------------------------------------------------------
  top(ast) {
    switch (ast.t) {
      case 'select': { const r = this.tSelect(ast, null); return r; }
      case 'other': {
        const k = ast.kind;
        if (k === 'UPDATE') this.gap('SQL_UPDATE', 'UPDATE', ast.pos);
        else if (ast.upsert) this.gap('SQL_UPSERT', 'upsert', ast.pos);
        else if (ast.returning) this.gap('SQL_RETURNING', 'RETURNING', ast.pos);
        else if (k === 'INSERT' || k === 'REPLACE') this.gap('SQL_INSERT_SHAPE', k, ast.pos);
        else if (k === 'DELETE') this.gap('SQL_WRITE_NOT_BUILT', k, ast.pos);
        else if (k === 'MERGE') this.gap('SQL_UPSERT', 'MERGE', ast.pos);
        else this.gap('SQL_DDL', k, ast.pos);
        return null;
      }
      case 'multi': this.gap('SQL_MULTI_STATEMENT', 'more than one statement', ast.pos); return null;
      default: this.gap('SQL_UNSUPPORTED_EXPR', ast.t, 0); return null;
    }
  }

  // ---- catalog -----------------------------------------------------------------------------------------------------
  relation(name) {
    const rel = this.catalog && this.catalog[lc(name)] ? this.catalog[lc(name)] : (this.catalog && Object.keys(this.catalog).find((k) => lc(k) === lc(name)) ? this.catalog[Object.keys(this.catalog).find((k) => lc(k) === lc(name))] : null);
    return rel;
  }
  relName(name) { if (!this.catalog) return null; return Object.keys(this.catalog).find((k) => lc(k) === lc(name)) || null; }

  // ---- select statements --------------------------------------------------------------------------------------------------
  // -> { node, cols:[names], grouped, orderSensitive }
  tSelect(st, outer) {
    this.sdepth++;
    if (this.sdepth > 40) throw new EoqlError('E_LIMIT', 'SQL subquery nesting too deep', { detail: { lang: 'sql' } });
    try {
      if (st.fetch) { this.spell('OFFSET .. FETCH NEXT .. ROWS ONLY', 'limit/offset', st.pos); if (!this.allowSpell) this.gap('SQL_DIALECT_SPELLING', 'FETCH NEXT', st.pos); }
      if (st.limitAll) { this.spell('LIMIT ALL', 'no limit', st.pos); if (!this.allowSpell) this.gap('SQL_DIALECT_SPELLING', 'LIMIT ALL', st.pos); }
      const frame = new Map(); this.cteStack.push(frame);
      const defs = [];
      try {
        if (st.with) {
          for (const c of st.with.ctes) {
            const entry = { name: c.name, cols: null, rec: false };
            frame.set(lc(c.name), entry);
            const r = this.tCte(c, st.with.recursive, entry, outer);
            entry.cols = r.cols.map((n) => ({ name: n, affinity: '' }));
            defs.push({ name: c.name, r, recursive: r.recursive });
          }
        }
        let res;
        if (st.body.t === 'core' && !st.with) res = this.tCore(st.body, outer, st);
        else if (st.body.t === 'core') res = this.tCore(st.body, outer, st);
        else res = this.tCompoundBody(st.body, outer, st);
        if (defs.length) res = { ...res, node: this.wrapCtes(defs, res.node) };
        res.orderSensitive = !!st.orderBy;
        return res;
      } finally { this.cteStack.pop(); }
    } finally { this.sdepth--; }
  }
  wrapCtes(defs, body) {
    // consecutive non-recursive CTEs share one bind; a recursive CTE is its own fix; nesting preserves order
    let out = body;
    const groups = []; let cur = null;
    for (const d of defs) { if (d.recursive) { groups.push({ rec: d }); cur = null; } else { if (!cur) { cur = { binds: [] }; groups.push(cur); } cur.binds.push(d); } }
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      if (g.rec) out = V('DEF', null, { fix: str(g.rec.name), base: g.rec.r.base, step: g.rec.r.step, mode: g.rec.r.all ? str('union_all') : str('union'), in: out });
      else out = V('DEF', null, { bind: obj(g.binds.map((d) => ({ k: d.name, v: d.r.node }))), in: out });
    }
    return out;
  }
  tCte(c, recursiveKw, entry, outer) {
    const body = c.query.body;
    const isRec = recursiveKw && this.mentionsTable(c.query, c.name);
    if (!isRec) {
      const r = this.tSelect(c.query, outer);
      let node = r.node; let cols = r.cols;
      if (c.cols) { if (c.cols.length !== cols.length) { this.gap('SQL_UNSUPPORTED_EXPR', `CTE ${c.name} column list has ${c.cols.length} names for ${cols.length} columns`, c.pos); } else { node = this.renameCols(node, cols, c.cols); cols = c.cols; } }
      return { node, cols, recursive: false, grouped: r.grouped };
    }
    // recursive: linear form  base UNION [ALL] step, step mentions the name exactly once (SPEC 8.1)
    if (body.t !== 'compound' || body.op !== 'UNION' || c.query.orderBy || c.query.limit || c.query.with) { this.gap('SQL_RECURSIVE_SHAPE', `recursive CTE ${c.name}`, c.pos); return { node: NULL(), cols: c.cols || [], recursive: false }; }
    const baseAst = body.left, stepAst = body.right;
    if (this.mentionsTable({ t: 'select', body: baseAst, with: null }, c.name)) { this.gap('SQL_RECURSIVE_SHAPE', `recursive CTE ${c.name}: the base mentions the CTE`, c.pos); return { node: NULL(), cols: c.cols || [], recursive: false }; }
    const shapeOk = this.recursiveStepOk(stepAst, c.name);
    if (!shapeOk) { this.gap('SQL_RECURSIVE_SHAPE', `recursive CTE ${c.name}: the step is not of the linear form`, c.pos); return { node: NULL(), cols: c.cols || [], recursive: false }; }
    const baseSel = { t: 'select', body: baseAst, with: null, orderBy: null, limit: null, offset: null };
    const b = this.tSelect(baseSel, outer);
    const cols = c.cols && c.cols.length === b.cols.length ? c.cols : b.cols;
    entry.cols = cols.map((n) => ({ name: n, affinity: '' })); entry.rec = true;
    const stepSel = { t: 'select', body: stepAst, with: null, orderBy: null, limit: null, offset: null };
    const s = this.tSelect(stepSel, outer);
    if (s.cols.length !== cols.length) this.gap('SQL_RECURSIVE_SHAPE', `recursive CTE ${c.name}: base and step differ in column count`, c.pos);
    return { recursive: true, all: !!body.all, base: this.renameCols(b.node, b.cols, cols), step: this.renameCols(s.node, s.cols, cols), cols, node: NULL() };
  }
  renameCols(node, from, to) {
    const pairs = []; from.forEach((f, i) => { if (to[i] !== undefined && to[i] !== f) pairs.push({ k: f, v: str(to[i]) }); });
    if (!pairs.length) return node;
    // two-step to survive swaps: rename is applied simultaneously by the evaluator
    return V('REC', node, { rename: obj(pairs) });
  }
  mentionsTable(x, name) {
    let hit = false; const n = lc(name);
    const walk = (o) => {
      if (!o || typeof o !== 'object' || hit) return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (o.t === 'table' && lc(o.name) === n && !o.schema) { hit = true; return; }
      for (const k of Object.keys(o)) if (k !== 's' && k !== 'e') walk(o[k]);
    };
    walk(x); return hit;
  }
  recursiveStepOk(core, name) {
    if (core.t !== 'core' || core.distinct || core.groupBy || core.having || core.windows) return false;
    if (core.items.some((it) => it.x && (this.containsAgg(it.x) || this.containsWin(it.x)))) return false;
    // count mentions anywhere
    let count = 0; const n = lc(name);
    const walk = (o) => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) { o.forEach(walk); return; } if (o.t === 'table' && lc(o.name) === n && !o.schema) count++; for (const k of Object.keys(o)) if (k !== 's' && k !== 'e') walk(o[k]); };
    walk(core);
    if (count !== 1) return false;
    // the single mention must be a direct FROM leaf, and not on the null-supplying side of an outer join
    const ok = (f, nullSide) => {
      if (!f) return true;
      if (f.t === 'table') return !(lc(f.name) === n && nullSide) ;
      if (f.t === 'join') {
        const lNull = f.type === 'right' || f.type === 'full'; const rNull = f.type === 'left' || f.type === 'full';
        return ok(f.left, nullSide || lNull) && ok(f.right, nullSide || rNull);
      }
      if (f.t === 'sub' || f.t === 'group') return !this.mentionsTable(f, name);
      return true;
    };
    return ok(core.from, false);
  }

  tCompoundBody(body, outer, st) {
    const flat = this.tBodyNode(body, outer);
    let { node, cols } = flat;
    // ORDER BY / LIMIT on the compound: output names and ordinals only
    if (st.orderBy || st.limit || st.offset) node = this.applyTail(node, cols, st, null, outer, null);
    return { node, cols, grouped: false };
  }
  tBodyNode(b, outer) {
    if (b.t === 'compound') {
      const l = this.tBodyNode(b.left, outer), r = this.tBodyNode(b.right, outer);
      if (l.cols.length !== r.cols.length) this.gap('SQL_UNSUPPORTED_EXPR', 'compound members have different column counts', b.pos);
      let op = b.op;
      if (op === 'MINUS') { this.spell('MINUS', 'except', b.pos); if (!this.allowSpell) this.gap('SQL_DIALECT_SPELLING', 'MINUS', b.pos); op = 'EXCEPT'; }
      const mode = op === 'UNION' ? (b.all ? 'union_all' : 'union') : op === 'INTERSECT' ? 'intersect' : 'except';
      if ((op === 'INTERSECT' || op === 'EXCEPT') && b.all) this.gap('SQL_UNSUPPORTED_EXPR', `${op} ALL`, b.pos);
      return { node: V('SYN', l.node, { with: r.node, mode: str(mode) }), cols: l.cols };
    }
    if (b.t === 'paren') { const r = this.tSelect(b.query, outer); return { node: r.node, cols: r.cols }; }
    if (b.t === 'values') return this.tValues(b);
    const r = this.tCore(b, outer, { orderBy: null, limit: null, offset: null });
    return { node: r.node, cols: r.cols };
  }
  tValues(b) {
    const rows = b.rows.map((r) => list(r.map((x) => this.tExpr(x, this.ctx(new Scope([], false))))));
    const w = b.rows[0] ? b.rows[0].length : 0;
    for (const r of b.rows) if (r.length !== w) this.gap('SQL_UNSUPPORTED_EXPR', 'VALUES rows differ in width', b.pos);
    const cols = Array.from({ length: w }, (_, i) => 'column' + (i + 1));
    return { node: V('INS', null, { rows: list(rows), columns: strList(cols) }), cols, grouped: false };
  }

  ctx(scope) { return { scope, post: null, aggs: null, wins: null, outerUsed: false }; }

  // ---- FROM -----------------------------------------------------------------------------------------------------------------
  // -> { node, scope, grouped }
  tFrom(f, outer) {
    switch (f.t) {
      case 'table': {
        const alias = f.alias || f.name;
        const cte = this.lookupCte(f.name);
        if (cte && !f.schema) return { node: path(f.name), scope: new Scope([{ alias, name: f.name, cols: cte.cols || [] }], false, outer), grouped: false };
        const rname = this.relName(f.name);
        const rel = rname ? this.catalog[rname] : null;
        if (!rel) { this.gap('SQL_CATALOG_UNKNOWN', f.name, f.pos); return { node: NULL(), scope: new Scope([{ alias, name: f.name, cols: [] }], false, outer), grouped: false }; }
        return { node: V('SEG', path('sources'), { table: str(rname) }), scope: new Scope([{ alias, name: f.name, cols: rel.columns }], false, outer), grouped: false };
      }
      case 'sub': {
        const r = this.tSelect(f.query, outer);
        let node = r.node; let cols = r.cols;
        if (f.cols) { if (f.cols.length !== cols.length) this.gap('SQL_UNSUPPORTED_EXPR', 'column alias list length', f.pos); else { node = this.renameCols(node, cols, f.cols); cols = f.cols; } }
        return { node, scope: new Scope([{ alias: f.alias || '', name: f.alias || '', cols: cols.map((n) => ({ name: n, affinity: '' })) }], false, outer), grouped: !!r.grouped };
      }
      case 'tablefn': return this.tTableFn(f, outer);
      case 'group': return this.tFrom(f.inner, outer);
      case 'join': return this.tJoin(f, outer);
      default: this.gap('SQL_UNSUPPORTED_EXPR', f.t, f.pos); return { node: NULL(), scope: new Scope([], false, outer), grouped: false };
    }
  }
  // table-valued functions with constant arguments become literal rows (INS): json_each(<json text> [, <path>]) and generate_series.
  // Arguments that mention a column (a lateral use) have no landing: that is the gap.
  tTableFn(f, outer) {
    const miss = (why) => { this.gap('SQL_TABLE_FUNCTION', `${f.name}${why ? ' ' + why : ''}`, f.pos); return { node: NULL(), scope: new Scope([{ alias: f.alias || f.name, name: f.name, cols: [] }], false, outer), grouped: false }; };
    const nm = lc(f.name); const args = f.args || [];
    const cv = (a) => { let x = a; while (x && x.t === 'paren') x = x.x; if (!x) return undefined; if (x.t === 'str') return x.v; if (x.t === 'num' && !x.hex) return Number(x.v); if (x.t === 'null') return null; if (x.t === 'un' && x.op === '-' && x.x.t === 'num') return -Number(x.x.v); return undefined; };
    const vals = args.map(cv);
    if (vals.some((v) => v === undefined)) return miss('with an argument that is not a constant (a lateral or computed argument)');
    const alias = f.alias || f.name;
    const mk = (cols, rows) => ({ node: V('INS', null, { rows: list(rows.map((r) => list(r.map((v) => (v === null ? NULL() : lit(v)))))), columns: strList(cols) }), scope: new Scope([{ alias, name: f.name, cols: cols.map((c) => ({ name: c, affinity: '' })) }], false, outer), grouped: false });
    if (nm === 'generate_series') {
      if (vals.length < 2 || vals.length > 3 || vals.some((v) => typeof v !== 'number' || !Number.isInteger(v))) return miss('with arguments other than integer constants');
      const [a, b] = vals; const st = vals.length === 3 ? vals[2] : 1;
      if (st === 0 || (b - a) / st > 100000) return miss('with a step of 0 or more than 100000 rows');
      const rows = []; if (st > 0) for (let v = a; v <= b; v += st) rows.push([v]); else for (let v = a; v >= b; v += st) rows.push([v]);
      return mk(['value'], rows);
    }
    if (nm === 'json_each') {
      if (vals.length < 1 || vals.length > 2 || typeof vals[0] !== 'string') return miss('with a first argument that is not a JSON text constant');
      let doc; try { doc = JSON.parse(vals[0]); } catch (e) { return miss('with malformed JSON'); }
      let base = doc; let fullBase = '$';
      if (vals.length === 2) { const m = /^\$((?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*)$/.exec(String(vals[1])); if (!m) return miss('with a path outside the supported subset'); const steps = [...m[1].matchAll(/\.([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]/g)]; for (const st of steps) { if (base === null || typeof base !== 'object') { base = undefined; break; } base = st[1] !== undefined ? base[st[1]] : base[Number(st[2])]; if (base === undefined) break; } fullBase = String(vals[1]); }
      const typeOf = (v) => (v === null ? 'null' : v === true ? 'true' : v === false ? 'false' : typeof v === 'number' ? (Number.isInteger(v) && !/[.eE]/.test(String(v)) ? 'integer' : 'real') : typeof v === 'string' ? 'text' : Array.isArray(v) ? 'array' : 'object');
      const row = (k, v, fullkey, path) => { const t = typeOf(v); const container = t === 'array' || t === 'object'; const val = container ? JSON.stringify(v) : t === 'true' ? 1 : t === 'false' ? 0 : v; return [k, val, t, container ? null : val, fullkey, path]; };
      const rows = [];
      if (base === undefined) return mk(['key', 'value', 'type', 'atom', 'fullkey', 'path'], []);
      if (Array.isArray(base)) base.forEach((v, i) => rows.push(row(i, v, `${fullBase}[${i}]`, fullBase)));
      else if (base !== null && typeof base === 'object') for (const k of Object.keys(base)) rows.push(row(k, base[k], `${fullBase}.${k}`, fullBase));
      else rows.push(row(null, base, fullBase, fullBase));
      return mk(['key', 'value', 'type', 'atom', 'fullkey', 'path'], rows);
    }
    return miss('');
  }
  lookupCte(name) { for (let i = this.cteStack.length - 1; i >= 0; i--) { const e = this.cteStack[i].get(lc(name)); if (e) return e; } return null; }
  tJoin(f, outer) {
    if (f.natural) { this.gap('SQL_NATURAL_JOIN', 'NATURAL JOIN', f.pos); }
    const L = this.tFrom(f.left, outer); const R = this.tFrom(f.right, outer);
    if (f.right.t === 'join' || (f.right.t === 'group' && f.right.inner.t === 'join')) this.gap('SQL_UNSUPPORTED_EXPR', 'a parenthesised join on the right of a join', f.pos);
    const sources = [...L.scope.sources, ...R.scope.sources];
    const scope = new Scope(sources, true, outer);
    for (const [k, v] of L.scope.usingCols) scope.usingCols.set(k, v);
    const leftIsJoin = L.scope.joined;
    const lSrc0 = L.scope.sources[0];
    let on = null;
    if (f.using) {
      const conj = f.using.map((c) => {
        const l = L.scope.sources.find((s) => s.cols.some((x) => lc(x.name) === lc(c))); const r = R.scope.sources[0];
        const ls = l ? l.alias : '?';
        scope.usingCols.set(lc(c), { left: ls, right: r.alias, type: f.type, col: c });
        return rel('=', path(ls, c), path(r.alias, c));
      });
      on = conj.reduce((a, b) => (a ? bin('AND', a, b) : b), null);
    } else if (f.on) { on = this.tExpr(f.on, this.ctx(scope)); }
    const join = f.type === 'cross' ? 'cross' : f.type;
    if ((f.type === 'inner' || f.type === 'left' || f.type === 'right' || f.type === 'full') && !f.on && !f.using && !f.natural) { /* inner join with no condition is a cross join in SQLite */ }
    const node = V('CON', L.node, { to: R.node, on: f.type === 'cross' ? null : on, join: str(join === 'inner' && !on ? 'cross' : join), as: leftIsJoin ? null : str(lSrc0.alias), to_as: R.scope.joined ? null : str(R.scope.sources[0].alias) });
    return { node, scope, grouped: false };
  }

  // ---- core select ------------------------------------------------------------------------------------------------------------------
  tCore(core, outer, tail) {
    const stub = { node: NULL(), cols: [], grouped: false };
    if (core.t === 'values') { const v = this.tValues(core); let node = v.node; if (tail && (tail.orderBy || tail.limit || tail.offset)) node = this.applyTail(node, v.cols, tail, null, outer, null); return { ...v, node }; }
    if (core.distinctOn) this.gap('SQL_DISTINCT_ON', 'DISTINCT ON', core.pos);
    if (core.connectBy) this.gap('SQL_CONNECT_BY', 'CONNECT BY / START WITH', core.connectBy.pos);
    if (core.groupBy) for (const g of core.groupBy) if (g.t === 'groupingsets') this.gap('SQL_GROUPING_SETS', g.kw, g.s);
    let F, scope;
    if (core.from) { const r = this.tFrom(core.from, outer); F = r.node; scope = r.scope; var grouped = r.grouped; } else { F = V('INS', null, { rows: list([list([lit(1)])]), columns: strList(['_one']) }); scope = new Scope([], false, outer); grouped = false; }
    scope.aliases = new Map(); for (const it of core.items) if (!it.star && it.alias) scope.aliases.set(lc(it.alias), it.x);
    // correlated scalar subqueries that are plain aggregates become a LEFT join of the grouped inner relation (decorrelation)
    { const pre = this.scalarPrepass(core, tail, scope, F); if (pre) { core = pre.core; tail = pre.tail; scope = pre.scope; F = pre.node; } }
    // WHERE: conjuncts; correlated EXISTS / IN (subquery) become semi/anti joins
    let wherePlain = []; const semis = [];
    if (core.where) {
      for (const c of this.conjuncts(core.where)) {
        const sj = this.trySemi(c, scope, F);
        if (sj === 'gap') continue;
        if (sj) semis.push(sj); else wherePlain.push(c);
      }
    }
    let node = F;
    if (wherePlain.length) {
      const preds = wherePlain.map((c) => this.tExpr(c, this.ctx(scope)));
      node = V('EVA', node, { where: preds.reduce((a, b) => bin('AND', a, b)) });
    }
    for (const sj of semis) node = V('CON', node, sj);
    // expand select items
    const items = []; // { x (sql expr), alias, text, name, expr: eoql term pending }
    for (const it of core.items) {
      if (it.star) {
        const srcs = (it.table ? scope.sources.filter((s) => lc(s.alias) === lc(it.table) || lc(s.name || '') === lc(it.table)) : scope.sources).filter((s) => !s.hidden);
        if (it.table && !srcs.length) { this.gap('SQL_UNSUPPORTED_EXPR', `${it.table}.*`, it.pos); continue; }
        for (const s of srcs) for (const c of s.cols) {
          if (!it.table && scope.usingCols.has(lc(c.name)) && s !== scope.sources[0] && scope.usingCols.get(lc(c.name)).right === s.alias) continue; // USING column appears once
          items.push({ x: { t: 'col', parts: [s.alias, c.name], synth: true, s: it.pos, e: it.pos }, alias: null, name: c.name });
        }
      } else items.push({ x: it.x, alias: it.alias, text: it.text, name: null });
    }
    const aggregated = !!core.groupBy || items.some((it) => this.containsAgg(it.x)) || (core.having && this.containsAgg(core.having)) || (tail && tail.orderBy && tail.orderBy.some((o) => this.containsAgg(o.x)));
    const ctx = this.ctx(scope); ctx.aggs = new Map(); ctx.wins = []; ctx.windowDefs = core.windows || {};
    let keyNodes = []; let preSet = null; let bareExtreme = null;
    if (aggregated) {
      const keys = [];
      for (const g of core.groupBy || []) {
        let gx = g;
        if (g.t === 'num' && !g.real && !g.hex) { const k = Number(g.v); if (k >= 1 && k <= items.length) gx = items[k - 1].x; else this.gap('SQL_UNSUPPORTED_EXPR', 'GROUP BY ordinal out of range', g.s); } else if (g.t === 'col' && g.parts.length === 1 && !this.resolveQuiet(g, scope)) { const al = items.find((it) => it.alias && lc(it.alias) === lc(g.parts[0])); if (al) gx = al.x; }
        if (g.t === 'groupingsets') continue;
        if (this.containsAgg(gx)) { this.gap('SQL_UNSUPPORTED_EXPR', 'aggregate in GROUP BY', g.s); continue; }
        keys.push(gx);
      }
      // SQLite lets a bare column ride along with exactly one min() or max(): its value comes from the row that holds the extreme.
      // That has a faithful landing (window aggregates over the group plus the first row by the extreme); any other bare column
      // is an arbitrary row and stays the gap SQL_BARE_COLUMN.
      const roots = [...items.map((it) => it.x), ...(core.having ? [core.having] : []), ...((tail && tail.orderBy) ? tail.orderBy.map((o) => o.x) : [])];
      const keySk = new Set(keys.map((k) => this.skey(k, scope)));
      if (this.hasBare(roots, keySk, scope)) { const mm = this.extremeAggs(roots); if (mm.length === 1 && !this.hasDistinctAgg(roots)) bareExtreme = mm[0]; }
      ctx.post = bareExtreme ? null : { keys: [], key: new Map() };
      const sets = []; const byTerms = [];
      keys.forEach((kx, i) => {
        const term = this.tExpr(kx, this.ctx(scope));
        let name;
        if (term.t === 'path' && term.parts.every((p) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(p.name)) && !['set', 'first', 'last', 'is', 'in', 'not', 'null', 'true', 'false', 'by', 'contains', 'between', 'like', 'glob', 'escape', 'distinct', 'asc', 'desc', 'nulls'].includes(term.parts[term.parts.length - 1].name.toLowerCase())) { name = term.parts.map((p) => p.name).join('.'); byTerms.push(term); } else { name = `_k${i + 1}`; sets.push({ k: name, v: term }); byTerms.push(path(name)); }
        if (ctx.post) { ctx.post.key.set(this.skey(kx, scope), name); ctx.post.keys.push(name); }
      });
      keyNodes = byTerms; preSet = sets;
    }
    // translate select items, having and order terms (collecting aggregates and windows)
    const translated = items.map((it) => ({ ...it, t: this.tExpr(it.x, ctx) }));
    let havingT = null;
    if (core.having) { if (!aggregated) { /* HAVING without aggregates: a plain filter */ } havingT = this.tExpr(core.having, ctx); }
    // names
    const names = []; const used = new Map();
    translated.forEach((it) => {
      let nm = it.alias !== null && it.alias !== undefined ? it.alias : it.name !== null ? it.name : (it.x.t === 'col' && !it.x.synth ? it.x.parts[it.x.parts.length - 1] : (it.x.t === 'paren' && false) ? it.text : it.text);
      if (it.x.t === 'col' && it.x.synth) nm = it.name;
      const key = lc(nm);
      if (used.has(key)) { const c = used.get(key) + 1; used.set(key, c); const alt = `${nm}#${c}`; this.notes.push({ code: 'duplicate-output-name', detail: `${nm} -> ${alt}` }); nm = alt; used.set(lc(alt), 1); } else used.set(key, 1);
      names.push(nm); it.outName = nm;
    });
    // order by
    let orderT = null;
    if (tail && tail.orderBy) orderT = this.tOrderTerms(tail.orderBy, translated, ctx, scope, names);
    // assemble
    if (aggregated) {
      let g = node;
      if (preSet && preSet.length) g = V('REC', g, { set: obj(preSet) });
      const aggPairs = [...ctx.aggs.values()].map((a) => ({ k: a.name, v: a.node }));
      if (bareExtreme) {
        // window aggregates over the whole group, then the first row of each group by the extreme (ties: input order, as SQLite's strict comparison keeps the first)
        const byL = keyNodes.length ? list(keyNodes) : undefined;
        g = V('REC', g, { by: byL, set: aggPairs.length ? obj(aggPairs) : undefined });
        const xt = this.tExpr(bareExtreme.args[0], { ...ctx, post: null, aggs: null });
        g = V('REC', g, { by: byL, order: list([ordered(xt, lc(bareExtreme.name) === 'max' ? 'desc' : 'asc', 'last')]), set: obj([{ k: '_rn', v: call('row_number', []) }]) });
        g = V('EVA', g, { where: rel('=', path('_rn'), lit(1)) });
      } else g = V('SYN', g, { by: keyNodes.length ? list(keyNodes) : (grouped ? list([]) : undefined), agg: aggPairs.length ? obj(aggPairs) : undefined });
      node = g;
      if (havingT) node = V('EVA', node, { where: havingT });
    } else if (havingT) node = V('EVA', node, { where: havingT });
    // windows
    let outGrouped = grouped;
    if (ctx.wins.length) {
      const bySpec = new Map();
      for (const w of ctx.wins) { if (!bySpec.has(w.specKey)) bySpec.set(w.specKey, { w, sets: [] }); bySpec.get(w.specKey).sets.push({ k: w.name, v: w.call }); }
      for (const { w, sets } of bySpec.values()) {
        node = V('REC', node, { by: w.part.length ? list(w.part) : undefined, order: w.ord.length ? list(w.ord) : undefined, set: obj(sets), rows: w.rows ? list(w.rows.map((x) => (x === null ? NULL() : lit(x)))) : undefined });
        if (w.part.length) outGrouped = true;
      }
    }
    // select
    const sets = translated.map((it, i) => ({ k: `_c${i + 1}`, v: it.t }));
    const hidden = orderT ? orderT.hidden : [];
    for (const h of hidden) sets.push(h);
    const renames = translated.map((it, i) => ({ k: `_c${i + 1}`, v: str(it.outName) }));
    const picks = translated.map((it) => it.outName);
    const selNames = translated.map((_, i) => `_c${i + 1}`);
    let tailLimit = tail && (tail.limit || tail.offset);
    if (core.distinct) {
      node = V('REC', node, { set: obj(sets.filter((s) => selNames.includes(s.k))), rename: obj(renames), pick: strList(picks) });
      node = V('SYN', node, { distinct: lit(true) });
      if (orderT) { // only output names are available after DISTINCT
        const keys = orderT.sortOutputs(picks);
        if (keys) node = this.defTail(node, keys, tail, scope);
        else node = this.defTail(node, null, tail, scope);
      } else if (tailLimit) node = this.defTail(node, null, tail, scope);
      return { node, cols: picks, grouped: false };
    }
    if (orderT) {
      node = V('REC', node, { set: obj(sets) });
      node = this.defTail(node, orderT.sortSelected(selNames), tail, scope);
      node = V('REC', node, { rename: obj(renames), pick: strList(picks) });
    } else {
      node = V('REC', node, { set: obj(sets), rename: obj(renames), pick: strList(picks) });
      if (tailLimit) node = this.defTail(node, null, tail, scope);
    }
    void stub;
    return { node, cols: picks, grouped: outGrouped };
  }
  defTail(node, keys, tail, scope) {
    const cl = {};
    if (keys && keys.length) cl.sort = list(keys);
    const lim = this.tLimit(tail.limit, scope); const off = this.tLimit(tail.offset, scope);
    if (lim !== undefined) cl.limit = lim;
    if (off !== undefined) cl.offset = off;
    if (!Object.keys(cl).length) return node;
    return V('DEF', node, cl);
  }
  tLimit(x, scope) {
    if (!x) return undefined;
    if (x.t === 'num' && !x.real && !x.hex && Number(x.v) >= 0) return lit(Number(x.v));
    if (x.t === 'un' && x.op === '-' && x.x.t === 'num') return undefined; // LIMIT -1: no limit
    return this.tExpr(x, this.ctx(new Scope([], false, null)));
  }
  applyTail(node, cols, st, _a, outer, _b) {
    // ORDER BY / LIMIT over an already-projected world: terms are output names or ordinals
    let keys = null;
    if (st.orderBy) {
      keys = [];
      for (const o of st.orderBy) {
        let nm = null;
        if (o.x.t === 'num' && !o.x.real) { const k = Number(o.x.v); if (k >= 1 && k <= cols.length) nm = cols[k - 1]; else this.gap('SQL_UNSUPPORTED_EXPR', 'ORDER BY ordinal out of range', o.x.s); } else if (o.x.t === 'col' && o.x.parts.length === 1) { nm = cols.find((c) => lc(c) === lc(o.x.parts[0])) || null; if (nm === null) this.gap('SQL_UNSUPPORTED_EXPR', 'ORDER BY in a compound or VALUES must name an output column', o.x.s); } else this.gap('SQL_UNSUPPORTED_EXPR', 'ORDER BY in a compound or VALUES must name an output column', o.x.s);
        if (nm === null) continue;
        let t = path(nm);
        t = this.collate(t, o.coll, o.x.s);
        keys.push(ordered(t, o.dir, o.nulls));
      }
    }
    return this.defTail(node, keys, st, new Scope([], false, outer));
  }
  collate(t, coll, pos) {
    if (!coll) return t;
    const c = lc(coll);
    if (c === 'binary') return t;
    if (c === 'nocase') return call('nocase', [t]);
    this.gap('SQL_COLLATION', coll, pos); return t;
  }
  tOrderTerms(orderBy, items, ctx, scope, names) {
    const hidden = []; const entries = [];
    orderBy.forEach((o, i) => {
      let ref = null; // { sel: index } or { term }
      if (o.x.t === 'num' && !o.x.real && !o.x.hex) { const k = Number(o.x.v); if (k >= 1 && k <= items.length) ref = { sel: k - 1 }; else this.gap('SQL_UNSUPPORTED_EXPR', 'ORDER BY ordinal out of range', o.x.s); } else if (o.x.t === 'col' && o.x.parts.length === 1) {
        const k = names.findIndex((nm) => lc(nm) === lc(o.x.parts[0]));
        const al = items.findIndex((it) => it.alias && lc(it.alias) === lc(o.x.parts[0]));
        if (al >= 0) ref = { sel: al }; else if (k >= 0 && !this.resolveQuiet(o.x, scope) ) ref = { sel: k };
      }
      if (!ref) {
        // an expression equal to a select item is that item
        const sk = this.skey(o.x, scope); const same = items.findIndex((it) => this.skey(it.x, scope) === sk);
        if (same >= 0) ref = { sel: same };
      }
      if (ref) entries.push({ sel: ref.sel, o });
      else { const t = this.tExpr(o.x, ctx); const name = `_o${hidden.length + 1}`; hidden.push({ k: name, v: t }); entries.push({ hid: name, o }); }
    });
    const key = (e, nameOf) => ordered(this.collate(path(nameOf), e.o.coll, e.o.x.s), e.o.dir, e.o.nulls);
    return {
      hidden,
      sortSelected: (selNames) => entries.map((e) => key(e, e.sel !== undefined ? selNames[e.sel] : e.hid)),
      sortOutputs: (picks) => { if (entries.some((e) => e.hid)) { this.gap('SQL_UNSUPPORTED_EXPR', 'ORDER BY a non-selected expression with DISTINCT', entries.find((e) => e.hid).o.x.s); return null; } return entries.map((e) => key(e, picks[e.sel])); },
    };
  }

  // ---- WHERE conjuncts and semi/anti joins -----------------------------------------------------------------------------------------
  conjuncts(x) { if (x.t === 'bin' && x.op === 'AND') return [...this.conjuncts(x.a), ...this.conjuncts(x.b)]; if (x.t === 'paren' && x.x.t === 'bin' && x.x.op === 'AND') return this.conjuncts(x.x); return [x]; }
  trySemi(c, scope, outerWorld) {
    void outerWorld;
    let neg = false; let x = c;
    if (x.t === 'not') { neg = true; x = x.x; }
    while (x.t === 'paren') x = x.x;
    if (x.t === 'exists') { if (x.neg) neg = !neg; return this.semiExists(x, neg, scope); }
    if (x.t === 'in' && x.query) { if (x.neg) neg = !neg; return this.semiIn(x, neg, scope); }
    return null;
  }
  // translate an inner query's FROM and split its WHERE into filters and correlation pairs
  decorrelate(q, scope, what, opts = {}) {
    if (q.with || q.orderBy || q.limit || q.offset || q.body.t !== 'core') { return null; }
    const core = q.body;
    if (core.groupBy || core.having || core.distinct || core.windows || !core.from) return null;
    if (core.items.some((it) => it.x && ((!opts.allowAgg && this.containsAgg(it.x)) || this.containsWin(it.x)))) return null;
    const inner = this.tFrom(core.from, null);
    const iscope = new Scope(inner.scope.sources, inner.scope.joined, null);
    iscope.usingCols = inner.scope.usingCols;
    const filters = []; const pairs = [];
    const refsOf = (e) => { const r = { inner: false, outer: false, bad: false }; this.walkCols(e, (col) => { const ps = col.parts.slice(-2); const li = iscope.local(ps); if (li && !li.ambiguous) r.inner = true; else { const o = scope.find(col.parts); if (o && !o.ambiguous) r.outer = true; else if (!(col.dq)) r.bad = true; } }); return r; };
    for (const cj of core.where ? this.conjuncts(core.where) : []) {
      const r = refsOf(cj);
      if (!r.outer) { filters.push(cj); continue; }
      let ok = false;
      if (cj.t === 'bin' && cj.op === '=') {
        const ra = refsOf(cj.a), rb = refsOf(cj.b);
        if (ra.outer && !ra.inner && rb.inner && !rb.outer) { pairs.push({ outerX: cj.a, innerX: cj.b }); ok = true; } else if (rb.outer && !rb.inner && ra.inner && !ra.outer) { pairs.push({ outerX: cj.b, innerX: cj.a }); ok = true; }
      }
      if (!ok) { this.gap('SQL_CORRELATED_OTHER', what, cj.s); return 'gap'; }
    }
    if (core.where && this.containsSubq(core.where)) { /* nested subqueries inside the inner WHERE are translated with the inner scope */ }
    return { core, inner, iscope, filters, pairs };
  }
  // ---- correlated scalar subqueries: (SELECT <aggregate expr> FROM t WHERE t.k = outer.k [AND filters]) ---------------------------
  // A LEFT join of the inner relation grouped by its correlation keys, one row per key, carrying the value (_v) and a presence marker (_m).
  // For an outer row with no inner rows the SQL value is that of the expression over an empty set (count 0, total 0.0, others NULL),
  // computed here by evaluating the expression on empty aggregates; shapes that cannot be evaluated that way stay the gap.
  scalarPrepass(core, tail, scope, F) {
    if (core.groupBy || core.having || core.distinct || core.items.some((it) => it.x && (this.containsAgg(it.x) || this.containsWin(it.x)))) return null;
    const cands = [];
    const walk = (o) => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) { o.forEach(walk); return; } if (o.t === 'subq') { cands.push(o); return; } if (o.t === 'exists') return; if (o.t === 'in' && o.query) { walk(o.x); return; } for (const k of Object.keys(o)) if (k !== 's' && k !== 'e') walk(o[k]); };
    core.items.forEach((it) => walk(it.x)); walk(core.where); if (tail && tail.orderBy) tail.orderBy.forEach((o) => walk(o.x));
    const corr = cands.filter((c) => this.isCorrelated(c.query, scope));
    if (!corr.length) return null;
    let node = F; let sc = scope; const repl = new Map();
    for (const c of corr) {
      const q = c.query; const body = q.body;
      if (!body || body.t !== 'core' || body.items.length !== 1 || body.items[0].star || !this.containsAgg(body.items[0].x) || this.containsWin(body.items[0].x)) continue;
      const d = this.decorrelate(q, sc, 'scalar subquery', { allowAgg: true });
      if (d === 'gap' || !d || !d.pairs.length) continue;
      if (!sc.joined && !(sc.sources[0] && sc.sources[0].alias)) continue;
      const n = ++this.sqN; const al = `_s${n}`;
      let R = d.inner.node;
      if (d.filters.length) R = V('EVA', R, { where: d.filters.map((c2) => this.tExpr(c2, this.ctx(d.iscope))).reduce((a, b) => bin('AND', a, b)) });
      const keyNames = d.pairs.map((_, i) => `_k${i + 1}`);
      R = V('REC', R, { set: obj(d.pairs.map((pr, i) => ({ k: keyNames[i], v: this.tExpr(pr.innerX, this.ctx(d.iscope)) }))) });
      const actx = this.ctx(d.iscope); actx.aggs = new Map(); actx.wins = [];
      const valT = this.tExpr(body.items[0].x, actx);
      const aggPairs = [...actx.aggs.values()].map((a) => ({ k: a.name, v: a.node }));
      const aggNames = new Map([...actx.aggs.values()].map((a) => [a.name, lc(a.node.name)]));
      const empty = this.emptyOf(valT, aggNames);
      if (empty === undefined) { this.gap('SQL_CORRELATED_SCALAR', 'correlated scalar subquery whose value over an empty set cannot be determined', c.s); continue; }
      R = V('SYN', R, { by: list(keyNames.map((k) => path(k))), agg: obj(aggPairs) });
      R = V('REC', R, { set: obj([{ k: '_v', v: valT }, { k: '_m', v: lit(1) }]), pick: strList([...keyNames, '_v', '_m']) });
      const newSrc = { alias: al, name: null, hidden: true, cols: [...keyNames, '_v', '_m'].map((nm) => ({ name: nm, affinity: '' })) };
      const ns = new Scope([...sc.sources, newSrc], true, sc.outer); ns.usingCols = sc.usingCols; ns.aliases = sc.aliases;
      const on = d.pairs.map((pr, i) => rel('=', this.tExpr(pr.outerX, this.ctx(ns)), path(al, keyNames[i]))).reduce((a, b) => bin('AND', a, b));
      node = V('CON', node, { to: R, on, join: str('left'), as: sc.joined ? undefined : str(sc.sources[0].alias), to_as: str(al) });
      sc = ns;
      const v = path(al, '_v');
      repl.set(c, { t: 'eoqlterm', term: empty === null ? v : call('case', [N('isnull', 0, { x: path(al, '_m'), neg: false }), empty, v]), s: c.s, e: c.e });
    }
    if (!repl.size) return null;
    const sub = (o) => { if (!o || typeof o !== 'object') return o; if (Array.isArray(o)) return o.map(sub); if (repl.has(o)) return repl.get(o); const out = {}; for (const k of Object.keys(o)) out[k] = sub(o[k]); return out; };
    const core2 = { ...core, items: core.items.map((it) => ({ ...it, x: sub(it.x) })), where: sub(core.where) };
    const tail2 = tail ? { ...tail, orderBy: tail.orderBy ? tail.orderBy.map((o) => ({ ...o, x: sub(o.x) })) : tail.orderBy } : tail;
    sc.aliases = new Map(); for (const it of core2.items) if (!it.star && it.alias) sc.aliases.set(lc(it.alias), it.x);
    return { core: core2, tail: tail2, scope: sc, node };
  }
  // the value of an aggregate expression over an empty input: a term node (lit), null for NULL, undefined when it cannot be said
  emptyOf(t, aggNames) {
    const NUL = Symbol('null');
    const ev = (n) => {
      if (n.t === 'lit') return n.v === null ? NUL : (n.real && Number.isInteger(n.v) ? { real: n.v } : n.v);
      if (n.t === 'path' && n.parts.length === 1 && aggNames.has(n.parts[0].name)) { const a = aggNames.get(n.parts[0].name); return a === 'count' ? 0 : a === 'total' ? { real: 0 } : NUL; }
      if (n.t === 'call' && (n.name === 'coalesce')) { for (const a of n.args) { const v = ev(a); if (v === undefined) return undefined; if (v !== NUL) return v; } return NUL; }
      if (n.t === 'bin' && ['+', '-', '*', '/', '%', '||'].includes(n.op)) { const a = ev(n.a), b = ev(n.b); if (a === undefined || b === undefined) return undefined; if (a === NUL || b === NUL) return NUL; const x = typeof a === 'number' ? a : (a && typeof a === 'object' ? a.real : null), y = typeof b === 'number' ? b : (b && typeof b === 'object' ? b.real : null); if (x === null || x === undefined || y === null || y === undefined || !['+', '-', '*'].includes(n.op)) return undefined; const r = n.op === '+' ? x + y : n.op === '-' ? x - y : x * y; return typeof a === 'number' && typeof b === 'number' ? r : { real: r }; }
      if (n.t === 'rel') { const a = ev(n.a), b = ev(n.b); if (a === undefined || b === undefined) return undefined; if (a === NUL || b === NUL) return NUL; return undefined; }
      if (n.t === 'call' && ['abs', 'round', 'ceil', 'floor', 'sign', 'length', 'lower', 'upper', 'substr', 'trim', 'ltrim', 'rtrim', 'cast'].includes(n.name)) { const a = ev(n.args[0]); if (a === undefined) return undefined; return a === NUL ? NUL : undefined; }
      return undefined;
    };
    const v = ev(t);
    if (v === undefined) return undefined;
    if (v === NUL) return null;
    return typeof v === 'object' ? lit(v.real, true) : lit(v);
  }
  semiParts(d, scope, extraPair) {
    const { inner, iscope, filters, pairs } = d;
    let R = inner.node;
    if (filters.length) { const fs = filters.map((c) => this.tExpr(c, this.ctx(iscope))); R = V('EVA', R, { where: fs.reduce((a, b) => bin('AND', a, b)) }); }
    const innerAlias = iscope.joined ? null : 'r';
    const outerQual = (term) => term; void outerQual;
    const conds = [];
    const all = extraPair ? [...pairs, extraPair] : pairs;
    for (const p of all) {
      const o = this.tExpr(p.outerX, { ...this.ctx(scope), outerAlias: scope.joined ? null : 'l' });
      const i = this.tExpr(p.innerX, { ...this.ctx(iscope), outerAlias: innerAlias });
      conds.push(rel('=', o, i));
    }
    return { R, on: conds.length ? conds.reduce((a, b) => bin('AND', a, b)) : null, rAlias: iscope.joined ? null : 'r' };
  }
  semiExists(x, neg, scope) {
    const d = this.decorrelate(x.query, scope, 'EXISTS');
    if (d === 'gap') return 'gap';
    if (!d) { return null; }
    if (!d.pairs.length) return null; // uncorrelated: handled as a scalar test in term position
    const p = this.semiParts(d, scope, null);
    return { to: p.R, on: p.on, join: str(neg ? 'anti' : 'semi') };
  }
  semiIn(x, neg, scope) {
    const q = x.query;
    // correlated IN (subselect): single non-aggregate select item, equality correlation
    const core = q.body && q.body.t === 'core' ? q.body : null;
    if (!core || core.items.length !== 1 || core.items[0].star) return null;
    const d = this.decorrelate(q, scope, 'IN');
    if (d === 'gap') return 'gap';
    if (!d || !d.pairs.length) return null;
    const p = this.semiParts(d, scope, { outerX: x.x, innerX: core.items[0].x });
    return { to: p.R, on: p.on, join: str(neg ? 'anti_null' : 'semi') };
  }
  walkCols(x, fn) {
    const w = (o) => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(w); return; }
      if (o.t === 'col') { fn(o); return; }
      if (o.t === 'subq' || o.t === 'exists') { return; }
      if (o.t === 'in' && o.query) { w(o.x); return; }
      for (const k of Object.keys(o)) if (k !== 's' && k !== 'e') w(o[k]);
    };
    w(x);
  }
  containsSubq(x) { let hit = false; const w = (o) => { if (!o || typeof o !== 'object' || hit) return; if (Array.isArray(o)) { o.forEach(w); return; } if (o.t === 'subq' || o.t === 'exists' || (o.t === 'in' && o.query)) { hit = true; return; } for (const k of Object.keys(o)) if (k !== 's' && k !== 'e') w(o[k]); }; w(x); return hit; }
  isAggCall(x) { return x && x.t === 'func' && !x.over && AGG.has(lc(x.name)) && !((lc(x.name) === 'min' || lc(x.name) === 'max') && x.args.length > 1); }
  containsAgg(x) {
    let hit = false;
    const w = (o) => { if (!o || typeof o !== 'object' || hit) return; if (Array.isArray(o)) { o.forEach(w); return; } if (o.t === 'subq' || o.t === 'exists' || (o.t === 'in' && o.query)) { if (o.t === 'in') w(o.x); return; } if (this.isAggCall(o)) { hit = true; return; } for (const k of Object.keys(o)) if (k !== 's' && k !== 'e') w(o[k]); };
    w(x); return hit;
  }
  containsWin(x) { let hit = false; const w = (o) => { if (!o || typeof o !== 'object' || hit) return; if (Array.isArray(o)) { o.forEach(w); return; } if (o.t === 'subq' || o.t === 'exists') return; if (o.t === 'func' && o.over) { hit = true; return; } for (const k of Object.keys(o)) if (k !== 's' && k !== 'e') w(o[k]); }; w(x); return hit; }
  // a column reference outside any aggregate that is not (part of) a GROUP BY expression
  hasBare(roots, keySk, scope) {
    let hit = false;
    const w = (o) => {
      if (!o || typeof o !== 'object' || hit) return;
      if (Array.isArray(o)) { o.forEach(w); return; }
      if (o.t === 'subq' || o.t === 'exists' || (o.t === 'in' && o.query)) { if (o.t === 'in') w(o.x); return; }
      if (this.isAggCall(o)) return;
      if (o.t === 'num' || o.t === 'str' || o.t === 'null' || o.t === 'param' || o.t === 'bool') return;
      if (keySk.has(this.skey(o, scope))) return;
      if (o.t === 'col') { const r = scope.find(o.parts); if (r && !r.ambiguous && r.level === 0) hit = true; else if (!r && o.parts.length === 1 && scope.aliases && scope.aliases.has(lc(o.parts[0]))) w(scope.aliases.get(lc(o.parts[0]))); return; }
      for (const k of Object.keys(o)) if (k !== 's' && k !== 'e') w(o[k]);
    };
    w(roots); return hit;
  }
  extremeAggs(roots) { const seen = new Map(); const w = (o) => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) { o.forEach(w); return; } if (o.t === 'subq' || o.t === 'exists' || (o.t === 'in' && o.query)) return; if (this.isAggCall(o)) { const n = lc(o.name); if ((n === 'min' || n === 'max') && o.args.length === 1 && !o.filter) seen.set(JSON.stringify([n, o.args.map((a) => this.skeyLoose(a))]), o); return; } for (const k of Object.keys(o)) if (k !== 's' && k !== 'e') w(o[k]); }; w(roots); return [...seen.values()]; }
  skeyLoose(x) { return JSON.stringify(x, (k, v) => (k === 's' || k === 'e' ? undefined : v)); }
  hasDistinctAgg(roots) { let hit = false; const w = (o) => { if (!o || typeof o !== 'object' || hit) return; if (Array.isArray(o)) { o.forEach(w); return; } if (o.t === 'subq' || o.t === 'exists') return; if (this.isAggCall(o) && (o.distinct || o.filter || o.orderIn)) { hit = true; return; } for (const k of Object.keys(o)) if (k !== 's' && k !== 'e') w(o[k]); }; w(roots); return hit; }
  resolveQuiet(col, scope) { const r = scope.find(col.parts); return r && !r.ambiguous ? r : null; }

  // structural key of a SQL expression with columns resolved (for matching GROUP BY expressions)
  skey(x, scope) {
    const w = (o) => {
      if (o === null || typeof o !== 'object') return o;
      if (Array.isArray(o)) return o.map(w);
      if (o.t === 'col') { const r = scope.find(o.parts); return r && !r.ambiguous ? ['col', r.level, r.src.alias, lc(r.col.name)] : ['col?', o.parts.map(lc)]; }
      if (o.t === 'paren') return w(o.x);
      const out = {}; for (const k of Object.keys(o).sort()) { if (k === 's' || k === 'e' || k === 'synth') continue; out[k] = w(o[k]); }
      return out;
    };
    return JSON.stringify(w(x));
  }

  // ---- expressions ------------------------------------------------------------------------------------------------------------------
  colTerm(r, ctx) {
    const scope = ctx.scope;
    if (r.level > 0) { // correlated reference outside a supported position
      this.gap('SQL_CORRELATED_SCALAR', `reference to an outer column ${r.src.alias}.${r.col.name}`, 0);
      return NULL();
    }
    if (r.using && r.using.type !== 'inner' && r.using.type !== 'left') return call('coalesce', [path(r.using.left, r.col.name), path(r.using.right, r.col.name)]);
    if (r.using) return path(r.using.left, r.col.name);
    if (ctx.outerAlias !== undefined && ctx.outerAlias !== null) return path(ctx.outerAlias, r.col.name);
    if (scope.joined) return path(r.src.alias, r.col.name);
    return path(r.col.name);
  }
  affinityOf(x, scope) { let xx = x; while (xx && xx.t === 'paren') xx = xx.x; if (!xx || xx.t !== 'col') return null; const r = scope.find(xx.parts); return r && !r.ambiguous ? (r.col.affinity || '') : null; }
  numLit(s) { const n = Number(s); return n; }
  // R-AFF: rewrite a literal compared with a column of the other affinity
  affLit(litNode, aff) {
    if (litNode.t === 'str' && (aff === 'INTEGER' || aff === 'REAL' || aff === 'NUMERIC') && /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/.test(litNode.v)) { const n = Number(litNode.v); const isInt = /^\s*[+-]?\d+\s*$/.test(litNode.v) && Number.isSafeInteger(n); return lit(n, !isInt && Number.isInteger(n) ? true : (aff === 'REAL' && Number.isInteger(n))); }
    if ((litNode.t === 'num') && aff === 'TEXT') return str(litNode.v.replace(/^\+/, ''));
    return null;
  }
  tCompare(op, a, b, ctx) {
    let ta = this.tExpr(a, ctx), tb = this.tExpr(b, ctx);
    const aa = this.affinityOf(a, ctx.scope), ab = this.affinityOf(b, ctx.scope);
    const isLit = (x) => { let y = x; while (y.t === 'paren') y = y.x; return (y.t === 'str' || y.t === 'num') ? y : null; };
    const la = isLit(a), lb = isLit(b);
    if (aa && lb) { const r = this.affLit(lb, aa); if (r) tb = r; }
    if (ab && la) { const r = this.affLit(la, ab); if (r) ta = r; }
    if (aa && ab && aa !== ab && (aa !== '' && ab !== '')) {
      const numeric = (x) => x === 'INTEGER' || x === 'REAL' || x === 'NUMERIC';
      if (!(numeric(aa) && numeric(ab))) this.gap('SQL_AFFINITY', 'comparison of columns with different affinities', a.s);
    }
    return rel(op, ta, tb);
  }
  tNum(x) {
    if (x.hex) { const n = Number(BigInt(x.v)); if (!Number.isSafeInteger(n)) this.gap('SQL_UNSUPPORTED_EXPR', 'integer literal outside the safe range', x.s); return lit(n); }
    const n = Number(x.v);
    if (!x.real && !Number.isSafeInteger(n)) { this.gap('SQL_UNSUPPORTED_EXPR', 'integer literal outside the safe range', x.s); return lit(0); }
    if (!Number.isFinite(n)) { this.gap('SQL_UNSUPPORTED_EXPR', 'non-finite numeric literal', x.s); return lit(0); }
    return lit(n, x.real);
  }
  tExpr(x, ctx) {
    this.depth++;
    if (this.depth > 400) { this.depth--; throw new EoqlError('E_LIMIT', 'SQL expression nesting too deep', { detail: { lang: 'sql' } }); }
    try { return this.tExpr0(x, ctx); } finally { this.depth--; }
  }
  tExpr0(x, ctx) {
    const scope = ctx.scope;
    // post-aggregation matching of group-by expressions
    if (ctx.post && x.t !== 'num' && x.t !== 'str' && x.t !== 'null' && x.t !== 'param' && x.t !== 'bool') {
      const nm = ctx.post.key.get(this.skey(x, scope));
      if (nm !== undefined) return path(nm);
    }
    switch (x.t) {
      case 'num': return this.tNum(x);
      case 'str': return str(x.v);
      case 'null': return NULL();
      case 'bool': return lit(x.v ? 1 : 0);
      case 'blob': this.gap('SQL_BLOB', "blob literal", x.s); return NULL();
      case 'param': return param(this.addParam(x.name));
      case 'paren': return this.tExpr(x.x, ctx);
      case 'col': {
        const r = scope.find(x.parts);
        if (!r && x.parts.length === 1 && scope.aliases && scope.aliases.has(lc(x.parts[0])) && !(ctx.aliasGuard && ctx.aliasGuard.has(lc(x.parts[0])))) {
          const g = new Set(ctx.aliasGuard || []); g.add(lc(x.parts[0]));
          return this.tExpr(scope.aliases.get(lc(x.parts[0])), { ...ctx, aliasGuard: g });
        }
        if (!r) { if (x.dq) return str(x.parts[0]); if (x.parts.length === 1 && lc(x.parts[0]) === 'rowid' || (x.parts.length === 1 && ['oid', '_rowid_'].includes(lc(x.parts[0])))) { this.gap('SQL_ROWID', x.parts[0], x.s); return NULL(); } this.gap('SQL_COLUMN_UNKNOWN', x.parts.join('.'), x.s); return NULL(); }
        if (r.ambiguous) { this.gap('SQL_AMBIGUOUS_COLUMN', x.parts.join('.'), x.s); return NULL(); }
        if (ctx.post) { this.gap('SQL_BARE_COLUMN', x.parts.join('.'), x.s); return NULL(); }
        return this.colTerm(r, ctx);
      }
      case 'un': {
        if (x.op === '~') { this.gap('SQL_UNSUPPORTED_EXPR', 'bitwise ~', x.s); return NULL(); }
        const t = this.tExpr(x.x, ctx);
        if (x.op === '+') return t;
        if (t.t === 'lit' && typeof t.v === 'number') { const l = lit(-t.v, t.real); if (Object.is(l.v, -0)) l.v = 0; return l; }
        return N('un', 0, { op: '-', x: t });
      }
      case 'bin': {
        if (x.bit) { this.gap('SQL_UNSUPPORTED_EXPR', `bitwise ${x.op}`, x.s); return NULL(); }
        if (x.cmp) return this.tCompare(x.op, x.a, x.b, ctx);
        if (x.op === 'AND' || x.op === 'OR') return bin(x.op, this.tExpr(x.a, ctx), this.tExpr(x.b, ctx));
        return bin(x.op, this.tExpr(x.a, ctx), this.tExpr(x.b, ctx));
      }
      case 'not': return not(this.tExpr(x.x, ctx));
      case 'isnull': return N('isnull', 0, { x: this.tExpr(x.x, ctx), neg: !!x.neg });
      case 'is': {
        const nullish = (y) => { let z = y; while (z.t === 'paren') z = z.x; return z.t === 'null'; };
        if (nullish(x.b)) return N('isnull', 0, { x: this.tExpr(x.a, ctx), neg: !!x.neg });
        if (nullish(x.a)) return N('isnull', 0, { x: this.tExpr(x.b, ctx), neg: !!x.neg });
        const c = call('nulleq', [this.tExpr(x.a, ctx), this.tExpr(x.b, ctx)]);
        return x.neg ? not(c) : c;
      }
      case 'istruth': this.gap('SQL_IS_TRUE', `IS ${x.neg ? 'NOT ' : ''}${x.v}`, x.s); return NULL();
      case 'between': {
        let t = this.tExpr(x.x, ctx), lo = this.tExpr(x.lo, ctx), hi = this.tExpr(x.hi, ctx);
        const aa = this.affinityOf(x.x, scope);
        if (aa) { const l1 = this.affLit(x.lo.t === 'str' || x.lo.t === 'num' ? x.lo : { t: '' }, aa); const l2 = this.affLit(x.hi.t === 'str' || x.hi.t === 'num' ? x.hi : { t: '' }, aa); if (l1) lo = l1; if (l2) hi = l2; }
        return N('between', 0, { x: t, neg: !!x.neg, lo, hi });
      }
      case 'like': {
        if (x.op === 'ILIKE') { this.spell('ILIKE', 'like', x.s); if (!this.allowSpell) this.gap('SQL_DIALECT_SPELLING', 'ILIKE', x.s); }
        if (x.op === 'GLOB') return N('glob', 0, { x: this.tExpr(x.x, ctx), neg: !!x.neg, pat: this.tExpr(x.pat, ctx) });
        return N('like', 0, { x: this.tExpr(x.x, ctx), neg: !!x.neg, pat: this.tExpr(x.pat, ctx), esc: x.esc ? this.tExpr(x.esc, ctx) : null });
      }
      case 'regexp': this.gap('SQL_UNSUPPORTED_EXPR', x.op, x.s); return NULL();
      case 'in': return this.tIn(x, ctx);
      case 'exists': {
        if (this.isCorrelated(x.query, scope)) { this.gap('SQL_CORRELATED_OTHER', 'EXISTS outside a top-level WHERE conjunct', x.s); return NULL(); }
        const q = this.tSelect(x.query, null);
        const c = rel('>', V('SYN', q.node, { agg: obj([{ k: 'n', v: call('count', [star()]) }]), by: q.grouped ? list([]) : undefined }), lit(0));
        return x.neg ? not(c) : c;
      }
      case 'subq': {
        if (this.isCorrelated(x.query, scope)) { this.gap('SQL_CORRELATED_SCALAR', 'correlated scalar subquery', x.s); return NULL(); }
        const q = this.tSelect(x.query, null);
        if (q.cols.length !== 1) this.gap('SQL_UNSUPPORTED_EXPR', 'a scalar subquery must return one column', x.s);
        return q.node;
      }
      case 'eoqlterm': return x.term;
      case 'rowvalue': this.gap('SQL_UNSUPPORTED_EXPR', 'row value', x.s); return NULL();
      case 'case': {
        const args = [];
        for (const [w, t] of x.whens) {
          const p = x.operand ? this.tCompare('=', x.operand, w, ctx) : this.tExpr(w, ctx);
          args.push(p, this.tExpr(t, ctx));
        }
        if (x.els) args.push(this.tExpr(x.els, ctx));
        return call('case', args);
      }
      case 'cast': {
        const ty = lc(x.type); let to;
        if (x.spell === '::') { this.spell('::' + x.type, 'cast', x.s); if (!this.allowSpell) this.gap('SQL_DIALECT_SPELLING', '::', x.s); }
        if (/^(int|integer|bigint|smallint|tinyint|mediumint|int2|int8|unsigned big int)$/.test(ty)) to = 'integer';
        else if (/^(real|float|double|double precision)$/.test(ty)) to = 'real';
        else if (/^(text|varchar|char|nchar|nvarchar|clob|character|varying character|native character|string)$/.test(ty)) to = 'text';
        else if (/^(numeric|decimal)$/.test(ty)) to = 'numeric';
        else if (/blob/.test(ty)) { this.gap('SQL_BLOB', 'CAST AS BLOB', x.s); to = 'text'; } else { this.gap('SQL_UNSUPPORTED_EXPR', `CAST AS ${x.type}`, x.s); to = 'text'; }
        return call('cast', [this.tExpr(x.x, ctx), str(to)]);
      }
      case 'collate': {
        const t = this.tExpr(x.x, ctx);
        return this.collate(t, x.name, x.s);
      }
      case 'jsonop': {
        if (x.op === '->') { this.gap('SQL_JSON_OPERATOR', '->', x.s); return NULL(); }
        return this.jsonGet(this.tExpr(x.x, ctx), x.path, x.s);
      }
      case 'func': return this.tFunc(x, ctx);
      case 'star': this.gap('SQL_UNSUPPORTED_EXPR', '*', x.s); return NULL();
      default: this.gap('SQL_UNSUPPORTED_EXPR', x.t, x.s); return NULL();
    }
  }
  jsonGet(target, pathX, pos) {
    if (pathX.t === 'str') { const p = pathX.v.startsWith('$') ? pathX.v : '$.' + pathX.v; return call('json_get', [target, str(p)]); }
    if (pathX.t === 'num' && !pathX.real) return call('json_get', [target, str(`$[${pathX.v}]`)]);
    this.gap('SQL_UNSUPPORTED_EXPR', 'JSON path must be a literal', pos); return NULL();
  }
  isCorrelated(q, scope) {
    // does the subquery mention a column that only the enclosing scope can resolve?
    let corr = false; const t = new Translator(this.sql, { catalogRelations: this.catalog, spellings: this.allowSpell });
    t.cteStack = this.cteStack.slice();
    try { t.tSelect(q, null); } catch (e) { return false; }
    if (t.gaps.some((g) => g.gap === 'SQL_COLUMN_UNKNOWN')) {
      // a column unknown with no outer scope: correlated iff the outer scope can resolve it
      const un = t.gaps.filter((g) => g.gap === 'SQL_COLUMN_UNKNOWN');
      corr = un.some((g) => { const parts = g.construct.split('.'); return !!scope.find(parts); });
    }
    return corr;
  }
  tIn(x, ctx) {
    const scope = ctx.scope;
    if (x.table) { this.gap('SQL_UNSUPPORTED_EXPR', 'IN table', x.s); return NULL(); }
    let t = this.tExpr(x.x, ctx);
    if (x.query) {
      if (this.isCorrelated(x.query, scope)) { this.gap('SQL_CORRELATED_OTHER', 'IN (subquery) outside a top-level WHERE conjunct', x.s); return NULL(); }
      const q = this.tSelect(x.query, null);
      if (q.cols.length !== 1) this.gap('SQL_UNSUPPORTED_EXPR', 'IN (subquery) must return one column', x.s);
      return N('in', 0, { x: t, neg: !!x.neg, rhs: N('sub', 0, { x: q.node }) });
    }
    if (x.paramList) return N('in', 0, { x: t, neg: !!x.neg, rhs: this.tExpr(x.list[0], ctx) });
    const aa = this.affinityOf(x.x, scope);
    const items = x.list.map((e) => { let r = this.tExpr(e, ctx); if (aa && (e.t === 'str' || e.t === 'num')) { const a = this.affLit(e, aa); if (a) r = a; } return r; });
    return N('in', 0, { x: t, neg: !!x.neg, rhs: list(items) });
  }
  tFunc(x, ctx) {
    const name = lc(x.name);
    const scope = ctx.scope;
    // window functions
    if (x.over) return this.tWindow(x, ctx);
    if (this.isAggCall(x)) return this.tAgg(x, ctx);
    if (x.orderIn) { this.gap('SQL_AGG_ORDER', `${name}(... ORDER BY)`, x.s); }
    if (WINF.has(name)) { this.gap('SQL_UNSUPPORTED_EXPR', `${name} without OVER`, x.s); return NULL(); }
    if (x.filter) { this.gap('SQL_WINDOW_FRAME', 'FILTER on a scalar function', x.s); }
    if (x.distinct || x.star) { this.gap('SQL_UNSUPPORTED_EXPR', `${name}(DISTINCT/*)`, x.s); return NULL(); }
    if (NONDET.has(name) || x.current) { this.gap('SQL_NONDETERMINISTIC', name, x.s); return NULL(); }
    if (BLOBF.has(name)) { this.gap('SQL_BLOB', name, x.s); return NULL(); }
    if (DATE_OTHER.has(name)) { this.gap('SQL_DATE_FORMAT', name, x.s); return NULL(); }
    const args = () => x.args.map((a) => this.tExpr(a, ctx));
    if (DATEF.has(name)) {
      const strf = name === 'strftime';
      const val = strf ? 1 : 0; // index of the time-value argument
      if (x.args.length < val + 1 || x.args.some((a) => a.t === 'str' && lc(a.v) === 'now')) { this.gap('SQL_NONDETERMINISTIC', `${name}('now')`, x.s); return NULL(); }
      if (strf) {
        const f = x.args[0];
        if (f.t !== 'str') { this.gap('SQL_DATE_FORMAT', 'strftime with a format that is not a string literal', x.s); return NULL(); }
        for (let i = 0; i < f.v.length; i++) if (f.v[i] === '%') { const c = f.v[i + 1]; if (c === undefined || !STRFTIME_SPECS.includes(c)) { this.gap('SQL_DATE_FORMAT', `strftime specifier %${c === undefined ? '' : c} is outside the supported subset`, x.s); return NULL(); } i++; }
      }
      for (const m of x.args.slice(val + 1)) { if (m.t !== 'str' || !SUPPORTED_MODS(m.v)) { this.gap('SQL_DATE_FORMAT', `${name} modifier ${m.t === 'str' ? JSON.stringify(m.v) : '(not a string literal)'} is outside the supported subset`, x.s); return NULL(); } }
      return call(name, args());
    }
    if (name === 'min' || name === 'max') return call(name === 'min' ? 'least' : 'greatest', args());
    if (name === 'json_extract') {
      if (x.args.length !== 2) { this.gap('SQL_JSON_OPERATOR', 'json_extract with several paths', x.s); return NULL(); }
      return this.jsonGet(this.tExpr(x.args[0], ctx), x.args[1], x.s);
    }
    if (name === 'nvl' || name === 'isnull') {
      if (name === 'isnull' && x.args.length !== 2) { this.gap('SQL_UNSUPPORTED_EXPR', 'isnull()', x.s); return NULL(); }
      this.spell(x.name, 'coalesce', x.s); if (!this.allowSpell) this.gap('SQL_DIALECT_SPELLING', x.name, x.s);
      return call('coalesce', args());
    }
    if (name === 'concat') { this.gap('SQL_DIALECT_SPELLING', 'CONCAT', x.s); return NULL(); }
    if (name === 'nocase') return call('nocase', args());
    if (SCALAR_MAP[name]) {
      const a = args(); const tn = SCALAR_MAP[name];
      if (name === 'substring') { /* SQLite spelling */ }
      return call(tn, a);
    }
    this.gap(['array_agg', 'json_group_array', 'json_arrayagg', 'jsonb_agg', 'json_agg'].includes(name) ? 'SQL_ARRAY_AGG' : 'SQL_UNKNOWN_FUNCTION', name, x.s);
    return NULL();
  }
  tAgg(x, ctx) {
    let name = lc(x.name);
    if (!ctx.aggs) { this.gap('SQL_UNSUPPORTED_EXPR', `aggregate ${name} in this position`, x.s); return NULL(); }
    if (x.orderIn) this.gap('SQL_AGG_ORDER', `${name} with ORDER BY`, x.s);
    const inner = { ...ctx, post: null }; // arguments are evaluated on the rows before grouping
    if (name === 'string_agg' || name === 'listagg') { this.spell(x.name, 'group_concat', x.s); if (!this.allowSpell) this.gap('SQL_DIALECT_SPELLING', x.name, x.s); name = 'group_concat'; }
    let args;
    if (x.star) { if (name !== 'count') this.gap('SQL_UNSUPPORTED_EXPR', `${name}(*)`, x.s); args = [star()]; } else args = x.args.map((a) => this.tExpr(a, inner));
    if (x.filter) {
      const p = this.tExpr(x.filter, inner);
      if (x.star) args = [call('case', [p, lit(1)])]; else if (args.length >= 1) args = [call('case', [p, args[0]]), ...args.slice(1)];
    }
    if (name === 'group_concat' && args.length > 2) this.gap('SQL_UNSUPPORTED_EXPR', 'group_concat arguments', x.s);
    if (name === 'count' && args.length !== 1) this.gap('SQL_UNSUPPORTED_EXPR', 'count arguments', x.s);
    const callNode = call(name, args, !!x.distinct);
    const key = canonical({ n: print(callNode) });
    let ent = ctx.aggs.get(key);
    if (!ent) { ent = { name: `_a${ctx.aggs.size + 1}`, node: callNode }; ctx.aggs.set(key, ent); }
    return path(ent.name);
  }
  tWindow(x, ctx) {
    const name = lc(x.name);
    if (!ctx.wins) { this.gap('SQL_UNSUPPORTED_EXPR', 'window function in this position', x.s); return NULL(); }
    if (x.filter) this.gap('SQL_WINDOW_FRAME', 'FILTER on a window function', x.s);
    if (x.orderIn) this.gap('SQL_AGG_ORDER', 'ORDER BY inside a window aggregate', x.s);
    if (!(WINF.has(name) || (AGG.has(name) && !((name === 'min' || name === 'max') && x.args.length > 1)))) {
      this.gap(['percent_rank', 'cume_dist'].includes(name) ? 'SQL_UNSUPPORTED_EXPR' : 'SQL_UNKNOWN_FUNCTION', `${name} OVER`, x.s); return NULL();
    }
    let spec = x.over;
    if (spec.base) { // named window
      const defs = ctx.windowDefs || {};
      const d = defs[spec.base] || defs[Object.keys(defs).find((k) => lc(k) === lc(spec.base))];
      if (!d) { this.gap('SQL_UNSUPPORTED_EXPR', `window ${spec.base}`, x.s); return NULL(); }
      spec = { base: null, partition: spec.partition || d.partition, order: spec.order || d.order, frame: spec.frame || d.frame };
    }
    // the function and its arguments are post-aggregation terms
    let args;
    if (x.star) args = [star()]; else args = x.args.map((a) => this.tExpr(a, ctx));
    const callNode = call(name === 'string_agg' ? 'group_concat' : name, args, !!x.distinct);
    const part = (spec.partition || []).map((p) => this.tExpr(p, ctx));
    const ord = (spec.order || []).map((o) => ordered(this.collate(this.tExpr(o.x, ctx), o.coll, o.x.s), o.dir, o.nulls));
    const rows = this.frameRows(spec.frame, x.s);
    const specKey = print(N('list', 0, { items: part })) + '|' + print(N('list', 0, { items: ord })) + '|' + JSON.stringify(rows);
    const callKey = specKey + '|' + print(callNode);
    let w = ctx.wins.find((q) => q.callKey === callKey);
    if (!w) { w = { name: `_w${ctx.wins.length + 1}`, call: callNode, part, ord, rows, specKey, callKey }; ctx.wins.push(w); }
    return path(w.name);
  }
  frameRows(fr, pos) {
    if (!fr) return undefined;
    if (fr.exclude || fr.unit === 'GROUPS') { this.gap('SQL_WINDOW_FRAME', fr.unit === 'GROUPS' ? 'GROUPS frame' : 'EXCLUDE', pos); return undefined; }
    const num = (b) => { if (b.x.t === 'num' && !b.x.real && !b.x.hex) return Number(b.x.v); this.gap('SQL_WINDOW_FRAME', 'a frame offset must be an integer literal', pos); return 0; };
    if (fr.unit === 'RANGE') {
      const a = fr.a, b = fr.b;
      const isStart = a.t === 'unb' && a.dir === 'p';
      if (isStart && (!b || (b.t === 'cur'))) return undefined;
      if (isStart && b && b.t === 'unb' && b.dir === 'f') return [null, null];
      this.gap('SQL_WINDOW_FRAME', 'RANGE frame other than the default', pos); return undefined;
    }
    const lo = (b) => (b.t === 'unb' ? null : b.t === 'cur' ? 0 : b.dir === 'p' ? -num(b) : num(b));
    if (!fr.b) { const a = fr.a; if (a.t === 'unb' && a.dir === 'f') { this.gap('SQL_WINDOW_FRAME', 'frame start UNBOUNDED FOLLOWING', pos); return undefined; } return [lo(a), 0]; }
    const hi = (b) => (b.t === 'unb' ? null : b.t === 'cur' ? 0 : b.dir === 'p' ? -num(b) : num(b));
    if (fr.a.t === 'unb' && fr.a.dir === 'f') { this.gap('SQL_WINDOW_FRAME', 'frame start UNBOUNDED FOLLOWING', pos); return undefined; }
    if (fr.b.t === 'unb' && fr.b.dir === 'p') { this.gap('SQL_WINDOW_FRAME', 'frame end UNBOUNDED PRECEDING', pos); return undefined; }
    return [lo(fr.a), hi(fr.b)];
  }
}

// ---- public entry -------------------------------------------------------------------------------------------------------------------
const dispName = (n) => n.replace(/#\d+$/, '');
export function catalogToRelations(cat) {
  const rel = {};
  const src = cat && cat.relations ? cat.relations : cat;
  for (const [name, r] of Object.entries(src || {})) rel[name] = { columns: r.columns.map((c) => ({ name: c.name, affinity: c.affinity || '' })), kind: r.kind || 'table' };
  return rel;
}
export function fixedRelations() {
  const rel = {};
  for (const [name, cols] of Object.entries(FIXED)) rel[name] = { columns: cols.map(([n, a]) => ({ name: n, affinity: a })), kind: ['all_entries', 'live_entries', 'latest_causal', 'undeclared_entries'].includes(name) ? 'view' : 'table' };
  return rel;
}

export function translateSqlText(sql, opts = {}) {
  const ast = parseSql(sql); // E_PARSE | E_LIMIT
  const relations = opts.catalogRelations || fixedRelations();
  const t = new Translator(sql, { catalogRelations: relations, spellings: opts.spellings });
  // named windows are visible to every select in the statement
  let result = null;
  try { result = t.top(ast); } catch (e) { if (e instanceof Stop) result = null; else throw e; }
  const gaps = t.gaps;
  const tokOrder = (ast.paramList || []).map((p) => p.name);
  const params = [...new Set(tokOrder)].filter((n) => t.paramNames.includes(n));
  if (gaps.length || !result) {
    return { v: 'eoql-parse/1', ok: false, from: 'sql', eoql: null, expr_hash: null, ast: null, params, columns: result ? result.cols.map(dispName) : [], column_keys: result ? result.cols : [], order_sensitive: false, accepted_spellings: t.spellings, gaps, notes: t.notes };
  }
  const script = { t: 'script', statements: [N('read', 0, { expr: result.node })] };
  let text = print(script);
  // the printed text must parse back to the same print (law L22); anything else is a translator bug
  let back;
  try { back = parseEoql(text); } catch (e) { throw new EoqlError('E_INTERNAL', `translator produced EOQL that does not parse: ${e.message}`, { detail: { eoql: text } }); }
  const text2 = print(back);
  if (text2 !== text) text = text2;
  const ast2 = JSON.parse(JSON.stringify(back.statements.length === 1 ? back.statements[0].expr : back));
  return { v: 'eoql-parse/1', ok: true, from: 'sql', eoql: text, expr_hash: sha256(text), ast: ast2, params, columns: result.cols.map(dispName), column_keys: result.cols, order_sensitive: !!result.orderSensitive, accepted_spellings: t.spellings, gaps: [], notes: t.notes };
}
