// gen-questions.mjs (STUB): builds a sealed STUB question set over stub slices, in exactly the layout QSET-SPEC.md asks the
// real author for, so the seal, scoring and tamper controls are exercised. These are NOT the real questions.
import fs from 'node:fs';
import path from 'node:path';
import { prng, sha256, canonical } from '../lib/util.mjs';
import { truthOf, headsOf } from './oracle.mjs';
import { commitOf } from '../lib/seal.mjs';
import { LANES } from './gen-log.mjs';

const FMT = {
  lane: `Answer with one lane name (${LANES.join(', ')}). Use status unknown if the log does not determine it.`,
  int: 'Answer with an integer. Use status unknown if the log does not determine it.',
  bool: 'Answer true or false. Use status unknown if the log does not determine it.',
  text: 'Answer with the exact text. Use status unknown if the log does not determine it.',
  enum: 'Answer with attributed or not-established. Use status unknown if the log does not determine it.',
};

export function buildStubQset({ dir, slices, seed = 20261113 }) {
  const R = prng(seed);
  const qs = []; const truths = [];
  let n = 0;
  const add = (slice, entries, family, params, text, atype, cluster) => {
    const t = truthOf({ family, ...params }, entries);
    const qid = 'q' + String(++n).padStart(4, '0');
    const q = { qid, source: 'stub', family, tier: slice, slice, text, answer_type: atype, answer_format: FMT[atype], as_of: params.cut || params.t || null, cluster };
    qs.push(q); truths.push({ qid, _entries: entries, _params: params, ...t });
  };
  for (const [slice, entries] of Object.entries(slices)) {
    const addrs = [...new Set(entries.map((e) => e.addr))];
    const clips = addrs.filter((a) => /^c\d+$/.test(a)), gizmos = addrs.filter((a) => /^g\d+$/.test(a)), stmts = addrs.filter((a) => /^s\d+$/.test(a));
    const hot = new Set(clips.filter((_, i) => i % 4 === 0));
    for (const c of clips) {
      const cl = `${slice}:${c}`;
      const own = entries.filter((e) => e.addr === c && e.kind !== 'retract').sort((a, b) => (a.at < b.at ? -1 : 1));
      add(slice, entries, 'S-FIRST', { addr: c }, `Which lane first wrote to clip ${c}?`, 'lane', cl);
      add(slice, entries, 'S-LAST', { addr: c }, `Which lane wrote last to clip ${c}?`, 'lane', cl);
      if (hot.has(c) || headsOf(entries.filter((e) => e.addr === c)).length > 1 || R() < 0.4) {
        add(slice, entries, 'S-HELD', { addr: c }, `How many live values does clip ${c} hold (values no later entry has built on)?`, 'int', cl);
      }
      if (hot.has(c)) {
        add(slice, entries, 'S-LANES', { addr: c }, `How many different lanes wrote to clip ${c}?`, 'int', cl);
        if (own.length >= 3) add(slice, entries, 'S-LAST-ASOF', { addr: c, cut: own[1].at }, `Which lane wrote last to clip ${c} as of ${own[1].at}?`, 'lane', cl);
      }
      if (R() < 0.35) add(slice, entries, 'S-CREATOR', { addr: c }, `Which lane created clip ${c}?`, 'lane', cl);
    }
    for (const g of gizmos) add(slice, entries, 'S-GIZMO', { addr: g }, `Which lane last wrote gizmo ${g}?`, 'lane', `${slice}:${g}`);
    for (const s of stmts) {
      const cl = `${slice}:${s}`;
      add(slice, entries, 'S-SAY', { addr: s }, `What is the text of statement ${s}?`, 'text', cl);
      add(slice, entries, 'S-BASIS', { addr: s }, `What is the attribution status of statement ${s}?`, 'enum', cl);
      const vs = entries.filter((e) => e.addr === s && e.kind === 'verdict').sort((a, b) => (a.at < b.at ? -1 : 1));
      if (vs.length >= 2) add(slice, entries, 'S-BASIS-ASOF', { addr: s, cut: vs[0].at }, `What is the attribution status of statement ${s} as of ${vs[0].at}?`, 'enum', cl);
    }
    const times = entries.map((e) => e.at).sort();
    for (let i = 0; i < 8; i++) {
      const t = times[Math.floor(R() * times.length)];
      add(slice, entries, 'S-INFLIGHT', { t }, `Was any lease active at ${t}?`, 'bool', `${slice}:t${i}`);
    }
  }
  // stream order first (seeded), because cold/warm strata depend on it
  const order = R.shuffle(qs.map((q) => q.qid));
  const rank = new Map(order.map((id, i) => [id, i]));
  const csize = new Map(); qs.forEach((q) => csize.set(q.cluster, (csize.get(q.cluster) || 0) + 1));
  const firstOf = new Map();                       // cluster -> qid asked first in the stream (the cold one)
  for (const id of order) { const q = qs.find((x) => x.qid === id); if (!firstOf.has(q.cluster)) firstOf.set(q.cluster, id); }
  fs.mkdirSync(path.join(dir, 'sealed'), { recursive: true });
  const sealed = [];
  const lines = [];
  truths.forEach((t, i) => {
    const q = qs[i];
    const strata = [];
    if (['S-CREATOR', 'S-GIZMO'].includes(q.family)) strata.push('S_G');
    if (q.family === 'S-HELD' && t.status === 'HELD') strata.push('S_H');
    const warm = csize.get(q.cluster) >= 3 && firstOf.get(q.cluster) !== q.qid;       // a later question of a cluster of three or more
    if (warm) strata.push('S_T');
    if (!strata.length && firstOf.get(q.cluster) === q.qid) strata.push('S_0');       // cold, no feature needed
    if (!strata.length) strata.push('S_X');                                           // unassigned: warm in a small cluster
    const truth = { qid: t.qid, salt: sha256(`${seed}:${t.qid}`).slice(0, 16), status: t.status, answer: t.answer, ...(t.survivors ? { survivors: t.survivors } : {}),
      evidence_ids: t.evidence_ids, truth_class: 'R-fold', derivation: t.derivation, stratum: strata };
    q.answer_commit = commitOf(truth);
    sealed.push(JSON.stringify(truth));
    lines.push(JSON.stringify(q));
  });
  fs.writeFileSync(path.join(dir, 'questions.jsonl'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'sealed', 'answers.jsonl'), sealed.join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'stream_order.json'), JSON.stringify({ seed, order }) + '\n');
  fs.writeFileSync(path.join(dir, 'slices.json'), JSON.stringify(Object.fromEntries(Object.entries(slices).map(([k, v]) => [k, { entries: v.length }]))) + '\n');
  // manifest + stamp
  const files = ['questions.jsonl', 'sealed/answers.jsonl', 'stream_order.json', 'slices.json'];
  fs.writeFileSync(path.join(dir, 'QSET.manifest.sha256'), files.map((f) => `${sha256(fs.readFileSync(path.join(dir, f)))}  ${f}`).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'QSET.manifest.time'), new Date().toISOString() + '\n');
  return { n: qs.length, strata: strata_count(sealed) };
}

function strata_count(sealed) {
  const c = {};
  for (const l of sealed) for (const s of JSON.parse(l).stratum) c[s] = (c[s] || 0) + 1;
  return c;
}
