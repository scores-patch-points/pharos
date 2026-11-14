// sql/v1.mjs: OPTIONAL tier T-V1AST (SPEC-A1 3.4). v1's `toAST()` JSON in; the mapping IS the table of SPEC-A1 2.2: the pipeline is
// assembled into one query the way v1's compiler assembles one context (clause order is fixed, not pipeline order), written as
// dialect-neutral SQL text and translated by the SQL translator. Host functions have no landing (SQL_V1_HOSTFN).
import { EoqlError } from '../errors.mjs';
import { translateSqlText } from './translate.mjs';

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

class V1 {
  constructor() { this.gaps = []; }
  gap(gap, construct) { this.gaps.push({ gap, construct, pos: 0 }); }
  val(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'string') return q(v);
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (typeof v === 'number') return String(v);
    if (Array.isArray(v)) return `(${v.map((x) => this.val(x)).join(', ')})`;
    this.gap('SQL_V1_HOSTFN', `value of type ${typeof v}`); return 'NULL';
  }
  expr(e) {
    if (e === null || e === undefined) return 'NULL';
    if (typeof e !== 'object') return this.val(e);
    if (typeof e === 'function') { this.gap('SQL_V1_HOSTFN', 'function'); return 'NULL'; }
    switch (e.type) {
      case 'literal': return this.val(e.value);
      case 'field': return e.name;
      case 'eq': return `${this.expr(e.left)} = ${this.expr(e.right)}`;
      case 'ne': return `${this.expr(e.left)} <> ${this.expr(e.right)}`;
      case 'gt': return `${this.expr(e.left)} > ${this.expr(e.right)}`;
      case 'gte': return `${this.expr(e.left)} >= ${this.expr(e.right)}`;
      case 'lt': return `${this.expr(e.left)} < ${this.expr(e.right)}`;
      case 'lte': return `${this.expr(e.left)} <= ${this.expr(e.right)}`;
      case 'like': return `${this.expr(e.field)} LIKE ${this.val(e.pattern)}`;
      case 'ilike': return `${this.expr(e.field)} ILIKE ${this.val(e.pattern)}`;
      case 'in': return `${this.expr(e.field)} IN ${this.val(e.values)}`;
      case 'not_in': return `${this.expr(e.field)} NOT IN ${this.val(e.values)}`;
      case 'in_subquery': return `${this.expr(e.field)} IN (${this.query(e.subquery)})`;
      case 'not_in_subquery': return `${this.expr(e.field)} NOT IN (${this.query(e.subquery)})`;
      case 'between': return `${this.expr(e.field)} BETWEEN ${this.val(e.low)} AND ${this.val(e.high)}`;
      case 'is_null': return `${this.expr(e.field)} IS NULL`;
      case 'is_not_null': return `${this.expr(e.field)} IS NOT NULL`;
      case 'and': return `(${e.conditions.map((c) => this.expr(c)).join(' AND ')})`;
      case 'or': return `(${e.conditions.map((c) => this.expr(c)).join(' OR ')})`;
      case 'not': return `NOT (${this.expr(e.condition)})`;
      case 'add': return `(${this.expr(e.left)} + ${this.expr(e.right)})`;
      case 'sub': return `(${this.expr(e.left)} - ${this.expr(e.right)})`;
      case 'mul': return `(${this.expr(e.left)} * ${this.expr(e.right)})`;
      case 'div': return `(${this.expr(e.left)} / ${this.expr(e.right)})`;
      case 'mod': return `(${this.expr(e.left)} % ${this.expr(e.right)})`;
      case 'fn': return `${e.name}(${(e.args || []).map((a) => this.expr(a)).join(', ')})`;
      case 'agg': return `${e.fn}(${e.field === '*' ? '*' : this.expr(e.field)})`;
      default: this.gap('SQL_UNSUPPORTED_EXPR', `v1 expression ${e.type}`); return 'NULL';
    }
  }
  cond(c) {
    if (!c) return '1 = 1';
    if (c.type) return this.expr(c);
    const parts = [];
    for (const [field, value] of Object.entries(c)) {
      if (isObj(value)) {
        const p = [];
        if (value.$eq !== undefined) p.push(`${field} = ${this.val(value.$eq)}`);
        if (value.$ne !== undefined) p.push(`${field} <> ${this.val(value.$ne)}`);
        if (value.$gt !== undefined) p.push(`${field} > ${this.val(value.$gt)}`);
        if (value.$gte !== undefined) p.push(`${field} >= ${this.val(value.$gte)}`);
        if (value.$lt !== undefined) p.push(`${field} < ${this.val(value.$lt)}`);
        if (value.$lte !== undefined) p.push(`${field} <= ${this.val(value.$lte)}`);
        if (value.$in !== undefined) p.push(`${field} IN ${this.val(value.$in)}`);
        if (value.$nin !== undefined) p.push(`${field} NOT IN ${this.val(value.$nin)}`);
        if (value.$like !== undefined) p.push(`${field} LIKE ${this.val(value.$like)}`);
        if (value.$ilike !== undefined) p.push(`${field} ILIKE ${this.val(value.$ilike)}`);
        if (value.$between !== undefined) p.push(`${field} BETWEEN ${this.val(value.$between[0])} AND ${this.val(value.$between[1])}`);
        if (value.$isNull === true) p.push(`${field} IS NULL`);
        if (value.$isNull === false) p.push(`${field} IS NOT NULL`);
        parts.push(p.length ? p.join(' AND ') : '1 = 1');
      } else parts.push(`${field} = ${this.val(value)}`);
    }
    return parts.join(' AND ');
  }
  source(s) { if (isObj(s) && s.table) return s.alias ? `${s.table} ${s.alias}` : s.table; return String(s); }
  query(a) {
    if (!a) return 'SELECT 1';
    const ast = a.toAST ? a.toAST() : a;
    if (typeof ast === 'string') return ast;
    const ctx = { select: [], from: null, joins: [], where: [], groupBy: [], having: [], orderBy: [], limit: null, offset: null, distinct: false, aggs: {}, wins: [], setOps: [], ctes: {}, rec: null };
    for (const n of ast.pipeline || []) this.node(n, ctx);
    return this.build(ctx, ast.ctes || {});
  }
  node(n, ctx) {
    const { operator, params = {} } = n;
    switch (operator) {
      case 'INS': if (params.operation && params.operation !== 'select') this.gap('SQL_WRITE_NOT_BUILT', `INS ${params.operation}`); if (params.source) ctx.from = this.source(params.source); break;
      case 'DES':
        if (typeof params.classify === 'function' || params.classify) this.gap('SQL_V1_HOSTFN', 'DES.classify');
        if (params.columns) ctx.select = params.columns.map((c) => { if (typeof c === 'string') return c; if (isObj(c)) { if (c.type) return this.expr(c); const en = Object.entries(c); if (en.length === 1) return `${this.expr(en[0][1])} AS ${en[0][0]}`; } return String(c); });
        if (params.alias) ctx.select = Object.entries(params.alias).map(([al, ex]) => `${this.expr(ex)} AS ${al}`);
        break;
      case 'SEG':
        if (params.distinct) { if (Array.isArray(params.distinct)) this.gap('SQL_DISTINCT_ON', 'DISTINCT ON'); else ctx.distinct = true; }
        if (params.where) ctx.where.push(this.cond(params.where));
        if (params.groupBy) ctx.groupBy = params.groupBy;
        if (params.having) ctx.having.push(this.cond(params.having));
        if (params.limit !== undefined) ctx.limit = params.limit;
        if (params.offset !== undefined) ctx.offset = params.offset;
        break;
      case 'CON': {
        const { target, on, type = 'inner', using } = params;
        if (['union', 'union_all', 'intersect', 'except'].includes(type)) { ctx.setOps.push({ type: type.toUpperCase().replace('_', ' '), query: target }); break; }
        const kw = { inner: 'INNER JOIN', left: 'LEFT JOIN', right: 'RIGHT JOIN', full: 'FULL OUTER JOIN', cross: 'CROSS JOIN', natural: 'NATURAL JOIN' }[type] || 'INNER JOIN';
        let s = `${kw} ${this.source(target)}`;
        if (on) s += ` ON ${this.cond(on)}`; else if (using) s += ` USING (${using.join(', ')})`;
        ctx.joins.push(s); break;
      }
      case 'ALT':
        if (params.orderBy) ctx.orderBy = params.orderBy.map((s) => { const f = typeof s === 'string' ? s : (isObj(s.field) ? this.expr(s.field) : s.field); const dir = s && s.direction === 'desc' ? 'DESC' : 'ASC'; return `${f} ${dir}${s && s.nullsFirst ? ' NULLS FIRST' : s && s.nullsLast ? ' NULLS LAST' : ''}`; });
        break;
      case 'SYN':
        if (typeof params.combine === 'function' || params.combine) this.gap('SQL_V1_HOSTFN', 'SYN.combine');
        if (params.aggregations) Object.assign(ctx.aggs, params.aggregations);
        break;
      case 'SUP': if (params.cte) Object.assign(ctx.ctes, params.cte); if (params.window) ctx.wins.push(params.window); break;
      case 'NUL': ctx.nul = params; break;
      case 'REC': ctx.rec = params; break;
      default: this.gap('SQL_UNSUPPORTED_EXPR', `v1 operator ${operator}`);
    }
  }
  over(w) {
    const parts = [];
    if (w.partitionBy) parts.push(`PARTITION BY ${w.partitionBy.join(', ')}`);
    if (w.orderBy) parts.push(`ORDER BY ${w.orderBy.map((o) => (typeof o === 'string' ? o : `${o.field} ${(o.direction || 'ASC').toUpperCase()}`)).join(', ')}`);
    if (w.frame) parts.push(w.frame);
    return parts.join(' ');
  }
  build(ctx, ctes) {
    const parts = [];
    const all = { ...ctes, ...ctx.ctes };
    const defs = Object.entries(all).map(([name, query]) => `${name} AS (${this.query(query)})`);
    let rec = false;
    if (ctx.rec) {
      if (!ctx.rec.anchor || !ctx.rec.recursive) this.gap('SQL_RECURSIVE_SHAPE', 'REC without anchor and recursive');
      else { rec = true; defs.push(`recursive_cte AS (${this.query(ctx.rec.anchor)} UNION ALL ${this.query(ctx.rec.recursive)})`); }
    }
    if (defs.length) parts.push(`${rec ? 'WITH RECURSIVE' : 'WITH'} ${defs.join(', ')}`);
    const cols = ctx.select.length ? [...ctx.select] : ['*'];
    for (const [alias, agg] of Object.entries(ctx.aggs)) cols.push(`${agg.fn}(${agg.field === '*' ? '*' : isObj(agg.field) ? this.expr(agg.field) : agg.field}) AS ${alias}`);
    for (const w of ctx.wins) cols.push(`${w.fn}(${w.field || ''}${w.offset !== undefined && w.field ? `, ${w.offset}` : ''}) OVER (${this.over(w)}) AS ${w.alias || String(w.fn).toLowerCase()}`);
    parts.push(`SELECT ${ctx.distinct ? 'DISTINCT ' : ''}${cols.join(', ')}`);
    if (ctx.from) parts.push(`FROM ${ctx.from}`); else if (rec) parts.push('FROM recursive_cte');
    for (const j of ctx.joins) parts.push(j);
    if (ctx.where.length) parts.push(`WHERE ${ctx.where.join(' AND ')}`);
    if (ctx.groupBy.length) parts.push(`GROUP BY ${ctx.groupBy.join(', ')}`);
    if (ctx.having.length) parts.push(`HAVING ${ctx.having.join(' AND ')}`);
    for (const so of ctx.setOps) parts.push(`${so.type} ${this.query(so.query)}`);
    if (ctx.orderBy.length) parts.push(`ORDER BY ${ctx.orderBy.join(', ')}`);
    if (ctx.limit !== null && ctx.limit !== undefined) parts.push(`LIMIT ${ctx.limit}${ctx.offset ? ` OFFSET ${ctx.offset}` : ''}`);
    else if (ctx.offset) parts.push(`LIMIT -1 OFFSET ${ctx.offset}`);
    return parts.join('\n');
  }
}

export function fromV1Text(ast, opts = {}) {
  if (!ast || typeof ast !== 'object') throw new EoqlError('E_USAGE', 'fromV1 needs a v1 AST object');
  const c = new V1();
  const sql = c.query(ast);
  const r = translateSqlText(sql, { catalogRelations: opts.catalogRelations, spellings: opts.spellings });
  const gaps = [...c.gaps, ...(r.gaps || [])];
  return { ...r, from: 'v1ast', ok: r.ok && !c.gaps.length, gaps, eoql: gaps.length ? null : r.eoql, ast: gaps.length ? null : r.ast, expr_hash: gaps.length ? null : r.expr_hash, sql_equivalent: sql };
}
