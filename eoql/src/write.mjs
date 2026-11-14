// write.mjs: WRITE statements, retraction, views as expression events, verbatim merge (SPEC 4).
import fs from 'node:fs';
import path from 'node:path';
import { EoqlError, VERSION, wrap } from './errors.mjs';
import { canonical, sha256, isObj, isStrArr, entryId } from './util.mjs';
import { lib, placed, CELL_OP, BOOT, CELL_RANK } from './vendor.mjs';
import { parse } from './parse.mjs';
import { print } from './print.mjs';
import { Interp } from './eval.mjs';
import { costOf } from './envelope.mjs';
import { Fold } from './fold.mjs';
import { parseCut, cutOperator } from './world.mjs';
import { invalidReason, extraFields } from './jsonl.mjs';
import { blocksIngest } from './adapters/blocks.mjs';
import { plain } from './val.mjs';

const CELL_RE = /^(NUL|SIG|INS|SEG|CON|SYN|DEF|EVA|REC)·(Ground|Figure|Pattern)$/;
const hexRe = /^[0-9a-f]{64}$/;

// ---- the read side of the view store -------------------------------------------------------------------------------
export function viewLookup(ix, name) {
  const src = ix.source; if (!src) return null;
  const r = src.region('view:' + name, ['view']);
  let items = ix.chargeEntries(r.items);
  const asof = ix._pendingFrame && ix._pendingFrame.asof;
  if (asof !== undefined && asof !== null) {
    const { fn } = cutOperator(ix, parseCut(asof));
    items = fn(items, { fold: () => new Fold(items) });
  }
  if (!items.length) return null;
  const f = new Fold(items);
  const slot = f.slotFor('view:' + name, 'view');
  if (!slot) return null;
  const live = slot.members.filter((i) => !f.isRetracted(i));
  const hs = f.heads(live, 'slot', slot.id);
  if (!hs.length) return null;
  let b = hs[0]; for (const i of hs) if (f.pos[i] > f.pos[b]) b = i;
  const body = f.ents[b].body;
  if (!isObj(body) || typeof body.expr !== 'string') return null;
  return { name, expr: body.expr, expr_hash: body.expr_hash, params: Array.isArray(body.params) ? body.params : [], id: f.ents[b].id, held: hs.length, heads: hs.map((i) => f.ents[i].id).sort() };
}

// ---- writers ---------------------------------------------------------------------------------------------------------
function libHandle(h) {
  if (!h._lib) {
    const dir = h.source.target;
    fs.mkdirSync(dir, { recursive: true });
    h._lib = lib.open(path.basename(dir), { dir, writer: h.writer });
  }
  return h._lib;
}
function lazyHandle(h) {
  if (!h._placed) h._placed = placed.openRoot(h.source.root, { writer: h.writer });
  return h._placed;
}
function mapPharosError(e) {
  const map = { UNDECLARED_KIND: 'E_UNDECLARED_KIND', KIND_CELL_MISMATCH: 'E_VERB_KIND', KIND_REDECLARED: 'E_VERB_KIND', UNKNOWN_OF: 'E_BAD_OF', COMPUTED_FIELD: 'E_COMPUTED_FIELD', NO_FRAME: 'E_SOURCE', FRAME_EXISTS: 'E_SOURCE', BAD_KIND: 'E_BAD_CLAUSE_VALUE', BAD_HOLON: 'E_BAD_CLAUSE_VALUE', BAD_ENTRY: 'E_BAD_CLAUSE_VALUE', BAD_JSON: 'E_BAD_CLAUSE_VALUE', UNKNOWN_CELL: 'E_CELL_TYPED' };
  if (e && (e.name === 'PharosError' || e.name === 'PlacedError')) return new EoqlError(map[e.code] || 'E_INTERNAL', e.message, { detail: { cause: e.code } });
  return wrap(e);
}
function fileSize(p) { try { return fs.statSync(p).size; } catch (e) { return 0; } }

// weave one prepared entry; returns { entry, noop, shard }
export function weaveOne(h, spec) {
  const src = h.source;
  const input = { cell: spec.cell, kind: spec.kind, addr: spec.addr, body: spec.body, of: spec.of, basis: spec.basis };
  try {
    if (src.kind === 'lib') {
      const lh = libHandle(h);
      const before = fileSize(lh.file);
      const entry = lib.weave(lh, input);
      return { entry, noop: fileSize(lh.file) === before };
    }
    if (src.kind === 'lazy') {
      const ph = lazyHandle(h);
      const entry = placed.weave(ph, input, {});
      return { entry, noop: false, shard: entry.shard };
    }
  } catch (e) { throw mapPharosError(e); }
  throw new EoqlError('E_NOT_PRIMARY', `${src.kind}: sources do not accept weaves`);
}

function appendLines(file, lines) {
  if (!lines.length) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let prefix = '';
  try { const st = fs.statSync(file); if (st.size > 0) { const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(1); fs.readSync(fd, b, 0, 1, st.size - 1); fs.closeSync(fd); if (b[0] !== 10) prefix = '\n'; } } catch (e) { /* no file yet */ }
  fs.appendFileSync(file, prefix + lines.join('\n') + '\n');
}
// verbatim merge of complete entries (4.6)
export function mergeEntries(h, ix, entries, state) {
  const src = h.source;
  let have = state && state.have;
  if (!have) { ix.meter.cache.clear(); have = new Set(); for (const it of src.readAll().items) have.add(it.e.id); if (state) state.have = have; }
  const res = []; const fresh = [];
  for (const e of entries) {
    const why = invalidReason(e);
    if (why) throw new EoqlError(why === 'id does not match content' ? 'E_ID_MISMATCH' : 'E_BAD_CLAUSE_VALUE', `not a valid entry: ${why}`);
    if (have.has(e.id)) res.push({ id: e.id, status: 'present' }); else { have.add(e.id); fresh.push(e); res.push({ id: e.id, status: 'added' }); }
  }
  const lines = fresh.map((e) => canonical(e));
  if (src.kind === 'lib') { fs.mkdirSync(src.target, { recursive: true }); appendLines(path.join(src.target, h.writer + '.jsonl'), lines); } else if (src.kind === 'lazy') {
    const ph = lazyHandle(h);
    const bulk = new placed.Bulk(ph);
    fresh.forEach((e, i) => bulk.putLine(h.writer, e, lines[i]));
    bulk.flush();
  } else if (src.kind === 'blocks') blocksIngest(src.dir, h.writer, lines);
  else throw new EoqlError('E_NOT_PRIMARY', `${src.kind}: sources do not accept merges`);
  src._sig = null; src._data = null; src._d = null;
  return res;
}

// ---- preparation (plan-time validation) ------------------------------------------------------------------------------
function scanCells(n) {
  const bad = [];
  const walk = (x) => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (x.t === 'lit' && typeof x.v === 'string' && CELL_RE.test(x.v)) bad.push(x.v);
    for (const k of Object.keys(x)) walk(x[k]);
  };
  walk(n);
  return bad;
}
function declLookup(ix, sim, name) {
  if (sim.decl.has(name)) return sim.decl.get(name);
  const d = ix.ground.decl(name, null, 'latest');
  return d ? { cell: d.cell } : null;
}

export function preflight(h, script, opts, state) {
  const ix = new Interp(h, { ...opts, labels: state.labels });
  state.ix = ix;
  const sim = { decl: new Map(), labels: new Set(), views: new Set() };
  const prep = new Map();
  script.statements.forEach((stmt, idx) => {
    if (stmt.t !== 'write') return;
    try { const sp = prepare(h, ix, stmt.call, idx, sim); prep.set(idx, sp); if (sp.label) sim.labels.add(sp.label); } catch (e) { if (e instanceof EoqlError && e.pos === undefined && stmt.pos !== undefined) e.pos = stmt.pos; throw e; }
  });
  return prep;
}

const placeholder = '0'.repeat(64);
function termConst(ix, node, sim, what) {
  // evaluate a constant term for validation: labels defined earlier in the script are replaced by a placeholder id
  const saved = ix.labels;
  const shadow = new Map(saved); for (const l of sim.labels) if (!shadow.has(l)) shadow.set(l, placeholder);
  ix.labels = shadow;
  try { return ix.constant(node); } finally { ix.labels = saved; }
}

function prepare(h, ix, call, idx, sim) {
  const verb = call.verb;
  const cm = ix.clauseMap(call);
  const bad = scanCells(call.clauses.filter((c) => c.key !== 'entries').map((c) => c.value).concat(call.first ? [call.first] : []));
  if (bad.length) throw new EoqlError('E_CELL_TYPED', `a cell literal (${bad[0]}) appears in a statement: the kind declaration supplies the cell`, { detail: { cells: bad } });
  const spec = { idx, verb, call, cm, label: null };
  if (cm.has('as')) {
    const l = ix.constStr(cm.get('as'), 'as');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(l)) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'a label is an identifier');
    spec.label = l;
  }
  // ---- SYN entries: verbatim merge
  if (verb === 'SYN' && cm.has('entries')) {
    if (call.first || cm.has('kind') || cm.has('body') || cm.has('of')) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'SYN entries: takes no target, kind, body or of', { pos: call.pos });
    const list = ix.constList(cm.get('entries'), 'entries');
    for (const e of list) { const why = invalidReason(e); if (why) throw new EoqlError(why === 'id does not match content' ? 'E_ID_MISMATCH' : 'E_BAD_CLAUSE_VALUE', `not a valid entry: ${why}`); }
    if (h.source.kind === 'lazy') for (const e of list) if (extraFields(e).length || e.of.some((x, i, a) => a.indexOf(x) !== i) || [...e.of].sort().join() !== e.of.join()) throw new EoqlError('E_NOT_REPRESENTABLE', 'a lazy store cannot hold this entry verbatim (extra fields or unsorted of)', { detail: { ids: [e.id] } });
    spec.merge = list;
    return spec;
  }
  // ---- DEF special forms
  if (verb === 'DEF' && cm.has('declare')) {
    const name = ix.constStr(cm.get('declare'), 'declare');
    if (!name) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'declare needs a kind name');
    if (!cm.has('like')) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'declare needs like: (the cell is copied from an already-declared kind, never typed)', { pos: call.pos });
    const like = ix.constStr(cm.get('like'), 'like');
    const ld = declLookup(ix, sim, like);
    if (!ld) throw new EoqlError('E_UNDECLARED_KIND', `like: ${like} is not declared`, { detail: { hint: 'declare it first, or use a protocol kind: frame kind holon retract' } });
    const prior = declLookup(ix, sim, name);
    if (prior && prior.cell !== ld.cell) throw new EoqlError('E_VERB_KIND', `kind ${name} is already declared at ${prior.cell}`, { detail: { declared: prior.cell } });
    spec.cell = 'DEF·Figure'; spec.kind = 'kind'; spec.addr = 'kind:' + name;
    spec.body = { name, cell: ld.cell };
    if (cm.has('schema')) { const sch = termConst(ix, cm.get('schema'), sim, 'schema'); spec.body.schema = sch; }
    spec.of = []; spec.basis = {};
    sim.decl.set(name, { cell: ld.cell });
    spec.declare = name;
    return spec;
  }
  if (verb === 'DEF' && cm.has('view')) {
    const name = ix.constStr(cm.get('view'), 'view');
    if (!name || /[\s]/.test(name)) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'a view name has no spaces');
    if (!cm.has('expr')) throw new EoqlError('E_VIEW_BODY', 'a view needs expr:', { pos: call.pos });
    for (const bad of ['body', 'kind', 'basis', 'declare', 'like', 'schema', 'why', 'addr', 'as']) if (cm.has(bad) && !(bad === 'as')) throw new EoqlError('E_VIEW_BODY', `a view takes only view, expr, params and of: (found ${bad}); its body is the expression, never a result`, { pos: call.pos });
    const vd = declLookup(ix, sim, 'view');
    if (!vd) throw new EoqlError('E_UNDECLARED_KIND', 'kind view is not declared in this pharos', { detail: { hint: 'WRITE DEF(declare: "view"; like: "holon")' } });
    if (CELL_OP.get(vd.cell) !== 'DEF') throw new EoqlError('E_VERB_KIND', `kind view is declared at ${vd.cell} (${CELL_OP.get(vd.cell)}), not a DEF cell`);
    let en = cm.get('expr'); let exprText;
    if (en.t === 'lit' && typeof en.v === 'string') exprText = print(parse(en.v).statements.length === 1 && parse(en.v).statements[0].t === 'read' ? parse(en.v).statements[0].expr : (() => { throw new EoqlError('E_VIEW_BODY', 'a view expr is one read expression'); })());
    else exprText = print(en);
    const params = cm.has('params') ? ix.strList(cm.get('params'), 'params') : [];
    const nameClash = params.find((p, i) => params.indexOf(p) !== i);
    if (nameClash) throw new EoqlError('E_VIEW_BODY', `duplicate view parameter ${nameClash}`);
    const body = { name, expr: exprText, expr_hash: sha256(exprText), params, lang: 'eoql/1' };
    if (Buffer.byteLength(canonical(body)) > 65536) throw new EoqlError('E_VIEW_BODY', 'view body over 65536 bytes');
    // a view may not mention itself (E_CYCLE)
    const m = new RegExp(`(^|[^A-Za-z0-9_\`"])${name}\\(|(^|[\\s(;:,])${name}($|[\\s);,])`);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && m.test(exprText.replace(/"(?:[^"\\]|\\.)*"/g, '""'))) throw new EoqlError('E_CYCLE', `view ${name} refers to itself`);
    spec.cell = vd.cell; spec.kind = 'view'; spec.addr = 'view:' + name; spec.body = body; spec.basis = {};
    spec.ofNode = cm.get('of') || null; spec.view = name;
    if (spec.ofNode) validateOf(ix, h, spec, sim);
    return spec;
  }
  // ---- NUL
  if (verb === 'NUL') return prepareNul(h, ix, call, cm, spec, sim);
  // ---- the common shape
  const kindName = cm.has('kind') ? ix.constStr(cm.get('kind'), 'kind') : null;
  if (!kindName) throw new EoqlError('E_BAD_CLAUSE_VALUE', `${verb} write needs kind:`, { pos: call.pos });
  const d = declLookup(ix, sim, kindName);
  if (!d) throw new EoqlError('E_UNDECLARED_KIND', `kind ${kindName} is not declared in this pharos`, { pos: call.pos, detail: { hint: `WRITE DEF(declare: ${JSON.stringify(kindName)}; like: "holon")` } });
  const op = CELL_OP.get(d.cell);
  if (op !== verb) throw new EoqlError('E_VERB_KIND', `kind ${kindName} is declared at ${d.cell}: write it with ${op}(...), not ${verb}(...)`, { pos: call.pos, detail: { declared: d.cell, operator: op } });
  if (!call.first) throw new EoqlError('E_BAD_CLAUSE_VALUE', `${verb} write needs a target address as its first segment`, { pos: call.pos });
  const addr = termConst(ix, call.first, sim, 'target');
  if (typeof addr !== 'string' || !addr) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'the target address must be a non-empty string', { pos: call.first.pos });
  let body = cm.has('body') ? termConst(ix, cm.get('body'), sim, 'body') : null;
  if (verb === 'SEG' && cm.has('into')) { const into = ix.constStr(cm.get('into'), 'into'); if (body === null) body = {}; if (!isObj(body)) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'into: needs an object body'); body = { ...body, into }; }
  if (verb === 'CON') {
    if (!cm.has('to')) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'WRITE CON needs to:', { pos: call.pos });
    const to = ix.constStr(cm.get('to'), 'to'); if (body === null) body = {}; if (!isObj(body)) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'CON needs an object body');
    body = { to, ...(cm.has('rel') ? { rel: ix.constStr(cm.get('rel'), 'rel') } : {}), ...body };
  }
  if (kindName === 'kind' || kindName === 'frame' || kindName === 'holon') { /* the library validates these */ }
  const basis = cm.has('basis') ? termConst(ix, cm.get('basis'), sim, 'basis') : {};
  if (!isObj(basis)) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'basis must be an object');
  Object.assign(spec, { cell: d.cell, kind: kindName, addr, body, basis, ofNode: cm.get('of') || null });
  if (spec.ofNode) validateOf(ix, h, spec, sim);
  if (kindName === 'kind' && isObj(body) && typeof body.name === 'string') sim.decl.set(body.name, { cell: body.cell });
  return spec;
}
function validateOf(ix, h, spec, sim) {
  const n = spec.ofNode;
  if (n.t === 'heads') return;
  const list = n.t === 'list' ? n.items : null;
  const vals = list ? list.map((i) => (i.t === 'label' ? { label: i.name } : { v: termConst(ix, i, sim, 'of'), i })) : [{ v: termConst(ix, n, sim, 'of') }];
  const flat = [];
  for (const x of vals) { if (x.label) { if (!sim.labels.has(x.label) && !ix.labels.has(x.label)) throw new EoqlError('E_LABEL', `label @${x.label} is not defined before use`); continue; } if (Array.isArray(x.v)) flat.push(...x.v); else flat.push(x.v); }
  for (const id of flat) {
    if (typeof id !== 'string' || !hexRe.test(id)) { if (typeof id === 'string' && id === placeholder) continue; throw new EoqlError('E_BAD_OF', `of: ${JSON.stringify(id)} is not an entry id`); }
    if (id === placeholder) continue;
    const src = h.source;
    if (src.canResolve) { ix.meter.cache.clear(); if (!src.byId(id) && !(h._scriptIds && h._scriptIds.has(id))) throw new EoqlError('E_BAD_OF', `of: ${id} is not an entry of this source`); } else ix.gap('W_OF_UNCHECKED', `of ids cannot be checked on a ${src.kind} store; a wrong id will show as dangling`, 1);
  }
}

function prepareNul(h, ix, call, cm, spec, sim) {
  if (!call.first) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'WRITE NUL needs a target', { pos: call.pos });
  const first = call.first;
  const kindName = cm.has('kind') ? ix.constStr(cm.get('kind'), 'kind') : null;
  const isAddrForm = first.t === 'lit' && typeof first.v === 'string' || (first.t === 'param' && typeof termConst(ix, first, sim) === 'string' && !hexRe.test(termConst(ix, first, sim)));
  const nd = declLookup(ix, sim, 'retract');
  spec.cell = nd.cell;
  const body0 = cm.has('body') ? termConst(ix, cm.get('body'), sim, 'body') : null;
  const why = cm.has('why') ? ix.constStr(cm.get('why'), 'why') : null;
  const basis = cm.has('basis') ? termConst(ix, cm.get('basis'), sim, 'basis') : {};
  if (!isObj(basis)) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'basis must be an object');
  spec.basis = basis;
  if (isAddrForm) {
    if (!kindName) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'WRITE NUL("address"; kind: K) names the slot whose current heads are retracted', { pos: call.pos });
    spec.nulAddr = termConst(ix, first, sim, 'target'); spec.nulKind = kindName; spec.kind = 'retract'; spec.addr = spec.nulAddr;
    spec.body = body0 !== null ? body0 : (why !== null ? { why } : {});
    spec.ofNode = { t: 'heads' };
    return spec;
  }
  // ids form: idrefs, labels, or lists of them
  const items = first.t === 'list' ? first.items : [first];
  spec.targets = items.map((i) => ({ node: i }));
  for (const t of spec.targets) {
    if (t.node.t === 'label') { if (!sim.labels.has(t.node.name) && !ix.labels.has(t.node.name)) throw new EoqlError('E_LABEL', `label @${t.node.name} is not defined before use`); t.label = t.node.name; } else { const v = termConst(ix, t.node, sim, 'target'); const vs = Array.isArray(v) ? v : [v]; for (const x of vs) if (typeof x !== 'string') throw new EoqlError('E_BAD_OF', 'retraction targets are entry ids'); t.ids = vs; }
  }
  if (kindName && kindName !== 'retract') {
    const d = declLookup(ix, sim, kindName);
    if (!d) throw new EoqlError('E_UNDECLARED_KIND', `kind ${kindName} is not declared in this pharos`);
    if (CELL_OP.get(d.cell) !== 'NUL') throw new EoqlError('E_VERB_KIND', `kind ${kindName} is declared at ${d.cell}: write it with ${CELL_OP.get(d.cell)}(...), not NUL(...)`);
    spec.cell = d.cell; spec.kind = kindName;
  } else spec.kind = 'retract';
  spec.body = body0 !== null ? body0 : (why !== null ? { why } : {});
  spec.addrNode = cm.get('addr') || null;
  if (spec.addrNode) spec.addr = ix.constStr(spec.addrNode, 'addr');
  // resolve known ids now (plan time) where the source can look them up
  for (const t of spec.targets) if (t.ids) for (const id of t.ids) {
    const rid = hexRe.test(id) ? id : ix.resolveIdref(id);
    if (h.source.canResolve) { ix.meter.cache.clear(); if (!h.source.byId(rid)) throw new EoqlError('E_BAD_OF', `${rid} is not an entry of this source`); if (!spec.addr) spec.addr = h.source.byId(rid).addr; }
  }
  if (!spec.addr && !h.source.canResolve) {
    if (!spec.targets.every((t) => t.label)) throw new EoqlError('E_BAD_OF', 'on a lazy store a retraction by bare ids needs addr: (the retraction must be at the target address)');
  }
  return spec;
}

// ---- execution -------------------------------------------------------------------------------------------------------
function currentHeads(h, ix, addr, kind, live) {
  ix.meter.cache.clear();
  const r = h.source.region(addr, [kind]);
  const f = new Fold(r.items);
  const slot = f.slotFor(addr, kind);
  if (!slot) return [];
  const L = live ? slot.members.filter((i) => !f.isRetracted(i)) : slot.members;
  return f.heads(L, 'slot', slot.id).map((i) => f.ents[i].id);
}

export function execute(h, stmt, idx, script, opts, state, pre) {
  const spec = pre.get(idx);
  const ix = state.ix;
  ix.labels = state.labels;
  const receipt = { v: VERSION.receipt, mode: 'write', writer: h.writer, target: h.uri, statements: 1, appended: [], noops: [], merged: [], labels: {}, warnings: [], stopped_at: null, cost: null };
  const warn = (code) => receipt.warnings.push({ code, stmt: idx });
  try {
    if (spec.merge) {
      const res = mergeEntries(h, ix, spec.merge, state);
      for (const r of res) receipt.merged.push({ stmt: idx, id: r.id, status: r.status });
      state.writeCount++;
    } else {
      state.have = null;
      const res = resolveAndWeave(h, ix, spec, state, warn);
      if (res.noop) receipt.noops.push({ stmt: idx, id: res.entry.id, reason: 'identical-weft' });
      else receipt.appended.push({ stmt: idx, id: res.entry.id, kind: res.entry.kind, cell: res.entry.cell, addr: res.entry.addr, by: res.entry.by, at: res.entry.at, of: res.entry.of, ...(res.shard ? { shard: res.shard } : {}) });
      if (spec.label) state.labels.set(spec.label, res.entry.id);
      (h._scriptIds || (h._scriptIds = new Set())).add(res.entry.id);
      state.writeCount++;
    }
  } catch (e) {
    const err = wrap(e); err.receipt = receipt; receipt.stopped_at = idx; err.detail = { ...(err.detail || {}), stopped_at: idx, appended: state.receipts.flatMap((r) => r.appended).concat(receipt.appended).map((a) => a.id) };
    throw err;
  }
  receipt.labels = Object.fromEntries([...state.labels].sort());
  receipt.cost = costOf(ix);
  state.receipts.push(receipt);
  return receipt;
}

function resolveAndWeave(h, ix, spec, state, warn) {
  const labelId = (name) => { const id = state.labels.get(name); if (!id) throw new EoqlError('E_LABEL', `label @${name} is not defined`); return id; };
  // re-evaluate constants that mention labels
  const cur = (node) => ix.constant(node);
  let body = spec.body, basis = spec.basis, addr = spec.addr;
  const re = (n, fallback) => (n ? cur(n) : fallback);
  void re;
  if (spec.call && !spec.declare) {
    const cm = spec.cm;
    if (cm.has('body') && containsLabel(cm.get('body'))) body = cur(cm.get('body'));
    if (cm.has('basis') && containsLabel(cm.get('basis'))) basis = cur(cm.get('basis'));
    if (spec.call.first && !spec.targets && !spec.view && spec.verb !== 'NUL' && containsLabel(spec.call.first)) addr = cur(spec.call.first);
    if (spec.verb === 'SEG' && cm.has('into')) body = { ...(isObj(body) ? body : {}), into: ix.constStr(cm.get('into'), 'into') };
  }
  let of = [];
  if (spec.nulAddr) of = currentHeads(h, ix, spec.nulAddr, spec.nulKind, false);
  else if (spec.targets) {
    for (const t of spec.targets) { if (t.label) of.push(labelId(t.label)); else for (const x of t.ids) of.push(hexRe.test(x) ? x : ix.resolveIdref(x)); }
    if (!addr) { for (const id of of) { ix.meter.cache.clear(); const e = h.source.canResolve ? h.source.byId(id) : null; if (e) { addr = e.addr; break; } } }
    if (!addr) throw new EoqlError('E_BAD_OF', 'cannot determine the address of the retraction target (give addr:)');
  } else if (spec.ofNode) {
    const n = spec.ofNode;
    if (n.t === 'heads') of = currentHeads(h, ix, addr, spec.kind, n.live);
    else {
      const items = n.t === 'list' ? n.items : [n];
      for (const i of items) {
        if (i.t === 'heads') { of.push(...currentHeads(h, ix, addr, spec.kind, i.live)); continue; }
        if (i.t === 'label') { of.push(labelId(i.name)); continue; }
        const v = ix.constant(i); if (Array.isArray(v)) of.push(...v); else of.push(v);
      }
      of = of.map((x) => (typeof x === 'string' && !hexRe.test(x) && /^[0-9a-f]{8,63}$/.test(x) ? ix.resolveIdref(x) : x));
    }
  }
  if (!of.length && !spec.nulAddr && !spec.targets && h.source.kind === 'lib') {
    ix.meter.cache.clear();
    const r = h.source.region(addr, [spec.kind]);
    if (r.items.some((it) => it.e.kind === spec.kind)) warn('W_BLIND_WRITE');
  }
  if (spec.kind === 'retract' && !of.length) throw new EoqlError('E_BAD_OF', 'a retraction needs targets (the slot has no heads?)');
  if (of.some((x) => typeof x !== 'string' || !hexRe.test(x))) throw new EoqlError('E_BAD_OF', 'of must hold entry ids');
  const res = weaveOne(h, { cell: spec.cell, kind: spec.kind, addr, body, of, basis });
  h.source._sig = null; h.source._data = null;
  return res;
}
function containsLabel(n) {
  let hit = false;
  const w = (x) => { if (!x || typeof x !== 'object' || hit) return; if (Array.isArray(x)) { x.forEach(w); return; } if (x.t === 'label') hit = true; for (const k of Object.keys(x)) w(x[k]); };
  w(n);
  return hit;
}

export function mergeReceipts(h, results, opts) {
  const out = { v: VERSION.receipt, mode: 'write', writer: h.writer, target: h.uri, statements: results.length, appended: [], noops: [], merged: [], labels: {}, warnings: [], stopped_at: null, cost: null };
  for (const r of results) { out.appended.push(...r.appended); out.noops.push(...r.noops); out.merged.push(...r.merged); out.warnings.push(...r.warnings); Object.assign(out.labels, r.labels); out.cost = r.cost; }
  void opts;
  return out;
}

// ---- views API (SPEC 7.1) ---------------------------------------------------------------------------------------------
export function viewsList(h, opts = {}) {
  const ix = new Interp(h, { frame: opts.asof ? { asof: opts.asof } : {} });
  ix._pendingFrame = opts.asof ? { asof: opts.asof } : {};
  try {
    const all = h.source.readAll(); const names = new Set();
    for (const it of all.items) if (it.e.kind === 'view' && it.e.addr.startsWith('view:')) names.add(it.e.addr.slice(5));
    const out = [];
    for (const n of [...names].sort()) {
      const v = viewLookupRaw(ix, n);
      if (v) out.push({ name: n, held: v.held, heads: v.heads, expr_hash: v.expr_hash });
    }
    return out;
  } finally { ix.end(); }
}
function viewLookupRaw(ix, name) { return viewLookup(ix, name); }
export function viewsGet(h, name, opts = {}) {
  const ix = new Interp(h, { frame: opts.asof ? { asof: opts.asof } : {} });
  ix._pendingFrame = opts.asof ? { asof: opts.asof } : {};
  try {
    const v = viewLookup(ix, name);
    if (!v) throw new EoqlError('E_BIND_NAME', `no view named ${name}`);
    return { name, expr: v.expr, expr_hash: v.expr_hash, params: v.params, id: v.id, held: v.held };
  } finally { ix.end(); }
}
export const setViewLookup = (h) => { h.viewLookup = viewLookup; return h; };
