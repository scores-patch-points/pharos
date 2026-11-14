// study.mjs: one function that runs a set of arms for one model over a sealed question set, scores them against the sealed
// truths (opened only after the runs finish), audits, and returns everything verdicts.mjs needs. Shared by selftest and run.mjs.
import { runArm, scoreRun, summarize, auditReplay, contrast } from './runner.mjs';
import { parseArm } from './arms.mjs';
import { halfWidth } from './stats.mjs';
import { loadSealedTruths } from './seal.mjs';

export async function runStudy({ qdir, questions, order, model, armNames, makeEngine, engineForArm, readerModel, B = 10000, noiseArm = 'P111' }) {
  // 1. run (the model-facing code has no access to the sealed truths)
  const raw = {};
  for (const a of armNames) {
    const arm = parseArm(a);
    const m = arm.kind === 'full' && readerModel ? readerModel : model;
    raw[a] = await runArm({ questions, order, arm: a, model: m, makeEngine: engineForArm ? (slice, f) => engineForArm(a, slice, f) : makeEngine });
  }
  // 2. only now open the sealed truths
  const truths = loadSealedTruths(qdir, questions);
  const idsBySlice = new Map();
  for (const q of questions) if (!idsBySlice.has(q.slice)) idsBySlice.set(q.slice, makeEngine(q.slice, { G: 0, H: 0, T: 0 }).ids());
  const arms = {};
  for (const a of armNames) {
    const scored = scoreRun({ questions, run: raw[a], truths, idsBySlice });
    arms[a] = { run: raw[a], scored, summary: summarize(raw[a], scored) };
  }
  // 3. audit replay on the pointer arms
  const audit = {};
  for (const a of armNames) if (parseArm(a).kind === 'pointer') audit[a] = auditReplay({ questions, run: raw[a], makeEngine: engineForArm ? (slice, f) => engineForArm(a, slice, f) : makeEngine });
  // 4. noise floor from an identical-arm replay (N3)
  let noise = {};
  if (arms[noiseArm]) {
    const again = await runArm({ questions, order, arm: noiseArm, model, makeEngine: engineForArm ? (slice, f) => engineForArm(noiseArm, slice, f) : makeEngine });
    const sc = scoreRun({ questions, run: again, truths, idsBySlice });
    const A2 = { run: again, scored: sc };
    for (const m of ['M1', 'M2', 'M4a', 'M4b']) {
      const c = contrast({ questions, A: arms[noiseArm], B: A2, metric: m, B_boot: B });
      noise[m] = halfWidth(c);
    }
    arms.__retest = A2;
  }
  return { questions, truths, arms, audit, noise, idsBySlice };
}
