// sql/compile.mjs: EOQL -> SQL for sqlite, postgres, mysql, sqlserver, oracle (SPEC-A1 4). Compilation never executes,
// never opens a log; it lowers the relational fragment C-REL over the SQL catalog and reports EVERY reason an
// expression is not compilable (typed, two classes), never a silent partial.
import { EoqlError, VERSION } from '../errors.mjs';
import { parse } from '../parse.mjs';
import { print } from '../print.mjs';
import { sha256 } from '../util.mjs';
import { TARGETS, DECLARED_FUTURE, normalizeTarget, KEYWORDS, KEYWORD_SOURCE, QUOTE, V1_CONFIG } from './dialects.mjs';
import { fixedRelations } from './translate.mjs';

const NOT_NATIVE = new Set(['held_sets', 'causal_latest', 'as_of', 'perceiver', 'counterfactual', 'incomplete_range', 'provenance', 'cost', 'write']);
export const reasonClass = (r) => (NOT_NATIVE.has(r) ? 'not_native' : 'not_lowered');
const SYSCOL_REASON = { _held: 'held_sets', _determined: 'held_sets', _head: 'held_sets', _retracted: 'held_sets', _retracted_by: 'held_sets', _pos: 'causal_latest', _incomplete: 'incomplete_range', _src: 'provenance', _slot: 'held_sets', _depth: 'held_sets', _branch: 'held_sets', _fork: 'held_sets', _episode: 'held_sets', _siblings: 'held_sets' };
const WINF = new Set(['row_number', 'rank', 'dense_rank', 'ntile', 'lag', 'lead', 'first_value', 'last_value', 'nth_value']);
const AGGF = new Set(['count', 'sum', 'total', 'avg', 'min', 'max', 'group_concat']);
const PRED = new Set(['rel', 'isnull', 'isset', 'is', 'contains', 'in', 'between', 'like', 'glob', 'not']);
const isPredNode = (n) => PRED.has(n.t) || (n.t === 'bin' && (n.op === 'AND' || n.op === 'OR'));

class Fail extends Error {}

export function compileText(text, opts = {}) {
  const target = normalizeTarget(opts.to);
  if (DECLARED_FUTURE.includes(target)) throw new EoqlError('E_TARGET_UNIMPLEMENTED', `${target} is a declared future target and is not implemented`, { detail: { declared_future: true, target } });
  if (!TARGETS.includes(target)) throw new EoqlError('E_USAGE', `--to must be one of ${TARGETS.join(', ')}`, { detail: { targets: TARGETS } });
  const first = parse(text);
  const canon = print(first);
  const script = parse(canon); // positions refer to the canonical text
  const rels = opts.catalogRelations || fixedRelations();
  const outs = script.statements.map((st, i) => compileStatement(st, i, target, canon, rels));
  const res = outs.length === 1 ? outs[0] : { v: 'eoql-compile/1', statements: outs };
  if (opts.strict) {
    const bad = outs.filter((o) => !o.ok);
    if (bad.length) throw new EoqlError('E_NOT_COMPILABLE', `${bad.reduce((n, o) => n + o.not_compilable.length, 0)} reason(s) why this is not compilable`, { detail: { not_compilable: bad.flatMap((o) => o.not_compilable) } });
  }
  return res;
}

const DUP_KEY = /#\d+$/;
function compileStatement(st, idx, target, canon, rels) {
  const C = new Compiler(target, rels, idx, canon);
  const exprText = st.t === 'write' ? print(st) : print(st.expr);
  const expr_hash = sha256(exprText);
  if (st.t === 'write') {
    C.reason('write', st.call.verb, null, `statements[${idx}].${st.call.verb}`, st.pos, 'a write appends entries; SQL cannot compute the entry id (a hash of canonical content), the causal frontier or the writer');
    return { v: 'eoql-compile/1', ok: false, dialect: target, sql: null, expr_hash, not_compilable: C.reasons };
  }
  let block = null;
  try { block = C.lowerWorld(st.expr, `statements[${idx}]`, { names: new Map() }); } catch (e) { if (!(e instanceof Fail)) throw e; }
  if (C.reasons.length || !block) return { v: 'eoql-compile/1', ok: false, dialect: target, sql: null, expr_hash, not_compilable: dedupe(C.reasons) };
  // output keys `name#k` (k >= 2) are the k-th output called `name` (the translator's way to keep duplicate SQL output names):
  // only the OUTER select shows the display name, as SQL does
  block = { ...block, select: block.select.map((c) => (DUP_KEY.test(c.name) ? { ...c, name: c.name.replace(DUP_KEY, ''), _key: c.name } : c)) };
  const sql = C.finish(block);
  if (C.reasons.length) return { v: 'eoql-compile/1', ok: false, dialect: target, sql: null, expr_hash, not_compilable: dedupe(C.reasons) };
  const order_sensitive = block.orderBy.length > 0 && !block.compoundNoOrder;
  const notes = C.notes.slice();
  notes.push({ code: 'W_KEYWORDS', detail: { source: KEYWORD_SOURCE.origin, sha256: KEYWORD_SOURCE.sha256[target] } });
  return { v: 'eoql-compile/1', ok: true, dialect: target, sql, params: C.params, bind_order: C.positional ? C.bindOrder : null, columns: block.select.map((c) => c.name), order_sensitive, expr_hash, fragment: 'C-REL', notes };
}
function dedupe(rs) { const seen = new Set(); const out = []; for (const r of rs) { const k = JSON.stringify([r.reason, r.path, r.pos, r.detail]); if (!seen.has(k)) { seen.add(k); out.push(r); } } return out; }

const atomic = (s) => { let d = 0, q = null; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === q) q = null; continue; } if (c === "'" || c === '"' || c === '`') { q = c; continue; } if (c === '(' || c === '[') d++; else if (c === ')' || c === ']') d--; else if (d === 0 && c === ' ') return false; } return true; };
const par = (s) => (atomic(s) ? s : `(${s})`);

class Compiler {
  constructor(target, rels, idx, canon) {
    this.t = target; this.rels = rels; this.idx = idx; this.canon = canon;
    this.reasons = []; this.notes = []; this.params = []; this.bindOrder = []; this.positional = target === 'postgres' || target === 'mysql';
    this.ctes = []; this.aliasN = 0; this.cfg = V1_CONFIG[target];
  }
  reason(reason, verb, clause, path, pos, detail) { this.reasons.push({ reason, class: reasonClass(reason), verb: verb || null, clause: clause || null, path, pos: pos === undefined ? 0 : pos, detail }); }
  note(code, detail) { if (!this.notes.some((n) => n.code === code && n.detail === detail)) this.notes.push({ code, detail }); }
  fail() { throw new Fail(); }
  alias() { return `_t${++this.aliasN}`; }
  q(name) {
    const [a, b] = QUOTE[this.t];
    const simple = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
    if (simple && !KEYWORDS[this.t].has(name.toUpperCase())) return name;
    return a + String(name).split(b).join(b + b) + b;
  }
  lit(s) { let t = s.split("'").join("''"); if (this.t === 'mysql') t = t.split('\\').join('\\\\'); return `'${t}'`; }
  bool(v) { return v ? this.cfg.booleanTrue : this.cfg.booleanFalse; }

  // ---- worlds ------------------------------------------------------------------------------------------------------------
  mkBlock(p) { return { from: null, joins: [], select: [], where: [], groupBy: [], having: [], orderBy: [], limit: null, offset: null, distinct: false, grouped: false, windowed: false, joined: false, compound: null, hasAggNoGroup: false, ...p }; }
  wrap(b) {
    const al = this.alias();
    const sql = this.sqlOf(b);
    const nb = this.mkBlock({ from: `(${sql}) ${al}`, joined: false });
    nb.select = b.select.map((c) => ({ name: c.name, expr: `${al}.${this.q(c.name)}` }));
    return nb;
  }
  fresh(b) { // a block that can still take a WHERE / GROUP BY / select-list changes
    if (b.compound || b.limit !== null || b.offset !== null || b.distinct) return this.wrap(b);
    return b;
  }
  resolve(b, names, pos, path) {
    const cols = b.select.map((c) => c.name);
    for (let i = names.length; i >= 1; i--) { const cand = names.slice(0, i).join('.'); const k = cols.indexOf(cand); if (k >= 0) return { col: b.select[k], rest: names.slice(i) }; }
    const first = names[0]; const suf = b.select.filter((c) => c.name.endsWith('.' + first));
    if (suf.length === 1) return { col: suf[0], rest: names.slice(1) };
    if (suf.length > 1) { this.reason('unsupported_term', null, null, path, pos, `ambiguous column ${first}`); this.fail(); }
    const lc = cols.indexOf(first.toLowerCase()); if (lc >= 0) return { col: b.select[lc], rest: names.slice(1) };
    return null;
  }

  lowerWorld(n, path, env) {
    if (n.t === 'path' && n.parts.length === 1 && !n.sigil) {
      const nm = n.parts[0].name;
      if (env.names.has(nm)) { const b = env.names.get(nm); return this.refName(nm, b); }
      if (nm === 'sources') { this.reason('raw_world', null, null, path, n.pos, 'the log projection `sources` has no catalog equivalent: name a catalog relation with SEG(sources; table: "...")'); this.fail(); }
      this.reason('unresolved_name', null, null, path, n.pos, `name ${nm} is not bound by the expression (a stored view, or an unknown name): compile has no log`); this.fail();
    }
    if (n.t === 'viewcall') { this.reason('unresolved_name', null, null, path, n.pos, `stored view ${n.name}: compile has no log`); this.fail(); }
    if (n.t === 'paren' || n.t === 'sub') return this.lowerWorld(n.x, path, env);
    if (n.t === 'bin' && (n.op === 'AND' || n.op === 'OR')) { this.reason('unsupported_term', null, null, path, n.pos, 'AND/OR on worlds (set operations on row keys) has no SQL lowering'); this.fail(); }
    if (n.t === 'not') { this.reason('unsupported_term', null, null, path, n.pos, 'NOT on a world'); this.fail(); }
    if (n.t !== 'verb') { this.reason('unsupported_term', null, null, path, n.pos, `expected a world expression, found ${n.t}`); this.fail(); }
    const f = this[`v${n.verb}`];
    return f.call(this, n, `${path}.${n.verb}`, env);
  }
  refName(nm, b) { const nb = this.mkBlock({ from: this.q(nm) }); nb.select = b.select.map((c) => ({ name: c.name, expr: this.q(c.name) })); nb.fromName = nm; return nb; }
  cm(n) { return new Map(n.clauses.map((c) => [c.key, c.value])); }
  input(n, path, env) { if (n.first) return this.lowerWorld(n.first, path + '.first', env); this.reason('raw_world', n.verb, null, path, n.pos, 'no input world: the root `sources` is the log projection'); this.fail(); return null; }
  constStr(x, path) { if (x && x.t === 'lit' && typeof x.v === 'string') return x.v; if (x && x.t === 'path' && x.parts.length === 1) return x.parts[0].name; this.reason('unsupported_term', null, null, path, x && x.pos, 'expected a constant string'); this.fail(); return null; }
  strList(x, path) { if (!x || x.t !== 'list') { this.reason('unsupported_term', null, null, path, x && x.pos, 'expected a list of strings'); this.fail(); } return x.items.map((i) => this.constStr(i, path)); }

  vNUL(n, path, env) {
    const cm = this.cm(n);
    for (const k of ['expect', 'gaps']) if (cm.has(k)) { this.reason('incomplete_range', 'NUL', k, `${path}.${k}`, n.pos, 'evidence markers belong to the log, not to the catalog'); }
    if (cm.has('expect') || cm.has('gaps')) this.fail();
    return this.input(n, path, env);
  }
  vSIG(n, path, env) {
    const cm = this.cm(n);
    if (cm.has('perceiver')) this.reason('perceiver', 'SIG', 'perceiver', `${path}.perceiver`, n.pos, 'a re-fold of a sub-log chosen by writer or horizon');
    if (cm.has('budget')) this.reason('cost', 'SIG', 'budget', `${path}.budget`, n.pos, 'a cost ceiling is not silently dropped');
    if (cm.has('return')) this.reason('provenance', 'SIG', 'return', `${path}.return`, n.pos, 'pointer results carry entry ids as the reading');
    if (!cm.size) return this.input(n, path, env);
    this.fail(); return null;
  }
  vINS(n, path, env) {
    const cm = this.cm(n);
    if (cm.has('entries')) { this.reason('counterfactual', 'INS', 'entries', `${path}.entries`, n.pos, 'hypothetical entries merged into a log'); this.fail(); }
    if (!cm.has('rows')) { this.reason('raw_world', 'INS', null, path, n.pos, 'genesis (the roots of each slot) reads the log'); this.fail(); }
    const rows = cm.get('rows'); const cols = cm.has('columns') ? this.strList(cm.get('columns'), `${path}.columns`) : null;
    if (rows.t !== 'list') { this.reason('unsupported_term', 'INS', 'rows', `${path}.rows`, n.pos, 'rows must be a list'); this.fail(); }
    const rs = rows.items.map((r) => (r.t === 'list' ? r.items : r.t === 'obj' ? (cols || r.pairs.map((p) => p.k)).map((c) => (r.pairs.find((p) => p.k === c) || { v: { t: 'lit', v: null } }).v) : null));
    if (rs.some((r) => !r)) { this.reason('unsupported_term', 'INS', 'rows', `${path}.rows`, n.pos, 'each row must be a list or object'); this.fail(); }
    const names = cols || (rs[0] || []).map((_, i) => `column${i + 1}`);
    const sc = { b: this.mkBlock(), path };
    const members = rs.map((r, k) => `SELECT ${r.map((x, i) => { const v = this.term(x, sc, `${path}.rows[${k}][${i}]`); return k === 0 ? `${v} AS ${this.q(names[i])}` : v; }).join(', ')}${this.t === 'oracle' ? ' FROM DUAL' : ''}`);
    if (!members.length) { this.reason('unsupported_term', 'INS', 'rows', `${path}.rows`, n.pos, 'an empty VALUES list'); this.fail(); }
    const al = this.alias();
    const b = this.mkBlock({ from: `(${members.join('\nUNION ALL\n')}) ${al}` });
    b.select = names.map((c) => ({ name: c, expr: `${al}.${this.q(c)}` }));
    return b;
  }
  vSEG(n, path, env) {
    const cm = this.cm(n);
    const bad = [...cm.keys()].filter((k) => k !== 'table');
    if (cm.has('drop')) this.reason('counterfactual', 'SEG', 'drop', `${path}.drop`, n.pos, 'a re-fold of the log without the dropped entries');
    if (bad.length) { if (!cm.has('drop')) this.reason('raw_world', 'SEG', bad[0], `${path}.${bad[0]}`, n.pos, 'a log projection with no catalog equivalent: query the catalog with table:'); this.fail(); }
    if (!cm.has('table')) { this.reason('raw_world', 'SEG', null, path, n.pos, 'SEG without table: is a log projection'); this.fail(); }
    if (n.first && !(n.first.t === 'path' && n.first.parts.length === 1 && n.first.parts[0].name === 'sources')) { this.reason('unsupported_term', 'SEG', null, path, n.pos, 'table: is only defined over sources'); this.fail(); }
    const name = this.constStr(cm.get('table'), `${path}.table`);
    const key = Object.keys(this.rels).find((k) => k.toLowerCase() === name.toLowerCase());
    if (!key) { this.reason('catalog_required', 'SEG', 'table', `${path}.table`, n.pos, `relation ${name} is not in the catalog (pass a catalog that holds it)`); this.fail(); }
    const rel = this.rels[key];
    const b = this.mkBlock({ from: this.q(key) });
    b.select = rel.columns.map((c) => ({ name: c.name, expr: this.q(c.name) }));
    b.baseName = key;
    return b;
  }
  vEVA(n, path, env) {
    let b = this.input(n, path, env);
    const cm = this.cm(n);
    if (!cm.has('where')) return b;
    const needWrap = b.compound || b.limit !== null || b.offset !== null || b.distinct || b.windowed || (b.windowedSelect);
    if (needWrap) b = this.wrap(b);
    const p = this.pred(cm.get('where'), { b, path: `${path}.where` }, `${path}.where`);
    if (b.grouped) b.having.push(p); else b.where.push(p);
    return b;
  }
  vDEF(n, path, env) {
    const cm = this.cm(n);
    for (const k of ['asof', 'schema']) if (cm.has(k)) this.reason('as_of', 'DEF', k, `${path}.${k}`, n.pos, k === 'asof' ? 'a re-fold of the log prefix; the SQL catalog holds one fold' : 'the ground of a log position');
    if (cm.has('collapse')) this.reason('held_sets', 'DEF', 'collapse', `${path}.collapse`, n.pos, 'collapse rules act on survivor counts');
    if (cm.has('anc')) this.reason('held_sets', 'DEF', 'anc', `${path}.anc`, n.pos, 'the ancestry basis decides heads and survivor counts');
    if (cm.has('ordering')) this.reason('causal_latest', 'DEF', 'ordering', `${path}.ordering`, n.pos, 'causal position order');
    if (['asof', 'schema', 'collapse', 'anc', 'ordering'].some((k) => cm.has(k))) this.fail();
    let env2 = env; const defs = [];
    if (cm.has('bind')) {
      const bn = cm.get('bind');
      if (bn.t !== 'obj') { this.reason('unsupported_term', 'DEF', 'bind', `${path}.bind`, n.pos, 'bind must be an object'); this.fail(); }
      env2 = { names: new Map(env.names) };
      for (const p of bn.pairs) {
        const base = n.first ? null : null; void base;
        const blk = this.lowerWorld(p.v, `${path}.bind.${p.k}`, env2);
        const cteSql = this.sqlOf(blk);
        this.ctes.push({ name: p.k, cols: null, sql: cteSql, recursive: false });
        env2.names.set(p.k, blk);
      }
    }
    if (cm.has('fix')) env2 = this.fix(n, cm, path, env2);
    let b;
    if (cm.has('in')) b = this.lowerWorld(cm.get('in'), `${path}.in`, env2);
    else if (n.first) b = this.lowerWorld(n.first, `${path}.first`, env2);
    else if (cm.has('bind') || cm.has('fix')) { this.reason('unsupported_term', 'DEF', null, path, n.pos, 'bind/fix without in:'); this.fail(); } else { this.reason('raw_world', 'DEF', null, path, n.pos, 'no input world'); this.fail(); }
    if (cm.has('sort') || cm.has('limit') || cm.has('offset')) {
      if (b.compound && (cm.has('sort'))) { /* order over compound: output names only */ }
      if (cm.has('sort')) {
        if (b.limit !== null || b.offset !== null) b = this.wrap(b);
        const sn = cm.get('sort'); if (sn.t !== 'list') { this.reason('unsupported_term', 'DEF', 'sort', `${path}.sort`, n.pos, 'sort must be a list'); this.fail(); }
        const keys = sn.items.map((it, i) => this.sortKey(it, b, `${path}.sort[${i}]`));
        b.orderBy = [...keys.flat(), ...b.orderBy];
      }
      if (cm.has('limit') || cm.has('offset')) {
        if (b.limit !== null || b.offset !== null) b = this.wrap(b);
        const sc = { b: this.mkBlock(), path };
        if (cm.has('limit')) b.limit = this.term(cm.get('limit'), sc, `${path}.limit`);
        if (cm.has('offset')) b.offset = this.term(cm.get('offset'), sc, `${path}.offset`);
      }
    }
    return b;
  }
  fix(n, cm, path, env) {
    const name = this.constStr(cm.get('fix'), `${path}.fix`);
    if (!cm.has('base') || !cm.has('step')) { this.reason('fix_shape', 'DEF', 'fix', path, n.pos, 'fix needs base and step'); this.fail(); }
    const mode = cm.has('mode') ? this.constStr(cm.get('mode'), `${path}.mode`) : 'union';
    if ((this.t === 'sqlserver' || this.t === 'oracle') && mode === 'union') { this.reason('fix_shape', 'DEF', 'mode', `${path}.mode`, n.pos, `${this.t} requires UNION ALL in the recursive member; mode "union" cannot be said`); this.fail(); }
    const base = this.lowerWorld(cm.get('base'), `${path}.base`, env);
    const cols = base.select.map((c) => c.name);
    const env2 = { names: new Map(env.names) };
    const ref = this.mkBlock({ from: this.q(name) }); ref.select = cols.map((c) => ({ name: c, expr: this.q(c) })); ref.fromName = name;
    env2.names.set(name, ref);
    const step = this.lowerWorld(cm.get('step'), `${path}.step`, env2);
    if (step.select.length !== cols.length) { this.reason('fix_shape', 'DEF', 'step', `${path}.step`, n.pos, 'base and step differ in column count'); this.fail(); }
    const stepSql = this.sqlOf(this.alignCols(step, cols));
    this.ctes.push({ name, cols, sql: `${this.sqlOf(base)}\n${mode === 'union_all' ? 'UNION ALL' : 'UNION'}\n${stepSql}`, recursive: true });
    return env2;
  }
  alignCols(b, cols) { const nb = { ...b, select: b.select.map((c, i) => ({ ...c, name: cols[i] })) }; return nb; }

  sortKey(it, b, path) {
    const o = it.t === 'ordered' ? it : { x: it, dir: 'asc', nulls: null };
    const e = this.term(o.x, { b, path }, path);
    const dir = o.dir === 'desc' ? 'DESC' : 'ASC';
    const nulls = o.nulls; const t = this.t;
    const dflt = dir === 'ASC' ? 'first' : 'last'; // EOQL default: NULLs first ascending, last descending
    const keys = [];
    if (t === 'sqlite') { keys.push(`${e} ${dir}${nulls ? ` NULLS ${nulls.toUpperCase()}` : ''}`); return keys; }
    if (t === 'postgres' || t === 'oracle') { keys.push(`${e} ${dir} NULLS ${(nulls || dflt).toUpperCase()}`); return keys; }
    if (nulls && nulls !== dflt) {
      if (t === 'mysql') keys.push(`(${e} IS NULL) ${nulls === 'last' ? 'ASC' : 'DESC'}`);
      else keys.push(`CASE WHEN ${e} IS NULL THEN ${nulls === 'first' ? 0 : 1} ELSE ${nulls === 'first' ? 1 : 0} END ASC`);
    }
    keys.push(`${e} ${dir}`);
    return keys;
  }

  vREC(n, path, env) {
    let b = this.input(n, path, env);
    const cm = this.cm(n);
    const hasWin = cm.has('by') || cm.has('order') || cm.has('rows');
    void hasWin;
    if (b.compound || b.limit !== null || b.offset !== null || b.distinct) b = this.wrap(b);
    const base = { ...b, select: b.select.map((c) => ({ ...c })) };
    const winSpec = { by: cm.has('by') ? cm.get('by').items : [], order: cm.has('order') ? cm.get('order').items : [], rows: cm.has('rows') ? cm.get('rows') : null };
    let select = base.select;
    if (cm.has('set')) {
      const sn = cm.get('set'); if (sn.t !== 'obj') { this.reason('unsupported_term', 'REC', 'set', `${path}.set`, n.pos, 'set must be an object'); this.fail(); }
      for (const p of sn.pairs) {
        const cur = { ...base, select };
        const e = this.term(p.v, { b: cur, path: `${path}.set.${p.k}`, win: winSpec, allowWin: true }, `${path}.set.${p.k}`);
        const nc = { name: p.k, expr: isPredNode(p.v) && (this.t === 'sqlserver' || this.t === 'oracle') ? `CASE WHEN ${e} THEN 1 ELSE 0 END` : e };
        const k = select.findIndex((c) => c.name === p.k);
        select = k >= 0 ? select.map((c, i) => (i === k ? nc : c)) : [...select, nc];
        if (/\bOVER\s*\(/.test(e) || /\bOVER\b/.test(e)) base.windowedSelect = true;
      }
    }
    if (cm.has('rename')) {
      const rn = cm.get('rename'); const map = new Map(rn.pairs.map((p) => [p.k, this.constStr(p.v, `${path}.rename.${p.k}`)]));
      for (const k of map.keys()) if (!select.some((c) => c.name === k)) { this.reason('unsupported_term', 'REC', 'rename', `${path}.rename`, n.pos, `no column ${k}`); this.fail(); }
      select = select.map((c) => (map.has(c.name) ? { ...c, name: map.get(c.name) } : c));
    }
    if (cm.has('pick')) {
      const pk = this.strList(cm.get('pick'), `${path}.pick`);
      const out = [];
      for (const k of pk) { const c = select.find((x) => x.name === k); if (!c) { this.reason('unsupported_term', 'REC', 'pick', `${path}.pick`, n.pos, `no column ${k}`); this.fail(); } out.push(c); }
      select = out;
    }
    const nb = { ...base, select };
    if (select.some((c) => /\bOVER\s*\(/.test(c.expr))) nb.windowedSelect = true;
    return nb;
  }
  vSYN(n, path, env) {
    const cm = this.cm(n);
    if (cm.has('with')) {
      const mode = cm.has('mode') ? this.constStr(cm.get('mode'), `${path}.mode`) : 'merge';
      if (mode === 'merge') { this.reason('counterfactual', 'SYN', 'with', `${path}.with`, n.pos, 'a merge of two logs (raw worlds)'); this.fail(); }
      const a = this.input(n, path, env); const c = this.lowerWorld(cm.get('with'), `${path}.with`, env);
      if (a.select.length !== c.select.length) { this.reason('unsupported_term', 'SYN', 'with', `${path}.with`, n.pos, 'set operation needs the same number of columns'); this.fail(); }
      return this.setop(a, c, mode, n, path);
    }
    let b = this.input(n, path, env);
    if (cm.has('distinct')) {
      const dv = cm.get('distinct');
      let all = true;
      if (dv.t === 'list') { const cols = this.strList(dv, `${path}.distinct`); all = cols.length === b.select.length && b.select.every((c) => cols.includes(c.name)); } else all = !(dv.t === 'lit' && dv.v === false);
      if (!all) { this.reason('dialect_construct', 'SYN', 'distinct', `${path}.distinct`, n.pos, 'one row per distinct tuple of a column subset keeps the first row of the others: no faithful SQL'); this.fail(); }
      if (b.distinct || b.compound || b.limit !== null || b.offset !== null) b = this.wrap(b);
      return { ...b, distinct: true };
    }
    if (!cm.has('agg') && !cm.has('by')) return b;
    if (b.grouped || b.distinct || b.compound || b.limit !== null || b.offset !== null || b.windowedSelect || b.orderBy.length) b = this.wrap(b); // an inner ORDER BY feeds order-sensitive aggregates (group_concat): keep it inside
    const by = cm.has('by') ? cm.get('by').items : [];
    const keys = by.map((x, i) => {
      const e = this.term(x, { b, path: `${path}.by[${i}]` }, `${path}.by[${i}]`);
      const name = x.t === 'path' ? print(x).replace(/^\$/, '') : `_g${i + 1}`;
      return { name, expr: e };
    });
    const aggs = [];
    if (cm.has('agg')) for (const p of cm.get('agg').pairs) aggs.push({ name: p.k, expr: this.term(p.v, { b, path: `${path}.agg.${p.k}`, aggOk: true }, `${path}.agg.${p.k}`) });
    const nb = { ...b, select: [...keys, ...aggs], groupBy: keys.map((k) => k.expr), grouped: true };
    nb.hasAggNoGroup = !keys.length;
    return nb;
  }
  setop(a, c, mode, n, path) {
    const op = { union: 'UNION', union_all: 'UNION ALL', intersect: 'INTERSECT', except: this.t === 'oracle' ? 'MINUS' : 'EXCEPT' }[mode];
    if (!op) { this.reason('unsupported_term', 'SYN', 'mode', `${path}.mode`, n.pos, `unknown mode ${mode}`); this.fail(); }
    if ((mode === 'intersect' || mode === 'except') && this.t === 'mysql') this.note('W_VERSION', 'INTERSECT/EXCEPT need MySQL 8.0.31 or newer');
    const mem = (b) => { const bb = (b.orderBy.length || b.limit !== null || b.offset !== null) ? this.wrap(b) : b; return bb.compound ? this.wrap(bb) : bb; };
    const left = a.compound ? a : mem(a);
    const right = mem(c);
    const nb = this.mkBlock({ select: a.select.map((x) => ({ name: x.name, expr: this.q(x.name) })), compound: { parts: a.compound ? [...a.compound.parts, right] : [left, right], ops: a.compound ? [...a.compound.ops, op] : [op] } });
    return nb;
  }
  vCON(n, path, env) {
    const cm = this.cm(n);
    if (cm.has('follow')) {
      this.reason('ancestry', 'CON', 'follow', `${path}.follow`, n.pos, 'transitive ancestry over of/seen links');
      if (cm.has('dir') && cm.get('dir').t === 'lit' && cm.get('dir').v === 'concurrent') this.reason('causal_latest', 'CON', 'dir', `${path}.dir`, n.pos, 'entries neither before nor after: a causal-order question');
      this.reason('held_sets', 'CON', 'follow', `${path}.follow`, n.pos, 'the _fork/_episode/_siblings columns replay head sets');
      this.fail();
    }
    let L = this.input(n, path, env);
    if (!cm.has('to')) { this.reason('unsupported_term', 'CON', null, path, n.pos, 'CON needs to: or follow:'); this.fail(); }
    let R = this.lowerWorld(cm.get('to'), `${path}.to`, env);
    const join = cm.has('join') ? this.constStr(cm.get('join'), `${path}.join`) : 'inner';
    const asL = cm.has('as') ? this.constStr(cm.get('as'), `${path}.as`) : null;
    const asR = cm.has('to_as') ? this.constStr(cm.get('to_as'), `${path}.to_as`) : null;
    const prefixL = !(L.joined && !asL), prefixR = !(R.joined && !asR);
    const aL = asL || 'l', aR = asR || 'r';
    const outer = ['left', 'right', 'full'].includes(join);
    if (join === 'full' && this.t === 'mysql') { this.reason('dialect_construct', 'CON', 'join', `${path}.join`, n.pos, 'FULL JOIN has no faithful text on mysql'); this.fail(); }
    if (join === 'full' || join === 'right') this.note('W_VERSION', `${join} joins need a SQLite 3.39 or newer`);
    // sides as FROM sources
    const side = (b, alias, prefixed, isLeft) => {
      if (b.joined && !prefixed) return { from: b.from, joins: b.joins, cols: b.select, simple: true, joinedChain: true, block: b };
      const plain = b.baseName && !b.where.length && !b.groupBy.length && !b.orderBy.length && b.limit === null && !b.compound && !b.distinct && b.select.every((c) => c.expr === this.q(c.name));
      if (plain) return { from: `${this.q(b.baseName)} ${this.q(alias)}`, joins: [], cols: b.select.map((c) => ({ name: c.name, expr: `${this.q(alias)}.${this.q(c.name)}` })), simple: true, block: b };
      if (b.fromName && !b.where.length && !b.groupBy.length && !b.orderBy.length && b.limit === null && !b.compound && !b.distinct) return { from: `${this.q(b.fromName)} ${this.q(alias)}`, joins: [], cols: b.select.map((c) => ({ name: c.name, expr: `${this.q(alias)}.${this.q(c.name)}` })), simple: true, block: b };
      const sql = this.sqlOf(b);
      return { from: `(${sql}) ${this.q(alias)}`, joins: [], cols: b.select.map((c) => ({ name: c.name, expr: `${this.q(alias)}.${this.q(c.name)}` })), simple: false, block: b };
    };
    if (isLeftComplex(L) && !L.joined) L = this.wrap(L);
    if (L.joined && (L.where.length || L.groupBy.length || L.orderBy.length || L.limit !== null || L.distinct || L.compound || L.windowedSelect)) L = this.wrap(L);
    if (R.joined && !R.compound) R = this.wrap(R);
    const sl = side(L, aL, prefixL, true), sr = side(R, aR, prefixR, false);
    const lcols = sl.cols.map((c) => ({ name: prefixL ? `${aL}.${c.name}` : c.name, expr: c.expr }));
    const rcols = sr.cols.map((c) => ({ name: prefixR ? `${aR}.${c.name}` : c.name, expr: c.expr }));
    const sel = [...lcols, ...rcols];
    const names = sel.map((c) => c.name);
    if (new Set(names).size !== names.length) { this.reason('unsupported_term', 'CON', null, path, n.pos, 'join aliases give duplicate column names; use as: and to_as:'); this.fail(); }
    const combined = this.mkBlock({ select: sel });
    const onTerm = cm.has('on') ? this.pred(cm.get('on'), { b: combined, path: `${path}.on` }, `${path}.on`) : null;
    if (join === 'semi' || join === 'anti' || join === 'anti_null') {
      const cond = onTerm || '1 = 1';
      const ex = join === 'anti_null' ? `NOT EXISTS (SELECT 1 FROM ${sr.from} WHERE CASE WHEN ${cond} THEN 1 WHEN NOT (${cond}) THEN 0 ELSE 1 END = 1)` : `${join === 'anti' ? 'NOT ' : ''}EXISTS (SELECT 1 FROM ${sr.from} WHERE ${cond})`;
      const nb = sl.joinedChain ? { ...L, where: [...L.where], joins: [...L.joins], select: L.select.map((c) => ({ ...c })) } : this.mkBlock({ from: sl.from, joined: false });
      nb.where.push(ex);
      nb.select = L.select.map((c, i) => ({ name: c.name, expr: sl.cols[i].expr }));
      if (L.joined) nb.joined = true;
      return nb;
    }
    const kw = { inner: 'INNER JOIN', left: 'LEFT JOIN', right: 'RIGHT JOIN', full: 'FULL OUTER JOIN', cross: 'CROSS JOIN' }[join];
    if (!kw) { this.reason('unsupported_term', 'CON', 'join', `${path}.join`, n.pos, `unknown join ${join}`); this.fail(); }
    void outer;
    const joinLine = `${kw} ${sr.from}${onTerm && join !== 'cross' ? ` ON ${onTerm}` : ''}`;
    const nb = this.mkBlock({ from: sl.from, joins: [...sl.joins, joinLine], select: sel, joined: true });
    return nb;
  }

  // ---- SQL text ---------------------------------------------------------------------------------------------------------------------
  sqlOf(b) {
    if (b.compound) {
      const parts = b.compound.parts.map((p) => this.sqlOf(p));
      let s = parts[0]; b.compound.ops.forEach((op, i) => { s += `\n${op}\n${parts[i + 1]}`; });
      const tail = this.tail(b);
      return tail ? `${s}\n${tail}` : s;
    }
    const lines = [];
    lines.push(`SELECT ${b.distinct ? 'DISTINCT ' : ''}${b.select.map((c) => (c.expr === this.q(c.name) ? c.expr : `${c.expr} AS ${this.q(c.name)}`)).join(', ')}`);
    if (b.from) lines.push(`FROM ${b.from}`); else if (this.t === 'oracle') lines.push('FROM DUAL');
    for (const j of b.joins) lines.push(j);
    if (b.where.length) lines.push(`WHERE ${b.where.join(' AND ')}`);
    if (b.groupBy.length) lines.push(`GROUP BY ${b.groupBy.join(', ')}`);
    if (b.having.length) lines.push(`HAVING ${b.having.join(' AND ')}`);
    const tail = this.tail(b);
    if (tail) lines.push(tail);
    return lines.join('\n');
  }
  tail(b) {
    const out = [];
    let ord = b.orderBy;
    if (ord.length) out.push(`ORDER BY ${ord.join(', ')}`);
    if (b.limit !== null || b.offset !== null) {
      if (this.t === 'sqlserver' && !ord.length) { out.push('ORDER BY (SELECT NULL)'); this.note('W_UNORDERED_PAGE', 'OFFSET paging with no ORDER BY'); }
      out.push(this.limitClause(b.limit, b.offset));
    }
    return out.join('\n');
  }
  limitClause(limit, offset) {
    const t = this.t;
    if (limit !== null && offset !== null) return this.cfg.limitOffset.replace('{limit}', limit).replace('{offset}', offset);
    if (limit !== null) return this.cfg.limitOffset.replace('{limit}', limit).replace('{offset}', '0');
    // offset only
    if (t === 'postgres') return `OFFSET ${offset}`;
    if (t === 'mysql') return `LIMIT ${offset}, 18446744073709551615`;
    if (t === 'sqlite') return `LIMIT -1 OFFSET ${offset}`;
    return `OFFSET ${offset} ROWS`;
  }
  finish(b) {
    let body = this.sqlOf(b);
    if (this.ctes.length) {
      const rec = this.ctes.some((c) => c.recursive);
      const kw = rec && this.t !== 'sqlserver' && this.t !== 'oracle' ? 'WITH RECURSIVE' : 'WITH';
      const defs = this.ctes.map((c) => `${this.q(c.name)}${c.cols ? `(${c.cols.map((x) => this.q(x)).join(', ')})` : ''} AS (${c.sql})`);
      body = `${kw} ${defs.join(', ')}\n${body}`;
    }
    return body;
  }
  placeholder(name) {
    if (!this.params.includes(name)) this.params.push(name);
    if (this.t === 'postgres') { this.bindOrder.push(name); return `$${this.bindOrder.length}`; }
    if (this.t === 'mysql') { this.bindOrder.push(name); return '?'; }
    if (this.t === 'sqlserver') return `@${name}`;
    return `:${name}`;
  }

  // ---- terms -----------------------------------------------------------------------------------------------------------------------
  pred(n, sc, path) { return this.term(n, sc, path); }
  tr(n, sc, path, reasonOk = false) { return this.term(n, sc, path, reasonOk); }
  term(n, sc, path) {
    switch (n.t) {
      case 'lit': {
        if (n.v === null) return 'NULL';
        if (typeof n.v === 'boolean') return this.bool(n.v);
        if (typeof n.v === 'number') return n.real && Number.isInteger(n.v) ? `${n.v}.0` : JSON.stringify(n.v);
        if (typeof n.v === 'string') { if (n.v.includes('\u0000')) { this.reason('unsupported_term', null, null, path, n.pos, 'a string with a NUL character'); this.fail(); } return this.lit(n.v); }
        break;
      }
      case 'param': return this.placeholder(n.name);
      case 'path': return this.pathTerm(n, sc, path);
      case 'label': case 'idref': case 'heads': this.reason('unsupported_term', null, null, path, n.pos, `${n.t} has no SQL meaning`); this.fail(); break;
      case 'star': return '*';
      case 'un': return `(-${this.term(n.x, sc, path)})`;
      case 'bin': {
        const a = this.term(n.a, sc, path), b = this.term(n.b, sc, path);
        if (n.op === 'AND' || n.op === 'OR') return `(${a} ${n.op} ${b})`;
        if (n.op === '||') return this.concat(a, b, n);
        if (n.op === '/') {
          const realOp = (x) => x.t === 'lit' && typeof x.v === 'number' && x.real;
          if ((this.t === 'mysql' || this.t === 'oracle') && !(realOp(n.a) || realOp(n.b))) { this.reason('dialect_construct', null, null, path, n.pos, `integer division on ${this.t}: '/' is not integer division and operand types are unknown at compile time`); this.fail(); }
          return `(${a} / NULLIF(${b}, 0))`;
        }
        if (n.op === '%') return this.t === 'oracle' ? `MOD(${a}, ${b})` : `(${a} % ${b})`;
        return `(${a} ${n.op} ${b})`;
      }
      case 'not': return `NOT (${this.term(n.x, sc, path)})`;
      case 'rel': return `${this.term(n.a, sc, path)} ${n.op === '!=' ? '<>' : n.op} ${this.term(n.b, sc, path)}`;
      case 'isnull': return `${par(this.term(n.x, sc, path))} IS ${n.neg ? 'NOT ' : ''}NULL`;
      case 'isset': { const x = this.term(n.x, sc, path); const t = `(${x} IS NOT NULL AND ${x} <> '')`; return n.neg ? `NOT ${t}` : t; }
      case 'between': return `${par(this.term(n.x, sc, path))} ${n.neg ? 'NOT ' : ''}BETWEEN ${par(this.term(n.lo, sc, path))} AND ${par(this.term(n.hi, sc, path))}`;
      case 'in': {
        const x = par(this.term(n.x, sc, path));
        if (n.rhs.t === 'list') return `${x} ${n.neg ? 'NOT ' : ''}IN (${n.rhs.items.map((i) => this.term(i, sc, path)).join(', ')})`;
        if (n.rhs.t === 'param') { this.reason('unsupported_term', null, null, path, n.pos, 'a list-valued param has no portable placeholder'); this.fail(); }
        const sub = n.rhs.t === 'sub' ? n.rhs.x : n.rhs;
        const b = this.lowerWorld(sub, `${path}.in`, sc.env || { names: new Map() });
        return `${x} ${n.neg ? 'NOT ' : ''}IN (${this.sqlOf(b)})`;
      }
      case 'like': return this.likeTerm(n, sc, path);
      case 'glob': if (this.t !== 'sqlite') { this.reason('dialect_construct', null, null, path, n.pos, `glob on ${this.t}`); this.fail(); } return `${par(this.term(n.x, sc, path))} ${n.neg ? 'NOT ' : ''}GLOB ${par(this.term(n.pat, sc, path))}`;
      case 'contains': {
        const x = `LOWER(${this.textOf(this.term(n.x, sc, path))})`; const y = `LOWER(${this.textOf(this.term(n.rhs, sc, path))})`;
        const f = this.t === 'postgres' ? `STRPOS(${x}, ${y})` : this.t === 'sqlserver' ? `CHARINDEX(${y}, ${x})` : `INSTR(${x}, ${y})`;
        return `${f} ${n.neg ? '=' : '>'} 0`;
      }
      case 'is': { const x = `LOWER(${this.textOf(this.term(n.x, sc, path))})`; const y = `LOWER(${this.textOf(this.term(n.rhs, sc, path))})`; return n.neg ? `(${x} <> ${y} OR ${x} IS NULL)` : `${x} = ${y}`; }
      case 'call': return this.callTerm(n, sc, path);
      case 'verb': { // an uncorrelated scalar subquery
        const b = this.lowerWorld(n, `${path}`, sc.env || { names: new Map() });
        return `(${this.sqlOf(b)})`;
      }
      case 'obj': case 'list': this.reason('unsupported_term', null, null, path, n.pos, 'a JSON value in a term'); this.fail(); break;
      case 'ordered': return this.term(n.x, sc, path);
      case 'viewcall': this.reason('unresolved_name', null, null, path, n.pos, `stored view ${n.name}`); this.fail(); break;
      default: this.reason('unsupported_term', null, null, path, n.pos, `term ${n.t}`); this.fail();
    }
    return 'NULL';
  }
  textOf(s) { return this.t === 'sqlite' ? s : this.t === 'postgres' ? `CAST(${s} AS TEXT)` : this.t === 'mysql' ? `CAST(${s} AS CHAR)` : this.t === 'sqlserver' ? `CAST(${s} AS NVARCHAR(MAX))` : `TO_CHAR(${s})`; }
  concat(a, b, n) {
    const t = this.t;
    if (t === 'sqlite' || t === 'postgres') return `(${a} || ${b})`;
    if (t === 'mysql') return `CONCAT(${a}, ${b})`;
    const isStrLit = (x) => x.t === 'lit' && typeof x.v === 'string';
    if (t === 'sqlserver') return `(${isStrLit(n.a) ? a : `CAST(${a} AS NVARCHAR(MAX))`} + ${isStrLit(n.b) ? b : `CAST(${b} AS NVARCHAR(MAX))`})`;
    return `CASE WHEN ${a} IS NULL OR ${b} IS NULL THEN NULL ELSE ${a} || ${b} END`;
  }
  likeTerm(n, sc, path) {
    const x = this.term(n.x, sc, path), p = this.term(n.pat, sc, path); const esc = n.esc ? ` ESCAPE ${this.term(n.esc, sc, path)}` : '';
    const neg = n.neg ? 'NOT ' : '';
    if (this.t === 'postgres') return `${par(x)} ${neg}ILIKE ${par(p)}${esc}`;
    if (this.t === 'sqlserver' || this.t === 'oracle') return `LOWER(${x}) ${neg}LIKE LOWER(${p})${esc}`;
    return `${par(x)} ${neg}LIKE ${par(p)}${esc}`;
  }
  pathTerm(n, sc, path) {
    const names = n.parts.filter((p) => p.name !== undefined).map((p) => p.name);
    const sysHit = names.length === 1 && SYSCOL_REASON[names[0]] ? names[0] : null;
    if (sysHit) { this.reason(SYSCOL_REASON[sysHit], null, null, path, n.pos, `the system column ${sysHit} belongs to the log projection`); this.fail(); }
    const b = sc.b;
    const r = this.resolve(b, names, n.pos, path);
    if (!r) { this.reason('unsupported_term', null, null, path, n.pos, `no column ${names.join('.')}`); this.fail(); }
    let e = par(r.col.expr);
    if (r.rest.length || n.parts.some((p) => p.idx !== undefined)) {
      const steps = [...r.rest.map((x) => `.${x}`), ...n.parts.filter((p) => p.idx !== undefined).map((p) => `[${p.idx}]`)];
      e = this.jsonGet(e, `$${steps.join('')}`);
    }
    return e;
  }
  jsonGet(x, p) {
    const lit = this.lit(p);
    switch (this.t) {
      case 'sqlite': return `JSON_EXTRACT(${x}, ${lit})`;
      case 'mysql': return `JSON_UNQUOTE(JSON_EXTRACT(${x}, ${lit}))`;
      case 'sqlserver': case 'oracle': return `JSON_VALUE(${x}, ${lit})`;
      default: { const m = /^\$\.([A-Za-z0-9_]+)$/.exec(p); if (m) return `${x}->>'${m[1]}'`; return `jsonb_path_query_first(CAST(${x} AS jsonb), ${lit}) #>> '{}'`; }
    }
  }
  cast(x, to) {
    const T = {
      sqlite: { integer: 'INTEGER', real: 'REAL', text: 'TEXT', numeric: 'NUMERIC' }, postgres: { integer: 'BIGINT', real: 'DOUBLE PRECISION', text: 'TEXT', numeric: 'NUMERIC' },
      mysql: { integer: 'SIGNED', real: 'DOUBLE', text: 'CHAR', numeric: 'DECIMAL(65,30)' }, sqlserver: { integer: 'BIGINT', real: 'FLOAT', text: 'NVARCHAR(MAX)', numeric: 'NUMERIC(38,10)' }, oracle: { integer: 'NUMBER(19)', real: 'BINARY_DOUBLE', text: 'VARCHAR2(4000)', numeric: 'NUMBER' },
    }[this.t][to];
    return `CAST(${x} AS ${T})`;
  }
  callTerm(n, sc, path) {
    const name = n.name; const t = this.t;
    const rawArgs = n.args;
    const unsupported = (why, cls = 'unsupported_term') => { this.reason(cls, null, null, path, n.pos, why); this.fail(); };
    if (AGGF.has(name) && !sc.aggOk && !sc.allowWin) unsupported(`aggregate ${name} outside SYN agg or a REC window`, 'unsupported_term');
    if (AGGF.has(name) || WINF.has(name)) return this.aggOrWin(n, sc, path);
    const A = () => rawArgs.map((a) => this.term(a, sc, path));
    switch (name) {
      case 'abs': case 'sign': return `${name.toUpperCase()}(${A().join(', ')})`;
      case 'ceil': return t === 'sqlserver' ? `CEILING(${A()[0]})` : `CEIL(${A()[0]})`;
      case 'floor': return `FLOOR(${A()[0]})`;
      case 'round': return `ROUND(${A().join(', ')})`;
      case 'length': return t === 'sqlserver' ? `LEN(${A()[0]})` : `LENGTH(${A()[0]})`;
      case 'lower': case 'upper': return `${name.toUpperCase()}(${A()[0]})`;
      case 'substr': { const a = A(); if (t === 'sqlserver') return `SUBSTRING(${a[0]}, ${a[1]}, ${a[2] || '8000'})`; return `SUBSTR(${a.join(', ')})`; }
      case 'instr': { const a = A(); return t === 'postgres' ? `STRPOS(${a[0]}, ${a[1]})` : t === 'sqlserver' ? `CHARINDEX(${a[1]}, ${a[0]})` : `INSTR(${a[0]}, ${a[1]})`; }
      case 'replace': return `REPLACE(${A().join(', ')})`;
      case 'trim': case 'ltrim': case 'rtrim': return `${name.toUpperCase()}(${A().join(', ')})`;
      case 'least': case 'greatest': { const a = A(); if (t === 'sqlite') return `${name === 'least' ? 'MIN' : 'MAX'}(${a.join(', ')})`; if (t === 'sqlserver') unsupported(`${name} on sqlserver`); if (t === 'postgres') this.note('W_NULL_SEMANTICS', `${name.toUpperCase()} on postgres ignores NULL arguments; EOQL returns NULL if any is NULL`); return `${name.toUpperCase()}(${a.join(', ')})`; }
      case 'coalesce': return `COALESCE(${A().join(', ')})`;
      case 'nullif': return `NULLIF(${A().join(', ')})`;
      case 'iif': { const a = A(); return t === 'sqlite' ? `IIF(${a.join(', ')})` : `CASE WHEN ${a[0]} THEN ${a[1]} ELSE ${a[2]} END`; }
      case 'case': {
        const a = rawArgs; const parts = []; let i = 0;
        for (; i + 1 < a.length; i += 2) parts.push(`WHEN ${this.term(a[i], sc, path)} THEN ${this.term(a[i + 1], sc, path)}`);
        if (i < a.length) parts.push(`ELSE ${this.term(a[i], sc, path)}`);
        return `CASE ${parts.join(' ')} END`;
      }
      case 'cast': { const to = rawArgs[1] && rawArgs[1].t === 'lit' ? String(rawArgs[1].v).toLowerCase() : null; if (!to) unsupported('cast type must be a literal'); return this.cast(this.term(rawArgs[0], sc, path), to); }
      case 'typeof': if (t !== 'sqlite') { this.reason('dialect_construct', null, null, path, n.pos, `typeof on ${t}`); this.fail(); } return `TYPEOF(${A()[0]})`;
      case 'nocase': if (t !== 'sqlite') { this.reason('dialect_construct', null, null, path, n.pos, `nocase on ${t}`); this.fail(); } return `LOWER(${A()[0]})`;
      case 'json_get': { const p = rawArgs[1]; if (!(p && p.t === 'lit' && typeof p.v === 'string')) unsupported('json_get needs a literal path'); return this.jsonGet(this.term(rawArgs[0], sc, path), p.v); }
      case 'json_array_length': if (t !== 'sqlite') { this.reason('dialect_construct', null, null, path, n.pos, `json_array_length on ${t}`); this.fail(); } return `JSON_ARRAY_LENGTH(${A().join(', ')})`;
      case 'json_valid': if (t !== 'sqlite') { this.reason('dialect_construct', null, null, path, n.pos, `json_valid on ${t}`); this.fail(); } return `JSON_VALID(${A()[0]})`;
      case 'nulleq': { const a = A(); if (t === 'sqlite') return `(${a[0]} IS ${a[1]})`; if (t === 'postgres') return `(${a[0]} IS NOT DISTINCT FROM ${a[1]})`; if (t === 'mysql') return `(${a[0]} <=> ${a[1]})`; unsupported(`nulleq on ${t}`); break; }
      case 'date': case 'time': case 'datetime': case 'strftime': case 'julianday': case 'unixepoch': if (t !== 'sqlite') { this.reason('dialect_construct', null, null, path, n.pos, `${name} on ${t}: EOQL's specifiers have no mapping to ${t}'s date functions`); this.fail(); } return `${name.toUpperCase()}(${A().join(', ')})`;
      default: unsupported(`function ${name} has no lowering for ${t}`);
    }
    return 'NULL';
  }
  aggOrWin(n, sc, path) {
    const name = n.name; const t = this.t;
    const isWin = WINF.has(name);
    const args = n.args.map((a) => (a.t === 'star' ? '*' : this.term(a, sc, path)));
    let fn;
    if (isWin) fn = `${name.toUpperCase()}(${args.join(', ')})`;
    else if (name === 'group_concat') {
      const sep = args.length > 1 ? args[1] : "','";
      if (n.distinct && t === 'sqlite') { if (args.length > 1) { this.reason('dialect_construct', null, null, path, n.pos, 'sqlite: a DISTINCT aggregate takes exactly one argument, so group_concat(DISTINCT x, sep) has no text'); this.fail(); } }
      if (t === 'sqlite') fn = n.distinct ? `GROUP_CONCAT(DISTINCT ${args[0]})` : `GROUP_CONCAT(${args[0]}, ${sep})`;
      else if (t === 'mysql') fn = `GROUP_CONCAT(${n.distinct ? 'DISTINCT ' : ''}${args[0]} SEPARATOR ${sep})`;
      else if (t === 'oracle') { this.note('W_AGG_ORDER', 'LISTAGG orders by the field itself, which is not input order'); fn = `LISTAGG(${args[0]}, ${sep}) WITHIN GROUP (ORDER BY ${args[0]})`; } else fn = `STRING_AGG(${args[0]}, ${sep})`;
    } else if (name === 'total') fn = `COALESCE(CAST(SUM(${args[0]}) AS ${t === 'sqlite' ? 'REAL' : t === 'postgres' ? 'DOUBLE PRECISION' : t === 'mysql' ? 'DOUBLE' : t === 'sqlserver' ? 'FLOAT' : 'BINARY_DOUBLE'}), 0.0)`;
    else fn = `${name.toUpperCase()}(${n.distinct ? 'DISTINCT ' : ''}${args.join(', ')})`;
    const w = sc.win;
    if (sc.allowWin && w && (w.by.length || w.order.length || w.rows || isWin)) {
      const parts = [];
      if (w.by.length) parts.push(`PARTITION BY ${w.by.map((x) => this.term(x, sc.noWin || { ...sc, win: null, allowWin: false }, path)).join(', ')}`);
      if (w.order.length) parts.push(`ORDER BY ${w.order.map((x) => this.sortKey(x, sc.b, path).join(', ')).join(', ')}`);
      if (w.rows) {
        const [lo, hi] = w.rows.items.map((i) => (i.t === 'lit' ? i.v : i.t === 'un' ? -i.x.v : null));
        const b = (v, isLo) => (v === null || v === undefined ? (isLo ? 'UNBOUNDED PRECEDING' : 'UNBOUNDED FOLLOWING') : v === 0 ? 'CURRENT ROW' : v < 0 ? `${-v} PRECEDING` : `${v} FOLLOWING`);
        parts.push(`ROWS BETWEEN ${b(lo, true)} AND ${b(hi, false)}`);
      }
      return `${fn} OVER (${parts.join(' ')})`;
    }
    if (isWin) return `${fn} OVER ()`;
    if (sc.allowWin && !sc.aggOk) return `${fn} OVER ()`; // an aggregate in REC set with no by/order is a whole-input window
    return fn;
  }
}
function isLeftComplex(b) { return b.where.length || b.groupBy.length || b.orderBy.length || b.limit !== null || b.distinct || b.compound || b.windowedSelect || b.having.length; }
