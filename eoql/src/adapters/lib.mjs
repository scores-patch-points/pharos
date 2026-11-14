// adapters/lib.mjs: `lib:<dir>` (a flat pharos), `jsonl:<file>` (one lane) and `mem:` (an entry array).
import fs from 'node:fs';
import path from 'node:path';
import { Source } from '../source.mjs';
import { EoqlError } from '../errors.mjs';
import { scanText } from '../jsonl.mjs';
import { canonical } from '../util.mjs';

function buildIndex(items) {
  const byId = new Map(); const byAddr = new Map();
  for (const it of items) { byId.set(it.e.id, it.e); let a = byAddr.get(it.e.addr); if (!a) byAddr.set(it.e.addr, a = []); a.push(it); }
  return { byId, byAddr };
}

export class LibSource extends Source {
  constructor(uri, target, single) {
    super(single ? 'jsonl' : 'lib', uri);
    this.target = path.resolve(target);
    this.single = !!single;
    this.primary = !single; this.writable = !single;
    this._sig = null; this._data = null;
    if (!fs.existsSync(this.target)) throw new EoqlError('E_SOURCE', `${single ? 'file' : 'directory'} does not exist: ${target}`);
    const st = fs.statSync(this.target);
    if (single && !st.isFile()) throw new EoqlError('E_SOURCE', `not a file: ${target}`);
    if (!single && !st.isDirectory()) throw new EoqlError('E_SOURCE', `not a directory: ${target}`);
  }
  _files() {
    if (this.single) return [{ name: path.basename(this.target).replace(/\.jsonl$/, ''), abs: this.target }];
    return fs.readdirSync(this.target).filter((f) => f.endsWith('.jsonl')).sort().map((f) => ({ name: f.slice(0, -6), abs: path.join(this.target, f) }));
  }
  _load() {
    const files = this._files();
    const stats = files.map((f) => { try { const s = fs.statSync(f.abs); return { ...f, size: s.size, key: `${s.size}:${s.mtimeMs}:${s.ino}` }; } catch (e) { return null; } }).filter(Boolean);
    const sig = stats.map((s) => `${s.name}:${s.key}`).join('|');
    if (this._data && sig === this._sig) return this._data;
    const items = []; const seen = new Set(); const corrupt = []; const torn = []; let records = 0, bytes = 0;
    const fileNames = [];
    for (const f of stats) {
      let buf;
      try { buf = fs.readFileSync(f.abs); } catch (e) { continue; }
      bytes += buf.length; fileNames.push(f.name);
      const { lines } = scanText(buf.toString('utf8'));
      for (const l of lines) {
        records++;
        if (l.e) { if (!seen.has(l.e.id)) { seen.add(l.e.id); items.push({ e: l.e, file: f.name }); } } else if (l.torn) torn.push({ file: f.name, line: l.n, reason: l.reason }); else corrupt.push({ file: f.name, line: l.n, reason: l.reason });
      }
    }
    this._sig = sig;
    this._data = { items, health: { corrupt, torn, files: fileNames, extra: [] }, bytes, records, ...buildIndex(items) };
    return this._data;
  }
  readAll() {
    const m = this.m;
    let hit = m.cache.get('all');
    if (!hit) {
      const d = this._load();
      m.charge(d.bytes, d.records); m.deliver(d.items);
      hit = { items: d.items, health: d.health };
      m.cache.set('all', hit);
    }
    return hit;
  }
  region(addr, kinds) {
    const all = this.readAll(); const d = this._data;
    const arr = d.byAddr.get(addr) || [];
    return { items: arr.filter((it) => !kinds || kinds.includes(it.e.kind) || it.e.kind === 'retract'), health: all.health, regional: false };
  }
  byId(id) { this.readAll(); return this._data.byId.get(id); }
  files() { return this._load().health.files; }
}

export class MemSource extends Source {
  constructor(entries, opts = {}) {
    super('mem', 'mem:');
    const items = []; const seen = new Set();
    for (const x of entries) {
      const e = x && x.e ? x.e : x; const file = x && x.e ? (x.file ?? e.by) : (x && x.by);
      if (!e || seen.has(e.id)) continue;
      seen.add(e.id); items.push({ e, file });
    }
    this.items = items;
    this.health = opts.health || { corrupt: [], torn: [], files: [...new Set(items.map((i) => i.file))].sort(), extra: [] };
    this._idx = buildIndex(items);
    let bytes = 0; for (const it of items) bytes += canonical(it.e).length + 1;
    this.bytes = bytes;
  }
  readAll() {
    const m = this.m; let hit = m.cache.get('all');
    if (!hit) { m.charge(this.bytes, this.items.length); m.deliver(this.items); hit = { items: this.items, health: this.health }; m.cache.set('all', hit); }
    return hit;
  }
  region(addr, kinds) { this.readAll(); return { items: (this._idx.byAddr.get(addr) || []).filter((it) => !kinds || kinds.includes(it.e.kind) || it.e.kind === 'retract'), health: this.health, regional: false }; }
  byId(id) { this.readAll(); return this._idx.byId.get(id); }
}
