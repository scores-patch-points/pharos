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
  const h = { name, dir, writer, by: writer, file: path.join(dir, writer + '.jsonl') };
  if (opts.frame !== false && !load(h).frames) {
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

// One parsed file, cached by path. Files are append-only, so when only the tail grew (and the cached
// part ended on a newline) just the new bytes are read and checked; otherwise the file is re-parsed.
const CACHE = new Map();
function parseFile(dir, f) {
  const p = path.join(dir, f);
  const st = fs.statSync(p);
  let c = CACHE.get(p);
  if (c && c.ino === st.ino && c.size === st.size && c.mtimeMs === st.mtimeMs) return c;
  const tail = c && c.ino === st.ino && c.complete && st.size > c.size;
  if (!tail) c = { ents: [], corrupt: [], lines: 0, frames: false };
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

// Union of every *.jsonl in the directory, deduped by id. Corrupt lines are reported, never fatal.
function load(h) {
  const entries = new Map();
  const corrupt = [];
  const writers = [];
  let frames = false;
  const files = fs.existsSync(h.dir) ? fs.readdirSync(h.dir).filter((f) => f.endsWith('.jsonl')).sort() : [];
  for (const f of files) {
    let c;
    try { c = parseFile(h.dir, f); } catch (err) { continue; } // vanished between listing and reading
    for (const e of c.ents) if (!entries.has(e.id)) entries.set(e.id, e);
    corrupt.push(...c.corrupt.map((x) => ({ ...x })));
    if (c.frames) frames = true;
    writers.push({ writer: f.slice(0, -6), file: f, entries: c.ents.length });
  }
  return { entries, corrupt, writers, frames };
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
  append(h, [canonical(entry)]);
  return entry;
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
  const a = load(hA).entries;
  const lines = [];
  for (const [id, e] of load(hB).entries) if (!a.has(id)) lines.push(canonical(e));
  append(hA, lines);
  return { added: lines.length };
}

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
