#!/usr/bin/env node
// mutants.mjs: mutation test of the HARNESS itself (PREREG section 13, H1 to H18). Each mutant is a text edit to one harness source file,
// applied to a COPY of the harness in a scratch directory; the copy's quick self-test must then FAIL (at least one control) or crash.
// A mutant that leaves every control passing is a SURVIVOR and is reported. The original files are never edited.
//   node harness/mutants.mjs [--scratch <dir>] [--only H3,H7]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const SCRATCH = path.resolve(flag('--scratch', path.join(HERE, '..', 'out', 'mutants-scratch')));
const only = flag('--only', '') ? flag('--only', '').split(',') : null;

const LEAK = "const head = [`QUESTION: ${q.text}`, `ANSWER FORMAT: ${q.answer_format}`];";
const M = [
  { id: 'H1', desc: 'scorer counts unknown as correct for every truth status', file: 'lib/score.mjs', edits: [["    out.outcome = 'abstain';", "    out.outcome = 'correct_unknown';"]], expect: ['N1'] },
  { id: 'H2', desc: 'scorer ignores UNKNOWN_BY_DATA', file: 'lib/score.mjs', edits: [["if (truth.status === 'UNKNOWN_BY_DATA') {", 'if (false) {']], expect: ['N1'] },
  { id: 'H3', desc: 'the truth is placed in the model prompt (read from the sealed file)', file: 'lib/controller.mjs',
    edits: [[LEAK, LEAK + " { const fsx = await import('node:fs'); const f = (process.env.HARNESS_QSET_DIR || '') + '/sealed/answers.jsonl'; try { const t = fsx.readFileSync(f, 'utf8').split('\\n').filter(Boolean).map((x) => JSON.parse(x)).find((x) => x.qid === q.qid); head.push('HINT: ' + t.answer); } catch { /* none */ } }"]], expect: ['C-LEAK', 'C-STATIC-1'] },
  { id: 'H4', desc: 'arm flags are ignored (all arms identical)', file: 'engines/stub-engine.mjs', edits: [['const { G, H, T } = features;', 'const G = 1, H = 1, T = 1;']], expect: ['P2', 'P4'] },
  { id: 'H5', desc: 'only the first call\'s characters are counted', file: 'lib/controller.mjs', edits: [['rec.chars_in += chars;', 'if (rec.model_calls === 0) rec.chars_in += chars;']], expect: ['C-ACCOUNT'] },
  { id: 'H6', desc: 'the full-context arm never reports INFEASIBLE', file: 'lib/controller.mjs', edits: [['if (sys.length + prompt.length > CONSTANTS.FULL_FIT * ctxChars) {', 'if (false) {']], expect: ['P3'] },
  { id: 'H7', desc: 'paired bootstrap pairs a question with another question (unpaired)', file: 'lib/runner.mjs', edits: [['const bv = M.f ? M.f(b.s) : M.rec(b.r);', 'const j = (i * 7 + 3) % B.scored.length; const bv = M.f ? M.f(B.scored[j]) : M.rec(B.run.records[j]);']], expect: ['N3', 'P2'] },
  { id: 'H8', desc: 'verdict direction reversed', file: 'lib/stats.mjs', edits: [['const good = higherIsBetter ? (x) => x : (x) => -x;', 'const good = higherIsBetter ? (x) => -x : (x) => x;']], expect: ['P2'] },
  { id: 'H9', desc: 'an unseeded random source', file: 'lib/util.mjs', edits: [['let a = seed >>> 0;', 'let a = (Math.random() * 4294967296) >>> 0;']], expect: ['P6'] },
  { id: 'H10', desc: 'the seal hash check is skipped', file: 'lib/seal.mjs', edits: [["if (sha256(fs.readFileSync(p)) !== m[1]) throw new SealError('hash mismatch: ' + m[2]);", 'if (false) throw new SealError("x");']], expect: ['P5'] },
  { id: 'H11', desc: 'a trail supplies the answer (a stored response is returned)', file: 'engines/stub-engine.mjs',
    edits: [['const warm = T && trails.has(a.addr);', 'const warm = T && trails.has(a.addr); if (warm && trails.get(a.addr) !== 1) return trails.get(a.addr);'], ['      trails.set(a.addr, 1);\n      out.next_look', '      trails.set(a.addr, JSON.parse(JSON.stringify(out)));\n      out.next_look']], expect: ['C-TRAIL-INVARIANCE'] },
  { id: 'H12', desc: 'the survivor count is dropped but the held set kept', file: 'engines/stub-engine.mjs', edits: [['      out.survivors = hs.length;\n', '']], expect: ['P2', 'P4'] },
  { id: 'H13', desc: 'the oracle imports the engine (circular truth)', file: 'stub/oracle.mjs', edits: [["const key = (e) => e.at + '|' + e.id;", "import '../engines/stub-engine.mjs';\nconst key = (e) => e.at + '|' + e.id;"]], expect: ['C-STATIC-2'] },
  { id: 'H14', desc: 'the model-reply cache key omits the arm', file: 'lib/runner.mjs',
    edits: [['else records.push(await runQuestion({ q, arm, model, engine: engineFor(q) }));', "else { globalThis.__C ??= new Map(); const k = model.describe().name + q.qid; if (!globalThis.__C.has(k)) globalThis.__C.set(k, await runQuestion({ q, arm, model, engine: engineFor(q) })); records.push(globalThis.__C.get(k)); }"]], expect: ['P2'] },
  { id: 'H15', desc: 'tool results are not counted in characters shown', file: 'lib/controller.mjs', edits: [['    const chars = messages.reduce((a, m) => a + m.content.length, 0);\n    rec.chars_in += chars;', "    const chars = messages.filter((m) => !m.content.startsWith('RESULT: ')).reduce((a, m) => a + m.content.length, 0);\n    rec.chars_in += chars;"]], expect: ['C-ACCOUNT'] },
  { id: 'H16', desc: 'the secret redactor is a no-op', file: 'lib/util.mjs', edits: [['  let s = String(text);', '  return String(text);\n  let s = String(text);']], expect: ['P7'] },
  { id: 'H17', desc: 'the seen ledger is off for one arm only (P011)', file: 'lib/controller.mjs', edits: [['const seen = new Set();', "const seen = arm.name === 'P011' ? { has: () => false, add: () => {} } : new Set();"]], expect: ['C-DEDUPE', 'C-AUDIT'] },
  { id: 'H18', desc: 'the controller shows the model the family label', file: 'lib/controller.mjs', edits: [[LEAK, "const head = [`QUESTION: ${q.text}`, `ANSWER FORMAT: ${q.answer_format}`, `FAMILY: ${q.family}`];"]], expect: ['C-LEAK'] },
];

function copyHarness(dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(HERE, path.join(dest, 'harness'), { recursive: true, filter: (s) => !s.includes('mutants-scratch') });
  return path.join(dest, 'harness');
}
function runSelf(h, out) {
  const r = spawnSync(process.execPath, [path.join(h, 'selftest.mjs'), '--quick', '--B', '500', '--out', out], { encoding: 'utf8', timeout: 240000 });
  const failed = (r.stdout || '').split('\n').filter((l) => l.startsWith('FAIL')).map((l) => l.split(/\s+/)[1]);
  return { code: r.status, failed, crashed: r.status !== 0 && !failed.length, stderr: (r.stderr || '').split('\n').slice(0, 3).join(' | ') };
}

fs.mkdirSync(SCRATCH, { recursive: true });
const results = [];
// baseline: an unmutated copy must pass every control, otherwise the mutant results mean nothing
{
  const h = copyHarness(path.join(SCRATCH, 'baseline'));
  const b = runSelf(h, path.join(SCRATCH, 'baseline', 'out'));
  results.push({ id: 'BASELINE', desc: 'unmutated copy', outcome: b.code === 0 ? 'PASS (as required)' : 'FAIL (mutant results void)', failed: b.failed });
  if (b.code !== 0) { console.log(JSON.stringify(results, null, 2)); process.exit(2); }
}
for (const m of M) {
  if (only && !only.includes(m.id)) continue;
  const h = copyHarness(path.join(SCRATCH, m.id));
  const f = path.join(h, m.file);
  let src = fs.readFileSync(f, 'utf8'); let bad = null;
  for (const [find, rep] of m.edits) {
    const n = src.split(find).length - 1;
    if (n !== 1) { bad = `edit matched ${n} times (needs exactly 1): ${find.slice(0, 60)}`; break; }
    src = src.replace(find, () => rep);
  }
  if (bad) { results.push({ id: m.id, desc: m.desc, outcome: 'NOT APPLICABLE', detail: bad }); continue; }
  fs.writeFileSync(f, src);
  const r = runSelf(h, path.join(SCRATCH, m.id, 'out'));
  const caught = r.code !== 0;
  results.push({ id: m.id, desc: m.desc, outcome: caught ? (r.crashed ? 'CAUGHT (crash)' : 'CAUGHT') : 'SURVIVED', failed_controls: r.failed, expected: m.expect, as_expected: caught && m.expect.every((e) => r.failed.includes(e) || r.crashed), stderr: r.crashed ? r.stderr : undefined });
}
const caught = results.filter((r) => /^CAUGHT/.test(r.outcome)).length, surv = results.filter((r) => r.outcome === 'SURVIVED'), na = results.filter((r) => r.outcome === 'NOT APPLICABLE');
const outDir = path.join(HERE, '..', 'out'); fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'mutants.json'), JSON.stringify({ label: 'harness mutants on the STUB; harness result only', caught, survivors: surv.map((s) => s.id), not_applicable: na.map((s) => s.id), results }, null, 2) + '\n');
const lines = ['Harness mutants (H1 to H18), each applied to a copy; the quick self-test must then fail.', ''];
for (const r of results) lines.push(`${r.outcome.padEnd(16)} ${r.id.padEnd(9)} ${r.desc}${r.failed_controls ? '\n                   failed controls: ' + (r.failed_controls.join(', ') || '(crash)') + (r.as_expected === false ? '   [NOT the controls expected: ' + r.expected.join(',') + ']' : '') : ''}${r.detail ? '\n                   ' + r.detail : ''}`);
lines.push('', `caught ${caught} of ${M.length - (only ? M.length - results.length + 1 : 0)}; survivors: ${surv.map((s) => s.id).join(',') || 'none'}; not applicable: ${na.map((s) => s.id).join(',') || 'none'}`);
fs.writeFileSync(path.join(outDir, 'mutants.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
process.exit(surv.length || na.length ? 1 : 0);
