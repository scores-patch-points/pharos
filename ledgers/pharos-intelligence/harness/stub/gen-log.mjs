// gen-log.mjs: a SYNTHETIC, labelled-STUB log used only to exercise the harness. It imitates the SHAPE of the two real
// sources (clip chains written by lanes, forks and retractions, undeclared kinds, leases, statements with revisions).
// It is not data about anything and no result on it says anything about the real pharos.
import { prng, sha256, canonical } from '../lib/util.mjs';

export const LANES = ['lane-a', 'lane-b', 'lane-c', 'lane-d'];
const BASE = Date.UTC(2026, 0, 1);

export function mkEntry(e) {
  const core = { v: 1, addr: e.addr, kind: e.kind, by: e.by, at: e.at, of: [...e.of].sort(), body: e.body };
  return { ...core, id: sha256(canonical(core)) };
}

export function genSlice({ seed, nClips, nLeases, nStmts, nGizmo }) {
  const R = prng(seed);
  let t = 0;
  const tick = () => { t += 1 + R.int(4); return new Date(BASE + t * 60000).toISOString(); };
  const entries = [];
  const state = new Map(); // addr -> {heads:[ids], list:[entries]}
  const st = (a) => { if (!state.has(a)) state.set(a, { heads: [], list: [] }); return state.get(a); };
  const put = (addr, kind, by, of, body) => { const e = mkEntry({ addr, kind, by, at: tick(), of, body }); entries.push(e); const s = st(addr); s.list.push(e); return e; };

  // schemas: the ground for declared kinds. 'gizmo' is deliberately NOT declared (undeclared kind).
  const fieldsOf = { move: ['lane', 'to'], trim: ['lane', 'len'], 'permit-granted': ['lane', 'expires'], 'permit-released': ['lane'], stmt: ['text'], verdict: ['status'] };
  for (const [k, f] of Object.entries(fieldsOf)) put(`schema:${k}`, 'schema', 'system', [], { read: { placement: 'address', collapse: 'causal-latest', fields: f, window: null } });

  // recipes per address, interleaved at random so positions across addresses are mixed
  const queues = [];
  for (let c = 0; c < nClips; c++) {
    const addr = 'c' + String(c).padStart(3, '0');
    const n = 2 + R.int(6);
    const q = [];
    const forky = R() < 0.9;
    for (let i = 0; i < n; i++) q.push({ addr, op: 'write', kind: R() < 0.7 ? 'move' : 'trim' });
    if (forky && n >= 3) {
      q.push({ addr, op: 'fork', kind: 'move' });                    // concurrent with the last write: two live heads
      if (R() < 0.25) q.push({ addr, op: 'merge', kind: 'move' });   // a quarter of the forks are later resolved
    }
    if (R() < 0.25) q.push({ addr, op: 'retract' });
    queues.push(q);
  }
  for (let g = 0; g < nGizmo; g++) {
    const addr = 'g' + String(g).padStart(2, '0');
    const q = []; const n = 2 + R.int(3);
    for (let i = 0; i < n; i++) q.push({ addr, op: 'write', kind: 'gizmo' });
    queues.push(q);
  }
  for (let s = 0; s < nStmts; s++) {
    const addr = 's' + String(s).padStart(2, '0');
    const q = [{ addr, op: 'stmt' }, { addr, op: 'verdict', status: R() < 0.5 ? 'attributed' : 'not-established' }];
    if (R() < 0.4) q.push({ addr, op: 'verdict2' });
    queues.push(q);
  }
  const live = queues.filter((q) => q.length);
  while (live.length) {
    const qi = R.int(live.length); const r = live[qi].shift(); if (!live[qi].length) live.splice(qi, 1);
    const s = st(r.addr); const lane = R.pick(LANES);
    if (r.op === 'write') { const e = put(r.addr, r.kind, lane, s.heads, { lane, to: R.int(1000), len: R.int(90) }); s.heads = [e.id]; }
    else if (r.op === 'fork') {
      const prev = s.list.filter((e) => e.kind !== 'retract').slice(-1)[0];
      const e = put(r.addr, r.kind, lane, prev ? prev.of : [], { lane, to: R.int(1000), len: R.int(90) });
      s.heads = [...s.heads, e.id];
    } else if (r.op === 'merge') { const e = put(r.addr, r.kind, lane, s.heads, { lane, to: R.int(1000), len: R.int(90) }); s.heads = [e.id]; }
    else if (r.op === 'retract') { const tgt = R.pick(s.list.filter((e) => e.kind !== 'retract')); put(r.addr, 'retract', lane, [tgt.id], { note: 'retracted' }); }
    else if (r.op === 'stmt') { const e = put(r.addr, 'stmt', 'extractor', [], { text: `statement text ${r.addr} ${R.int(100000)}` }); s.heads = [e.id]; }
    else if (r.op === 'verdict') { const stm = s.list.find((e) => e.kind === 'stmt'); const e = put(r.addr, 'verdict', 'verifier', [stm.id], { status: r.status }); s.vhead = e; }
    else if (r.op === 'verdict2') { const e = put(r.addr, 'verdict', 'verifier', [s.vhead.id], { status: s.vhead.body.status === 'attributed' ? 'not-established' : 'attributed' }); s.vhead = e; }
  }
  // leases: short, so any window holds a handful
  for (let p = 0; p < nLeases; p++) {
    const addr = 'p' + String(p).padStart(3, '0');
    const lane = R.pick(LANES); const g0 = t + 5 + R.int(Math.max(10, t - 5));
    const grantedAt = new Date(BASE + g0 * 60000).toISOString();
    const expires = new Date(BASE + (g0 + 20 + R.int(120)) * 60000).toISOString();
    const g = mkEntry({ addr, kind: 'permit-granted', by: lane, at: grantedAt, of: [], body: { lane, expires } });
    entries.push(g);
    if (R() < 0.7) {
      const relMin = g0 + 3 + R.int(30);
      const relAt = new Date(BASE + relMin * 60000).toISOString();
      if (relAt < expires) entries.push(mkEntry({ addr, kind: 'permit-released', by: lane, at: relAt, of: [g.id], body: { lane } }));
    }
  }
  entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
  return entries;
}
