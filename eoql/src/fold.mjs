// fold.mjs: the fold state of an entry set (SPEC 1.2, 1.3): causal order, retractions, slots, heads, held, episodes.
import { CELL_RANK } from './vendor.mjs';
import { canonical } from './util.mjs';

const RET = 'retract';
export const slotKey = (addr, kind) => addr + '\u0000' + kind;

class Heap { // min-heap of indices by (rank, id)
  constructor(less) { this.a = []; this.less = less; }
  get size() { return this.a.length; }
  push(x) { const a = this.a; a.push(x); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (this.less(a[i], a[p])) { [a[i], a[p]] = [a[p], a[i]]; i = p; } else break; } }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && this.less(a[l], a[m])) m = l; if (r < a.length && this.less(a[r], a[m])) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } }
    return top;
  }
}

export class Fold {
  // items: [{e, file}] already de-duplicated by id. ordering: 'causal' | 'key'
  constructor(items, ordering = 'causal') {
    const n = items.length;
    this.n = n;
    this.items = items;
    this.ents = items.map((x) => x.e);
    this.ordering = ordering;
    this.idx = new Map();
    for (let i = 0; i < n; i++) this.idx.set(this.ents[i].id, i);
    // predecessor lists (of u seen, within E) and of-lists
    this.preds = new Array(n);
    this.ofIdx = new Array(n);
    this.dangling = new Set();
    this.danglingBy = new Map(); // dangling id -> [entry idx]
    for (let i = 0; i < n; i++) {
      const e = this.ents[i];
      const ps = new Set(), os = [];
      for (const id of e.of) { const j = this.idx.get(id); if (j === undefined) { this.dangling.add(id); (this.danglingBy.get(id) || this.danglingBy.set(id, []).get(id)).push(i); } else { ps.add(j); os.push(j); } }
      for (const id of e.seen) { const j = this.idx.get(id); if (j === undefined) { this.dangling.add(id); (this.danglingBy.get(id) || this.danglingBy.set(id, []).get(id)).push(i); } else ps.add(j); }
      this.preds[i] = [...ps];
      this.ofIdx[i] = os;
    }
    this._order();
    this._retractions();
    this._slots();
    this._hc = new Map();
    this._epc = new Map();
  }
  _order() {
    const n = this.n, ents = this.ents;
    const rank = new Int32Array(n);
    for (let i = 0; i < n; i++) rank[i] = CELL_RANK.get(ents[i].cell);
    this.pos = new Int32Array(n).fill(-1);
    const ord = [];
    if (this.ordering === 'key') {
      const ix = Array.from({ length: n }, (_, i) => i);
      ix.sort((a, b) => (ents[a].at < ents[b].at ? -1 : ents[a].at > ents[b].at ? 1 : ents[a].id < ents[b].id ? -1 : ents[a].id > ents[b].id ? 1 : 0));
      ix.forEach((i, p) => { this.pos[i] = p; ord.push(i); });
      this.ord = ord;
      return;
    }
    const indeg = new Int32Array(n);
    const succCount = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) { indeg[i] = this.preds[i].length; for (const p of this.preds[i]) succCount[p + 1]++; }
    for (let i = 0; i < n; i++) succCount[i + 1] += succCount[i];
    const succ = new Int32Array(succCount[n]); const fill = succCount.slice(0, n);
    for (let i = 0; i < n; i++) for (const p of this.preds[i]) succ[fill[p]++] = i;
    const lessFn = (a, b) => (rank[a] !== rank[b] ? rank[a] < rank[b] : ents[a].id < ents[b].id);
    const heap = new Heap(lessFn);
    for (let i = 0; i < n; i++) if (indeg[i] === 0) heap.push(i);
    while (heap.size) {
      const i = heap.pop();
      this.pos[i] = ord.length; ord.push(i);
      for (let k = succCount[i]; k < succCount[i + 1]; k++) { const s = succ[k]; if (--indeg[s] === 0) heap.push(s); }
    }
    if (ord.length < n) { // cycle (cannot happen with content-addressed ids): place the rest deterministically
      const rest = []; for (let i = 0; i < n; i++) if (this.pos[i] < 0) rest.push(i);
      rest.sort((a, b) => (rank[a] - rank[b]) || (ents[a].id < ents[b].id ? -1 : 1));
      for (const i of rest) { this.pos[i] = ord.length; ord.push(i); }
    }
    this.ord = ord;
  }
  _retractions() {
    const ents = this.ents;
    // library rule: scan in descending pos; a retract not already retracted is effective; least pos wins retracted_by
    this.retractedBy = new Map();
    const retracted = new Set();
    for (let p = this.n - 1; p >= 0; p--) {
      const i = this.ord[p]; const e = ents[i];
      if (e.kind === RET && !retracted.has(e.id)) { for (const t of e.of) { retracted.add(t); this.retractedBy.set(t, e.id); } }
    }
    this.retracted = retracted;
    this.retractWithoutOf = ents.filter((e) => e.kind === RET && e.of.length === 0).map((e) => e.id);
  }
  _slots() {
    this.slotOf = new Int32Array(this.n).fill(-1);
    this.slots = [];
    this.slotIdx = new Map();
    for (let p = 0; p < this.n; p++) {
      const i = this.ord[p]; const e = this.ents[i];
      if (e.kind === RET) continue;
      const k = slotKey(e.addr, e.kind);
      let s = this.slotIdx.get(k);
      if (s === undefined) { s = this.slots.length; this.slotIdx.set(k, s); this.slots.push({ id: s, addr: e.addr, kind: e.kind, members: [] }); }
      this.slots[s].members.push(i);
      this.slotOf[i] = s;
    }
  }
  frontierIds() { const ref = new Set(); for (const e of this.ents) { for (const id of e.of) ref.add(id); for (const id of e.seen) ref.add(id); } return this.ents.filter((e) => !ref.has(e.id)).map((e) => e.id).sort(); }
  has(id) { return this.idx.has(id); }
  entry(id) { const i = this.idx.get(id); return i === undefined ? undefined : this.ents[i]; }
  posOf(id) { const i = this.idx.get(id); return i === undefined ? -1 : this.pos[i]; }
  fileOf(i) { return this.items[i].file; }
  isRetracted(i) { return this.retracted.has(this.ents[i].id); }
  slotFor(addr, kind) { const s = this.slotIdx.get(slotKey(addr, kind)); return s === undefined ? null : this.slots[s]; }

  // heads of a member-index list L under an ancestry basis (1.3). L is in pos order.
  heads(L, anc, sid) {
    if (L.length <= 1) return L.slice();
    const dominated = new Set();
    if (anc === 'slot') {
      const stack = [];
      for (const b of L) {
        stack.push(b);
        while (stack.length) {
          const x = stack.pop();
          for (const t of this.ofIdx[x]) if (this.slotOf[t] === sid && !dominated.has(t)) { dominated.add(t); stack.push(t); }
        }
      }
    } else {
      let lo = Infinity; for (const b of L) if (this.pos[b] < lo) lo = this.pos[b];
      const stack = [];
      for (let k = L.length - 1; k >= 0; k--) {
        const b = L[k];
        if (dominated.has(b)) continue;
        stack.push(b);
        while (stack.length) {
          const x = stack.pop();
          for (const t of this.preds[x]) if (!dominated.has(t) && this.pos[t] >= lo) { dominated.add(t); stack.push(t); }
        }
      }
    }
    return L.filter((i) => !dominated.has(i));
  }
  // the slot's rows under a rule list: { entries:[idx], heads:[idx], held, rule }
  project(slot, rules, anc) {
    const key = slot.id + '|' + anc + '|' + rules.join(',');
    const hit = this._hc.get(key);
    if (hit) return hit;
    let L = slot.members;
    let history = false, all = false, latest = false, dropped = false;
    for (const r of rules) {
      if (r === 'drop-retracted') { L = L.filter((i) => !this.isRetracted(i)); dropped = true; } else if (r === 'effective-latest') { L = L.filter((i) => !this.isRetracted(i)); dropped = true; latest = true; } else if (r === 'latest') latest = true;
      else if (r === 'history') { L = L.filter((i) => !this.isRetracted(i)); history = true; dropped = true; } else if (r === 'all') all = true;
    }
    let hs;
    let held;
    if (all || history) {
      const live = slot.members.filter((i) => !this.isRetracted(i));
      const lh = this.heads(live, anc, slot.id);
      held = lh.length;
      const headSet = new Set(lh);
      hs = { entries: all ? slot.members : live, headSet };
    } else {
      const h = this.heads(L, anc, slot.id);
      held = h.length;
      let es = h;
      if (latest && h.length) { let b = h[0]; for (const x of h) if (this.pos[x] > this.pos[b]) b = x; es = [b]; }
      hs = { entries: es, headSet: new Set(h) };
    }
    const out = { entries: hs.entries, headSet: hs.headSet, held, dropped, latest, history, all, void: held === 0 && slot.members.length > 0 };
    this._hc.set(key, out);
    return out;
  }
  // conflict episodes of a slot (1.3), over all member entries
  episodes(slot, anc) {
    const key = slot.id + '|' + anc;
    const hit = this._epc.get(key);
    if (hit) return hit;
    const out = [];
    const H = new Set();
    let cur = null;
    const mem = slot.members;
    for (const e of mem) {
      if (anc === 'slot') { for (const t of this.ofIdx[e]) if (this.slotOf[t] === slot.id) H.delete(t); } else if (H.size) {
        let lo = Infinity; for (const h of H) if (this.pos[h] < lo) lo = this.pos[h];
        const seen = new Set(); const st = [e];
        while (st.length) { const x = st.pop(); for (const t of this.preds[x]) if (!seen.has(t) && this.pos[t] >= lo) { seen.add(t); st.push(t); } }
        for (const h of [...H]) if (seen.has(h)) H.delete(h);
      }
      H.add(e);
      if (!cur && H.size >= 2) { cur = { began: e, ended: null, held: [...H], participants: new Set(H), maxHeld: H.size }; out.push(cur); } else if (cur) {
        for (const h of H) cur.participants.add(h);
        if (H.size > cur.maxHeld) cur.maxHeld = H.size;
        if (H.size === 1) { cur.ended = e; cur = null; }
      }
    }
    const res = out.map((c) => {
      const ids = (xs) => xs.map((i) => this.ents[i].id);
      const parts = [...c.participants].sort((a, b) => this.pos[a] - this.pos[b]);
      const bodies = new Set(parts.map((i) => canonical(this.ents[i].body)));
      return { slot: [slot.addr, slot.kind], began: this.ents[c.began].id, ended: c.ended === null ? null : this.ents[c.ended].id, open: c.ended === null, held: ids(c.held.sort((a, b) => this.pos[a] - this.pos[b])), participants: ids(parts), maxHeld: c.maxHeld, differ: bodies.size > 1 };
    });
    this._epc.set(key, res);
    return res;
  }
  // adjacency function for an edge relation and direction (up = the ids an entry names, down = their inverse)
  adjacency(edge, dir) {
    if (dir === 'down') return this._down(edge);
    return (i) => (edge === 'of' ? this.ofIdx[i] : edge === 'seen' ? this._seenIdx(i) : this.preds[i]);
  }
  _seenIdx(i) { const out = []; for (const id of this.ents[i].seen) { const j = this.idx.get(id); if (j !== undefined) out.push(j); } return out; }
  _down(edge) {
    if (!this._dn) this._dn = {};
    if (!this._dn[edge]) {
      const m = new Array(this.n); for (let i = 0; i < this.n; i++) m[i] = [];
      for (let i = 0; i < this.n; i++) { const ps = edge === 'of' ? this.ofIdx[i] : edge === 'seen' ? this._seenIdx(i) : this.preds[i]; for (const p of ps) m[p].push(i); }
      this._dn[edge] = m;
    }
    const m = this._dn[edge];
    return (i) => m[i];
  }
}
