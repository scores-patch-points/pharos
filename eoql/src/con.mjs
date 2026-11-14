// con.mjs: CON, connect (SPEC 2.4, 3.8): joins over rows, and ancestry walks over the log with conflict awareness.
import { EoqlError } from './errors.mjs';
import { compile, resolveColumn } from './term.mjs';
import { truth } from './val.mjs';
import { tupleKey } from './rel.mjs';
import { SYS_COLS } from './world.mjs';

const JOINS = new Set(['inner', 'left', 'right', 'full', 'cross', 'semi', 'anti', 'anti_null']);

export function conVerb(ix, node, ctx, env, plan) {
  const cm = ix.clauseMap(node);
  if (cm.has('follow')) return follow(ix, node, cm, ctx, env, plan);
  const input = ix.inputOf(node, ctx, env);
  if (!cm.has('to')) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'CON needs to: (a join) or follow: (an ancestry walk)', { pos: node.pos });
  const right = ix.evalWorld(cm.get('to'), input, env);
  const join = cm.has('join') ? ix.constStr(cm.get('join'), 'join') : 'inner';
  if (!JOINS.has(join)) throw new EoqlError('E_BAD_CLAUSE_VALUE', `unknown join ${join}`, { pos: node.pos, detail: { valid: [...JOINS] } });
  const L = ix.rowsOf(input), R = ix.rowsOf(right);
  const asL = cm.has('as') ? ix.constStr(cm.get('as'), 'as') : null;
  const asR = cm.has('to_as') ? ix.constStr(cm.get('to_as'), 'to_as') : null;
  const prefixL = !(input.joined && !asL);
  const prefixR = !(right.joined && !asR);
  const aliasL = asL || 'l', aliasR = asR || 'r';
  const lcols = L.columns.map((c) => (prefixL ? `${aliasL}.${c}` : c));
  const rcols = R.columns.map((c) => (prefixR ? `${aliasR}.${c}` : c));
  if (new Set([...lcols, ...rcols]).size !== lcols.length + rcols.length) throw new EoqlError('E_BIND_FIELD', 'join aliases give duplicate column names; use as: and to_as:', { pos: node.pos });
  const cols = [...lcols, ...rcols];
  const lset = new Set(lcols), rset = new Set(rcols);
  const mkL = (r) => { const c = {}; L.columns.forEach((n, i) => { c[lcols[i]] = r.c[n]; }); return c; };
  const mkR = (r) => { const c = {}; R.columns.forEach((n, i) => { c[rcols[i]] = r.c[n]; }); return c; };
  const lrows = L.rows.map((r) => ({ r, c: mkL(r) }));
  const rrows = R.rows.map((r) => ({ r, c: mkR(r) }));
  ix.prims.add('P-TERM');
  const sc = ix.scope({ cols: new Set(cols), colList: cols, nonEmpty: lrows.length + rrows.length > 0, ctxWorld: input, env });
  let conj = [];
  if (cm.has('on')) flatten(cm.get('on'), conj); else if (join !== 'cross') conj = [];
  // equi-join keys
  const lkeys = [], rkeys = [], rest = [];
  const side = (n) => {
    if (n.t !== 'path') return null;
    const names = n.parts.filter((p) => p.name !== undefined).map((p) => p.name);
    let hit; try { hit = resolveColumn(sc, names); } catch (e) { return null; }
    if (!hit || hit.rest.length) return null;
    return lset.has(hit.col) ? 'l' : rset.has(hit.col) ? 'r' : null;
  };
  for (const cj of conj) {
    if (cj.t === 'rel' && cj.op === '=') {
      const sa = side(cj.a), sb = side(cj.b);
      if (sa === 'l' && sb === 'r') { lkeys.push(compile(cj.a, sc)); rkeys.push(compile(cj.b, sc)); continue; }
      if (sa === 'r' && sb === 'l') { lkeys.push(compile(cj.b, sc)); rkeys.push(compile(cj.a, sc)); continue; }
    }
    rest.push(cj);
  }
  const restFns = rest.map((n) => compile(n, sc));
  const nullL = Object.fromEntries(lcols.map((c) => [c, null])), nullR = Object.fromEntries(rcols.map((c) => [c, null]));
  const out = [];
  const matchedR = new Set();
  const emit = (a, b) => {
    const meta = ix.unionMeta([a.r, b.r]);
    out.push({ c: { ...a.c, ...b.c }, m: meta });
  };
  const testRest = (merged) => { for (const f of restFns) { ix.stepN(1); const t = truth(f(merged)); if (t !== 1) return t === null ? null : 0; } return 1; };
  let index = null;
  const keyOf = (fns, row) => { const vs = fns.map((f) => f(row)); if (vs.some((v) => v === null || v === undefined)) return null; return tupleKey(vs); };
  if (lkeys.length) { index = new Map(); rrows.forEach((x, j) => { const k = keyOf(rkeys, x); if (k === null) return; (index.get(k) || index.set(k, []).get(k)).push(j); }); ix.stepN(rrows.length); }
  const semiLike = join === 'semi' || join === 'anti' || join === 'anti_null';
  const leftOnly = [];
  for (const a of lrows) {
    let any = false, anyUnknown = false;
    let cand;
    if (join === 'cross') cand = rrows.map((_, j) => j);
    else if (index) { const k = keyOf(lkeys, a); cand = k === null ? [] : (index.get(k) || []); ix.stepN(1); } else cand = rrows.map((_, j) => j);
    for (const j of cand) {
      const b = rrows[j];
      let ok = 1;
      if (rest.length || (!index && join !== 'cross' && false)) { ix.stepN(1); const merged = { c: { ...a.c, ...b.c }, m: a.r.m }; const t = testRest(merged); ok = t === null ? null : t; }
      if (ok === 1) { any = true; matchedR.add(j); if (!semiLike) emit(a, b); else if (join === 'semi') break; } else if (ok === null) anyUnknown = true;
    }
    if (index && join === 'anti_null') { /* a NULL key on the left makes the comparison unknown for every right row */ if (!any && keyOf(lkeys, a) === null && rrows.length) anyUnknown = true; }
    if (index && join === 'anti_null' && !any && rrows.some((b) => keyOf(rkeys, b) === null)) anyUnknown = true;
    if (join === 'semi') { if (any) leftOnly.push(a.r); } else if (join === 'anti') { if (!any) leftOnly.push(a.r); } else if (join === 'anti_null') { if (!any && !anyUnknown) leftOnly.push(a.r); } else if (!any && (join === 'left' || join === 'full')) out.push({ c: { ...a.c, ...nullR }, m: a.r.m });
  }
  if (join === 'right' || join === 'full') rrows.forEach((b, j) => { if (!matchedR.has(j)) out.push({ c: { ...nullL, ...b.c }, m: b.r.m }); });
  if (semiLike) return ix.derive(leftOnly.map((r) => ({ c: r.c, m: r.m, g: r.g })), L.columns, input, { joined: input.joined });
  void nullR;
  return ix.derive(out, cols, input, { joined: true });
}
function flatten(n, out) { if (n.t === 'bin' && n.op === 'AND') { flatten(n.a, out); flatten(n.b, out); } else out.push(n); }

// ---- ancestry walks ------------------------------------------------------------------------------------------------
function follow(ix, node, cm, ctx, env, plan) {
  ix.exts.add('CON');
  const input = ix.inputOf(node, ctx, env);
  const edge = ix.constStr(cm.get('follow'), 'follow');
  if (!['of', 'seen', 'full', 'link'].includes(edge)) throw new EoqlError('E_BAD_CLAUSE_VALUE', `follow must be of, seen, full or link`, { pos: node.pos });
  const dir = cm.has('dir') ? ix.constStr(cm.get('dir'), 'dir') : 'up';
  if (!['up', 'down', 'both', 'concurrent'].includes(dir)) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'dir must be up, down, both or concurrent', { pos: node.pos });
  let depth = 1;
  if (cm.has('depth')) { depth = ix.constant(cm.get('depth')); if (depth !== '*' && !(Number.isInteger(depth) && depth >= 0)) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'depth is a non-negative integer or "*"', { pos: node.pos }); } else if (dir === 'concurrent') depth = '*';
  if (depth === '*' || dir === 'both' || dir === 'concurrent') ix.prims.add('P-FIX');
  if (dir === 'concurrent') ix.exts.add('CON:concurrent');
  const includeSeed = cm.has('include_seed') ? ix.constBool(cm.get('include_seed'), 'include_seed') : false;
  const inw = cm.has('in') ? ix.evalWorld(cm.get('in'), input, env) : ix.applyInitialFrameOnce();
  if (!inw.raw) throw new EoqlError('E_TYPE', 'CON in: needs a raw world', { pos: node.pos });
  const fold = inw.fold();
  plan.notes.push('anc:' + inw.frame.anc, edge === 'link' ? 'link' : 'edge:' + edge);
  // seeds
  const L = ix.rowsOf(input);
  if (!L.columns.includes('_id') && edge !== 'link') throw new EoqlError('E_TYPE', 'CON follow needs seed rows with an _id column', { pos: node.pos });
  const seedIds = [...new Set(L.rows.map((r) => r.c._id).filter((x) => typeof x === 'string'))];
  const seeds = [];
  for (const id of seedIds) { const i = fold.idx.get(id); if (i === undefined) ix.finding({ reason: 'seed-not-in-world', id }); else seeds.push(i); }
  const anc = inw.frame.anc;
  const untilNode = cm.has('until') ? cm.get('until') : null;
  const baseCols = [...SYS_COLS, 'body', '_depth', '_branch', '_fork', '_episode', '_siblings'];
  let untilFn = null;
  if (untilNode) {
    ix.prims.add('P-TERM');
    untilFn = compile(untilNode, ix.scope({ cols: new Set(baseCols), colList: baseCols, nonEmpty: true, onMissing: (n, names) => (r) => { const b = r.c.body; return b && typeof b === 'object' && Object.prototype.hasOwnProperty.call(b, names[0]) ? b[names[0]] : null; } }));
  }
  const rowFor = (i) => {
    const e = fold.ents[i];
    const slot = e.kind === 'retract' ? { id: -1, addr: e.addr, kind: 'retract', members: [i] } : fold.slots[fold.slotOf[i]];
    const proj = e.kind === 'retract' ? { held: 1, headSet: new Set() } : fold.project(slot, ['none'], anc);
    const r = ix.entryRow(inw, fold, i, slot, proj);
    const evs = e.kind === 'retract' ? [] : fold.episodes(slot, anc).filter((ep) => ep.participants.includes(e.id));
    r.c._fork = evs.length ? 1 : 0; r.c._episode = evs.length ? evs[0].began : null;
    r.c._siblings = evs.length ? evs[0].participants.filter((x) => x !== e.id) : [];
    return r;
  };
  const outRows = new Map(); // idx -> {depth, branch:Set}
  const dangling = new Set();
  if (edge === 'link') return followLinks(ix, node, cm, input, inw, fold, L, dir, depth, includeSeed, rowFor);
  const adjUp = fold.adjacency(edge, 'up'), adjDown = fold.adjacency(edge, 'down');
  const bfs = (seed, adj, d0) => {
    const dist = new Map([[seed, 0]]); let frontier = [seed]; let d = 0;
    while (frontier.length && (d0 === '*' || d < d0)) {
      d++; const next = [];
      for (const x of frontier) {
        if (untilFn && x !== seed) { ix.stepN(1); if (truth(untilFn(rowFor(x))) === 1) continue; }
        for (const t of adj(x)) { ix.stepN(1); if (!dist.has(t)) { dist.set(t, d); next.push(t); } }
      }
      frontier = next;
    }
    return dist;
  };
  for (const s of seeds) {
    let reached = new Map();
    if (dir === 'up' || dir === 'both') for (const [i, d] of bfs(s, adjUp, depth)) reached.set(i, d);
    if (dir === 'down' || dir === 'both') for (const [i, d] of bfs(s, adjDown, depth)) if (!reached.has(i) || reached.get(i) > d) reached.set(i, d);
    if (dir === 'concurrent') {
      const up = bfs(s, adjUp, '*'), down = bfs(s, adjDown, '*');
      reached = new Map();
      for (let i = 0; i < fold.n; i++) if (!up.has(i) && !down.has(i)) { reached.set(i, null); ix.stepN(1); }
    }
    for (const [i, d] of reached) {
      if (i === s && !includeSeed && dir !== 'concurrent') continue;
      let o = outRows.get(i); if (!o) outRows.set(i, o = { depth: d, branch: new Set() });
      if (d !== null && (o.depth === null || d < o.depth)) o.depth = d;
      o.branch.add(fold.ents[s].id);
    }
    if (includeSeed && dir !== 'concurrent' && !outRows.has(s)) outRows.set(s, { depth: 0, branch: new Set([fold.ents[s].id]) });
  }
  // dangling targets (SPEC 3.8): listed as findings and they make the result incomplete
  const walked = [...outRows.keys()];
  for (const i of walked) for (const id of [...fold.ents[i].of, ...(edge === 'of' ? [] : fold.ents[i].seen)]) if (!fold.idx.has(id)) dangling.add(id);
  const src = ix.source;
  const trueDangling = [...dangling].filter((id) => src && src.canResolve && !src.byId(id));
  if (trueDangling.length) ix.finding({ reason: 'dangling', ids: trueDangling.sort() });
  else if (dangling.size && src && !src.canResolve) ix.noteUnresolved([...dangling]);
  const inc = trueDangling.length ? [{ reason: 'dangling', where: 'ancestry walk', ids: trueDangling.sort() }] : null;
  const rows = [];
  for (const [i, o] of outRows) {
    const r = rowFor(i);
    r.c._depth = o.depth; r.c._branch = [...o.branch].sort();
    if (inc) { r.m.inc = inc; r.c._incomplete = 1; r.c._determined = 0; }
    if (untilFn) { /* satisfying rows are returned; expansion stopped beyond them */ }
    rows.push(r);
  }
  rows.sort((a, b) => a.c._pos - b.c._pos);
  return ix.derive(rows, baseCols, input, {});
}

function followLinks(ix, node, cm, input, inw, fold, L, dir, depth, includeSeed, rowFor) {
  const rel = cm.has('rel') ? ix.constStr(cm.get('rel'), 'rel') : null;
  const up = new Map(), down = new Map();
  for (let p = 0; p < fold.n; p++) {
    const i = fold.ord[p]; const e = fold.ents[i];
    if (fold.isRetracted(i) || e.kind === 'retract' || !(rel === null || e.kind === rel) || !e.body || typeof e.body !== 'object' || typeof e.body.to !== 'string') continue;
    if (rel === null && e.kind !== 'link' && !('rel' in e.body)) continue;
    (up.get(e.addr) || up.set(e.addr, []).get(e.addr)).push(e.body.to);
    (down.get(e.body.to) || down.set(e.body.to, []).get(e.body.to)).push(e.addr);
  }
  const seedAddrs = [...new Set(L.rows.map((r) => r.c._addr).filter((a) => typeof a === 'string'))];
  const dist = new Map(); const branch = new Map();
  for (const s of seedAddrs) {
    const walkD = (adj) => { const d = new Map([[s, 0]]); let fr = [s]; let k = 0; while (fr.length && (depth === '*' || k < depth)) { k++; const nx = []; for (const a of fr) for (const t of adj.get(a) || []) { ix.stepN(1); if (!d.has(t)) { d.set(t, k); nx.push(t); } } fr = nx; } return d; };
    const m = new Map();
    if (dir === 'up' || dir === 'both') for (const [a, d] of walkD(up)) m.set(a, d);
    if (dir === 'down' || dir === 'both') for (const [a, d] of walkD(down)) if (!m.has(a) || m.get(a) > d) m.set(a, d);
    for (const [a, d] of m) { if (a === s && !includeSeed) continue; if (!dist.has(a) || dist.get(a) > d) dist.set(a, d); (branch.get(a) || branch.set(a, new Set()).get(a)).add(s); }
  }
  const rows = [];
  for (const slot of fold.slots) {
    if (!dist.has(slot.addr)) continue;
    for (const i of slot.members) { if (fold.isRetracted(i)) continue; const r = rowFor(i); r.c._depth = dist.get(slot.addr); r.c._branch = [...branch.get(slot.addr)].sort(); rows.push(r); }
  }
  rows.sort((a, b) => a.c._pos - b.c._pos);
  return ix.derive(rows, [...SYS_COLS, 'body', '_depth', '_branch', '_fork', '_episode', '_siblings'], input, {});
}
