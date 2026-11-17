// run-s2.mjs — PREREG-S2. usage: node ledgers/pharos-binary/run-s2.mjs [steps]
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = await import(pathToFileURL(path.join(ROOT, 'lib/pharos.mjs')).href);
const STEPS = +(process.argv[2] ?? 3000);
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), 'pharos-s2-' + p));
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng = mulberry32(20261125), int = (n) => Math.floor(rng() * n);
const ADDRS = 800, addrOf = () => `a${Math.floor(ADDRS * rng() ** 3)}`;
const D = tmp('log-'), W = [0, 1, 2, 3].map((i) => P.open('s2', { dir: D, writer: `w${i}`, format: 'phb' }));
P.weave(W[0], { cell: 'DEF·Figure', kind: 'kind', addr: 'kind:note', body: { name: 'note', cell: 'INS·Figure' } });
P.weave(W[0], { cell: 'DEF·Figure', kind: 'kind', addr: 'kind:score', body: { name: 'score', cell: 'EVA·Figure' } });
const KIND = [['note', 'INS·Figure'], ['score', 'EVA·Figure']];
const last = new Map(); const retracts = []; const t0 = Date.now();
for (let s = 0; s < STEPS; s++) {
  const w = W[int(4)], r = rng();
  if (r < 0.05 && last.size) { const k = [...last.keys()][int(last.size)]; const e = P.weave(w, { cell: 'NUL·Figure', kind: 'retract', addr: `retract:${s}`, body: null, of: [last.get(k)] }); retracts.push(e.id); last.delete(k); }
  else if (r < 0.053 && retracts.length) { P.weave(w, { cell: 'NUL·Figure', kind: 'retract', addr: `unretract:${s}`, body: null, of: [retracts[int(retracts.length)]] }); }
  else { const [kind, cell] = KIND[int(2)], addr = addrOf(); const e = P.weave(w, { cell, kind, addr, body: { s, v: int(5) } }); last.set(`${addr}|${cell}`, e.id); }
  if (s === Math.floor(STEPS / 3) || s === Math.floor((2 * STEPS) / 3)) { // a fork of TWO concurrent writers, each in its own copy, merged back verbatim one after the other
    const forks = ['A', 'B'].map((who) => { const S = tmp('fork-'); execFileSync('cp', ['-R', D + '/.', S]); return P.open('s2', { dir: S, writer: `fork${who}${s}`, format: 'phb', frame: false }); });
    for (const F of forks) for (let k = 0; k < 30; k++) { const [kind, cell] = KIND[int(2)]; P.weave(F, { cell, kind, addr: `a${int(20)}`, body: { fork: F.writer, k } }); }
    for (let k = 0; k < 40; k++) { const [kind, cell] = KIND[int(2)]; P.weave(W[int(4)], { cell, kind, addr: `a${int(20)}`, body: { main: s, k } }); }
    for (const F of forks) P.merge(W[0], F);
  }
  if (s % 500 === 0) process.stderr.write(`step ${s} ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
}
const reader = P.open('s2', { dir: D, writer: 'reader', frame: false, format: 'phb' });
const all = P.entries(reader), pos = new Map(all.map((e, i) => [e.id, i]));
const groups = new Map(); for (const e of all) if (e.kind === 'note' || e.kind === 'score') { const k = `${e.addr}|${e.cell}`; groups.set(k, Math.max(groups.get(k) ?? -1, pos.get(e.id))); }
const keys = [...groups.keys()]; for (let i = keys.length - 1; i > 0; i--) { const j = int(i + 1); [keys[i], keys[j]] = [keys[j], keys[i]]; }
const Q = keys.slice(0, 1000).map((k) => ({ k, hot: groups.get(k) >= all.length * 0.9 })).concat(Array.from({ length: 100 }, (_, i) => ({ k: `absent${i}|INS·Figure`, hot: false, absent: true })));
const evalWith = (lib) => Q.map((q) => { const [addr, cell] = q.k.split('|'); const want = P.heads(reader, addr, cell), got = lib.askHeads(reader, addr, cell); return { ...q, ok: JSON.stringify(want) === JSON.stringify(got.heads), nonEmptyOk: !(want.length && !got.heads.length), share: got.touched / got.total, early: got.early, fallback: got.fallback ?? null }; });
const R = evalWith(P);
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
// S2-4: every version-2 record really descends from every earlier valid record of its file
const v = { entries: new Map(all.map((e) => [e.id, e])) }, ancestors = (id) => { const seen = new Set(), stk = [id]; while (stk.length) { const e = v.entries.get(stk.pop()); for (const q of [...e.seen, ...e.of]) if (v.entries.has(q) && !seen.has(q)) { seen.add(q); stk.push(q); } } return seen; };
let bitsTrue = 0, bitsFalse = 0, unchained = 0;
for (const f of fs.readdirSync(D).filter((f) => f.endsWith('.phb'))) {
  const recs = P.phbRecords(fs.readFileSync(path.join(D, f))).records.filter((r) => r.kind === 1), earlier = [];
  const ids = fs.readFileSync(path.join(D, f)) && (() => { const d = tmp('ids-'); P.convertFile(path.join(D, f), path.join(d, 'x.jsonl')); return fs.readFileSync(path.join(d, 'x.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).id); })();
  recs.forEach((r, i) => { if (r.payload[0] === 2) { const anc = ancestors(ids[i]); if (ids.slice(0, i).every((x) => anc.has(x))) bitsTrue++; else bitsFalse++; } else unchained++; earlier.push(ids[i]); });
}
// Mutants: askHeads from a mutated copy, the reference from the original
const mutants = {
  M1_stop_at_first: ['return cands.length === 1 && st.every((s0) => s0.done || (s0.oldest && s0.oldestChained && anc.has(s0.oldest.id)));', 'return cands.length === 1;'],
  M2_trust_every_record: ['chained: rec.payload[0] === 2, newEnd }', 'chained: true, newEnd }'],
  M3_ignore_retractions: ['const dead = gone(), live = group.filter((g) => !dead.has(g.id));', 'const dead = new Set(), live = group.filter((g) => !dead.has(g.id));'],
};
const mres = {};
for (const [name, [from, to]] of Object.entries(mutants)) {
  const d = tmp('mut-'); execFileSync('cp', ['-R', path.join(ROOT, 'lib'), path.join(ROOT, 'test'), path.join(ROOT, 'cells.json'), d]);
  const src = fs.readFileSync(path.join(d, 'lib/pharos.mjs'), 'utf8');
  if (src.split(from).length !== 2) { mres[name] = { error: 'mutation site not found exactly once' }; continue; }
  fs.writeFileSync(path.join(d, 'lib/pharos.mjs'), src.replace(from, to));
  const M = await import(pathToFileURL(path.join(d, 'lib/pharos.mjs')).href);
  const r = evalWith(M);
  // PREREG-S2 names the generated world as the power check; the world cannot reach M2 (newest-first reading follows time, which matches causal order here),
  // so the targeted tests of test/binary.test.mjs ('S2 ...') are run against each mutant too and reported beside it
  const t = spawnSync(process.execPath, ['--test', '--test-name-pattern', '^S2', path.join(d, 'test/binary.test.mjs')], { encoding: 'utf8' });
  const tf = +(/ℹ fail (\d+)/.exec(t.stdout)?.[1] ?? NaN);
  mres[name] = { wrongInWorld: r.filter((x) => !x.ok).length, caughtByWorld: r.some((x) => !x.ok), targetedTestsFailed: tf, caughtByTargetedTests: tf > 0, caught: r.some((x) => !x.ok) || tf > 0 };
}
const hot = R.filter((r) => r.hot && !r.absent), present = R.filter((r) => !r.absent);
const out = { steps: STEPS, entries: all.length, files: fs.readdirSync(D), questions: R.length, hotQuestions: hot.length,
  S2_1_mismatches: R.filter((r) => !r.ok).length, S2_2_false_absent: R.filter((r) => !r.nonEmptyOk).length,
  S2_3_hot_median_share: med(hot.map((r) => r.share)), cold_median_share: med(present.filter((r) => !r.hot).map((r) => r.share)), absent_median_share: med(R.filter((r) => r.absent).map((r) => r.share)),
  early: { hot: hot.filter((r) => r.early).length, all: R.filter((r) => r.early).length }, fallbacks: R.filter((r) => r.fallback).length,
  S2_4: { chainedBitsTrue: bitsTrue, chainedBitsFalse: bitsFalse, unchainedRecords: unchained }, mutants: mres,
  examples: R.filter((r) => !r.ok).slice(0, 5) };
out.verdict = { S2_1: out.S2_1_mismatches === 0, S2_2: out.S2_2_false_absent === 0, S2_3: out.S2_3_hot_median_share < 0.05, S2_4: bitsFalse === 0, mutants: Object.values(mres).every((m) => m.caught) };
fs.writeFileSync(path.join(ROOT, 'ledgers/pharos-binary/results-s2.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
