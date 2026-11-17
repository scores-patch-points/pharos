// run-s1.mjs — PREREG-S1 B1 (at scale), B4, B5 and the mutants. usage: node ledgers/pharos-binary/run-s1.mjs
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = await import(path.join(ROOT, 'lib/pharos.mjs'));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), 'pharos-s1-' + p));
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng = mulberry32(20261117), int = (n) => Math.floor(rng() * n);
// A generated log: 4 writers, 20,000 valid entries, causal links, retractions, odd values.
const dj = tmp('jsonl-'), writers = ['alice', 'bob', 'carol', 'dan'], lines = Object.fromEntries(writers.map((w) => [w, []]));
const all = []; let t = Date.parse('2026-01-01T00:00:00Z');
for (let i = 0; i < 20000; i++) {
  const by = writers[int(4)], retract = all.length > 10 && rng() < 0.03;
  const seen = all.length ? [all[all.length - 1 - int(Math.min(5, all.length))].id] : [];
  const e = { v: 1, cell: retract ? 'NUL·Figure' : ['INS·Figure', 'EVA·Figure', 'SIG·Ground', 'DEF·Pattern'][int(4)], kind: retract ? 'retract' : 'note',
    addr: retract ? `retract:${i}` : `addr:${int(800)}`, body: retract ? null : { n: i, w: by, txt: 'x'.repeat(int(60)), list: [int(9), int(9)] },
    of: retract ? [all[int(all.length)].id] : rng() < 0.3 && all.length ? [all[int(all.length)].id] : [], basis: rng() < 0.2 ? { prior: 'p' + int(5) } : {},
    seen, by, at: rng() < 0.01 ? 'x' : new Date((t += 1 + int(5000))).toISOString() };
  e.id = P.entryId(e); all.push(e); lines[by].push(P.canonical(e));
}
for (const w of writers) fs.writeFileSync(path.join(dj, w + '.jsonl'), lines[w].join('\n') + '\n');
const dp = tmp('phb-');
for (const w of writers) P.convertFile(path.join(dj, w + '.jsonl'), path.join(dp, w + '.phb'));
// B1 at scale: round trip and identical views
let roundTrip = true;
for (const w of writers) { const d = tmp('rt-'); P.convertFile(path.join(dp, w + '.phb'), path.join(d, w + '.jsonl')); roundTrip &&= fs.readFileSync(path.join(d, w + '.jsonl'), 'utf8') === fs.readFileSync(path.join(dj, w + '.jsonl'), 'utf8'); }
const viewOf = (d) => { const h = P.open('t', { dir: d, writer: 'reader', frame: false }); const s = P.status(h); return JSON.stringify({ ids: P.entries(h).map((e) => e.id), fold: P.fold(h), status: { ...s, dir: null, writers: null } }); };
const sameViews = viewOf(dj) === viewOf(dp);
// B4 size
const bytes = (d) => fs.readdirSync(d).reduce((n, f) => n + fs.statSync(path.join(d, f)).size, 0);
const size = { jsonl: bytes(dj), phb: bytes(dp) }; size.ratio = +(size.phb / size.jsonl).toFixed(4);
// B5 cold load, fresh process each run
const loadMs = (d) => { const r = spawnSync(process.execPath, ['-e', `const P=await import(${JSON.stringify(path.join(ROOT, 'lib/pharos.mjs'))});const t=process.hrtime.bigint();P.entries(P.open('t',{dir:${JSON.stringify(d)},writer:'reader',frame:false}));console.log(Number(process.hrtime.bigint()-t)/1e6)`], { encoding: 'utf8', input: '' , env: { ...process.env } }); return +r.stdout.trim(); };
const med = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const speed = { jsonl: [], phb: [] };
for (let k = 0; k < 5; k++) { speed.jsonl.push(loadMs(dj)); speed.phb.push(loadMs(dp)); }
speed.medianJsonl = med([...speed.jsonl]); speed.medianPhb = med([...speed.phb]);
// Mutants: each in a copy of the repo, run the binary tests, which must FAIL
const mutants = {
  M1_no_chain_check: ['if (!rec || !chainOf(prev, rec.kind, rec.payload).equals(rec.chain)) {', 'if (!rec) {', 'B3b'],
  M2_no_id_check: ['    const why = invalid(e);\n    if (why) { c.corrupt.push({ file: f, offset: r.offset, reason: why }); continue; }', '    const why = invalid({ ...e, id: entryId(e) });\n    if (why) { c.corrupt.push({ file: f, offset: r.offset, reason: why }); continue; }', 'B3c'],
  M3_size_off_by_one: ['tail.writeUInt32BE(size);', 'tail.writeUInt32BE(size + 1);', 'B8'],
};
const mres = {};
for (const [name, [from, to, target]] of Object.entries(mutants)) {
  const d = tmp('mut-'); execFileSync('cp', ['-R', path.join(ROOT, 'lib'), path.join(ROOT, 'test'), path.join(ROOT, 'bin'), path.join(ROOT, 'cells.json'), path.join(ROOT, 'package.json'), d]);
  const lib = path.join(d, 'lib/pharos.mjs'), src = fs.readFileSync(lib, 'utf8');
  if (src.split(from).length !== 2) { mres[name] = { error: 'mutation site not found exactly once' }; continue; }
  fs.writeFileSync(lib, src.replace(from, to));
  const r = spawnSync(process.execPath, ['--test', '--test-name-pattern', `^${target}`, path.join(d, 'test/binary.test.mjs')], { encoding: 'utf8' });
  const fail = /ℹ fail (\d+)/.exec(r.stdout)?.[1];
  mres[name] = { target, failed: +fail, caught: +fail > 0 };
}
const out = { entries: all.length, roundTrip, sameViews, size, speed, mutants: mres,
  verdict: { B1_scale: roundTrip && sameViews, B4: size.ratio <= 0.6, B5: speed.medianPhb <= speed.medianJsonl, mutants: Object.values(mres).every((m) => m.caught) } };
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(ROOT, 'ledgers/pharos-binary/results-s1.json'), JSON.stringify(out, null, 1));
