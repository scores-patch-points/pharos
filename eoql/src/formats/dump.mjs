// formats/dump.mjs: the EOQL statement sequence (SPEC 4.6): statement splitter, verbatim and semantic dumps, readers.
import { canonical, idsDigest, isObj } from '../util.mjs';
import { EoqlError } from '../errors.mjs';
import { Fold } from '../fold.mjs';
import { CELL_OP, BOOT } from '../vendor.mjs';
import { LIMITS } from '../lex.mjs';
import { parse } from '../parse.mjs';
import { invalidReason } from '../jsonl.mjs';
import { extraKeys } from './core.mjs';

// Split script text into statements at top-level `;` (outside strings, comments and brackets). Total, linear.
// -> [{ text, start }] with comment-only and empty segments dropped.
export function splitStatements(text) {
  const out = []; const n = text.length; let i = 0; let start = 0; let depth = 0; let hasTok = false;
  const flush = (end) => { if (hasTok) out.push({ text: text.slice(start, end), start }); hasTok = false; };
  while (i < n) {
    const c = text[i];
    if (c === '-' && text[i + 1] === '-') { while (i < n && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      if (!hasTok) { start = i; hasTok = true; }
      let j = i + 1;
      for (;;) {
        if (j >= n) break;
        if (c !== '`' && text[j] === '\\') { j += 2; continue; }
        if (text[j] === c) { if (text[j + 1] === c) { j += 2; continue; } break; }
        j++;
      }
      i = j + 1; continue;
    }
    if (c === ';' && depth <= 0) { flush(i); i++; start = i; depth = 0; continue; }
    if (c === '(' || c === '[' || c === '{') depth++; else if (c === ')' || c === ']' || c === '}') depth--;
    if (!/\s/.test(c)) { if (!hasTok) { start = i; hasTok = true; } }
    i++;
  }
  flush(n);
  return out;
}

// chunks of whole statements whose joined text stays under the per-script limit
export function chunkStatements(stmts, maxChars = LIMITS.chars - 2000, maxStmts = 400) {
  const chunks = []; let cur = []; let len = 0;
  for (const s of stmts) {
    if (cur.length && (len + s.text.length + 2 > maxChars || cur.length >= maxStmts)) { chunks.push(cur); cur = []; len = 0; }
    cur.push(s); len += s.text.length + 2;
  }
  if (cur.length) chunks.push(cur);
  return chunks.map((c) => c.map((s) => s.text).join(';\n'));
}

// AST literal -> JS value (objects, lists, strings, numbers, booleans, null only)
export function litValue(n) {
  if (!n) throw new EoqlError('E_IMPORT', 'missing value');
  switch (n.t) {
    case 'lit': return n.v;
    case 'list': return n.items.map(litValue);
    case 'obj': { const o = {}; for (const p of n.pairs) o[p.k] = litValue(p.v); return o; }
    case 'un': if (n.op === '-' && n.x.t === 'lit' && typeof n.x.v === 'number') return -n.x.v; break;
    default: break;
  }
  throw new EoqlError('E_IMPORT', `a verbatim entry must be a JSON literal (found ${n.t})`);
}

const header = (mode, n, ids) => `-- eoql-dump/1 mode=${mode} entries=${n} ids_sha256=${idsDigest(ids)}\n`;

// -> { text, manifest:{notExpressible:[...], dropped:[...]}, refused:[...] }
export function dumpVerbatim(items) {
  const fold = new Fold(items);
  const ids = items.map((x) => x.e.id);
  let out = header('verbatim', items.length, ids); const refused = [];
  for (let p = 0; p < fold.n; p++) {
    const e = fold.ents[fold.ord[p]];
    const stmt = `WRITE SYN(; entries: [${canonical(e)}]);`;
    let bad = null;
    if (stmt.length > LIMITS.chars) bad = 'statement longer than the per-script limit';
    else { try { parse(stmt); } catch (err) { if (err instanceof EoqlError && err.code === 'E_LIMIT') bad = 'statement exceeds a parser limit'; else if (err instanceof EoqlError) bad = `statement does not parse (${err.code})`; else throw err; } }
    if (bad) refused.push({ id: e.id, reason: bad });
    out += stmt + '\n';
  }
  return { text: out, refused };
}

const PROTOCOL = new Map(Object.entries(BOOT));
export function dumpSemantic(items) {
  const fold = new Fold(items);
  const ids = items.map((x) => x.e.id);
  let out = header('semantic', items.length, ids);
  const label = new Map(); let n = 0; const lost = { ids: [], seen: 0, at: 0, by: 0, frame: [], undeclaredCell: [], droppedOf: [], extra: [] };
  const declared = new Map(); // kind name -> cell, in order of declaration in this dump (plus protocol kinds)
  for (const [k, c] of PROTOCOL) declared.set(k, c);
  const cellDeclarer = new Map(); for (const [k, c] of PROTOCOL) if (!cellDeclarer.has(c)) cellDeclarer.set(c, k);
  const notExpressible = [];
  const declaredInLog = new Set(); for (const it of items) if (it.e.kind === 'kind' && it.e.body && typeof it.e.body.name === 'string') declaredInLog.add(it.e.body.name);
  // first pass: declarations known from the whole log (kind entries), in pos order
  const stmts = [];
  for (let p = 0; p < fold.n; p++) {
    const e = fold.ents[fold.ord[p]];
    lost.ids.push(e.id);
    if (extraKeys(e).length) lost.extra.push(e.id);
    if (e.kind === 'frame') { out += `-- frame entry ${e.id} not replayed\n`; lost.frame.push(e.id); continue; }
    if (e.kind === 'kind') {
      const b = e.body;
      if (!isObj(b) || typeof b.name !== 'string' || typeof b.cell !== 'string') { out += `-- not expressible: malformed kind entry ${e.id}\n`; notExpressible.push({ id: e.id, why: 'malformed kind entry' }); continue; }
      if (PROTOCOL.has(b.name)) { out += `-- protocol kind ${b.name} (declared by the protocol)\n`; continue; }
      const like = cellDeclarer.get(b.cell);
      if (!like) { out += `-- not expressible: kind ${b.name}\n`; notExpressible.push({ id: e.id, why: `no declared kind has cell ${b.cell}`, kind: b.name }); continue; }
      if (declared.has(b.name)) { /* a redeclaration at the same cell: replay appends one more declaration */ }
      declared.set(b.name, b.cell); if (!cellDeclarer.has(b.cell)) cellDeclarer.set(b.cell, b.name);
      n++; label.set(e.id, `e${n}`);
      const sch = Object.prototype.hasOwnProperty.call(b, 'schema') ? `; schema: ${canonical(b.schema)}` : '';
      stmts.push(`WRITE DEF(declare: ${JSON.stringify(b.name)}; like: ${JSON.stringify(like)}${sch}; as: e${n});`);
      continue;
    }
    const op = CELL_OP.get(e.cell);
    if (e.kind !== 'retract' && !declared.has(e.kind) && !declaredInLog.has(e.kind)) { out += `-- skipped: kind ${e.kind} is not declared in the log\n`; notExpressible.push({ id: e.id, why: 'undeclared kind', kind: e.kind }); lost.undeclaredCell.push(e.id); continue; }
    const present = e.of.filter((x) => label.has(x)); const droppedOf = e.of.filter((x) => !label.has(x));
    if (droppedOf.length) { stmts.push(`-- dropped of: ${droppedOf.join(' ')}`); lost.droppedOf.push(...droppedOf); }
    n++; label.set(e.id, `e${n}`);
    if (e.kind === 'retract') {
      if (!present.length) { n--; label.delete(e.id); out += `-- not expressible: retract ${e.id} has no target in the dump\n`; notExpressible.push({ id: e.id, why: 'retract without targets in the dump' }); continue; }
      stmts.push(`WRITE NUL([${present.map((x) => '@' + label.get(x)).join(', ')}]; kind: "retract"${e.addr ? `; addr: ${JSON.stringify(e.addr)}` : ''}; body: ${canonical(e.body)}; as: e${n});`);
      continue;
    }
    const ofs = present.length ? `; of: [${present.map((x) => '@' + label.get(x)).join(', ')}]` : '';
    stmts.push(`WRITE ${op}(${JSON.stringify(e.addr)}; kind: ${JSON.stringify(e.kind)}; body: ${canonical(e.body)}${ofs}; basis: ${canonical(e.basis)}; as: e${n});`);
  }
  out += stmts.join('\n') + (stmts.length ? '\n' : '');
  return { text: out, notExpressible, lost };
}

// statements of a verbatim dump -> entries. Each statement must be WRITE SYN(; entries: [<literal>...]).
export function readVerbatim(text) {
  const out = [];
  for (const st of splitStatements(text)) {
    const script = parse(st.text);
    for (const s of script.statements) {
      if (s.t !== 'write' || s.call.verb !== 'SYN') throw new EoqlError('E_IMPORT', 'a verbatim dump holds only WRITE SYN(; entries: [...]) statements');
      const cl = s.call.clauses.find((c) => c.key === 'entries');
      if (!cl || s.call.clauses.length !== 1 || s.call.first) throw new EoqlError('E_IMPORT', 'a verbatim statement has exactly one clause, entries');
      for (const x of litValue(cl.value)) {
        const why = invalidReason(x);
        if (why) throw new EoqlError(why === 'id does not match content' ? 'E_ID_MISMATCH' : 'E_IMPORT', `not a valid entry: ${why}`);
        out.push(x);
      }
    }
  }
  return out;
}
export function dumpMode(text) {
  const m = /^-- eoql-dump\/1 mode=(verbatim|semantic)\b/.exec(text);
  if (m) return m[1];
  return /WRITE SYN\(; entries:/.test(text.slice(0, 4000)) ? 'verbatim' : 'semantic';
}
