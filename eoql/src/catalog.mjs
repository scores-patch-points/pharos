// catalog.mjs: the SQL catalog as functions of a world (SPEC 1.8): relations a SQL user would query.
import { canonical, sha256 } from './util.mjs';
import { schemaColumns } from './schema.mjs';
import { cmpStr } from './util.mjs';
import { mkReal } from './val.mjs';

export const FIXED = {
  entries: [['pos', 'INTEGER'], ['id', 'TEXT'], ['writer', 'TEXT'], ['cell', 'TEXT'], ['kind', 'TEXT'], ['addr', 'TEXT'], ['body_json', 'TEXT'], ['of_json', 'TEXT'], ['seen_json', 'TEXT'], ['basis_json', 'TEXT'], ['by', 'TEXT'], ['at', 'TEXT'], ['v', 'INTEGER'], ['retracted', 'INTEGER'], ['retracted_by', 'TEXT']],
  heads: [['addr', 'TEXT'], ['cell', 'TEXT'], ['id', 'TEXT']],
  conflicts: [['addr', 'TEXT'], ['cell', 'TEXT'], ['ids_json', 'TEXT']],
  latest_causal: [['addr', 'TEXT'], ['cell', 'TEXT'], ['id', 'TEXT']],
  kinds: [['name', 'TEXT'], ['cell', 'TEXT'], ['schema_json', 'TEXT'], ['id', 'TEXT'], ['pos', 'INTEGER'], ['decls', 'INTEGER'], ['table_name', 'TEXT'], ['columns_json', 'TEXT']],
  meta: [['key', 'TEXT'], ['value', '']],
};
FIXED.all_entries = FIXED.entries; FIXED.live_entries = FIXED.entries; FIXED.undeclared_entries = FIXED.entries;
export const VIEWS = new Set(['all_entries', 'live_entries', 'latest_causal', 'undeclared_entries']);

export function tableNameFor(name, taken) {
  let t = 'k_' + name.replace(/[^A-Za-z0-9_]/g, '_');
  if (taken.has(t)) t = t + '_' + sha256(name).slice(0, 8);
  taken.add(t);
  return t;
}

// declarations: the latest live `kind` declaration per name by pos; count of live declarations
export function declarations(fold) {
  const by = new Map();
  for (let p = 0; p < fold.n; p++) {
    const i = fold.ord[p]; const e = fold.ents[i];
    if (e.kind !== 'kind' || fold.isRetracted(i) || !e.body || typeof e.body !== 'object' || typeof e.body.name !== 'string') continue;
    let d = by.get(e.body.name);
    if (!d) by.set(e.body.name, d = { name: e.body.name, cell: e.body.cell, decls: 0 });
    d.decls++; d.latest = { schema: e.body.schema, id: e.id, pos: p }; if (d.firstCell === undefined) d.firstCell = e.body.cell;
  }
  return by;
}

export function catalogColumns(fold, name) {
  if (FIXED[name]) return FIXED[name].map(([n, a]) => ({ name: n, affinity: a }));
  if (name.startsWith('k_')) {
    const decl = declarations(fold);
    const taken = new Set(); let found = null;
    for (const d of [...decl.values()].sort((a, b) => cmpStr(a.name, b.name))) { const t = tableNameFor(d.name, taken); if (t === name) found = d; }
    if (found) {
      const cols = schemaColumns(found.latest.schema);
      return [{ name: 'id', affinity: 'TEXT' }, ...(cols ? cols.map((c) => ({ name: c.name, affinity: c.affinity })) : [{ name: 'body_json', affinity: 'TEXT' }])];
    }
    // undeclared kind with entries
    for (const e of fold.ents) if (tableNameFor(e.kind, new Set()) === name) return [{ name: 'id', affinity: 'TEXT' }, { name: 'body_json', affinity: 'TEXT' }];
  }
  return null;
}

export function relationNames(fold) {
  const names = Object.keys(FIXED);
  const decl = declarations(fold); const taken = new Set();
  const out = new Map();
  for (const d of [...decl.values()].sort((a, b) => cmpStr(a.name, b.name))) out.set(tableNameFor(d.name, taken), { declared: d });
  const kinds = new Set(); for (const e of fold.ents) if (e.kind !== 'retract') kinds.add(e.kind);
  for (const k of [...kinds].sort()) { if (!decl.has(k)) { const t = tableNameFor(k, taken); out.set(t, { undeclared: k }); } }
  return { fixed: names, k: out };
}

// rows of a catalog relation: [{c:{...}, src:[ids]}]; the world supplies fold, meta facts
export function catalogRows(fold, name, facts) {
  const ents = fold.ents; const rows = [];
  const mk = (c, src) => rows.push({ c, src });
  const retr = (i) => (fold.isRetracted(i) ? 1 : 0);
  const liveIdx = () => { const out = []; for (let p = 0; p < fold.n; p++) { const i = fold.ord[p]; if (ents[i].kind !== 'retract' && !fold.isRetracted(i)) out.push(i); } return out; };
  switch (name) {
    case 'entries': case 'all_entries':
      for (let p = 0; p < fold.n; p++) { const i = fold.ord[p]; const e = ents[i]; mk({ pos: p, id: e.id, writer: fold.fileOf(i), cell: e.cell, kind: e.kind, addr: e.addr, body_json: canonical(e.body), of_json: canonical(e.of), seen_json: canonical(e.seen), basis_json: canonical(e.basis), by: e.by, at: e.at, v: e.v, retracted: retr(i), retracted_by: fold.retractedBy.get(e.id) ?? null }, [e.id]); }
      break;
    case 'live_entries':
      for (const i of liveIdx()) { const e = ents[i]; mk({ pos: fold.pos[i], id: e.id, writer: fold.fileOf(i), cell: e.cell, kind: e.kind, addr: e.addr, body_json: canonical(e.body), of_json: canonical(e.of), seen_json: canonical(e.seen), basis_json: canonical(e.basis), by: e.by, at: e.at, v: e.v, retracted: 0, retracted_by: null }, [e.id]); }
      break;
    case 'undeclared_entries': {
      const decl = declarations(fold);
      for (let p = 0; p < fold.n; p++) { const i = fold.ord[p]; const e = ents[i]; if (decl.has(e.kind)) continue; mk({ pos: p, id: e.id, writer: fold.fileOf(i), cell: e.cell, kind: e.kind, addr: e.addr, body_json: canonical(e.body), of_json: canonical(e.of), seen_json: canonical(e.seen), basis_json: canonical(e.basis), by: e.by, at: e.at, v: e.v, retracted: retr(i), retracted_by: fold.retractedBy.get(e.id) ?? null }, [e.id]); }
      break;
    }
    case 'heads': case 'latest_causal': case 'conflicts': {
      const groups = new Map();
      for (const i of liveIdx()) {
        const e = ents[i];
        if (name === 'conflicts' && e.kind === 'frame') continue;
        const k = e.addr + '\u0000' + e.cell;
        (groups.get(k) || groups.set(k, []).get(k)).push(i);
      }
      for (const g of groups.values()) {
        const hs = fold.heads(g, 'full', -2);
        if (name === 'heads') { for (const i of hs) mk({ addr: ents[i].addr, cell: ents[i].cell, id: ents[i].id }, [ents[i].id]); } else if (name === 'latest_causal') {
          let b = hs[0]; for (const i of hs) if (fold.pos[i] > fold.pos[b]) b = i;
          mk({ addr: ents[b].addr, cell: ents[b].cell, id: ents[b].id }, [ents[b].id]);
        } else {
          const bodies = new Set(g.map((i) => canonical(ents[i].body)));
          if (bodies.size <= 1) continue;
          for (let x = 0; x < hs.length; x++) for (let y = x + 1; y < hs.length; y++) {
            const [a, b] = ents[hs[x]].id < ents[hs[y]].id ? [hs[x], hs[y]] : [hs[y], hs[x]];
            if (canonical(ents[a].body) !== canonical(ents[b].body)) mk({ addr: ents[a].addr, cell: ents[a].cell, ids_json: canonical([ents[a].id, ents[b].id]) }, [ents[a].id, ents[b].id]);
          }
        }
      }
      break;
    }
    case 'kinds': {
      const decl = declarations(fold); const taken = new Set();
      for (const d of [...decl.values()].sort((a, b) => cmpStr(a.name, b.name))) {
        const cols = schemaColumns(d.latest.schema);
        mk({ name: d.name, cell: d.firstCell === undefined ? d.cell : d.cell, schema_json: d.latest.schema === undefined ? null : canonical(d.latest.schema), id: d.latest.id, pos: d.latest.pos, decls: d.decls, table_name: tableNameFor(d.name, taken), columns_json: canonical(cols ? cols.map((c) => ({ name: c.name, affinity: c.affinity })) : [{ name: 'body_json', affinity: 'TEXT' }]) }, [d.latest.id]);
      }
      break;
    }
    case 'meta': {
      const f = fold.frontierIds();
      const vals = [['source_count', fold.n], ['source_frontier', canonical(f)], ['dangling_count', facts.danglingCount], ['corrupt_count', facts.corruptCount], ['cut_pos', facts.cutPos === null || facts.cutPos === undefined ? null : facts.cutPos], ['rule:order', 'causal: Kahn over (seen u of), ready set ordered by (cell rank, id)'], ['rule:latest_causal', 'per (addr, cell): the head of greatest pos'], ['rule:live_entries', 'retracted = 0 and kind <> retract']];
      for (const [k, v] of vals) mk({ key: k, value: v }, []);
      break;
    }
    default: {
      if (!name.startsWith('k_')) return null;
      const decl = declarations(fold); const taken = new Set();
      let target = null;
      for (const d of [...decl.values()].sort((a, b) => cmpStr(a.name, b.name))) if (tableNameFor(d.name, taken) === name) target = { kind: d.name, cols: schemaColumns(d.latest.schema) };
      if (!target) { const kinds = new Set(); for (const e of ents) if (e.kind !== 'retract' && !decl.has(e.kind)) kinds.add(e.kind); for (const k of [...kinds].sort()) if (tableNameFor(k, taken) === name) target = { kind: k, cols: null }; }
      if (!target) return null;
      for (let p = 0; p < fold.n; p++) {
        const i = fold.ord[p]; const e = ents[i];
        if (e.kind !== target.kind || fold.isRetracted(i)) continue;
        const c = { id: e.id };
        if (target.cols) for (const col of target.cols) { const v = e.body && typeof e.body === 'object' && !Array.isArray(e.body) && Object.prototype.hasOwnProperty.call(e.body, col.key) ? e.body[col.key] : null; c[col.name] = coerceAff(v, col.affinity); } else c.body_json = canonical(e.body);
        mk(c, [e.id]);
      }
    }
  }
  return rows;
}
function coerceAff(v, aff) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return canonical(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (aff === 'TEXT') return typeof v === 'string' ? v : String(v);
  if (typeof v === 'string' && (aff === 'INTEGER' || aff === 'REAL' || aff === 'NUMERIC')) { const n = Number(v); if (v.trim() !== '' && Number.isFinite(n)) return aff === 'REAL' ? mkReal(n) : n; return v; }
  if (aff === 'REAL' && typeof v === 'number') return mkReal(v);
  return v;
}
export function catalogColumnNames(fold, name) { const c = catalogColumns(fold, name); return c ? c.map((x) => x.name) : null; }
