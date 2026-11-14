// adapters/sqlrel.mjs: `sqlrel:<file>`, a conformance-fixture source (SPEC-A1 3.3): an arbitrary SQLite file opened
// READ-ONLY whose tables and views are plain relations. `SEG(sources; table: "t")` is the only way in; there is no log.
import fs from 'node:fs';
import path from 'node:path';
import { Source } from '../source.mjs';
import { EoqlError } from '../errors.mjs';
import { RawWorld, Core, DEFAULT_FRAME } from '../world.mjs';
import { mkReal } from '../val.mjs';
import { sqliteModule } from './sqlite.mjs';

// SQLite's own affinity rules (3.1 of the SQLite datatype documentation): INT, CHAR/CLOB/TEXT, BLOB/none, REAL/FLOA/DOUB, else NUMERIC
export function sqliteAffinity(type) {
  const t = String(type || '').toUpperCase();
  if (t.includes('INT')) return 'INTEGER';
  if (t.includes('CHAR') || t.includes('CLOB') || t.includes('TEXT')) return 'TEXT';
  if (t === '' || t.includes('BLOB')) return '';
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return 'REAL';
  return 'NUMERIC';
}

export class SqlrelSource extends Source {
  constructor(uri, file) {
    super('sqlrel', uri);
    this.file = path.resolve(file); this.canResolve = false; this.writable = false; this.primary = false;
    if (!fs.existsSync(this.file) || !fs.statSync(this.file).isFile()) throw new EoqlError('E_SOURCE', `sqlite file does not exist: ${file}`);
    this._rel = null;
  }
  _db() {
    try { const { DatabaseSync } = sqliteModule(); return new DatabaseSync(this.file, { readOnly: true }); } catch (e) { throw new EoqlError('E_SOURCE', `cannot open sqlite file: ${e.message}`); }
  }
  // { name: {kind, columns:[{name, affinity}]} }
  relations() {
    if (this._rel) return this._rel;
    const db = this._db(); const out = {};
    try {
      const rows = db.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      for (const r of rows) {
        const cols = db.prepare(`PRAGMA table_info(${JSON.stringify(r.name)})`).all();
        out[r.name] = { kind: r.type, columns: cols.map((c) => ({ name: c.name, affinity: sqliteAffinity(c.type) })) };
      }
    } finally { db.close(); }
    this._rel = out; return out;
  }
  // rows in SQLite's own scan order; integer vs real storage classes preserved
  readTable(name) {
    const rel = this.relations()[name];
    if (!rel) throw new EoqlError('E_BIND_NAME', `no relation named ${name} in ${this.uri}`);
    const db = this._db();
    try {
      const st = db.prepare(`SELECT * FROM ${JSON.stringify(name)}`);
      st.setReadBigInts(true);
      const raw = st.all(); const rows = [];
      for (const r of raw) {
        const c = {};
        for (const col of rel.columns) {
          let v = r[col.name];
          if (typeof v === 'bigint') v = Number(v);
          else if (typeof v === 'number') v = mkReal(v);
          else if (v instanceof Uint8Array) v = Buffer.from(v).toString('hex');
          c[col.name] = v === undefined ? null : v;
        }
        rows.push(c);
      }
      this.m.charge(0, rows.length);
      return { columns: rel.columns, rows };
    } finally { db.close(); }
  }
  readAll() { return { items: [], health: { corrupt: [], torn: [], files: [], extra: [] } }; }
  describe() { return { kind: 'sqlrel', uri: this.uri }; }
}

class RelCore extends Core {
  constructor(ix, source) { super(ix, null); this._source = source; this._health = { corrupt: [], torn: [], files: [], extra: [] }; this._access = { method: 'table' }; this.isRel = true; }
  items() { throw new EoqlError('E_SOURCE_CAP', 'a sqlrel: source has no log: reach its relations with SEG(sources; table: "name")'); }
  fold() { return this.items(); }
}
export class RelRootWorld extends RawWorld {
  constructor(ix, source, frame) { super(ix, new RelCore(ix, source), frame || { ...DEFAULT_FRAME }); this.rel = source; }
  withFrame(patch) { return new RelRootWorld(this.ix, this.rel, { ...this.frame, ...patch }); }
}
