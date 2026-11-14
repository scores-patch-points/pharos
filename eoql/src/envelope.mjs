// envelope.mjs: the result envelope (SPEC 5.1).
import { canonical, sha256, idsDigest } from './util.mjs';
import { plain, columnType } from './val.mjs';
import { print, hash } from './print.mjs';
import { VERSION } from './errors.mjs';
import { rawRows } from './world.mjs';

const POINTER_COLS = ['_id', '_slot', '_addr', '_kind', '_held', '_determined', '_incomplete', '_src'];

export function buildEnvelope(ix, world, node, opts) {
  const { rows, columns } = ix.rowsOf(world);
  const ret = ix.returnSet || (world.frame && world.frame.return) || opts.return || null;
  const cols = ret === 'pointers' ? columns.filter((c) => POINTER_COLS.includes(c)) : columns;
  const outRows = []; const rowMeta = [];
  const evidence = []; const evSeen = new Set();
  let extra = 0, maxHeld = 0; const heldSlots = new Set();
  let determined = true;
  for (const r of rows) {
    const o = {};
    for (const c of cols) { const v = r.c[c]; o[c] = v === undefined ? null : plain(v); }
    outRows.push(o);
    const inc = !!(r.m.inc && r.m.inc.length);
    const det = r.m.held === 1 && !inc && r.m.det !== false && r.m.held !== 0;
    if (!det) determined = false;
    rowMeta.push({ held: r.m.held, determined: det, incomplete: inc, src: r.m.src, slot: r.m.slot });
    if (r.m.held >= 2) { const k = r.m.slot ? canonical(r.m.slot) : r.c._id; if (!heldSlots.has(k)) { heldSlots.add(k); extra += r.m.held - 1; } if (r.m.held > maxHeld) maxHeld = r.m.held; }
    if (inc) for (const e of r.m.inc) { const k = canonical(e); if (!evSeen.has(k)) { evSeen.add(k); evidence.push(e); } }
  }
  // a negative result carries the evidence of the whole source (1.6)
  if (!rows.length) {
    const h = world.raw ? world.core.health() : null;
    const base = ix.handle.source ? ix.globalEvidence((h || ix.sourceHealth())) : [];
    for (const e of base) { const k = canonical(e); if (!evSeen.has(k)) { evSeen.add(k); evidence.push(e); } }
    if (ix.source && ix.source.canResolve) {
      const all = ix.source.readAll(); const have = new Set(all.items.map((it) => it.e.id)); const miss = new Set();
      for (const it of all.items) for (const id of [...it.e.of, ...it.e.seen]) if (!have.has(id)) miss.add(id);
      if (miss.size) { const e = { reason: 'dangling', where: 'source', ids: [...miss].sort() }; const k = canonical(e); if (!evSeen.has(k)) { evSeen.add(k); evidence.push(e); } }
    }
  }
  const incomplete = evidence.length ? { over: evidence } : null;
  if (incomplete) determined = false;
  if (!rows.length && !incomplete) determined = true;
  const columnsOut = cols.map((c) => ({ name: c, type: columnType(rows.map((r) => r.c[c])) }));
  if (ix.unresolved.size) ix.gap('W_UNRESOLVED_REF', `${ix.unresolved.size} referenced id(s) cannot be resolved by this store (they may be cross-address references)`, ix.unresolved.size);
  const env = {
    v: VERSION.result, columns: columnsOut, rows: outRows, row_meta: rowMeta,
  };
  if (outRows.length === 1 && cols.length === 1) env.value = outRows[0][cols[0]];
  env.held = { slots: heldSlots.size, max: maxHeld, extra };
  env.determined = determined; env.incomplete = incomplete;
  env.gaps = [...(opts.scriptGaps || []), ...ix.gapList].map((g) => ({ code: g.code, detail: g.detail, ...(g.count !== undefined ? { count: g.count } : {}) }));
  env.explain = buildExplain(ix, world, node, opts);
  env.cost = costOf(ix);
  return env;
}
function shapeAccess(a) {
  if (!a || a.method !== 'region') return a;
  const { addrs, ...rest } = a;
  return { ...rest, ...(addrs && addrs.length === 1 ? { addr: addrs[0] } : addrs ? { addrs } : {}) };
}
export function costOf(ix) {
  return { entries: ix.cost.entries, bytes: ix.meter.bytes, records: ix.meter.records, rows: ix.cost.rows, steps: ix.cost.steps, budget: { ...ix.cost.limits }, exhausted: false };
}
export function frameExplain(ix, world) {
  const f = world.frame || {};
  const asof = f.asof && f.asof.length ? (f.asof.length === 1 ? f.asof[0] : f.asof) : null;
  const pv = f.perceiver && f.perceiver.length ? (f.perceiver.length === 1 ? f.perceiver[0] : f.perceiver) : null;
  const ca = ix.collapsedAgg;
  return {
    asof, schema: f.schema ?? 'asof', collapse: f.collapse ?? null, anc: f.anc ?? 'slot', ordering: f.ordering ?? 'causal', perceiver: pv,
    budget: f.budget ?? null, return: ix.returnSet || f.return || null,
    collapsed: ca ? { rule: [...ca.rule].sort(), slots_collapsed: ca.slots_collapsed, values_discarded: ca.values_discarded } : null,
    perceiver_info: world.raw && f.perceiver && f.perceiver.length ? { unseen_refs: world.core.unseen || 0 } : null,
  };
}
export function buildExplain(ix, world, node, opts) {
  const ids = [...ix.meter.ids].sort();
  const brief = opts.explain === 'brief' && ids.length > 100000;
  const exprText = node ? print(node) : '';
  const prims = new Set(ix.prims);
  const exts = new Set(ix.exts);
  for (const p of opts.staticPrims || []) prims.add(p);
  const keyOrder = ix.gapIdx && [...ix.gapIdx.keys()].some((k) => k.startsWith('W_ORDER_KEY'));
  return {
    expr: exprText, expr_hash: sha256(exprText), frame: frameExplain(ix, world),
    plan: ix.planNodes.map((p) => ({ id: p.id, verb: p.verb, clauses: p.clauses, access: shapeAccess(p._core ? p._core.access() : p.access), rows_out: p.rows_out, notes: p.notes })),
    entries_read: { count: ids.length, ids: brief ? null : ids, digest: idsDigest(ids) },
    bytes_read: ix.meter.bytes, records_read: ix.meter.records,
    verbs: Object.fromEntries(Object.entries(ix.verbs).sort(([a], [b]) => (a < b ? -1 : 1))),
    primitives: [...prims].sort(), extensions: [...exts].sort(),
    order_basis: keyOrder ? 'key' : 'causal', findings: ix.findings,
    source: { uri: ix.handle.uri, kind: ix.handle.source ? ix.handle.source.kind : 'world' },
  };
}
export { hash, rawRows };
