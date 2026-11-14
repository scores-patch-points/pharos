// formats/index.mjs: nine decoders, nine encoders, `convert`, `dump`, `replay`, `importFrom` (SPEC 4.6, 6, 7.1).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EoqlError, VERSION, wrap } from '../errors.mjs';
import { canonical, sha256, idsDigest, isObj, entryId } from '../util.mjs';
import { Fold } from '../fold.mjs';
import { scanText, invalidReason } from '../jsonl.mjs';
import { placed } from '../vendor.mjs';
import { csvParse, csvEmit } from './csvlib.mjs';
import { readSqlDump, sqlQuote } from './sqlread.mjs';
import { eotParse, eotEntries, eotView } from './eot.mjs';
import { dumpVerbatim, dumpSemantic, readVerbatim, dumpMode, splitStatements, chunkStatements } from './dump.mjs';
import { blocksIngest, readStore, blocksWriterName } from '../adapters/blocks.mjs';
import { SqliteSource, writeProjection } from '../adapters/sqlite.mjs';
import { catalogRows, catalogColumns, relationNames, FIXED } from '../catalog.mjs';
import { plain } from '../val.mjs';
import { weaveOne, mergeEntries } from '../write.mjs';
import { Interp } from '../eval.mjs';
import {
  FORMATS, PROFILES, RETENTION, ATTRS, parseSpec, mkDecoded, addLine, entryLine, invalidLine, sortedFiles, distinctItems, extraKeys, inventory, emptyInventory,
  measureLosses, declaredPossible, mkManifest, safeFileName, laneMap, refuseTampered, applyEvidence, isLossyProfile, DEFAULT_PROFILE,
} from './core.mjs';

export { FORMATS, PROFILES, RETENTION, parseSpec };

const ENTRY_HEADER = ['id', 'v', 'cell', 'kind', 'addr', 'by', 'at', 'of', 'seen', 'basis', 'body', 'file'];
const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { throw new EoqlError('E_SOURCE', `cannot read ${p}: ${e.code || e.message}`); } };
const exists = (p) => fs.existsSync(p);
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };

// ---- decoders ---------------------------------------------------------------------------------------------------
function linesOfText(dec, file, text) {
  const { lines } = scanText(text);
  for (const l of lines) addLine(dec, file, l.e ? entryLine(l.e, l.text) : invalidLine(l.text, l.torn ? 'torn last line' : l.reason));
}
function decodeJsonl(loc) {
  if (!exists(loc)) throw new EoqlError('E_SOURCE', `does not exist: ${loc}`);
  const dec = mkDecoded('jsonl', 'entries');
  if (isDir(loc)) { for (const f of fs.readdirSync(loc).filter((x) => x.endsWith('.jsonl')).sort()) { dec.files.set(f.slice(0, -6), []); linesOfText(dec, f.slice(0, -6), readText(path.join(loc, f))); } } else { const n = path.basename(loc).replace(/\.jsonl$/, ''); dec.files.set(n, []); linesOfText(dec, n, readText(loc)); }
  return dec;
}
function decodeBlocks(loc) {
  if (!isDir(loc)) throw new EoqlError('E_SOURCE', `blocks store does not exist: ${loc}`);
  const dec = mkDecoded('blocks', 'entries');
  const r = readStore(loc);
  for (const f of r.files) {
    if (!f.items.length) continue;
    if (!dec.files.has(f.writer)) dec.files.set(f.writer, []);
    for (const it of f.items) addLine(dec, f.writer, it.kind === 'entry' ? entryLine(it.e, it.text) : { ...invalidLine(it.text, it.reason), medium: it.medium });
  }
  for (const ev of r.evidence) { if (ev.reason === 'blocks-non-entry' || ev.reason === 'blocks-unknown-kind') dec.notes.push({ code: ev.reason, detail: `${ev.where}: ${ev.detail}` }); else dec.evidence.push(ev); }
  for (const t of r.torn) dec.evidence.push({ reason: 'blocks-torn-tail', where: `${t.file}:${t.line}`, detail: t.reason });
  return dec;
}
function decodeLazy(loc) {
  if (!isDir(loc) || !exists(path.join(loc, 'PLACEMENT.json'))) throw new EoqlError('E_SOURCE', `not a placed root (no PLACEMENT.json): ${loc}`);
  const dec = mkDecoded('lazy', 'entries');
  for (const w of fs.readdirSync(loc, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name).sort()) {
    dec.files.set(w, []);
    for (const f of fs.readdirSync(path.join(loc, w)).filter((x) => x.endsWith('.jsonl')).sort()) linesOfText(dec, w, readText(path.join(loc, w, f)));
    if (!dec.files.get(w).length) dec.files.delete(w);
  }
  return dec;
}
function decodeSqlite(loc) {
  const src = new SqliteSource('sqlite:' + loc, loc);
  const d = src._load();
  const dec = mkDecoded('sqlite', 'entries');
  for (const it of d.items) addLine(dec, it.file || it.e.by, entryLine(it.e, canonical(it.e)));
  dec.evidence.push(...(d.health.extra || []), ...d.health.corrupt.map((c) => ({ reason: 'corrupt-row', where: `${c.file}:${c.line}`, detail: c.reason })));
  return dec;
}
function entryFromColumns(rowObj, where) {
  let body, of, seen, basis;
  try { body = JSON.parse(rowObj.body_json); of = JSON.parse(rowObj.of_json); seen = JSON.parse(rowObj.seen_json); basis = JSON.parse(rowObj.basis_json); } catch (e) { throw new EoqlError('E_IMPORT', `${where}: a JSON column does not parse`); }
  const e = { v: Number(rowObj.v), cell: rowObj.cell, kind: rowObj.kind, addr: rowObj.addr, body, of, basis, seen, by: rowObj.by, at: rowObj.at };
  return e;
}
function decodeSqldump(loc) {
  const text = readText(loc);
  const { tables, inserts } = readSqlDump(text);
  const dec = mkDecoded('sqldump', 'entries');
  const ent = inserts.filter((x) => x.table === 'entries');
  const cols0 = tables.get('entries') && tables.get('entries').columns;
  const need = ['id', 'cell', 'kind', 'addr', 'body_json', 'of_json', 'seen_json', 'basis_json', 'by', 'at', 'v'];
  const hasCols = (cols) => cols && need.every((c) => cols.includes(c));
  if (!ent.length && !(cols0 && hasCols(cols0))) { dec.foreign = { format: 'sqldump', tables, inserts }; return dec; }
  const mism = [];
  for (const ins of ent) {
    const cols = ins.columns || cols0;
    if (!hasCols(cols)) { dec.foreign = { format: 'sqldump', tables, inserts }; dec.files.clear(); return dec; }
    ins.rows.forEach((r, i) => {
      if (r.length !== cols.length) throw new EoqlError('E_IMPORT', `entries row ${i + 1} has ${r.length} values for ${cols.length} columns`);
      const o = {}; cols.forEach((c, k) => { o[c] = r[k]; });
      const e = entryFromColumns(o, `entries row ${i + 1}`);
      const id = entryId(e);
      if (id !== o.id) mism.push(String(o.id));
      e.id = id;
      const why = invalidReason(e);
      if (why) throw new EoqlError('E_IMPORT', `entries row ${i + 1} is not a valid entry: ${why}`);
      addLine(dec, o.writer ? String(o.writer) : e.by, entryLine(e, canonical(e)));
    });
  }
  if (mism.length) dec.evidence.push({ reason: 'sqldump-id-mismatch', where: 'entries', ids: mism.sort() });
  return dec;
}
const entryHeaderOk = (h) => h.length === ENTRY_HEADER.length && h.every((x, i) => x === ENTRY_HEADER[i]);
function decodeCsv(loc) {
  const rows = csvParse(readText(loc));
  const dec = mkDecoded('csv', 'entries');
  if (!rows.length) return dec;
  const header = rows[0];
  if (!entryHeaderOk(header)) { dec.foreign = { format: 'csv', columns: header, records: rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] === undefined ? '' : r[i]]))) }; return dec; }
  rows.slice(1).forEach((r, i) => {
    if (r.length !== ENTRY_HEADER.length) throw new EoqlError('E_IMPORT', `CSV row ${i + 2} has ${r.length} fields, expected ${ENTRY_HEADER.length}`);
    const o = Object.fromEntries(ENTRY_HEADER.map((h, k) => [h, r[k]]));
    let e;
    try { e = { v: Number(o.v), cell: o.cell, kind: o.kind, addr: o.addr, body: JSON.parse(o.body), of: JSON.parse(o.of), basis: JSON.parse(o.basis), seen: JSON.parse(o.seen), by: o.by, at: o.at }; } catch (err) { throw new EoqlError('E_IMPORT', `CSV row ${i + 2}: a JSON column does not parse`); }
    const id = entryId(e);
    if (id !== o.id) throw new EoqlError('E_ID_MISMATCH', `CSV row ${i + 2}: id column does not match the content`, { detail: { header: o.id, computed: id } });
    e.id = id;
    const why = invalidReason(e); if (why) throw new EoqlError('E_IMPORT', `CSV row ${i + 2} is not a valid entry: ${why}`);
    addLine(dec, o.file === '' ? e.by : o.file, entryLine(e, canonical(e)));
  });
  return dec;
}
function decodeJson(loc) {
  const text = readText(loc);
  const dec = mkDecoded('json', 'entries');
  let val; let nd = false;
  try { val = JSON.parse(text); } catch (e) {
    const ls = text.split('\n').filter((l) => l.trim());
    try { val = ls.map((l) => JSON.parse(l)); nd = true; } catch (e2) { throw new EoqlError('E_IMPORT', 'not JSON or NDJSON'); }
  }
  const finish = (arr) => {
    for (const x of arr) {
      const why = invalidReason(x);
      if (why) { if (why === 'id does not match content') throw new EoqlError('E_ID_MISMATCH', 'a JSON entry does not match its id', { detail: { id: x.id } }); throw new EoqlError('E_IMPORT', `not a valid entry: ${why}`); }
      addLine(dec, x.by, entryLine(x, canonical(x)));
    }
    return dec;
  };
  if (isObj(val) && val.format === 'eoql-json/1') {
    if (val.profile === 'entries' && Array.isArray(val.entries)) return finish(val.entries);
    const recs = Array.isArray(val.rows) ? val.rows : (Array.isArray(val.result && val.result.rows) ? val.result.rows : null);
    if (recs) { dec.foreign = { format: 'json', columns: Array.isArray(val.columns) ? val.columns.map((c) => (isObj(c) ? c.name : c)) : null, records: recs }; return dec; }
    throw new EoqlError('E_IMPORT', 'unrecognised eoql-json document');
  }
  if (Array.isArray(val)) {
    if (val.every((x) => isObj(x) && invalidReason(x) === null)) return finish(val);
    if (val.every(isObj)) { dec.foreign = { format: 'json', columns: null, records: val, ndjson: nd }; return dec; }
    throw new EoqlError('E_IMPORT', 'a JSON array must hold objects');
  }
  if (isObj(val) && Array.isArray(val.records) && val.records.every(isObj)) { dec.foreign = { format: 'json', columns: null, records: val.records }; return dec; }
  throw new EoqlError('E_IMPORT', 'JSON input is neither an entries document nor an array of objects');
}
function decodeEot(loc) {
  const dec = mkDecoded('eot', 'entries');
  for (const it of eotParse(readText(loc))) addLine(dec, it.file, entryLine(it.e, it.text));
  return dec;
}
function decodeEoql(loc, profile) {
  const text = readText(loc);
  const mode = profile && profile !== 'verbatim' ? profile : dumpMode(text);
  const dec = mkDecoded('eoql', mode);
  if (mode === 'semantic') return replaySemanticTemp(text, dec);
  for (const e of readVerbatim(text)) addLine(dec, e.by, entryLine(e, canonical(e)));
  return dec;
}
function replaySemanticTemp(text, dec) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eoql-replay-'));
  try {
    const dir = path.join(tmp, 'lib');
    const h = openWriteLib(dir, 'replay');
    replayInto(h, text, {});
    const d2 = decodeJsonl(dir);
    for (const f of sortedFiles(d2)) for (const l of d2.files.get(f)) addLine(dec, f, l);
    dec.notes.push({ code: 'semantic-replay', detail: 'a semantic dump was replayed into a scratch pharos; ids are new' });
    return dec;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
let _openWrite = null;
export function setOpener(fn) { _openWrite = fn; }
function openWriteLib(dir, writer) {
  if (!_openWrite) throw new EoqlError('E_INTERNAL', 'formats module has no opener');
  return _openWrite('lib:' + dir, { mode: 'write', writer });
}

export function decodeLocation(p) {
  const { fmt, profile, location } = p;
  if (isLossyProfile(fmt, profile) && !(fmt === 'eoql' && profile === 'semantic')) throw new EoqlError('E_IMPORT', `profile ${fmt}:${profile} carries a query result, not entries: it has no decoder`);
  switch (fmt) {
    case 'jsonl': return decodeJsonl(location);
    case 'blocks': return decodeBlocks(location);
    case 'lazy': return decodeLazy(location);
    case 'sqlite': return decodeSqlite(location);
    case 'sqldump': return decodeSqldump(location);
    case 'csv': return decodeCsv(location);
    case 'json': return decodeJson(location);
    case 'eot': return decodeEot(location);
    case 'eoql': return decodeEoql(location, profile);
    default: throw new EoqlError('E_USAGE', `unknown format ${fmt}`);
  }
}
// a handle's source as a Decoded (retaining duplicate and invalid lines where the store holds them)
export function decodeHandle(h) {
  const s = h.source;
  if (!s) throw new EoqlError('E_EXPORT', 'handle has no source');
  switch (s.kind) {
    case 'lib': return decodeJsonl(s.target);
    case 'jsonl': return decodeJsonl(s.target);
    case 'lazy': return decodeLazy(s.root);
    case 'blocks': return decodeBlocks(s.dir);
    case 'sqlite': return decodeSqlite(s.file);
    case 'mem': { const dec = mkDecoded('mem', 'entries'); for (const it of s.items) addLine(dec, it.file || it.e.by, entryLine(it.e, canonical(it.e))); return dec; }
    default: throw new EoqlError('E_EXPORT', `cannot export from a ${s.kind}: source`);
  }
}
const schemeOf = { jsonl: null, lazy: 'lazy', blocks: 'blocks', sqlite: 'sqlite' };
function uriForSpec(p) {
  if (p.fmt === 'jsonl') return (isDir(p.location) ? 'lib:' : 'jsonl:') + p.location;
  return `${schemeOf[p.fmt]}:${p.location}`;
}

// ---- encoders -----------------------------------------------------------------------------------------------------
function linesOfFile(dec, f) { return dec.files.get(f).map((l) => (l.type === 'entry' ? (l.text !== undefined ? l.text : canonical(l.e)) : l.text)); }
function ordered(items) { const f = new Fold(items); return f.ord.map((i) => ({ e: f.ents[i], file: items[i].file, text: items[i].text, pos: f.pos[i] })); }

function encJsonl(S, loc) {
  const notes = [];
  if (/\.jsonl$/.test(loc) && !isDir(loc)) {
    const all = []; for (const f of sortedFiles(S.dec)) all.push(...linesOfFile(S.dec, f));
    fs.mkdirSync(path.dirname(loc), { recursive: true });
    fs.writeFileSync(loc, all.length ? all.join('\n') + '\n' : '', { flag: 'wx' });
    if (sortedFiles(S.dec).length > 1) notes.push({ code: 'file-collapsed', detail: 'a single JSONL file holds every writer file' });
    return { notes };
  }
  fs.mkdirSync(loc, { recursive: true });
  const groups = new Map();
  const lanes = laneMap(sortedFiles(S.dec), safeFileName); notes.push(...lanes.notes);
  for (const f of sortedFiles(S.dec)) { const n = lanes.map.get(f); const a = groups.get(n) || []; a.push(...linesOfFile(S.dec, f)); groups.set(n, a); }
  for (const [n, a] of groups) fs.writeFileSync(path.join(loc, n + '.jsonl'), a.length ? a.join('\n') + '\n' : '', { flag: 'wx' });
  return { notes };
}
function encBlocks(S, loc) {
  fs.mkdirSync(loc, { recursive: true });
  const lanes = laneMap(sortedFiles(S.dec), blocksWriterName);
  const groups = new Map();
  const bl = (f) => S.dec.files.get(f).map((l) => (l.type === 'entry' ? (l.text !== undefined ? l.text : canonical(l.e)) : { invalid: l.text, medium: l.medium }));
  for (const f of sortedFiles(S.dec)) { const n = lanes.map.get(f); const a = groups.get(n) || []; a.push(...bl(f)); groups.set(n, a); }
  for (const [n, a] of groups) blocksIngest(loc, n, a);
  return { notes: lanes.notes };
}
function encLazy(S, loc, opts = {}) {
  fs.mkdirSync(loc, { recursive: true });
  const h = placed.openRoot(loc, { writer: '_ingest', writerDir: false, ...(Number.isInteger(opts.splitLimit) && opts.splitLimit > 0 ? { splitLimit: opts.splitLimit } : {}) });
  const bulk = new placed.Bulk(h);
  const lanes = laneMap(sortedFiles(S.dec), safeFileName);
  for (const f of sortedFiles(S.dec)) {
    const w = lanes.map.get(f);
    for (const l of S.dec.files.get(f)) {
      if (l.type === 'entry') bulk.putLine(w, l.e, l.text !== undefined ? l.text : canonical(l.e));
      else { const rel = `${w}/_corrupt.jsonl`; let a = bulk.buf.get(rel); if (!a) { a = []; bulk.buf.set(rel, a); } a.push(l.text + '\n'); bulk.pending += l.text.length + 1; }
    }
  }
  bulk.flush();
  return { notes: lanes.notes };
}
function encSqlite(S, loc) {
  fs.mkdirSync(path.dirname(loc), { recursive: true });
  writeProjection(loc, S.items.map((x) => ({ e: x.e, file: x.file })));
  return { notes: [] };
}
const SQL_ENTRIES_DDL = 'CREATE TABLE IF NOT EXISTS entries(pos INTEGER, id TEXT PRIMARY KEY, writer TEXT, cell TEXT, kind TEXT, addr TEXT, body_json TEXT, of_json TEXT, seen_json TEXT, basis_json TEXT, by TEXT, at TEXT, v INTEGER, retracted INTEGER, retracted_by TEXT);';
const sqlLit = (v) => { v = plain(v); if (v === null || v === undefined) return 'NULL'; if (typeof v === 'boolean') return v ? '1' : '0'; if (typeof v === 'number') return Number.isFinite(v) ? JSON.stringify(v) : 'NULL'; return sqlQuote(typeof v === 'string' ? v : canonical(v)); };
function encSqldump(S, loc, opts) {
  const items = S.items.map((x) => ({ e: x.e, file: x.file }));
  const fold = new Fold(items);
  const facts = { danglingCount: fold.dangling.size, corruptCount: 0, cutPos: null };
  const ids = items.map((x) => x.e.id);
  let out = `-- eoql-sqldump/1 entries=${items.length} ids_sha256=${idsDigest(ids)}\n${SQL_ENTRIES_DDL}\n`;
  const ecols = FIXED.entries.map(([n]) => n);
  for (const r of catalogRows(fold, 'entries', facts)) out += `INSERT INTO entries VALUES(${ecols.map((c) => sqlLit(r.c[c])).join(', ')});\n`;
  if (opts.derived) {
    out += '-- derived\n';
    const mk = (name, cols) => `CREATE TABLE IF NOT EXISTS ${name}(${cols.map((c) => `${c.name.replace(/[^A-Za-z0-9_]/g, '_')} ${c.affinity || ''}`.trim()).join(', ')});\n`;
    for (const t of ['heads', 'conflicts', 'kinds', 'meta']) {
      const cols = FIXED[t].map(([name, affinity]) => ({ name, affinity }));
      out += mk(t, cols);
      for (const r of catalogRows(fold, t, facts)) out += `INSERT INTO ${t} VALUES(${cols.map((c) => sqlLit(r.c[c.name])).join(', ')});\n`;
    }
    for (const [tname] of relationNames(fold).k) {
      const cols = catalogColumns(fold, tname); if (!cols) continue;
      out += mk(tname, cols);
      for (const r of catalogRows(fold, tname, facts) || []) out += `INSERT INTO ${tname} VALUES(${cols.map((c) => sqlLit(r.c[c.name])).join(', ')});\n`;
    }
  }
  fs.mkdirSync(path.dirname(loc), { recursive: true });
  fs.writeFileSync(loc, out, { flag: 'wx' });
  return { notes: [] };
}
function encCsv(S, loc) {
  const rows = [ENTRY_HEADER];
  for (const x of S.items) rows.push([x.e.id, x.e.v, x.e.cell, x.e.kind, x.e.addr, x.e.by, x.e.at, canonical(x.e.of), canonical(x.e.seen), canonical(x.e.basis), canonical(x.e.body), x.file]);
  fs.mkdirSync(path.dirname(loc), { recursive: true });
  fs.writeFileSync(loc, csvEmit(rows), { flag: 'wx' });
  return { notes: [] };
}
function encJson(S, loc) {
  const body = `{"format":"eoql-json/1","profile":"entries","entries":[${S.items.map((x) => canonical(x.e)).join(',\n')}]}\n`;
  fs.mkdirSync(path.dirname(loc), { recursive: true });
  fs.writeFileSync(loc, body, { flag: 'wx' });
  return { notes: [] };
}
function encEot(S, loc) {
  fs.mkdirSync(path.dirname(loc), { recursive: true });
  fs.writeFileSync(loc, eotEntries(S.items), { flag: 'wx' });
  return { notes: [] };
}
function encEoql(S, loc, opts, mode) {
  fs.mkdirSync(path.dirname(loc), { recursive: true });
  const items = S.items.map((x) => ({ e: x.e, file: x.file }));
  if (mode === 'semantic') { const d = dumpSemantic(items); fs.writeFileSync(loc, d.text, { flag: 'wx' }); return { notes: d.notExpressible.map((x) => ({ code: 'not-expressible', detail: JSON.stringify(x) })), semantic: d }; }
  const d = dumpVerbatim(items);
  if (d.refused.length) throw new EoqlError('E_NOT_REPRESENTABLE', `${d.refused.length} entr${d.refused.length === 1 ? 'y' : 'ies'} cannot be written as a verbatim statement`, { detail: { refused: d.refused } });
  fs.writeFileSync(loc, d.text, { flag: 'wx' });
  return { notes: [] };
}
const ENC = { jsonl: encJsonl, blocks: encBlocks, lazy: encLazy, sqlite: encSqlite, sqldump: encSqldump, csv: encCsv, json: encJson, eot: encEot };

// rows profiles
function resultColumns(env) { return env.columns.map((c) => c.name); }
function encRows(fmt, profile, env, loc, opts) {
  fs.mkdirSync(path.dirname(loc), { recursive: true });
  const cols = resultColumns(env);
  const txt = (v) => (v === null || v === undefined ? null : typeof v === 'object' ? canonical(v) : String(v));
  if (fmt === 'csv') fs.writeFileSync(loc, csvEmit([cols, ...env.rows.map((r) => cols.map((c) => txt(r[c])))]), { flag: 'wx' });
  else if (fmt === 'json' && profile === 'rows') fs.writeFileSync(loc, JSON.stringify({ format: 'eoql-json/1', profile: 'rows', columns: cols, rows: env.rows }) + '\n', { flag: 'wx' });
  else if (fmt === 'json') fs.writeFileSync(loc, JSON.stringify({ format: 'eoql-json/1', profile: 'result', result: env }) + '\n', { flag: 'wx' });
  else if (fmt === 'eot') fs.writeFileSync(loc, eotView(env), { flag: 'wx' });
  else if (fmt === 'sqldump') {
    const name = (opts && opts.table) || 'result';
    const id = (s) => s.replace(/[^A-Za-z0-9_]/g, '_');
    let out = `-- eoql-sqldump/1 derived rows=${env.rows.length}\nCREATE TABLE IF NOT EXISTS ${id(name)}(${cols.map((c) => id(c)).join(', ')});\n`;
    for (const r of env.rows) out += `INSERT INTO ${id(name)} VALUES(${cols.map((c) => sqlLit(r[c])).join(', ')});\n`;
    fs.writeFileSync(loc, out, { flag: 'wx' });
  } else throw new EoqlError('E_EXPORT', `no row encoder for ${fmt}:${profile}`);
  return { notes: [] };
}

// ---- convert ---------------------------------------------------------------------------------------------------------
function removeAny(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* none */ } }
function targetFree(p) {
  if (!exists(p)) return;
  if (isDir(p) && fs.readdirSync(p).length === 0) { fs.rmdirSync(p); return; }
  throw new EoqlError('E_EXPORT', `target already exists and is not empty (an export never overwrites): ${p}`);
}

// dec: Decoded of the input (already scoped); handle: a read handle when rows or a scope are needed
export function convertDecoded(dec, from, to, opts, ctx) {
  const mkOut = (S, stage) => {
    if (to.fmt === 'eoql') return encEoql(S, stage, opts, to.profile);
    return ENC[to.fmt](S, stage, opts);
  };
  const toLabel = `${to.fmt}${to.profile !== DEFAULT_PROFILE[to.fmt] ? ':' + to.profile : ''}:${to.location}`;
  const fromLabel = from.label;
  refuseTampered(dec, opts);
  const invIn = inventory(dec);
  const declared = declaredPossible(from.fmt, from.profile, to.fmt, to.profile);
  const lossy = isLossyProfile(to.fmt, to.profile);
  targetFree(to.location);
  const stage = `${to.location}.eoql-stage-${process.pid}-${Date.now()}`;
  const finish = (invOut, notes, entriesOut) => {
    const refused = [];
    const losses = measureLosses(invIn, invOut);
    const manifest = mkManifest({ from: fromLabel, to: toLabel, profileIn: from.profile, profileOut: to.profile, invIn, invOut, losses, refused, rejected: [], declared, entriesOutOverride: entriesOut });
    if (notes && notes.length) manifest.notes = notes;
    return applyEvidence(manifest, dec);
  };
  const commit = () => { fs.mkdirSync(path.dirname(to.location), { recursive: true }); fs.renameSync(stage, to.location); };
  try {
    if (lossy) {
      let notes = [];
      if (to.fmt === 'eoql') {
        const S = { dec, items: ordered(distinctItems(dec)) };
        const r = mkOut(S, stage); notes = r.notes;
        const m = finish(emptyInventory(), notes, 0);
        if (r.semantic) { m.not_expressible = r.semantic.notExpressible; }
        if (!opts.acceptLoss) throw new EoqlError('E_LOSSY', 'this conversion is lossy (a re-weavable description, not entries); pass acceptLoss', { detail: { manifest: m } });
        commit(); return m;
      }
      const env = ctx && ctx.env;
      if (!env) throw new EoqlError('E_EXPORT', `${to.fmt}:${to.profile} needs a query result: give a scope expression`);
      encRows(to.fmt, to.profile, env, stage, opts);
      const m = finish(emptyInventory(), [], 0); m.rows = env.rows.length;
      if (!opts.acceptLoss) throw new EoqlError('E_LOSSY', 'this conversion is lossy (a query result, not entries); pass acceptLoss', { detail: { manifest: m } });
      commit(); return m;
    }
    // entries profile: refuse what the target cannot hold (never drop)
    const items = distinctItems(dec);
    if (RETENTION[to.fmt].extra === 'R') {
      const refused = items.filter((x) => extraKeys(x.e).length).map((x) => ({ id: x.e.id, reason: 'extra-fields', fields: extraKeys(x.e) }));
      if (refused.length) throw new EoqlError('E_NOT_REPRESENTABLE', `${refused.length} entr${refused.length === 1 ? 'y has' : 'ies have'} extra fields that ${to.fmt} cannot hold`, { detail: { refused } });
    }
    const S = { dec, items: ordered(items) };
    const r = mkOut(S, stage);
    const decOut = decodeLocation({ fmt: to.fmt, profile: to.profile, location: stage });
    const m = finish(inventory(decOut), [...(r.notes || []), ...decOut.notes.map((n) => n)], undefined);
    if ((m.losses.length || m.refused.length) && !opts.acceptLoss) throw new EoqlError('E_LOSSY', `conversion ${from.fmt} to ${to.fmt} loses ${m.losses.map((l) => l.attribute).join(', ')}; pass acceptLoss to proceed`, { detail: { manifest: m } });
    commit();
    return m;
  } catch (e) { removeAny(stage); throw e; } finally { if (exists(stage)) removeAny(stage); }
}

export function convertFrom(fromSpec, toSpec, opts, deps) {
  const from = parseSpec(fromSpec); const to = parseSpec(toSpec);
  from.label = `${from.fmt}${from.profile !== DEFAULT_PROFILE[from.fmt] ? ':' + from.profile : ''}:${from.location}`;
  let dec = decodeLocation(from);
  if (dec.foreign) throw new EoqlError('E_IMPORT', `${from.fmt} input holds foreign records, not entries: use import (with --kind and a write handle)`, { detail: { format: dec.foreign.format } });
  let handle = null; let env = null;
  const needHandle = opts.scope || isLossyProfile(to.fmt, to.profile) && !(to.fmt === 'eoql');
  try {
    if (needHandle) {
      handle = ['jsonl', 'lazy', 'blocks', 'sqlite'].includes(from.fmt) ? deps.open(uriForSpec(from)) : deps.openEntries(distinctItems(dec).map((x) => ({ e: x.e, file: x.file })));
      if (isLossyProfile(to.fmt, to.profile) && to.fmt !== 'eoql') env = deps.run(handle, opts.scope || 'sources');
      else if (opts.scope) { const r = deps.run(handle, opts.scope, { world: true }); dec = decFromWorld(r); }
    }
    return convertDecoded(dec, from, to, opts, { env });
  } finally { if (handle && deps.close) deps.close(handle); }
}
function decFromWorld(r) {
  const w = r.world;
  if (!w || !w.raw) throw new EoqlError('E_EXPORT', 'a scope for an entries export must be a raw world (use SEG/DEF/SIG, not a row operator)');
  const dec = mkDecoded('scope', 'entries');
  for (const it of w.core.items()) addLine(dec, it.file || it.e.by, entryLine(it.e, canonical(it.e)));
  return dec;
}
export function exportHandle(h, toSpec, opts, deps) {
  const to = parseSpec(toSpec);
  const from = { fmt: h.source ? (h.source.kind === 'lib' ? 'jsonl' : h.source.kind) : 'mem', profile: 'entries', location: h.uri, label: h.uri };
  let dec = decodeHandle(h); let env = null;
  if (isLossyProfile(to.fmt, to.profile) && to.fmt !== 'eoql') env = deps.run(h, opts.scope || 'sources');
  else if (opts.scope) dec = decFromWorld(deps.run(h, opts.scope, { world: true }));
  return convertDecoded(dec, from, to, opts, { env });
}

// ---- dump / replay ------------------------------------------------------------------------------------------------------
export function dumpHandle(h, opts, deps) {
  const mode = opts.mode || 'verbatim';
  if (mode !== 'verbatim' && mode !== 'semantic') throw new EoqlError('E_USAGE', 'dump mode must be verbatim or semantic');
  const r = deps.run(h, opts.scope || 'sources', { world: true });
  const w = r.world;
  if (!w || !w.raw) throw new EoqlError('E_EXPORT', 'a dump scope must be a raw world');
  const items = w.core.items().map((x) => ({ e: x.e, file: x.file }));
  if (mode === 'verbatim') {
    const d = dumpVerbatim(items);
    if (d.refused.length) throw new EoqlError('E_NOT_REPRESENTABLE', `${d.refused.length} entries cannot be written as a verbatim statement`, { detail: { refused: d.refused } });
    return d.text;
  }
  return dumpSemantic(items).text;
}
export function dumpWithInfo(h, opts, deps) {
  const mode = opts.mode || 'verbatim';
  const r = deps.run(h, opts.scope || 'sources', { world: true });
  const items = r.world.core.items().map((x) => ({ e: x.e, file: x.file }));
  const text = dumpHandle(h, opts, deps);
  return { text, entries: items.length, ids_sha256: idsDigest(items.map((x) => x.e.id)), mode };
}

let _run = null;
export function setRunner(fn) { _run = fn; }
export function replayInto(h, text, opts = {}) {
  if (typeof text !== 'string') throw new EoqlError('E_USAGE', 'replay needs script text');
  const stmts = splitStatements(text);
  const chunks = chunkStatements(stmts);
  const labels = new Map();
  const out = { v: VERSION.receipt, mode: 'write', writer: h.writer, target: h.uri, statements: 0, appended: [], noops: [], merged: [], labels: {}, warnings: [], stopped_at: null, cost: null };
  let base = 0;
  for (const chunk of chunks) {
    let r;
    try { r = _run(h, chunk, { ...opts, write: true, labels }); } catch (e) {
      const err = wrap(e); err.detail = { ...(err.detail || {}), stopped_at: base + (err.detail && err.detail.stopped_at !== undefined ? err.detail.stopped_at : 0), replay_statements_done: base };
      throw err;
    }
    const shift = (a) => a.map((x) => ({ ...x, stmt: (x.stmt === undefined ? 0 : x.stmt) + base }));
    out.appended.push(...shift(r.appended)); out.noops.push(...shift(r.noops)); out.merged.push(...shift(r.merged)); out.warnings.push(...shift(r.warnings));
    out.statements += r.statements; base += r.statements; out.cost = r.cost; Object.assign(out.labels, r.labels);
  }
  return out;
}

// ---- foreign import and verbatim import -----------------------------------------------------------------------------------
const hexOk = /^[0-9a-f]{64}$/;
function coerce(v, type) {
  if (type === undefined || type === 'text') return v === null || v === undefined ? null : typeof v === 'string' ? v : v;
  if (v === null || v === undefined || v === '') return null;
  switch (type) {
    case 'integer': { if (typeof v === 'number' && Number.isInteger(v)) return v; if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) { const n = Number(v); if (Number.isSafeInteger(n)) return n; } throw new Error('not an integer'); }
    case 'real': { const n = typeof v === 'number' ? v : Number(v); if (typeof v === 'string' && v.trim() === '') throw new Error('empty real'); if (!Number.isFinite(n)) throw new Error('not a finite number'); return n; }
    case 'boolean': { if (typeof v === 'boolean') return v; const s = String(v).trim().toLowerCase(); if (['true', '1'].includes(s)) return true; if (['false', '0'].includes(s)) return false; throw new Error('not a boolean'); }
    case 'json': { if (typeof v !== 'string') return v; return JSON.parse(v); }
    default: throw new Error(`unknown type ${type}`);
  }
}
const jsonSafe = (v) => { try { canonical(v); return true; } catch (e) { return false; } };

export function importFrom(fromSpec, h, opts, deps) {
  if (!h || h.mode !== 'write') throw new EoqlError('E_READONLY', 'import needs a handle opened with mode "write"');
  if (!h.source.writable && !h.source.mergeOnly) throw new EoqlError(h.source.kind === 'sqlite' ? 'E_NOT_PRIMARY' : 'E_READONLY', `${h.source.kind}: sources do not accept imports`);
  const from = parseSpec(fromSpec);
  from.label = `${from.fmt}${from.profile !== DEFAULT_PROFILE[from.fmt] ? ':' + from.profile : ''}:${from.location}`;
  const dec = decodeLocation(from);
  const inputBytes = (() => { try { return fs.readFileSync(from.location); } catch (e) { return null; } })();
  const ix = new Interp(h, {});
  try {
    if (!dec.foreign) return importEntries(h, ix, dec, from, opts);
    return importForeign(h, ix, dec.foreign, from, inputBytes, opts);
  } finally { ix.end(); }
}
function receiptOf(h) { return { v: VERSION.receipt, mode: 'write', writer: h.writer, target: h.uri, statements: 1, appended: [], noops: [], merged: [], labels: {}, warnings: [], stopped_at: null, cost: null }; }

function importEntries(h, ix, dec, from, opts) {
  refuseTampered(dec, opts);
  const invIn = inventory(dec);
  const items = distinctItems(dec);
  // what the merge produces: distinct entries as canonical lines in this writer's own lane (4.1, 4.6)
  const asMerged = mkDecoded('merged', 'entries');
  for (const it of items) addLine(asMerged, h.writer, entryLine(it.e, canonical(it.e)));
  const invOut = inventory(asMerged);
  const losses = measureLosses(invIn, invOut);
  const manifest = mkManifest({ from: from.label, to: h.uri, profileIn: from.profile, profileOut: 'entries', invIn, invOut, losses, refused: [], rejected: [], declared: declaredPossible(from.fmt, from.profile, h.source.kind === 'lazy' ? 'lazy' : h.source.kind === 'blocks' ? 'blocks' : 'jsonl', 'entries') });
  applyEvidence(manifest, dec);
  if (losses.length && !opts.acceptLoss) throw new EoqlError('E_LOSSY', `import loses ${losses.map((l) => l.attribute).join(', ')}; pass acceptLoss to proceed`, { detail: { manifest } });
  const receipt = receiptOf(h);
  const res = mergeEntries(h, ix, items.map((x) => x.e), null);
  for (const r of res) receipt.merged.push({ stmt: 0, id: r.id, status: r.status });
  if (opts.receiptKind) {
    const ids = items.map((x) => x.e.id);
    const kindName = opts.receiptKind;
    const d = ix.ground.decl(kindName, null, 'latest');
    if (!d) throw new EoqlError('E_UNDECLARED_KIND', `receipt kind ${kindName} is not declared`);
    const body = { format: from.fmt, input_sha256: sha256(fs.readFileSync(from.location)), entries: ids.length, ids_sha256: idsDigest(ids) };
    const w = weaveOne(h, { cell: d.cell, kind: kindName, addr: `import:${body.input_sha256}`, body, of: [], basis: { importer: VERSION.import } });
    receipt.appended.push({ stmt: 0, id: w.entry.id, kind: kindName, cell: d.cell, addr: w.entry.addr, by: w.entry.by, at: w.entry.at, of: [] });
  }
  return { receipt, manifest };
}

function addrOf(rec, opts, hash) {
  if (opts.addrCol) { const v = rec[opts.addrCol]; if (v === undefined || v === null || String(v) === '') throw new Error(`address column ${opts.addrCol} is empty`); return String(v); }
  if (opts.addrTemplate) {
    let bad = null;
    const s = opts.addrTemplate.replace(/\{([^{}]+)\}/g, (m, c) => { const v = rec[c]; if (v === undefined || v === null || String(v) === '') bad = c; return v === undefined || v === null ? '' : String(v); });
    if (bad) throw new Error(`template column ${bad} is empty`);
    return s;
  }
  return 'import:' + hash;
}

function importForeign(h, ix, foreign, from, bytes, opts) {
  const kind = opts.kind;
  if (!kind) throw new EoqlError('E_UNDECLARED_KIND', 'a foreign import needs a declared kind (--kind)');
  const d = ix.ground.decl(kind, null, 'latest');
  if (!d) throw new EoqlError('E_UNDECLARED_KIND', `kind ${kind} is not declared in the target`, { detail: { hint: 'WRITE DEF(declare: "<kind>"; like: "<a declared kind at the cell you want>")' } });
  if (!bytes) throw new EoqlError('E_BASIS_REQUIRED', 'cannot hash the input; nothing was written');
  const inputSha = sha256(bytes);
  const inputName = path.basename(from.location);
  let records = []; let colsAll = null;
  if (foreign.format === 'sqldump') {
    const want = opts.table;
    for (const ins of foreign.inserts) {
      if (want && ins.table !== want) continue;
      const cols = ins.columns || (foreign.tables.get(ins.table) && foreign.tables.get(ins.table).columns);
      for (const r of ins.rows) {
        if (!cols || cols.length !== r.length) { records.push({ _bad: `row has ${r.length} values for ${cols ? cols.length : 0} named columns`, table: ins.table }); continue; }
        records.push({ rec: Object.fromEntries(cols.map((c, i) => [c, r[i]])), table: ins.table, columns: cols });
      }
    }
  } else {
    colsAll = foreign.columns || null;
    records = foreign.records.map((r) => (isObj(r) ? { rec: r, columns: colsAll || Object.keys(r) } : { _bad: 'record is not an object' }));
  }
  const receipt = receiptOf(h); const rejected = []; const present = new Set();
  if (opts.skipPresent && h.source.readAll) { ix.meter.cache.clear(); for (const it of h.source.readAll().items) { const b = it.e.basis; if (b && b.importer === VERSION.import && b.input_sha256 === inputSha) present.add(b.record + '|' + (b.table || '')); } }
  const types = opts.types || {};
  const extraBasis = isObj(opts.basis) ? opts.basis : {};
  records.forEach((r, i) => {
    const idx = i + 1;
    if (r._bad) { rejected.push({ record: idx, reason: r._bad }); return; }
    try {
      const body = {};
      for (const [k, v] of Object.entries(r.rec)) body[k] = coerce(v, foreign.format === 'csv' || types[k] ? types[k] : undefined);
      if (!jsonSafe(body)) throw new Error('record has values that are not JSON');
      const recHash = sha256(canonical(r.rec));
      const addr = addrOf(r.rec, opts, recHash);
      const basis = { ...extraBasis, importer: VERSION.import, format: from.fmt === 'sqldump' || foreign.format === 'sqldump' ? 'sqldump' : foreign.format, input_sha256: inputSha, input_name: inputName, record: idx, columns: r.columns };
      if (r.table !== undefined) basis.table = r.table;
      if (present.has(idx + '|' + (r.table || ''))) { receipt.noops.push({ stmt: idx - 1, id: null, reason: 'skip-present' }); return; }
      const w = weaveOne(h, { cell: d.cell, kind, addr, body, of: [], basis });
      h.source._sig = null; h.source._data = null; h.source._d = null;
      if (w.noop) receipt.noops.push({ stmt: idx - 1, id: w.entry.id, reason: 'identical-weft' });
      else receipt.appended.push({ stmt: idx - 1, id: w.entry.id, kind, cell: d.cell, addr, by: w.entry.by, at: w.entry.at, of: [], ...(w.shard ? { shard: w.shard } : {}) });
    } catch (e) {
      if (e instanceof EoqlError) throw e;
      rejected.push({ record: idx, reason: String(e && e.message ? e.message : e) });
    }
  });
  receipt.statements = records.length;
  if (opts.receiptKind) {
    const rd = ix.ground.decl(opts.receiptKind, null, 'latest');
    if (!rd) throw new EoqlError('E_UNDECLARED_KIND', `receipt kind ${opts.receiptKind} is not declared`);
    const ids = receipt.appended.map((a) => a.id).concat(receipt.noops.map((a) => a.id).filter(Boolean));
    const body = { format: foreign.format, input_sha256: inputSha, entries: ids.length, ids_sha256: idsDigest(ids) };
    const w = weaveOne(h, { cell: rd.cell, kind: opts.receiptKind, addr: `import:${inputSha}`, body, of: [], basis: { importer: VERSION.import } });
    receipt.appended.push({ stmt: records.length, id: w.entry.id, kind: opts.receiptKind, cell: rd.cell, addr: w.entry.addr, by: w.entry.by, at: w.entry.at, of: [] });
  }
  const accounted = receipt.appended.filter((a) => a.kind === kind).length + receipt.noops.length + rejected.length;
  receipt.records_in = records.length; receipt.rejected = rejected;
  const invIn = emptyInventory();
  const manifest = { v: VERSION.manifest, from: from.label, to: h.uri, profile_in: 'foreign', profile_out: 'entries', entries_in: records.length, entries_out: receipt.appended.filter((a) => a.kind === kind).length + receipt.noops.length, ids_preserved: false, ids_sha256_in: invIn.ids_sha256, ids_sha256_out: invIn.ids_sha256, lossless_ids: false, lossless_bytes: false, losses: [], refused: [], rejected, declared_possible: [], records_in: records.length, accounted };
  return { receipt, manifest };
}

export { hexOk };
