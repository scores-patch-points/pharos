// print.mjs: the canonical printer (SPEC 4.5). print(parse(x)) is the expression text that is hashed and stored in views.
import { sha256 } from './util.mjs';
import { isContextual } from './parse.mjs';
import { EoqlError } from './errors.mjs';

const ORDERED_OBJ = new Set(['set', 'agg', 'bind', 'rename']);
const simpleIdent = (s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) && !isContextual(s);
const qid = (s) => (simpleIdent(s) ? s : '`' + s.replace(/`/g, '``') + '`');
const PREC = { OR: 1, AND: 2, NOT: 3, REL: 4, ADD: 5, MUL: 6, UN: 7, PRIM: 8 };

export function printNum(v, real) {
  if (Object.is(v, -0)) v = 0;
  const s = JSON.stringify(v);
  if (real && Number.isInteger(v) && !/[eE.]/.test(s)) return s + '.0';
  return s;
}

function prec(n) {
  switch (n.t) {
    case 'bin': return n.op === 'OR' ? PREC.OR : n.op === 'AND' ? PREC.AND : (n.op === '*' || n.op === '/' || n.op === '%') ? PREC.MUL : PREC.ADD;
    case 'not': return PREC.NOT;
    case 'rel': case 'isnull': case 'isset': case 'is': case 'contains': case 'in': case 'between': case 'like': case 'glob': return PREC.REL;
    case 'un': return PREC.UN;
    case 'lit': return (typeof n.v === 'number' && n.v < 0) ? PREC.UN : PREC.PRIM;
    case 'ordered': return PREC.OR;
    default: return PREC.PRIM;
  }
}

export function printNode(n, min = 0, ctx = {}) {
  if (!n || typeof n !== 'object') throw new EoqlError('E_TYPE', 'cannot print a non-node');
  let s;
  switch (n.t) {
    case 'lit':
      s = n.v === null ? 'null' : typeof n.v === 'string' ? JSON.stringify(n.v) : typeof n.v === 'boolean' ? String(n.v) : printNum(n.v, n.real);
      break;
    case 'path': s = (n.sigil ? '$' : '') + n.parts.map((p, i) => (p.idx !== undefined ? `[${p.idx}]` : (i ? '.' : '') + qid(p.name))).join(''); break;
    case 'param': s = ':' + n.name; break;
    case 'label': s = '@' + n.name; break;
    case 'idref': s = '#' + n.hex; break;
    case 'heads': s = n.live ? 'live-heads' : 'heads'; break;
    case 'star': s = '*'; break;
    case 'un': { const x = printNode(n.x, PREC.UN); s = '-' + (x.startsWith('-') ? ' ' : '') + x; break; }
    case 'bin': {
      const p = prec(n);
      const L = printNode(n.a, p), R = printNode(n.b, p + 1);
      s = `${L} ${n.op} ${R}`; break;
    }
    case 'not': s = 'NOT ' + printNode(n.x, PREC.NOT); break;
    case 'rel': s = `${printNode(n.a, PREC.ADD)} ${n.op} ${printNode(n.b, PREC.ADD)}`; break;
    case 'isnull': s = `${printNode(n.x, PREC.ADD)} is ${n.neg ? 'not ' : ''}null`; break;
    case 'isset': s = `${printNode(n.x, PREC.ADD)} is ${n.neg ? 'not ' : ''}set`; break;
    case 'is': s = `${printNode(n.x, PREC.ADD)} is ${n.neg ? 'not ' : ''}${printNode(n.rhs, PREC.ADD)}`; break;
    case 'contains': s = `${printNode(n.x, PREC.ADD)} ${n.neg ? 'not ' : ''}contains ${printNode(n.rhs, PREC.ADD)}`; break;
    case 'in': {
      const r = n.rhs.t === 'list' || n.rhs.t === 'param' ? printNode(n.rhs) : `(${printNode(n.rhs.t === 'sub' ? n.rhs.x : n.rhs)})`;
      s = `${printNode(n.x, PREC.ADD)} ${n.neg ? 'not ' : ''}in ${r}`; break;
    }
    case 'between': s = `${printNode(n.x, PREC.ADD)} ${n.neg ? 'not ' : ''}between ${printNode(n.lo, PREC.ADD)} AND ${printNode(n.hi, PREC.ADD)}`; break;
    case 'like': s = `${printNode(n.x, PREC.ADD)} ${n.neg ? 'not ' : ''}like ${printNode(n.pat, PREC.ADD)}${n.esc ? ' escape ' + printNode(n.esc, PREC.ADD) : ''}`; break;
    case 'glob': s = `${printNode(n.x, PREC.ADD)} ${n.neg ? 'not ' : ''}glob ${printNode(n.pat, PREC.ADD)}`; break;
    case 'call': s = `${n.name}(${n.distinct ? 'distinct ' : ''}${n.args.map((a) => printNode(a)).join(', ')})`; break;
    case 'viewcall': s = `${n.name}(${n.pairs.map((p) => `${p.k}: ${printNode(p.v)}`).join('; ')})`; break;
    case 'list': s = '[' + n.items.map((x) => printNode(x)).join(', ') + ']'; break;
    case 'obj': {
      const ordered = ctx.ordered === true;
      const pairs = ordered ? n.pairs : [...n.pairs].sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
      s = '{' + pairs.map((p) => `${ordered && simpleIdent(p.k) ? p.k : JSON.stringify(p.k)}: ${printNode(p.v)}`).join(', ') + '}';
      break;
    }
    case 'ordered': s = `${printNode(n.x, PREC.OR)} ${n.dir}${n.nulls ? ' nulls ' + n.nulls : ''}`; return min > PREC.OR ? `(${s})` : s;
    case 'sub': s = printNode(n.x); break;
    case 'verb': s = printVerb(n); break;
    case 'read': return printNode(n.expr);
    case 'write': return 'WRITE ' + printVerb(n.call, true);
    case 'script': return n.statements.map((x) => printNode(x)).join(';\n');
    default: throw new EoqlError('E_TYPE', `cannot print node ${n.t}`);
  }
  return prec(n) < min ? `(${s})` : s;
}

function printVerb(n) {
  const parts = [];
  parts.push(n.first ? printNode(n.first) : '');
  const body = n.clauses.map((c) => `${c.key}: ${printNode(c.value, 0, { ordered: ORDERED_OBJ.has(c.key) })}`);
  if (!n.clauses.length) return `${n.verb}(${parts[0]})`;
  return `${n.verb}(${parts[0]}; ${body.join('; ')})`;
}

export function print(node) { return printNode(node); }
export const hash = (node) => sha256(print(node));
