// index.mjs: the library surface (SPEC 7.1).
import { EoqlError, VERSION, CODES, wrap } from './errors.mjs';
import { parse as parseText, N, isPred } from './parse.mjs';
import { print as printNode, hash as hashNode } from './print.mjs';
import { Interp } from './eval.mjs';
import { buildEnvelope, costOf } from './envelope.mjs';
import { openSource } from './source-open.mjs';
import { MemSource } from './adapters/lib.mjs';
import { RawWorld, DerivedWorld, rawRows, FilterCore, SourceCore } from './world.mjs';
import { analyze } from './analyze.mjs';
import { canonical } from './util.mjs';
import fs from 'node:fs';
import { WRITER_RE } from './adapters/blocks.mjs';
import * as W from './write.mjs';
import { RelRootWorld } from './adapters/sqlrel.mjs';

export { VERSION, CODES, EoqlError };
export const E_VERSION = VERSION;

export function parse(text, opts) { try { return parseText(text, opts); } catch (e) { throw wrap(e); } }
export function print(node) { try { return printNode(node); } catch (e) { throw wrap(e); } }
export function hash(node) { try { return hashNode(node); } catch (e) { throw wrap(e); } }

export function open(uri, opts = {}) {
  try {
    const mode = opts.mode || 'read';
    if (mode !== 'read' && mode !== 'write') throw new EoqlError('E_USAGE', 'mode must be "read" or "write"');
    if (mode === 'write' && (typeof opts.writer !== 'string' || !/^[A-Za-z0-9._-]+$/.test(opts.writer))) throw new EoqlError('E_READONLY', 'write mode needs a writer matching [A-Za-z0-9._-]+');
    const source = openSource(uri, { mode });
    if (mode === 'write') checkWriterLane(source, opts.writer);
    const h = { uri, source, mode, writer: opts.writer || null, budget: opts.budget || null, frame: opts.frame || null, closed: false, viewLookup: W.viewLookup };
    if (source.kind === 'sqlrel') h.rootWorld = (ix) => new RelRootWorld(ix, source, ix.initialFrame());
    return h;
  } catch (e) { throw wrap(e); }
}
// a writer name must land in its own lane: the blocks store allows [A-Za-z0-9_-]{1,48}; a directory store must not already hold a
// lane that differs from the name only in case (a case-insensitive filesystem would share it silently)
function checkWriterLane(source, writer) {
  const bad = (why, detail) => { throw new EoqlError('E_WRITER_NAME', `writer name ${JSON.stringify(writer)} ${why}`, { detail }); };
  if (source.kind === 'blocks') { if (!WRITER_RE.test(writer)) bad('is not a block-store writer name ([A-Za-z0-9_-]{1,48})', { writer, allowed: WRITER_RE.source }); return; }
  const dir = source.kind === 'lib' || source.kind === 'jsonl' ? source.target : source.kind === 'lazy' ? source.root : null;
  if (!dir) return;
  let names = [];
  try { if (!fs.statSync(dir).isDirectory()) return; names = fs.readdirSync(dir); } catch (e) { return; }
  const want = writer.toLowerCase();
  for (const n of names) {
    const base = n.replace(/\.jsonl$/, '');
    if (base !== writer && base.toLowerCase() === want) bad('differs only in case from an existing writer lane', { writer, existing: base });
  }
}
export function close(h) { if (h && !h.closed) { h.closed = true; if (h.source && h.source.close) h.source.close(); } }

export function openEntries(entries, opts = {}) {
  const source = new MemSource(entries, opts);
  return { uri: 'mem:', source, mode: 'read', writer: null, budget: opts.budget || null, frame: opts.frame || null, closed: false, viewLookup: W.viewLookup };
}

export function compose(q2, q1) {
  try {
    const a = typeof q1 === 'string' ? parseText(q1) : q1;
    if (a.statements.length !== 1 || a.statements[0].t !== 'read') throw new EoqlError('E_USAGE', 'compose needs a single read expression as the inner query');
    const inner = a.statements[0].expr;
    const b = typeof q2 === 'string' ? parseText(q2) : q2;
    const sub = (n) => {
      if (!n || typeof n !== 'object') return n;
      if (Array.isArray(n)) return n.map(sub);
      if (n.t === 'path' && n.parts.length === 1 && n.parts[0].name === 'sources' && !n.sigil) return inner;
      const o = {}; for (const k of Object.keys(n)) o[k] = sub(n[k]);
      if (n.t) Object.defineProperty(o, 'pos', { value: n.pos, enumerable: false });
      return o;
    };
    const out = { t: 'script', statements: b.statements.map(sub) };
    return printNode(out);
  } catch (e) { throw wrap(e); }
}

function toScript(h, textOrScript) {
  if (typeof textOrScript === 'string') return parseText(textOrScript);
  if (textOrScript && textOrScript.t === 'script') return textOrScript;
  if (textOrScript && (textOrScript.t === 'read' || textOrScript.t === 'write')) return { t: 'script', statements: [textOrScript] };
  if (textOrScript && textOrScript.t) return { t: 'script', statements: [N('read', 0, { expr: textOrScript })] };
  throw new EoqlError('E_USAGE', 'run needs query text or a parsed script');
}

const writeMod = W;

export function run(h, textOrScript, opts = {}) {
  try {
    if (!h || h.closed) throw new EoqlError('E_USAGE', 'handle is closed or missing');
    const script = toScript(h, textOrScript);
    const writes = script.statements.filter((s) => s.t === 'write');
    if (writes.length && !(h.mode === 'write' && opts.write === true)) throw new EoqlError('E_READONLY', 'a WRITE statement needs a handle opened with mode "write" and a run with write: true; nothing was evaluated or appended', { pos: writes[0].pos });
    if (writes.length && h.source && !h.source.writable && !h.source.mergeOnly) throw new EoqlError(h.source.kind === 'sqlite' ? 'E_NOT_PRIMARY' : 'E_READONLY', `${h.source.kind}: sources do not accept writes`);
    const state = { labels: opts.labels instanceof Map ? opts.labels : new Map(), opts, receipts: [], results: [], writeCount: 0 };
    const results = [];
    let pre = null;
    if (writes.length) pre = writeMod.preflight(h, script, opts, state);
    script.statements.forEach((stmt, idx) => {
      if (stmt.t === 'read') results.push(runRead(h, stmt, script, opts, state));
      else results.push(writeMod.execute(h, stmt, idx, script, opts, state, pre));
    });
    const stmts = results;
    if (stmts.length === 1) return stmts[0];
    if (writes.length && writes.length === stmts.length) return writeMod.mergeReceipts(h, stmts, opts);
    return { v: VERSION.result, statements: stmts };
  } catch (e) { throw wrap(e); }
}

function runRead(h, stmt, script, opts, state) {
  const ix = new Interp(h, { ...opts, labels: state.labels });
  try {
    const sa = analyze(stmt);
    const w = ix.evalWorld(stmt.expr, null, null);
    const env = buildEnvelope(ix, w, stmt.expr, { ...opts, scriptGaps: script.gaps || [], staticPrims: sa.prims });
    if (opts.world) Object.defineProperty(env, 'world', { value: w, enumerable: false });
    Object.defineProperty(env, 'ix', { value: ix, enumerable: false });
    return env;
  } catch (e) {
    if (e instanceof EoqlError && e.code === 'E_BUDGET') e.cost = costOf(ix);
    throw e;
  } finally { ix.end(); }
}

export function plan(h, textOrScript, opts = {}) {
  try {
    const script = toScript(h, textOrScript);
    const stmt = script.statements[0];
    if (!stmt) return { expr: '', expr_hash: hashNode(script), frame: null, plan: [], verbs: {}, primitives: [], extensions: [], estimate: null };
    const a = analyze(stmt, h);
    const text = printNode(stmt.t === 'write' ? stmt : stmt.expr);
    return { v: VERSION.plan, expr: text, expr_hash: hashNode(script.statements.length === 1 ? (stmt.t === 'read' ? stmt.expr : stmt) : script), frame: { ...(h.frame || {}) }, plan: a.plan, verbs: a.verbs, primitives: [...a.prims].sort(), extensions: [...a.exts].sort(), estimate: a.estimate };
  } catch (e) { throw wrap(e); }
}

// ---- inspection API for the independent tests -----------------------------------------------------------------------
export function foldOf(h, frame) {
  try {
    const ix = new Interp(h, { frame: frame || {} });
    const w0 = ix.applyInitialFrameOnce();
    const w = w0;
    const fold = w.fold();
    const api = {
      frame: w.frame,
      entries: () => w.entries(),
      rows: () => rawRows(w).rows.map((r) => ({ ...r.c })),
      slots: () => fold.slots.map((s) => ({ addr: s.addr, kind: s.kind })),
      heads: (addr, kind) => { const s = fold.slotFor(addr, kind); return s ? fold.heads(s.members, w.frame.anc, s.id).map((i) => fold.ents[i].id) : []; },
      held: (addr, kind) => { const s = fold.slotFor(addr, kind); return s ? fold.heads(s.members, w.frame.anc, s.id).length : 0; },
      episodes: (addr, kind) => { const s = fold.slotFor(addr, kind); return s ? fold.episodes(s, w.frame.anc) : []; },
      pos: (id) => fold.posOf(id),
      retracted: (id) => { const i = fold.idx.get(id); return i !== undefined && fold.isRetracted(i); },
      dangling: () => [...fold.dangling].sort(),
      health: () => { const x = w.core.health(); return { corrupt: x.corrupt, torn: x.torn }; },
      _world: w, _ix: ix,
    };
    return api;
  } catch (e) { throw wrap(e); }
}
export function openWorld(world, opts = {}) {
  try {
    const w = world && world._world ? world._world : world;
    if (!w || (!(w instanceof RawWorld) && !(w instanceof DerivedWorld))) throw new EoqlError('E_USAGE', 'openWorld needs a World');
    const ix0 = w.ix;
    const h = { uri: 'world:', mode: 'read', writer: null, budget: opts.budget || null, frame: null, closed: false, viewLookup: W.viewLookup };
    if (w instanceof RawWorld) {
      const items = w.core.items();
      const health = w.core.health();
      h.source = new MemSource(items, { health });
      h.groundSource = ix0.source || null;
      h.cuts = w.core.cuts;
      h.rootWorld = (ix) => {
        const core = new SourceCore(ix, h.source, null);
        core.cuts = h.cuts;
        return new RawWorld(ix, core, { ...w.frame });
      };
      if (!h.groundSource) h.groundSource = h.source;
    } else {
      h.source = new MemSource([]);
      h.groundSource = ix0.source || h.source;
      h.rootWorld = (ix) => { const d = new DerivedWorld(ix, w.rows, w.columns, { frame: { ...w.frame }, grouping: w.grouping, exprHash: w.exprHash }); if (w.joined) d.joined = true; return d; };
    }
    return h;
  } catch (e) { throw wrap(e); }
}

export const views = {
  list: (h, opts) => { try { return W.viewsList(h, opts); } catch (e) { throw wrap(e); } },
  get: (h, name, opts) => { try { return W.viewsGet(h, name, opts); } catch (e) { throw wrap(e); } },
  define(h, name, exprText, opts = {}) {
    try {
      const expr = parseText(exprText); if (expr.statements.length !== 1 || expr.statements[0].t !== 'read') throw new EoqlError('E_VIEW_BODY', 'a view is one read expression');
      const clauses = [{ key: 'view', value: N('lit', 0, { v: name }) }, { key: 'expr', value: expr.statements[0].expr }];
      if (opts.params && opts.params.length) clauses.push({ key: 'params', value: N('list', 0, { items: opts.params.map((p) => N('lit', 0, { v: p })) }) });
      if (opts.of === 'heads' || opts.of === 'live-heads') clauses.push({ key: 'of', value: N('heads', 0, { live: opts.of === 'live-heads' }) });
      const order = ['view', 'expr', 'params', 'of'];
      clauses.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
      const stmt = N('write', 0, { call: N('verb', 0, { verb: 'DEF', first: null, clauses }) });
      return run(h, { t: 'script', statements: [stmt] }, { write: true });
    } catch (e) { throw wrap(e); }
  },
  retract(h, name) {
    try {
      const stmt = N('write', 0, { call: N('verb', 0, { verb: 'NUL', first: N('lit', 0, { v: 'view:' + name }), clauses: [{ key: 'kind', value: N('lit', 0, { v: 'view' }) }] }) });
      return run(h, { t: 'script', statements: [stmt] }, { write: true });
    } catch (e) { throw wrap(e); }
  },
};


// ---- formats: convert, export, import, dump, replay (SPEC 6, 4.6) --------------------------------------------------------------
import * as F from './formats/index.mjs';
const fdeps = { run: (h, q, o) => run(h, q, o), open: (u, o) => open(u, o), openEntries: (e, o) => openEntries(e, o), close: (h) => close(h) };
F.setRunner(run); F.setOpener(open);
export function convert(o = {}) { try { if (!o || typeof o !== 'object') throw new EoqlError('E_USAGE', 'convert needs { from, to }'); return F.convertFrom(o.from, o.to, o, fdeps); } catch (e) { throw wrap(e); } }
export function exportTo(h, to, opts = {}) { try { return F.exportHandle(h, to, opts, fdeps); } catch (e) { throw wrap(e); } }
export function importFrom(from, h, opts = {}) { try { return F.importFrom(from, h, opts, fdeps); } catch (e) { throw wrap(e); } }
export function dump(h, opts = {}) { try { return F.dumpHandle(h, opts, fdeps); } catch (e) { throw wrap(e); } }
export function dumpInfo(h, opts = {}) { try { return F.dumpWithInfo(h, opts, fdeps); } catch (e) { throw wrap(e); } }
export function replay(h, text, opts = {}) { try { if (!h || h.mode !== 'write') throw new EoqlError('E_READONLY', 'replay needs a handle opened with mode "write"'); return F.replayInto(h, text, opts); } catch (e) { throw wrap(e); } }
export function formats() {
  return { v: 'eoql-formats/1', formats: F.FORMATS.map((f) => ({ id: f, profiles: F.PROFILES[f], retention: F.RETENTION[f] })), attributes: ['ids', 'fields', 'extra', 'file', 'order', 'dups', 'invalid', 'text'] };
}

// ---- SQL: catalog, translator (SPEC 8, SPEC-A1 3.1) ------------------------------------------------------------------------------------
import { translateSqlText, catalogToRelations, fixedRelations } from './sql/translate.mjs';
import { catalogColumns, relationNames, FIXED, VIEWS } from './catalog.mjs';
export function sqlCatalog(h) {
  try {
    if (!h || !h.source) throw new EoqlError('E_USAGE', 'sqlCatalog needs a handle');
    if (h.source.kind === 'sqlrel') { const rel = h.source.relations(); return { relations: Object.fromEntries(Object.entries(rel).map(([n, r]) => [n, { columns: r.columns.map((c) => ({ name: c.name, affinity: c.affinity })), kind: r.kind }])) }; }
    const fw = foldOf(h); const fold = fw._world.fold();
    const names = [...Object.keys(FIXED), ...relationNames(fold).k.keys()];
    const relations = {};
    for (const n of names) { const cols = catalogColumns(fold, n); if (cols) relations[n] = { columns: cols.map((c) => ({ name: c.name, affinity: c.affinity })), kind: VIEWS.has(n) ? 'view' : 'table' }; }
    return { relations };
  } catch (e) { throw wrap(e); }
}
function catalogArg(c) {
  if (!c) return fixedRelations();
  if (c.source) return catalogToRelations(sqlCatalog(c));
  if (c.relations) return catalogToRelations(c);
  throw new EoqlError('E_USAGE', 'catalog must be a handle or { relations }');
}
export function parseSql(sql, opts = {}) {
  try {
    const r = translateSqlText(sql, { catalogRelations: catalogArg(opts.catalog), spellings: opts.spellings });
    if (!r.ok && opts.strict) throw new EoqlError('E_SQL_UNSUPPORTED', `${r.gaps.length} unsupported construct(s): ${[...new Set(r.gaps.map((g) => g.gap))].join(', ')}`, { detail: { gaps: r.gaps } });
    return r;
  } catch (e) { throw wrap(e); }
}
export function translateSql(sql, opts = {}) {
  const r = parseSql(sql, opts);
  return { ok: r.ok, eoql: r.eoql, params: r.params, columns: r.columns, order_sensitive: r.order_sensitive, gaps: r.gaps };
}

// ---- SQL out: compile and dialects (SPEC-A1 3.2, 4) ------------------------------------------------------------------------------------
import { compileText } from './sql/compile.mjs';
import { dialects as dialectsData } from './sql/dialects.mjs';
export function compile(textOrScript, opts = {}) {
  try {
    const text = typeof textOrScript === 'string' ? textOrScript : print(textOrScript);
    return compileText(text, { to: opts.to, strict: opts.strict, catalogRelations: opts.catalog ? catalogToRelations(opts.catalog.source ? sqlCatalog(opts.catalog) : opts.catalog) : undefined });
  } catch (e) { throw wrap(e); }
}
export function dialects() { return dialectsData(); }

// ---- the read-only HTTP server (SPEC 7.4) ------------------------------------------------------------------------------------------------
import { serveHandle } from './serve.mjs';
export function serve(h, opts = {}) {
  try { return serveHandle({ open, run, plan, parse, views, formats }, h, opts); } catch (e) { return Promise.reject(wrap(e)); }
}

import { fromV1Text } from './sql/v1.mjs';
export function fromV1(ast, opts = {}) {
  try {
    const r = fromV1Text(ast, { catalogRelations: opts.catalog ? catalogToRelations(opts.catalog.source ? sqlCatalog(opts.catalog) : opts.catalog) : undefined, spellings: opts.spellings });
    if (!r.ok && opts.strict) throw new EoqlError('E_SQL_UNSUPPORTED', `${r.gaps.length} unsupported construct(s)`, { detail: { gaps: r.gaps } });
    return r;
  } catch (e) { throw wrap(e); }
}
