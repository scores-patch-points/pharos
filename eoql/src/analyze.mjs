// analyze.mjs: static plan analysis (SPEC 3.1): verbs, primitives, extensions and access methods from the syntax alone.
import { AGG_FNS, WIN_ONLY, SCALAR_FNS } from './term.mjs';

export function analyze(stmt) {
  const verbs = {}; const prims = new Set(); const exts = new Set(); const plan = [];
  if (stmt.t === 'write') prims.add('P-WRITE');
  const walkTerm = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walkTerm); return; }
    switch (n.t) {
      case 'param': prims.add('P-PARAM'); break;
      case 'label': prims.add('P-LABEL'); break;
      case 'call': if (AGG_FNS.has(n.name)) prims.add('V-AGG'); else if (WIN_ONLY.has(n.name)) prims.add('V-WIN'); else if (SCALAR_FNS.has(n.name)) prims.add('V-FN'); break;
      default: break;
    }
    if (n.t === 'verb') { walkVerb(n); return; }
    for (const k of Object.keys(n)) { const v = n[k]; if (v && typeof v === 'object') { if (Array.isArray(v)) v.forEach((x) => (x && x.t ? walkTerm(x) : x && x.v ? walkTerm(x.v) : null)); else walkTerm(v); } }
  };
  const TERM_CLAUSES = new Set(['where', 'on', 'set', 'agg', 'sort', 'order', 'by', 'until']);
  const walkVerb = (n) => {
    verbs[n.verb] = (verbs[n.verb] || 0) + 1;
    const keys = n.clauses.map((c) => c.key);
    const node = { id: plan.length + 1, verb: n.verb, clauses: keys, access: null, rows_out: null, notes: [] };
    plan.push(node);
    if (n.verb === 'SEG') {
      const addrClause = n.clauses.find((c) => c.key === 'addr' || c.key === 'keep');
      node.access = { method: addrClause ? 'region' : keys.includes('table') ? 'table' : 'scan' };
      if (keys.includes('drop')) exts.add('SEG:drop');
    } else if (n.verb === 'CON') { node.access = { method: 'fold' }; if (keys.includes('follow')) { exts.add('CON'); if (n.clauses.some((c) => c.key === 'dir' && c.value.t === 'lit' && c.value.v === 'concurrent')) exts.add('CON:concurrent'); } } else node.access = { method: n.verb === 'INS' || n.verb === 'SIG' || n.verb === 'NUL' ? 'fold' : 'fold' };
    if (n.verb === 'INS') exts.add('INS');
    if (n.verb === 'SIG') exts.add('SIG');
    if (n.verb === 'NUL' && (keys.includes('expect') || keys.includes('gaps'))) exts.add(keys.includes('expect') ? 'NUL:expect' : 'NUL:gaps');
    if (keys.includes('fix')) prims.add('P-FIX');
    if (keys.some((k) => TERM_CLAUSES.has(k))) prims.add('P-TERM');
    if (n.first) walkTerm(n.first);
    for (const c of n.clauses) walkTerm(c.value);
  };
  if (stmt.t === 'write') { walkVerb(stmt.call); if (stmt.call.clauses.some((c) => c.key === 'as')) prims.add('P-LABEL'); } else walkTerm(stmt.expr);
  return { verbs, prims, exts, plan, estimate: { note: 'counts only; no wall-clock claim', nodes: plan.length } };
}
