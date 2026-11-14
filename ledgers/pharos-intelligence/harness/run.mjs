#!/usr/bin/env node
// run.mjs: runs the arms of PREREG section 5 for ONE model over a SEALED question set against an engine adapter, then computes the
// section 11 verdicts. This is the entry point for the real study. It runs nothing real here: no real engine, model or question set exists yet.
//
//   node harness/run.mjs --qset <qset dir> --engine <module exporting makeEngine(slice, features)>
//        --model <module> [--model-export makeModel] [--model-opts '{"model":"...","ctx_tokens":8192}']
//        --arms P000,P111,F,CB --out <dir> --controls-report <json from the real-engine controls> [--B 10000] [--stub]
//
// Refuses to start unless: the seal verifies, the stamp predates this run, and (unless --stub) a controls report with all_pass is given.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyManifest, checkOrder, loadQuestions, verifyCommitments, SealError } from './lib/seal.mjs';
import { runStudy } from './lib/study.mjs';
import { flips } from './lib/runner.mjs';
import { FACTORIAL } from './lib/arms.mjs';
import { featureVerdicts, parityVerdict, scaleVerdict, auditVerdict, specificity, overall } from './lib/verdicts.mjs';
import { redact, envSecrets } from './lib/util.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const need = (n) => { const v = flag(n); if (!v) { console.error('missing ' + n); process.exit(2); } return v; };
const stub = argv.includes('--stub');
const qdir = path.resolve(need('--qset'));
const out = path.resolve(need('--out'));
const B = Number(flag('--B', 10000));
fs.mkdirSync(out, { recursive: true });

// 1. seal, stamp order, controls gate: all before the first model call
let info;
try {
  info = verifyManifest(qdir);
  const runStart = new Date().toISOString();
  fs.writeFileSync(path.join(out, 'RUNSTART.time'), runStart + '\n');
  checkOrder(info.time, runStart);
  verifyCommitments(qdir, loadQuestions(qdir));      // checked and discarded; the run never holds the truths
} catch (e) {
  console.error('REFUSED: ' + (e instanceof SealError ? e.message : e)); process.exit(3);
}
if (!stub) {
  const cr = flag('--controls-report');
  let ok = false;
  try { ok = JSON.parse(fs.readFileSync(cr, 'utf8')).all_pass === true; } catch { /* refused below */ }
  if (!ok) { console.error('REFUSED: a controls report with all_pass true is required (PREREG section 17 step 6)'); process.exit(3); }
}

const eng = await import(pathToFileURL(path.resolve(need('--engine'))).href);
const mod = await import(pathToFileURL(path.resolve(need('--model'))).href);
const model = mod[flag('--model-export', 'makeModel')](JSON.parse(flag('--model-opts', '{}')));
const armNames = flag('--arms', [...FACTORIAL, 'F', 'CB'].join(',')).split(',');
const questions = loadQuestions(qdir);
const order = JSON.parse(fs.readFileSync(path.join(qdir, 'stream_order.json'), 'utf8')).order;

const study = await runStudy({ qdir, questions, order, model, armNames, makeEngine: eng.makeEngine, B });

// 2. records (redacted) and summaries
const secrets = envSecrets();
for (const a of armNames) {
  const lines = study.arms[a].run.records.map((r) => redact(JSON.stringify(r), secrets));
  fs.writeFileSync(path.join(out, `records.${a}.jsonl`), lines.join('\n') + '\n');
}
const summaries = Object.fromEntries(armNames.map((a) => [a, study.arms[a].summary]));
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ stub, model: model.describe(), noise: study.noise, audit: study.audit, summaries }, null, 2) + '\n');

// 3. verdicts: only when the arms they need were run
const verdicts = { stub, label: stub ? 'STUB RUN: machinery only, no claim' : 'real run', model: model.describe().name };
if (FACTORIAL.every((a) => study.arms[a])) {
  const strata = new Map([...study.truths.values()].map((t) => [t.qid, t.stratum]));
  const feats = {}, specs = {};
  for (const f of ['G', 'H', 'T']) { feats[f] = featureVerdicts(study, f, { B }); specs[f] = specificity(study, f, strata, { B }); }
  const tiers = [...new Set(questions.map((q) => q.tier))].sort();
  const parity = tiers.filter((t) => t !== 'L2').map((t) => parityVerdict(study, t, { B }));
  const scale = tiers.includes('L2') ? scaleVerdict(study, 'L0', 'L2', { B }) : { status: 'NOT TESTABLE (no L2)' };
  const audit = auditVerdict(study, { B });
  verdicts.D = { features: feats, specificity: specs, parity, scale, audit, overall: overall(parity, scale, feats, audit, specs, true) };
} else verdicts.D = 'factorial arms not all run; no verdicts computed';
fs.writeFileSync(path.join(out, 'verdicts.json'), JSON.stringify(verdicts, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'flips.json'), JSON.stringify(flips(study.arms, armNames.filter((a) => a !== 'F' && a !== 'CB')), null, 2) + '\n');
console.log(`wrote ${out}: ${armNames.length} arms, ${questions.length} questions${stub ? ' (STUB)' : ''}`);
