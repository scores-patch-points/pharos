// pharos: the one shared log. Node built-ins only. See SPEC.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CELLS = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'cells.json'), 'utf8'));
const RANK = new Map(CELLS.cells.map((c) => [c.id, c.rank]));

// The protocol's own kinds are always valid, declared or not (so no retraction can strand the protocol).
// open() also writes them as ordinary kind entries, so the log itself declares them.
const BOOT = { frame: 'NUL·Ground', kind: 'DEF·Figure', holon: 'DEF·Pattern', retract: 'NUL·Figure' };
const ALLOWED = new Set(['cell', 'kind', 'addr', 'body', 'of', 'basis']);
const COMPUTED = new Set(['v', 'seen', 'at', 'id', 'by']);

export class PharosError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'PharosError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

// ---- canonical JSON and ids -------------------------------------------------

export function canonical(v) {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'string': return JSON.stringify(v);
    case 'boolean': return v ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(v)) throw new PharosError('BAD_JSON', 'non-finite number in entry');
      return JSON.stringify(v);
    case 'object': {
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) if (!(i in v)) throw new PharosError('BAD_JSON', `sparse array hole at ${i}`);
        return '[' + v.map(canonical).join(',') + ']';
      }
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw new PharosError('BAD_JSON', 'only plain objects are JSON (no Date, Map, Set, class instances)');
      return '{' + Object.keys(v).sort().map((k) => {
        if (v[k] === undefined) throw new PharosError('BAD_JSON', `undefined value at key ${k}`);
        return JSON.stringify(k) + ':' + canonical(v[k]);
      }).join(',') + '}';
    }
    default:
      throw new PharosError('BAD_JSON', `value of type ${typeof v} is not JSON`);
  }
}

export function entryId(entry) {
  const { id, ...rest } = entry; // eslint-disable-line no-unused-vars
  return crypto.createHash('sha256').update(canonical(rest)).digest('hex');
}

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isStrArr = (x) => Array.isArray(x) && x.every((s) => typeof s === 'string');

function invalid(e) {
  try {
    if (!isObj(e)) return 'not an object';
    if (e.v !== 1) return 'bad version';
    for (const k of ['cell', 'kind', 'addr', 'by', 'at', 'id']) if (typeof e[k] !== 'string') return `bad ${k}`;
    if (!RANK.has(e.cell)) return 'unknown cell';
    if (!isStrArr(e.of) || !isStrArr(e.seen)) return 'bad of/seen';
    if (!isObj(e.basis) || !('body' in e)) return 'bad basis/body';
    if (entryId(e) !== e.id) return 'id does not match content';
  } catch (err) {
    return 'bad json value';
  }
  return null;
}

// ---- handle and storage -----------------------------------------------------

export function open(name = 'default', opts = {}) {
  const dir = path.resolve(opts.dir || process.env.PHAROS || path.join(os.homedir(), '.pharos', name));
  const writer = opts.writer || `${os.hostname().split('.')[0]}-${process.pid}`;
  if (!/^[A-Za-z0-9._-]+$/.test(writer)) throw new PharosError('BAD_WRITER', `writer must match [A-Za-z0-9._-]+: ${writer}`);
  fs.mkdirSync(dir, { recursive: true });
  const format = opts.format || process.env.PHAROS_FORMAT || 'jsonl';
  if (format !== 'jsonl' && format !== 'phb') throw new PharosError('BAD_FORMAT', `format is jsonl or phb, not ${format}`);
  const h = { name, dir, writer, by: writer, format, file: path.join(dir, writer + (format === 'phb' ? '.phb' : '.jsonl')), blobFile: path.join(dir, writer + '.phb') };
  if (opts.frame !== false && !hasFrame(h)) {
    // Another process may create the frame first; that is fine, the frame is then already there.
    try { weave(h, { cell: BOOT.frame, kind: 'frame', addr: `frame:${name}`, body: { name, epoch: new Date().toISOString(), assumed: [] } }); }
    catch (err) { if (!(err instanceof PharosError && err.code === 'FRAME_EXISTS')) throw err; }
    const have = declaredKinds(view(h));
    for (const [k, cell] of Object.entries(BOOT)) {
      if (!have.has(k)) weave(h, { cell: BOOT.kind, kind: 'kind', addr: `kind:${k}`, body: { name: k, cell } });
    }
  }
  return h;
}

const logFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl') || f.endsWith('.phb')).sort() : []);

// A BACKWARD FOLD OVER THE LOG, for a question one entry answers: read only what is relevant, newest first, and stop at the answer. Files newest (by mtime) first, and
// within a file from its END (the log is append-only, so the latest state of anything is nearest the end); the file is searched as raw bytes for `needle` (canonical JSON
// writes its keys sorted and compact, so the substring is stable) and a hit is CONFIRMED by parsing the line it sits on and asking `confirm(entry)`. No view, no causal
// order, no hashing: callers used to build the whole view for these questions (open() loaded the whole directory to ask whether the frame exists: 14 s; asking whether a kind
// is declared built the view again: 26 s, on a log of 294 writer files and 214,481 entries). PHB files are decoded whole (their records are framed, not lines).
function foldBack(h, needle, confirm) {
  const files = logFiles(h.dir).map((f) => { let m = 0; try { m = fs.statSync(path.join(h.dir, f)).mtimeMs; } catch (err) { /* vanished */ } return { f, m }; }).sort((a, b) => b.m - a.m);
  const pat = Buffer.from(needle);
  for (const { f } of files) {
    if (f.endsWith('.phb')) { try { if (parseFile(h.dir, f).ents.some(confirm)) return true; } catch (err) { /* vanished */ } continue; }
    let buf; try { buf = fs.readFileSync(path.join(h.dir, f)); } catch (err) { continue; }
    for (let at = buf.lastIndexOf(pat); at >= 0; at = at > 0 ? buf.lastIndexOf(pat, at - 1) : -1) {
      const start = buf.lastIndexOf(10, at) + 1; let end = buf.indexOf(10, at); if (end < 0) end = buf.length;
      try { if (confirm(JSON.parse(buf.subarray(start, end).toString('utf8')))) return true; } catch (err) { /* a torn line */ }
    }
  }
  return false;
}

// Does ANY writer's file hold the frame?
function hasFrame(h) { return foldBack(h, '"kind":"frame"', (e) => e.kind === 'frame'); }

// Is the kind declared, anywhere in this log? Remembered per process once found.
const KINDS_SEEN = new Set();
export function hasKind(h, kind) {
  const key = `${h.dir}|${kind}`; if (KINDS_SEEN.has(key)) return true;
  if (foldBack(h, `"addr":"kind:${kind}"`, (e) => e.kind === 'kind' && e.addr === `kind:${kind}`)) { KINDS_SEEN.add(key); return true; }
  return false;
}

// Which of these kinds are NOT declared yet? One backward pass over the log for all of them (each file read once), stopping when every kind has been found.
export function missingKinds(h, kinds) {
  const need = new Map(); for (const k of kinds) if (!KINDS_SEEN.has(`${h.dir}|${k}`)) need.set(k, Buffer.from(`"addr":"kind:${k}"`));
  if (!need.size) return [];
  const files = logFiles(h.dir).map((f) => { let m = 0; try { m = fs.statSync(path.join(h.dir, f)).mtimeMs; } catch (err) { /* vanished */ } return { f, m }; }).sort((a, b) => b.m - a.m);
  for (const { f } of files) {
    if (!need.size) break;
    if (f.endsWith('.phb')) { try { for (const e of parseFile(h.dir, f).ents) if (e.kind === 'kind' && need.has(String(e.addr).slice(5)) && e.addr.startsWith('kind:')) { KINDS_SEEN.add(`${h.dir}|${e.addr.slice(5)}`); need.delete(e.addr.slice(5)); } } catch (err) { /* vanished */ } continue; }
    let buf; try { buf = fs.readFileSync(path.join(h.dir, f)); } catch (err) { continue; }
    for (const [k, pat] of [...need]) {
      for (let at = buf.lastIndexOf(pat); at >= 0; at = at > 0 ? buf.lastIndexOf(pat, at - 1) : -1) {
        const start = buf.lastIndexOf(10, at) + 1; let end = buf.indexOf(10, at); if (end < 0) end = buf.length;
        try { const e = JSON.parse(buf.subarray(start, end).toString('utf8')); if (e.kind === 'kind' && e.addr === `kind:${k}`) { KINDS_SEEN.add(`${h.dir}|${k}`); need.delete(k); break; } } catch (err) { /* a torn line */ }
      }
    }
  }
  return [...need.keys()];
}

function appendEntries(h, ents, { chained = false } = {}) {
  if (!ents.length) return;
  if (h.format === 'phb') return appendRecords(h.file, h.writer, ents.map((e) => [REC.ENTRY, encodeEntry(e, chained)]));
  append(h, ents.map((e) => canonical(e)));
}

function append(h, lines) {
  if (!lines.length) return;
  let prefix = '';
  try {
    const st = fs.statSync(h.file);
    if (st.size > 0) {
      const fd = fs.openSync(h.file, 'r');
      const b = Buffer.alloc(1);
      fs.readSync(fd, b, 0, 1, st.size - 1);
      fs.closeSync(fd);
      if (b[0] !== 10) prefix = '\n'; // a torn last line must not swallow ours
    }
  } catch (err) { /* no file yet */ }
  fs.appendFileSync(h.file, prefix + lines.join('\n') + '\n');
}

// ---- PHB1: the binary store ---------------------------------------------------
// PREREG-S1 (ledgers/pharos-binary). The entry is still DEFINED by its canonical JSON and its id is still sha256 of
// that; this is storage only. One file per writer, `<writer>.phb`:
//   file   := "PHB1" writer(varint length + utf8) record*
//   record := kind(1) length(varint) payload(length) chain(8) size(4, big-endian: the whole record's byte length)
//   chain  := sha256(prevChain || kind || payload)[0:8]; genesis = sha256("PHB1\0" || writer)[0:8]
// `size` lets a reader walk backward from the end; prevChain sits in the 12 bytes before a record, so one record can be
// checked against its predecessor alone. After a torn tail a writer appends MARKER + a RESYNC record whose chain starts
// from sha256("PHB1\0RESYNC\0" || writer || offset)[0:8], so it appends past the damage, never over it.
const MAGIC = Buffer.from('PHB1');
const MARKER = Buffer.from('\u0000PHB1RESYNC\u0000');
const REC = { ENTRY: 0x01, BLOB: 0x02, RESYNC: 0x10 };
const HEX64 = /^[0-9a-f]{64}$/;
const sha256b = (...bufs) => { const h = crypto.createHash('sha256'); for (const b of bufs) h.update(b); return h.digest(); };
const genesisOf = (writer) => sha256b(Buffer.from('PHB1\0' + writer)).subarray(0, 8);
const resyncGenesis = (writer, offset) => sha256b(Buffer.from(`PHB1\0RESYNC\0${writer}\0${offset}`)).subarray(0, 8);
const chainOf = (prev, kind, payload) => sha256b(prev, Buffer.from([kind]), payload).subarray(0, 8);
const varint = (n) => { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; out.push(b); } while (n > 0); return Buffer.from(out); };
function readVarint(buf, at) { let n = 0, mul = 1, i = at; for (;;) { if (i >= buf.length || i - at > 8) return null; const b = buf[i++]; n += (b & 127) * mul; if (b < 128) return [n, i]; mul *= 128; } }
const str = (x) => { const b = Buffer.from(String(x), 'utf8'); return Buffer.concat([varint(b.length), b]); };
const idref = (x) => (typeof x === 'string' && HEX64.test(x) ? Buffer.concat([Buffer.from([0]), Buffer.from(x, 'hex')]) : Buffer.concat([Buffer.from([1]), str(x)]));
const ENTRY_KEYS = new Set(['v', 'cell', 'kind', 'addr', 'body', 'of', 'basis', 'seen', 'by', 'at', 'id']);
function encodeEntry(e, chained = false) {
  const ms = Date.parse(e.at), timed = Number.isInteger(ms) && ms >= 0 && new Date(ms).toISOString() === e.at;
  const extra = Object.fromEntries(Object.entries(e).filter(([k]) => !ENTRY_KEYS.has(k)));
  return Buffer.concat([
    Buffer.from([chained ? 2 : 1]), varint(e.v), str(e.cell), str(e.kind), str(e.addr), str(canonical(e.body)),
    varint(e.of.length), ...e.of.map(idref), str(canonical(e.basis)), varint(e.seen.length), ...e.seen.map(idref),
    str(e.by), timed ? Buffer.concat([Buffer.from([0]), varint(ms)]) : Buffer.concat([Buffer.from([1]), str(e.at)]),
    idref(e.id), str(Object.keys(extra).length ? canonical(extra) : ''),
  ]);
}
function decodeEntry(p) {
  // S1-A1 (post-result, disclosed): keys come out in canonical (sorted) order, so a decoded entry is indistinguishable
  // from JSON.parse of its canonical line; strings and hex are read straight from the buffer.
  let i = 0;
  const vi = () => { let n = 0, mul = 1; for (;;) { if (i >= p.length) throw new Error('varint'); const b = p[i++]; n += (b & 127) * mul; if (b < 128) return n; mul *= 128; } };
  const s = () => { const n = vi(); if (i + n > p.length) throw new Error('short'); const out = p.toString('utf8', i, i + n); i += n; return out; };
  const id = () => { if (i >= p.length) throw new Error('short'); if (p[i++] === 0) { if (i + 32 > p.length) throw new Error('short'); const out = p.toString('hex', i, i + 32); i += 32; return out; } return s(); };
  const ver = p[i++];
  if (ver !== 1 && ver !== 2) throw new Error('entry coding'); // 2 = chained: descends from every earlier record of its file (S2)
  const v = vi(), cell = s(), kind = s(), addr = s(), body = JSON.parse(s());
  const of = new Array(vi()); for (let k = 0; k < of.length; k++) of[k] = id();
  const basis = JSON.parse(s());
  const seen = new Array(vi()); for (let k = 0; k < seen.length; k++) seen[k] = id();
  const by = s(); const at = p[i++] === 0 ? new Date(vi()).toISOString() : s(); const eid = id();
  const extra = s();
  if (i !== p.length) throw new Error('trailing bytes');
  const e = { addr, at, basis, body, by, cell, id: eid, kind, of, seen, v };
  if (!extra) return e;
  const all = { ...e, ...JSON.parse(extra) };
  return Object.fromEntries(Object.keys(all).sort().map((k) => [k, all[k]]));
}
const frameRecord = (kind, payload, prev) => {
  const chain = chainOf(prev, kind, payload), head = Buffer.concat([Buffer.from([kind]), varint(payload.length)]);
  const size = head.length + payload.length + 12, tail = Buffer.alloc(4); tail.writeUInt32BE(size);
  return { bytes: Buffer.concat([head, payload, chain, tail]), chain };
};
// Read one record at `at` (forward). Returns { kind, payload, chain, end } or null when the bytes are not a record.
function recordAt(buf, at) {
  if (at >= buf.length) return null;
  const kind = buf[at], r = readVarint(buf, at + 1); if (!r) return null;
  const [len, pstart] = r, end = pstart + len + 12;
  if (end > buf.length) return null;
  const size = buf.readUInt32BE(end - 4);
  if (size !== end - at) return null;
  return { kind, payload: buf.subarray(pstart, pstart + len), chain: buf.subarray(pstart + len, pstart + len + 8), end };
}
function headerLen(buf, writer) {
  if (buf.length < 4 || !buf.subarray(0, 4).equals(MAGIC)) return null;
  const r = readVarint(buf, 4); if (!r) return null;
  const end = r[1] + r[0]; if (end > buf.length) return null;
  if (writer != null && buf.subarray(r[1], end).toString('utf8') !== writer) return null;
  return { end, writer: buf.subarray(r[1], end).toString('utf8') };
}
/** Every record of a PHB buffer, forward, chain-verified. Damage stops verification until a RESYNC marker. */
export function phbRecords(buf, { file = '', from = null } = {}) {
  const out = [], corrupt = [];
  const hdr = headerLen(buf, null);
  if (!hdr) return { records: out, corrupt: [{ file, offset: 0, reason: 'not a PHB1 file' }], last: null, end: 0, writer: null };
  let at = from ? from.at : hdr.end, prev = from ? from.chain : genesisOf(hdr.writer), lastGood = at;
  while (at < buf.length) {
    if (buf.subarray(at, at + MARKER.length).equals(MARKER)) { prev = resyncGenesis(hdr.writer, at); at += MARKER.length; continue; }
    const rec = recordAt(buf, at);
    if (!rec || !chainOf(prev, rec.kind, rec.payload).equals(rec.chain)) {
      const next = buf.indexOf(MARKER, at + 1);
      corrupt.push({ file, offset: at, reason: rec ? 'chain broken: this record and the rest until a resync are unverifiable' : 'torn or malformed record' });
      if (next < 0) { at = buf.length; break; }
      at = next; continue;
    }
    out.push({ kind: rec.kind, payload: rec.payload, offset: at, end: rec.end, prevChain: prev });
    prev = Buffer.from(rec.chain); at = rec.end; lastGood = at;
  }
  return { records: out, corrupt, last: { at: lastGood, chain: prev }, end: lastGood, writer: hdr.writer };
}
/** Walk a PHB buffer BACKWARD by each record's trailing size; frames only (S2 verifies what it reads). */
export function phbBackward(buf) {
  const hdr = headerLen(buf, null); if (!hdr) return [];
  const out = []; let end = buf.length;
  while (end > hdr.end) {
    if (end - 4 < hdr.end) break;
    const size = buf.readUInt32BE(end - 4), at = end - size;
    if (size < 13 || at < hdr.end) break;
    const rec = recordAt(buf, at); if (!rec || rec.end !== end) break;
    out.push({ kind: rec.kind, offset: at, end });
    end = buf.subarray(at - MARKER.length, at).equals(MARKER) ? at - MARKER.length : at;
  }
  return out;
}
function appendRecords(file, writer, recs) {
  if (!recs.length) return;
  let buf = null; try { buf = fs.readFileSync(file); } catch (err) { /* no file yet */ }
  const parts = [];
  let prev;
  if (!buf || !buf.length) { parts.push(Buffer.concat([MAGIC, str(writer)])); prev = genesisOf(writer); }
  else {
    const scan = phbRecords(buf, { file });
    if (scan.end === buf.length && !scan.corrupt.some((c) => c.offset >= (scan.records.at(-1)?.end ?? 0))) prev = scan.last.chain;
    else { parts.push(MARKER); prev = resyncGenesis(writer, buf.length); const r = frameRecord(REC.RESYNC, Buffer.alloc(0), prev); parts.push(r.bytes); prev = r.chain; }
  }
  for (const [kind, payload] of recs) { const r = frameRecord(kind, payload, prev); parts.push(r.bytes); prev = r.chain; }
  fs.appendFileSync(file, Buffer.concat(parts));
}
export function putBlob(h, bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const hash = sha256b(b).toString('hex');
  if (load(h).blobs.has(hash)) return hash;
  appendRecords(h.blobFile, h.writer, [[REC.BLOB, b]]);
  return hash;
}
export function getBlob(h, hash) {
  const at = load(h).blobs.get(hash); if (!at) return null;
  const buf = fs.readFileSync(path.join(h.dir, at.file)).subarray(at.offset, at.offset + at.length);
  return sha256b(buf).toString('hex') === hash ? Buffer.from(buf) : null;
}

// One parsed file, cached by path. Files are append-only, so when only the tail grew (and the cached
// part ended on a newline) just the new bytes are read and checked; otherwise the file is re-parsed.
const CACHE = new Map();
function parseFile(dir, f) {
  const p = path.join(dir, f);
  const st = fs.statSync(p);
  let c = CACHE.get(p);
  if (c && c.ino === st.ino && c.size === st.size && c.mtimeMs === st.mtimeMs) return c;
  if (f.endsWith('.phb')) return parsePhb(p, f, st, c);
  const tail = c && c.ino === st.ino && c.complete && st.size > c.size;
  if (!tail) c = { ents: [], corrupt: [], lines: 0, frames: false, blobs: new Map() };
  const from = tail ? c.size : 0;
  const buf = Buffer.alloc(st.size - from);
  const fd = fs.openSync(p, 'r');
  try { fs.readSync(fd, buf, 0, buf.length, from); } finally { fs.closeSync(fd); }
  const parts = buf.toString('utf8').split('\n');
  parts.forEach((line, i) => {
    if (!line.trim()) return;
    const at = c.lines + i + 1;
    let e;
    try { e = JSON.parse(line); } catch (err) { c.corrupt.push({ file: f, line: at, reason: 'unparseable JSON' }); return; }
    const why = invalid(e);
    if (why) { c.corrupt.push({ file: f, line: at, reason: why }); return; }
    if (e.kind === 'frame') c.frames = true;
    c.ents.push(e);
  });
  c.lines += parts.length - 1;
  Object.assign(c, { ino: st.ino, size: st.size, mtimeMs: st.mtimeMs, complete: parts[parts.length - 1] === '' });
  CACHE.set(p, c);
  return c;
}

function parsePhb(p, f, st, c) {
  const buf = fs.readFileSync(p);
  const tail = c && c.ino === st.ino && c.complete && st.size > c.size;
  if (!tail) c = { ents: [], corrupt: [], lines: 0, frames: false, blobs: new Map(), resume: null };
  const scan = phbRecords(buf, { file: f, from: tail ? c.resume : null });
  for (const r of scan.records) {
    if (r.kind === REC.BLOB) { c.blobs.set(sha256b(r.payload).toString('hex'), { file: f, offset: r.end - 12 - r.payload.length, length: r.payload.length }); continue; }
    if (r.kind !== REC.ENTRY) continue;
    let e;
    try { e = decodeEntry(r.payload); } catch (err) { c.corrupt.push({ file: f, offset: r.offset, reason: 'undecodable entry' }); continue; }
    const why = invalid(e);
    if (why) { c.corrupt.push({ file: f, offset: r.offset, reason: why }); continue; }
    if (e.kind === 'frame') c.frames = true;
    c.ents.push(e);
  }
  c.corrupt.push(...scan.corrupt);
  Object.assign(c, { ino: st.ino, size: st.size, mtimeMs: st.mtimeMs, complete: scan.end === buf.length && !scan.corrupt.length, resume: scan.last });
  CACHE.set(p, c);
  return c;
}

// Union of every *.jsonl in the directory, deduped by id. Corrupt lines are reported, never fatal.
function load(h) {
  const entries = new Map();
  const corrupt = [];
  const writers = [];
  let frames = false;
  const blobs = new Map();
  const files = fs.existsSync(h.dir) ? fs.readdirSync(h.dir).filter((f) => f.endsWith('.jsonl') || f.endsWith('.phb')).sort() : [];
  for (const f of files) {
    let c;
    try { c = parseFile(h.dir, f); } catch (err) { continue; } // vanished between listing and reading
    for (const e of c.ents) if (!entries.has(e.id)) entries.set(e.id, e);
    corrupt.push(...c.corrupt.map((x) => ({ ...x })));
    if (c.frames) frames = true;
    for (const [k, v] of c.blobs ?? []) if (!blobs.has(k)) blobs.set(k, v);
    writers.push({ writer: f.replace(/\.(jsonl|phb)$/, ''), file: f, entries: c.ents.length });
  }
  return { entries, corrupt, writers, frames, blobs };
}

// ---- causal order, retraction, conflicts -----------------------------------

const preds = (e, entries) => [...new Set([...e.seen, ...e.of])].filter((id) => entries.has(id));
const cmp = (a, b) => RANK.get(a.cell) - RANK.get(b.cell) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function causalOrder(entries) {
  const indeg = new Map();
  const succ = new Map();
  for (const e of entries.values()) {
    const ps = preds(e, entries);
    indeg.set(e.id, ps.length);
    for (const p of ps) (succ.get(p) || succ.set(p, []).get(p)).push(e.id);
  }
  const ready = []; // kept sorted by (cell rank, id)
  const push = (e) => {
    let lo = 0, hi = ready.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cmp(ready[m], e) < 0) lo = m + 1; else hi = m; }
    ready.splice(lo, 0, e);
  };
  for (const e of entries.values()) if (indeg.get(e.id) === 0) push(e);
  const out = [];
  while (ready.length) {
    const e = ready.shift();
    out.push(e);
    for (const s of succ.get(e.id) || []) {
      indeg.set(s, indeg.get(s) - 1);
      if (indeg.get(s) === 0) push(entries.get(s));
    }
  }
  return out;
}

function view(h) {
  const { entries, corrupt, writers } = load(h);
  const order = causalOrder(entries);
  const referenced = new Set();
  let dangling = 0;
  for (const e of entries.values()) for (const id of [...e.seen, ...e.of]) {
    if (entries.has(id)) referenced.add(id); else dangling++;
  }
  const idx = new Map(order.map((e, i) => [e.id, i]));
  const frontier = order.filter((e) => !referenced.has(e.id)).map((e) => e.id).sort();
  // A retract is effective unless a later effective retract retracts it; retractors are causally later.
  const retracted = new Set();
  const retractions = [];
  for (let i = order.length - 1; i >= 0; i--) {
    const e = order[i];
    if (e.kind === 'retract' && !retracted.has(e.id)) {
      retractions.push({ id: e.id, of: e.of, by: e.by });
      for (const t of e.of) retracted.add(t);
    }
  }
  retractions.reverse();
  return { entries, order, idx, frontier, retracted, retractions, corrupt, writers, dangling };
}

// Marks every ancestor of `from` (stopping below topological index `lo`) in `seen`. Iterative: chains are long.
function walkBack(v, from, lo, seen) {
  const st = [from];
  while (st.length) for (const p of preds(v.entries.get(st.pop()), v.entries)) if (!seen.has(p) && v.idx.get(p) >= lo) { seen.add(p); st.push(p); }
}

// Per addr+cell group, only the causally maximal entries can conflict: older ones were updated, not contradicted.
// Multiple frames are not conflicts (frame() reports them as merged).
function findConflicts(v, live) {
  const groups = new Map();
  for (const e of live) {
    if (e.kind === 'frame') continue;
    const k = e.addr + '\u0000' + e.cell;
    (groups.get(k) || groups.set(k, []).get(k)).push(e);
  }
  const conflicts = [];
  for (const g of groups.values()) {
    const body = new Map(g.map((e) => [e.id, canonical(e.body)]));
    if (g.every((e) => body.get(e.id) === body.get(g[0].id))) continue;
    const lo = v.idx.get(g[0].id); // g is in causal order
    const seen = new Set(), heads = [];
    for (let n = g.length - 1; n >= 0; n--) { // latest first: a head's ancestors are marked, so covered entries are skipped
      if (seen.has(g[n].id)) continue;
      heads.push(g[n]);
      walkBack(v, g[n].id, lo, seen);
    }
    for (let i = 0; i < heads.length; i++) for (let j = i + 1; j < heads.length; j++) {
      const [a, b] = heads[i].id < heads[j].id ? [heads[i], heads[j]] : [heads[j], heads[i]];
      if (body.get(a.id) !== body.get(b.id)) conflicts.push({ addr: a.addr, cell: a.cell, a: a.id, b: b.id, by: [a.by, b.by] });
    }
  }
  return conflicts;
}

function declaredKinds(v) {
  const kinds = new Map();
  for (const e of v.order) {
    if (e.kind !== 'kind' || v.retracted.has(e.id) || !isObj(e.body) || typeof e.body.name !== 'string') continue;
    if (!kinds.has(e.body.name)) kinds.set(e.body.name, { name: e.body.name, cell: e.body.cell, schema: e.body.schema, id: e.id });
  }
  return kinds;
}

// ---- API --------------------------------------------------------------------

export function weave(h, input) {
  if (!isObj(input)) throw new PharosError('BAD_ENTRY', 'weave needs an object');
  for (const k of Object.keys(input)) {
    if (COMPUTED.has(k)) throw new PharosError('COMPUTED_FIELD', `${k} is computed by weave and cannot be supplied`);
    if (!ALLOWED.has(k)) throw new PharosError('UNKNOWN_FIELD', `unknown field ${k}`);
  }
  const { cell, kind, addr, body } = input;
  if (!RANK.has(cell)) throw new PharosError('UNKNOWN_CELL', `unknown cell ${String(cell)}`);
  if (typeof kind !== 'string' || !kind) throw new PharosError('BAD_ENTRY', 'kind must be a non-empty string');
  if (typeof addr !== 'string' || !addr) throw new PharosError('BAD_ENTRY', 'addr must be a non-empty string');
  if (!('body' in input) || body === undefined) throw new PharosError('BAD_ENTRY', 'body is required (use null for none)');
  const of = input.of === undefined ? [] : input.of;
  const basis = input.basis === undefined ? {} : input.basis;
  if (!isStrArr(of)) throw new PharosError('BAD_ENTRY', 'of must be an array of ids');
  if (!isObj(basis)) throw new PharosError('BAD_ENTRY', 'basis must be an object');
  canonical(body); canonical(basis); // reject non-JSON early

  const v = view(h);
  const kinds = declaredKinds(v);
  const decl = kinds.get(kind) || (BOOT[kind] ? { name: kind, cell: BOOT[kind] } : null);
  if (!decl) throw new PharosError('UNDECLARED_KIND', `kind ${kind} is not declared in this pharos`);
  if (decl.cell !== cell) throw new PharosError('KIND_CELL_MISMATCH', `kind ${kind} is declared at ${decl.cell}, not ${cell}`);
  const hasFrame = [...v.entries.values()].some((e) => e.kind === 'frame');
  if (kind === 'frame' && hasFrame) throw new PharosError('FRAME_EXISTS', 'this pharos already has a frame');
  if (kind !== 'frame' && !hasFrame) throw new PharosError('NO_FRAME', 'the first entry of a pharos is its frame');
  for (const id of of) if (!v.entries.has(id)) throw new PharosError('UNKNOWN_OF', `of references unknown entry ${id}`);
  if (kind === 'retract' && !of.length) throw new PharosError('BAD_ENTRY', 'retract needs of: the ids it retracts');
  if (kind === 'kind') {
    if (!isObj(body) || typeof body.name !== 'string' || !RANK.has(body.cell)) throw new PharosError('BAD_KIND', 'kind body needs {name, cell} with a known cell');
    const prior = kinds.get(body.name) || (BOOT[body.name] && { cell: BOOT[body.name] });
    if (prior && prior.cell !== body.cell) throw new PharosError('KIND_REDECLARED', `kind ${body.name} is already declared at ${prior.cell}`);
  }
  if (kind === 'holon') {
    if (!isObj(body) || typeof body.name !== 'string') throw new PharosError('BAD_HOLON', 'holon body needs a name');
    for (const k of ['ground', 'figure', 'pattern', 'out']) if (k in body && !isStrArr(body[k])) throw new PharosError('BAD_HOLON', `holon ${k} must be an array of kind names`);
  }

  const ofSorted = [...new Set(of)].sort();
  // Identical content from the same writer is the same weft: re-weaving is a no-op (unless it was retracted).
  const key = canonical({ cell, kind, addr, body, of: ofSorted, basis, by: h.by });
  // Not a no-op once a later live entry at the same addr+cell has changed the value (x=1, x=2, x=1 is a revert).
  const superseded = (e) => {
    const lo = v.idx.get(e.id), mine = canonical(e.body);
    for (let i = lo + 1; i < v.order.length; i++) {
      const c = v.order[i];
      if (c.addr !== e.addr || c.cell !== e.cell || c.kind === 'retract' || v.retracted.has(c.id) || canonical(c.body) === mine) continue;
      const anc = new Set();
      walkBack(v, c.id, lo, anc);
      if (anc.has(e.id)) return true;
    }
    return false;
  };
  for (const e of v.entries.values()) {
    if (e.addr !== addr || e.cell !== cell || e.kind !== kind || e.by !== h.by || v.retracted.has(e.id)) continue;
    if (canonical({ cell: e.cell, kind: e.kind, addr: e.addr, body: e.body, of: e.of, basis: e.basis, by: e.by }) === key && !superseded(e)) return e;
  }
  const entry = { v: 1, cell, kind, addr, body, of: ofSorted, basis, seen: v.frontier, by: h.by, at: new Date().toISOString() };
  entry.id = entryId(entry);
  // S2: a woven entry's `seen` is the frontier of everything this writer could see, its own file included, so it
  // descends from every earlier valid record of that file: the chained bit is true by construction (checked in S2-4).
  appendEntries(h, [entry], { chained: true });
  return entry;
}

// weaveMany(h, inputs) — the BULK path for a giver that writes many unrelated entries at once (a
// dictionary, a lexicon, a corpus). Validates the essentials (cell/kind/addr/body) like weave, but
// skips the causal frontier: a dictionary's definitions are not causally ordered, so `seen` is empty
// and the entries are appended UNCHAINED in one batch (a merge or a conversion writes version 1, and
// a reader never early-stops inside an unchained stretch). One append, not N weaves — weave is O(n^2)
// for a bulk write because it re-reads the log for each frontier.
export function weaveMany(h, inputs) {
  if (!Array.isArray(inputs) || !inputs.length) return 0;
  const ents = bulkEntries(h, inputs);
  appendEntries(h, ents, { chained: false });
  return ents.length;
}

// weaveUnchained(h, input) — ONE entry by the bulk path: validated like weaveMany, appended unchained, NO view of the log (weave builds the whole view, load + causal order,
// for its frontier on every call: 26 s per write on a log of 214,481 entries), and the entry returned as weave returns it. For acts that are facts of their own (a read
// recorded at the gate), not claims in a causal chain: `seen` is empty and an identical entry written twice is two entries (each read is its own act).
export function weaveUnchained(h, input) {
  const ents = bulkEntries(h, [input]);
  appendEntries(h, ents, { chained: false });
  return ents[0];
}

function bulkEntries(h, inputs) {
  const ents = [];
  for (const input of inputs) {
    if (!isObj(input)) throw new PharosError('BAD_ENTRY', 'weaveMany needs objects');
    const { cell, kind, addr, body } = input;
    if (!RANK.has(cell)) throw new PharosError('UNKNOWN_CELL', `unknown cell ${String(cell)}`);
    if (typeof kind !== 'string' || !kind) throw new PharosError('BAD_ENTRY', 'kind must be a non-empty string');
    if (typeof addr !== 'string' || !addr) throw new PharosError('BAD_ENTRY', 'addr must be a non-empty string');
    if (!('body' in input) || body === undefined) throw new PharosError('BAD_ENTRY', 'body is required');
    const of = [...new Set(input.of ?? [])].sort();
    const basis = input.basis ?? {};
    canonical(body); canonical(basis);
    const entry = { v: 1, cell, kind, addr, body, of, basis, seen: [], by: h.by, at: new Date().toISOString() };
    entry.id = entryId(entry);
    ents.push(entry);
  }
  return ents;
}

export function entries(h) { return view(h).order; }

export function fold(h, filter = {}) {
  const v = view(h);
  const ok = (x) => (!filter.cell || x.cell === filter.cell) && (!filter.kind || x.kind === filter.kind) && (!filter.addr || x.addr === filter.addr);
  const live = v.order.filter((e) => e.kind !== 'retract' && !v.retracted.has(e.id));
  return {
    entries: live.filter(ok),
    retractions: v.retractions,
    conflicts: findConflicts(v, live).filter((c) => (!filter.cell || c.cell === filter.cell) && (!filter.addr || c.addr === filter.addr)),
    corrupt: v.corrupt,
    frontier: v.frontier,
  };
}

export function frame(h) {
  const v = view(h);
  const fs_ = v.order.filter((e) => e.kind === 'frame' && !v.retracted.has(e.id));
  if (!fs_.length) return null;
  const [f, ...rest] = fs_;
  const one = (e) => { const b = isObj(e.body) ? e.body : {}; return { id: e.id, name: b.name, writer: e.by, epoch: b.epoch, assumed: b.assumed || [] }; };
  return { ...one(f), merged: rest.map(one) };
}

export function ground(h) {
  const v = view(h);
  const live = v.order.filter((e) => !v.retracted.has(e.id));
  return {
    frame: frame(h),
    kinds: [...declaredKinds(v).values()],
    holons: live.filter((e) => e.kind === 'holon').map((e) => ({ id: e.id, ...e.body })),
    frontier: v.frontier,
  };
}

export function status(h) {
  const v = view(h);
  const live = v.order.filter((e) => e.kind !== 'retract' && !v.retracted.has(e.id));
  return {
    name: h.name, dir: h.dir, entries: v.entries.size, live: live.length, retracted: v.retracted.size,
    writers: v.writers, frontier: v.frontier, conflicts: findConflicts(v, live).length,
    corrupt: v.corrupt.length, dangling: v.dangling,
    frames: v.order.filter((e) => e.kind === 'frame').length,
  };
}

// Calls fn(entry) for entries this watcher has not yet seen. Starts from now unless since is
// 'beginning' (replay all) or an array of ids to treat as already seen. No daemon: fs.watch + poll().
export function watch(h, opts, fn) {
  const { cell, kind, since } = opts || {};
  const seen = new Set(Array.isArray(since) ? since : since === 'beginning' ? [] : load(h).entries.keys());
  const poll = () => {
    let n = 0;
    for (const e of view(h).order) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      if ((cell && e.cell !== cell) || (kind && e.kind !== kind)) continue;
      fn(e); n++;
    }
    return n;
  };
  let timer = null, w = null;
  try { w = fs.watch(h.dir, { persistent: false }, () => { clearTimeout(timer); timer = setTimeout(poll, 25); }); } catch (err) { /* poll() still works */ }
  return { poll, stop() { clearTimeout(timer); if (w) w.close(); } };
}

// Union of B into A, appended verbatim to A's own writer file. Grow-only, so idempotent,
// commutative and associative on the set of entries.
export function merge(hA, hB) {
  const A = load(hA), B = load(hB);
  const add = [];
  for (const [id, e] of B.entries) if (!A.entries.has(id)) add.push(e);
  appendEntries(hA, add);
  let blobs = 0;
  for (const [hash] of B.blobs) if (!A.blobs.has(hash)) { const b = getBlob(hB, hash); if (b) { putBlob(hA, b); blobs += 1; } }
  return { added: add.length, ...(blobs ? { blobs } : {}) };
}

/** convertFile(src, dst): one writer file to the other format, entries in their file order; corrupt input is reported,
 *  never carried. JSONL -> PHB -> JSONL reproduces every valid line byte for byte (PREREG-S1 B1). */
export function convertFile(src, dst) {
  const dir = path.dirname(path.resolve(src)), f = path.basename(src);
  CACHE.delete(path.join(dir, f));
  const c = parseFile(dir, f);
  if (fs.existsSync(dst)) throw new PharosError('EXISTS', `${dst} exists; convert never overwrites`);
  if (dst.endsWith('.phb')) appendRecords(dst, path.basename(dst, '.phb'), [...c.ents.map((e) => [REC.ENTRY, encodeEntry(e)]), ...[...c.blobs.keys()].map((k) => [REC.BLOB, getBlobFrom(dir, c.blobs.get(k))])]);
  else if (dst.endsWith('.jsonl')) { if (c.ents.length) fs.writeFileSync(dst, c.ents.map((e) => canonical(e)).join('\n') + '\n'); else fs.writeFileSync(dst, ''); }
  else throw new PharosError('BAD_FORMAT', 'destination must end .jsonl or .phb');
  return { entries: c.ents.length, blobs: c.blobs.size, corrupt: c.corrupt.length };
}
const getBlobFrom = (dir, at) => fs.readFileSync(path.join(dir, at.file)).subarray(at.offset, at.offset + at.length);

// ---- S2: heads at one address, the full way and the backward way --------------------------------------------------
// PREREG-S2 (ledgers/pharos-binary). heads(addr, cell) = the live entries at (addr, cell) that no other live entry at the
// same (addr, cell) descends from, retractions applied as fold applies them.
function headsIn(entries, order, addr, cell) {
  const retracted = new Set();
  for (let i = order.length - 1; i >= 0; i--) { const e = order[i]; if (e.kind === 'retract' && !retracted.has(e.id)) for (const t of e.of) retracted.add(t); }
  const group = order.filter((e) => e.addr === addr && e.cell === cell && e.kind !== 'retract' && !retracted.has(e.id));
  const ancOf = (id) => { const seen = new Set(), st = [id]; while (st.length) for (const q of preds(entries.get(st.pop()), entries)) if (!seen.has(q)) { seen.add(q); st.push(q); } return seen; };
  const below = new Set(); for (const g of group) for (const a of ancOf(g.id)) below.add(a);
  return group.filter((g) => !below.has(g.id));
}
/** The reference: heads from the full view. */
export function heads(h, addr, cell) { const v = view(h); return headsIn(v.entries, v.order, addr, cell).map((e) => e.id).sort(); }

/** askHeads: read every writer file BACKWARD, a record at a time, and stop only on proof (PREREG-S2):
 *  exactly one live head candidate at (addr, cell) among what was read, and in EVERY file not yet read to its start,
 *  the oldest record read is CHAINED (it attests that it descends from every earlier entry record of its file: weave
 *  writes it true by construction; this reader trusts the attestation, it does not re-derive it) and is a provable
 *  ancestor of that head. Then every unread entry is an ancestor of the head: superseded, unable to retract it, and
 *  not a rival head. JSONL files are read whole. Any damage met on the way: the answer falls back to the full view.
 *  Cost: ancestry of the head is kept incrementally; the heads are recomputed when a record at (addr, cell) or a
 *  retraction aimed at one is read, and once per round while more than one candidate stands (a record elsewhere can
 *  complete the path between two of them). */
export function askHeads(h, addr, cell) {
  const files = fs.existsSync(h.dir) ? fs.readdirSync(h.dir).filter((f) => f.endsWith('.jsonl') || f.endsWith('.phb')).sort() : [];
  const read = new Map(), group = [], groupIds = new Set(), retracts = [], st = [];
  let touched = 0, total = 0, dirty = false, hcId = null, anc = new Set(), cands = [];
  const closeAll = () => { for (const s0 of st) if (s0.fd != null) { try { fs.closeSync(s0.fd); } catch (err) { /* already closed */ } s0.fd = null; } };
  const fallback = (why) => { closeAll(); return { heads: heads(h, addr, cell), touched: total, total, early: false, fallback: why }; };
  const expand = (id0) => { const stk = [id0]; while (stk.length) { const e = read.get(stk.pop()); if (!e) continue; for (const q of e.seen) if (!anc.has(q)) { anc.add(q); stk.push(q); } for (const q of e.of) if (!anc.has(q)) { anc.add(q); stk.push(q); } } };
  const admit = (e) => {
    if (read.has(e.id)) return;
    read.set(e.id, e);
    if (anc.size && anc.has(e.id)) expand(e.id);
    if (e.kind === 'retract') { retracts.push(e); if (e.of.some((t) => groupIds.has(t) || retracts.some((r) => r.id === t))) dirty = true; }
    else if (e.addr === addr && e.cell === cell) { group.push(e); groupIds.add(e.id); dirty = true; }
  };
  // a retraction is effective unless an effective retraction retracts it (retractors are causally later)
  const gone = () => {
    const memo = new Map(), eff = (r) => { if (memo.has(r.id)) return memo.get(r.id); memo.set(r.id, false); const v = !retracts.some((r2) => r2 !== r && r2.of.includes(r.id) && eff(r2)); memo.set(r.id, v); return v; };
    const out = new Set(); for (const r of retracts) if (eff(r)) for (const t of r.of) out.add(t); return out;
  };
  const recompute = () => {
    dirty = false;
    const dead = gone(), live = group.filter((g) => !dead.has(g.id));
    if (live.length <= 1) return live;
    const ancOf = new Map();
    for (const o of live) { const a = new Set(), stk = [o.id]; while (stk.length) { const e = read.get(stk.pop()); if (!e) continue; for (const q of [...e.seen, ...e.of]) if (!a.has(q)) { a.add(q); stk.push(q); } } ancOf.set(o.id, a); }
    return live.filter((g) => !live.some((o) => o !== g && ancOf.get(o.id).has(g.id)));
  };
  const proven = (force = false) => {
    // while several candidates stand, reading ANY record can complete the path between two of them (re-checked on a schedule)
    if (dirty || force) { cands = recompute(); if (cands.length === 1) { if (cands[0].id !== hcId) { hcId = cands[0].id; anc = new Set([hcId]); expand(hcId); } } else { hcId = null; anc = new Set(); } }
    return cands.length === 1 && st.every((s0) => s0.done || (s0.oldest && s0.oldestChained && anc.has(s0.oldest.id)));
  };
  for (const f of files) {
    const p = path.join(h.dir, f), size = fs.statSync(p).size; total += size;
    if (f.endsWith('.jsonl')) { const c = parseFile(h.dir, f); touched += size; for (const e of c.ents) admit(e); continue; }
    const fd = fs.openSync(p, 'r'), head = Buffer.alloc(Math.min(size, 4 + 9 + 64)); fs.readSync(fd, head, 0, head.length, 0);
    const hdr = headerLen(head, null); if (!hdr) { fs.closeSync(fd); return fallback(`${f}: not PHB1`); }
    touched += hdr.end;
    st.push({ f, fd, size, end: size, hdrEnd: hdr.end, writer: hdr.writer, done: size <= hdr.end, oldest: null, oldestChained: false });
  }
  // touched = DISTINCT bytes: per PHB file the header plus the suffix read so far (reads overlap by a few bytes)
  const readAt = (s0, from, len) => { const b = Buffer.alloc(len); fs.readSync(s0.fd, b, 0, len, from); s0.low = Math.min(s0.low ?? s0.size, from); return b; };
  const distinct = () => touched + st.reduce((n, s0) => n + (s0.size - Math.max(s0.hdrEnd, s0.low ?? s0.size)), 0);
  const result = (heads, early) => { closeAll(); return { heads, touched: distinct(), total, early }; };
  // peek: decode the next ENTRY record of a file, backward, without admitting it (blobs and resyncs are skipped). Returns a reason on damage.
  const peek = (s0) => {
    s0.peeked = null;
    while (!s0.done) {
      const size = readAt(s0, s0.end - 4, 4).readUInt32BE(0), at = s0.end - size;
      if (size < 13 || at < s0.hdrEnd) return `${s0.f}: bad record size at ${s0.end}`;
      const lead = Math.min(at - s0.hdrEnd, MARKER.length + 12), buf = readAt(s0, at - lead, lead + size);
      const rec = recordAt(buf, lead); if (!rec || rec.end !== buf.length) return `${s0.f}: malformed record at ${at}`;
      const marker = lead >= MARKER.length && buf.subarray(lead - MARKER.length, lead).equals(MARKER);
      const prev = at === s0.hdrEnd ? genesisOf(s0.writer) : marker ? resyncGenesis(s0.writer, at - MARKER.length) : buf.subarray(lead - 12, lead - 4);
      if (!chainOf(prev, rec.kind, rec.payload).equals(rec.chain)) return `${s0.f}: chain broken at ${at}`;
      const newEnd = marker ? at - MARKER.length : at;
      if (rec.kind === REC.ENTRY) {
        let e; try { e = decodeEntry(rec.payload); } catch (err) { return `${s0.f}: undecodable at ${at}`; }
        if (invalid(e)) return `${s0.f}: invalid entry at ${at}`;
        s0.peeked = { e, chained: rec.payload[0] === 2, newEnd }; return null;
      }
      s0.end = newEnd; if (s0.end <= s0.hdrEnd) s0.done = true;
    }
    return null;
  };
  if (proven()) return result([hcId], st.some((s0) => !s0.done));
  for (const s0 of st) { const why = peek(s0); if (why) return fallback(why); }
  let since = 0;
  for (;;) {
    // newest first across files: advance the file whose next record has the latest `at` (an ordering hint only; the stop proof is structural)
    let pick = null;
    for (const s0 of st) if (s0.peeked && (!pick || s0.peeked.e.at > pick.peeked.e.at)) pick = s0;
    if (!pick) { cands = recompute(); return result(cands.map((e) => e.id).sort(), false); }
    const { e, chained, newEnd } = pick.peeked;
    admit(e); pick.oldest = e; pick.oldestChained = chained; pick.end = newEnd; if (pick.end <= pick.hdrEnd) pick.done = true;
    const why = peek(pick); if (why) return fallback(why);
    since++;
    const force = cands.length > 1 && since >= Math.max(st.length, Math.ceil(read.size * 0.05));
    if (force) since = 0;
    if (proven(force)) return result([hcId], st.some((s0) => !s0.done));
  }
}

/** The JSONL fold of a pharos: every live entry in causal order, one canonical line each. A projection, never the source. */
export function exportJsonl(h) { return view(h).order.map((e) => canonical(e)).join('\n') + '\n'; }

// ---- install / undo ---------------------------------------------------------

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const libHash = () => sha(fs.readFileSync(fileURLToPath(import.meta.url)));

const present = (p) => fs.lstatSync(p, { throwIfNoEntry: false }) !== undefined; // a dangling symlink is present

export function install(dir) {
  const target = path.resolve(dir);
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throw new PharosError('NO_TARGET', `${target} is not a directory`);
  const pj = path.join(target, 'pharos.json'), hj = path.join(target, 'holon.json');
  if (present(pj)) throw new PharosError('ALREADY_INSTALLED', 'pharos.json already exists');
  const written = {}, skipped = [];
  const stub = JSON.stringify({ name: path.basename(target), ground: [], figure: [], pattern: [], out: [] }, null, 2) + '\n';
  const wroteHj = !present(hj);
  if (wroteHj) written['holon.json'] = sha(stub); else skipped.push('holon.json');
  const pointer = JSON.stringify({ v: 1, kind: 'pharos-pointer', lib: fileURLToPath(import.meta.url), sha256: libHash(), wrote: written }, null, 2) + '\n';
  try {
    if (wroteHj) fs.writeFileSync(hj, stub, { flag: 'wx' });
    fs.writeFileSync(pj, pointer, { flag: 'wx' });
  } catch (err) { // all or nothing: never leave a file that undo cannot find
    if (wroteHj) fs.rmSync(hj, { force: true });
    throw err;
  }
  return { written: [...Object.keys(written), 'pharos.json'], skipped };
}

export function undo(dir) {
  const target = path.resolve(dir);
  const pj = path.join(target, 'pharos.json');
  let pointer;
  try { pointer = JSON.parse(fs.readFileSync(pj, 'utf8')); } catch (err) { throw new PharosError('NOT_INSTALLED', 'no readable pharos.json here'); }
  if (!isObj(pointer) || pointer.kind !== 'pharos-pointer' || !isObj(pointer.wrote)) throw new PharosError('NOT_INSTALLED', 'pharos.json is not a pharos pointer');
  const removed = [], kept = [];
  for (const [name, hash] of Object.entries(pointer.wrote)) {
    const p = path.join(target, path.basename(name));
    if (!fs.existsSync(p)) continue;
    if (sha(fs.readFileSync(p)) === hash) { fs.unlinkSync(p); removed.push(name); } else kept.push(name); // edited since: no longer ours
  }
  fs.unlinkSync(pj);
  removed.push('pharos.json');
  return { removed, kept };
}
