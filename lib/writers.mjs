// writers: WHO MAY WRITE WHICH PHASEPOST. A phasepost is a cell (operator x grain, lib/cells.mjs). The rule, from the owner (2026-11-19): observing is not defining. "There is a period here" is an observation
// (Existence or Structure); "this is a sentence" is a DEFINITION, and defining, judging and revising (the Interpretation domain: DEF, EVA, REC) is Penelope's act. Khora reads and janus researches: they write
// Existence (NUL SIG INS) and Structure (SEG CON SYN) and leave EVIDENCE; Penelope convicts. The protocol's own kinds (frame, kind, holon, retract) are exempt: declaring the vocabulary of what you write is
// pharos law, not an interpretation of a text. Node built-ins only. The policy is DATA passed in; the nexus default is below, a proposal until the owner makes it a pharos rule (docs/PROPOSAL-WRITER-PHASEPOSTS.md).
import { cellById } from './cells.mjs';

export const PROTOCOL_KINDS = Object.freeze(['frame', 'kind', 'holon', 'retract']);
export const NEXUS_POLICY = Object.freeze({
  khora: Object.freeze(['Existence', 'Structure']),
  janus: Object.freeze(['Existence', 'Structure']),
  penelope: Object.freeze(['Existence', 'Structure', 'Interpretation']),
});
/** the writer's base name: "janus.gate" and "janus" are the same repo (everything before the first dot) */
export const baseOf = (by) => { const s = String(by ?? ''), i = s.indexOf('.'); return i < 0 ? s : s.slice(0, i); };
/**
 * audit(entries, { policy, exempt }) -> { ok, checked, exempt, violations: [{ id, by, kind, cell, domain, why }], gaps: [{ by, id, why }] }
 *   a VIOLATION: a known writer wrote a cell whose domain the policy does not give it. A GAP: a writer the policy does not name (typed, never a pass and never a violation), or a cell not in the 27.
 */
export function audit(entries, { policy = NEXUS_POLICY, exempt = PROTOCOL_KINDS } = {}) {
  const out = { ok: true, checked: 0, exempt: 0, violations: [], gaps: [] }, skip = new Set(exempt);
  for (const e of entries ?? []) {
    if (!e || typeof e !== 'object') continue;
    if (skip.has(e.kind)) { out.exempt++; continue; }
    out.checked++;
    const cell = cellById(e.cell), who = baseOf(e.by), allowed = policy[who];
    if (!cell) { out.gaps.push({ by: e.by, id: e.id, why: `cell ${e.cell} is not one of the 27 phaseposts` }); continue; }
    if (!allowed) { out.gaps.push({ by: e.by, id: e.id, why: `no policy for writer ${who}: nothing was checked, which is not a pass` }); continue; }
    if (!allowed.includes(cell.domain)) out.violations.push({ id: e.id, by: e.by, kind: e.kind, cell: e.cell, domain: cell.domain, why: `${who} may write ${allowed.join(' and ')}; ${e.cell} is ${cell.domain}: observing is not defining, and ${cell.domain === 'Interpretation' ? 'defining, judging and revising are Penelope\'s' : 'this domain is not this writer\'s'}` });
  }
  out.ok = out.violations.length === 0; return out;
}
