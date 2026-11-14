// stats.mjs: cluster-resampled paired bootstrap and the WIN/TIE/LOSE/INCONCLUSIVE rule (PREREG section 11, A1).
import { prng, mean, median } from './util.mjs';

// per: array of {cluster, a, b} paired per-question values (a = arm under test, b = comparator).
// kind 'diff'  : statistic = mean(a) - mean(b)              (proportions)
// kind 'ratio' : statistic = median(a) / median(b) - 1      (cost; negative = a cheaper)
// kind 'mean-diff': per[i].d already holds the per-question difference (main effect over four settings); statistic = mean(d)
export function bootstrap(per, kind, { B = 10000, seed = 20261113 } = {}) {
  const clusters = new Map();
  per.forEach((p, i) => { if (!clusters.has(p.cluster)) clusters.set(p.cluster, []); clusters.get(p.cluster).push(i); });
  const keys = [...clusters.keys()];
  const R = prng(seed);
  let point, draw;
  if (kind === 'ratio') {
    const stat = (idx) => { const mb = median(idx.map((i) => per[i].b)); return mb === 0 ? NaN : median(idx.map((i) => per[i].a)) / mb - 1; };
    point = stat(per.map((_, i) => i));
    draw = () => { const idx = []; for (let k = 0; k < keys.length; k++) idx.push(...clusters.get(keys[R.int(keys.length)])); return stat(idx); };
  } else {
    // per-cluster aggregates: a resample is a sum over drawn clusters, O(clusters) not O(questions)
    const agg = keys.map((k) => { let a = 0, b = 0, d = 0; const ix = clusters.get(k); for (const i of ix) { a += per[i].a ?? 0; b += per[i].b ?? 0; d += per[i].d ?? 0; } return { a, b, d, n: ix.length }; });
    const st = (sel) => { let A = 0, Bs = 0, D = 0, N = 0; for (const c of sel) { A += c.a; Bs += c.b; D += c.d; N += c.n; } return kind === 'diff' ? A / N - Bs / N : D / N; };
    point = st(agg);
    draw = () => { const sel = []; for (let k = 0; k < agg.length; k++) sel.push(agg[R.int(agg.length)]); return st(sel); };
  }
  const draws = [];
  for (let b = 0; b < B; b++) { const s = draw(); if (Number.isFinite(s)) draws.push(s); }
  draws.sort((x, y) => x - y);
  const q = (p) => draws[Math.min(draws.length - 1, Math.max(0, Math.floor(p * draws.length)))];
  return { n: per.length, clusters: keys.length, point, lo: q(0.025), hi: q(0.975), B: draws.length };
}

// higherIsBetter: true for accuracy; false for wrong rate and cost.
// mei is the EFFECTIVE minimum effect (already max of stated MEI and noise floor).
export function verdict(ci, mei, higherIsBetter) {
  const good = higherIsBetter ? (x) => x : (x) => -x;
  const lo = good(higherIsBetter ? ci.lo : ci.hi), hi = good(higherIsBetter ? ci.hi : ci.lo);
  // after the flip, bigger = better; the interval is [min(lo,hi), max(lo,hi)]
  const a = Math.min(lo, hi), b = Math.max(lo, hi);
  if (a > mei) return 'WIN';
  if (b < -mei) return 'LOSE';
  if (a >= -mei && b <= mei) return 'TIE';
  return 'INCONCLUSIVE';
}

export const halfWidth = (ci) => (ci.hi - ci.lo) / 2;

// Two independent groups (different questions): statistic = mean(a) - mean(b); clusters resampled within each group.
// groups: arrays of {cluster, v}. Used for D2 (tier L2 versus tier L0) and D4 (caught-wrong shares).
export function bootstrap2(ga, gb, { B = 10000, seed = 20261113 } = {}) {
  const prep = (g) => { const m = new Map(); g.forEach((p) => { if (!m.has(p.cluster)) m.set(p.cluster, []); m.get(p.cluster).push(p.v); }); return [...m.values()]; };
  const A = prep(ga), Bc = prep(gb);
  const R = prng(seed);
  const m = (cl) => { let s = 0, n = 0; for (const c of cl) for (const v of c) { s += v; n++; } return n ? s / n : NaN; };
  const point = m(A) - m(Bc);
  const draws = [];
  for (let b = 0; b < B; b++) {
    const ra = [], rb = [];
    for (let i = 0; i < A.length; i++) ra.push(A[R.int(A.length)]);
    for (let i = 0; i < Bc.length; i++) rb.push(Bc[R.int(Bc.length)]);
    const s = m(ra) - m(rb);
    if (Number.isFinite(s)) draws.push(s);
  }
  draws.sort((x, y) => x - y);
  const q = (p) => draws[Math.min(draws.length - 1, Math.max(0, Math.floor(p * draws.length)))];
  return { n: ga.length + gb.length, clusters: A.length + Bc.length, point, lo: q(0.025), hi: q(0.975), B: draws.length };
}
