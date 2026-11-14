// runner.mjs: runs one arm for one model over a question stream; scores; audit replay; contrasts.
import { runQuestion, runClosedBook, renderToolResult } from './controller.mjs';
import { parseArm, others, armName } from './arms.mjs';
import { wrapPoison } from './poison.mjs';
import { scoreOne, table } from './score.mjs';
import { bootstrap, verdict, halfWidth } from './stats.mjs';
import { mean, median, sha256 as sha } from './util.mjs';

// makeEngine(sliceId, features) -> engine adapter (see README.md). One engine per slice per run; trails live in it.
export async function runArm({ questions, order, arm: armSpec, model, makeEngine }) {
  const arm = typeof armSpec === 'string' ? parseArm(armSpec) : armSpec;
  const byId = new Map(questions.map((q) => [q.qid, q]));
  const engines = new Map();
  const engineFor = (q) => {
    if (!engines.has(q.slice)) {
      let e = makeEngine(q.slice, arm.features);
      if (arm.poison) e = wrapPoison(e, arm.poison);
      e.reset();
      engines.set(q.slice, e);
    }
    return engines.get(q.slice);
  };
  const records = [];
  for (const qid of order) {
    const q = byId.get(qid);
    if (arm.kind === 'closed-book') records.push(await runClosedBook({ q, arm, model }));
    else records.push(await runQuestion({ q, arm, model, engine: engineFor(q) }));
  }
  return { arm: arm.name, model: model.describe().name, records, engines };
}

// Audit replay (M6): replay each question's recorded tool calls, in the original order, on fresh engines; compare result hashes.
export function auditReplay({ questions, run, makeEngine }) {
  const arm = parseArm(run.arm);
  const byId = new Map(questions.map((q) => [q.qid, q]));
  const engines = new Map();
  let ok = 0, total = 0, mismatches = [];
  for (const rec of run.records) {
    if (!rec.feasible || arm.kind !== 'pointer') continue;
    const q = byId.get(rec.qid);
    if (!engines.has(q.slice)) {
      let e = makeEngine(q.slice, arm.features);
      if (arm.poison) e = wrapPoison(e, arm.poison);
      e.reset();
      engines.set(q.slice, e);
    }
    const e = engines.get(q.slice);
    const tools = e.tools();
    const seen = new Set(), ctr = { n: 0 };
    let good = true;
    for (const st of rec.trace) {
      if (!st.tool) continue;
      const known = tools.find((t) => t.name === st.tool);
      const { text } = renderToolResult(e, known ? st.tool : null, st.tool, st.args, seen, ctr);
      // result_sha is over the capped text
      if (sha(text) !== st.result_sha) { good = false; mismatches.push({ qid: rec.qid, tool: st.tool }); }
    }
    total++; if (good) ok++;
  }
  return { runs: total, matched: ok, rate: total ? ok / total : null, mismatches: mismatches.slice(0, 5) };
}
export function scoreRun({ questions, run, truths, idsBySlice }) {
  const byId = new Map(questions.map((q) => [q.qid, q]));
  const scored = [];
  for (const rec of run.records) {
    if (!rec.feasible) { scored.push({ qid: rec.qid, feasible: false, truth_status: truths.get(rec.qid).status }); continue; }
    const q = byId.get(rec.qid);
    const s = scoreOne(q, truths.get(rec.qid), rec.final, idsBySlice.get(q.slice));
    s.feasible = true;
    scored.push(s);
  }
  return scored;
}

export function summarize(run, scored) {
  const f = scored.filter((s) => s.feasible);
  const recs = run.records.filter((r) => r.feasible);
  const n = f.length;
  const wrongN = f.filter((s) => s.wrong).length;
  return {
    arm: run.arm, model: run.model, n, infeasible: scored.length - n,
    accuracy: n ? f.filter((s) => s.correct).length / n : null,
    wrong_rate: n ? wrongN / n : null,
    abstain_known_rate: n ? f.filter((s) => s.abstain).length / n : null,
    supported_accuracy: n ? f.filter((s) => s.supported).length / n : null,
    silent_wrong_share: wrongN ? f.filter((s) => s.silent_wrong).length / wrongN : null,
    caught_wrong_share: wrongN ? f.filter((s) => s.caught_wrong).length / wrongN : null,
    chars_in_median: median(recs.map((r) => r.chars_in)),
    engine_bytes_median: median(recs.map((r) => r.engine?.bytes_read ?? 0)),
    model_calls_mean: mean(recs.map((r) => r.model_calls)),
    tool_calls_mean: mean(recs.map((r) => r.tool_calls)),
    format_errors: recs.reduce((a, r) => a + r.format_errors, 0),
    truncations: recs.reduce((a, r) => a + r.truncations, 0),
    turn_limit_hits: recs.filter((r) => r.turn_limit).length,
    table: table(f),
  };
}

// ---- contrasts -------------------------------------------------------------------------------------------------
const METRICS = {
  M1: { f: (s) => (s.correct ? 1 : 0), kind: 'diff', higherIsBetter: true, mei: 0.05 },
  M2: { f: (s) => (s.wrong ? 1 : 0), kind: 'diff', higherIsBetter: false, mei: 0.05 },
  M4a: { rec: (r) => r.chars_in, kind: 'ratio', higherIsBetter: false, mei: 0.10 },
  M4b: { rec: (r) => (r.engine?.bytes_read ?? 0) + 1, kind: 'ratio', higherIsBetter: false, mei: 0.10 }, // +1: ratio of medians stays defined at zero bytes
};
export const METRIC_NAMES = Object.keys(METRICS);

// returns per-question {cluster,a,b} for two scored runs over the same questions (questions feasible in both)
function pairs(questions, A, B, m) {
  const byId = new Map(questions.map((q) => [q.qid, q]));
  const sb = new Map(B.scored.map((s, i) => [s.qid, { s, r: B.run.records[i] }]));
  const out = [];
  A.scored.forEach((s, i) => {
    const b = sb.get(s.qid);
    if (!s.feasible || !b || !b.s.feasible) return;
    const M = METRICS[m];
    const a = M.f ? M.f(s) : M.rec(A.run.records[i]);
    const bv = M.f ? M.f(b.s) : M.rec(b.r);
    out.push({ qid: s.qid, cluster: byId.get(s.qid).cluster, a, b: bv });
  });
  return out;
}

// noise: {M1: halfwidth, ...} from the identical-arm replay (N3); stated MEI is raised to it
export function contrast({ questions, A, B, metric, noise = {}, B_boot = 10000, seed = 20261113, filter }) {
  const M = METRICS[metric];
  let per = pairs(questions, A, B, metric);
  if (filter) per = per.filter((p) => filter(p.qid));
  const ci = bootstrap(per, M.kind, { B: B_boot, seed });
  const mei = Math.max(M.mei, noise[metric] || 0);
  return { metric, ...ci, mei, verdict: verdict(ci, mei, M.higherIsBetter) };
}

// Main effect of feature f over the four settings of the other two (A1 item 3): per-question mean of paired differences.
export function mainEffect({ questions, runs, f, metric, noise = {}, B_boot = 10000, seed = 20261113, filter }) {
  const M = METRICS[metric];
  const settings = others(f).map((o) => ({ on: armName({ ...o, [f]: 1 }), off: armName({ ...o, [f]: 0 }) }));
  const byQ = new Map();
  for (const st of settings) {
    const per = pairs(questions, runs[st.on], runs[st.off], metric);
    for (const p of per) {
      if (!byQ.has(p.qid)) byQ.set(p.qid, { cluster: p.cluster, ds: [] });
      byQ.get(p.qid).ds.push(M.kind === 'ratio' ? Math.log(p.a / p.b) : p.a - p.b);
    }
  }
  let arr = [...byQ.entries()].filter(([, v]) => v.ds.length === 4).map(([qid, v]) => ({ qid, cluster: v.cluster, d: mean(v.ds) }));
  if (filter) arr = arr.filter((p) => filter(p.qid));
  const ci = bootstrap(arr, 'mean-diff', { B: B_boot, seed });
  // for cost the statistic is a mean log ratio; report as ratio - 1
  const conv = M.kind === 'ratio' ? (x) => Math.exp(x) - 1 : (x) => x;
  const out = { metric, n: ci.n, clusters: ci.clusters, point: conv(ci.point), lo: conv(ci.lo), hi: conv(ci.hi), B: ci.B };
  out.mei = Math.max(M.mei, noise[metric] || 0);
  out.verdict = verdict(out, out.mei, M.higherIsBetter);
  return out;
}

export { halfWidth };

// Perspective-dependence (PREREG section 14): which questions FLIP between arms (same question, different perceiver, different outcome).
// Returns, for each pair of the named arms, the qids whose scored outcome differs, and per question the number of distinct outcomes.
export function flips(arms, names) {
  const pair = {};
  const per = new Map();
  for (let i = 0; i < names.length; i++) {
    const a = arms[names[i]];
    a.scored.forEach((s) => { if (!per.has(s.qid)) per.set(s.qid, new Set()); per.get(s.qid).add(s.feasible ? s.outcome : 'infeasible'); });
    for (let j = i + 1; j < names.length; j++) {
      const b = arms[names[j]];
      const bs = new Map(b.scored.map((s) => [s.qid, s]));
      pair[`${names[i]}|${names[j]}`] = a.scored.filter((s) => (bs.get(s.qid) && (s.feasible ? s.outcome : 'infeasible') !== (bs.get(s.qid).feasible ? bs.get(s.qid).outcome : 'infeasible'))).map((s) => s.qid);
    }
  }
  const flipping = [...per.entries()].filter(([, v]) => v.size > 1).map(([q]) => q);
  return { pair_counts: Object.fromEntries(Object.entries(pair).map(([k, v]) => [k, v.length])), pairs: pair, questions_with_any_flip: flipping.length, of: per.size };
}
