// eval.mjs: the interpreter. Evaluation of an expression IS a fold of the log (SPEC 3): worlds in, worlds out.
import { EoqlError } from './errors.mjs';
import { canonical, sha256, isObj, idsDigest } from './util.mjs';
import { parse, isPred, N } from './parse.mjs';
import { print, hash as hashNode } from './print.mjs';
import { RunMeter } from './source.mjs';
import { compile, containsCall, collectCalls, AGG_FNS, WIN_ONLY, SCALAR_FNS } from './term.mjs';
import { cmp, truth, textOf, nv, plain, columnType, isJson, mkReal } from './val.mjs';
import { RawWorld, DerivedWorld, SourceCore, FilterCore, MergeCore, LiteralCore, Ground, DEFAULT_FRAME, parseCut, cutOperator, rawRows, COLLAPSE_RULES, SYS_COLS, cmpKey } from './world.mjs';
import { Fold } from './fold.mjs';
import { wildcardGlob } from './globs.mjs';
import { sortRows, windowOver, WIN_NAMES, tupleKey, valueKey } from './rel.mjs';
import { catalogRows, catalogColumns } from './catalog.mjs';
import { invalidReason } from './jsonl.mjs';
import { conVerb } from './con.mjs';

const DEFAULT_BUDGET = { records: 2000000, rows: 2000000, steps: 20000000, bytes: 536870912 };
const isNode = (n) => n && typeof n === 'object' && typeof n.t === 'string';

export class Interp {
  constructor(handle, opts = {}) {
    this.handle = handle; this.opts = opts;
    this.source = handle.groundSource || handle.source;
    this.params = opts.params || {};
    this.labels = opts.labels || new Map();
    this.legacy = !!opts.legacyGaps;
    this.depth = 0; this.viewDepth = 0; this.viewStack = [];
    this.ground = new Ground(this);
    this.resetRun();
  }
  resetRun() {
    const lim = { ...DEFAULT_BUDGET };
    for (const b of [this.handle.budget, this.opts.budget]) if (b) for (const [k, v] of Object.entries(b)) if (typeof v === 'number' && v >= 0) lim[k] = lim[k] === undefined ? v : Math.min(lim[k], v);
    this.cost = { entries: 0, rows: 0, steps: 0, limits: lim, exhausted: false };
    this.meter = new RunMeter();
    this.meter.onCharge = () => { if (this.meter.bytes > this.cost.limits.bytes) this.budgetExceeded('bytes'); if (this.meter.records > this.cost.limits.records) this.budgetExceeded('records'); };
    if (this.handle.source) this.handle.source.begin(this.meter);
    if (this.handle.groundSource && this.handle.groundSource !== this.handle.source) this.handle.groundSource.begin(this.meter);
    this.seenIds = new Set();
    this.noField = { n: 0 };
    this.gapList = []; this.gapIdx = new Map(); this.findings = []; this.planNodes = []; this.verbs = {}; this.prims = new Set(); this.exts = new Set();
    this.collapsedAgg = null; this.unresolved = new Set();
    this.frameNote = {};
    this.nodeStack = [];
    this.rootCache = null; this._rootFramed = null; this.seenHealth = [];
  }
  end() { if (this.handle.source) this.handle.source.end(); if (this.handle.groundSource) this.handle.groundSource.end(); }

  // ---- cost ----------------------------------------------------------------------------------------------------
  budgetExceeded(counter) {
    this.cost.exhausted = true;
    const spent = counter === 'bytes' ? this.meter.bytes : counter === 'records' ? this.meter.records : this.cost[counter];
    throw new EoqlError('E_BUDGET', `budget exceeded: ${counter} ${spent} > ${this.cost.limits[counter]}`, { detail: { counter, limit: this.cost.limits[counter], spent, node: this.nodeStack.length ? this.nodeStack[this.nodeStack.length - 1] : null } });
  }
  emitRows(n) { this.cost.rows += n; if (this.cost.rows > this.cost.limits.rows) this.budgetExceeded('rows'); }
  stepN(n) { this.cost.steps += n; if (this.cost.steps > this.cost.limits.steps) this.budgetExceeded('steps'); }
  chargeEntries(items) {
    for (const it of items) if (!this.seenIds.has(it.e.id)) { this.seenIds.add(it.e.id); this.cost.entries++; }
    if (this.cost.limits.entries !== undefined && this.cost.entries > this.cost.limits.entries) this.budgetExceeded('entries');
    return items;
  }
  gap(code, detail, count) {
    const k = code + '|' + detail;
    const g = this.gapIdx.get(k);
    if (g) { if (count !== undefined) g.count = (g.count || 0) + count; return; }
    const o = { code, detail }; if (count !== undefined) o.count = count; this.gapIdx.set(k, o); this.gapList.push(o);
  }
  finding(f) { const k = canonical(f); if (!this.findings.some((x) => canonical(x) === k)) this.findings.push(f); }
  noteUnresolved(ids) { for (const i of ids) this.unresolved.add(i); }
  noteCollapsed(c) {
    if (!c.rules.size) return;
    if (!this.collapsedAgg) this.collapsedAgg = { rule: new Set(), slots_collapsed: 0, values_discarded: 0 };
    for (const r of c.rules) this.collapsedAgg.rule.add(r);
    this.collapsedAgg.slots_collapsed += c.slots; this.collapsedAgg.values_discarded += c.discarded;
  }
  sourceOf() { return this.source; }
  sourceHealth() {
    const s = this.source;
    if (s && s.kind !== 'lazy') return s.readAll().health;
    const h = { corrupt: [], torn: [], extra: [], files: [] };
    for (const x of this.seenHealth || []) { h.corrupt.push(...x.corrupt); h.torn.push(...x.torn); h.extra.push(...(x.extra || [])); }
    return h;
  }
  corruptApplies(src, c, slotAddr) { if (src && src.kind === 'lazy') return c.addr === null || c.addr === undefined || c.addr === slotAddr; return true; }
  globalEvidence(health) {
    // corrupt or torn lines count globally for lib/blocks/sqlite (1.6.1); lazy attributes by address (see slot evidence)
    const src = this.source;
    const out = [];
    if (src && src.kind === 'lazy') {
      for (const c of [...health.corrupt, ...health.torn]) if (c.addr === null || c.addr === undefined) out.push({ reason: 'corrupt-line', where: `${c.file}:${c.line}`, detail: c.reason });
    } else {
      for (const c of health.corrupt) out.push({ reason: 'corrupt-line', where: `${c.file}:${c.line}`, detail: c.reason });
    }
    for (const c of health.torn) if (!(src && src.kind === 'lazy' && c.addr !== null && c.addr !== undefined)) out.push({ reason: 'torn-line', where: `${c.file}:${c.line}`, detail: c.reason });
    for (const x of health.extra || []) out.push({ ...x });
    return out;
  }

  // ---- worlds ----------------------------------------------------------------------------------------------------
  rootWorld() {
    if (this.rootCache) return this.rootCache;
    const h = this.handle;
    let w;
    if (h.rootWorld) w = h.rootWorld(this);
    else w = new RawWorld(this, new SourceCore(this, h.source, null), this.initialFrame());
    this.rootCache = w;
    return w;
  }
  initialFrame() {
    const f = { ...DEFAULT_FRAME };
    const o = { ...(this.handle.frame || {}), ...(this.opts.frame || {}) };
    for (const [k, v] of Object.entries(o)) {
      if (v === undefined) continue;
      if (k === 'asof' || k === 'perceiver') continue;
      if (k in f) f[k] = v;
    }
    this._pendingFrame = o;
    return f;
  }
  applyInitialFrame(w) {
    const o = this._pendingFrame || {};
    let x = w;
    if (o.asof !== undefined && o.asof !== null) x = this.applyCut(x, o.asof);
    if (o.perceiver) x = this.applyPerceiver(x, o.perceiver);
    if (o.collapse) this.checkCollapse(o.collapse);
    return x;
  }
  checkCollapse(list) {
    if (!Array.isArray(list) || !list.length) throw new EoqlError('E_FRAME', 'collapse must be a non-empty list of rules');
    for (const r of list) if (!COLLAPSE_RULES.has(r)) throw new EoqlError('E_FRAME', `unknown collapse rule ${JSON.stringify(r)}`, { detail: { valid: [...COLLAPSE_RULES] } });
  }
  applyCut(w, c) {
    if (!w.raw) throw new EoqlError('E_FRAME_DERIVED', 'asof applies to the log and is only legal on a raw world');
    const desc = parseCut(c);
    const { fn, cut } = cutOperator(this, desc);
    const core = new FilterCore(this, w.core, fn, { cut });
    return new RawWorld(this, core, { ...w.frame, asof: [...w.frame.asof, cut.label] });
  }
  applyPerceiver(w, P) {
    if (!w.raw) throw new EoqlError('E_FRAME_DERIVED', 'perceiver applies to the log and is only legal on a raw world');
    if (!isObj(P)) throw new EoqlError('E_FRAME', 'perceiver must be an object');
    for (const k of Object.keys(P)) if (!['writers', 'horizon', 'asof'].includes(k)) throw new EoqlError('E_FRAME', `unknown perceiver key ${k}`);
    let core = w.core;
    const label = {};
    if (P.asof !== undefined) { const desc = parseCut(P.asof); const { fn, cut } = cutOperator(this, desc); core = new FilterCore(this, core, fn, { cut }); label.asof = cut.label; }
    if (P.writers !== undefined) {
      if (!Array.isArray(P.writers) || !P.writers.every((x) => typeof x === 'string')) throw new EoqlError('E_FRAME', 'perceiver.writers must be a list of strings');
      const ws = new Set(P.writers); label.writers = [...P.writers].sort();
      core = new FilterCore(this, core, (items) => items.filter((it) => ws.has(it.e.by)), { note: 'perceiver.writers' });
    }
    if (P.horizon !== undefined) {
      const hz = P.horizon; label.horizon = hz;
      core = new FilterCore(this, core, (items, parent) => {
        const f = parent.fold('causal'); const keep = new Set(); const st = [];
        const seedIdx = [];
        if (typeof hz === 'string') { const id = /^[0-9a-f]{64}$/.test(hz) ? hz : this.resolveIdref(hz.replace(/^#/, '')); const i = f.idx.get(id); if (i === undefined) throw new EoqlError('E_FRAME', `horizon entry ${id} is not in the world`); seedIdx.push(i); } else if (isObj(hz) && typeof hz.writer === 'string') { for (let i = 0; i < f.n; i++) if (f.ents[i].by === hz.writer) seedIdx.push(i); } else throw new EoqlError('E_FRAME', 'horizon must be an idref or {writer}');
        for (const i of seedIdx) if (!keep.has(i)) { keep.add(i); st.push(i); }
        while (st.length) { const x = st.pop(); for (const p of f.preds[x]) if (!keep.has(p)) { keep.add(p); st.push(p); } }
        return items.filter((it) => keep.has(f.idx.get(it.e.id)));
      }, { note: 'perceiver.horizon' });
    }
    const parentCore = w.core;
    core.unseenFn = (res, parent) => { const vis = new Set(res.map((x) => x.e.id)); const hidden = new Set(); const pset = new Set(parent.items().map((x) => x.e.id)); for (const it of res) for (const id of [...it.e.of, ...it.e.seen]) if (!vis.has(id) && pset.has(id)) hidden.add(id); return hidden.size; };
    void parentCore;
    return new RawWorld(this, core, { ...w.frame, perceiver: [...w.frame.perceiver, label] });
  }

  // ---- constants and clause helpers ---------------------------------------------------------------------------------
  scope(extra = {}) { return { interp: this, params: this.params, cols: null, colList: [], nonEmpty: null, agg: false, ...extra }; }
  constant(node) {
    if (node.t === 'path' && node.parts.length === 1 && node.parts[0].name !== undefined) return node.parts[0].name; // a bare name in a typed-S position
    const f = compile(node, this.scope());
    this.prims.add('P-TERM');
    return plain(f({ c: {} }));
  }
  constStr(node, what) {
    const v = this.constant(node);
    if (typeof v !== 'string') throw new EoqlError('E_BAD_CLAUSE_VALUE', `${what} must be a string`, { pos: node.pos });
    return v;
  }
  constList(node, what) {
    if (node.t === 'param') { const v = this.constant(node); if (!Array.isArray(v)) throw new EoqlError('E_BAD_CLAUSE_VALUE', `${what} must be a list`, { pos: node.pos }); return v; }
    if (node.t !== 'list') throw new EoqlError('E_BAD_CLAUSE_VALUE', `${what} must be a list`, { pos: node.pos });
    return node.items.map((i) => this.constant(i.t === 'ordered' ? i.x : i));
  }
  strList(node, what) {
    const l = this.constList(node, what);
    if (!l.every((x) => typeof x === 'string')) throw new EoqlError('E_BAD_CLAUSE_VALUE', `${what} must be a list of strings`, { pos: node.pos });
    return l;
  }
  constObj(node, what) {
    if (node.t === 'param') { const v = this.constant(node); if (!isObj(v)) throw new EoqlError('E_BAD_CLAUSE_VALUE', `${what} must be an object`); return v; }
    if (node.t !== 'obj') throw new EoqlError('E_BAD_CLAUSE_VALUE', `${what} must be an object`, { pos: node.pos });
    const o = {};
    for (const p of node.pairs) o[p.k] = p.v.t === 'obj' ? this.constObj(p.v, what) : p.v.t === 'list' ? this.constList(p.v, what) : this.constant(p.v);
    return o;
  }
  constNum(node, what) {
    const v = this.constant(node);
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new EoqlError('E_BAD_CLAUSE_VALUE', `${what} must be a number`, { pos: node.pos });
    return v;
  }
  constBool(node, what) {
    const v = this.constant(node);
    if (typeof v === 'boolean') return v; if (v === 1 || v === 0) return v === 1;
    throw new EoqlError('E_BAD_CLAUSE_VALUE', `${what} must be true or false`, { pos: node.pos });
  }
  labelId(name, pos) { const id = this.labels.get(name); if (!id) throw new EoqlError('E_LABEL', `label @${name} is not defined`, { pos }); this.prims.add('P-LABEL'); return id; }
  resolveIdref(hex, pos) {
    this.prims.add('P-PARAM');
    if (hex.length === 64) return hex;
    const src = this.source;
    const found = new Set();
    if (this._idCache) for (const id of this._idCache) if (id.startsWith(hex)) found.add(id);
    if (src && src.canResolve) { const all = src.readAll(); for (const it of all.items) if (it.e.id.startsWith(hex)) found.add(it.e.id); } else if (src) {
      const all = src.readAll(); for (const it of all.items) if (it.e.id.startsWith(hex)) found.add(it.e.id);
    }
    if (found.size === 0) throw new EoqlError('E_BIND_NAME', `no entry has an id starting with ${hex}`, { pos });
    if (found.size > 1) throw new EoqlError('E_AMBIGUOUS_REF', `id prefix ${hex} is ambiguous`, { pos, detail: { candidates: [...found].sort().slice(0, 10) } });
    return [...found][0];
  }
  clauseMap(node) { const m = new Map(); for (const c of node.clauses) m.set(c.key, c.value); return m; }

  // ---- the dispatcher ---------------------------------------------------------------------------------------------
  evalWorld(node, ctx, env) {
    this.tickDepth();
    try {
      switch (node.t) {
        case 'verb': return this.evalVerb(node, ctx, env);
        case 'path': return this.evalName(node, ctx, env);
        case 'viewcall': return this.evalView(node, node.name, node.pairs, ctx, env);
        case 'bin':
          if (isPred(node)) return this.lift(node, ctx, env);
          if (node.op === 'AND' || node.op === 'OR') return this.setOp(node.op, this.evalWorld(node.a, ctx, env), this.evalWorld(node.b, ctx, env), ctx);
          throw new EoqlError('E_TYPE', `operator ${node.op} does not yield a world`, { pos: node.pos });
        case 'not':
          if (isPred(node.x)) return this.lift(node, ctx, env);
          return this.setOp('NOT', this.evalWorld(node.x, ctx, env), null, ctx);
        case 'rel': case 'isnull': case 'isset': case 'is': case 'contains': case 'in': case 'between': case 'like': case 'glob': return this.lift(node, ctx, env);
        default: throw new EoqlError('E_TYPE', `expression of type ${node.t} is not a world`, { pos: node.pos });
      }
    } finally { this.depth--; }
  }
  tickDepth() { if (++this.depth > 200) { this.depth = 0; throw new EoqlError('E_LIMIT', 'evaluation nesting too deep'); } }
  lift(pred, ctx, env) {
    const n = N('verb', pred.pos, { verb: 'EVA', first: null, clauses: [{ key: 'where', value: pred }] });
    return this.evalVerb(n, ctx, env);
  }
  evalName(node, ctx, env) {
    if (node.parts.length !== 1 || node.parts[0].name === undefined) throw new EoqlError('E_BIND_NAME', `${print(node)} is not a world name`, { pos: node.pos });
    const name = node.parts[0].name;
    for (let e = env; e; e = e.parent) if (e.names.has(name)) return this.force(e.names, name);
    const w = this.storedView(name, [], ctx, env, node.pos, true);
    if (w) return w;
    if (name === 'sources') return this.applyInitialFrameOnce();
    throw new EoqlError('E_BIND_NAME', `unknown name ${name}`, { pos: node.pos });
  }
  applyInitialFrameOnce() {
    if (!this._rootFramed) this._rootFramed = this.applyInitialFrame(this.rootWorld());
    return this._rootFramed;
  }
  force(names, name) {
    const v = names.get(name);
    if (v && v.thunk) { if (v.busy) throw new EoqlError('E_CYCLE', `name ${name} refers to itself`); v.busy = true; try { names.set(name, v.thunk()); } finally { /* replaced */ } return names.get(name); }
    return v;
  }
  ctxOrRoot(ctx) { return ctx || this.applyInitialFrameOnce(); }
  inputOf(node, ctx, env) { return node.first ? this.evalWorld(node.first, this.ctxOrRoot(ctx), env) : this.ctxOrRoot(ctx); }

  evalVerb(node, ctx, env) {
    const verb = node.verb;
    this.verbs[verb] = (this.verbs[verb] || 0) + 1;
    const id = this.planNodes.length + 1;
    this.nodeStack.push(`${verb}#${id}`);
    const plan = { id, verb, clauses: node.clauses.map((c) => c.key), access: null, rows_out: null, notes: [] };
    this.planNodes.push(plan);
    this.curPlan = plan;
    let out;
    try {
      switch (verb) {
        case 'EVA': out = this.vEVA(node, ctx, env, plan); break;
        case 'SEG': out = this.vSEG(node, ctx, env, plan); break;
        case 'REC': out = this.vREC(node, ctx, env, plan); break;
        case 'SYN': out = this.vSYN(node, ctx, env, plan); break;
        case 'CON': out = conVerb(this, node, ctx, env, plan); break;
        case 'DEF': out = this.vDEF(node, ctx, env, plan); break;
        case 'INS': out = this.vINS(node, ctx, env, plan); break;
        case 'SIG': out = this.vSIG(node, ctx, env, plan); break;
        case 'NUL': out = this.vNUL(node, ctx, env, plan); break;
        default: throw new EoqlError('E_UNKNOWN_VERB', `unknown verb ${verb}`, { pos: node.pos });
      }
    } finally { this.nodeStack.pop(); }
    plan.rows_out = out.raw ? null : out.rows.length;
    if (!plan.access) { if (out.raw) { Object.defineProperty(plan, '_core', { value: out.core, enumerable: false }); plan.access = out.core.access(); } else plan.access = { method: 'table' }; }
    return out;
  }

  // ---- rows of a world -----------------------------------------------------------------------------------------
  rowsOf(w) {
    if (w.raw) {
      const r = rawRows(w);
      this.emitRows(r.rows.length);
      return { rows: r.rows, columns: r.columns, grouping: null };
    }
    return { rows: w.rows, columns: w.columns, grouping: w.grouping };
  }
  derive(rows, columns, from, extra = {}) {
    this.emitRows(rows.length);
    const w = new DerivedWorld(this, rows, columns, { frame: from && from.frame ? { ...from.frame } : { ...DEFAULT_FRAME }, grouping: extra.grouping === undefined ? null : extra.grouping, exprHash: extra.exprHash || null });
    if (extra.joined) w.joined = true;
    return w;
  }
  scopeFor(columns, rows, extra = {}) {
    return this.scope({ cols: new Set(columns), colList: columns, nonEmpty: rows.length > 0, ...extra });
  }
  stepper() { return (n) => this.stepN(n); }
  rowOf(c, m, g) { const r = { c, m }; if (g !== undefined) r.g = g; return r; }
  unionMeta(rows) {
    let held = 1, inc = null; const src = []; const slots = new Set();
    for (const r of rows) {
      if (r.m.held > held) held = r.m.held;
      if (r.m.inc) { if (!inc) inc = []; for (const e of r.m.inc) if (!inc.includes(e)) inc.push(e); }
      for (const s of r.m.src) src.push(s);
      if (r.m.slot) slots.add(JSON.stringify(r.m.slot));
    }
    return { held, inc, src, slot: slots.size === 1 ? JSON.parse([...slots][0]) : null };
  }

  // ---- EVA ------------------------------------------------------------------------------------------------------
  vEVA(node, ctx, env) {
    const input = this.inputOf(node, ctx, env);
    const cm = this.clauseMap(node);
    const { rows, columns, grouping } = this.rowsOf(input);
    const w = cm.get('where');
    if (!w) return this.derive(rows, columns, input, { grouping, joined: input.joined });
    this.prims.add('P-TERM');
    let pred;
    const before = this.noField.n;
    try { pred = compile(w, this.scopeFor(columns, rows)); } catch (e) {
      if (e instanceof EoqlError && e.code === 'E_BIND_FIELD' && this.legacy) { this.gap('W_LEGACY_GAP', `unbindable condition kept every row: ${e.message}`, rows.length); return this.derive(rows, columns, input, { grouping, joined: input.joined }); }
      throw e;
    }
    const out = [];
    for (const r of rows) { this.stepN(1); if (truth(pred(r)) === 1) out.push(r); }
    if (this.noField.n > before) this.gap('W_NO_FIELD', `a condition read a field that some rows do not have (read as NULL)`, this.noField.n - before);
    return this.derive(out, columns, input, { grouping, joined: input.joined });
  }

  // ---- SEG --------------------------------------------------------------------------------------------------------
  segSelectors(node, ctx, env) {
    const cm = this.clauseMap(node);
    const sel = {};
    const addSel = (target, obj) => {
      for (const [k, v] of Object.entries(obj)) {
        if (!['addr', 'kinds', 'writers', 'ids', 'where'].includes(k)) throw new EoqlError('E_BAD_CLAUSE_VALUE', `unknown selector ${k}`, { detail: { valid: ['addr', 'kinds', 'writers', 'ids', 'where'] } });
      }
      void target;
    };
    const readObj = (key, extra) => {
      const v = cm.get(key); if (!v) return null;
      if (v.t !== 'obj') throw new EoqlError('E_BAD_CLAUSE_VALUE', `${key} must be an object`, { pos: v.pos });
      const out = {};
      for (const p of v.pairs) {
        if (![...['addr', 'kinds', 'writers', 'ids', 'where'], ...(extra || [])].includes(p.k)) throw new EoqlError('E_BAD_CLAUSE_VALUE', `unknown selector ${p.k} in ${key}`, { pos: v.pos });
        out[p.k] = p.v;
      }
      return out;
    };
    void addSel;
    const keepNodes = readObj('keep') || {};
    for (const k of ['addr', 'kinds', 'writers', 'ids', 'where']) if (cm.has(k)) { if (keepNodes[k]) throw new EoqlError('E_BAD_CLAUSE_VALUE', `${k} given both as a shortcut and in keep`); keepNodes[k] = cm.get(k); }
    if (cm.has('kind')) { const kn = cm.get('kind'); if (keepNodes.kinds) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'kind and kinds both given'); keepNodes.kinds = N('list', kn.pos, { items: [kn] }); }
    const dropNodes = readObj('drop', ['cascade']);
    const resolve = (nodes) => {
      if (!nodes) return null;
      const s = {};
      if (nodes.addr) { const v = nodes.addr.t === 'list' || nodes.addr.t === 'param' ? this.constList(nodes.addr, 'addr') : [this.constant(nodes.addr)]; if (!v.every((x) => typeof x === 'string')) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'addr must be a string or a list of strings'); s.addr = v; }
      if (nodes.kinds) s.kinds = this.strList(nodes.kinds, 'kinds');
      if (nodes.writers) s.writers = this.strList(nodes.writers, 'writers');
      if (nodes.ids) {
        const n = nodes.ids;
        if (n.t === 'list') s.ids = this.constList(n, 'ids'); else if (n.t === 'param') s.ids = this.constList(n, 'ids');
        else { const w = this.evalWorld(n, this.ctxOrRoot(ctx), env); const { rows, columns } = this.rowsOf(w); if (!columns.includes('_id')) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'ids: a world must have an _id column'); s.ids = rows.map((r) => r.c._id); }
        if (!s.ids.every((x) => typeof x === 'string')) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'ids must be entry ids');
        s.ids = s.ids.map((x) => this.resolveIdref(x));
      }
      if (nodes.where) s.where = nodes.where;
      if (nodes.cascade) { s.cascade = this.constant(nodes.cascade); if (!['none', 'of', 'full'].includes(s.cascade)) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'cascade must be none, of or full'); }
      return s;
    };
    sel.keep = resolve(keepNodes); sel.drop = resolve(dropNodes);
    sel.table = cm.has('table') ? this.constStr(cm.get('table'), 'table') : null;
    return sel;
  }
  entryTest(sel) { // -> fn(e)->bool for non-kinds selectors, evaluating `where` over raw entry columns
    const ts = [];
    if (sel.addr) { const gs = sel.addr.map(wildcardGlob); ts.push((e) => gs.some((g) => g(e.addr))); }
    if (sel.writers) { const ws = new Set(sel.writers); ts.push((e) => ws.has(e.by)); }
    if (sel.ids) { const ids = new Set(sel.ids); ts.push((e) => ids.has(e.id)); }
    return ts;
  }
  whereOnEntries(items, whereNode) {
    this.prims.add('P-TERM');
    const rows = []; const keys = new Set();
    for (const it of items) {
      const e = it.e;
      const c = { _id: e.id, _addr: e.addr, _kind: e.kind, _cell: e.cell, _by: e.by, _at: e.at, _of: e.of, _seen: e.seen, _basis: e.basis, body: e.body };
      if (isObj(e.body)) for (const k of Object.keys(e.body)) if (!k.startsWith('_') && !(k in c)) { c[k] = e.body[k]; keys.add(k); }
      rows.push({ c });
    }
    const cols = [...['_id', '_addr', '_kind', '_cell', '_by', '_at', '_of', '_seen', '_basis', 'body'], ...[...keys].sort()];
    const f = compile(whereNode, this.scope({ cols: new Set(cols), colList: cols, nonEmpty: rows.length > 0 }));
    const ok = new Set();
    const before = this.noField.n;
    for (let i = 0; i < rows.length; i++) { this.stepN(1); if (truth(f(rows[i])) === 1) ok.add(items[i].e.id); }
    if (this.noField.n > before) this.gap('W_NO_FIELD', 'SEG where read a field that some entries do not have', this.noField.n - before);
    return ok;
  }
  // matches(items, sel) -> Set of ids matching the selector (retractions follow the retraction-closure rule, see BUILD_NOTES)
  matchSet(items, sel) {
    const tests = this.entryTest(sel);
    const kinds = sel.kinds ? new Set(sel.kinds) : null;
    const whereOk = sel.where ? this.whereOnEntries(items, sel.where) : null;
    const other = (e) => tests.every((t) => t(e)) && (!whereOk || whereOk.has(e.id));
    const keep = new Set();
    for (const it of items) { const e = it.e; if (e.kind !== 'retract' && other(e) && (!kinds || kinds.has(e.kind))) keep.add(e.id); }
    const retr = items.filter((it) => it.e.kind === 'retract');
    if (!kinds) { for (const it of retr) if (other(it.e)) keep.add(it.e.id); return keep; }
    let changed = true;
    while (changed) { // a retraction is kept with its targets (SPEC leaves this open; BUILD_NOTES)
      changed = false;
      for (const it of retr) { const e = it.e; if (keep.has(e.id) || !other(e)) continue; if (e.of.some((t) => keep.has(t))) { keep.add(e.id); changed = true; } }
    }
    return keep;
  }
  vSEG(node, ctx, env, plan) {
    const input = this.inputOf(node, ctx, env);
    const sel = this.segSelectors(node, ctx, env);
    if (sel.table) {
      if (input.core && input.core.isRel) {
        let t; try { t = input.rel.readTable(sel.table); } catch (e) { if (e instanceof EoqlError && e.pos === undefined) e.pos = node.pos; throw e; }
        const rowsR = t.rows.map((c) => ({ c, m: { held: 1, inc: null, src: [], slot: null } }));
        this.prims.add('P-TERM'); plan.access = { method: 'table', table: sel.table };
        const wR = this.derive(rowsR, t.columns.map((c) => c.name), input, {}); wR.catalog = true; return wR;
      }
      if (!input.raw) throw new EoqlError('E_TYPE', 'SEG table: needs a raw world', { pos: node.pos });
      const fold = input.fold();
      const facts = { danglingCount: fold.dangling.size, corruptCount: input.core.health().corrupt.length, cutPos: input.frame.asof.length ? fold.n : null };
      const cols = catalogColumns(fold, sel.table);
      if (!cols) throw new EoqlError('E_BIND_NAME', `no catalog relation named ${sel.table}`, { pos: node.pos });
      const rrows = catalogRows(fold, sel.table, facts);
      this.prims.add('P-TERM');
      plan.access = { method: 'table', table: sel.table };
      const names = cols.map((c) => c.name);
      const rows = rrows.map((r) => ({ c: r.c, m: { held: 1, inc: null, src: r.src, slot: null } }));
      const w = this.derive(rows, names, input, {});
      w.catalog = true;
      return w;
    }
    if (!sel.keep && !sel.drop) return input;
    if (!input.raw) { // row filter on a derived world
      const { rows, columns } = this.rowsOf(input);
      if (sel.keep && sel.keep.ids) { /* ids on columns */ }
      const test = (s, r) => {
        const c = r.c;
        if (s.addr && !s.addr.map(wildcardGlob).some((g) => g(String(c._addr ?? '')))) return false;
        if (s.kinds && !s.kinds.includes(c._kind)) return false;
        if (s.writers && !s.writers.includes(c._by)) return false;
        if (s.ids && !s.ids.includes(c._id)) return false;
        return true;
      };
      let out = rows;
      if (sel.keep) { out = out.filter((r) => test(sel.keep, r)); if (sel.keep.where) { const f = compile(sel.keep.where, this.scopeFor(columns, out)); out = out.filter((r) => truth(f(r)) === 1); } }
      if (sel.drop) { const d = sel.drop; out = out.filter((r) => { const hit = [['addr', d.addr], ['kinds', d.kinds], ['writers', d.writers], ['ids', d.ids]].some(([k, v]) => v && test({ [k]: v }, r)); return !hit; }); }
      return this.derive(out, columns, input, {});
    }
    // raw: the fold of the sub-log
    let core = input.core;
    const keep = sel.keep;
    const exactAddrs = keep && keep.addr && keep.addr.every((a) => !/[*?]/.test(a)) ? keep.addr : null;
    const pushable = core instanceof SourceCore && core._items === null && !core.push && exactAddrs && core.source.hasRegions();
    if (pushable) {
      core = new SourceCore(this, core.source, { addrs: [...new Set(exactAddrs)].sort(), kinds: keep.kinds || null });
      plan.notes.push('pushed:addr' + (keep.kinds ? ',kinds' : ''));
    }
    const note = [];
    if (keep) note.push('keep');
    if (sel.drop) note.push('drop');
    const self = this;
    core = new FilterCore(this, core, (items, parent) => {
      let cur = items;
      if (keep) { const ok = self.matchSet(cur, keep); cur = cur.filter((it) => ok.has(it.e.id)); }
      if (sel.drop) {
        const d = sel.drop;
        const hit = new Set();
        const tests = self.entryTest(d); const kinds = d.kinds ? new Set(d.kinds) : null;
        const whereOk = d.where ? self.whereOnEntries(cur, d.where) : null;
        // ANY selector present matches
        const any = [];
        if (d.addr) any.push((e) => { const gs = d.addr.map(wildcardGlob); return gs.some((g) => g(e.addr)); });
        if (d.writers) any.push((e) => d.writers.includes(e.by));
        if (d.ids) any.push((e) => d.ids.includes(e.id));
        if (kinds) any.push((e) => kinds.has(e.kind));
        if (whereOk) any.push((e) => whereOk.has(e.id));
        void tests;
        for (const it of cur) if (any.some((t) => t(it.e))) hit.add(it.e.id);
        if (d.cascade && d.cascade !== 'none') {
          const f = new Fold(cur); const down = f.adjacency(d.cascade === 'of' ? 'of' : 'full', 'down');
          const st = []; const gone = new Set();
          for (const id of hit) { const i = f.idx.get(id); if (i !== undefined) { gone.add(i); st.push(i); } }
          while (st.length) { const x = st.pop(); for (const y of down(x)) if (!gone.has(y)) { gone.add(y); st.push(y); } }
          for (const i of gone) hit.add(f.ents[i].id);
        }
        cur = cur.filter((it) => !hit.has(it.e.id));
      }
      return cur;
    }, { note: note.join('+') });
    if (sel.drop) this.exts.add('SEG:drop');
    if (sel.drop && sel.drop.cascade && sel.drop.cascade !== 'none') this.exts.add('SEG:cascade');
    return input.withCore(core);
  }

  // ---- REC --------------------------------------------------------------------------------------------------------
  vREC(node, ctx, env) {
    const input = this.inputOf(node, ctx, env);
    const cm = this.clauseMap(node);
    const { rows: inRows, columns: inCols, grouping } = this.rowsOf(input);
    let columns = [...inCols];
    let rows = inRows.map((r) => ({ c: { ...r.c }, m: r.m, g: r.g }));
    const step = this.stepper();
    // by
    let groupKeys = null; let groupedBy = grouping;
    if (cm.has('by')) {
      const bn = cm.get('by'); if (bn.t !== 'list') throw new EoqlError('E_BAD_CLAUSE_VALUE', 'by must be a list', { pos: bn.pos });
      this.prims.add('P-TERM');
      const fs = bn.items.map((i) => compile(this.byTerm(i), this.scopeFor(columns, rows)));
      groupKeys = rows.map((r) => tupleKey(fs.map((f) => f(r))));
      rows.forEach((r, i) => { r.g = groupKeys[i]; });
      groupedBy = { by: bn.items.map((i) => print(this.byTerm(i))) };
    } else if (grouping) groupKeys = rows.map((r) => r.g);
    // order keys
    let orderKeys = null; let orderPeer = null;
    if (cm.has('order')) {
      const on = cm.get('order'); if (on.t !== 'list') throw new EoqlError('E_BAD_CLAUSE_VALUE', 'order must be a list', { pos: on.pos });
      this.prims.add('P-TERM');
      orderKeys = on.items.map((i) => this.sortKey(i, columns, rows));
    }
    const framePair = cm.has('rows') ? this.framePair(cm.get('rows')) : null;
    // set (sequential, column-wise)
    if (cm.has('set')) {
      const sn = cm.get('set'); if (sn.t !== 'obj') throw new EoqlError('E_BAD_CLAUSE_VALUE', 'set must be an object', { pos: sn.pos });
      this.prims.add('P-TERM');
      for (const p of sn.pairs) {
        const wins = collectCalls(p.v, new Set([...WIN_NAMES, ...AGG_FNS]));
        const winVals = new Map();
        for (const call of wins) { winVals.set(call, this.computeWindow(call, rows, columns, groupKeys, orderKeys, framePair, step)); this.prims.add('V-WIN'); }
        const f = compile(p.v, this.scopeFor(columns, rows, { winVals: winVals.size ? winVals : null }));
        rows.forEach((r, i) => { r.i = i; });
        const vals = rows.map((r) => f(r));
        rows.forEach((r, i) => { r.c[p.k] = vals[i]; delete r.i; });
        if (!columns.includes(p.k)) columns.push(p.k);
      }
    }
    void orderPeer;
    if (cm.has('rename')) {
      const rn = cm.get('rename'); if (rn.t !== 'obj') throw new EoqlError('E_BAD_CLAUSE_VALUE', 'rename must be an object', { pos: rn.pos });
      const map = new Map(rn.pairs.map((p) => [p.k, this.constStr(p.v, 'rename target')]));
      for (const k of map.keys()) if (!columns.includes(k)) throw new EoqlError('E_BIND_FIELD', `cannot rename: no column ${k}`);
      columns = columns.map((c) => (map.has(c) ? map.get(c) : c));
      rows = rows.map((r) => { const c = {}; for (const [k, v] of Object.entries(r.c)) c[map.has(k) ? map.get(k) : k] = v; return { c, m: r.m, g: r.g }; });
    }
    if (cm.has('pick')) {
      const pk = this.strList(cm.get('pick'), 'pick');
      for (const k of pk) if (!columns.includes(k)) throw new EoqlError('E_BIND_FIELD', `cannot pick: no column ${k}`, { detail: { columns } });
      columns = pk;
      rows = rows.map((r) => { const c = {}; for (const k of pk) c[k] = r.c[k]; return { c, m: r.m, g: r.g }; });
    }
    return this.derive(rows, columns, input, { grouping: groupedBy });
  }
  byTerm(i) { return i.t === 'lit' && typeof i.v === 'string' ? N('path', i.pos, { parts: [{ name: i.v }] }) : i.t === 'ordered' ? i.x : i; }
  sortKey(item, columns, rows) {
    const n = item.t === 'ordered' ? item : { x: item, dir: 'asc', nulls: null };
    const x = this.byTerm(n.x);
    const f = compile(x, this.scopeFor(columns, rows));
    return { fn: f, dir: n.dir || 'asc', nulls: n.nulls || null, name: print(x) };
  }
  framePair(node) {
    if (node.t !== 'list' || node.items.length !== 2) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'rows must be [lo, hi]', { pos: node.pos });
    const [a, b] = node.items.map((i) => this.constant(i));
    for (const v of [a, b]) if (v !== null && !Number.isInteger(v)) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'rows bounds are integers or null');
    return [a, b];
  }
  computeWindow(call, rows, columns, groupKeys, orderKeys, framePair, step) {
    const sc = this.scopeFor(columns, rows);
    const name = call.name;
    const star = call.args.length === 1 && call.args[0].t === 'star';
    const args = star ? [] : call.args.map((a) => compile(a, sc));
    const spec = { name, args, star, distinct: !!call.distinct, rows: framePair, hasOrder: !!(orderKeys && orderKeys.length) };
    const parts = new Map();
    rows.forEach((r, i) => { const k = groupKeys ? groupKeys[i] : ''; (parts.get(k) || parts.set(k, []).get(k)).push({ r, i }); });
    const out = new Array(rows.length);
    for (const part of parts.values()) {
      let ordered = part;
      if (orderKeys && orderKeys.length) {
        const dec = part.map((p, idx) => ({ p, i: idx, k: orderKeys.map((k) => k.fn(p.r)) }));
        dec.sort(this.cmpFor(orderKeys));
        ordered = dec.map((d) => d.p);
      }
      const rs = ordered.map((p) => p.r);
      const orderKeyFn = (r) => (orderKeys ? tupleKey(orderKeys.map((k) => k.fn(r))) : '');
      const vals = windowOver(rs, orderKeyFn, spec, step);
      ordered.forEach((p, j) => { out[p.i] = vals[j]; });
    }
    return out;
  }
  cmpFor(keys) { return sortCmp(keys); }

  // ---- SYN --------------------------------------------------------------------------------------------------------
  vSYN(node, ctx, env) {
    const input = this.inputOf(node, ctx, env);
    const cm = this.clauseMap(node);
    if (cm.has('with')) {
      const other = this.evalWorld(cm.get('with'), input, env);
      const mode = cm.has('mode') ? this.constStr(cm.get('mode'), 'mode') : 'merge';
      if (mode === 'merge') {
        if (!input.raw || !other.raw) throw new EoqlError('E_TYPE', 'SYN merge needs two raw worlds; use mode union, union_all, intersect or except for rows', { pos: node.pos });
        const core = new MergeCore(this, input.core, other.core);
        return new RawWorld(this, core, input.frame);
      }
      if (!['union', 'union_all', 'intersect', 'except'].includes(mode)) throw new EoqlError('E_BAD_CLAUSE_VALUE', `unknown SYN mode ${mode}`, { pos: node.pos });
      return this.setRows(mode, input, other);
    }
    if (cm.has('mode')) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'mode needs with:', { pos: node.pos });
    const { rows, columns, grouping } = this.rowsOf(input);
    if (cm.has('distinct')) {
      const dv = cm.get('distinct');
      const cols = dv.t === 'list' ? this.strList(dv, 'distinct') : (this.constBool(dv, 'distinct') ? columns : null);
      if (!cols) return this.derive(rows, columns, input, { grouping });
      for (const k of cols) if (!columns.includes(k)) throw new EoqlError('E_BIND_FIELD', `no column ${k}`);
      const seen = new Set(); const out = [];
      for (const r of rows) { this.stepN(1); const k = tupleKey(cols.map((c) => r.c[c])); if (!seen.has(k)) { seen.add(k); out.push(r); } }
      return this.derive(out, columns, input, { grouping });
    }
    if (!cm.has('agg') && !cm.has('by')) return input;
    this.prims.add('P-TERM');
    const sc = this.scopeFor(columns, rows, { agg: true });
    const emptyBy = cm.has('by') && cm.get('by').t === 'list' && cm.get('by').items.length === 0; // by: [] = aggregate the whole input, ignoring inherited grouping (one row always)
    const byNodes = cm.has('by') && !emptyBy ? cm.get('by').items.map((i) => this.byTerm(i)) : null;
    const byFns = byNodes ? byNodes.map((n) => compile(n, this.scopeFor(columns, rows))) : null;
    const byNames = byNodes ? byNodes.map((n, k) => (n.t === 'path' ? print(n).replace(/^\$/, '') : `_g${k + 1}`)) : [];
    let groups = new Map();
    if (byFns) rows.forEach((r) => { this.stepN(1); const k = tupleKey(byFns.map((f) => f(r))); (groups.get(k) || groups.set(k, []).get(k)).push(r); });
    else if (grouping && !emptyBy) rows.forEach((r) => { (groups.get(r.g) || groups.set(r.g, []).get(r.g)).push(r); });
    else groups.set('', rows.slice());
    const aggPairs = cm.has('agg') ? cm.get('agg').pairs : [];
    if (cm.has('agg') && cm.get('agg').t !== 'obj') throw new EoqlError('E_BAD_CLAUSE_VALUE', 'agg must be an object', { pos: cm.get('agg').pos });
    const aggFns = aggPairs.map((p) => ({ name: p.k, f: compile(p.v, sc) }));
    for (const p of aggPairs) { if (!containsCall(p.v, AGG_FNS)) throw new EoqlError('E_TYPE', `agg ${p.k} is not an aggregate`, { pos: p.v.pos }); this.prims.add('V-AGG'); }
    const outCols = [];
    const keyCols = grouping && !byFns && !emptyBy ? (grouping.by || []) : byNames;
    const keyFns = byFns || (grouping && !byFns && !emptyBy ? null : []);
    for (const n of keyCols) outCols.push(n);
    for (const a of aggFns) outCols.push(a.name);
    const out = [];
    const keyRaw = byFns ? byNodes : null;
    void keyRaw;
    for (const grp of groups.values()) {
      this.stepN(grp.length);
      const rep = grp[0] || { c: {}, m: { held: 1, inc: null, src: [], slot: null } };
      const c = {};
      if (byFns) byFns.forEach((f, k) => { c[byNames[k]] = grp.length ? f(rep) : null; });
      else if (grouping && keyFns === null) { /* inherited grouping: key columns are the REC by terms, evaluated on the representative */ (grouping.by || []).forEach((nm) => { c[nm] = rep.c[nm] !== undefined ? rep.c[nm] : this.evalNamed(nm, columns, rows, rep); }); }
      for (const a of aggFns) c[a.name] = a.f(rep, grp);
      out.push({ c, m: grp.length ? this.unionMeta(grp) : { held: 1, inc: null, src: [], slot: null } });
    }
    return this.derive(out, outCols.length ? [...new Set(outCols)] : outCols, input, {});
  }
  evalNamed(text, columns, rows, rep) { try { const n = parse(text).statements[0].expr; return compile(n, this.scopeFor(columns, rows))(rep); } catch (e) { return null; } }
  setRows(mode, a, b) {
    const A = this.rowsOf(a), B = this.rowsOf(b);
    if (A.columns.filter((c) => !c.startsWith('_')).length !== B.columns.filter((c) => !c.startsWith('_')).length && A.columns.length !== B.columns.length) throw new EoqlError('E_TYPE', 'set operation needs the same number of columns');
    const cols = A.columns;
    const vals = (rs, cs) => rs.map((r) => ({ r, k: tupleKey(cs.map((c) => r.c[c])) }));
    const av = vals(A.rows, cols), bv = vals(B.rows, B.columns);
    let out = [];
    const reshape = (r, cs) => { if (cs === cols) return r; const c = {}; cols.forEach((n, i) => { c[n] = r.c[cs[i]]; }); return { c, m: r.m, g: r.g }; };
    if (mode === 'union_all') out = [...av.map((x) => x.r), ...bv.map((x) => reshape(x.r, B.columns))];
    else if (mode === 'union') { const seen = new Set(); for (const x of [...av, ...bv.map((y) => ({ r: reshape(y.r, B.columns), k: y.k }))]) if (!seen.has(x.k)) { seen.add(x.k); out.push(x.r); } } else if (mode === 'intersect') { const bs = new Set(bv.map((x) => x.k)); const seen = new Set(); for (const x of av) if (bs.has(x.k) && !seen.has(x.k)) { seen.add(x.k); out.push(x.r); } } else { const bs = new Set(bv.map((x) => x.k)); const seen = new Set(); for (const x of av) if (!bs.has(x.k) && !seen.has(x.k)) { seen.add(x.k); out.push(x.r); } }
    this.stepN(av.length + bv.length);
    return this.derive(out, cols, a, {});
  }

  // ---- DEF --------------------------------------------------------------------------------------------------------
  vDEF(node, ctx, env) {
    const cm = this.clauseMap(node);
    let w;
    let names = null;
    const frameKeys = ['asof', 'schema', 'collapse', 'anc', 'ordering'];
    const hasIn = cm.has('in');
    const hasBind = cm.has('bind') || cm.has('fix');
    if (hasBind || hasIn) {
      if (node.first && !hasBind && !hasIn) w = this.evalWorld(node.first, this.ctxOrRoot(ctx), env);
      const base = node.first ? this.evalWorld(node.first, this.ctxOrRoot(ctx), env) : this.ctxOrRoot(ctx);
      let env2 = env;
      if (cm.has('bind')) {
        const bn = cm.get('bind'); if (bn.t !== 'obj') throw new EoqlError('E_BAD_CLAUSE_VALUE', 'bind must be an object', { pos: bn.pos });
        names = new Map(); env2 = { names, parent: env };
        for (const p of bn.pairs) {
          names.set(p.k, { thunk: () => { const bnode = p.v; return this.evalWorld(bnode, base, env2); } });
        }
      }
      if (cm.has('fix')) {
        env2 = this.fixEnv(cm, base, env2, node);
      }
      w = hasIn ? this.evalWorld(cm.get('in'), base, env2) : base;
    } else w = this.inputOf(node, ctx, env);
    // frame arguments
    const any = frameKeys.some((k) => cm.has(k));
    if (any) {
      if (!w.raw) throw new EoqlError('E_FRAME_DERIVED', 'DEF frame arguments (asof, schema, collapse, anc, ordering) act on the log and are only legal on a raw world; write EVA(DEF(x; collapse: ...), p)', { pos: node.pos });
      let rw = w;
      if (cm.has('asof')) rw = this.applyCut(rw, this.constant(cm.get('asof')));
      const patch = {};
      if (cm.has('schema')) {
        const sv = cm.get('schema').t === 'obj' ? this.constObj(cm.get('schema'), 'schema') : this.constant(cm.get('schema'));
        if (sv === 'asof' || sv === 'latest') patch.schema = sv; else if (isObj(sv) && typeof sv.window === 'string' && Object.keys(sv).length === 1) patch.schema = sv; else { parseCut(sv); patch.schema = sv; }
      }
      if (cm.has('collapse')) { const l = this.strList(cm.get('collapse'), 'collapse'); this.checkCollapse(l); patch.collapse = l; }
      if (cm.has('anc')) { const a = this.constStr(cm.get('anc'), 'anc'); if (a !== 'slot' && a !== 'full') throw new EoqlError('E_FRAME', 'anc must be "slot" or "full"'); patch.anc = a; }
      if (cm.has('ordering')) { const o = this.constStr(cm.get('ordering'), 'ordering'); if (o !== 'causal' && o !== 'key') throw new EoqlError('E_FRAME', 'ordering must be "causal" or "key"'); patch.ordering = o; }
      // outermost DEF sets: our patch overrides inner settings
      w = rw.withFrame(patch);
    }
    if (cm.has('sort') || cm.has('limit') || cm.has('offset')) {
      const { rows, columns, grouping } = this.rowsOf(w);
      let out = rows;
      if (cm.has('sort')) {
        const sn = cm.get('sort'); if (sn.t !== 'list') throw new EoqlError('E_BAD_CLAUSE_VALUE', 'sort must be a list', { pos: sn.pos });
        this.prims.add('P-TERM');
        const keys = sn.items.map((i) => this.sortKey(i, columns, rows));
        out = sortRows(rows, keys, (n) => this.stepN(n));
      }
      let off = 0, lim = null;
      if (cm.has('offset')) off = this.limitVal(cm.get('offset'), 'offset');
      if (cm.has('limit')) lim = this.limitVal(cm.get('limit'), 'limit');
      if (off || lim !== null) out = out.slice(off, lim === null ? undefined : off + lim);
      return this.derive(out, columns, w, { grouping, joined: w.joined });
    }
    return w;
  }
  limitVal(node, what) {
    this.prims.add('P-TERM');
    const f = compile(node, this.scope()); const v = nv(plain(f({ c: {} })));
    if (!Number.isInteger(v) || v < 0) { if (v === null) return 0; throw new EoqlError('E_BAD_CLAUSE_VALUE', `${what} must be a non-negative integer`, { pos: node.pos }); }
    return v;
  }
  fixEnv(cm, base, env, node) {
    this.prims.add('P-FIX');
    const name = this.constStr(cm.get('fix'), 'fix');
    if (!cm.has('base') || !cm.has('step')) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'fix needs base and step', { pos: node.pos });
    const mode = cm.has('mode') ? this.constStr(cm.get('mode'), 'mode') : 'union';
    if (mode !== 'union' && mode !== 'union_all') throw new EoqlError('E_BAD_CLAUSE_VALUE', 'fix mode is union or union_all');
    if (countRefs(cm.get('step'), name) !== 1) throw new EoqlError('E_TYPE', `the step of a recursive relation must mention ${name} exactly once`, { pos: cm.get('step').pos });
    const b0 = this.evalWorld(cm.get('base'), base, env);
    const B = this.rowsOf(b0);
    const columns = [...B.columns];
    const acc = []; const seen = new Set();
    const keyOf = (r) => tupleKey(columns.map((c) => r.c[c]));
    let delta = [];
    for (const r of B.rows) { const k = keyOf(r); if (mode === 'union' && seen.has(k)) continue; seen.add(k); acc.push(r); delta.push(r); }
    let iter = 0;
    while (delta.length) {
      if (++iter > 1000000) this.budgetExceeded('steps');
      this.stepN(delta.length + 1);
      const names = new Map([[name, new DerivedWorld(this, delta, columns, {})]]);
      const e2 = { names, parent: env };
      const sw = this.evalWorld(cm.get('step'), base, e2);
      const S = this.rowsOf(sw);
      if (S.columns.length !== columns.length) throw new EoqlError('E_TYPE', 'the step of a recursive relation must have the same columns as its base');
      const next = [];
      for (const r of S.rows) {
        const rr = S.columns === columns ? r : { c: Object.fromEntries(columns.map((c, i) => [c, r.c[S.columns[i]]])), m: r.m };
        const k = keyOf(rr);
        if (mode === 'union') { if (seen.has(k)) continue; seen.add(k); }
        acc.push(rr); next.push(rr);
        if (acc.length > this.cost.limits.rows) this.budgetExceeded('rows');
      }
      delta = next;
    }
    const names = new Map([[name, new DerivedWorld(this, acc, columns, {})]]);
    this.emitRows(acc.length);
    return { names, parent: env };
  }

  // ---- INS --------------------------------------------------------------------------------------------------------
  vINS(node, ctx, env) {
    const cm = this.clauseMap(node);
    if (cm.has('rows') || cm.has('columns')) {
      this.exts.add('INS');
      const rn = cm.get('rows'); if (!rn || rn.t !== 'list') throw new EoqlError('E_BAD_CLAUSE_VALUE', 'INS rows must be a list', { pos: node.pos });
      this.prims.add('P-TERM');
      const raw = rn.items.map((it) => {
        if (it.t === 'list') return it.items.map((x) => plain(compile(x.t === 'ordered' ? x.x : x, this.scope())({ c: {} })));
        if (it.t === 'obj') { const o = {}; for (const p of it.pairs) o[p.k] = plain(compile(p.v, this.scope())({ c: {} })); return o; }
        throw new EoqlError('E_BAD_CLAUSE_VALUE', 'INS rows are lists or objects', { pos: it.pos });
      });
      let columns = cm.has('columns') ? this.strList(cm.get('columns'), 'columns') : null;
      if (!columns) { if (raw.length && !Array.isArray(raw[0])) { const ks = new Set(); for (const o of raw) for (const k of Object.keys(o)) ks.add(k); columns = [...ks]; } else columns = (raw[0] || []).map((_, i) => `column${i + 1}`); }
      const rows = raw.map((r) => { const c = {}; columns.forEach((n, i) => { c[n] = Array.isArray(r) ? (i < r.length ? r[i] : null) : (r[n] === undefined ? null : r[n]); }); return { c, m: { held: 1, inc: null, src: [], slot: null } }; });
      return this.derive(rows, columns, null, {});
    }
    if (cm.has('entries')) {
      this.exts.add('INS');
      const en = cm.get('entries'); const list = this.constList(en, 'entries');
      const items = [];
      for (const e of list) {
        const why = invalidReason(e);
        if (why) throw new EoqlError(why === 'id does not match content' ? 'E_ID_MISMATCH' : 'E_BAD_CLAUSE_VALUE', `not a valid entry: ${why}`, { pos: en.pos });
        items.push({ e, file: e.by });
      }
      const core = new LiteralCore(this, items, 'INS entries');
      return new RawWorld(this, core, { ...DEFAULT_FRAME });
    }
    // genesis
    this.exts.add('INS');
    const input = this.inputOf(node, ctx, env);
    if (!input.raw) throw new EoqlError('E_TYPE', 'INS(X) needs a raw world', { pos: node.pos });
    const anc = cm.has('anc') ? this.constStr(cm.get('anc'), 'anc') : input.frame.anc;
    const fold = input.fold();
    const rows = []; const columns = [...SYS_COLS, 'body', '_roots'];
    const rr = rawRows(input.withFrame({ collapse: ['none'] }));
    void rr;
    for (const slot of fold.slots) {
      const mem = slot.members;
      const roots = mem.filter((i) => {
        if (anc === 'slot') return !fold.ofIdx[i].some((t) => fold.slotOf[t] === slot.id);
        const memSet = new Set(mem); const seen = new Set(); const st = [i];
        while (st.length) { const x = st.pop(); for (const p of fold.preds[x]) { if (memSet.has(p)) return false; if (!seen.has(p)) { seen.add(p); st.push(p); } } }
        return true;
      });
      const proj = fold.project(slot, ['none'], anc);
      for (const i of roots) { const row = this.entryRow(input, fold, i, slot, proj); row.c._roots = roots.length; rows.push(row); }
    }
    rows.sort((a, b) => a.c._pos - b.c._pos);
    return this.derive(rows, columns, input, {});
  }
  entryRow(world, fold, i, slot, proj) {
    const e = fold.ents[i];
    const held = proj.held;
    const c = { _id: e.id, _slot: JSON.stringify([e.addr, e.kind]), _addr: e.addr, _kind: e.kind, _cell: e.cell, _by: e.by, _at: e.at, _v: e.v, _file: fold.fileOf(i) ?? null, _of: e.of, _seen: e.seen, _basis: e.basis, _pos: fold.pos[i], _head: proj.headSet.has(i) ? 1 : 0, _retracted: fold.isRetracted(i) ? 1 : 0, _retracted_by: fold.retractedBy.get(e.id) ?? null, _held: held, _determined: held === 1 ? 1 : 0, _incomplete: 0, _src: [e.id], body: e.body };
    void world;
    return { c, m: { held, inc: null, src: [e.id], slot: [e.addr, e.kind], key: e.id } };
  }

  // ---- SIG --------------------------------------------------------------------------------------------------------
  vSIG(node, ctx, env) {
    this.exts.add('SIG');
    let w = this.inputOf(node, ctx, env);
    const cm = this.clauseMap(node);
    if (cm.has('perceiver')) w = this.applyPerceiver(w, this.constObj(cm.get('perceiver'), 'perceiver'));
    if (cm.has('budget')) {
      const b = this.constObj(cm.get('budget'), 'budget');
      for (const [k, v] of Object.entries(b)) {
        if (!['entries', 'bytes', 'records', 'rows', 'steps'].includes(k)) throw new EoqlError('E_FRAME', `unknown budget field ${k}`);
        if (typeof v !== 'number' || v < 0) throw new EoqlError('E_FRAME', `budget ${k} must be a non-negative number`);
        const cur = this.cost.limits[k]; this.cost.limits[k] = cur === undefined ? v : Math.min(cur, v);
      }
      if (w.raw) w = w.withFrame({ budget: { ...(w.frame.budget || {}), ...b } }); else w.frame = { ...w.frame, budget: { ...(w.frame.budget || {}), ...b } };
    }
    if (cm.has('return')) {
      const r = this.constStr(cm.get('return'), 'return');
      if (r !== 'pointers' && r !== 'content') throw new EoqlError('E_FRAME', 'return must be "pointers" or "content"');
      if (!this.returnSet) this.returnSet = r; // the outermost setting governs (inner calls evaluate first, so keep overwriting)
      this.returnSet = r;
      if (w.raw) w = w.withFrame({ return: r }); else w.frame = { ...w.frame, return: r };
    }
    return w;
  }

  // ---- NUL --------------------------------------------------------------------------------------------------------
  vNUL(node, ctx, env) {
    const input = this.inputOf(node, ctx, env);
    const cm = this.clauseMap(node);
    if (cm.has('expect')) {
      this.exts.add('NUL:expect');
      const en = cm.get('expect');
      let addrs;
      if (en.t === 'list' || en.t === 'param') addrs = this.strList(en, 'expect');
      else { const w = this.evalWorld(en, input, env); const { rows, columns } = this.rowsOf(w); if (!columns.includes('_addr')) throw new EoqlError('E_BAD_CLAUSE_VALUE', 'expect: a world needs an _addr column'); addrs = [...new Set(rows.map((r) => r.c._addr))]; }
      if (!input.raw) throw new EoqlError('E_TYPE', 'NUL expect needs a raw world', { pos: node.pos });
      const fold = input.fold();
      const rows = [];
      const wholeEv = this.wholeSourceEvidence(input);
      for (const a of addrs) {
        const live = []; let any = false;
        for (const slot of fold.slots) if (slot.addr === a) { any = true; for (const i of slot.members) if (!fold.isRetracted(i)) live.push(i); }
        if (live.length) continue;
        let reason;
        if (any) reason = 'all-retracted';
        else {
          let inSource = false;
          const src = this.source;
          if (src) { const r = src.region(a, null); this.chargeEntries(r.items); inSource = r.items.some((it) => it.e.kind !== 'retract'); }
          reason = inSource ? 'out-of-window' : 'never-written';
        }
        rows.push({ c: { _addr: a, _reason: reason }, m: { held: 1, inc: wholeEv.length ? wholeEv : null, src: [], slot: null } });
      }
      return this.derive(rows, ['_addr', '_reason'], input, {});
    }
    if (cm.has('gaps')) {
      this.exts.add('NUL:gaps');
      if (!this.constBool(cm.get('gaps'), 'gaps')) return input;
      if (!input.raw) throw new EoqlError('E_TYPE', 'NUL gaps needs a raw world', { pos: node.pos });
      const ev = this.wholeSourceEvidence(input);
      const fold = input.fold();
      const rows = [];
      for (const e of ev) rows.push({ c: { reason: e.reason, where: e.where ?? null, ids: e.ids ?? null, detail: e.detail ?? null }, m: { held: 1, inc: null, src: [], slot: null } });
      if (fold.dangling.size) { const ids = [...fold.dangling].sort(); rows.push({ c: { reason: 'dangling-in-world', where: null, ids, detail: `${ids.length} referenced id(s) not in this world` }, m: { held: 1, inc: null, src: [], slot: null } }); }
      return this.derive(rows, ['reason', 'where', 'ids', 'detail'], input, {});
    }
    return input;
  }
  wholeSourceEvidence(world) {
    const out = [...this.globalEvidence(world.core.health())];
    const src = this.source;
    if (src && src.canResolve) {
      const all = src.readAll(); const have = new Set(all.items.map((it) => it.e.id)); const miss = new Set();
      for (const it of all.items) for (const id of [...it.e.of, ...it.e.seen]) if (!have.has(id)) miss.add(id);
      if (miss.size) out.push({ reason: 'dangling', where: 'source', ids: [...miss].sort() });
    }
    return out;
  }

  // ---- connectives on worlds ---------------------------------------------------------------------------------------
  keysOf(w) {
    if (w.raw) { const { rows } = this.rowsOf(w); return rows.map((r) => ({ k: r.c._id, r })); }
    if (!w._keys) {
      const count = new Map();
      w._keys = w.rows.map((r) => {
        const base = canonical({ derived: w.exprHash || 'x', body: plainRow(r.c, w.columns), src: r.m.src });
        const n = (count.get(base) || 0); count.set(base, n + 1);
        return { k: sha256(base + '#' + n), r };
      });
    }
    return w._keys;
  }
  setOp(op, a, b, ctx) {
    const cx = this.ctxOrRoot(ctx);
    const ka = this.keysOf(a);
    if (op === 'NOT') {
      const kc = this.keysOf(cx); const drop = new Set(ka.map((x) => x.k));
      const rows = kc.filter((x) => !drop.has(x.k)).map((x) => x.r);
      const { columns } = this.rowsOf(cx);
      return this.derive(rows, columns, cx, {});
    }
    const kb = this.keysOf(b);
    const sb = new Set(kb.map((x) => x.k));
    let rows;
    if (op === 'AND') rows = ka.filter((x) => sb.has(x.k)).map((x) => x.r);
    else { const sa = new Set(ka.map((x) => x.k)); rows = [...ka.map((x) => x.r), ...kb.filter((x) => !sa.has(x.k)).map((x) => x.r)]; }
    const { columns } = this.rowsOf(a);
    return this.derive(rows, columns, a, {});
  }

  // ---- views ---------------------------------------------------------------------------------------------------------
  evalView(node, name, pairs, ctx, env) {
    const params = {};
    for (const p of pairs) params[p.k] = this.constant(p.v);
    const w = this.storedView(name, params, ctx, env, node.pos, false);
    if (!w) throw new EoqlError('E_BIND_NAME', `unknown view ${name}`, { pos: node.pos });
    return w;
  }
  storedView(name, params, ctx, env, pos, quiet) {
    const vs = this.handle.viewLookup ? this.handle.viewLookup(this, name) : null;
    if (!vs) { if (quiet) return null; throw new EoqlError('E_BIND_NAME', `unknown view ${name}`, { pos }); }
    if (this.viewStack.includes(name)) throw new EoqlError('E_CYCLE', `view ${name} refers to itself`, { pos });
    if (this.viewStack.length >= 16) throw new EoqlError('E_LIMIT', 'view nesting deeper than 16', { detail: { limit: 'view-depth' } });
    if (vs.held > 1) this.gap('W_VIEW_HELD', `view ${name} has ${vs.held} concurrent definitions; the latest is used`, 1);
    const ast = parse(vs.expr);
    if (ast.statements.length !== 1 || ast.statements[0].t !== 'read') throw new EoqlError('E_VIEW_BODY', `view ${name} is not a single read expression`);
    const saved = this.params;
    const p = Array.isArray(params) ? {} : params;
    for (const k of vs.params || []) if (!(k in p)) throw new EoqlError('E_PARAM', `view ${name} needs parameter :${k}`);
    this.params = p;
    this.viewStack.push(name);
    try { return this.evalWorld(ast.statements[0].expr, this.ctxOrRoot(ctx), env); } finally { this.viewStack.pop(); this.params = saved; }
  }

  // ---- subqueries in terms -----------------------------------------------------------------------------------------------
  scalarSubquery(node, sc) {
    const w = this.evalWorld(node, sc.ctxWorld || this.ctxOrRoot(null), sc.env);
    const { rows, columns } = this.rowsOf(w);
    if (!rows.length) return null;
    const v = rows[0].c[columns[0]];
    return v === undefined ? null : v;
  }
  columnSubquery(node, sc) {
    const w = this.evalWorld(node, sc.ctxWorld || this.ctxOrRoot(null), sc.env);
    const { rows, columns } = this.rowsOf(w);
    const col = columns.includes('_id') && columns.length > 3 ? '_id' : columns[0];
    return rows.map((r) => (r.c[col] === undefined ? null : r.c[col]));
  }
}

function sortCmp(keys) {
  return (a, b) => {
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k]; const x = a.k[k], y = b.k[k];
      const nx = x === null || x === undefined, ny = y === null || y === undefined;
      if (nx || ny) { if (nx && ny) continue; const nf = key.nulls ? key.nulls === 'first' : key.dir === 'asc'; return nx ? (nf ? -1 : 1) : (nf ? 1 : -1); }
      const c = cmp(x, y);
      if (c !== 0) return key.dir === 'desc' ? -c : c;
    }
    return a.i - b.i;
  };
}
function countRefs(node, name) {
  let n = 0;
  const walk = (x) => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (x.t === 'path' && x.parts.length >= 1 && x.parts[0].name === name && x.parts.length === 1) n++;
    for (const k of Object.keys(x)) walk(x[k]);
  };
  walk(node);
  return n;
}
function plainRow(c, columns) { const o = {}; for (const k of columns) { const v = c[k]; o[k] = v === undefined ? null : plain(v); } return o; }
export { DEFAULT_BUDGET, SCALAR_FNS, WIN_ONLY, columnType, isJson, mkReal, textOf, hashNode, idsDigest, cmpKey };
