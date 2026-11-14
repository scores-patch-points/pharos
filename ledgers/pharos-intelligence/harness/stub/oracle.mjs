// oracle.mjs (STUB): derives the truth of a stub question from the slice's entries by naive scans.
// It imports NOTHING from engines/ or models/ (mutant H13 is a copy of this file that does; selftest scans for it).
const key = (e) => e.at + '|' + e.id;
const sorted = (l) => l.slice().sort((a, b) => (key(a) < key(b) ? -1 : 1));
const live = (l) => l.filter((e) => e.kind !== 'retract');

export function headsOf(list) {
  const lv = live(list);
  const refd = new Set(lv.flatMap((e) => e.of));
  return lv.filter((e) => !refd.has(e.id));
}

// p: {family, addr, cut?, t?}; entries: all entries of the slice
export function truthOf(p, entries) {
  const at = (a) => sorted(entries.filter((e) => e.addr === a));
  const L = p.addr ? at(p.addr) : [];
  const ids = (l) => l.map((e) => e.id);
  switch (p.family) {
    case 'S-FIRST': { const l = live(L); return { status: 'KNOWN', answer: l[0].by, evidence_ids: [l[0].id], derivation: 'first live entry at the address by (at,id)' }; }
    case 'S-LAST': { const l = live(L); const e = l[l.length - 1]; return { status: 'KNOWN', answer: e.by, evidence_ids: [e.id], derivation: 'last live entry at the address by (at,id)' }; }
    case 'S-LAST-ASOF': { const l = live(L).filter((e) => e.at <= p.cut); const e = l[l.length - 1]; return { status: 'KNOWN', answer: e.by, evidence_ids: [e.id], derivation: 'last live entry with at <= cut' }; }
    case 'S-LANES': { const l = live(L); return { status: 'KNOWN', answer: new Set(l.map((e) => e.by)).size, evidence_ids: ids(l), derivation: 'distinct lanes over live entries' }; }
    case 'S-HELD': { const h = headsOf(L); return h.length > 1 ? { status: 'HELD', answer: h.length, survivors: h.length, evidence_ids: ids(h), derivation: 'heads by of' } : { status: 'KNOWN', answer: 1, evidence_ids: ids(h), derivation: 'heads by of' }; }
    case 'S-CREATOR': { const l = live(L); return { status: 'UNKNOWN_BY_DATA', answer: 'not recorded', evidence_ids: ids(l), derivation: 'creation is not recorded in the stub log; the first writer is not the creator' }; }
    case 'S-GIZMO': { return { status: 'UNKNOWN_BY_DATA', answer: 'not recorded', evidence_ids: ids(L).slice(0, 2), derivation: 'kind gizmo has no schema: entries are a diagnosis, not figures' }; }
    case 'S-INFLIGHT': {
      const grants = entries.filter((e) => e.kind === 'permit-granted' && e.at <= p.t);
      const released = new Map(entries.filter((e) => e.kind === 'permit-released' && e.at <= p.t).map((e) => [e.of[0], e]));
      const active = grants.filter((g) => !released.has(g.id) && p.t < g.body.expires);
      const ev = active.length ? [active[0].id] : [(sorted(grants).slice(-1)[0] || entries.find((e) => e.kind === 'permit-granted')).id];
      return { status: 'KNOWN', answer: active.length > 0, evidence_ids: ev, derivation: 'a grant at or before t, not released by t, before its expiry' };
    }
    case 'S-SAY': { const e = L.find((x) => x.kind === 'stmt'); return { status: 'KNOWN', answer: e.body.text, evidence_ids: [e.id], derivation: 'stmt entry text' }; }
    case 'S-BASIS': { const v = sorted(L.filter((x) => x.kind === 'verdict')); const e = v[v.length - 1]; return { status: 'KNOWN', answer: e.body.status, evidence_ids: [e.id], derivation: 'last verdict entry' }; }
    case 'S-BASIS-ASOF': { const v = sorted(L.filter((x) => x.kind === 'verdict' && x.at <= p.cut)); const e = v[v.length - 1]; return { status: 'KNOWN', answer: e.body.status, evidence_ids: [e.id], derivation: 'last verdict entry with at <= cut' }; }
    default: throw new Error('no oracle rule for ' + p.family);
  }
}

// what a careful reader of the whole log would say; used only by the scripted 'reader' stand-in (control P3)
export function readLog(p, entries) {
  const t = truthOf(p, entries);
  return { status: t.status, answer: t.answer, survivors: t.survivors, cite: t.evidence_ids.slice(0, 1) };
}
