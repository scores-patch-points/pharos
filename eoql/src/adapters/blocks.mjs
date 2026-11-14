// adapters/blocks.mjs: `blocks:<dir>`, a REAL pharos-blocks store (ledgers/pharos-blocks/FORMAT.md, format version 1).
// A store is a directory of `w.<writer>.<seg:06d>.blk` files (append only, 64-byte file header, records of 80-byte header +
// meta + payload, chained by sha256, header crc32), plus RETIRED (skipped files), pagetable.bin (derived, disposable, never
// read here) and quarantine/. An entry is one record: kind 1 (data), medium 1 (json), codec 1, meta {src, writer, line},
// payload = the entry's JSON bytes. Objects over 4 MiB are a kind 2 manifest plus kind 3 chunks (decoded and encoded here).
// Reading never modifies the store. Everything wrong is EVIDENCE (SPEC 1.6.4), never a crash and never silent:
//   blocks-chain-break, blocks-id-mismatch, blocks-header-repaired, blocks-bad-file-header, blocks-non-entry,
//   blocks-unknown-kind, blocks-torn-tail (in `health.torn`), blocks-retired-file.
// The BUILDER's own earlier layout (BLOCKS.jsonl) is gone: it did not decode a real store (BUILD_NOTES, round 3).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { Source } from '../source.mjs';
import { EoqlError } from '../errors.mjs';
import { sha256, canonical } from '../util.mjs';
import { invalidReason } from '../jsonl.mjs';

export const FILE_MAGIC = Buffer.from('PHBLKv1\n', 'latin1');
export const FILE_HDR = 64;
export const HDR = 80;
export const SYNC = 0xb7;
export const CHUNK = 4 * 1024 * 1024;
export const KIND = { DATA: 1, MANIFEST: 2, CHUNK: 3, RETRACT: 4, NOTE: 5 };
export const MEDIUM = { raw: 0, json: 1, jsonl: 2, text: 3, png: 4, jpeg: 5, wav: 6, mp4: 7 };
export const WRITER_RE = /^[A-Za-z0-9_-]{1,48}$/;
const FILE_RE = /^w\.([A-Za-z0-9_-]{1,48})\.(\d{6})\.blk$/;

const crc32 = (b) => zlib.crc32(b);
const sha = (b) => crypto.createHash('sha256').update(b).digest();
export const chainSeed = (fileHeader) => sha(fileHeader).subarray(0, 16);
function chainNext(prev, hb) {
  const s = Buffer.alloc(64);
  prev.copy(s, 0, 0, 16); hb.copy(s, 16, 24, 56); hb.copy(s, 48, 0, 16);
  return sha(s).subarray(0, 16);
}
const headerCrcOk = (b) => b[0] === SYNC && crc32(b.subarray(0, 72)) === b.readUInt32LE(72);
function tryCorrect(hb) {
  const c = Buffer.from(hb.subarray(0, HDR));
  for (let bit = 0; bit < 76 * 8; bit++) {
    c[bit >> 3] ^= 1 << (bit & 7);
    if (headerCrcOk(c)) return c;
    c[bit >> 3] ^= 1 << (bit & 7);
  }
  return null;
}
function idOf(kind, medium, codec, meta, payload) {
  const p = Buffer.alloc(9);
  p[0] = kind; p.writeUInt16LE(medium, 1); p.writeUInt16LE(codec, 3); p.writeUInt32LE(meta.length, 5);
  return crypto.createHash('sha256').update(p).update(meta).update(payload).digest();
}
export function encodeFileHeader(writer, seg) {
  const b = Buffer.alloc(FILE_HDR);
  FILE_MAGIC.copy(b, 0); b.writeUInt16LE(1, 8); b.writeUInt32LE(seg, 12); b.write(writer, 16, 48, 'utf8');
  return b;
}
// one record as bytes; returns {buf, chain, id}
function encodeRecord({ kind, medium, codec, meta, payload, time }, prevChain) {
  const hb = Buffer.alloc(HDR);
  const id = idOf(kind, medium, codec, meta, payload);
  hb[0] = SYNC; hb[1] = kind; hb.writeUInt16LE(0, 2); hb.writeUInt16LE(medium, 4); hb.writeUInt16LE(codec, 6);
  hb.writeUInt32LE(payload.length, 8); hb.writeUInt32LE(meta.length, 12); hb.writeDoubleLE(Number.isFinite(time) ? time : 0, 16);
  id.copy(hb, 24); hb.fill(0, 56, 72); hb.writeUInt32LE(0, 76);
  const chain = chainNext(prevChain, hb); chain.copy(hb, 56);
  hb.writeUInt32LE(crc32(hb.subarray(0, 72)), 72);
  return { buf: Buffer.concat([hb, meta, payload]), chain, id };
}

// ---- reading one store ------------------------------------------------------------------------------------------------
// -> { files:[{name, writer, seg, items:[{kind:'entry'|'invalid', text, e?, reason?}]}], evidence, torn, bytes, records, retired }
export function readStore(dir) {
  const evidence = []; const torn = []; const files = [];
  let bytes = 0, records = 0;
  const names = fs.readdirSync(dir).filter((n) => FILE_RE.test(n)).sort((a, b) => {
    const ma = FILE_RE.exec(a), mb = FILE_RE.exec(b);
    return ma[1] < mb[1] ? -1 : ma[1] > mb[1] ? 1 : Number(ma[2]) - Number(mb[2]);
  });
  const retired = new Set();
  try { for (const l of fs.readFileSync(path.join(dir, 'RETIRED'), 'utf8').split('\n')) { const n = l.split('\t')[0]; if (n) retired.add(n); } } catch (e) { /* none */ }
  const chunks = new Map(); // hex id -> Buffer (kind 3 payloads, store wide)
  const pendingManifests = [];
  for (const name of names) {
    if (retired.has(name)) { evidence.push({ reason: 'blocks-retired-file', where: name, detail: 'listed in RETIRED; skipped' }); continue; }
    const m = FILE_RE.exec(name);
    let buf;
    try { buf = fs.readFileSync(path.join(dir, name)); } catch (e) { evidence.push({ reason: 'blocks-bad-file-header', where: name, detail: `cannot read: ${e.code || e.message}` }); continue; }
    bytes += buf.length;
    const f = { name, writer: m[1], seg: Number(m[2]), items: [] };
    files.push(f);
    if (buf.length < FILE_HDR || !buf.subarray(0, 8).equals(FILE_MAGIC)) { evidence.push({ reason: 'blocks-bad-file-header', where: name, detail: 'magic mismatch or file shorter than its header' }); continue; }
    const hdrWriter = buf.subarray(16, 64).toString('utf8').replace(/\0+$/, '');
    if (hdrWriter !== f.writer || buf.readUInt32LE(12) !== f.seg || buf.readUInt16LE(8) !== 1) evidence.push({ reason: 'blocks-bad-file-header', where: name, detail: 'writer, segment or version in the header differs from the file name' });
    let chain = chainSeed(buf.subarray(0, FILE_HDR));
    let off = FILE_HDR; let n = 0;
    while (off < buf.length) {
      if (off + HDR > buf.length) { torn.push({ file: name, line: n + 1, reason: 'torn tail: fewer bytes than a header' }); break; }
      let hb = buf.subarray(off, off + HDR);
      if (!headerCrcOk(hb)) {
        const fix = tryCorrect(hb);
        if (!fix) { torn.push({ file: name, line: n + 1, reason: 'torn tail: unframeable header' }); break; }
        evidence.push({ reason: 'blocks-header-repaired', where: `${name} record ${n + 1}`, detail: 'a single-bit correction against the crc was needed' });
        hb = fix;
      }
      const kind = hb[1], medium = hb.readUInt16LE(4), codec = hb.readUInt16LE(6), plen = hb.readUInt32LE(8), mlen = hb.readUInt32LE(12);
      const end = off + HDR + mlen + plen;
      if (end > buf.length) { torn.push({ file: name, line: n + 1, reason: 'torn tail: record shorter than its header says' }); break; }
      n++; records++;
      const meta = buf.subarray(off + HDR, off + HDR + mlen);
      const payload = buf.subarray(off + HDR + mlen, end);
      const where = `${name} record ${n}`;
      const storedId = hb.subarray(24, 56);
      const wantChain = chainNext(chain, hb);
      let refused = false;
      if (!wantChain.equals(hb.subarray(56, 72))) { evidence.push({ reason: 'blocks-chain-break', where, detail: 'stored chain differs from the recomputed chain; the record is refused' }); refused = true; }
      if (!idOf(kind, medium, codec, meta, payload).equals(storedId)) { evidence.push({ reason: 'blocks-id-mismatch', where, detail: 'record id does not match its bytes; the record is refused' }); refused = true; }
      chain = Buffer.from(hb.subarray(56, 72));
      off = end;
      if (refused) continue;
      if (kind === KIND.CHUNK) { chunks.set(storedId.toString('hex'), payload); continue; }
      if (kind === KIND.MANIFEST) { pendingManifests.push({ f, medium, codec, payload, where, slot: f.items.length }); f.items.push(null); continue; }
      if (kind !== KIND.DATA) { evidence.push({ reason: kind === KIND.RETRACT || kind === KIND.NOTE ? 'blocks-non-entry' : 'blocks-unknown-kind', where, detail: `record kind ${kind} carries no entry; not interpreted` }); continue; }
      pushPayload(f, medium, payload, where, evidence);
    }
  }
  // chunked objects: a manifest names its chunks (store wide)
  for (const pm of pendingManifests) {
    const p = pm.payload; let obj = null;
    try {
      const total = Number(p.readBigUInt64LE(8)); const cnt = p.readUInt32LE(16);
      const parts = [];
      for (let i = 0; i < cnt; i++) { const id = p.subarray(20 + i * 36, 52 + i * 36).toString('hex'); const c = chunks.get(id); if (!c) throw new Error('missing chunk'); parts.push(c); }
      obj = Buffer.concat(parts); if (obj.length !== total) throw new Error('length mismatch');
    } catch (e) { evidence.push({ reason: 'blocks-chain-break', where: pm.where, detail: `chunked object cannot be assembled: ${e.message}` }); }
    const tmp = { items: [] };
    if (obj) pushPayload(tmp, pm.medium, obj, pm.where, evidence);
    pm.f.items.splice(pm.f.items.indexOf(null), 1, ...tmp.items);
  }
  for (const f of files) f.items = f.items.filter((x) => x !== null);
  return { files, evidence, torn, bytes, records, retired: [...retired] };
}
function pushPayload(f, medium, payload, where, evidence) {
  if (medium !== MEDIUM.json && medium !== MEDIUM.jsonl && medium !== MEDIUM.text) { evidence.push({ reason: 'blocks-non-entry', where, detail: `medium ${medium} is not an entry` }); return; }
  const text = payload.toString('utf8');
  const parts = medium === MEDIUM.jsonl ? text.split('\n').filter((l) => l.trim()) : [text];
  for (const t of parts) {
    let e = null, reason;
    if (medium === MEDIUM.text) reason = 'not an entry (text medium)';
    else { try { e = JSON.parse(t); reason = invalidReason(e); if (reason) e = null; } catch (err) { reason = 'unparseable payload'; } }
    f.items.push(e ? { kind: 'entry', e, text: t } : { kind: 'invalid', text: t, reason: `undecoded: ${reason}`, medium });
  }
}

export class BlocksSource extends Source {
  constructor(uri, dir) {
    super('blocks', uri);
    this.dir = path.resolve(dir);
    this.canResolve = true; this.writable = false; this.primary = false; this.mergeOnly = true;
    if (!fs.existsSync(this.dir) || !fs.statSync(this.dir).isDirectory()) throw new EoqlError('E_SOURCE', `blocks store does not exist: ${dir}`);
    this._sig = null; this._d = null;
  }
  _signature() {
    const parts = [];
    for (const n of fs.readdirSync(this.dir).sort()) { if (FILE_RE.test(n) || n === 'RETIRED') { const st = fs.statSync(path.join(this.dir, n)); parts.push(`${n}:${st.size}:${st.mtimeMs}`); } }
    return parts.join('|');
  }
  _load() {
    const sig = this._signature();
    if (this._d && sig === this._sig) return this._d;
    const r = readStore(this.dir);
    const items = []; const seen = new Set(); const byId = new Map(); const corrupt = [];
    for (const f of r.files) {
      let ln = 0;
      for (const it of f.items) {
        ln++;
        if (it.kind === 'entry') { if (!seen.has(it.e.id)) { seen.add(it.e.id); items.push({ e: it.e, file: f.writer }); byId.set(it.e.id, it.e); } } else corrupt.push({ file: f.writer, line: ln, reason: it.reason });
      }
    }
    this._sig = sig;
    this._d = { items, byId, health: { corrupt, torn: r.torn, files: r.files.map((f) => f.writer).filter((w, i, a) => a.indexOf(w) === i), extra: dedupEvidence(r.evidence) }, bytes: r.bytes, records: r.records, store: r };
    return this._d;
  }
  readAll() {
    const m = this.m; let hit = m.cache.get('all');
    if (!hit) { const d = this._load(); m.charge(d.bytes, d.records); m.deliver(d.items); hit = { items: d.items, health: d.health }; m.cache.set('all', hit); }
    return hit;
  }
  byId(id) { this.readAll(); return this._d.byId.get(id); }
}
function dedupEvidence(ev) { const k = new Set(); const out = []; for (const x of ev) { const s = canonical(x); if (!k.has(s)) { k.add(s); out.push(x); } } return out; }

// ---- writing ------------------------------------------------------------------------------------------------------------
// the writer-lane file name a store can hold: [A-Za-z0-9_-]{1,48}
export function blocksWriterName(s) {
  let t = String(s).replace(/[^A-Za-z0-9_-]/g, '_');
  if (!t) t = '_';
  if (t.length > 48) t = t.slice(0, 39) + '_' + sha256(String(s)).slice(0, 8);
  return t;
}
function segmentsOf(dir, writer) {
  return fs.readdirSync(dir).map((n) => FILE_RE.exec(n)).filter((m) => m && m[1] === writer).map((m) => Number(m[2])).sort((a, b) => a - b);
}
// the state needed to append to a writer's last segment: {file, seg, chain, size}; torn tails are quarantined and cut
function tailOf(dir, writer) {
  const segs = segmentsOf(dir, writer);
  if (!segs.length) { const hdr = encodeFileHeader(writer, 1); const name = `w.${writer}.000001.blk`; return { name, seg: 1, chain: chainSeed(hdr), fresh: hdr }; }
  const seg = segs[segs.length - 1]; const name = `w.${writer}.${String(seg).padStart(6, '0')}.blk`;
  const file = path.join(dir, name); const buf = fs.readFileSync(file);
  if (buf.length < FILE_HDR || !buf.subarray(0, 8).equals(FILE_MAGIC)) throw new EoqlError('E_SOURCE', `blocks file ${name} has no valid header; refusing to append`);
  let chain = chainSeed(buf.subarray(0, FILE_HDR)); let off = FILE_HDR;
  for (;;) {
    if (off + HDR > buf.length) break;
    const hb = buf.subarray(off, off + HDR);
    if (!headerCrcOk(hb)) break;
    const end = off + HDR + hb.readUInt32LE(12) + hb.readUInt32LE(8);
    if (end > buf.length) break;
    chain = Buffer.from(hb.subarray(56, 72)); off = end;
  }
  if (off < buf.length) { // torn tail: copy it to quarantine/ and cut back (the only in-place operation, FORMAT.md)
    const q = path.join(dir, 'quarantine'); fs.mkdirSync(q, { recursive: true });
    fs.writeFileSync(path.join(q, `${name}.${off}.torn`), buf.subarray(off), { flag: 'w' });
    fs.truncateSync(file, off);
  }
  return { name, seg, chain, fresh: null };
}
function recordsFor(line, e, writer, lineNo) {
  const bytes = Buffer.from(line, 'utf8');
  const metaObj = { src: writer, writer: e && typeof e.by === 'string' ? e.by : writer, line: lineNo };
  const meta = Buffer.from(JSON.stringify(metaObj), 'utf8');
  const time = e && typeof e.at === 'string' ? Date.parse(e.at) : 0;
  if (bytes.length <= CHUNK) return [{ kind: KIND.DATA, medium: MEDIUM.json, codec: 1, meta, payload: bytes, time }];
  const out = []; const ids = [];
  for (let o = 0; o < bytes.length; o += CHUNK) { const c = bytes.subarray(o, Math.min(bytes.length, o + CHUNK)); out.push({ kind: KIND.CHUNK, medium: 0, codec: 0, meta: Buffer.alloc(0), payload: c, time }); ids.push([idOf(KIND.CHUNK, 0, 0, Buffer.alloc(0), c), c.length]); }
  const mp = Buffer.alloc(20 + ids.length * 36);
  mp.writeUInt32LE(1, 0); mp.writeUInt32LE(CHUNK, 4); mp.writeBigUInt64LE(BigInt(bytes.length), 8); mp.writeUInt32LE(ids.length, 16);
  ids.forEach(([id, len], i) => { id.copy(mp, 20 + i * 36); mp.writeUInt32LE(len, 52 + i * 36); });
  out.push({ kind: KIND.MANIFEST, medium: MEDIUM.json, codec: 1, meta, payload: mp, time });
  return out;
}
// an invalid (non-entry) line is kept as a text-medium record so nothing is dropped
function recordsForInvalid(text, writer, lineNo, medium) {
  const md = medium === MEDIUM.json || medium === MEDIUM.jsonl ? medium : MEDIUM.text;
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > CHUNK) throw new EoqlError('E_NOT_REPRESENTABLE', 'a non-entry line over 4 MiB cannot be stored as one text record');
  return [{ kind: KIND.DATA, medium: md === MEDIUM.jsonl ? MEDIUM.json : md, codec: 1, meta: Buffer.from(JSON.stringify({ src: writer, writer, line: lineNo }), 'utf8'), payload: bytes, time: 0 }];
}

// append lines (entry text, or {invalid:text}) to one writer's lane. Identical records are stored once (entry ids already
// present anywhere in the store are skipped). Returns { added, name }.
export function blocksIngest(dir, writerName, lines) {
  fs.mkdirSync(dir, { recursive: true });
  const writer = blocksWriterName(writerName);
  const have = new Set();
  if (segmentsOf(dir, writer).length || fs.readdirSync(dir).some((n) => FILE_RE.test(n))) {
    const r = readStore(dir);
    for (const f of r.files) for (const it of f.items) if (it.kind === 'entry') have.add(it.e.id);
  }
  const t = tailOf(dir, writer);
  let chain = t.chain; const chunksOut = []; let added = 0; let lineNo = 0;
  for (const l of lines) {
    lineNo++;
    let recs;
    if (l !== null && typeof l === 'object' && 'invalid' in l) recs = recordsForInvalid(l.invalid, writer, lineNo, l.medium);
    else {
      let e = null; try { e = JSON.parse(l); } catch (err) { e = null; }
      if (e && invalidReason(e) === null) { if (have.has(e.id)) continue; have.add(e.id); recs = recordsFor(l, e, writer, lineNo); } else recs = recordsForInvalid(l, writer, lineNo);
    }
    for (const r of recs) { const x = encodeRecord(r, chain); chain = x.chain; chunksOut.push(x.buf); }
    added++;
  }
  if (chunksOut.length || t.fresh) {
    const file = path.join(dir, t.name);
    if (t.fresh) fs.writeFileSync(file, Buffer.concat([t.fresh, ...chunksOut]), { flag: 'wx' });
    else fs.appendFileSync(file, Buffer.concat(chunksOut));
    // the page table is derived and disposable (FORMAT.md): a stale one is removed so a reader rebuilds it
    try { fs.rmSync(path.join(dir, 'pagetable.bin'), { force: true }); } catch (e) { /* none */ }
  }
  return { added, name: t.name };
}
