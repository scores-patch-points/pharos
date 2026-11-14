// formats/sqlread.mjs: the restricted SQL-dump statement reader (SPEC 6.3). It executes nothing:
// CREATE TABLE, INSERT INTO <t> [(cols)] VALUES (...)[, (...)], and comments. Anything else is E_IMPORT.
import { EoqlError } from '../errors.mjs';

function tokenize(sql) {
  const toks = []; let i = 0; const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && sql[i + 1] === '-') { while (i < n && sql[i] !== '\n') i++; continue; }
    if (c === '/' && sql[i + 1] === '*') { const e = sql.indexOf('*/', i + 2); if (e < 0) throw new EoqlError('E_IMPORT', 'unterminated comment in SQL dump'); i = e + 2; continue; }
    if (c === "'") {
      let s = ''; i++;
      for (;;) { if (i >= n) throw new EoqlError('E_IMPORT', 'unterminated string in SQL dump'); if (sql[i] === "'") { if (sql[i + 1] === "'") { s += "'"; i += 2; continue; } i++; break; } s += sql[i++]; }
      toks.push({ k: 'str', v: s }); continue;
    }
    if (c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c; let j = i + 1; let s = '';
      while (j < n && sql[j] !== close) s += sql[j++];
      if (j >= n) throw new EoqlError('E_IMPORT', 'unterminated quoted identifier in SQL dump');
      toks.push({ k: 'id', v: s, quoted: true }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c) || ((c === '-' || c === '+' || c === '.') && /[0-9.]/.test(sql[i + 1] || ''))) {
      const m = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(sql.slice(i));
      if (!m) throw new EoqlError('E_IMPORT', 'bad number in SQL dump');
      toks.push({ k: 'num', v: m[0] }); i += m[0].length; continue;
    }
    if (/[A-Za-z_]/.test(c)) { let j = i; while (j < n && /[A-Za-z0-9_$]/.test(sql[j])) j++; toks.push({ k: 'id', v: sql.slice(i, j) }); i = j; continue; }
    if ('(),;.'.includes(c)) { toks.push({ k: 'sym', v: c }); i++; continue; }
    throw new EoqlError('E_IMPORT', `unsupported character ${JSON.stringify(c)} in SQL dump`);
  }
  return toks;
}

// -> { tables: Map(name -> {columns: [names]|null}), inserts: [{table, columns:[...]|null, rows:[[value...]]}] }
export function readSqlDump(sql) {
  const toks = tokenize(sql); let p = 0;
  const tables = new Map(); const inserts = [];
  const isWord = (t, w) => t && t.k === 'id' && !t.quoted && t.v.toUpperCase() === w;
  const expectSym = (s) => { if (!(toks[p] && toks[p].k === 'sym' && toks[p].v === s)) throw new EoqlError('E_IMPORT', `expected "${s}" in SQL dump`); p++; };
  const name = () => { const t = toks[p++]; if (!t || t.k !== 'id') throw new EoqlError('E_IMPORT', 'expected a name in SQL dump'); let v = t.v; if (toks[p] && toks[p].k === 'sym' && toks[p].v === '.') { p++; const t2 = toks[p++]; if (!t2 || t2.k !== 'id') throw new EoqlError('E_IMPORT', 'bad qualified name'); v = t2.v; } return v; };
  const value = () => {
    const t = toks[p++];
    if (!t) throw new EoqlError('E_IMPORT', 'unexpected end of SQL dump');
    if (t.k === 'str') return t.v;
    if (t.k === 'num') { const x = Number(t.v); return /^[+-]?\d+$/.test(t.v) && Number.isSafeInteger(x) ? x : x; }
    if (t.k === 'id' && !t.quoted && t.v.toUpperCase() === 'NULL') return null;
    if (t.k === 'id' && !t.quoted && ['TRUE', 'FALSE'].includes(t.v.toUpperCase())) return t.v.toUpperCase() === 'TRUE' ? 1 : 0;
    throw new EoqlError('E_IMPORT', 'unsupported value in SQL dump (only strings, numbers and NULL)');
  };
  while (p < toks.length) {
    if (toks[p].k === 'sym' && toks[p].v === ';') { p++; continue; }
    if (isWord(toks[p], 'CREATE')) {
      p++; if (!isWord(toks[p], 'TABLE')) throw new EoqlError('E_IMPORT', 'only CREATE TABLE is accepted in a SQL dump'); p++;
      if (isWord(toks[p], 'IF')) { p += 3; }
      const t = name(); expectSym('(');
      const cols = []; let depth = 1; let atStart = true;
      while (p < toks.length && depth > 0) {
        const tk = toks[p++];
        if (tk.k === 'sym' && tk.v === '(') depth++; else if (tk.k === 'sym' && tk.v === ')') depth--; else if (tk.k === 'sym' && tk.v === ',' && depth === 1) { atStart = true; continue; } else if (atStart && depth === 1 && tk.k === 'id' && !['PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK', 'CONSTRAINT'].includes(tk.v.toUpperCase())) cols.push(tk.v);
        atStart = false;
      }
      tables.set(t, { columns: cols });
      continue;
    }
    if (isWord(toks[p], 'INSERT')) {
      p++; if (isWord(toks[p], 'OR')) p += 2; if (!isWord(toks[p], 'INTO')) throw new EoqlError('E_IMPORT', 'expected INSERT INTO'); p++;
      const t = name(); let columns = null;
      if (toks[p] && toks[p].k === 'sym' && toks[p].v === '(') { p++; columns = []; for (;;) { const t2 = toks[p++]; if (!t2 || t2.k !== 'id') throw new EoqlError('E_IMPORT', 'bad column list'); columns.push(t2.v); if (toks[p].k === 'sym' && toks[p].v === ',') { p++; continue; } expectSym(')'); break; } }
      if (!isWord(toks[p], 'VALUES')) throw new EoqlError('E_IMPORT', 'only INSERT ... VALUES is accepted in a SQL dump'); p++;
      const rows = [];
      for (;;) { expectSym('('); const row = []; for (;;) { row.push(value()); if (toks[p] && toks[p].k === 'sym' && toks[p].v === ',') { p++; continue; } expectSym(')'); break; } rows.push(row); if (toks[p] && toks[p].k === 'sym' && toks[p].v === ',') { p++; continue; } break; }
      inserts.push({ table: t, columns, rows });
      continue;
    }
    throw new EoqlError('E_IMPORT', `statement type ${JSON.stringify(toks[p].v)} is not accepted in a SQL dump (executes nothing; only CREATE TABLE and INSERT)`);
  }
  return { tables, inserts };
}
export const sqlQuote = (s) => "'" + String(s).replace(/'/g, "''") + "'";
export function sqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return sqlQuote(typeof v === 'string' ? v : JSON.stringify(v));
}
