// adapters/lazy.mjs: `lazy:<root>` (the pharos-lazy placed layout). Region reads open only the shards an address needs.
import fs from 'node:fs';
import path from 'node:path';
import { Source } from '../source.mjs';
import { EoqlError } from '../errors.mjs';
import { placed, placedCore } from '../vendor.mjs';
import { invalidReason } from '../jsonl.mjs';

const { Reader } = placed;
const { quickAddr } = placedCore;

function listWriters(root) {
  try { return fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name).sort(); } catch (e) { return []; }
}
function listShards(root) {
  const out = [];
  for (const w of listWriters(root)) {
    let fs_; try { fs_ = fs.readdirSync(path.join(root, w)); } catch (e) { continue; }
    for (const f of fs_.sort()) if (f.endsWith('.jsonl')) out.push(`${w}/${f}`);
  }
  return out;
}

export class LazySource extends Source {
  constructor(uri, root) {
    super('lazy', uri);
    this.root = path.resolve(root);
    this.canResolve = false; this.writable = true; this.primary = true;
    if (!fs.existsSync(this.root) || !fs.statSync(this.root).isDirectory()) throw new EoqlError('E_SOURCE', `placed root does not exist: ${root}`);
    if (!fs.existsSync(path.join(this.root, 'PLACEMENT.json'))) throw new EoqlError('E_SOURCE', `not a placed root (no PLACEMENT.json): ${root}`);
  }
  hasRegions() { return true; }
  _nonAddress() {
    if (this._na === undefined || this._naSig !== listShards(this.root).length) {
      const shards = listShards(this.root); this._naSig = shards.length;
      this._na = shards.some((s) => { const f = path.basename(s); return /^(w|t)_[0-9a-f]{8}/.test(f); });
    }
    return this._na;
  }
  // scan files; filter(line, preAddr) decides whether a line is parsed; accept(e) whether it is delivered
  _scan(rels, addrFilter, kinds) {
    const m = this.m;
    const items = []; const seen = new Set(); const corrupt = []; const torn = []; const filesRead = [];
    let bytes = 0, records = 0;
    for (const rel of rels) {
      const abs = path.join(this.root, rel); let buf;
      try { buf = fs.readFileSync(abs); } catch (e) { continue; }
      bytes += buf.length; filesRead.push(rel);
      const text = buf.toString('utf8');
      const parts = text.split('\n'); const endsNl = parts[parts.length - 1] === ''; if (endsNl) parts.pop();
      const writer = rel.split('/')[0];
      const isCorruptFile = path.basename(rel) === '_corrupt.jsonl';
      for (let i = 0; i < parts.length; i++) {
        const line = parts[i]; if (!line.trim()) continue;
        const isTorn = !endsNl && i === parts.length - 1;
        if (isCorruptFile) { corrupt.push({ file: rel, line: i + 1, reason: 'ingest-corrupt', addr: null }); continue; }
        const pre = quickAddr(line);
        if (addrFilter !== null && pre !== null && pre !== addrFilter) continue;
        records++;
        let e = null, reason;
        try { e = JSON.parse(line); reason = invalidReason(e); if (reason) e = null; } catch (err) { reason = 'unparseable JSON'; }
        if (!e) { (isTorn ? torn : corrupt).push({ file: rel, line: i + 1, reason, addr: pre }); continue; }
        if (addrFilter !== null && e.addr !== addrFilter) continue;
        if (kinds && !kinds.includes(e.kind) && e.kind !== 'retract') continue;
        if (!seen.has(e.id)) { seen.add(e.id); items.push({ e, file: writer }); }
      }
    }
    m.charge(bytes, records);
    return { items, health: { corrupt, torn, files: filesRead, extra: [] } };
  }
  readAll() {
    const m = this.m; let hit = m.cache.get('all');
    if (!hit) {
      hit = this._scan(listShards(this.root), null, null);
      // writer files in sorted order first: dedupe by id keeps the first
      m.deliver(hit.items); m.cache.set('all', hit);
    }
    return hit;
  }
  region(addr, kinds) {
    const m = this.m;
    const key = `r:${addr}:${kinds ? [...kinds].sort().join(',') : '*'}`;
    let hit = m.cache.get(key);
    if (hit) return hit;
    if (!kinds && this._nonAddress()) { // kinds placed elsewhere cannot be found without naming them
      const all = this.readAll();
      hit = { items: all.items.filter((it) => it.e.addr === addr), health: all.health, regional: false };
      m.cache.set(key, hit); return hit;
    }
    const reader = new Reader(this.root);
    let files = new Set();
    if (kinds) for (const k of kinds) for (const f of reader.plan({ addr, kind: k })) files.add(f);
    else for (const f of reader.plan({ addr })) files.add(f);
    m.charge(reader.stats.bytesRead, 0); // schema reads
    files = [...files].sort();
    const r = this._scan(files, addr, kinds ? kinds : null);
    m.deliver(r.items);
    hit = { ...r, regional: true, files };
    m.cache.set(key, hit);
    return hit;
  }
  // storage facts for the plan
  describeFiles(addr, kinds) {
    const reader = new Reader(this.root); const fl = new Set();
    if (kinds) for (const k of kinds) for (const f of reader.plan({ addr, kind: k })) fl.add(f); else for (const f of reader.plan({ addr })) fl.add(f);
    return [...fl].sort();
  }
}
