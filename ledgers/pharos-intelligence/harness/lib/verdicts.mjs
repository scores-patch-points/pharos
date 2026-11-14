// verdicts.mjs: computes D1 to D6 of PREREG section 11 (as amended by A1) from scored runs. No choices are made here that the
// preregistration does not state; every number comes from stats.mjs. Used by selftest (on the stub) and run.mjs (real).
import { contrast, mainEffect, METRIC_NAMES } from './runner.mjs';
import { bootstrap2, verdict } from './stats.mjs';
import { armName } from './arms.mjs';

const GOOD = { M1: 'higher', M2: 'lower', M4a: 'lower', M4b: 'lower' };

// study: {questions, truths: Map, arms: {name: {run, scored}}, audit: {P111: {rate}}, noise}
export function featureVerdicts(study, f, { B = 10000, filter } = {}) {
  const { questions, arms, noise } = study;
  const need = ['P000', 'P100', 'P010', 'P001', 'P110', 'P101', 'P011', 'P111'];
  if (need.some((a) => !arms[a])) return { f, status: 'NOT TESTABLE (factorial arms missing)' };
  const runs = arms;
  const others = ['G', 'H', 'T'].filter((x) => x !== f);
  const dropArm = armName({ G: 1, H: 1, T: 1, [f]: 0 });
  const out = { f, add: {}, drop: {}, poison: null };
  for (const m of METRIC_NAMES) {
    out.add[m] = mainEffect({ questions, runs, f, metric: m, noise, B_boot: B, filter });
    out.drop[m] = contrast({ questions, A: arms.P111, B: arms[dropArm], metric: m, noise, B_boot: B, filter });
  }
  const px = arms['X-' + f];
  if (px) out.poison = contrast({ questions, A: px, B: arms.P111, metric: 'M1', noise, B_boot: B, filter });
  const win = (m) => out.add[m].verdict === 'WIN' && out.drop[m].verdict === 'WIN';
  const lose = (m) => out.add[m].verdict === 'LOSE' || out.drop[m].verdict === 'LOSE';
  const anyWin = METRIC_NAMES.some(win);
  const accLose = lose('M1') || lose('M2');
  const allTie = METRIC_NAMES.every((m) => out.add[m].verdict === 'TIE' && out.drop[m].verdict === 'TIE');
  const poisonWin = out.poison && out.poison.verdict === 'WIN';
  out.claim = accLose ? 'LOSE on accuracy or wrong rate'
    : poisonWin ? 'DOES NOT HOLD (poisoned form is not worse)'
    : anyWin ? (['M1', 'M2'].some(win) ? 'HOLDS' : 'HOLDS (cost-only)')
    : allTie ? 'REFUTED (no difference that makes a difference)' : 'INCONCLUSIVE';
  out.others = others;
  return out;
}

export function parityVerdict(study, tier, { B = 10000 } = {}) {
  const { questions, arms, noise } = study;
  if (!arms.P111 || !arms.F) return { tier, status: 'NOT TESTABLE' };
  const feasible = arms.F.scored.filter((s) => s.feasible && questions.find((q) => q.qid === s.qid).tier === tier).length;
  const filter = (qid) => questions.find((q) => q.qid === qid).tier === tier;
  if (feasible < 1) return { tier, feasible, status: 'F INFEASIBLE at this tier (right-censored)' };
  const r = contrast({ questions, A: arms.P111, B: arms.F, metric: 'M1', noise, B_boot: B, filter });
  const c = contrast({ questions, A: arms.P111, B: arms.F, metric: 'M4a', noise, B_boot: B, filter });
  const infeasible = arms.F.scored.filter((s) => !s.feasible && questions.find((q) => q.qid === s.qid).tier === tier).length;
  return { tier, feasible, infeasible, accuracy: r, cost_chars: c, inconclusive_small: feasible < 100 ? 'fewer than 100 feasible questions: INCONCLUSIVE by A1 item 4 (real runs only)' : null };
}

export function scaleVerdict(study, tierLow, tierHigh, { B = 10000 } = {}) {
  const { questions, arms, noise } = study;
  const by = new Map(questions.map((q) => [q.qid, q]));
  const g = (tier) => arms.P111.scored.filter((s) => s.feasible && by.get(s.qid).tier === tier).map((s) => ({ cluster: by.get(s.qid).cluster, v: s.correct ? 1 : 0 }));
  const hi = g(tierHigh), lo = g(tierLow);
  if (!hi.length || !lo.length) return { status: 'NOT TESTABLE (tier missing)' };
  const ci = bootstrap2(hi, lo, { B });
  const mei = Math.max(0.05, noise?.M1 || 0);
  return { tierLow, tierHigh, ...ci, mei, verdict: verdict(ci, mei, true) };
}

export function auditVerdict(study, { B = 10000 } = {}) {
  const { questions, arms, audit } = study;
  const by = new Map(questions.map((q) => [q.qid, q]));
  const w = (a) => arms[a].scored.filter((s) => s.feasible && s.wrong).map((s) => ({ cluster: by.get(s.qid).cluster, v: s.caught_wrong ? 1 : 0 }));
  const a = w('P111'), b = w('P000');
  const m6 = audit?.P111?.rate ?? null;
  if (!a.length || !b.length) return { m6, caught_wrong: 'n/a (a comparison arm has no wrong answers)', supported: m6 !== null && m6 >= 0.99 };
  const ci = bootstrap2(a, b, { B });
  const mei = Math.max(0.05, study.noise?.M2 || 0);
  const v = verdict(ci, mei, true);
  return { m6, caught_wrong: { ...ci, mei, verdict: v }, supported: m6 !== null && m6 >= 0.99 && v === 'WIN' };
}

// D5: a feature's effect must sit in its own stratum and be a TIE in S_0
export function specificity(study, f, strata, { B = 10000 } = {}) {
  const own = { G: 'S_G', H: 'S_H', T: 'S_T' }[f];
  const inS = (name) => (qid) => (strata.get(qid) || []).includes(name);
  const res = {};
  for (const [label, filter] of [[own, inS(own)], ['S_0', inS('S_0')]]) {
    const n = study.questions.filter((q) => filter(q.qid)).length;
    if (n < 20) { res[label] = { n, status: 'too few questions in stratum' }; continue; }
    const metrics = f === 'T' ? ['M1', 'M4b'] : ['M1', 'M2'];
    res[label] = { n, metrics: Object.fromEntries(metrics.map((m) => [m, mainEffect({ questions: study.questions, runs: study.arms, f, metric: m, noise: study.noise, B_boot: B, filter })])) };
  }
  const s0 = res.S_0.metrics ? Object.values(res.S_0.metrics).some((x) => x.verdict === 'WIN') : false;
  const ownWin = res[own].metrics ? Object.values(res[own].metrics).some((x) => x.verdict === 'WIN') : false;
  return { f, own, strata: res, localised: ownWin && !s0, downgrade: s0 };
}

export function overall(parity, scale, features, audit, specs, controlsPassed) {
  const holds = (f) => /^HOLDS/.test(features[f].claim) && !(specs[f] && specs[f].downgrade);
  const parts = {
    D1: parity.map((p) => p.accuracy?.verdict || p.status),
    D2: scale.verdict || scale.status,
    D3: Object.fromEntries(Object.keys(features).map((f) => [f, features[f].claim])),
    D4: audit.supported,
  };
  if (!controlsPassed) return { parts, D6: 'VOID (a control failed)' };
  const d1ref = parity.some((p) => p.accuracy?.verdict === 'LOSE');
  const d2ref = scale.verdict === 'LOSE';
  if (d1ref || d2ref) return { parts, D6: 'REFUTED' };
  const d1ok = parity.every((p) => !p.accuracy || ['WIN', 'TIE'].includes(p.accuracy.verdict));
  const d2ok = ['WIN', 'TIE'].includes(scale.verdict);
  const d3ok = Object.keys(features).every(holds);
  if (d1ok && d2ok && d3ok && audit.supported) return { parts, D6: 'SUPPORTED' };
  return { parts, D6: 'PARTLY SUPPORTED (see parts)' };
}
