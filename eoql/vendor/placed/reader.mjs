// reader.mjs: the lazy reader. It holds only in-memory state: per-file cursors (offset and inode), the regions it
// has been asked about, and the schema regions those asks needed. Nothing is written, nothing is stored.
import fs from 'node:fs';
import path from 'node:path';
import {
  PlacedError, SCHEMA_KIND, SCHEMA_ADDR, RETRACT_KIND, isExemptKind, isObj, invalid, quickAddr,
} from './core.mjs';
import {
  addrHash, addrShardName, FIRST_WIDTH, WIDTH_STEP, MAX_WIDTH, kindTag, bucketOf, parsePlacement,
  DEFAULT_PLACEMENT, classifyShard, cmpKey,
} from './placement.mjs';
import { Region, project, normalizeRules, retractedIds } from './region.mjs';

const READ_CHUNK = 16 * 1024 * 1024; // I/O buffer size only; it bounds memory, not what is read

export const newStats = () => ({
  bytesRead: 0, entriesParsed: 0, linesScanned: 0, filesOpened: 0, corruptLines: 0,
  regionsMaterialized: 0, regionsRecomputed: 0, blindWrites: 0, advances: 0, duplicates: 0, schemaBytes: 0,
});

// Reads [from, end) of an open file in chunks, handing complete lines (text without the final newline) to fn.
// Returns the number of bytes consumed (up to and including the last newline); a torn tail is not consumed.
export function scanFd(stats, fd, from, end, fn) {
  let pos = from;
  let consumed = 0;
  let carry = null;
  while (pos < end) {
    const n = Math.min(READ_CHUNK, end - pos);
    const buf = Buffer.allocUnsafe(n);
    const got = fs.readSync(fd, buf, 0, n, pos);
    if (got <= 0) break;
    stats.bytesRead += got;
    pos += got;
    let data = got === n ? buf : buf.subarray(0, got);
    if (carry) { data = Buffer.concat([carry, data]); carry = null; }
    const last = data.lastIndexOf(10);
    if (last < 0) { carry = data; continue; }
    fn(data.toString('utf8', 0, last));
    consumed += last + 1;
    carry = last + 1 < data.length ? data.subarray(last + 1) : null;
  }
  return consumed;
}

export function listWriters(root) {
  let ents;
  try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch (err) { return []; }
  return ents.filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name).sort();
}

export class Reader {
  constructor(root) {
    this.root = path.resolve(root);
    this.stats = newStats();
    this.files = new Map();    // rel path -> { rel, abs, off, ino, lineNo, subs:Set }
    this.subs = new Map();     // key -> sub  (region subs and stream subs)
    this._schemaCache = new Map();
    this.lastAdvance = null;
  }

  resetStats() { this.stats = newStats(); }

  // ---- files, planning -------------------------------------------------------------------------------------
  _writers(only) {
    const all = listWriters(this.root);
    return only === undefined ? all : all.filter((w) => w === only);
  }

  // Schema versions for a kind: every schema entry ever written at schema:<kind>, held (a superposition of windows).
  // Reading it is one addressable read, done once per reader and then advanced like any region.
  _schemaSub(kind) { return this._regionSub(SCHEMA_ADDR + kind, SCHEMA_KIND); }

  schemaVersions(kind) {
    const sub = this._schemaSub(kind);
    const r = sub.region;
    const c = this._schemaCache.get(kind);
    if (c && c.version === r.version) return c.value;
    const gone = retractedIds(r);
    const heads = new Set(r.heads);
    const list = [...r.entries.values()].sort(cmpKey).map((e) => {
      const read = isObj(e.body) && isObj(e.body.read) ? e.body.read : null;
      const w = read ? read.window : undefined;
      return {
        id: e.id, at: e.at, by: e.by, read,
        placement: read ? parsePlacement(read) : null,
        window: typeof w === 'string' ? w : isObj(w) && typeof w.name === 'string' ? w.name : null,
        windowDef: typeof w === 'string' ? { name: w } : isObj(w) ? w : null,
        collapse: read ? read.collapse : undefined,
        prior: read ? read.prior : undefined,
        retracted: gone.has(e.id),
        head: heads.has(e.id),
      };
    });
    this._schemaCache.set(kind, { version: r.version, value: list });
    return list;
  }

  // The schema version that governs a new write or a default read: a live head, by name if a window is named,
  // else the latest by position. Returns null when the kind has no schema (the default applies).
  chooseSchema(kind, windowName) {
    const live = this.schemaVersions(kind).filter((v) => v.head && !v.retracted);
    if (windowName !== undefined && windowName !== null) {
      const named = live.filter((v) => v.window === windowName);
      if (!named.length) throw new PlacedError('NO_SUCH_WINDOW', `kind ${kind} has no schema window named ${windowName}`, { windows: live.map((v) => v.window).filter(Boolean) });
      return named[named.length - 1];
    }
    return live.length ? live[live.length - 1] : null;
  }

  // The placement specs an entry of this kind may have been written under: the default (unless the first
  // schema declares read.prior = 'none') plus the placement of every schema version ever written.
  specsFor(kind) {
    if (kind === null || isExemptKind(kind)) return [DEFAULT_PLACEMENT];
    const vs = this.schemaVersions(kind);
    const out = [];
    const seen = new Set();
    const add = (s) => { const k = JSON.stringify(s); if (!seen.has(k)) { seen.add(k); out.push(s); } };
    const first = vs[0];
    if (!first || first.prior !== 'none') add(DEFAULT_PLACEMENT);
    for (const v of vs) if (v.placement) add(v.placement);
    return out;
  }

  // The shard files a query has to open, as paths relative to the root.
  //   q.addr        an address (region reads); q.kind its kind filter (retractions are always included)
  //   q.kind        without addr: a stream over that kind
  //   q.writer      only that writer's directory
  //   q.range       { from, to } ISO strings, either may be undefined
  plan(q) {
    const kinds = q.addr !== undefined ? (q.kind ? [q.kind, RETRACT_KIND] : [null]) : (q.kind ? [q.kind] : [null]);
    const writers = this._writers(q.writer);
    const out = [];
    const seen = new Set();
    const push = (rel) => { if (!seen.has(rel)) { seen.add(rel); out.push(rel); } };
    const dirs = new Map();
    const dir = (w) => { let d = dirs.get(w); if (!d) { try { d = fs.readdirSync(path.join(this.root, w)); } catch (e) { d = []; } dirs.set(w, d); } return d; };
    for (const kind of kinds) {
      for (const spec of this.specsFor(kind)) {
        if (spec.type === 'address') {
          if (q.addr !== undefined) {
            const h = addrHash(q.addr);
            for (const w of writers) {
              for (let d = FIRST_WIDTH; d <= MAX_WIDTH; d += WIDTH_STEP) {
                const rel = `${w}/${addrShardName(h, d)}.jsonl`;
                if (!fs.existsSync(path.join(this.root, rel))) break;
                push(rel);
              }
            }
          } else {
            for (const w of writers) for (const n of dir(w)) { const c = classifyShard(n); if (c && c.type === 'address') push(`${w}/${n}`); }
          }
        } else if (kind !== null) {
          const tag = kindTag(kind);
          const lo = q.range && q.range.from !== undefined && spec.unit ? bucketOf(q.range.from, spec.unit) : null;
          const hi = q.range && q.range.to !== undefined && spec.unit ? bucketOf(q.range.to, spec.unit) : null;
          for (const w of writers) {
            for (const n of dir(w)) {
              const c = classifyShard(n);
              if (!c || c.type !== spec.type || c.tag !== tag) continue;
              if (c.bucket !== null && c.bucket !== 'x') {
                if (lo !== null && lo !== 'x' && c.bucket < lo) continue;
                if (hi !== null && hi !== 'x' && c.bucket > hi) continue;
              }
              push(`${w}/${n}`);
            }
          }
        }
      }
    }
    return out;
  }

  // ---- subscriptions: a sub is fed every line appended to the files it is attached to ----------------------------
  _file(rel) {
    let F = this.files.get(rel);
    if (!F) { F = { rel, abs: path.join(this.root, rel), off: 0, ino: null, lineNo: 0, subs: new Set() }; this.files.set(rel, F); }
    return F;
  }

  _parse(line, rel, lineNo) {
    let e;
    this.stats.entriesParsed++;
    try { e = JSON.parse(line); } catch (err) { this.stats.corruptLines++; return { bad: 'unparseable JSON', rel, lineNo }; }
    const why = invalid(e);
    if (why) { this.stats.corruptLines++; return { bad: why, rel, lineNo }; }
    return e;
  }

  _feed(text, rel, lineNo0, subs) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === '' || (line.length < 3 && !line.trim())) continue;
      this.stats.linesScanned++;
      const addr = quickAddr(line);
      let parsed;
      for (const sub of subs) {
        if (sub.type === 'region') {
          if (addr !== null && addr !== sub.addr) continue;
        }
        if (parsed === undefined) parsed = this._parse(line, rel, lineNo0 + i + 1);
        if (parsed.bad) { if (sub.type === 'region' && addr === sub.addr) sub.corrupt.push({ file: rel, line: lineNo0 + i + 1, reason: parsed.bad }); continue; }
        sub.offer(parsed, this.stats);
      }
    }
    return lines.length;
  }

  // Reads [0, F.off) of a file again for ONE sub (its bytes count: they are the shard the question named).
  _catchUp(sub, F) {
    let fd;
    try { fd = fs.openSync(F.abs, 'r'); } catch (err) { return; }
    this.stats.filesOpened++;
    try { let n = 0; scanFd(this.stats, fd, 0, F.off, (t) => { n += this._feed(t, F.rel, n, [sub]); }); } finally { fs.closeSync(fd); }
  }

  // Attach a sub to a file. A file already read past offset 0 is caught up for this sub alone; the new bytes are
  // then shared by every sub on the file.
  _attach(sub, rel) {
    if (sub.files.has(rel)) return false;
    sub.files.add(rel);
    const F = this._file(rel);
    if (F.off > 0) this._catchUp(sub, F);
    F.subs.add(sub);
    return true;
  }

  // Reads the bytes appended to a file since its cursor and feeds them to every sub on it.
  _tail(F) {
    let fd;
    try { fd = fs.openSync(F.abs, 'r'); } catch (err) { return 0; }
    this.stats.filesOpened++;
    try {
      const st = fs.fstatSync(fd);
      if (F.ino !== null && (st.ino !== F.ino || st.size < F.off)) {
        // the file was replaced or shortened: append-only was violated. Rebuild what depended on it.
        F.off = 0; F.lineNo = 0;
        for (const s of [...F.subs]) {
          s.reset();
          if (s.type === 'region') this.stats.regionsRecomputed++;
          for (const rel of s.files) if (rel !== F.rel) { const G = this.files.get(rel); if (G && G.off > 0) this._catchUp(s, G); }
        }
      }
      F.ino = st.ino;
      if (st.size <= F.off) return 0;
      const subs = [...F.subs];
      let nLines = 0;
      const consumed = scanFd(this.stats, fd, F.off, st.size, (t) => { nLines += this._feed(t, F.rel, F.lineNo + nLines, subs); });
      F.off += consumed;
      F.lineNo += nLines;
      return consumed;
    } finally { fs.closeSync(fd); }
  }

  _regionSub(addr, kind) {
    const key = `r\u0000${kind ?? ''}\u0000${addr}`;
    let sub = this.subs.get(key);
    if (sub) return sub;
    sub = {
      type: 'region', key, addr, kind: kind ?? null, files: new Set(), corrupt: [], region: new Region(addr, kind ?? null),
      offer(e, stats) {
        const before = this.region.blindWrites;
        const added = this.region.add(e);
        if (added) stats.blindWrites += this.region.blindWrites - before; else if (this.region.accepts(e) && e.addr === this.addr) stats.duplicates++;
      },
      reset() { this.region = new Region(this.addr, this.kind); this.corrupt = []; },
    };
    this.subs.set(key, sub);
    this.stats.regionsMaterialized++;
    const b0 = this.stats.bytesRead;
    this._materialize(sub, { addr, kind: kind ?? undefined });
    if (kind === SCHEMA_KIND) this.stats.schemaBytes += this.stats.bytesRead - b0;
    return sub;
  }

  _materialize(sub, q) {
    sub.query = q;
    const paths = this.plan(q);
    for (const rel of paths) this._attach(sub, rel);
    for (const rel of paths) this._tail(this.files.get(rel));
  }

  // ---- advance -----------------------------------------------------------------------------------------------
  // Reads only bytes appended since each file's cursor, plus files that have appeared for a held question
  // (a new writer, a deeper split, a new schema placement). Adds to accumulators; invalidates nothing.
  advance() {
    this.stats.advances++;
    const b0 = this.stats.bytesRead, p0 = this.stats.entriesParsed, rc0 = this.stats.regionsRecomputed;
    for (const s of this.subs.values()) { if (s.region) s.region.touched = false; else s.touched = false; }
    for (const F of this.files.values()) if (F.subs.size) this._tail(F);
    const newFiles = [];
    for (;;) {
      const fresh = [];
      for (const sub of [...this.subs.values()]) {
        for (const rel of this.plan(sub.query)) if (this._attach(sub, rel)) fresh.push(rel);
      }
      if (!fresh.length) break;
      for (const rel of new Set(fresh)) { this._tail(this.files.get(rel)); newFiles.push(rel); }
    }
    const touched = [];
    for (const s of this.subs.values()) {
      if (s.type === 'region' && s.region.touched) touched.push(s.addr);
      else if (s.type === 'stream' && s.touched) touched.push(s.key);
    }
    this.lastAdvance = {
      bytesRead: this.stats.bytesRead - b0, entriesParsed: this.stats.entriesParsed - p0,
      regionsRecomputed: this.stats.regionsRecomputed - rc0, regionsTouched: touched, newFiles,
    };
    return this.lastAdvance;
  }

  // ---- reads -------------------------------------------------------------------------------------------------
  // The raw accumulator for an address (materialized on first use). kind narrows it to one kind (+ retractions).
  region(addr, kind) { return this._regionSub(addr, kind ?? null).region; }

  windows(kind) {
    return this.schemaVersions(kind).filter((v) => v.head && !v.retracted && v.window !== null).map((v) => ({ name: v.window, schema: v.id, def: v.windowDef, collapse: v.collapse }));
  }

  _windowDef(kind, name) {
    if (!kind) throw new PlacedError('WINDOW_NEEDS_KIND', 'a named window is declared by the schema of a kind: pass kind with window');
    const v = this.chooseSchema(kind, name);
    return { name: v.window, schema: v.id, writers: isObj(v.windowDef) ? v.windowDef.writers : undefined, cut: isObj(v.windowDef) ? v.windowDef.cut : undefined, collapse: v.collapse };
  }

  // ask(addr, opts): the projection of one region. opts: { kind, rule, window, history, conflicts }.
  ask(addr, opts = {}) {
    if (typeof addr !== 'string' || !addr) throw new PlacedError('BAD_ASK', 'ask needs an address');
    const kind = opts.kind ?? null;
    const b0 = this.stats.bytesRead, m0 = this.stats.regionsMaterialized, p0 = this.stats.entriesParsed, sb0 = this.stats.schemaBytes;
    let win = null;
    if (opts.window !== undefined && opts.window !== null) {
      win = isObj(opts.window) ? opts.window : this._windowDef(kind, opts.window);
    }
    const had = this.subs.has(`r\u0000${kind ?? ''}\u0000${addr}`);
    const sub = this._regionSub(addr, kind);
    let rules = opts.rule !== undefined ? opts.rule : opts.rules;
    const pre = [];
    if (win) {
      if (win.writers) pre.push({ rule: 'by-writer', writers: win.writers });
      if (win.cut) pre.push({ rule: 'as-of', cut: win.cut });
      if (rules === undefined && win.collapse !== undefined) rules = win.collapse;
    }
    const view = project(sub.region, [...pre, ...normalizeRules(rules)], opts);
    view.window = win ? (win.name ?? null) : null;
    view.corrupt = sub.corrupt.slice();
    view.coverage = {
      files: [...sub.files], hot: had,
      bytesRead: this.stats.bytesRead - b0, schemaBytes: this.stats.schemaBytes - sb0, entriesParsed: this.stats.entriesParsed - p0,
      regionsMaterialized: this.stats.regionsMaterialized - m0,
    };
    return view;
  }

  _streamSub(key, query, pred) {
    let sub = this.subs.get(key);
    if (sub) return sub;
    sub = {
      type: 'stream', key, files: new Set(), entries: new Map(), version: 0, touched: false, pred, query,
      offer(e) { if (this.pred(e) && !this.entries.has(e.id)) { this.entries.set(e.id, e); this.version++; this.touched = true; } },
      reset() { this.entries = new Map(); this.version++; },
    };
    this.subs.set(key, sub);
    this._materialize(sub, query);
    return sub;
  }

  _streamView(sub, extra, b0, p0) {
    if (!sub._sorted || sub._sorted.version !== sub.version) sub._sorted = { version: sub.version, list: [...sub.entries.values()].sort(cmpKey) };
    return {
      ...extra, count: sub._sorted.list.length, entries: sub._sorted.list,
      coverage: { files: [...sub.files], bytesRead: this.stats.bytesRead - b0, entriesParsed: this.stats.entriesParsed - p0 },
    };
  }

  // R2: every entry of one kind written by one writer (their lane), in position order. opts: { from, to } on `at`.
  lane(kind, writer, opts = {}) {
    const b0 = this.stats.bytesRead, p0 = this.stats.entriesParsed;
    const { from, to } = opts;
    const key = `l\u0000${kind}\u0000${writer}\u0000${from ?? ''}\u0000${to ?? ''}`;
    const range = from !== undefined || to !== undefined ? { from, to } : undefined;
    const sub = this._streamSub(key, { kind, writer, range },
      (e) => e.kind === kind && e.by === writer && (from === undefined || e.at >= from) && (to === undefined || e.at <= to));
    return this._streamView(sub, { kind, writer }, b0, p0);
  }

  // R3: every entry of one kind with `at` in [from, to], across writers, in position order.
  range(kind, from, to) {
    const b0 = this.stats.bytesRead, p0 = this.stats.entriesParsed;
    const key = `t\u0000${kind}\u0000${from ?? ''}\u0000${to ?? ''}`;
    const sub = this._streamSub(key, { kind, range: { from, to } },
      (e) => e.kind === kind && (from === undefined || e.at >= from) && (to === undefined || e.at <= to));
    return this._streamView(sub, { kind, from, to }, b0, p0);
  }

  // R4: a header-style scan, one shot, nothing retained. With kind it reads the shards that kind can live in;
  // without kind it reads every shard file of every writer. opts: { kind, where(entry) -> bool, collect = true }.
  scan(opts = {}) {
    const b0 = this.stats.bytesRead, p0 = this.stats.entriesParsed;
    const where = opts.where || (() => true);
    const kind = opts.kind ?? null;
    const out = [];
    let count = 0;
    const sub = { type: 'stream', files: new Set(), offer: (e) => { if ((kind === null || e.kind === kind) && where(e)) { count++; if (opts.collect !== false) out.push(e); } } };
    let rels;
    if (kind) rels = this.plan({ kind });
    else {
      rels = [];
      for (const w of this._writers()) { let d = []; try { d = fs.readdirSync(path.join(this.root, w)); } catch (e) { /* gone */ } for (const n of d) if (n.endsWith('.jsonl')) rels.push(`${w}/${n}`); }
    }
    for (const rel of rels) {
      let fd;
      try { fd = fs.openSync(path.join(this.root, rel), 'r'); } catch (err) { continue; }
      this.stats.filesOpened++;
      try { const st = fs.fstatSync(fd); let n = 0; scanFd(this.stats, fd, 0, st.size, (t) => { n += this._feed(t, rel, n, [sub]); }); } finally { fs.closeSync(fd); }
    }
    return { count, matches: out, coverage: { files: rels, bytesRead: this.stats.bytesRead - b0, entriesParsed: this.stats.entriesParsed - p0 } };
  }
}
