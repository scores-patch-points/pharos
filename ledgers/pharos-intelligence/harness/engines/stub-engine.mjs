// stub-engine.mjs: a STUB read engine implementing the adapter contract in README.md over an in-memory synthetic slice.
// It stands in for the pharos read side only so the harness can be exercised. Its feature flags change the SHAPE of the
// responses exactly as PREREG section 5 describes (G: ground + status; H: held set + survivors; T: verified hints + cheaper repeat reads).
import { sha256 } from '../lib/util.mjs';

const PAGE = 5;                  // entries per page (named in one place, as the real engine's page size must be)
const SHARDS = 8;                // stub placement: address hash -> one of 8 shards; a cold ask reads its whole shard

const ex = (e) => ({ id: e.id, kind: e.kind, by: e.by, at: e.at, of: e.of.map((x) => x.slice(0, 12)), body: e.body });
const key = (e) => e.at + '|' + e.id;
const bytes = (e) => JSON.stringify(e).length + 1;

export function openStub({ entries, features }) {
  const { G, H, T } = features;
  const byAddr = new Map();
  for (const e of entries) { if (!byAddr.has(e.addr)) byAddr.set(e.addr, []); byAddr.get(e.addr).push(e); }
  for (const l of byAddr.values()) l.sort((a, b) => (key(a) < key(b) ? -1 : 1));
  const shardOf = (addr) => parseInt(sha256(addr).slice(0, 4), 16) % SHARDS;
  const shardBytes = new Array(SHARDS).fill(0);
  for (const [a, l] of byAddr) shardBytes[shardOf(a)] += l.reduce((s, e) => s + bytes(e), 0);
  const schemaOf = (kind) => { const l = byAddr.get('schema:' + kind); return l ? l[l.length - 1] : null; };
  const declared = (kind) => ['retract', 'schema'].includes(kind) || !!schemaOf(kind);

  let stats, trails, schemaSeen;
  const reset = () => { stats = { bytes_read: 0, entries_parsed: 0, files_opened: 0, calls: 0 }; trails = new Map(); schemaSeen = new Set(); };
  reset();

  const heads = (list) => {
    const live = list.filter((e) => e.kind !== 'retract');
    const refd = new Set(live.flatMap((e) => e.of));
    return live.filter((e) => !refd.has(e.id));
  };
  const groundFor = (kind) => {
    const s = schemaOf(kind);
    if (!s) return { kind, fields: [], collapse: null, window: null, declared: false };
    return { kind, fields: s.body.read.fields, collapse: s.body.read.collapse, window: s.body.read.window, declared: true };
  };
  const readSchemaCost = (kind) => {
    if (!G || schemaSeen.has(kind)) return;
    schemaSeen.add(kind);
    const s = schemaOf(kind);
    if (s) { stats.bytes_read += bytes(s); stats.entries_parsed += 1; stats.files_opened += 1; }
  };
  const hotKinds = () => [...trails.keys()].slice(-2);

  const tools = () => {
    const t = [
      { name: 'ask', args: { addr: 'string', kind: 'string?', order: '"newest"|"oldest"?', cut: 'ISO time?', rule: '"causal-latest"?' }, doc: `entries at one address, at most ${PAGE} per call (newest by default); returns total and a pointer if more` },
      { name: 'lane', args: { kind: 'string', writer: 'string', from: 'ISO?', to: 'ISO?' }, doc: `entries of one kind written by one lane in a time range (at most ${PAGE}, newest)` },
      { name: 'range', args: { kind: 'string', from: 'ISO', to: 'ISO' }, doc: `entries of one kind whose time is in [from, to] (at most ${PAGE * 2}, newest)` },
      { name: 'read', args: { id: 'entry id prefix' }, doc: 'one entry by id prefix' },
    ];
    if (G) t.push({ name: 'schema', args: { kind: 'string' }, doc: 'the declared reading rule (ground) for a kind' });
    return t;
  };

  function ask(a) {
    const list0 = byAddr.get(a.addr) || [];
    const sh = shardOf(a.addr);
    const warm = T && trails.has(a.addr);
    // cost: a cold read scans the address's whole shard; a verified trail reads only the address's own entries
    if (warm) {
      const own = list0.reduce((s, e) => s + bytes(e), 0);
      stats.bytes_read += own; stats.entries_parsed += list0.length; stats.files_opened += 1;
    } else {
      stats.bytes_read += shardBytes[sh]; stats.entries_parsed += list0.length; stats.files_opened += 1;
    }
    let list = list0;
    if (a.kind) list = list.filter((e) => e.kind === a.kind || e.kind === 'retract');
    if (a.cut) list = list.filter((e) => e.at <= a.cut);
    const kinds = [...new Set(list.filter((e) => e.kind !== 'retract').map((e) => e.kind))];
    const out = { addr: a.addr, total: list.length };
    if (G) {
      kinds.forEach(readSchemaCost);
      const und = kinds.filter((k) => !declared(k));
      out.ground = kinds.length ? groundFor(kinds[0]) : { kind: null, fields: [], collapse: null, window: null, declared: false };
      if (kinds.length && und.length === kinds.length) {
        out.status = 'no-ground';
        out.shown = []; out.more = null;
        out.diagnosis = { undeclared_kind: und[0], entries: list.length, ids: list.map((e) => e.id) };
        if (T) trails.set(a.addr, 1);
        return out;
      }
    }
    const live = list.filter((e) => e.kind !== 'retract');
    const hs = heads(list);
    const page = a.order === 'oldest' ? list.slice(0, PAGE) : list.slice(-PAGE);
    out.shown = page.map(ex);
    out.more = list.length > PAGE ? `ask {addr:"${a.addr}", order:"${a.order === 'oldest' ? 'newest' : 'oldest'}"} for the other end` : null;
    if (!H) {
      const latest = live.slice(-1)[0];
      out.value = latest ? ex(latest) : null;          // collapsed single value, no count
    } else {
      out.held = hs.map(ex);
      out.survivors = hs.length;
      out.retracted = list.filter((e) => e.kind === 'retract').flatMap((e) => e.of.map((x) => x.slice(0, 12)));
      if (a.rule === 'causal-latest') out.value = live.length ? ex(live[live.length - 1]) : null;
    }
    if (G) out.status = hs.length > 1 && H ? 'held' : 'determined';
    if (T) {
      trails.set(a.addr, 1);
      out.next_look = hotKinds().filter((x) => x !== a.addr).map((x) => ({ addr: x, why: 'answered a similar question from here before', verified: true }));
    }
    return out;
  }

  function scan(kind, pred) {
    // lane and range have no placement in the stub: every entry of the slice is scanned
    let all = 0;
    for (const e of entries) { all += bytes(e); }
    stats.bytes_read += all; stats.entries_parsed += entries.length; stats.files_opened += SHARDS;
    return entries.filter((e) => e.kind === kind && pred(e)).sort((a, b) => (key(a) < key(b) ? -1 : 1));
  }

  function call(name, a) {
    stats.calls++;
    if (name === 'ask') return { ok: true, result: ask(a) };
    if (name === 'lane') {
      const l = scan(a.kind, (e) => e.by === a.writer && (!a.from || e.at >= a.from) && (!a.to || e.at <= a.to));
      return { ok: true, result: { total: l.length, shown: l.slice(-PAGE).map(ex), coverage: { scanned: entries.length } } };
    }
    if (name === 'range') {
      const l = scan(a.kind, (e) => e.at >= a.from && e.at <= a.to);
      const r = { total: l.length, shown: l.slice(-PAGE * 2).map(ex), coverage: { scanned: entries.length } };
      if (T) r.next_look = [];
      return { ok: true, result: r };
    }
    if (name === 'read') {
      const e = entries.find((x) => x.id.startsWith(String(a.id || '')));
      stats.bytes_read += e ? bytes(e) : 0; stats.entries_parsed += e ? 1 : 0;
      return e ? { ok: true, result: { shown: [ex(e)] } } : { ok: false, error: 'no such id' };
    }
    if (name === 'schema' && G) {
      readSchemaCost(a.kind);
      return { ok: true, result: { ground: groundFor(a.kind) } };
    }
    return { ok: false, error: 'unknown tool ' + name };
  }

  return {
    tools, call, reset,
    stats: () => ({ ...stats }),
    dump: () => entries.map((e) => JSON.stringify({ id: e.id, addr: e.addr, kind: e.kind, by: e.by, at: e.at, of: e.of, body: e.body })).join('\n'),
    ids: () => new Set(entries.map((e) => e.id)),
    addresses: () => [...byAddr.keys()].filter((a) => !a.startsWith('schema:')),
  };
}
