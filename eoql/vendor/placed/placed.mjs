// placed.mjs: a placement-indexed pharos. The layout is the index; schemas (ordinary entries) say how to read.
// Node built-ins only. See API.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PlacedError, canonical, entryId, isObj, isStrArr, invalid, quickId, RANK, BOOT,
  SCHEMA_KIND, SCHEMA_ADDR, RETRACT_KIND, isExemptKind,
} from './core.mjs';
import {
  sha256hex, addrHash, FIRST_WIDTH, WIDTH_STEP, MAX_WIDTH, DEFAULT_PLACEMENT, fixedShardName, classifyShard, kindTag, bucketOf,
  parsePlacement, cmpKey,
} from './placement.mjs';
import { Region, project } from './region.mjs';
import { Reader, listWriters, newStats } from './reader.mjs';

export { canonical, entryId, PlacedError, Reader, Region, project, newStats, listWriters };
export { addrHash, kindTag, bucketOf, classifyShard, fixedShardName, cmpKey, parsePlacement } from './placement.mjs';
export { normalizeRules, normalizeCut } from './region.mjs';

// ---- PLACEMENT.json: the one place the split limit lives -------------------------------------------------------
const PLACEMENT_FILE = 'PLACEMENT.json';
const FLUSH_BYTES = 8 * 1024 * 1024; // buffered-write memory bound for bulk and ingest (I/O only)

function createPlacement(rootAbs, splitLimit) {
  // The default is the value written when a root is created; every later reader and writer takes the file's value.
  const body = { v: 1, splitLimit: splitLimit ?? 65536 };
  const p = path.join(rootAbs, PLACEMENT_FILE);
  try { fs.writeFileSync(p, JSON.stringify(body, null, 2) + '\n', { flag: 'wx' }); return body; } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    return readPlacement(rootAbs);
  }
}

export function readPlacement(rootAbs) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(rootAbs, PLACEMENT_FILE), 'utf8')); } catch (err) { throw new PlacedError('NO_PLACEMENT', `${rootAbs} has no readable ${PLACEMENT_FILE}`); }
  if (!isObj(j) || j.v !== 1 || !Number.isInteger(j.splitLimit) || j.splitLimit < 1) throw new PlacedError('BAD_PLACEMENT', `${PLACEMENT_FILE} must be {v:1, splitLimit:<positive integer>}`);
  return j;
}

// ---- low-level append ---------------------------------------------------------------------------------------------
// Appends text (already newline-terminated) to a file, healing a torn last line first. Returns bytes written.
function appendFd(fd, size, text) {
  let prefix = '';
  if (size > 0) {
    const b = Buffer.allocUnsafe(1);
    fs.readSync(fd, b, 0, 1, size - 1);
    if (b[0] !== 10) prefix = '\n';
  }
  const buf = Buffer.from(prefix + text, 'utf8');
  fs.writeSync(fd, buf, 0, buf.length);
  return buf.length;
}

// ---- the writer handle -------------------------------------------------------------------------------------------
export function openRoot(root, opts = {}) {
  const rootAbs = path.resolve(root);
  fs.mkdirSync(rootAbs, { recursive: true });
  const placement = createPlacement(rootAbs, opts.splitLimit);
  const writer = opts.writer || `${os.hostname().split('.')[0]}-${process.pid}`;
  if (!/^[A-Za-z0-9._-]+$/.test(writer) || writer.startsWith('.')) throw new PlacedError('BAD_WRITER', `writer must match [A-Za-z0-9._-]+ and not start with '.': ${writer}`);
  if (opts.writerDir !== false) fs.mkdirSync(path.join(rootAbs, writer), { recursive: true });
  const h = {
    root: rootAbs, writer, by: writer, splitLimit: placement.splitLimit, placement,
    stats: { weaves: 0, bytesAppended: 0, emptyOf: 0 },
    full: new Set(), _reader: null,
    reader() { return this._reader || (this._reader = new Reader(this.root)); },
    advance() { return this.reader().advance(); },
    ask(addr, o) { return this.reader().ask(addr, o); },
    weave(input, o) { return weave(this, input, o); },
    bulk() { return new Bulk(this); },
    // add an entry this process just wrote to the regions it already holds (monotone; no disk read)
    _noteSchema(entry) { this._noteOwn(entry); },
    _noteOwn(entry) {
      const rd = this._reader;
      if (!rd) return;
      if (entry.kind === RETRACT_KIND) {
        for (const sub of rd.subs.values()) if (sub.type === 'region' && sub.addr === entry.addr) sub.offer(entry, rd.stats);
        return;
      }
      const keys = new Set([`r\u0000\u0000${entry.addr}`, `r\u0000${entry.kind}\u0000${entry.addr}`]);
      for (const key of keys) { const sub = rd.subs.get(key); if (sub) sub.offer(entry, rd.stats); }
    },
  };
  return h;
}

function placementFor(h, kind, windowName) {
  if (isExemptKind(kind)) return DEFAULT_PLACEMENT;
  const ch = h.reader().chooseSchema(kind, windowName);
  return ch && ch.placement ? ch.placement : DEFAULT_PLACEMENT;
}

function buildEntry(h, input, opts, ofResolved) {
  if (!isObj(input)) throw new PlacedError('BAD_ENTRY', 'weave needs an object');
  for (const k of Object.keys(input)) {
    if (k === 'v' || k === 'by' || k === 'id') throw new PlacedError('COMPUTED_FIELD', `${k} is computed by weave and cannot be supplied`);
    if (!['cell', 'kind', 'addr', 'body', 'of', 'basis', 'seen', 'at'].includes(k)) throw new PlacedError('UNKNOWN_FIELD', `unknown field ${k}`);
  }
  const { cell, kind, addr, body } = input;
  if (typeof cell !== 'string' || !RANK.has(cell)) throw new PlacedError('UNKNOWN_CELL', `unknown cell ${String(cell)}`);
  if (typeof kind !== 'string' || !kind) throw new PlacedError('BAD_ENTRY', 'kind must be a non-empty string');
  if (typeof addr !== 'string' || !addr) throw new PlacedError('BAD_ENTRY', 'addr must be a non-empty string');
  if (!('body' in input) || body === undefined) throw new PlacedError('BAD_ENTRY', 'body is required (use null for none)');
  const of = ofResolved ?? (input.of === undefined ? [] : input.of);
  const basis = input.basis === undefined ? {} : input.basis;
  const seen = input.seen === undefined ? [] : input.seen;
  if (!isStrArr(of)) throw new PlacedError('BAD_ENTRY', "of must be an array of ids (or the string 'heads')");
  if (!isStrArr(seen)) throw new PlacedError('BAD_ENTRY', 'seen must be an array of ids');
  if (!isObj(basis)) throw new PlacedError('BAD_ENTRY', 'basis must be an object');
  if (input.at !== undefined && (typeof input.at !== 'string' || !input.at)) throw new PlacedError('BAD_ENTRY', 'at must be a non-empty string');
  // One canonicalization of each part: the canonical entry is these pieces in sorted-key order, and the id is the hash
  // of the same pieces without the id member (identical to canonical()/entryId() of the frozen library).
  const ofS = [...new Set(of)].sort();
  const seenS = [...new Set(seen)].sort();
  const at = input.at ?? new Date().toISOString();
  const pre = '{"addr":' + JSON.stringify(addr) + ',"at":' + JSON.stringify(at) + ',"basis":' + canonical(basis) + ',"body":' + canonical(body)
    + ',"by":' + JSON.stringify(h.by) + ',"cell":' + JSON.stringify(cell);
  const post = ',"kind":' + JSON.stringify(kind) + ',"of":' + canonical(ofS) + ',"seen":' + canonical(seenS) + ',"v":1}';
  const id = sha256hex(pre + post);
  const entry = { v: 1, cell, kind, addr, body, of: ofS, basis, seen: seenS, by: h.by, at, id };
  return { entry, line: pre + ',"id":"' + id + '"' + post };
}

// weave(h, input, opts): append ONE entry to ONE shard. It never loads the log. The shard is chosen by the schema
// in force for the kind (folded once per process from schema:<kind>, then held), else by address.
//   input: { cell, kind, addr, body, of?, basis?, seen?, at? }   of may be the string 'heads' (read this address once)
//   opts:  { window }  the name of the schema window to place by (default: the latest schema by position)
export function weave(h, input, opts = {}) {
  let ofResolved;
  if (isObj(input) && input.of === 'heads') {
    ofResolved = [...h.reader().region(input.addr, input.kind).heads];
  }
  const { entry, line } = buildEntry(h, input, opts, ofResolved);
  const spec = placementFor(h, entry.kind, opts.window);
  const text = line + '\n';
  let rel;
  if (spec.type === 'address') rel = writeAddress(h, addrHash(entry.addr), text);
  else rel = writeFixed(h, fixedShardName(spec, entry.kind, entry.at), text);
  h.stats.weaves++;
  if (entry.of.length === 0) h.stats.emptyOf++;
  h._noteOwn(entry);
  Object.defineProperty(entry, 'shard', { value: rel, enumerable: false });
  return entry;
}

function writeAddress(h, hash, text) {
  for (let d = FIRST_WIDTH; d <= MAX_WIDTH; d += WIDTH_STEP) {
    const rel = `${h.writer}/${hash.slice(0, d)}.jsonl`;
    if (h.full.has(rel)) continue;
    const fd = fs.openSync(path.join(h.root, rel), 'a+');
    try {
      const size = fs.fstatSync(fd).size;
      if (size >= h.splitLimit && d < MAX_WIDTH) { h.full.add(rel); continue; }
      h.stats.bytesAppended += appendFd(fd, size, text);
      return rel;
    } finally { fs.closeSync(fd); }
  }
  throw new PlacedError('SPLIT_EXHAUSTED', 'address shard chain exhausted');
}

function writeFixed(h, name, text) {
  const rel = `${h.writer}/${name}`;
  const fd = fs.openSync(path.join(h.root, rel), 'a+');
  try { h.stats.bytesAppended += appendFd(fd, fs.fstatSync(fd).size, text); } finally { fs.closeSync(fd); }
  return rel;
}

// ---- bulk: the same placement, buffered ----------------------------------------------------------------------------
// bulk.weave(input) places exactly as weave does but buffers appends per shard until flush(). A schema entry flushes at
// once so that later entries of the kind are placed by it. Use it to load many entries; each weave() is one fsync-free
// append, bulk is the batched variant.
export class Bulk {
  constructor(h) { this.h = h; this.buf = new Map(); this.size = new Map(); this.pending = 0; this.dirs = new Set(); }

  _size(rel) {
    let s = this.size.get(rel);
    if (s === undefined) { const st = fs.statSync(path.join(this.h.root, rel), { throwIfNoEntry: false }); s = st ? st.size : 0; this.size.set(rel, s); }
    return s;
  }

  _target(writer, spec, entry) {
    if (spec.type !== 'address') return `${writer}/${fixedShardName(spec, entry.kind, entry.at)}`;
    const hash = addrHash(entry.addr);
    for (let d = FIRST_WIDTH; d <= MAX_WIDTH; d += WIDTH_STEP) {
      const rel = `${writer}/${hash.slice(0, d)}.jsonl`;
      if (this._size(rel) >= this.h.splitLimit && d < MAX_WIDTH) continue;
      return rel;
    }
    throw new PlacedError('SPLIT_EXHAUSTED', 'address shard chain exhausted');
  }

  // place a preformed entry line (verbatim) into the directory of `writer`
  putLine(writer, entry, line, windowName) {
    const spec = placementFor(this.h, entry.kind, windowName);
    const rel = this._target(writer, spec, entry);
    const text = line + '\n';
    let a = this.buf.get(rel);
    if (!a) { a = []; this.buf.set(rel, a); }
    a.push(text);
    const n = Buffer.byteLength(text);
    this.size.set(rel, this._size(rel) + n);
    this.pending += n;
    if (entry.kind === SCHEMA_KIND) { this.flush(); this.h._noteSchema(entry); }
    else if (this.pending >= FLUSH_BYTES) this.flush();
    return rel;
  }

  weave(input, opts = {}) {
    let ofResolved;
    if (isObj(input) && input.of === 'heads') { this.flush(); ofResolved = [...this.h.reader().region(input.addr, input.kind).heads]; }
    const { entry, line } = buildEntry(this.h, input, opts, ofResolved);
    this.putLine(this.h.writer, entry, line, opts.window);
    this.h.stats.weaves++;
    if (entry.of.length === 0) this.h.stats.emptyOf++;
    this.h._noteOwn(entry);
    return entry;
  }

  flush() {
    for (const [rel, lines] of this.buf) {
      const abs = path.join(this.h.root, rel);
      const dir = path.dirname(abs);
      if (!this.dirs.has(dir)) { fs.mkdirSync(dir, { recursive: true }); this.dirs.add(dir); }
      const fd = fs.openSync(abs, 'a+');
      try { this.h.stats.bytesAppended += appendFd(fd, fs.fstatSync(fd).size, lines.join('')); } finally { fs.closeSync(fd); }
    }
    this.buf.clear();
    this.pending = 0;
  }
}

// ---- fold: the whole log, one scan --------------------------------------------------------------------------------
class Heap {
  constructor(cmp) { this.a = []; this.cmp = cmp; }
  get size() { return this.a.length; }
  push(x) {
    const a = this.a; a.push(x);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (this.cmp(a[i], a[p]) >= 0) break; [a[i], a[p]] = [a[p], a[i]]; i = p; }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && this.cmp(a[l], a[m]) < 0) m = l;
        if (r < a.length && this.cmp(a[r], a[m]) < 0) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
}

const rankCmp = (a, b) => RANK.get(a.cell) - RANK.get(b.cell) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const PREDS = new WeakMap();
const preds = (e, entries) => {
  let p = PREDS.get(e);
  if (!p) { p = [...new Set([...e.seen, ...e.of])].filter((id) => entries.has(id)); PREDS.set(e, p); }
  return p;
};

// the frozen library's causal order (Kahn, ready set ordered by (cell rank, id)), with a heap
function causalOrder(entries) {
  const indeg = new Map(); const succ = new Map();
  for (const e of entries.values()) {
    const ps = preds(e, entries);
    indeg.set(e.id, ps.length);
    for (const p of ps) (succ.get(p) || succ.set(p, []).get(p)).push(e.id);
  }
  const ready = new Heap(rankCmp);
  for (const e of entries.values()) if (indeg.get(e.id) === 0) ready.push(e);
  const out = [];
  while (ready.size) {
    const e = ready.pop();
    out.push(e);
    for (const s of succ.get(e.id) || []) {
      indeg.set(s, indeg.get(s) - 1);
      if (indeg.get(s) === 0) ready.push(entries.get(s));
    }
  }
  return out;
}

function walkBack(entries, idx, from, lo, seen) {
  const st = [from];
  while (st.length) for (const p of preds(entries.get(st.pop()), entries)) if (!seen.has(p) && idx.get(p) >= lo) { seen.add(p); st.push(p); }
}

// the frozen library's conflict rule: per addr+cell group, the causally maximal live entries (ancestry through
// seen AND of, any address) with differing bodies
function frozenConflicts(entries, idx, live) {
  const groups = new Map();
  for (const e of live) {
    if (e.kind === 'frame') continue;
    const k = e.addr + '\u0000' + e.cell;
    (groups.get(k) || groups.set(k, []).get(k)).push(e);
  }
  const conflicts = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const body = new Map(g.map((e) => [e.id, canonical(e.body)]));
    if (g.every((e) => body.get(e.id) === body.get(g[0].id))) continue;
    const lo = idx.get(g[0].id);
    const seen = new Set(), heads = [];
    for (let n = g.length - 1; n >= 0; n--) {
      if (seen.has(g[n].id)) continue;
      heads.push(g[n]);
      walkBack(entries, idx, g[n].id, lo, seen);
    }
    for (let i = 0; i < heads.length; i++) for (let j = i + 1; j < heads.length; j++) {
      const [a, b] = heads[i].id < heads[j].id ? [heads[i], heads[j]] : [heads[j], heads[i]];
      if (body.get(a.id) !== body.get(b.id)) conflicts.push({ addr: a.addr, cell: a.cell, a: a.id, b: b.id, by: [a.by, b.by] });
    }
  }
  return conflicts;
}

function listShardFiles(rootAbs) {
  const out = [];
  for (const w of listWriters(rootAbs)) {
    let names = [];
    try { names = fs.readdirSync(path.join(rootAbs, w)).sort(); } catch (err) { /* gone */ }
    for (const n of names) if (n.endsWith('.jsonl')) out.push(`${w}/${n}`);
  }
  return out;
}

// fold(root, opts): scan every shard file once and return the permissive whole-log fold. It never throws on a
// violation, never writes. opts: { order: true } adds `order` (entry ids in the frozen causal order),
// { live: true } adds `live` (the live entries).
export function fold(root, opts = {}) {
  const rootAbs = path.resolve(root);
  const stats = newStats();
  const files = listShardFiles(rootAbs);
  const entries = new Map();
  const where = new Map();
  const corrupt = [];
  const torn = [];
  const writers = new Map();
  let duplicates = 0;
  for (const rel of files) {
    const buf = fs.readFileSync(path.join(rootAbs, rel));
    stats.bytesRead += buf.length; stats.filesOpened++;
    const parts = buf.toString('utf8').split('\n');
    const w = rel.split('/')[0];
    const wi = writers.get(w) || writers.set(w, { writer: w, files: 0, entries: 0 }).get(w);
    wi.files++;
    parts.forEach((line, i) => {
      if (!line.trim()) return;
      stats.linesScanned++;
      let e;
      stats.entriesParsed++;
      try { e = JSON.parse(line); } catch (err) {
        corrupt.push({ file: rel, line: i + 1, reason: 'unparseable JSON' });
        if (i === parts.length - 1) torn.push(rel);
        return;
      }
      const why = invalid(e);
      if (why) { corrupt.push({ file: rel, line: i + 1, reason: why }); return; }
      if (entries.has(e.id)) { duplicates++; return; }
      entries.set(e.id, e); where.set(e.id, rel); wi.entries++;
    });
  }
  stats.corruptLines = corrupt.length;
  const order = causalOrder(entries);
  const idx = new Map(order.map((e, i) => [e.id, i]));
  const referenced = new Set();
  let dangling = 0;
  const danglingOf = [], danglingSeen = [];
  for (const e of entries.values()) {
    const miss = e.of.filter((id) => !entries.has(id));
    const missSeen = e.seen.filter((id) => !entries.has(id));
    if (miss.length) danglingOf.push({ id: e.id, of: miss });
    if (missSeen.length) danglingSeen.push({ id: e.id, seen: missSeen });
    for (const id of [...e.seen, ...e.of]) { if (entries.has(id)) referenced.add(id); else dangling++; }
  }
  const frontier = order.filter((e) => !referenced.has(e.id)).map((e) => e.id).sort();
  const retracted = new Set();
  const retractions = [];
  for (let i = order.length - 1; i >= 0; i--) {
    const e = order[i];
    if (e.kind === RETRACT_KIND && !retracted.has(e.id)) {
      retractions.push({ id: e.id, of: e.of, by: e.by });
      for (const t of e.of) retracted.add(t);
    }
  }
  retractions.reverse();
  const live = order.filter((e) => e.kind !== RETRACT_KIND && !retracted.has(e.id));
  const conflicts = frozenConflicts(entries, idx, live);

  // A1: the superposition held per address, with conflict episodes (begin and end positions)
  const regions = new Map();
  for (const e of entries.values()) {
    let r = regions.get(e.addr);
    if (!r) { r = new Region(e.addr, null); regions.set(e.addr, r); }
    r.add(e);
  }
  const held = [];
  let blindCount = 0;
  const blindIds = [];
  const ordinal = new Map([...entries.values()].sort(cmpKey).map((e, i) => [e.id, i]));
  for (const r of regions.values()) {
    const v = project(r, [], {});
    if (v.conflicts.length) {
      held.push({
        addr: r.addr, heads: v.values.map((x) => x.id),
        conflicts: v.conflicts.map((c) => ({ ...c, beganOrdinal: ordinal.get(c.began.id), endedOrdinal: c.ended ? ordinal.get(c.ended.id) : null })),
      });
    }
    if (r.blindWrites > 0) {
      const sorted = [...r.entries.values(), ...r.retracts.values()].sort(cmpKey);
      for (let i = 1; i < sorted.length; i++) if (sorted[i].kind !== RETRACT_KIND && sorted[i].of.length === 0) { blindCount++; blindIds.push(sorted[i].id); }
    }
  }
  held.sort((a, b) => (a.addr < b.addr ? -1 : a.addr > b.addr ? 1 : 0));

  // violations that need the whole log
  const kinds = new Map();
  for (const e of order) {
    if (e.kind !== 'kind' || retracted.has(e.id) || !isObj(e.body) || typeof e.body.name !== 'string') continue;
    if (!kinds.has(e.body.name)) kinds.set(e.body.name, e.body.cell);
  }
  const undeclaredKind = [], kindCellMismatch = [], retractNoOf = [], misplaced = [];
  const frames = order.filter((e) => e.kind === 'frame' && !retracted.has(e.id)).length;
  // schema versions per kind, for the placement check
  const schemaOf = new Map();
  for (const e of order) {
    if (e.kind !== SCHEMA_KIND || !e.addr.startsWith(SCHEMA_ADDR)) continue;
    const k = e.addr.slice(SCHEMA_ADDR.length);
    const read = isObj(e.body) && isObj(e.body.read) ? e.body.read : null;
    const a = schemaOf.get(k) || schemaOf.set(k, []).get(k);
    a.push({ spec: read ? parsePlacement(read) : null, prior: read ? read.prior : undefined });
  }
  for (const e of order) {
    const decl = kinds.has(e.kind) ? kinds.get(e.kind) : Object.hasOwn(BOOT, e.kind) ? BOOT[e.kind] : undefined;
    if (decl === undefined) undeclaredKind.push({ id: e.id, kind: e.kind });
    else if (decl !== e.cell) kindCellMismatch.push({ id: e.id, kind: e.kind, cell: e.cell, declared: decl });
    if (e.kind === RETRACT_KIND && e.of.length === 0) retractNoOf.push(e.id);
    const rel = where.get(e.id);
    const c = classifyShard(rel.split('/')[1]);
    let ok = false;
    if (c) {
      const vs = isExemptKind(e.kind) ? [] : schemaOf.get(e.kind) || [];
      const specs = [];
      if (!vs.length || vs[0].prior !== 'none') specs.push(DEFAULT_PLACEMENT);
      for (const v of vs) if (v.spec) specs.push(v.spec);
      for (const s of specs) {
        if (s.type === 'address') { if (c.type === 'address' && addrHash(e.addr).startsWith(c.prefix)) ok = true; }
        else if (c.type === s.type && c.tag === kindTag(e.kind) && c.bucket === (s.unit ? bucketOf(e.at, s.unit) : null)) ok = true;
      }
      if (c.type === 'other') ok = true; // files like _corrupt.jsonl are not placements
    }
    if (!ok) misplaced.push({ id: e.id, file: rel, kind: e.kind });
  }
  const out = {
    entries: entries.size, liveCount: live.length, frontier, conflicts, retractions, corrupt, dangling,
    writers: [...writers.values()], held,
    violations: {
      undeclaredKind, kindCellMismatch, noFrame: frames === 0, frames, danglingOf, danglingSeen,
      blindWrites: { count: blindCount, ids: blindIds }, retractWithoutOf: retractNoOf, misplaced, duplicates, tornTails: torn,
    },
    files: files.length, stats,
  };
  if (opts.order) out.order = order.map((e) => e.id);
  if (opts.live) out.live = live;
  return out;
}

// ---- flatten, ingest, merge, manifest, describe -----------------------------------------------------------------
function readLines(abs) {
  const text = fs.readFileSync(abs, 'utf8');
  const parts = text.split('\n');
  const torn = parts[parts.length - 1] !== '';
  if (!torn) parts.pop(); else parts.pop();
  return { lines: parts.filter((l) => l.trim() !== ''), torn };
}

// flatten(root, dir): one `<writer>.jsonl` per writer directory, every complete line verbatim (shard files in name
// order). The frozen library opens the result. Refuses to overwrite an existing file. A torn last line is dropped
// and counted.
export function flatten(root, dir) {
  const rootAbs = path.resolve(root);
  const outAbs = path.resolve(dir);
  fs.mkdirSync(outAbs, { recursive: true });
  let lines = 0, tornTails = 0;
  const written = [];
  for (const w of listWriters(rootAbs)) {
    const names = fs.readdirSync(path.join(rootAbs, w)).filter((n) => n.endsWith('.jsonl')).sort();
    if (!names.length) continue;
    const parts = [];
    for (const n of names) {
      const { lines: ls, torn } = readLines(path.join(rootAbs, w, n));
      if (torn) tornTails++;
      for (const l of ls) parts.push(l);
    }
    if (!parts.length) continue;
    const target = path.join(outAbs, `${w}.jsonl`);
    fs.writeFileSync(target, parts.join('\n') + '\n', { flag: 'wx' });
    lines += parts.length; written.push(`${w}.jsonl`);
  }
  return { files: written, lines, tornTails };
}

// ingest(flatDir, root, opts): place an existing flat pharos. Every line is copied byte for byte into the shard the
// placement (and any schema entry met on the way, in file-name then line order) gives it; the writer directory is
// the source file's name. Lines that are not entries go verbatim to <writer>/_corrupt.jsonl.
export function ingest(flatDir, root, opts = {}) {
  const src = path.resolve(flatDir);
  const h = openRoot(root, { writer: '_ingest', writerDir: false, splitLimit: opts.splitLimit });
  const bulk = new Bulk(h);
  let entries = 0, nonEntries = 0;
  const files = fs.readdirSync(src).filter((f) => f.endsWith('.jsonl')).sort();
  for (const f of files) {
    const w = f.slice(0, -6);
    if (!/^[A-Za-z0-9._-]+$/.test(w) || w.startsWith('.')) throw new PlacedError('BAD_WRITER', `cannot use file name ${f} as a writer directory`);
    const { lines } = readLines(path.join(src, f));
    for (const line of lines) {
      let e;
      try { e = JSON.parse(line); } catch (err) { e = null; }
      if (!e || invalid(e)) {
        nonEntries++;
        const rel = `${w}/_corrupt.jsonl`;
        let a = bulk.buf.get(rel); if (!a) { a = []; bulk.buf.set(rel, a); }
        a.push(line + '\n'); bulk.pending += line.length + 1;
        continue;
      }
      bulk.putLine(w, e, line);
      entries++;
    }
  }
  bulk.flush();
  return { entries, nonEntries, files: files.length, splitLimit: h.splitLimit };
}

// manifest(root): sorted `<relative path>\t<id>` for every complete line; the comparison key for "same set, same placement".
export function manifest(root) {
  const rootAbs = path.resolve(root);
  const out = [];
  for (const rel of listShardFiles(rootAbs)) {
    const { lines } = readLines(path.join(rootAbs, rel));
    for (const l of lines) out.push(`${rel}\t${quickId(l) ?? 'noid:' + l}`);
  }
  return out.sort();
}

// merge(rootA, rootB): union of B into A. Each record is copied, verbatim, into the SAME relative placement it has in
// B; a writer directory A lacks is copied file by file; for one A already has, only ids A lacks (in that directory) are
// appended. Idempotent, commutative and associative as a set of (path, id) records. A's existing bytes never change.
export function merge(rootA, rootB) {
  const a = path.resolve(rootA), b = path.resolve(rootB);
  fs.mkdirSync(a, { recursive: true });
  if (!fs.existsSync(path.join(a, PLACEMENT_FILE))) {
    try { fs.copyFileSync(path.join(b, PLACEMENT_FILE), path.join(a, PLACEMENT_FILE), fs.constants.COPYFILE_EXCL); } catch (err) { createPlacement(a); }
  }
  const res = { added: 0, skipped: 0, filesCopied: 0, filesAppended: 0 };
  for (const w of listWriters(b)) {
    const dirA = path.join(a, w);
    const names = fs.readdirSync(path.join(b, w)).filter((n) => n.endsWith('.jsonl')).sort();
    if (!fs.existsSync(dirA)) {
      fs.mkdirSync(dirA, { recursive: true });
      for (const n of names) {
        const { lines, torn } = readLines(path.join(b, w, n));
        if (torn) { fs.writeFileSync(path.join(dirA, n), lines.length ? lines.join('\n') + '\n' : '', { flag: 'wx' }); }
        else fs.copyFileSync(path.join(b, w, n), path.join(dirA, n), fs.constants.COPYFILE_EXCL);
        res.filesCopied++; res.added += lines.length;
      }
      continue;
    }
    const have = new Set();
    for (const n of fs.readdirSync(dirA).filter((x) => x.endsWith('.jsonl'))) for (const l of readLines(path.join(dirA, n)).lines) have.add(quickId(l) ?? 'noid:' + l);
    for (const n of names) {
      const fresh = [];
      for (const l of readLines(path.join(b, w, n)).lines) {
        const id = quickId(l) ?? 'noid:' + l;
        if (have.has(id)) { res.skipped++; continue; }
        have.add(id); fresh.push(l);
      }
      if (!fresh.length) continue;
      const fd = fs.openSync(path.join(dirA, n), 'a+');
      try { appendFd(fd, fs.fstatSync(fd).size, fresh.join('\n') + '\n'); } finally { fs.closeSync(fd); }
      res.filesAppended++; res.added += fresh.length;
    }
  }
  return res;
}

// describe(root): what is on disk, from the filesystem alone. `other` lists anything that is not PLACEMENT.json or
// <writer>/<shard>.jsonl: a healthy root has none.
export function describe(root) {
  const rootAbs = path.resolve(root);
  const out = { root: rootAbs, placement: null, writers: [], files: 0, bytes: 0, byType: {}, other: [] };
  try { out.placement = readPlacement(rootAbs); } catch (err) { out.other.push('PLACEMENT.json missing or bad'); }
  for (const ent of fs.readdirSync(rootAbs, { withFileTypes: true })) {
    if (ent.isFile()) { if (ent.name !== PLACEMENT_FILE) out.other.push(ent.name); continue; }
    if (!ent.isDirectory()) { out.other.push(ent.name); continue; }
    const wi = { writer: ent.name, files: 0, bytes: 0 };
    for (const n of fs.readdirSync(path.join(rootAbs, ent.name))) {
      const st = fs.statSync(path.join(rootAbs, ent.name, n));
      const c = n.endsWith('.jsonl') ? classifyShard(n) : null;
      if (!c) { out.other.push(`${ent.name}/${n}`); continue; }
      wi.files++; wi.bytes += st.size; out.files++; out.bytes += st.size;
      out.byType[c.type] = (out.byType[c.type] || 0) + 1;
    }
    out.writers.push(wi);
  }
  return out;
}

// the shard files an ask would open (relative paths); the bound a test checks reads against
export function shardFiles(root, query) {
  return new Reader(root).plan(query);
}
