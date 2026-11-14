// adapters/sqlite.mjs: `sqlite:<file>`. Reads ONLY the entry columns of `entries`, recomputes every id (SPEC 6.3).
import fs from 'node:fs';
import path from 'node:path';
import { Source } from '../source.mjs';
import { EoqlError } from '../errors.mjs';
import { entryId } from '../util.mjs';

let DB = null;
export function sqliteModule() {
  if (!DB) { const ew = process.emitWarning; process.emitWarning = () => {}; try { DB = process.getBuiltinModule('node:sqlite'); } finally { process.emitWarning = ew; } }
  return DB;
}
export class SqliteSource extends Source {
  constructor(uri, file) {
    super('sqlite', uri);
    this.file = path.resolve(file);
    this.canResolve = true; this.writable = false; this.primary = false;
    if (!fs.existsSync(this.file) || !fs.statSync(this.file).isFile()) throw new EoqlError('E_SOURCE', `sqlite file does not exist: ${file}`);
    this._sig = null; this._d = null;
  }
  _load() {
    const st = fs.statSync(this.file);
    const sig = `${st.size}:${st.mtimeMs}:${st.ino}`;
    if (this._d && sig === this._sig) return this._d;
    let db;
    try { const { DatabaseSync } = sqliteModule(); db = new DatabaseSync(this.file, { readOnly: true }); } catch (e) { throw new EoqlError('E_SOURCE', `cannot open sqlite file: ${e.message}`); }
    const items = []; const byId = new Map(); const extra = []; const corrupt = [];
    let records = 0;
    try {
      const rows = db.prepare('SELECT pos, id, writer, cell, kind, addr, body_json, of_json, seen_json, basis_json, "by" AS by_, at, v FROM entries ORDER BY pos, id').all();
      for (const r of rows) {
        records++;
        let e;
        try {
          e = { v: Number(r.v), cell: r.cell, kind: r.kind, addr: r.addr, body: JSON.parse(r.body_json), of: JSON.parse(r.of_json), basis: JSON.parse(r.basis_json), seen: JSON.parse(r.seen_json), by: r.by_, at: r.at };
          const id = entryId(e);
          if (id !== r.id) extra.push({ reason: 'sqlite-id-mismatch', where: `pos ${r.pos}`, ids: [r.id] });
          e.id = id;
        } catch (err) { corrupt.push({ file: 'entries', line: Number(r.pos), reason: 'unparseable row' }); continue; }
        if (!byId.has(e.id)) { byId.set(e.id, e); items.push({ e, file: r.writer }); }
      }
    } catch (err) {
      throw new EoqlError('E_SOURCE', `not a pharos projection (no entries table): ${err.message}`);
    } finally { db.close(); }
    const ids = extra.flatMap((x) => x.ids);
    const merged = ids.length ? [{ reason: 'sqlite-id-mismatch', where: 'entries', ids: ids.sort() }] : [];
    this._sig = sig;
    this._d = { items, byId, health: { corrupt, torn: [], files: ['entries'], extra: merged }, bytes: st.size, records };
    return this._d;
  }
  readAll() {
    const m = this.m; let hit = m.cache.get('all');
    if (!hit) { const d = this._load(); m.charge(d.bytes, d.records); m.deliver(d.items); hit = { items: d.items, health: d.health }; m.cache.set('all', hit); }
    return hit;
  }
  byId(id) { this.readAll(); return this._d.byId.get(id); }
}

// ---- the projection writer (SPEC 6.3): tables entries, heads, conflicts, kinds, meta, k_<kind> and the 1.8 views -------
import { Fold } from '../fold.mjs';
import { catalogRows, catalogColumns, relationNames, FIXED } from '../catalog.mjs';
import { canonical } from '../util.mjs';
import { plain } from '../val.mjs';

const ENTRIES_DDL = 'CREATE TABLE entries(pos INTEGER, id TEXT PRIMARY KEY, writer TEXT, cell TEXT, kind TEXT, addr TEXT, body_json TEXT, of_json TEXT, seen_json TEXT, basis_json TEXT, "by" TEXT, at TEXT, v INTEGER, retracted INTEGER, retracted_by TEXT)';
export const PROJECTION_VIEWS = [
  'CREATE VIEW all_entries AS SELECT * FROM entries',
  "CREATE VIEW live_entries AS SELECT * FROM entries WHERE retracted = 0 AND kind <> 'retract'",
  'CREATE VIEW latest_causal AS SELECT h.addr AS addr, h.cell AS cell, h.id AS id FROM heads h JOIN entries e ON e.id = h.id WHERE e.pos = (SELECT MAX(e2.pos) FROM heads h2 JOIN entries e2 ON e2.id = h2.id WHERE h2.addr = h.addr AND h2.cell = h.cell)',
  'CREATE VIEW undeclared_entries AS SELECT * FROM entries WHERE kind NOT IN (SELECT name FROM kinds)',
];
const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const affSql = (a) => (a === 'INTEGER' ? 'INTEGER' : a === 'REAL' ? 'REAL' : a === 'NUMERIC' ? 'NUMERIC' : a === '' ? '' : 'TEXT');
const sqlv = (v) => { v = plain(v); if (v === null || v === undefined) return null; if (typeof v === 'boolean') return v ? 1 : 0; if (typeof v === 'object') return canonical(v); return v; };

// items: [{e, file}] (distinct). Writes a NEW file; the caller guarantees it does not exist.
export function writeProjection(file, items, opts = {}) {
  const { DatabaseSync } = sqliteModule();
  const fold = new Fold(items);
  const facts = { danglingCount: fold.dangling.size, corruptCount: 0, cutPos: null };
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA journal_mode = OFF');
    db.exec('BEGIN');
    db.exec(ENTRIES_DDL);
    const ins = (table, cols, rows) => {
      if (!rows.length) return;
      const st = db.prepare(`INSERT INTO ${q(table)}(${cols.map(q).join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
      for (const r of rows) st.run(...cols.map((c) => sqlv(r.c[c])));
    };
    const mk = (name, cols) => `CREATE TABLE ${q(name)}(${cols.map((c) => `${q(c.name)} ${affSql(c.affinity)}`.trim()).join(', ')})`;
    const nm = (n) => FIXED[n].map(([name, affinity]) => ({ name, affinity }));
    const entriesCols = nm('entries').map((c) => c.name);
    ins('entries', entriesCols, catalogRows(fold, 'entries', facts));
    for (const t of ['heads', 'conflicts', 'kinds', 'meta']) { db.exec(mk(t, nm(t))); ins(t, nm(t).map((c) => c.name), catalogRows(fold, t, facts)); }
    const rel = relationNames(fold);
    for (const [tname] of rel.k) {
      const cols = catalogColumns(fold, tname);
      if (!cols) continue;
      db.exec(mk(tname, cols)); ins(tname, cols.map((c) => c.name), catalogRows(fold, tname, facts) || []);
    }
    const storage = [['source_files', canonical([...new Set(items.map((i) => i.file))].sort())], ['projection', 'eoql-sqlite/1']];
    const mi = db.prepare('INSERT INTO meta(key, value) VALUES (?, ?)');
    for (const [k, v] of storage) mi.run(k, v);
    for (const v of PROJECTION_VIEWS) db.exec(v);
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch (x) { /* none */ } throw e; } finally { db.close(); }
  void opts;
}
