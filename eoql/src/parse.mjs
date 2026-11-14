// parse.mjs: hand-written recursive-descent parser (SPEC 2.2). Total, bounded by depth and a step budget.
import { EoqlError } from './errors.mjs';
import { lex, LIMITS, GLYPH_VERB } from './lex.mjs';

export const VERBS = ['NUL', 'SIG', 'INS', 'SEG', 'CON', 'SYN', 'DEF', 'EVA', 'REC'];
export const READ_CLAUSES = {
  EVA: ['where'],
  SEG: ['table', 'keep', 'drop', 'addr', 'kinds', 'kind', 'writers', 'ids', 'where'],
  REC: ['by', 'order', 'set', 'rename', 'pick', 'rows'],
  SYN: ['by', 'agg', 'distinct', 'with', 'mode'],
  CON: ['to', 'on', 'join', 'as', 'to_as', 'follow', 'rel', 'dir', 'depth', 'in', 'until', 'include_seed'],
  DEF: ['asof', 'schema', 'collapse', 'anc', 'ordering', 'sort', 'limit', 'offset', 'bind', 'fix', 'base', 'step', 'mode', 'in'],
  INS: ['rows', 'columns', 'entries', 'anc'],
  SIG: ['perceiver', 'budget', 'return'],
  NUL: ['expect', 'gaps'],
};
const WRITE_COMMON = ['kind', 'body', 'of', 'basis', 'as'];
export const WRITE_CLAUSES = {
  EVA: WRITE_COMMON, REC: WRITE_COMMON, INS: WRITE_COMMON, SIG: WRITE_COMMON,
  SEG: [...WRITE_COMMON, 'into'], CON: [...WRITE_COMMON, 'to', 'rel'], SYN: [...WRITE_COMMON, 'entries'],
  DEF: [...WRITE_COMMON, 'view', 'expr', 'params', 'declare', 'like', 'schema'],
  NUL: [...WRITE_COMMON, 'why', 'addr'],
};
export const WRITE_ORDER = ['view', 'expr', 'params', 'declare', 'like', 'schema', 'kind', 'why', 'addr', 'into', 'to', 'rel', 'entries', 'body', 'of', 'basis', 'as'];
const ORDERED_OBJ = new Set(['set', 'agg', 'bind', 'rename']);
const CONTEXTUAL = new Set(['is', 'not', 'null', 'set', 'contains', 'in', 'between', 'like', 'glob', 'escape', 'true', 'false', 'distinct', 'asc', 'desc', 'nulls', 'first', 'last']);
export const isContextual = (w) => CONTEXTUAL.has(w.toLowerCase()) || w === 'AND' || w === 'OR' || w === 'NOT' || w === 'WRITE';

export function N(t, pos, props) {
  const o = { t, ...props };
  Object.defineProperty(o, 'pos', { value: pos, enumerable: false, writable: true, configurable: true });
  return o;
}
const RELOPS = new Set(['=', '==', '!=', '<>', '<', '<=', '>', '>=']);
const LEGACY_AGG = new Map([['count', 'count'], ['sum', 'sum'], ['average', 'avg'], ['avg', 'avg'], ['min', 'min'], ['max', 'max']]);

// A bare predicate (rel/is/contains/in/between/like/glob, or a connective over one) versus a world expression.
export function isPred(n) {
  if (!n) return false;
  switch (n.t) {
    case 'rel': case 'isnull': case 'isset': case 'is': case 'contains': case 'in': case 'between': case 'like': case 'glob': return true;
    case 'bin': return (n.op === 'AND' || n.op === 'OR') && (isPred(n.a) || isPred(n.b));
    case 'not': return isPred(n.x);
    default: return false;
  }
}

export function parse(text, opts = {}) {
  const toks = lex(text);
  const P = new Parser(text, toks, opts);
  return P.script();
}

class Parser {
  constructor(text, toks, opts) { this.text = text; this.t = toks; this.i = 0; this.depth = 0; this.steps = 0; this.gaps = []; this.sortObj = false; this.opts = opts; }
  get cur() { return this.t[this.i]; }
  peek(k = 1) { return this.t[Math.min(this.i + k, this.t.length - 1)]; }
  tick() { if (++this.steps > LIMITS.steps) throw new EoqlError('E_LIMIT', 'parse cost budget exceeded', { pos: this.cur.pos, detail: { limit: 'steps' } }); }
  enter() { this.tick(); if (++this.depth > LIMITS.depth) throw new EoqlError('E_LIMIT', `nesting deeper than ${LIMITS.depth}`, { pos: this.cur.pos, detail: { limit: 'depth' } }); }
  leave() { this.depth--; }
  fail(msg, expected) { throw new EoqlError('E_PARSE', msg, { pos: this.cur.pos, ...(expected ? { detail: { expected } } : {}) }); }
  isSym(s, k = 0) { const t = this.peek(k); return t.k === 'sym' && t.v === s; }
  isWord(w, k = 0) { const t = this.peek(k); return t.k === 'id' && t.v.toLowerCase() === w; }
  expectSym(s) { if (!this.isSym(s)) this.fail(`expected "${s}"`, [s]); const t = this.cur; this.i++; return t; }
  eatSym(s) { if (this.isSym(s)) { this.i++; return true; } return false; }
  eatWord(w) { if (this.isWord(w)) { this.i++; return true; } return false; }

  script() {
    const statements = [];
    while (this.cur.k !== 'eof') {
      if (this.eatSym(';')) continue;
      statements.push(this.statement());
      if (this.cur.k !== 'eof' && !this.isSym(';')) this.fail('expected ";" or end of script', [';']);
    }
    const s = { t: 'script', statements };
    Object.defineProperty(s, 'gaps', { value: this.gaps, enumerable: false });
    Object.defineProperty(s, 'text', { value: this.text, enumerable: false });
    return s;
  }

  statement() {
    this.enter();
    try {
      if (this.cur.k === 'id' && this.cur.v === 'WRITE') {
        const pos = this.cur.pos; this.i++;
        const call = this.verbcall(true);
        return N('write', pos, { call });
      }
      return N('read', this.cur.pos, { expr: this.expr() });
    } finally { this.leave(); }
  }

  // ---- expressions -------------------------------------------------------------------------------------------
  expr() { this.enter(); try { return this.orexpr(); } finally { this.leave(); } }
  orexpr() {
    let a = this.andexpr();
    while (this.cur.k === 'id' && this.cur.v === 'OR' && !this.isSym('(', 1)) { const pos = this.cur.pos; this.i++; const b = this.andexpr(); a = N('bin', pos, { op: 'OR', a, b }); }
    return a;
  }
  andexpr() {
    let a = this.notexpr();
    while (this.cur.k === 'id' && this.cur.v === 'AND' && !this.isSym('(', 1)) { const pos = this.cur.pos; this.i++; const b = this.notexpr(); a = N('bin', pos, { op: 'AND', a, b }); }
    return a;
  }
  notexpr() {
    this.tick();
    if (this.cur.k === 'id' && this.cur.v === 'NOT') {
      const pos = this.cur.pos; this.i++;
      if (this.isSym('(')) { // NOT(x) call form is the same as NOT of a parenthesised expression
        this.i++; this.enter(); const x = this.orexpr(); this.leave(); this.expectSym(')');
        // NOT(x) followed by a relational tail cannot happen: NOT applies to the group
        return N('not', pos, { x });
      }
      this.enter(); try { return N('not', pos, { x: this.notexpr() }); } finally { this.leave(); }
    }
    return this.relexpr();
  }
  relexpr() {
    const a = this.addexpr();
    const c = this.cur;
    if (c.k === 'sym' && RELOPS.has(c.v)) {
      this.i++; const b = this.addexpr();
      const op = c.v === '==' ? '=' : c.v === '<>' ? '!=' : c.v;
      return N('rel', c.pos, { op, a, b });
    }
    if (c.k !== 'id') return a;
    const w = c.v.toLowerCase();
    if (w === 'is') {
      this.i++; const neg = this.eatWord('not');
      if (this.isWord('null')) { this.i++; return N('isnull', c.pos, { x: a, neg }); }
      if (this.isWord('set')) { this.i++; return N('isset', c.pos, { x: a, neg }); }
      return N('is', c.pos, { x: a, neg, rhs: this.litrhs(true) });
    }
    let neg = false, k = 0;
    if (w === 'not' && this.peek(1).k === 'id' && ['contains', 'in', 'between', 'like', 'glob'].includes(this.peek(1).v.toLowerCase())) { neg = true; k = 1; }
    const nx = this.peek(k);
    if (nx.k !== 'id') return a;
    const w2 = nx.v.toLowerCase();
    if (w2 === 'contains') { this.i += k + 1; return N('contains', c.pos, { x: a, neg, rhs: this.litrhs(false) }); }
    if (w2 === 'in') {
      this.i += k + 1;
      let rhs;
      if (this.isSym('[')) rhs = this.list();
      else if (this.isSym(':') && this.peek(1).k === 'id' && this.peek(1).pos === this.cur.end) rhs = this.primary();
      else if (this.isSym('(')) { this.i++; this.enter(); rhs = this.expr(); this.leave(); this.expectSym(')'); rhs = N('sub', c.pos, { x: rhs }); }
      else this.fail('expected list, (expression) or :param after "in"');
      return N('in', c.pos, { x: a, neg, rhs });
    }
    if (w2 === 'between') {
      this.i += k + 1; const lo = this.addexpr();
      if (!(this.cur.k === 'id' && this.cur.v.toLowerCase() === 'and')) this.fail('expected AND in between', ['AND']);
      this.i++; const hi = this.addexpr();
      return N('between', c.pos, { x: a, neg, lo, hi });
    }
    if (w2 === 'like') {
      this.i += k + 1; const pat = this.addexpr(); let esc = null;
      if (this.eatWord('escape')) esc = this.addexpr();
      return N('like', c.pos, { x: a, neg, pat, esc });
    }
    if (w2 === 'glob') { this.i += k + 1; return N('glob', c.pos, { x: a, neg, pat: this.addexpr() }); }
    if (k === 1) this.fail('expected contains, in, between, like or glob after "not"');
    return a;
  }
  // right side of is / contains: a run of bare words is a text literal (LL)
  litrhs(isIs) {
    const c = this.cur;
    if (c.k === 'id' && !CONTEXTUAL.has(c.v.toLowerCase()) || (c.k === 'id' && ['true', 'false'].includes(c.v.toLowerCase()) && this.bareRunLen() > 0)) {
      const nx = this.peek(1);
      const isCallOrPath = nx.k === 'sym' && (nx.v === '(' || nx.v === '.' || nx.v === '[');
      if (!isCallOrPath && !(c.v === 'AND' || c.v === 'OR' || c.v === 'NOT')) return this.bareRun();
    }
    if (c.k === 'id' && ['true', 'false'].includes(c.v.toLowerCase())) return this.bareRun();
    return this.addexpr();
  }
  bareRunLen() { return 1; }
  bareRun() {
    const first = this.cur;
    let last = first; this.i++;
    for (;;) {
      const t = this.cur;
      if ((t.k === 'id' && !(t.v === 'AND' || t.v === 'OR' || t.v === 'NOT')) || t.k === 'num') {
        const nx = this.peek(1);
        if (t.k === 'id' && nx.k === 'sym' && nx.v === '(') break;
        last = t; this.i++; this.tick();
      } else break;
    }
    return N('lit', first.pos, { v: this.text.slice(first.pos, last.end) });
  }
  addexpr() {
    let a = this.mulexpr();
    for (;;) {
      const c = this.cur;
      if (c.k === 'sym' && (c.v === '+' || c.v === '-' || c.v === '||')) { this.i++; const b = this.mulexpr(); a = N('bin', c.pos, { op: c.v, a, b }); this.tick(); } else return a;
    }
  }
  mulexpr() {
    let a = this.unary();
    for (;;) {
      const c = this.cur;
      if (c.k === 'sym' && (c.v === '*' || c.v === '/' || c.v === '%')) { this.i++; const b = this.unary(); a = N('bin', c.pos, { op: c.v, a, b }); this.tick(); } else return a;
    }
  }
  unary() {
    const c = this.cur;
    if (c.k === 'sym' && c.v === '-') {
      this.i++; this.enter();
      try {
        const x = this.unary();
        if (x.t === 'lit' && typeof x.v === 'number') { const lit = N('lit', c.pos, { v: -x.v }); if (x.real && Number.isInteger(-x.v)) lit.real = true; if (Object.is(lit.v, -0)) lit.v = 0; return lit; }
        return N('un', c.pos, { op: '-', x });
      } finally { this.leave(); }
    }
    return this.primary();
  }
  primary() {
    this.tick();
    const c = this.cur;
    switch (c.k) {
      case 'str': this.i++; return N('lit', c.pos, { v: c.v });
      case 'num': { this.i++; const n = N('lit', c.pos, { v: c.v }); if (c.real && Number.isInteger(c.v)) n.real = true; return n; }
      case 'idref': this.i++; return N('idref', c.pos, { hex: c.v });
      case 'label': this.i++; return N('label', c.pos, { name: c.v });
      case 'glyph': return this.verbcall(false);
      case 'qid': return this.pathFrom(false);
      case 'sym': {
        if (c.v === '(') { this.i++; this.enter(); const e = this.expr(); this.leave(); this.expectSym(')'); return e; }
        if (c.v === '[') return this.list();
        if (c.v === '{') return this.object();
        if (c.v === '*') { this.i++; return N('star', c.pos, {}); }
        if (c.v === '$') { this.i++; return this.pathFrom(true); }
        if (c.v === ':') {
          const nx = this.peek(1);
          if (nx.k === 'id' && nx.pos === c.end) { this.i += 2; return N('param', c.pos, { name: nx.v }); }
        }
        this.fail(`unexpected "${c.v}"`);
        break;
      }
      case 'id': {
        const w = c.v;
        const lw = w.toLowerCase();
        const nx = this.peek(1);
        if (nx.k === 'sym' && nx.v === '(') {
          if (/^[A-Z]{3}$/.test(w)) {
            if (VERBS.includes(w)) return this.verbcall(false);
            if (w === 'AND' || w === 'OR') return this.connCall(w);
            if (w === 'NOT') return this.notexpr();
            throw new EoqlError('E_UNKNOWN_VERB', `unknown verb ${w}`, { pos: c.pos });
          }
          return this.call();
        }
        if (w === 'AND' || w === 'OR' || w === 'NOT' || w === 'WRITE') this.fail(`unexpected ${w}`);
        if (lw === 'true' || lw === 'false') { this.i++; return N('lit', c.pos, { v: lw === 'true' }); }
        if (lw === 'null') { this.i++; return N('lit', c.pos, { v: null }); }
        return this.pathFrom(false);
      }
      default: this.fail(c.k === 'eof' ? 'unexpected end of script' : 'unexpected token');
    }
    return null;
  }
  connCall(op) {
    const pos = this.cur.pos; this.i += 2; // AND (
    const args = [];
    if (!this.isSym(')')) { for (;;) { args.push(this.expr()); if (!this.eatSym(',')) break; } }
    this.expectSym(')');
    if (args.length < 1) this.fail(`${op}() needs arguments`);
    let a = args[0];
    for (let k = 1; k < args.length; k++) a = N('bin', pos, { op, a, b: args[k] });
    return a;
  }
  pathFrom(sigil) {
    const c = this.cur;
    if (c.k !== 'id' && c.k !== 'qid') this.fail('expected a name');
    const pos = c.pos;
    const parts = [{ name: c.v }]; this.i++;
    for (;;) {
      if (this.isSym('.') && (this.peek(1).k === 'id' || this.peek(1).k === 'qid')) { this.i++; parts.push({ name: this.cur.v }); this.i++; this.tick(); }
      else if (this.isSym('[') && this.peek(1).k === 'num' && Number.isInteger(this.peek(1).v) && this.isSym(']', 2)) { parts.push({ idx: this.peek(1).v }); this.i += 3; this.tick(); }
      else break;
    }
    const n = N('path', pos, { parts });
    if (sigil) n.sigil = true;
    return n;
  }
  call() {
    const c = this.cur; const pos = c.pos;
    const nx2 = this.peek(2), nx3 = this.peek(3);
    if (nx2.k === 'id' && nx3.k === 'sym' && nx3.v === ':' && !(nx2.v.toLowerCase() === 'distinct')) { // viewcall
      this.i += 2; const pairs = [];
      this.enter();
      try {
        while (!this.isSym(')')) {
          if (this.cur.k !== 'id') this.fail('expected a parameter name');
          const key = this.cur.v; this.i++; this.expectSym(':');
          pairs.push({ k: key, v: this.valueExpr() });
          if (!this.eatSym(';')) break;
        }
      } finally { this.leave(); }
      this.expectSym(')');
      return N('viewcall', pos, { name: c.v, pairs });
    }
    this.i += 2;
    let distinct = false;
    if (this.isWord('distinct') && !this.isSym('(', 1) && !this.isSym(',', 1) && !this.isSym(')', 1)) { this.i++; distinct = true; }
    const args = [];
    this.enter();
    try {
      if (!this.isSym(')')) { for (;;) { args.push(this.expr()); if (!this.eatSym(',')) break; } }
    } finally { this.leave(); }
    this.expectSym(')');
    const n = N('call', pos, { name: c.v.toLowerCase(), args });
    if (distinct) n.distinct = true;
    return n;
  }
  list() {
    const pos = this.cur.pos; this.expectSym('[');
    const items = [];
    this.enter();
    try { while (!this.isSym(']')) { items.push(this.valueExpr()); if (!this.eatSym(',')) break; } } finally { this.leave(); }
    this.expectSym(']');
    return N('list', pos, { items });
  }
  object() {
    const pos = this.cur.pos; this.expectSym('{');
    const pairs = [];
    this.enter();
    try {
      while (!this.isSym('}')) {
        const c = this.cur;
        if (c.k !== 'id' && c.k !== 'str' && c.k !== 'qid') this.fail('expected an object key');
        this.i++; this.expectSym(':');
        pairs.push({ k: c.v, v: this.valueExpr() });
        if (!this.eatSym(',')) break;
      }
    } finally { this.leave(); }
    this.expectSym('}');
    if (this.sortObj) pairs.sort((x, y) => (x.k < y.k ? -1 : x.k > y.k ? 1 : 0));
    for (let i = 1; i < pairs.length; i++) if (pairs[i].k === pairs[i - 1].k && this.sortObj) this.fail(`duplicate object key ${JSON.stringify(pairs[i].k)}`);
    return N('obj', pos, { pairs });
  }
  // value = expr [asc|desc] [nulls first|last]
  valueExpr() {
    const x = this.expr();
    let dir = null, nulls = null;
    if (this.isWord('asc') || this.isWord('desc')) { dir = this.cur.v.toLowerCase(); this.i++; }
    if (this.isWord('nulls') && (this.isWord('first', 1) || this.isWord('last', 1))) { nulls = this.peek(1).v.toLowerCase(); this.i += 2; }
    if (dir === null && nulls === null) return x;
    return N('ordered', x.pos, { x, dir: dir || 'asc', nulls });
  }

  // ---- verb calls --------------------------------------------------------------------------------------------
  verbcall(isWrite) {
    this.enter();
    try {
      const start = this.cur.pos;
      let glyph = null;
      if (this.cur.k === 'glyph') { glyph = this.cur.v; this.i++; }
      const vt = this.cur;
      if (vt.k !== 'id') this.fail('expected a verb');
      if (!/^[A-Z]{3}$/.test(vt.v) || !this.isSym('(', 1) && !(this.peek(1).k === 'glyph' && this.isSym('(', 2))) {
        if (/^[A-Z]{3}$/.test(vt.v) && !VERBS.includes(vt.v)) throw new EoqlError('E_UNKNOWN_VERB', `unknown verb ${vt.v}`, { pos: vt.pos });
        this.fail('expected a verb call', VERBS);
      }
      const verb = vt.v;
      if (!VERBS.includes(verb)) throw new EoqlError('E_UNKNOWN_VERB', `unknown verb ${verb}`, { pos: vt.pos });
      this.i++;
      if (this.cur.k === 'glyph') { if (!glyph) glyph = this.cur.v; this.i++; }
      if (glyph && GLYPH_VERB[glyph] !== verb) this.gaps.push({ code: 'W_GLYPH', detail: `glyph ${glyph} belongs to ${GLYPH_VERB[glyph]}, not ${verb}`, pos: start });
      this.expectSym('(');
      let first = null; const clauses = [];
      const valid = isWrite ? WRITE_CLAUSES[verb] : READ_CLAUSES[verb];
      if (!this.isSym(')')) {
        const c = this.cur;
        let pendingClause = false;
        if (this.isSym(';')) { /* empty first segment */ } else if (c.k === 'id' && this.isSym(':', 1)) { pendingClause = true; } else {
          const lg = isWrite ? null : this.legacy(verb);
          if (lg) { clauses.push(...lg.clauses); } else {
            first = this.expr();
            if (!isWrite && verb === 'EVA' && isPred(first)) { clauses.push({ key: 'where', value: first, pos: first.pos }); first = null; }
          }
        }
        for (;;) {
          if (this.isSym(')')) break;
          if (pendingClause) pendingClause = false; else if (!this.eatSym(';')) break;
          if (this.isSym(')')) break;
          clauses.push(this.clause(valid, verb, isWrite));
        }
      }
      this.expectSym(')');
      // canonical clause order, duplicates refused
      const order = isWrite ? WRITE_ORDER : valid;
      const seen = new Set();
      for (const cl of clauses) { if (seen.has(cl.key)) throw new EoqlError('E_PARSE', `duplicate clause ${cl.key}`, { pos: cl.pos }); seen.add(cl.key); }
      clauses.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
      const node = N('verb', start, { verb, first, clauses: clauses.map((c) => ({ key: c.key, value: c.value })) });
      if (glyph) Object.defineProperty(node, 'glyph', { value: glyph, enumerable: false });
      return node;
    } finally { this.leave(); }
  }
  firstExpr(verb) { // the input world expression
    void verb;
    return this.expr();
  }
  clause(valid, verb, isWrite) {
    const c = this.cur;
    if (c.k !== 'id') this.fail('expected a clause name', valid);
    const key = c.v;
    if (isWrite && key === 'cell') throw new EoqlError('E_CELL_TYPED', 'a cell is never typed in a statement: the kind declaration supplies it', { pos: c.pos });
    if (isWrite && ['v', 'id', 'by', 'at', 'seen'].includes(key)) throw new EoqlError('E_COMPUTED_FIELD', `${key} is computed by weave and cannot be supplied`, { pos: c.pos });
    if (!valid.includes(key)) throw new EoqlError('E_UNKNOWN_CLAUSE', `${verb} has no clause "${key}"${isWrite ? ' in a write' : ''}`, { pos: c.pos, detail: { verb, clause: key, valid } });
    this.i++; this.expectSym(':');
    const saved = this.sortObj;
    this.sortObj = !ORDERED_OBJ.has(key);
    try {
      let value;
      if ((key === 'of') && this.cur.k === 'id' && (this.cur.v === 'heads' || this.cur.v === 'live-heads') && !this.isSym('(', 1) && !this.isSym('.', 1)) {
        value = N('heads', this.cur.pos, { live: this.cur.v === 'live-heads' }); this.i++;
      } else value = this.valueExpr();
      return { key, value, pos: c.pos };
    } finally { this.sortObj = saved; }
  }
  // seed forms recognised only as the WHOLE first segment (2.3)
  legacy(verb) {
    const a = this.cur, b = this.peek(1), c = this.peek(2), d = this.peek(3);
    const endAt = (k) => { const t = this.peek(k); return t.k === 'eof' || (t.k === 'sym' && (t.v === ')' || t.v === ';')); };
    const mkpath = (name, pos) => N('path', pos, { parts: [{ name }] });
    const lit = (v, pos) => N('lit', pos, { v });
    const call = (name, args, pos) => N('call', pos, { name, args });
    if (verb === 'REC' && a.k === 'id' && a.v.toLowerCase() === 'by' && b.k === 'id' && !isContextual(b.v) && endAt(2)) {
      this.i += 2;
      return { clauses: [{ key: 'by', value: N('list', a.pos, { items: [mkpath(b.v, b.pos)] }), pos: a.pos }] };
    }
    if (verb === 'SYN' && a.k === 'id' && LEGACY_AGG.has(a.v.toLowerCase())) {
      const fn = LEGACY_AGG.get(a.v.toLowerCase());
      if (endAt(1) && fn === 'count') {
        this.i += 1;
        return { clauses: [{ key: 'agg', value: N('obj', a.pos, { pairs: [{ k: 'count', v: call('count', [N('star', a.pos, {})], a.pos) }] }), pos: a.pos }] };
      }
      if (b.k === 'id' && !isContextual(b.v) && endAt(2)) {
        this.i += 2;
        return { clauses: [{ key: 'agg', value: N('obj', a.pos, { pairs: [{ k: fn, v: call(fn, [mkpath(b.v, b.pos)], a.pos) }] }), pos: a.pos }] };
      }
    }
    if (verb === 'DEF') {
      if (a.k === 'id' && a.v.toLowerCase() === 'order' && b.k === 'id' && b.v.toLowerCase() === 'by' && c.k === 'id' && !isContextual(c.v)) {
        let dir = 'asc', k = 3;
        if (d.k === 'id' && (d.v.toLowerCase() === 'asc' || d.v.toLowerCase() === 'desc')) { dir = d.v.toLowerCase(); k = 4; }
        if (endAt(k)) {
          this.i += k;
          return { clauses: [{ key: 'sort', value: N('list', a.pos, { items: [N('ordered', c.pos, { x: mkpath(c.v, c.pos), dir, nulls: null })] }), pos: a.pos }] };
        }
      }
      if (a.k === 'id' && a.v.toLowerCase() === 'first' && b.k === 'num' && Number.isInteger(b.v) && b.v >= 0 && endAt(2)) {
        this.i += 2;
        return { clauses: [{ key: 'limit', value: lit(b.v, b.pos), pos: a.pos }] };
      }
    }
    return null;
  }
}
