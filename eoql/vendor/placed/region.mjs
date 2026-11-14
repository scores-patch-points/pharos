// region.mjs: the monotone superposition accumulator for one address, and projection (collapse at read).
// Advancing a region only ADDS. Nothing here is ever invalidated, removed or recomputed from disk.
import { RETRACT_KIND, PlacedError, isObj } from './core.mjs';
import { cmpKey } from './placement.mjs';

const keyOf = (e) => ({ at: e.at, id: e.id });

export class Region {
  constructor(addr, kind) {
    this.addr = addr;
    this.kind = kind ?? null;            // kind filter (retractions are always admitted), or null for every kind
    this.entries = new Map();            // id -> entry: VALUE entries (every kind except retract)
    this.retracts = new Map();           // id -> entry: retraction entries (marks)
    this.refd = new Set();               // ids named in the `of` of a value entry here
    this.heads = new Set();              // value entries nothing here references: the superposition
    this.marks = new Map();              // target id -> [retract ids naming it]
    this.version = 0;                    // bumped on every add; derived caches key on it
    this.minKey = null;                  // smallest (at, id) of ANY entry here
    this.minIsEmptyValue = false;        // that entry is a value entry with empty `of`
    this.emptyOf = 0;                    // value entries with empty `of`
    this.duplicates = 0;
    this.touched = false;
  }

  accepts(e) { return this.kind === null || e.kind === this.kind || e.kind === RETRACT_KIND; }

  // Adds an entry. Order independent: the same set of entries gives the same state in any arrival order.
  add(e) {
    if (e.addr !== this.addr || !this.accepts(e)) return false;
    if (this.entries.has(e.id) || this.retracts.has(e.id)) { this.duplicates++; return false; }
    const k = keyOf(e);
    const value = e.kind !== RETRACT_KIND;
    const emptyValue = value && e.of.length === 0;
    if (this.minKey === null || cmpKey(k, this.minKey) < 0) { this.minKey = k; this.minIsEmptyValue = emptyValue; }
    if (emptyValue) this.emptyOf++;
    if (value) {
      this.entries.set(e.id, e);
      for (const t of e.of) { this.refd.add(t); this.heads.delete(t); }
      if (!this.refd.has(e.id)) this.heads.add(e.id);
    } else {
      this.retracts.set(e.id, e);
      for (const t of e.of) {
        const m = this.marks.get(t);
        if (m) m.push(e.id); else this.marks.set(t, [e.id]);
      }
    }
    this.version++;
    this.touched = true;
    return true;
  }

  // Blind writes: value entries with empty `of` while an earlier-positioned entry exists at this address.
  get blindWrites() { return this.emptyOf - (this.minIsEmptyValue ? 1 : 0); }

  // `of` ids that are not entries here: at another address, or truly dangling. A region cannot tell which.
  unresolvedOf() {
    if (this._un && this._un.version === this.version) return this._un.value;
    const out = [];
    for (const t of this.refd) if (!this.entries.has(t) && !this.retracts.has(t)) out.push(t);
    out.sort();
    this._un = { version: this.version, value: out };
    return out;
  }
}

// ---- rules ------------------------------------------------------------------------------------------------
// A rule is a string or an object; a rule list composes left to right, each rule narrowing the view.
//   'none'                     whole superposition (the default)
//   'drop-retracted'           values with an effective retraction are removed; heads recomputed through them
//   'as-of:<cut>' / {rule:'as-of', cut}      only entries at or before the cut; heads recomputed in that prefix
//   'by-writer:<w>' / {rule:'by-writer', writers:[..]}   only that writer's entries; ancestry through the rest
//   'causal-latest'            collapse to the single head with the greatest position key
//   'effective-latest'         = drop-retracted then causal-latest
// A cut is an ISO string (at <= cut), {at, id?} (position key <= {at,id}), {ids:[...]} (membership), or a
// 64-hex entry id of an entry in the region.
export function normalizeRules(x) {
  if (x === undefined || x === null) return [];
  const list = Array.isArray(x) ? x : typeof x === 'string' ? x.split(',').filter(Boolean) : [x];
  const out = [];
  for (const r of list) {
    if (typeof r === 'string') {
      if (r === 'none') out.push({ rule: 'none' });
      else if (r === 'drop-retracted') out.push({ rule: 'drop-retracted' });
      else if (r === 'causal-latest') out.push({ rule: 'causal-latest' });
      else if (r === 'effective-latest') { out.push({ rule: 'drop-retracted' }, { rule: 'causal-latest' }); }
      else if (r.startsWith('by-writer:')) out.push({ rule: 'by-writer', writers: r.slice(10).split('+').filter(Boolean) });
      else if (r.startsWith('as-of:')) out.push({ rule: 'as-of', cut: normalizeCut(r.slice(6)) });
      else throw new PlacedError('BAD_RULE', `unknown collapse rule ${r}`);
    } else if (isObj(r)) {
      if (r.rule === 'by-writer') {
        const w = r.writers ?? r.writer;
        const writers = Array.isArray(w) ? w : typeof w === 'string' ? [w] : null;
        if (!writers || !writers.length) throw new PlacedError('BAD_RULE', 'by-writer needs writer or writers');
        out.push({ rule: 'by-writer', writers });
      } else if (r.rule === 'as-of') out.push({ rule: 'as-of', cut: normalizeCut(r.cut) });
      else if (r.rule === 'none' || r.rule === 'drop-retracted' || r.rule === 'causal-latest') out.push({ rule: r.rule });
      else if (r.rule === 'effective-latest') out.push({ rule: 'drop-retracted' }, { rule: 'causal-latest' });
      else throw new PlacedError('BAD_RULE', `unknown collapse rule ${JSON.stringify(r)}`);
    } else throw new PlacedError('BAD_RULE', `bad rule ${String(r)}`);
  }
  return out;
}

export function normalizeCut(c) {
  if (typeof c === 'string') {
    if (/^[0-9a-f]{64}$/.test(c)) return { id: c };
    if (/^\d{4}-\d\d-\d\dT/.test(c)) return { at: c };
    throw new PlacedError('BAD_CUT', `cut ${c} is neither an ISO time nor an entry id`);
  }
  if (isObj(c)) {
    if (c.ids !== undefined) {
      const set = new Set(c.ids);
      return { ids: set };
    }
    if (typeof c.at === 'string') return { at: c.at, ...(typeof c.id === 'string' ? { id: c.id } : {}) };
    if (typeof c.id === 'string') return { id: c.id };
  }
  throw new PlacedError('BAD_CUT', `bad cut ${JSON.stringify(c)}`);
}

function cutTest(cut, region) {
  if (cut.ids) return (e) => cut.ids.has(e.id);
  let at = cut.at, id = cut.id;
  if (at === undefined) {
    const t = region.entries.get(id) ?? region.retracts.get(id);
    if (!t) throw new PlacedError('BAD_CUT', `cut entry ${id} is not in this region`);
    at = t.at;
  }
  if (id === undefined) return (e) => e.at <= at;
  return (e) => cmpKey(e, { at, id }) <= 0;
}

// ---- projection -------------------------------------------------------------------------------------------
// Effective retractions among a set of retract entries: a retraction is effective unless an effective
// retraction names it (a retraction of a retraction restores the value). Iterative, memoized.
function effectiveRetracts(R) {
  const byTarget = new Map();                       // retract id -> retract entries that name it
  for (const r of R.values()) for (const t of r.of) if (R.has(t)) { const a = byTarget.get(t); if (a) a.push(r.id); else byTarget.set(t, [r.id]); }
  const eff = new Map();
  for (const start of R.keys()) {
    if (eff.has(start)) continue;
    const stack = [start];
    while (stack.length) {
      const id = stack[stack.length - 1];
      if (eff.has(id)) { stack.pop(); continue; }
      const by = byTarget.get(id) || [];
      let pending = false;
      for (const b of by) if (!eff.has(b)) { stack.push(b); pending = true; }
      if (pending) continue;
      eff.set(id, !by.some((b) => eff.get(b)));
      stack.pop();
    }
  }
  const out = new Set();
  for (const [id, e] of eff) if (e) for (const t of R.get(id).of) out.add(t);
  return { effective: eff, retractedTargets: out };
}

// ids with an effective retraction among the retraction entries of a region (all of them, no rule applied).
export function retractedIds(region) { return effectiveRetracts(region.retracts).retractedTargets; }

// Nearest S-ancestors of each S member, through the graph G (members of G not in S are bridged).
function sParents(S, G) {
  const same = S.size === G.size;
  const out = new Map();
  for (const e of S.values()) {
    if (same) { out.set(e.id, e.of.filter((t) => S.has(t))); continue; }
    const found = new Set();
    const seen = new Set();
    const st = [...e.of];
    while (st.length) {
      const t = st.pop();
      if (seen.has(t)) continue;
      seen.add(t);
      if (S.has(t)) { found.add(t); continue; }
      const g = G.get(t);
      if (g) for (const u of g.of) st.push(u);
    }
    out.set(e.id, [...found]);
  }
  return out;
}

function headsOf(S, parents) {
  const covered = new Set();
  for (const ps of parents.values()) for (const p of ps) covered.add(p);
  const out = [];
  for (const e of S.values()) if (!covered.has(e.id)) out.push(e);
  return out.sort(cmpKey);
}

// Conflict episodes: replay in position order; an episode begins when the head set first holds two or more
// values (the entry whose arrival did it) and ends at the entry whose `of` covers every value then held.
function episodes(S, parents) {
  const order = [...S.values()].sort(cmpKey);
  const H = new Map();                 // id -> entry
  const refdSoFar = new Set();
  const out = [];
  let cur = null;
  for (const e of order) {
    for (const p of parents.get(e.id) || []) { refdSoFar.add(p); H.delete(p); }
    if (!refdSoFar.has(e.id)) H.set(e.id, e);
    if (!cur && H.size >= 2) {
      cur = { began: keyOf(e), ended: null, held: [...H.values()].sort(cmpKey).map((x) => x.id), participants: new Set(H.keys()), maxHeld: H.size };
      out.push(cur);
    } else if (cur) {
      for (const k of H.keys()) cur.participants.add(k);
      if (H.size > cur.maxHeld) cur.maxHeld = H.size;
      if (H.size === 1) { cur.ended = keyOf(e); cur = null; }
    }
  }
  return out.map((c) => ({
    began: c.began, ended: c.ended, open: c.ended === null,
    held: c.held, participants: [...c.participants].sort(), maxHeld: c.maxHeld,
  }));
}

// project(region, rules, opts) -> a read-only view. Never writes to the region or to disk.
//   opts.conflicts === false  skips the conflict-episode replay (the heads are still exact)
//   opts.history              adds `history`: every entry in the projected view in position order
export function project(region, rulesIn, opts = {}) {
  const rules = normalizeRules(rulesIn);
  let S = region.entries;
  let G = region.entries;
  let R = region.retracts;
  let single = false;
  for (const r of rules) {
    if (r.rule === 'none') continue;
    if (r.rule === 'as-of') {
      const t = cutTest(r.cut, region);
      S = new Map([...S].filter(([, e]) => t(e)));
      G = new Map([...G].filter(([, e]) => t(e)));
      R = new Map([...R].filter(([, e]) => t(e)));
    } else if (r.rule === 'by-writer') {
      const ws = new Set(r.writers);
      S = new Map([...S].filter(([, e]) => ws.has(e.by)));
      R = new Map([...R].filter(([, e]) => ws.has(e.by)));
    } else if (r.rule === 'drop-retracted') {
      const { retractedTargets } = effectiveRetracts(R);
      if (retractedTargets.size) S = new Map([...S].filter(([id]) => !retractedTargets.has(id)));
    } else if (r.rule === 'causal-latest') {
      const hs = headsOf(S, sParents(S, G));
      S = new Map(hs.length ? [[hs[hs.length - 1].id, hs[hs.length - 1]]] : []);
      single = true;
    }
  }
  const { effective, retractedTargets } = effectiveRetracts(R);
  const fast = S === region.entries && G === region.entries;
  let hs, parents = null;
  if (fast) hs = [...region.heads].map((id) => region.entries.get(id)).sort(cmpKey);
  else { parents = sParents(S, G); hs = headsOf(S, parents); }
  const values = hs.map((e) => ({
    ...e,
    retracted: retractedTargets.has(e.id),
    marks: (region.marks.get(e.id) || []).filter((m) => R.has(m)),
  }));
  let conflicts = [];
  if (opts.conflicts !== false) {
    let eps;
    if (fast && region._ep && region._ep.version === region.version) eps = region._ep.value;
    else {
      eps = episodes(S, parents || sParents(S, G));
      if (fast) region._ep = { version: region.version, value: eps };
    }
    conflicts = eps.map((c) => {
      const bodies = new Set(c.participants.map((id) => JSON.stringify((S.get(id) || {}).body)));
      return { addr: region.addr, ...c, differ: bodies.size > 1 };
    });
  }
  const out = {
    addr: region.addr,
    kind: region.kind,
    rule: rules.length ? rules : [{ rule: 'none' }],
    held: values.length,
    values,
    conflicts,
    retractions: [...R.values()].sort(cmpKey).map((r) => ({ id: r.id, by: r.by, at: r.at, of: r.of, effective: effective.get(r.id) === true })),
    entries: S.size + R.size,
    violations: [],
  };
  if (single) out.value = values[0] ?? null;
  // violations visible inside this region (the global ones need the whole log: see fold)
  const un = region.unresolvedOf();
  if (un.length) out.violations.push({ type: 'unresolved-of', ids: un, note: 'not entries at this address: elsewhere or dangling (fold classifies)' });
  if (region.blindWrites > 0) out.violations.push({ type: 'blind-write', count: region.blindWrites });
  for (const r of region.retracts.values()) if (r.of.length === 0) out.violations.push({ type: 'retract-without-of', id: r.id });
  if (hs.length >= 2) out.violations.push({ type: 'held-fork', ids: hs.map((e) => e.id) });
  if (opts.history) out.history = [...S.values(), ...R.values()].sort(cmpKey);
  return out;
}
