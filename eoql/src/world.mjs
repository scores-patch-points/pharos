// world.mjs: worlds (SPEC 1.2, 1.5): entry-set cores, frames, the ground, and rows(W) (1.4).
import { EoqlError } from './errors.mjs';
import { Fold, slotKey } from './fold.mjs';
import { canonical, isObj, sha256 } from './util.mjs';
import { schemaColumns } from './schema.mjs';
import { BOOT } from './vendor.mjs';
import { wildcardGlob } from './globs.mjs';

export const DEFAULT_FRAME = Object.freeze({ asof: [], schema: 'asof', collapse: null, anc: 'slot', ordering: 'causal', perceiver: [], budget: null, return: null });
export const keyOfEntry = (e) => e.at + '\u0000' + e.id;
export const cmpKey = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// ---- cores: how an entry set comes to be -------------------------------------------------------------------------
export class Core {
  constructor(ix, parent) { this.ix = ix; this.parent = parent || null; this._items = null; this._folds = {}; this.cuts = parent ? parent.cuts : []; this.unseen = parent ? parent.unseen : 0; this.limitedBy = parent ? parent.limitedBy : null; }
  get source() { return this.parent ? this.parent.source : this._source; }
  items() { if (!this._items) this._items = this._compute(); return this._items; }
  fold(ordering = 'causal') {
    if (!this._folds[ordering]) { const f = new Fold(this.items(), ordering); this._folds[ordering] = f; this.ix.cost.entries += 0; }
    return this._folds[ordering];
  }
  health() { return this.parent ? this.parent.health() : this._health || { corrupt: [], torn: [], extra: [], files: [] }; }
  hasSource() { return this.parent ? this.parent.hasSource() : !!this._source; }
  /** how the data is reached, for the plan */
  access() { return this.parent ? this.parent.access() : this._access || { method: 'scan' }; }
}

export class SourceCore extends Core {
  constructor(ix, source, push) {
    super(ix, null);
    this._source = source; this.push = push || null; this._access = { method: 'scan' };
  }
  _compute() {
    const src = this._source; const push = this.push;
    if (push && push.addrs && src.hasRegions()) {
      const items = []; const seen = new Set(); const h = { corrupt: [], torn: [], extra: [], files: [] };
      for (const a of push.addrs) {
        const r = src.region(a, push.kinds || null);
        for (const it of r.items) if (!seen.has(it.e.id)) { seen.add(it.e.id); items.push(it); }
        h.corrupt.push(...r.health.corrupt); h.torn.push(...r.health.torn); h.extra.push(...(r.health.extra || [])); h.files.push(...(r.health.files || []));
      }
      this._health = h; this.ix.seenHealth.push(h); this._access = { method: 'region', addrs: push.addrs, kinds: push.kinds || undefined, files: push.addrs.length === 1 ? undefined : undefined };
      return this.ix.chargeEntries(items);
    }
    const all = src.readAll();
    this._health = all.health; this.ix.seenHealth.push(all.health); this._access = { method: 'scan' };
    return this.ix.chargeEntries(all.items);
  }
}
export class LiteralCore extends Core {
  constructor(ix, items, tag) { super(ix, null); this._lit = items; this._health = { corrupt: [], torn: [], extra: [], files: [] }; this._access = { method: 'table', note: tag || 'literal' }; this._source = null; }
  hasSource() { return false; }
  _compute() { return this._lit; }
  get source() { return null; }
}
export class FilterCore extends Core {
  constructor(ix, parent, fn, extra = {}) { super(ix, parent); this.fn = fn; this.note = extra.note; if (extra.cut) this.cuts = [...parent.cuts, extra.cut]; if (extra.unseenFn) this.unseenFn = extra.unseenFn; }
  _compute() { const r = this.fn(this.parent.items(), this.parent); if (this.unseenFn) this.unseen = this.unseenFn(r, this.parent); return r; }
}
export class MergeCore extends Core {
  constructor(ix, a, b) { super(ix, a); this.b = b; this.cuts = []; }
  _compute() {
    const seen = new Set(); const out = [];
    for (const it of this.parent.items()) if (!seen.has(it.e.id)) { seen.add(it.e.id); out.push(it); }
    for (const it of this.b.items()) if (!seen.has(it.e.id)) { seen.add(it.e.id); out.push(it); }
    return out;
  }
  health() { const a = this.parent.health(), b = this.b.health(); return { corrupt: [...a.corrupt, ...b.corrupt], torn: [...a.torn, ...b.torn], extra: [...(a.extra || []), ...(b.extra || [])], files: [...a.files, ...b.files] }; }
  hasSource() { return this.parent.hasSource() || this.b.hasSource(); }
  get source() { return this.parent.source || this.b.source; }
}

// ---- worlds -----------------------------------------------------------------------------------------------------
export class RawWorld {
  constructor(ix, core, frame) { this.ix = ix; this.core = core; this.frame = frame || { ...DEFAULT_FRAME }; this.raw = true; this._rows = null; }
  fold() { return this.core.fold(this.frame.ordering); }
  withFrame(patch) { return new RawWorld(this.ix, this.core, { ...this.frame, ...patch }); }
  withCore(core) { return new RawWorld(this.ix, core, this.frame); }
  entries() { return this.core.items().map((x) => x.e); }
}
export class DerivedWorld {
  constructor(ix, rows, columns, opts = {}) {
    this.ix = ix; this.rows = rows; this.columns = columns; this.raw = false;
    this.frame = opts.frame || { ...DEFAULT_FRAME }; this.grouping = opts.grouping || null; this.exprHash = opts.exprHash || null; this.catalog = opts.catalog || false;
  }
}

// ---- cuts (1.2) -------------------------------------------------------------------------------------------------
const ISO_START = /^\d{4}-\d\d-\d\dT/;
export function parseCut(c) {
  if (typeof c === 'string') {
    if (/^[0-9a-f]{64}$/.test(c)) return { type: 'idkey', id: c };
    if (ISO_START.test(c)) return { type: 'at', at: c };
    throw new EoqlError('E_FRAME', `cut ${JSON.stringify(c)} is neither an ISO time nor an entry id`);
  }
  if (isObj(c)) {
    const ks = Object.keys(c).sort().join(',');
    if (ks === 'at' && typeof c.at === 'string') return { type: 'at', at: c.at };
    if (ks === 'at,id' && typeof c.at === 'string' && typeof c.id === 'string') return { type: 'atid', at: c.at, id: c.id };
    if (ks === 'ids' && Array.isArray(c.ids) && c.ids.every((x) => typeof x === 'string')) return { type: 'ids', ids: new Set(c.ids) };
    if (ks === 'pos' && Number.isInteger(c.pos) && c.pos >= 0) return { type: 'pos', n: c.pos };
    if (ks === 'past' && Array.isArray(c.past) && c.past.every((x) => typeof x === 'string')) return { type: 'past', ids: c.past };
  }
  throw new EoqlError('E_FRAME', `bad cut ${JSON.stringify(c)}`);
}
export function cutLabel(d) {
  switch (d.type) {
    case 'at': return d.at; case 'atid': return { at: d.at, id: d.id }; case 'idkey': return '#' + d.id;
    case 'ids': return { ids: [...d.ids].sort() }; case 'pos': return { pos: d.n }; case 'past': return { past: [...d.ids].sort() };
    default: return null;
  }
}
// -> { fn(items, parentCore) -> items, cut: {inCut(e), groundPred(e), label} }
export function cutOperator(ix, desc) {
  const state = { sel: null, bound: null };
  const lookup = (id, items) => { for (const it of items) if (it.e.id === id) return it.e; const s = ix.sourceOf && ix.sourceOf(); return s && s.canResolve ? s.byId(id) : undefined; };
  const fn = (items, parent) => {
    switch (desc.type) {
      case 'at': state.bound = (e) => e.at <= desc.at; break;
      case 'atid': state.bound = (e) => cmpKey(e, desc) <= 0; break;
      case 'idkey': {
        const t = lookup(desc.id, items);
        if (!t) throw new EoqlError('E_FRAME', `cut entry ${desc.id} is not in the source`);
        state.bound = (e) => cmpKey(e, t) <= 0; break;
      }
      case 'ids': state.sel = desc.ids; break;
      case 'pos': {
        const f = parent.fold('causal'); state.sel = new Set(); for (let p = 0; p < Math.min(desc.n, f.n); p++) state.sel.add(f.ents[f.ord[p]].id); break;
      }
      case 'past': {
        const f = parent.fold('causal'); const sel = new Set(); const st = [];
        for (const id of desc.ids) { const i = f.idx.get(id); if (i !== undefined && !sel.has(i)) { sel.add(i); st.push(i); } }
        while (st.length) { const x = st.pop(); for (const p of f.preds[x]) if (!sel.has(p)) { sel.add(p); st.push(p); } }
        state.sel = new Set([...sel].map((i) => f.ents[i].id)); break;
      }
      default: throw new EoqlError('E_FRAME', 'bad cut');
    }
    if (state.sel) {
      let mk = null; for (const it of items) if (state.sel.has(it.e.id) && (mk === null || cmpKey(it.e, mk) > 0)) mk = it.e;
      state.maxKey = mk;
      return items.filter((it) => state.sel.has(it.e.id));
    }
    return items.filter((it) => state.bound(it.e));
  };
  const cut = {
    label: cutLabel(desc),
    inCut: (e) => (state.sel ? state.sel.has(e.id) : state.bound ? state.bound(e) : true),
    groundPred: (e) => (state.sel ? (state.maxKey ? cmpKey(e, state.maxKey) <= 0 : false) : state.bound ? state.bound(e) : true),
  };
  return { fn, cut };
}

// ---- the ground (1.2.7): kind declarations and read schemas, read as of a cut ------------------------------------
export class Ground {
  constructor(ix) { this.ix = ix; this.memo = new Map(); }
  _region(addr, kind, pred) {
    const src = this.ix.source;
    const r = src.region(addr, [kind]);
    let items = r.items;
    if (pred) items = items.filter((it) => pred(it.e) || it.e.kind === 'retract' && pred(it.e));
    return this.ix.chargeEntries(items, true);
  }
  decl(name, pred, predKey) {
    const key = 'd|' + name + '|' + predKey;
    if (this.memo.has(key)) return this.memo.get(key);
    let res = null;
    const boot = BOOT[name];
    const items = this._region('kind:' + name, 'kind', pred).filter((it) => it.e.kind === 'kind' || it.e.kind === 'retract');
    if (items.length) {
      const f = new Fold(items);
      const live = [];
      for (let p = 0; p < f.n; p++) { const i = f.ord[p]; const e = f.ents[i]; if (e.kind === 'kind' && !f.isRetracted(i) && isObj(e.body) && e.body.name === name) live.push(e); }
      if (live.length) res = { name, cell: live[0].body.cell, schema: live[live.length - 1].body.schema, id: live[live.length - 1].id, decls: live.length };
    }
    if (!res && boot) res = { name, cell: boot, schema: undefined, id: null, decls: 0 };
    this.memo.set(key, res);
    return res;
  }
  // heads of the read-schema slot of a kind: [{id, read}] ordered by pos
  readSchemas(kind, pred, predKey) {
    const key = 's|' + kind + '|' + predKey;
    if (this.memo.has(key)) return this.memo.get(key);
    const items = this._region('schema:' + kind, 'schema', pred);
    const out = [];
    if (items.length) {
      const f = new Fold(items);
      const slot = f.slotFor('schema:' + kind, 'schema');
      if (slot) {
        const L = slot.members.filter((i) => !f.isRetracted(i));
        for (const i of f.heads(L, 'slot', slot.id)) { const b = f.ents[i].body; if (isObj(b) && isObj(b.read)) out.push({ id: f.ents[i].id, read: b.read, pos: f.pos[i] }); }
        out.sort((a, b) => a.pos - b.pos);
      }
    }
    this.memo.set(key, out);
    return out;
  }
}
export function normalizeCollapse(x) {
  if (x === undefined || x === null) return null;
  const parts = Array.isArray(x) ? x : typeof x === 'string' ? x.split(',') : isObj(x) && typeof x.rule === 'string' ? [x.rule] : [];
  const out = [];
  for (const p0 of parts) {
    const p = typeof p0 === 'string' ? p0.trim() : isObj(p0) && typeof p0.rule === 'string' ? p0.rule : null;
    if (!p) continue;
    const m = { 'causal-latest': 'latest', latest: 'latest', 'effective-latest': 'effective-latest', 'drop-retracted': 'drop-retracted', none: 'none', history: 'history', all: 'all' }[p];
    if (m) out.push(m);
  }
  return out.length ? out : null;
}
export const COLLAPSE_RULES = new Set(['all', 'history', 'none', 'drop-retracted', 'latest', 'effective-latest']);

// ---- rows(W) for a raw world ------------------------------------------------------------------------------------
const SYS = ['_id', '_slot', '_addr', '_kind', '_cell', '_by', '_at', '_v', '_file', '_of', '_seen', '_basis', '_pos', '_head', '_retracted', '_retracted_by', '_held', '_determined', '_incomplete', '_src'];
export const SYS_COLS = SYS;

export function rawRows(world) {
  if (world._rows) return world._rows;
  const ix = world.ix;
  const fold = world.fold();
  const fr = world.frame;
  const ground = ix.ground;
  const src = ix.source;
  const cuts = world.core.cuts;
  const gpred = fr.schema === 'latest' ? null : (cuts.length ? (e) => cuts.every((c) => c.groundPred(e)) : null);
  const gkey = fr.schema === 'latest' ? 'latest' : cuts.map((c) => canonical(c.label)).join('&');
  const health = world.core.health();
  const evGlobal = ix.globalEvidence(health);
  const kindInfo = new Map();
  const infoFor = (kind) => {
    let k = kindInfo.get(kind);
    if (!k) {
      const d = ground.decl(kind, gpred, gkey);
      const cols = d ? schemaColumns(d.schema) : null;
      let rules = fr.collapse;
      let windowInfo = null;
      if (!rules) {
        const rs = ground.readSchemas(kind, gpred, gkey);
        let chosen = null;
        if (isObj(fr.schema) && fr.schema.window !== undefined) {
          chosen = rs.find((r) => (typeof r.read.window === 'string' ? r.read.window : isObj(r.read.window) ? r.read.window.name : null) === fr.schema.window) || null;
          if (!chosen) throw new EoqlError('E_FRAME', `kind ${kind} has no read-schema window named ${fr.schema.window}`);
        } else if (rs.length) {
          chosen = rs[rs.length - 1];
          if (rs.length > 1) ix.gap('W_SCHEMA_HELD', `kind ${kind} has ${rs.length} concurrent read schemas; the later by position governs`, 1);
        }
        if (chosen) { rules = normalizeCollapse(chosen.read.collapse); windowInfo = chosen.read.window; }
      }
      k = { decl: d, cols, rules: rules || ['none'], windowInfo };
      kindInfo.set(kind, k);
    }
    return k;
  };
  const ents = fold.ents;
  const evCache = new Map();
  const slotEvidence = (slot) => {
    if (evCache.has(slot.id)) return evCache.get(slot.id);
    const ev = [];
    const missing = new Map(); // id -> class
    for (const i of slot.members) {
      const e = ents[i];
      for (const id of e.of) if (!fold.idx.has(id)) missing.set(id, null);
      for (const id of e.seen) if (!fold.idx.has(id)) missing.set(id, null);
    }
    if (missing.size) {
      const dang = [], open = [], unres = [];
      for (const id of missing.keys()) {
        if (!src || !src.canResolve) { unres.push(id); continue; }
        const x = src.byId(id);
        if (!x) dang.push(id);
        else if (cuts.length && !cuts.every((c) => c.inCut(x))) open.push(id);
      }
      if (dang.length) ev.push({ reason: 'dangling', where: `${slot.addr} ${slot.kind}`, ids: dang.sort() });
      if (open.length) ev.push({ reason: 'cut-open', where: `${slot.addr} ${slot.kind}`, ids: open.sort() });
      if (unres.length) { ev.unresolved = unres; ix.noteUnresolved(unres); }
    }
    for (const c of health.corrupt) if (ix.corruptApplies(src, c, slot.addr)) { ev.push({ reason: 'corrupt-line', where: `${c.file}:${c.line}`, detail: c.reason }); }
    evCache.set(slot.id, ev);
    return ev;
  };
  const rows = [];
  const bodyKeys = new Set();
  const kindsSeen = new Set();
  const collapsed = { slots: 0, discarded: 0, rules: new Set() };
  const voids = [];
  let sysEvidence = null;
  const slotList = fold.slots;
  const wantAll = fr.collapse && fr.collapse.includes('all');
  for (const slot of slotList) {
    const k = infoFor(slot.kind);
    const proj = fold.project(slot, k.rules, fr.anc);
    if (proj.void) voids.push({ reason: 'void', slot: [slot.addr, slot.kind] });
    if (proj.latest) { collapsed.slots++; collapsed.discarded += Math.max(0, proj.held - 1); for (const r of k.rules) if (r === 'latest' || r === 'effective-latest') collapsed.rules.add(r); }
    if (!proj.entries.length) continue;
    const ev = slotEvidence(slot);
    const inc = ev.length || evGlobal.length ? [...ev, ...evGlobal] : null;
    kindsSeen.add(slot.kind);
    for (const i of proj.entries) rows.push(makeRow(fold, i, slot, proj, inc, k));
  }
  if (wantAll) { // retract entries as their own slots (SQL-catalog compatibility)
    const byAddr = new Map();
    for (let p = 0; p < fold.n; p++) { const i = fold.ord[p]; if (ents[i].kind === 'retract') (byAddr.get(ents[i].addr) || byAddr.set(ents[i].addr, []).get(ents[i].addr)).push(i); }
    for (const [addr, list] of byAddr) {
      const slot = { id: -1, addr, kind: 'retract', members: list };
      const inc = evGlobal.length ? [...evGlobal] : null;
      for (const i of list) rows.push(makeRow(fold, i, slot, { held: list.length, headSet: new Set(list) }, inc, { cols: null, decl: null }));
      kindsSeen.add('retract');
    }
  }
  rows.sort((a, b) => a.c._pos - b.c._pos || (a.c._id < b.c._id ? -1 : 1));
  // body columns
  const colList = [...SYS, 'body'];
  const colSet = new Set(colList);
  const declared = [];
  for (const kd of kindsSeen) { const k = infoFor(kd); if (k.cols) declared.push(k.cols); }
  const extraCols = new Set();
  for (const r of rows) { const b = r.c.body; if (isObj(b)) for (const key of Object.keys(b)) { if (!key.startsWith('_') && !colSet.has(key)) extraCols.add(key); } }
  if (kindsSeen.size === 1 && declared.length === 1) {
    for (const c of declared[0]) { colSet.add(c.name); colList.push(c.name); }
  } else {
    const names = new Set(); for (const d of declared) for (const c of d) names.add(c.name); for (const k of extraCols) names.add(k);
    for (const n of [...names].sort()) if (!colSet.has(n)) { colSet.add(n); colList.push(n); }
  }
  void bodyKeys; void sysEvidence;
  for (const r of rows) {
    const b = r.c.body;
    const k = infoFor(r.m.slot ? r.m.slot[1] : '');
    if (k.cols) { for (const col of k.cols) { if (colSet.has(col.name)) r.c[col.name] = isObj(b) && Object.prototype.hasOwnProperty.call(b, col.key) ? b[col.key] : null; } } else if (isObj(b)) { for (const key of Object.keys(b)) if (!key.startsWith('_') && colSet.has(key)) r.c[key] = b[key]; }
  }
  if (fr.ordering === 'key') {
    let inv = 0;
    for (const r of rows) {
      const i = fold.idx.get(r.c._id); const e = ents[i];
      for (const p of fold.preds[i]) if (cmpKey(ents[p], e) > 0) { r.m.det = false; inv++; break; }
    }
    ix.gap('W_ORDER_KEY', 'ordering: key uses the clock stand-in (at, id) instead of the causal order', 1);
    if (inv) ix.finding({ reason: 'inversion', count: inv });
  }
  const out = { rows, columns: colList, collapsed, voids, fold };
  world._rows = out;
  ix.noteCollapsed(collapsed);
  for (const v of voids) ix.finding(v);
  const anySlotRowsHeld = rows.some((r) => r.c._held >= 2 && src);
  if (fr.anc === 'slot' && anySlotRowsHeld) {
    // W_ANC_SLOT: slot-ancestry held >= 2 where a link leaves the slot
    let n = 0; const seenSlots = new Set();
    for (const r of rows) {
      if (r.c._held < 2) continue; const key = r.c._slot; if (seenSlots.has(key)) continue; seenSlots.add(key);
      const slot = fold.slotFor(r.c._addr, r.c._kind);
      if (slot && slot.members.some((i) => ents[i].of.some((id) => fold.slotOf[fold.idx.get(id) ?? 0] !== slot.id || !fold.idx.has(id)) || ents[i].seen.length)) n++;
    }
    if (n) ix.gap('W_ANC_SLOT', 'anc: slot reported held slots that have links leaving the slot; anc: full could answer differently', n);
  }
  return out;
}

function makeRow(fold, i, slot, proj, inc, k) {
  const e = fold.ents[i];
  const held = proj.held;
  const incomplete = inc ? 1 : 0;
  const c = {
    _id: e.id, _slot: JSON.stringify([e.addr, slot.kind === 'retract' && slot.id === -1 ? 'retract' : e.kind]), _addr: e.addr, _kind: e.kind, _cell: e.cell, _by: e.by, _at: e.at, _v: e.v,
    _file: fold.fileOf(i) ?? null, _of: e.of, _seen: e.seen, _basis: e.basis, _pos: fold.pos[i],
    _head: proj.headSet.has(i) ? 1 : 0, _retracted: fold.isRetracted(i) ? 1 : 0, _retracted_by: fold.retractedBy.get(e.id) ?? null,
    _held: held, _determined: held === 1 && !incomplete ? 1 : 0, _incomplete: incomplete, _src: [e.id],
    body: e.body,
  };
  return { c, m: { held, inc, src: [e.id], slot: [e.addr, e.kind], key: e.id } };
}

export { slotKey, wildcardGlob, sha256 };
