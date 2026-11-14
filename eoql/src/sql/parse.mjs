// sql/parse.mjs: a hand-written SQL parser (SQLite dialect plus the accepted foreign spellings of SPEC-A1 3.1).
// Total: returns an AST or throws EoqlError(E_PARSE | E_LIMIT) with a character offset; bounded by depth and a step budget.
// It never executes anything. Unsupported constructs are parsed where cheap and flagged on the node (`gaps` are decided by the translator).
import { EoqlError } from '../errors.mjs';

export const SQL_LIMITS = Object.freeze({ chars: 262144, depth: 100, steps: 2000000 });
const err = (msg, pos, extra) => new EoqlError('E_PARSE', msg, { pos, detail: { lang: 'sql', ...(extra || {}) } });

const OPS3 = ['->>', '<=>'];
const OPS2 = ['||', '<=', '>=', '<>', '!=', '==', '<<', '>>', '->'];
const OPS1 = '+-*/%<>=(),.;&|~';

export function lexSql(sql) {
  if (typeof sql !== 'string') throw err('SQL must be a string', 0);
  if (sql.length > SQL_LIMITS.chars) throw new EoqlError('E_LIMIT', `SQL longer than ${SQL_LIMITS.chars} characters`, { pos: 0, detail: { lang: 'sql', limit: 'chars' } });
  const toks = []; let i = 0; const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && sql[i + 1] === '-') { while (i < n && sql[i] !== '\n') i++; continue; }
    if (c === '/' && sql[i + 1] === '*') { const e = sql.indexOf('*/', i + 2); if (e < 0) throw err('unterminated comment', i); i = e + 2; continue; }
    const pos = i;
    if (c === "'") {
      let s = ''; i++;
      for (;;) { if (i >= n) throw err('unterminated string', pos); if (sql[i] === "'") { if (sql[i + 1] === "'") { s += "'"; i += 2; continue; } i++; break; } s += sql[i++]; }
      toks.push({ k: 'str', v: s, pos, end: i }); continue;
    }
    if ((c === 'x' || c === 'X') && sql[i + 1] === "'") {
      let j = i + 2; while (j < n && sql[j] !== "'") j++;
      if (j >= n) throw err('unterminated blob literal', pos);
      toks.push({ k: 'blob', v: sql.slice(i + 2, j), pos, end: j + 1 }); i = j + 1; continue;
    }
    if (c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c; let j = i + 1; let s = '';
      for (;;) { if (j >= n) throw err('unterminated quoted identifier', pos); if (sql[j] === close) { if (c !== '[' && sql[j + 1] === close) { s += close; j += 2; continue; } break; } s += sql[j++]; }
      toks.push({ k: 'qid', v: s, pos, end: j + 1, q: c }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(sql[i + 1] || ''))) {
      let j = i; let real = false;
      if (c === '0' && /[xX]/.test(sql[i + 1] || '') && /[0-9a-fA-F]/.test(sql[i + 2] || '')) { j = i + 2; while (j < n && /[0-9a-fA-F]/.test(sql[j])) j++; toks.push({ k: 'num', v: sql.slice(i, j), pos, end: j, real: false, hex: true }); i = j; continue; }
      while (j < n && /[0-9]/.test(sql[j])) j++;
      if (sql[j] === '.' ) { real = true; j++; while (j < n && /[0-9]/.test(sql[j])) j++; }
      if (/[eE]/.test(sql[j] || '') && (/[0-9]/.test(sql[j + 1] || '') || (/[+-]/.test(sql[j + 1] || '') && /[0-9]/.test(sql[j + 2] || '')))) { real = true; j += 2; while (j < n && /[0-9]/.test(sql[j])) j++; }
      toks.push({ k: 'num', v: sql.slice(i, j), pos, end: j, real }); i = j; continue;
    }
    if (/[A-Za-z_\u0080-￿]/.test(c)) { let j = i; while (j < n && /[A-Za-z0-9_$\u0080-￿]/.test(sql[j])) j++; toks.push({ k: 'id', v: sql.slice(i, j), pos, end: j }); i = j; continue; }
    if (c === '?') { let j = i + 1; while (j < n && /[0-9]/.test(sql[j])) j++; toks.push({ k: 'param', v: sql.slice(i, j), kind: 'q', pos, end: j }); i = j; continue; }
    if (c === ':' || c === '@' || c === '$') {
      let j = i + 1; while (j < n && /[A-Za-z0-9_$\u0080-￿]/.test(sql[j])) j++;
      if (j === i + 1) { if (c === ':' && sql[i + 1] === ':') { toks.push({ k: 'op', v: '::', pos, end: i + 2 }); i += 2; continue; } throw err(`unexpected character ${JSON.stringify(c)}`, pos); }
      toks.push({ k: 'param', v: sql.slice(i, j), kind: c, pos, end: j }); i = j; continue;
    }
    const t3 = sql.slice(i, i + 3), t2 = sql.slice(i, i + 2);
    if (OPS3.includes(t3)) { toks.push({ k: 'op', v: t3, pos, end: i + 3 }); i += 3; continue; }
    if (OPS2.includes(t2)) { toks.push({ k: 'op', v: t2, pos, end: i + 2 }); i += 2; continue; }
    if (OPS1.includes(c)) { toks.push({ k: 'op', v: c, pos, end: i + 1 }); i++; continue; }
    throw err(`unexpected character ${JSON.stringify(c)}`, pos);
  }
  toks.push({ k: 'eof', v: '', pos: n, end: n });
  return toks;
}

const KW_STOP = new Set(['FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET', 'UNION', 'INTERSECT', 'EXCEPT', 'MINUS', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'NATURAL', 'ON', 'USING', 'WINDOW', 'SELECT', 'VALUES', 'AS', 'FETCH', 'RETURNING', 'WITH', 'AND', 'OR', 'NOT', 'IS', 'IN', 'LIKE', 'GLOB', 'BETWEEN', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ESCAPE', 'COLLATE', 'ASC', 'DESC', 'NULLS', 'OVER', 'FILTER', 'FOR', 'SET', 'DISTINCT', 'ALL', 'EXISTS', 'REGEXP', 'MATCH', 'ISNULL', 'NOTNULL', 'ILIKE', 'OUTER']);

export function parseSql(sql) {
  const toks = lexSql(sql);
  return new SP(sql, toks).statement();
}

class SP {
  constructor(sql, toks) { this.sql = sql; this.t = toks; this.i = 0; this.depth = 0; this.steps = 0; this.paramCount = 0; }
  get cur() { return this.t[this.i]; }
  peek(k = 1) { return this.t[Math.min(this.i + k, this.t.length - 1)]; }
  tick() { if (++this.steps > SQL_LIMITS.steps) throw new EoqlError('E_LIMIT', 'SQL parse cost budget exceeded', { pos: this.cur.pos, detail: { lang: 'sql', limit: 'steps' } }); }
  enter() { this.tick(); if (++this.depth > SQL_LIMITS.depth) throw new EoqlError('E_LIMIT', `SQL nesting deeper than ${SQL_LIMITS.depth}`, { pos: this.cur.pos, detail: { lang: 'sql', limit: 'depth' } }); }
  leave() { this.depth--; }
  fail(msg) { throw err(msg, this.cur.pos); }
  isKw(w, k = 0) { const t = this.peek(k); return t.k === 'id' && t.v.toUpperCase() === w; }
  isOp(o, k = 0) { const t = this.peek(k); return t.k === 'op' && t.v === o; }
  eatKw(w) { if (this.isKw(w)) { this.i++; return true; } return false; }
  eatOp(o) { if (this.isOp(o)) { this.i++; return true; } return false; }
  expectKw(w) { if (!this.eatKw(w)) this.fail(`expected ${w}`); }
  expectOp(o) { if (!this.eatOp(o)) this.fail(`expected "${o}"`); }
  last() { return this.t[this.i - 1]; }

  statement() {
    if (this.cur.k === 'eof') throw err('empty SQL', 0);
    const start = this.cur.pos;
    let node;
    this.params = [];
    if (this.isKw('SELECT') || this.isKw('WITH') || this.isKw('VALUES') || this.isOp('(')) node = this.selectStmt();
    else if (this.cur.k === 'id') {
      const w = this.cur.v.toUpperCase();
      node = { t: 'other', kind: w, pos: start };
      if (!['INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'CREATE', 'DROP', 'ALTER', 'ATTACH', 'DETACH', 'PRAGMA', 'VACUUM', 'BEGIN', 'COMMIT', 'ROLLBACK', 'END', 'SAVEPOINT', 'RELEASE', 'REINDEX', 'ANALYZE', 'EXPLAIN', 'TRUNCATE', 'MERGE'].includes(w)) this.fail(`unexpected ${this.cur.v}`);
      // scan the rest only to find statement separators and RETURNING / ON CONFLICT markers
      while (this.cur.k !== 'eof') {
        if (this.isOp(';')) break;
        if (this.isKw('RETURNING')) node.returning = true;
        if (this.isKw('CONFLICT') || (this.isKw('DUPLICATE') && this.isKw('KEY', 1))) node.upsert = true;
        this.i++; this.tick();
      }
    } else this.fail('expected a statement');
    while (this.eatOp(';')) { if (this.cur.k !== 'eof') { node = { t: 'multi', first: node, pos: this.cur.pos }; while (this.cur.k !== 'eof') { this.i++; this.tick(); } } }
    if (this.cur.k !== 'eof') this.fail(`unexpected ${this.cur.v || this.cur.k}`);
    if (node) node.paramList = this.params || [];
    return node;
  }

  selectStmt() {
    this.enter();
    try {
      const pos = this.cur.pos;
      let withc = null;
      if (this.isKw('WITH')) withc = this.withClause();
      let body = this.compound();
      let orderBy = null, limit = null, offset = null, fetch = null, limitSpell = null;
      if (this.isKw('ORDER') && this.isKw('BY', 1)) { this.i += 2; orderBy = this.orderList(); }
      let limitAll = false;
      if (this.isKw('LIMIT')) {
        this.i++;
        if (this.isKw('ALL')) { this.i++; limitAll = true; if (this.eatKw('OFFSET')) offset = this.expr(); }
        else { const a = this.expr();
        if (this.eatKw('OFFSET')) { limit = a; offset = this.expr(); } else if (this.eatOp(',')) { const b = this.expr(); limit = b; offset = a; limitSpell = 'LIMIT m, n'; } else limit = a; }
      }
      if (this.isKw('OFFSET')) { this.i++; offset = this.expr(); if (this.isKw('ROW') || this.isKw('ROWS')) this.i++; }
      if (this.isKw('FETCH')) {
        this.i++; if (this.isKw('FIRST') || this.isKw('NEXT')) this.i++; else this.fail('expected FIRST or NEXT');
        limit = this.expr(); if (this.isKw('ROW') || this.isKw('ROWS')) this.i++; if (this.isKw('ONLY')) this.i++; else this.fail('expected ONLY'); fetch = true;
      }
      return { t: 'select', with: withc, body, orderBy, limit, offset, fetch, limitSpell, limitAll, pos };
    } finally { this.leave(); }
  }
  withClause() {
    this.expectKw('WITH');
    const recursive = this.eatKw('RECURSIVE'); const ctes = [];
    for (;;) {
      const pos = this.cur.pos; const name = this.ident('CTE name'); let cols = null;
      if (this.eatOp('(')) { cols = []; for (;;) { cols.push(this.ident('column name')); if (!this.eatOp(',')) break; } this.expectOp(')'); }
      this.expectKw('AS'); if (this.isKw('NOT') && this.isKw('MATERIALIZED', 1)) this.i += 2; else if (this.isKw('MATERIALIZED')) this.i++;
      this.expectOp('('); const query = this.selectStmt(); this.expectOp(')');
      ctes.push({ name, cols, query, pos });
      if (!this.eatOp(',')) break;
    }
    return { recursive, ctes };
  }
  compound() {
    let left = this.coreOrParen();
    while (this.cur.k === 'id' && ['UNION', 'INTERSECT', 'EXCEPT', 'MINUS'].includes(this.cur.v.toUpperCase())) {
      const op = this.cur.v.toUpperCase(); const pos = this.cur.pos; this.i++;
      let all = false; if (op === 'UNION' && this.eatKw('ALL')) all = true;
      const right = this.coreOrParen();
      left = { t: 'compound', op, all, left, right, pos };
    }
    return left;
  }
  coreOrParen() {
    if (this.isOp('(')) { this.i++; const q = this.selectStmt(); this.expectOp(')'); return { t: 'paren', query: q }; }
    return this.core();
  }
  core() {
    this.enter();
    try {
      const pos = this.cur.pos;
      if (this.isKw('VALUES')) {
        this.i++; const rows = [];
        for (;;) { this.expectOp('('); const r = []; for (;;) { r.push(this.expr()); if (!this.eatOp(',')) break; } this.expectOp(')'); rows.push(r); if (!this.eatOp(',')) break; }
        return { t: 'values', rows, pos };
      }
      this.expectKw('SELECT');
      let distinct = false; let distinctOn = false;
      if (this.eatKw('DISTINCT')) { distinct = true; if (this.isKw('ON') && this.isOp('(', 1)) { distinctOn = true; this.i += 2; let d = 1; while (d > 0 && this.cur.k !== 'eof') { if (this.isOp('(')) d++; else if (this.isOp(')')) d--; this.i++; this.tick(); } } } else this.eatKw('ALL');
      const items = [];
      for (;;) {
        const ip = this.cur.pos;
        if (this.isOp('*')) { this.i++; items.push({ star: true, table: null, pos: ip }); } else if ((this.cur.k === 'id' || this.cur.k === 'qid') && this.isOp('.', 1) && this.isOp('*', 2)) { const tb = this.cur.v; this.i += 3; items.push({ star: true, table: tb, pos: ip }); } else {
          const x = this.expr(); const text = this.sql.slice(x.s, x.e).trim(); let alias = null;
          if (this.eatKw('AS')) alias = this.aliasName(); else if ((this.aliasOk()) || this.cur.k === 'qid' || (this.cur.k === 'str' && false)) alias = this.aliasName();
          items.push({ x, alias, text, pos: ip });
        }
        if (!this.eatOp(',')) break;
      }
      let from = null, where = null, groupBy = null, having = null, windows = null;
      if (this.eatKw('FROM')) from = this.fromList();
      let cb0 = null;
      if (this.eatKw('WHERE')) where = this.expr();
      if (this.isKw('START') && this.isKw('WITH', 1)) { cb0 = { pos: this.cur.pos }; this.i += 2; this.expr(); }
      if (this.isKw('CONNECT') && this.isKw('BY', 1)) { cb0 = cb0 || { pos: this.cur.pos }; this.i += 2; this.eatKw('NOCYCLE'); this.expr(); }
      if (this.isKw('START') && this.isKw('WITH', 1)) { cb0 = cb0 || { pos: this.cur.pos }; this.i += 2; this.expr(); }
      if (this.isKw('GROUP') && this.isKw('BY', 1)) {
        this.i += 2; groupBy = [];
        for (;;) {
          const gp = this.cur.pos;
          if ((this.isKw('GROUPING') && this.isKw('SETS', 1) && this.isOp('(', 2)) || ((this.isKw('ROLLUP') || this.isKw('CUBE')) && this.isOp('(', 1))) {
            const kw = this.cur.v.toUpperCase(); while (!this.isOp('(')) this.i++;
            let d = 0; do { if (this.isOp('(')) d++; else if (this.isOp(')')) d--; this.i++; this.tick(); } while (d > 0 && this.cur.k !== 'eof');
            groupBy.push({ t: 'groupingsets', kw, s: gp, e: this.last().end });
          } else groupBy.push(this.expr());
          if (!this.eatOp(',')) break;
        }
      }
      let connectBy = cb0;
      if (this.isKw('START') && this.isKw('WITH', 1)) { connectBy = { pos: this.cur.pos }; this.i += 2; this.expr(); }
      if (this.isKw('CONNECT') && this.isKw('BY', 1)) { connectBy = connectBy || { pos: this.cur.pos }; this.i += 2; this.eatKw('NOCYCLE'); this.expr(); }
      if (this.isKw('START') && this.isKw('WITH', 1)) { connectBy = connectBy || { pos: this.cur.pos }; this.i += 2; this.expr(); }
      if (this.eatKw('HAVING')) having = this.expr();
      if (this.isKw('WINDOW')) {
        this.i++; windows = {};
        for (;;) { const nm = this.ident('window name'); this.expectKw('AS'); windows[nm] = this.windowSpec(); if (!this.eatOp(',')) break; }
      }
      return { t: 'core', distinct, distinctOn, items, from, where, groupBy, having, windows, connectBy, pos };
    } finally { this.leave(); }
  }
  aliasName() {
    const t = this.cur;
    if (t.k === 'id' || t.k === 'qid') { this.i++; return t.v; }
    if (t.k === 'str') { this.i++; return t.v; }
    this.fail('expected an alias');
    return null;
  }
  ident(what) {
    const t = this.cur;
    if (t.k === 'id' || t.k === 'qid') { this.i++; return t.v; }
    this.fail(`expected ${what || 'a name'}`);
    return null;
  }
  // ---- FROM ---------------------------------------------------------------------------------------------------------------
  fromList() {
    let left = this.fromItem();
    for (;;) {
      const pos = this.cur.pos;
      if (this.eatOp(',')) { const right = this.fromItem(); left = { t: 'join', type: 'cross', comma: true, left, right, on: null, using: null, pos }; continue; }
      let natural = false, type = null;
      if (this.isKw('NATURAL')) { natural = true; this.i++; }
      if (this.isKw('JOIN')) { type = 'inner'; this.i++; } else if (this.isKw('INNER') && this.isKw('JOIN', 1)) { type = 'inner'; this.i += 2; } else if (this.isKw('CROSS') && this.isKw('JOIN', 1)) { type = 'cross'; this.i += 2; } else if (['LEFT', 'RIGHT', 'FULL'].includes((this.cur.v || '').toUpperCase()) && this.cur.k === 'id') {
        const side = this.cur.v.toUpperCase().toLowerCase(); let k = 1; if (this.isKw('OUTER', 1)) k = 2;
        if (!this.isKw('JOIN', k)) this.fail('expected JOIN'); this.i += k + 1; type = side;
      } else if (natural) this.fail('expected JOIN');
      if (!type) return left;
      const right = this.fromItem(); let on = null, using = null;
      if (this.eatKw('ON')) on = this.expr();
      else if (this.eatKw('USING')) { this.expectOp('('); using = []; for (;;) { using.push(this.ident('column name')); if (!this.eatOp(',')) break; } this.expectOp(')'); }
      left = { t: 'join', type, natural, left, right, on, using, pos };
    }
  }
  fromItem() {
    this.enter();
    try {
      const pos = this.cur.pos;
      if (this.isOp('(')) {
        if (this.isKw('SELECT', 1) || this.isKw('WITH', 1) || this.isKw('VALUES', 1) || this.isOp('(', 1)) {
          this.i++; const q = this.selectStmt(); this.expectOp(')');
          let alias = null, cols = null;
          if (this.eatKw('AS')) alias = this.aliasName(); else if ((this.aliasOk()) || this.cur.k === 'qid') alias = this.aliasName();
          if (alias && this.isOp('(')) { this.i++; cols = []; for (;;) { cols.push(this.ident('column name')); if (!this.eatOp(',')) break; } this.expectOp(')'); }
          return { t: 'sub', query: q, alias, cols, pos };
        }
        this.i++; const inner = this.fromList(); this.expectOp(')');
        return { t: 'group', inner, pos };
      }
      const name = this.ident('a table name'); let schema = null; let nm = name;
      if (this.isOp('.')) { this.i++; schema = name; nm = this.ident('a table name'); }
      if (this.isOp('(') && !schema) { // table-valued function
        this.i++; const args = [];
        if (!this.isOp(')')) for (;;) { args.push(this.expr()); if (!this.eatOp(',')) break; }
        this.expectOp(')');
        let alias = null; if (this.eatKw('AS')) alias = this.aliasName(); else if (this.aliasOk()) alias = this.aliasName();
        return { t: 'tablefn', name: nm, args, alias, pos };
      }
      let alias = null;
      if (this.eatKw('AS')) alias = this.aliasName(); else if ((this.aliasOk()) || this.cur.k === 'qid') alias = this.aliasName();
      if (this.isKw('INDEXED') && this.isKw('BY', 1)) this.i += 3; else if (this.isKw('NOT') && this.isKw('INDEXED', 1)) this.i += 2;
      return { t: 'table', name: nm, schema, alias, pos };
    } finally { this.leave(); }
  }
  orderList() {
    const out = [];
    for (;;) {
      const x = this.expr(); let dir = 'asc', nulls = null, coll = null;
      if (this.eatKw('COLLATE')) coll = this.ident('collation');
      if (this.eatKw('ASC')) dir = 'asc'; else if (this.eatKw('DESC')) dir = 'desc';
      if (this.isKw('NULLS') && (this.isKw('FIRST', 1) || this.isKw('LAST', 1))) { nulls = this.peek(1).v.toLowerCase(); this.i += 2; }
      out.push({ x, dir, nulls, coll });
      if (!this.eatOp(',')) break;
    }
    return out;
  }
  windowSpec() {
    this.expectOp('(');
    const spec = { base: null, partition: null, order: null, frame: null };
    if (this.aliasOk() && !this.isKw('PARTITION') && !this.isKw('ORDER') && !this.isKw('ROWS') && !this.isKw('RANGE') && !this.isKw('GROUPS')) { spec.base = this.cur.v; this.i++; }
    if (this.isKw('PARTITION') && this.isKw('BY', 1)) { this.i += 2; spec.partition = []; for (;;) { spec.partition.push(this.expr()); if (!this.eatOp(',')) break; } }
    if (this.isKw('ORDER') && this.isKw('BY', 1)) { this.i += 2; spec.order = this.orderList(); }
    if (this.isKw('ROWS') || this.isKw('RANGE') || this.isKw('GROUPS')) {
      const unit = this.cur.v.toUpperCase(); this.i++;
      const bound = () => {
        if (this.eatKw('UNBOUNDED')) { if (this.eatKw('PRECEDING')) return { t: 'unb', dir: 'p' }; this.expectKw('FOLLOWING'); return { t: 'unb', dir: 'f' }; }
        if (this.isKw('CURRENT')) { this.i++; this.expectKw('ROW'); return { t: 'cur' }; }
        const e = this.expr(); if (this.eatKw('PRECEDING')) return { t: 'off', dir: 'p', x: e }; this.expectKw('FOLLOWING'); return { t: 'off', dir: 'f', x: e };
      };
      let a, b = null;
      if (this.eatKw('BETWEEN')) { a = bound(); this.expectKw('AND'); b = bound(); } else a = bound();
      let exclude = false;
      if (this.isKw('EXCLUDE')) { exclude = true; this.i++; while (this.cur.k === 'id' && ['CURRENT', 'ROW', 'GROUP', 'TIES', 'NO', 'OTHERS'].includes(this.cur.v.toUpperCase())) this.i++; }
      spec.frame = { unit, a, b, exclude };
    }
    this.expectOp(')');
    return spec;
  }

  // ---- expressions ----------------------------------------------------------------------------------------------------------
  expr() {
    this.enter();
    try { const s = this.cur.pos; const x = this.orx(); x.s = x.s === undefined ? s : x.s; x.e = this.last() ? this.last().end : x.e; return x; } finally { this.leave(); }
  }
  mk(n, s) { n.s = s; n.e = this.last().end; return n; }
  orx() { let s = this.cur.pos; let a = this.andx(); while (this.isKw('OR')) { this.i++; const b = this.andx(); a = this.mk({ t: 'bin', op: 'OR', a, b }, s); } return a; }
  andx() { let s = this.cur.pos; let a = this.notx(); while (this.isKw('AND')) { this.i++; const b = this.notx(); a = this.mk({ t: 'bin', op: 'AND', a, b }, s); } return a; }
  notx() { const s = this.cur.pos; this.tick(); if (this.isKw('NOT') && !this.isKw('EXISTS', 1)) { this.i++; this.enter(); try { const x = this.notx(); return this.mk({ t: 'not', x }, s); } finally { this.leave(); } } return this.eqx(); }
  eqx() {
    const s = this.cur.pos; let a = this.cmpx();
    for (;;) {
      this.tick();
      const c = this.cur;
      if (c.k === 'op' && ['=', '==', '!=', '<>'].includes(c.v)) { this.i++; const b = this.cmpx(); a = this.mk({ t: 'bin', op: c.v === '==' ? '=' : c.v === '<>' ? '!=' : c.v, a, b, cmp: true }, s); continue; }
      if (c.k === 'op' && c.v === '<=>') { this.fail('<=> is not supported'); }
      if (c.k !== 'id') return a;
      const w = c.v.toUpperCase();
      if (w === 'IS') {
        this.i++; let neg = false; if (this.eatKw('NOT')) neg = true;
        if (this.isKw('DISTINCT') && this.isKw('FROM', 1)) { this.i += 2; const b = this.cmpx(); a = this.mk({ t: 'is', a, b, neg: !neg, distinctFrom: true }, s); continue; }
        if (this.isKw('TRUE') || this.isKw('FALSE')) { const v = this.cur.v.toUpperCase(); this.i++; a = this.mk({ t: 'istruth', x: a, neg, v }, s); continue; }
        const b = this.cmpx(); a = this.mk({ t: 'is', a, b, neg }, s); continue;
      }
      if (w === 'ISNULL') { this.i++; a = this.mk({ t: 'isnull', x: a, neg: false }, s); continue; }
      if (w === 'NOTNULL') { this.i++; a = this.mk({ t: 'isnull', x: a, neg: true }, s); continue; }
      let neg = false, k = 0;
      if (w === 'NOT') { const nx = this.peek(1); if (nx.k === 'id' && ['IN', 'LIKE', 'GLOB', 'BETWEEN', 'REGEXP', 'MATCH', 'ILIKE', 'NULL'].includes(nx.v.toUpperCase())) { neg = true; k = 1; } else return a; }
      const w2 = this.peek(k).v.toUpperCase();
      if (w2 === 'NULL' && neg) { this.i += 2; a = this.mk({ t: 'isnull', x: a, neg: true }, s); continue; }
      if (w2 === 'IN') {
        this.i += k + 1;
        if (this.isOp('(')) {
          if (this.isKw('SELECT', 1) || this.isKw('WITH', 1) || this.isKw('VALUES', 1)) { this.i++; const q = this.selectStmt(); this.expectOp(')'); a = this.mk({ t: 'in', x: a, neg, query: q }, s); } else { this.i++; const list = []; if (!this.isOp(')')) for (;;) { list.push(this.expr()); if (!this.eatOp(',')) break; } this.expectOp(')'); a = this.mk({ t: 'in', x: a, neg, list }, s); }
        } else if (this.cur.k === 'param') { const p = this.param(); a = this.mk({ t: 'in', x: a, neg, list: [p] , paramList: true }, s); } else { const name = this.ident('a table name'); a = this.mk({ t: 'in', x: a, neg, table: name }, s); }
        continue;
      }
      if (w2 === 'LIKE' || w2 === 'GLOB' || w2 === 'ILIKE') {
        this.i += k + 1; const pat = this.cmpx(); let esc = null; if (this.eatKw('ESCAPE')) esc = this.cmpx();
        a = this.mk({ t: 'like', op: w2, x: a, pat, esc, neg }, s); continue;
      }
      if (w2 === 'REGEXP' || w2 === 'MATCH') { this.i += k + 1; const pat = this.cmpx(); a = this.mk({ t: 'regexp', op: w2, x: a, pat, neg }, s); continue; }
      if (w2 === 'BETWEEN') { this.i += k + 1; const lo = this.cmpx(); this.expectKw('AND'); const hi = this.cmpx(); a = this.mk({ t: 'between', x: a, lo, hi, neg }, s); continue; }
      return a;
    }
  }
  cmpx() {
    const s = this.cur.pos; let a = this.bitx();
    for (;;) { this.tick(); const c = this.cur; if (c.k === 'op' && ['<', '<=', '>', '>='].includes(c.v)) { this.i++; const b = this.bitx(); a = this.mk({ t: 'bin', op: c.v, a, b, cmp: true }, s); } else return a; }
  }
  bitx() {
    const s = this.cur.pos; let a = this.addx();
    for (;;) { this.tick(); const c = this.cur; if (c.k === 'op' && ['&', '|', '<<', '>>'].includes(c.v)) { this.i++; const b = this.addx(); a = this.mk({ t: 'bin', op: c.v, a, b, bit: true }, s); } else return a; }
  }
  addx() {
    const s = this.cur.pos; let a = this.mulx();
    for (;;) { this.tick(); const c = this.cur; if (c.k === 'op' && (c.v === '+' || c.v === '-')) { this.i++; const b = this.mulx(); a = this.mk({ t: 'bin', op: c.v, a, b }, s); } else return a; }
  }
  mulx() {
    const s = this.cur.pos; let a = this.catx();
    for (;;) { this.tick(); const c = this.cur; if (c.k === 'op' && (c.v === '*' || c.v === '/' || c.v === '%')) { this.i++; const b = this.catx(); a = this.mk({ t: 'bin', op: c.v, a, b }, s); } else return a; }
  }
  catx() {
    const s = this.cur.pos; let a = this.unx();
    for (;;) { this.tick(); const c = this.cur; if (c.k === 'op' && c.v === '||') { this.i++; const b = this.unx(); a = this.mk({ t: 'bin', op: '||', a, b }, s); } else return a; }
  }
  unx() {
    const s = this.cur.pos; this.tick();
    const c = this.cur;
    if (this.isKw('PRIOR') && (this.peek(1).k === 'id' || this.peek(1).k === 'qid') && !this.isOp('(', 1)) { this.i++; return this.unx(); }
    if (c.k === 'op' && (c.v === '-' || c.v === '+' || c.v === '~')) { this.i++; this.enter(); try { const x = this.unx(); return this.mk({ t: 'un', op: c.v, x }, s); } finally { this.leave(); } }
    let x = this.primary();
    for (;;) {
      if (this.isKw('COLLATE')) { this.i++; const nm = this.ident('collation'); x = this.mk({ t: 'collate', x, name: nm }, s); continue; }
      if (this.cur.k === 'op' && (this.cur.v === '->>' || this.cur.v === '->')) { const op = this.cur.v; this.i++; const p = this.primary(); x = this.mk({ t: 'jsonop', op, x, path: p }, s); continue; }
      if (this.isOp('::')) { this.i++; const ty = this.typeName(); x = this.mk({ t: 'cast', x, type: ty, spell: '::' }, s); continue; }
      return x;
    }
  }
  // START and CONNECT are plain words in SQLite and most dialects; they stop an alias only when they open START WITH / CONNECT BY
  aliasOk() { const c = this.cur; if (c.k !== 'id') return false; const w = c.v.toUpperCase(); if (KW_STOP.has(w)) return false; if (w === 'START' && this.isKw('WITH', 1)) return false; if (w === 'CONNECT' && this.isKw('BY', 1)) return false; return true; }
  typeName() { let ty = this.ident('a type name'); let t2 = ty; while (this.aliasOk() && !this.isOp('(')) { t2 += ' ' + this.cur.v; this.i++; } if (this.isOp('(')) { this.i++; let d = 1; while (d > 0 && this.cur.k !== 'eof') { if (this.isOp('(')) d++; else if (this.isOp(')')) d--; this.i++; } } return t2; }
  param() {
    const c = this.cur; this.i++;
    let name;
    if (c.kind === 'q') { if (c.v.length > 1) name = 'p' + c.v.slice(1); else name = 'p' + (++this.paramCount); } else name = c.v.slice(1);
    if (/^[0-9]/.test(name)) name = 'p' + name;
    (this.params || (this.params = [])).push({ name, pos: c.pos });
    return this.mk({ t: 'param', name, raw: c.v, anon: c.kind === 'q' && c.v.length === 1 }, c.pos);
  }
  primary() {
    this.tick();
    const c = this.cur; const s = c.pos;
    switch (c.k) {
      case 'num': this.i++; return this.mk({ t: 'num', v: c.v, real: c.real, hex: !!c.hex }, s);
      case 'str': this.i++; return this.mk({ t: 'str', v: c.v }, s);
      case 'blob': this.i++; return this.mk({ t: 'blob', v: c.v }, s);
      case 'param': return this.param();
      case 'op': {
        if (c.v === '(') {
          this.i++;
          if (this.isKw('SELECT') || this.isKw('WITH') || this.isKw('VALUES')) { const q = this.selectStmt(); this.expectOp(')'); return this.mk({ t: 'subq', query: q }, s); }
          const x = this.expr();
          if (this.isOp(',')) { const items = [x]; while (this.eatOp(',')) items.push(this.expr()); this.expectOp(')'); return this.mk({ t: 'rowvalue', items }, s); }
          this.expectOp(')'); return this.mk({ t: 'paren', x }, s);
        }
        if (c.v === '*') { this.i++; return this.mk({ t: 'star' }, s); }
        this.fail(`unexpected "${c.v}"`);
        break;
      }
      case 'id': case 'qid': {
        const w = c.k === 'id' ? c.v.toUpperCase() : null;
        if (w === 'NULL') { this.i++; return this.mk({ t: 'null' }, s); }
        if (w === 'TRUE' || w === 'FALSE') { this.i++; return this.mk({ t: 'bool', v: w === 'TRUE' }, s); }
        if (w === 'CURRENT_TIMESTAMP' || w === 'CURRENT_DATE' || w === 'CURRENT_TIME') { this.i++; return this.mk({ t: 'func', name: w.toLowerCase(), args: [], current: true }, s); }
        if (w === 'CASE') return this.caseExpr();
        if (w === 'CAST' && this.isOp('(', 1)) { this.i += 2; const x = this.expr(); this.expectKw('AS'); const ty = this.typeName(); this.expectOp(')'); return this.mk({ t: 'cast', x, type: ty }, s); }
        if (w === 'EXISTS' && this.isOp('(', 1)) { this.i += 2; const q = this.selectStmt(); this.expectOp(')'); return this.mk({ t: 'exists', query: q, neg: false }, s); }
        if (w === 'NOT' && this.isKw('EXISTS', 1)) { this.i += 2; this.expectOp('('); const q = this.selectStmt(); this.expectOp(')'); return this.mk({ t: 'exists', query: q, neg: true }, s); }
        if (c.k === 'id' && KW_STOP.has(w) && !this.isOp('(', 1)) this.fail(`unexpected keyword ${c.v}`);
        // function call
        if (this.isOp('(', 1) && c.k === 'id') return this.funcCall();
        // column reference a / a.b / a.b.c
        const parts = [c.v]; this.i++;
        while (this.isOp('.') && (this.peek(1).k === 'id' || this.peek(1).k === 'qid')) { this.i++; parts.push(this.cur.v); this.i++; }
        if (this.isOp('.') && this.isOp('*', 1)) { this.fail('unexpected ".*"'); }
        return this.mk({ t: 'col', parts, quoted: c.k === 'qid' && parts.length === 1, dq: c.k === 'qid' && c.q === '"' && parts.length === 1 }, s);
      }
      default: this.fail(c.k === 'eof' ? 'unexpected end of SQL' : `unexpected ${c.k}`);
    }
    return null;
  }
  funcCall() {
    const c = this.cur; const s = c.pos; const name = c.v; this.i += 2;
    let distinct = false; const args = []; let star = false; let orderIn = null;
    if (this.isOp('*')) { this.i++; star = true; } else if (!this.isOp(')')) {
      if (this.eatKw('DISTINCT')) distinct = true; else this.eatKw('ALL');
      for (;;) { args.push(this.expr()); if (!this.eatOp(',')) break; }
      if (this.isKw('ORDER') && this.isKw('BY', 1)) { this.i += 2; orderIn = this.orderList(); }
    }
    this.expectOp(')');
    const n = { t: 'func', name, args, distinct, star, orderIn };
    if (this.isKw('WITHIN') && this.isKw('GROUP', 1)) { this.i += 2; this.expectOp('('); this.expectKw('ORDER'); this.expectKw('BY'); n.orderIn = this.orderList(); this.expectOp(')'); n.withinGroup = true; }
    if (this.isKw('FILTER') && this.isOp('(', 1)) { this.i += 2; this.expectKw('WHERE'); n.filter = this.expr(); this.expectOp(')'); }
    if (this.isKw('OVER')) { this.i++; if (this.isOp('(')) n.over = this.windowSpec(); else { n.over = { base: this.ident('a window name'), partition: null, order: null, frame: null }; } }
    return this.mk(n, s);
  }
  caseExpr() {
    const s = this.cur.pos; this.i++;
    let operand = null; if (!this.isKw('WHEN')) operand = this.expr();
    const whens = [];
    while (this.eatKw('WHEN')) { const w = this.expr(); this.expectKw('THEN'); const t = this.expr(); whens.push([w, t]); }
    if (!whens.length) this.fail('CASE needs a WHEN');
    let els = null; if (this.eatKw('ELSE')) els = this.expr();
    this.expectKw('END');
    return this.mk({ t: 'case', operand, whens, els }, s);
  }
}
