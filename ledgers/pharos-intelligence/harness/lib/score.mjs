// score.mjs: normalisation and the 3x3 outcome table (PREREG section 9). Pure functions, no I/O.

export function normText(s) {
  return String(s ?? '')
    .replace(/^\s*\[\d+:\d+(?:\.\d+)?\]\s*/, '')   // leading [m:ss.s]
    .replace(/^\s*-\s+/, '')                          // leading dash turn marker
    .replace(/\s+/g, ' ')
    .trim();
}

export function normAnswer(type, v) {
  if (v === null || v === undefined) return null;
  switch (type) {
    case 'lane': case 'id': case 'enum': return String(v).trim().toLowerCase();
    case 'bool': {
      if (typeof v === 'boolean') return v;
      const s = String(v).trim().toLowerCase();
      if (s === 'true' || s === 'yes') return true;
      if (s === 'false' || s === 'no') return false;
      return null;
    }
    case 'int': { const n = Number(v); return Number.isInteger(n) ? n : null; }
    case 'text': return normText(v);
    case 'set': return (Array.isArray(v) ? v : []).map((x) => String(x).trim().toLowerCase()).sort();
    default: return String(v);
  }
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function wordF1(a, b) {
  const A = normText(a).split(' ').filter(Boolean), B = normText(b).split(' ').filter(Boolean);
  if (!A.length || !B.length) return 0;
  const cnt = new Map();
  for (const w of B) cnt.set(w, (cnt.get(w) || 0) + 1);
  let hit = 0;
  for (const w of A) if ((cnt.get(w) || 0) > 0) { hit++; cnt.set(w, cnt.get(w) - 1); }
  if (!hit) return 0;
  const p = hit / A.length, r = hit / B.length;
  return (2 * p * r) / (p + r);
}

// final: {status:'answer'|'unknown', answer, cite[]} (already parsed; format failures arrive as unknown with format_failure)
// truth: sealed truth object. q: public question. ids: Set of entry ids in the slice.
export function scoreOne(q, truth, final, ids) {
  const out = { qid: q.qid, truth_status: truth.status, outcome: null, correct: false, wrong: false, abstain: false,
    cites_resolve: true, cites_hit: false, supported: false, silent_wrong: false, caught_wrong: false, f1: null };
  const answered = final && final.status === 'answer';
  const exp = truth.status === 'HELD' ? (truth.survivors ?? truth.answer) : truth.answer;
  if (truth.status === 'UNKNOWN_BY_DATA') {
    out.outcome = answered ? 'wrong' : 'correct_unknown';
  } else if (!answered) {
    out.outcome = 'abstain';
  } else {
    const t = truth.status === 'HELD' ? 'int' : q.answer_type;
    out.outcome = eq(normAnswer(t, final.answer), normAnswer(t, exp)) ? 'correct' : 'wrong';
    if (q.answer_type === 'text' && truth.status !== 'HELD') out.f1 = wordF1(final.answer, exp);
  }
  out.correct = out.outcome === 'correct' || out.outcome === 'correct_unknown';
  out.wrong = out.outcome === 'wrong';
  out.abstain = out.outcome === 'abstain';
  // audit: cites are id prefixes (>= 6 chars) that must resolve to exactly one slice entry
  const cites = (final && Array.isArray(final.cite)) ? final.cite.map(String) : [];
  const evid = new Set(truth.evidence_ids || []);
  for (const c of cites) {
    const hits = c.length >= 6 ? [...ids].filter((i) => i.startsWith(c)) : [];
    if (hits.length !== 1) out.cites_resolve = false;
    else if ([...evid].some((e) => e.startsWith(c) || c.startsWith(e))) out.cites_hit = true;
  }
  if (!cites.length) out.cites_resolve = false;
  out.supported = out.correct && out.cites_hit;
  if (out.wrong) { out.silent_wrong = out.cites_resolve && out.cites_hit; out.caught_wrong = !out.silent_wrong; }
  return out;
}

export function table(scored) {
  const t = {};
  for (const s of scored) {
    const k = s.truth_status;
    t[k] ??= { right: 0, wrong: 0, unknown: 0 };
    if (s.outcome === 'correct' || s.outcome === 'correct_unknown') t[k][s.outcome === 'correct_unknown' ? 'unknown' : 'right']++;
    else if (s.outcome === 'wrong') t[k].wrong++;
    else t[k].unknown++;
  }
  return t;
}
