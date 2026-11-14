#!/usr/bin/env node
// selftest.mjs: runs the whole harness end to end on the STUB engine and STUB models and checks its own controls
// (PREREG sections 10 and 12). Output is a HARNESS result. It says nothing about the real pharos or any real model.
//
//   node harness/selftest.mjs [--out <dir>] [--B 10000] [--quick]
// Exit code 0 only if every control passed. --quick runs only what the controls need (used by mutants.mjs, with a small B; A1 item 6).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { genSlice } from './stub/gen-log.mjs';
import { buildStubQset } from './stub/gen-questions.mjs';
import { openStub } from './engines/stub-engine.mjs';
import { makeStubModel } from './models/stub-model.mjs';
import { runArm, scoreRun, summarize, auditReplay, contrast, mainEffect, flips } from './lib/runner.mjs';
import { runStudy } from './lib/study.mjs';
import { FACTORIAL } from './lib/arms.mjs';
import { verifyManifest, checkOrder, loadQuestions, loadSealedTruths, SealError } from './lib/seal.mjs';
import { runQuestion, CONSTANTS } from './lib/controller.mjs';
import { parseArm } from './lib/arms.mjs';
import { featureVerdicts, parityVerdict, scaleVerdict, auditVerdict, specificity, overall } from './lib/verdicts.mjs';
import { redact, sha256 } from './lib/util.mjs';
import { bootstrap } from './lib/stats.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const quick = argv.includes('--quick');
const B = Number(flag('--B', quick ? 1000 : 10000));
const OUT = path.resolve(flag('--out', path.join(HERE, '..', 'out', 'selftest')));
fs.mkdirSync(OUT, { recursive: true });

const controls = [];
const check = (id, name, pass, detail) => { controls.push({ id, name, pass: !!pass, detail }); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

// ---------------------------------------------------------------- the stub world
import { slices, makeEngine } from './stub/world.mjs';
const L0chars = makeEngine('L0', { G: 0, H: 0, T: 0 }).dump().length;
const ctxFit = Math.ceil((L0chars + 1500) / (CONSTANTS.FULL_FIT * CONSTANTS.CTX_CHARS_PER_TOKEN) * 1.15);

const qdir = path.join(OUT, 'stub-qset');
fs.rmSync(qdir, { recursive: true, force: true });
const built = buildStubQset({ dir: qdir, slices });
process.env.HARNESS_QSET_DIR = qdir;   // only mutant H3 reads this; production code never does
await new Promise((r) => setTimeout(r, 15));
const runStart = new Date().toISOString();
fs.writeFileSync(path.join(OUT, 'RUNSTART.time'), runStart + '\n');

// seal verified BEFORE anything runs
let sealInfo;
try { sealInfo = verifyManifest(qdir); checkOrder(sealInfo.time, runStart); check('SEAL', 'manifest, hashes and stamp order verify before the run', true, `${sealInfo.files} files`); }
catch (e) { check('SEAL', 'manifest, hashes and stamp order verify before the run', false, String(e.message)); }
const questions = loadQuestions(qdir);
const order = JSON.parse(fs.readFileSync(path.join(qdir, 'stream_order.json'), 'utf8')).order;

// models
const M = {
  lazy: makeStubModel({ policy: 'lazy', ctx_tokens: 1e6 }),
  diligent: makeStubModel({ policy: 'diligent', ctx_tokens: 1e6 }),
  copy: makeStubModel({ policy: 'copy', ctx_tokens: 1e6 }),
  random: makeStubModel({ policy: 'random', ctx_tokens: 1e6 }),
  unknown: makeStubModel({ policy: 'unknown', ctx_tokens: 1e6 }),
  closedbook: makeStubModel({ policy: 'closedbook', ctx_tokens: 1e6 }),
  reader: makeStubModel({ policy: 'reader', ctx_tokens: ctxFit }),
  glitchy: makeStubModel({ policy: 'lazy', glitch: 7, name: 'stub-lazy-glitch', ctx_tokens: 1e6 }),
};
// a spy on what the model is sent first for every question (leak check). The spy records; it never alters.
const firstPrompts = [];
const spy = (m) => ({ describe: m.describe, complete: async (a) => { if (a.messages.length === 2) firstPrompts.push(a.messages.map((x) => x.content).join('\n')); return m.complete(a); } });

const truths = loadSealedTruths(qdir, questions);          // the selftest (not the model) may open it
const idsBySlice = new Map(Object.keys(slices).map((s) => [s, makeEngine(s, { G: 0, H: 0, T: 0 }).ids()]));
const byQ = new Map(questions.map((q) => [q.qid, q]));
const byText = new Map(questions.map((q) => [q.text, q]));
const N = questions.length;
const nWhere = (pred) => questions.filter((q) => pred(q, truths.get(q.qid))).length;
const share = (pred) => nWhere(pred) / N;

async function runScored(arm, model, mk = makeEngine) {
  const run = await runArm({ questions, order, arm, model, makeEngine: mk });
  const scored = scoreRun({ questions, run, truths, idsBySlice });
  return { run, scored, summary: summarize(run, scored) };
}

// ---------------------------------------------------------------- the two studies (factorial + poisons)
const armsLazy = [...FACTORIAL, 'X-G', 'X-H', 'X-T', 'X-V', 'F'];
const studyL = await runStudy({ qdir, questions, order, model: spy(M.lazy), armNames: armsLazy, makeEngine, readerModel: M.reader, B });
const studyD = await runStudy({ qdir, questions, order, model: M.diligent, armNames: [...FACTORIAL, 'X-H'], makeEngine, B });
studyL.arms.CB = await (async () => { const r = await runScored('CB', M.closedbook); return r; })();
studyL.arms.SC = await (async () => { const r = await runScored('P111', M.copy); r.run.arm = 'SC'; return r; })();
const accOf = (a) => a.summary.accuracy;

// ---------------------------------------------------------------- controls: accounting, leaks, static scans
// accounting: characters shown (summed over calls) can never be less than the unique content shown
const acct = studyL.arms.P111.run.records.every((r) => r.chars_in >= r.chars_unique && r.chars_in > 0 && r.model_calls >= 1 && r.trace.filter((t) => t.tool).length === r.tool_calls);
check('C-ACCOUNT', 'characters shown, calls and trace agree (no uncounted turn or tool result)', acct, 'chars_in >= chars_unique, tool steps == tool_calls');

// leak: first prompt of every question holds none of the hidden labels or the truth
{
  let bad = 0; const why = [];
  const labels = ['stratum', 'truth_status', 'S_G', 'S_H', 'S_T', 'S_0', 'UNKNOWN_BY_DATA', 'KNOWN', 'answer_commit', 'evidence_ids'];
  firstPrompts.forEach((p, i) => {
    const q = byText.get(/^QUESTION: (.*)$/m.exec(p)[1]);
    for (const l of labels) if (p.includes(l)) { bad++; why.push(l); }
    if (p.includes(q.family)) { bad++; why.push('family'); }
    const t = truths.get(q.qid);
    if (typeof t.answer === 'string' && t.answer.length >= 12 && !q.text.includes(t.answer) && !q.answer_format.includes(t.answer) && p.includes(t.answer)) { bad++; why.push('truth answer'); }
  });
  check('C-LEAK', 'the first prompt of every question holds no truth, family label, stratum or commitment', bad === 0 && firstPrompts.length > 0, `${firstPrompts.length} prompts scanned, ${bad} hits ${[...new Set(why)].join(',')}`);
}
// static: the model-facing code never names the sealed files or hidden labels; the oracle never imports an engine
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
  const read = (f) => strip(fs.readFileSync(path.join(HERE, f), 'utf8'));
  const forbidden = /(sealed|answers\.jsonl|truth_status|stratum|S_G\b|answer_commit|evidence_ids)/;
  const modelFacing = ['lib/controller.mjs', 'lib/poison.mjs', 'engines/stub-engine.mjs', 'models/stub-model.mjs'];
  const hits = modelFacing.filter((f) => forbidden.test(read(f)));
  check('C-STATIC-1', 'model-facing code (controller, poison, engine, models) has no path to sealed files or hidden labels', hits.length === 0, hits.join(',') || 'clean');
  const orc = read('stub/oracle.mjs');
  check('C-STATIC-2', 'the oracle imports no engine, model or harness code (no circular truth)', !/import[^;]*(engines|models|lib\/)/.test(orc), 'oracle imports: ' + ((orc.match(/import[^;]*;/g) || []).join(' ') || 'none'));
}

// ---------------------------------------------------------------- null controls
{
  const u = await runScored('P111', M.unknown);
  const expect = share((q, t) => t.status === 'UNKNOWN_BY_DATA');
  check('N1', 'constant-unknown: accuracy equals the UNKNOWN_BY_DATA share, wrong rate 0', near(u.summary.accuracy, expect) && u.summary.wrong_rate === 0, `acc ${u.summary.accuracy.toFixed(4)} vs share ${expect.toFixed(4)}, wrong ${u.summary.wrong_rate}`);
}
{
  const runsR = {};
  for (const a of FACTORIAL) runsR[a] = await runScored(a, M.random);
  const eff = ['G', 'H', 'T'].map((f) => mainEffect({ questions, runs: runsR, f, metric: 'M1', B_boot: B }));
  check('N2', 'random answerer ignores the engine: no feature shows an accuracy difference (all TIE, point 0)', eff.every((e) => e.verdict === 'TIE' && near(e.point, 0)) && accOf(runsR.P111) < 0.5, eff.map((e) => `${e.verdict}@${e.point.toFixed(3)}`).join(' ') + ` acc ${accOf(runsR.P111).toFixed(3)}`);
}
{
  // N3 deterministic stub: identical-arm replay has zero noise; and a deliberately noisy model must RAISE the floor
  const z = Object.values(studyL.noise).every((x) => x === 0);
  let n = 0; const noisy = { describe: M.lazy.describe, complete: async (a) => { const r = await M.lazy.complete(a); n++; return n % 11 === 0 && r.text.includes('"final"') ? { text: JSON.stringify({ final: { status: 'answer', answer: 'lane-d', cite: [] } }) } : r; } };
  const r1 = await runScored('P111', noisy), r2 = await runScored('P111', noisy);
  const c = contrast({ questions, A: r1, B: r2, metric: 'M1', B_boot: B });
  check('N3', 'identical-arm replay: zero noise on the deterministic stub; a noisy model raises the floor above zero', z && (c.hi - c.lo) / 2 > 0, `stub floor ${JSON.stringify(studyL.noise)}, noisy half-width ${((c.hi - c.lo) / 2).toFixed(4)}`);
}
{
  const blind = (slice, f) => { const e = makeEngine(slice, f); return { ...e, call: () => ({ ok: true, result: { total: 0, shown: [] } }) }; };
  const honest = await runScored('P111', M.lazy, blind);
  const guess = await runScored('P111', M.copy, blind);
  const sh = share((q, t) => t.status === 'UNKNOWN_BY_DATA');
  check('N4', 'blind engine: the honest policy answers unknown (wrong 0); the guessing policy shows wrong > 0', honest.summary.wrong_rate === 0 && guess.summary.wrong_rate > 0.1 && near(honest.summary.accuracy, sh), `honest wrong ${honest.summary.wrong_rate}, guess wrong ${guess.summary.wrong_rate.toFixed(3)}`);
}
{
  const permute = (slice, f) => {
    const es = slices[slice]; const ad = [...new Set(es.filter((e) => !e.addr.startsWith('schema:')).map((e) => e.addr))].sort();
    const map = new Map(ad.map((a, i) => [a, ad[(i + 1) % ad.length]]));
    return openStub({ entries: es.map((e) => (map.has(e.addr) ? { ...e, addr: map.get(e.addr) } : e)), features: f });
  };
  const clean = studyD.arms.P111.summary.accuracy;
  const shuf = await runScored('P111', M.diligent, permute);
  check('N5', 'shuffled log: the expert policy falls well below its clean accuracy (answers come from the log)', shuf.summary.accuracy < clean - 0.3, `clean ${clean.toFixed(3)}, shuffled ${shuf.summary.accuracy.toFixed(3)}`);
}
{
  const cb = accOf(studyL.arms.CB);
  const floor = Math.max(0.05, studyL.noise.M1 || 0);
  const lows = FACTORIAL.filter((a) => !(accOf(studyD.arms[a]) - cb > floor));
  check('N6', 'closed book: every factorial arm (expert policy) beats it by more than the effective MEI', lows.length === 0, `closed book ${cb.toFixed(3)}; arms not beating it: ${lows.join(',') || 'none'}`);
}

// ---------------------------------------------------------------- positive controls
check('P1', 'expert ceiling: the expert policy on P111 scores at least 0.99', accOf(studyD.arms.P111) >= 0.99, `acc ${accOf(studyD.arms.P111).toFixed(4)}; misses: ${studyD.arms.P111.scored.filter((s) => !s.correct).slice(0, 5).map((s) => byQ.get(s.qid).family + ':' + s.outcome).join(' ') || 'none'}`);
{
  // planted effects, computed from the truths and the stub's construction (not from any run)
  const plantedG = share((q) => ['S-CREATOR', 'S-GIZMO'].includes(q.family));
  const plantedH = share((q, t) => q.family === 'S-HELD' && t.status === 'HELD');
  const eG = mainEffect({ questions, runs: studyL.arms, f: 'G', metric: 'M1', noise: studyL.noise, B_boot: B });
  const eH = mainEffect({ questions, runs: studyL.arms, f: 'H', metric: 'M1', noise: studyL.noise, B_boot: B });
  const eT = mainEffect({ questions, runs: studyL.arms, f: 'T', metric: 'M1', noise: studyL.noise, B_boot: B });
  const eTb = mainEffect({ questions, runs: studyL.arms, f: 'T', metric: 'M4b', noise: studyL.noise, B_boot: B });
  const dH = mainEffect({ questions, runs: studyD.arms, f: 'H', metric: 'M1', noise: studyD.noise, B_boot: B });
  const ok = near(eG.point, plantedG) && eG.lo <= plantedG + 1e-9 && eG.hi >= plantedG - 1e-9 && eG.verdict === 'WIN'
    && near(eH.point, plantedH) && eH.lo <= plantedH + 1e-9 && eH.hi >= plantedH - 1e-9 && eH.verdict === (plantedH > eH.mei ? 'WIN' : 'TIE') && plantedH > eH.mei
    && near(eT.point, 0) && eT.verdict === 'TIE'
    && eTb.point < 0 && eTb.verdict === 'WIN'
    && near(dH.point, 0) && dH.verdict === 'TIE';
  check('P2', 'planted effects recovered: G and H are WIN for the lazy policy at the planted size, T is TIE on accuracy and WIN on engine bytes, H is TIE for the diligent policy', ok,
    `lazy G ${eG.point.toFixed(4)} (planted ${plantedG.toFixed(4)}) ${eG.verdict}; lazy H ${eH.point.toFixed(4)} (planted ${plantedH.toFixed(4)}) ${eH.verdict}; lazy T acc ${eT.point.toFixed(4)} ${eT.verdict}; lazy T engine bytes ${eTb.point.toFixed(3)} ${eTb.verdict}; diligent H ${dH.point.toFixed(4)} ${dH.verdict}`);
}
{
  const F = studyL.arms.F; const n01 = nWhere((q) => q.tier !== 'L0'); const inf = F.scored.filter((s) => !s.feasible).length;
  const l0 = F.scored.filter((s) => s.feasible);
  const okL0 = l0.length === nWhere((q) => q.tier === 'L0') && l0.every((s) => s.correct);
  check('P3', 'full-context ceiling: the reader answers every L0 question from the dump; L1 and L2 are INFEASIBLE (never truncated)', okL0 && inf === n01 && F.run.records.filter((r) => !r.feasible).every((r) => r.model_calls === 0), `L0 feasible ${l0.length}, correct ${l0.filter((s) => s.correct).length}; infeasible ${inf} of ${n01}`);
}
{
  const drop = (x, base) => accOf(base) - accOf(x);
  const dG = drop(studyL.arms['X-G'], studyL.arms.P111), dH = drop(studyL.arms['X-H'], studyL.arms.P111), dV = drop(studyL.arms['X-V'], studyL.arms.P000);
  const tSame = near(accOf(studyL.arms['X-T']), accOf(studyL.arms.P111));
  check('P4', 'poison sensitivity: forged ground, forged count and stale value each lower accuracy; forged hints change no answer (one-sided rule; vacuous for T on the stub: no stub policy follows hints)', dG > 0.01 && dH > 0.05 && dV > 0.05 && tSame,
    `X-G -${dG.toFixed(3)}, X-H -${dH.toFixed(3)}, X-V -${dV.toFixed(3)}, X-T same answers ${tSame}`);
}
{
  // P5 tamper
  const tmp = path.join(OUT, 'tamper'); fs.rmSync(tmp, { recursive: true, force: true }); fs.cpSync(qdir, tmp, { recursive: true });
  let caught = [];
  const tryIt = (label, fn) => { try { fn(); } catch (e) { if (e instanceof SealError) caught.push(label); } };
  const qf = path.join(tmp, 'questions.jsonl'); const orig = fs.readFileSync(qf);
  fs.writeFileSync(qf, Buffer.concat([orig.subarray(0, 50), Buffer.from(orig[50] === 65 ? 'B' : 'A'), orig.subarray(51)]));
  tryIt('question byte', () => verifyManifest(tmp));
  fs.writeFileSync(qf, orig);
  const af = path.join(tmp, 'sealed', 'answers.jsonl'); const ao = fs.readFileSync(af, 'utf8');
  fs.writeFileSync(af, ao.replace(/"salt":"([0-9a-f]{4})/, (m, g) => `"salt":"${g === '0000' ? '1111' : '0000'}`));
  tryIt('sealed answer file', () => verifyManifest(tmp));
  // re-hash the manifest after editing the sealed file: the per-question commitment must still catch it
  const mf = path.join(tmp, 'QSET.manifest.sha256');
  const lines = fs.readFileSync(mf, 'utf8').trim().split('\n').map((l) => { const [, f] = l.split('  '); return f === 'sealed/answers.jsonl' ? `${sha256(fs.readFileSync(af))}  ${f}` : l; });
  fs.writeFileSync(mf, lines.join('\n') + '\n');
  tryIt('commitment', () => { verifyManifest(tmp); loadSealedTruths(tmp, questions); });
  tryIt('stamp order', () => checkOrder('2099-01-01T00:00:00.000Z', runStart));
  check('P5', 'seal tamper: a changed question byte, a changed sealed answer, a re-hashed manifest, and a wrong stamp order are each refused', caught.length === 4, `caught: ${caught.join(', ')}`);
}
{
  const same = JSON.stringify(studyL.arms.P111.run.records) === JSON.stringify(studyL.arms.__retest.run.records);
  const r1 = await runScored('P000', M.random), r2 = await runScored('P000', M.random);
  const sameRandom = JSON.stringify(r1.run.records) === JSON.stringify(r2.run.records);
  const per = questions.slice(0, 120).map((q, i) => ({ cluster: q.cluster, a: i % 3 === 0 ? 1 : 0, b: i % 5 === 0 ? 1 : 0 }));
  const b1 = bootstrap(per, 'diff', { B: 300 }), b2 = bootstrap(per, 'diff', { B: 300 });
  const sameBoot = b1.lo === b2.lo && b1.hi === b2.hi;
  const q1 = genSlice({ seed: 7, nClips: 5, nLeases: 2, nStmts: 2, nGizmo: 1 }), q2 = genSlice({ seed: 7, nClips: 5, nLeases: 2, nStmts: 2, nGizmo: 1 });
  check('P6', 'determinism: identical seeds give byte-identical runs, random answerer, bootstrap intervals and generated logs', same && sameRandom && sameBoot && JSON.stringify(q1) === JSON.stringify(q2), `lazy ${same}, random ${sameRandom}, bootstrap ${sameBoot}`);
}
{
  const FAKE = 'sk-test-FAKE0123456789abcdef';
  process.env.FAKE_API_KEY = FAKE;
  const echo = { describe: M.lazy.describe, complete: async () => ({ text: `token=${FAKE} {"final":{"status":"unknown","answer":null,"cite":[]}}` }) };
  const r = await runArm({ questions, order: order.slice(0, 5), arm: 'P111', model: echo, makeEngine });
  const blob = JSON.stringify(r.records);
  delete process.env.FAKE_API_KEY;
  check('P7', 'secret redaction: a planted fake key (in env and in model output) appears in no record or trace', !blob.includes(FAKE) && blob.includes('REDACTED') && !redact(FAKE).includes('FAKE0123'), 'records scanned ' + r.records.length);
}

// ---------------------------------------------------------------- controller behaviour controls
{
  const inv = [];
  for (const [name, st] of [['lazy', studyL], ['diligent', studyD]]) {
    for (const [g, h] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      const off = st.arms[`P${g}${h}0`], on = st.arms[`P${g}${h}1`];
      const diff = off.run.records.filter((r, i) => JSON.stringify(r.final) !== JSON.stringify(on.run.records[i].final)).length;
      if (diff) inv.push(`${name} G${g}H${h}: ${diff}`);
    }
  }
  check('C-TRAIL-INVARIANCE', 'removing every trail changes no answer (trails only move cost)', inv.length === 0, inv.join('; ') || 'answers identical with trails on and off, 8 pairs');
}
{
  const dd = FACTORIAL.map((a) => [a, studyD.arms[a].run.records.reduce((s, r) => s + r.dedup, 0)]);
  check('C-DEDUPE', 'the seen ledger acts in every pointer arm (no arm is exempt)', dd.every(([, n]) => n > 0), dd.map(([a, n]) => `${a}:${n}`).join(' '));
}
{
  const g = await runScored('P111', M.glitchy);
  const always = { describe: M.lazy.describe, complete: async () => ({ text: 'no json here' }) };
  const rb = await runArm({ questions, order: order.slice(0, 4), arm: 'P111', model: always, makeEngine });
  const forever = { describe: M.lazy.describe, complete: async () => ({ text: '{"tool":"ask","args":{"addr":"c000"}}' }) };
  const rt = await runArm({ questions, order: order.slice(0, 2), arm: 'P111', model: forever, makeEngine });
  const big = (slice, f) => { const e = makeEngine(slice, f); return { ...e, call: (n, a) => ({ ok: true, result: { total: 9, shown: [], pad: 'x'.repeat(5000) } }) }; };
  const rc = await runArm({ questions, order: order.slice(0, 3), arm: 'P111', model: M.lazy, makeEngine: big });
  const ok = g.run.records.some((r) => r.format_errors > 0) && g.run.records.every((r) => !r.format_failure) && near(g.summary.accuracy, studyL.arms.P111.summary.accuracy)
    && rb.records.every((r) => r.format_failure && r.final.status === 'unknown' && r.format_errors === 2)
    && rt.records.every((r) => r.turn_limit && r.final.status === 'unknown' && r.tool_calls === CONSTANTS.MAX_TURNS)
    && rc.records.every((r) => r.truncations >= 1);
  check('C-CONTROLLER', 'one re-prompt fixes a glitch; two bad replies end as unknown; the turn limit forces unknown; oversize results are cut and counted', ok,
    `glitch fixed ${g.run.records.filter((r) => r.format_errors).length} questions; bad-reply ${rb.records.length}; turn-limit ${rt.records.length}; truncated ${rc.records.filter((r) => r.truncations).length}`);
}
{
  const a = auditReplay({ questions, run: studyL.arms.P111.run, makeEngine });
  const blind = (slice, f) => { const e = makeEngine(slice, f); return { ...e, call: () => ({ ok: true, result: { total: 0, shown: [] } }) }; };
  const bad = auditReplay({ questions, run: studyL.arms.P111.run, makeEngine: blind });
  check('C-AUDIT', 'audit replay reproduces every tool output (M6 = 1) and detects a different engine (M6 < 1)', a.rate === 1 && bad.rate < 1, `matching ${a.matched}/${a.runs}; against a blind engine ${bad.matched}/${bad.runs}`);
}

{
  // perspective-dependence: the lazy policy's outcome flips between the bare arm and the G arm on exactly the questions the stub planted for G
  const fl = flips(studyL.arms, ['P000', 'P100']);
  const nG = nWhere((q) => ['S-CREATOR', 'S-GIZMO'].includes(q.family));
  const fl2 = flips(studyL.arms, ['P000', 'P001']);
  check('C-FLIPS', 'flip accounting: G flips exactly the planted questions; T flips none', fl.pair_counts['P000|P100'] === nG && fl2.pair_counts['P000|P001'] === 0, `P000|P100 ${fl.pair_counts['P000|P100']} (planted ${nG}); P000|P001 ${fl2.pair_counts['P000|P001']}`);
}

// ---------------------------------------------------------------- verdict tables (STUB; harness exercise only)
let tables = null;
if (!quick) {
  const strata = new Map([...truths.values()].map((t) => [t.qid, t.stratum]));
  const feats = {}, specs = {};
  for (const f of ['G', 'H', 'T']) { feats[f] = featureVerdicts(studyL, f, { B }); specs[f] = specificity(studyL, f, strata, { B }); }
  const parity = ['L0', 'L1'].map((t) => parityVerdict(studyL, t, { B }));
  const scale = scaleVerdict(studyL, 'L0', 'L2', { B });
  const audit = auditVerdict(studyL, { B });
  const allPass = () => controls.every((c) => c.pass);
  tables = { label: 'STUB: harness exercise only, no claim about the real pharos or any real model', features: feats, specificity: specs, parity, scale, audit, overall: overall(parity, scale, feats, audit, specs, allPass()),
    diligent: { G: featureVerdicts(studyD, 'G', { B }).claim, H: featureVerdicts(studyD, 'H', { B }).claim, T: featureVerdicts(studyD, 'T', { B }).claim },
    summaries: Object.fromEntries(Object.entries(studyL.arms).filter(([k]) => !k.startsWith('__')).map(([k, v]) => [k, { ...v.summary, table: undefined }])),
    tables_3x3: { P000: studyL.arms.P000.summary.table, P111: studyL.arms.P111.summary.table } };
}

// ---------------------------------------------------------------- report
const passed = controls.filter((c) => c.pass).length;
const report = { label: 'STUB SELF-TEST: harness result only. No result on the real engine or a real model is claimed.', quick, B, questions: N, strata: built.strata,
  stub_slices: Object.fromEntries(Object.entries(slices).map(([k, v]) => [k, v.length])), controls, passed, total: controls.length, all_pass: passed === controls.length, tables };
fs.writeFileSync(path.join(OUT, quick ? 'selftest.quick.json' : 'selftest.json'), JSON.stringify(report, null, 2) + '\n');
const lines = [report.label, `questions ${N}  strata ${JSON.stringify(built.strata)}  B ${B}${quick ? '  (quick)' : ''}`, ''];
for (const c of controls) lines.push(`${c.pass ? 'PASS' : 'FAIL'}  ${c.id.padEnd(20)} ${c.name}\n      ${c.detail}`);
lines.push('', `${passed}/${controls.length} controls passed`);
if (tables) {
  lines.push('', 'Verdict machinery on the stub (lazy policy; planted: G and H matter, T is cost-only):');
  for (const f of ['G', 'H', 'T']) {
    const v = tables.features[f];
    lines.push(`  feature ${f}: ${v.claim}`);
    for (const m of ['M1', 'M2', 'M4a', 'M4b']) lines.push(`     ${m}: add ${v.add[m].verdict} (${v.add[m].point.toFixed(3)} [${v.add[m].lo.toFixed(3)}, ${v.add[m].hi.toFixed(3)}])  drop ${v.drop[m].verdict} (${v.drop[m].point.toFixed(3)})`);
    lines.push(`     D5 specificity: localised ${tables.specificity[f].localised}, downgrade ${tables.specificity[f].downgrade}`);
  }
  lines.push(`  D1 parity: ${tables.parity.map((p) => `${p.tier}: ${p.accuracy ? p.accuracy.verdict : p.status}`).join('; ')}`);
  lines.push(`  D2 scale L0->L2: ${tables.scale.verdict || tables.scale.status}`);
  lines.push(`  D4 audit: M6 ${tables.audit.m6}, supported ${tables.audit.supported}`);
  lines.push(`  D6 overall (stub, for the machinery only): ${tables.overall.D6}`);
  lines.push(`  diligent policy: ${JSON.stringify(tables.diligent)}`);
}
fs.writeFileSync(path.join(OUT, quick ? 'selftest.quick.txt' : 'selftest.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
process.exit(report.all_pass ? 0 : 1);
