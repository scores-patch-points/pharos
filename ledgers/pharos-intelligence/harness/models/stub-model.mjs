// stub-model.mjs: scripted, deterministic stand-ins for a model. NOT a language model, never a result about one.
// It reads ONLY what the controller sends (system prompt, messages), like any adapter. It parses the stub question
// templates with regular expressions; the real question set is never parsed this way.
import { sha256, prng } from '../lib/util.mjs';
import { readLog } from '../stub/oracle.mjs';

const T = [
  [/^Which lane first wrote to clip (c\d+)\?$/, 'S-FIRST', (m) => ({ addr: m[1] })],
  [/^Which lane wrote last to clip (c\d+) as of (\S+)\?$/, 'S-LAST-ASOF', (m) => ({ addr: m[1], cut: m[2] })],
  [/^Which lane wrote last to clip (c\d+)\?$/, 'S-LAST', (m) => ({ addr: m[1] })],
  [/^How many different lanes wrote to clip (c\d+)\?$/, 'S-LANES', (m) => ({ addr: m[1] })],
  [/^How many live values does clip (c\d+) hold/, 'S-HELD', (m) => ({ addr: m[1] })],
  [/^Which lane created clip (c\d+)\?$/, 'S-CREATOR', (m) => ({ addr: m[1] })],
  [/^Which lane last wrote gizmo (g\d+)\?$/, 'S-GIZMO', (m) => ({ addr: m[1] })],
  [/^Was any lease active at (\S+)\?$/, 'S-INFLIGHT', (m) => ({ t: m[1] })],
  [/^What is the text of statement (s\d+)\?$/, 'S-SAY', (m) => ({ addr: m[1] })],
  [/^What is the attribution status of statement (s\d+) as of (\S+)\?$/, 'S-BASIS-ASOF', (m) => ({ addr: m[1], cut: m[2] })],
  [/^What is the attribution status of statement (s\d+)\?$/, 'S-BASIS', (m) => ({ addr: m[1] })],
];
export function parseStubQuestion(text) {
  for (const [re, family, f] of T) { const m = re.exec(text); if (m) return { family, ...f(m) }; }
  return null;
}

const key = (e) => e.at + '|' + e.id;
const nonRetract = (l) => (l || []).filter((e) => e.kind !== 'retract');
const latestOf = (l) => nonRetract(l).sort((a, b) => (key(a) < key(b) ? -1 : 1)).slice(-1)[0];
const FINAL = (status, answer, cite = []) => JSON.stringify({ final: { status, answer, cite: cite.map((c) => String(c).slice(0, 12)) } });
const TOOL = (tool, args) => JSON.stringify({ tool, args });
const minus = (t, min) => new Date(Date.parse(t) - min * 60000).toISOString();

// policy: 'lazy' | 'diligent' | 'copy' | 'random' | 'unknown' | 'closedbook' | 'reader'
// onEmpty: 'unknown' | 'guess' (what to do when a tool returns nothing)
export function makeStubModel({ policy = 'lazy', name, ctx_tokens = 8000, onEmpty, glitch = 0 } = {}) {
  const onEmptyEff = onEmpty || (policy === 'copy' ? 'guess' : 'unknown');
  const describe = () => ({ name: name || `stub-${policy}`, digest: 'stub', ctx_tokens, params: null, class: 'stub' });

  async function complete({ messages }) {
    const first = messages[1].content;
    const qline = /^QUESTION: (.*)$/m.exec(first)?.[1] || '';
    const fmt = /^ANSWER FORMAT: (.*)$/m.exec(first)?.[1] || '';
    const hasSchema = /^- schema /m.test(first);
    const rawResults = messages.filter((m, i) => i > 1 && m.role === 'user' && m.content.startsWith('RESULT: ')).map((m) => {
      try { return JSON.parse(m.content.slice(8)); } catch { return { __cut: true }; }
    });
    // the controller replaces an entry already shown in this question by {id, seen: true}; a reader looks the entry up again
    const known = new Map();
    const learn = (n) => { if (Array.isArray(n)) n.forEach(learn); else if (n && typeof n === 'object') { if (n.id && n.body && !n.seen) known.set(n.id.slice(0, 12), n); Object.values(n).forEach(learn); } };
    rawResults.forEach(learn);
    const deref = (n) => (Array.isArray(n) ? n.map(deref) : n && typeof n === 'object' ? (n.seen && n.id && known.get(n.id.slice(0, 12))) || Object.fromEntries(Object.entries(n).map(([k, v]) => [k, deref(v)])) : n);
    const results = rawResults.map(deref);
    const reprompted = messages.some((m) => m.content.startsWith('Your reply was not'));
    if (glitch && !reprompted && parseInt(sha256(qline).slice(0, 4), 16) % glitch === 0) return { text: 'I believe the answer is lane-a.' };
    const q = parseStubQuestion(qline);
    const guessOf = () => (/lane name/.test(fmt) ? 'lane-a' : /integer/.test(fmt) ? 1 : /true or false/.test(fmt) ? false : /attributed or not-established/.test(fmt) ? 'attributed' : 'x');

    if (policy === 'unknown') return { text: FINAL('unknown', null) };
    if (policy === 'closedbook') return { text: FINAL('answer', guessOf()) };
    if (policy === 'random') {
      const R = prng(parseInt(sha256(qline).slice(0, 8), 16));
      const a = /lane name/.test(fmt) ? R.pick(['lane-a', 'lane-b', 'lane-c', 'lane-d']) : /integer/.test(fmt) ? R.int(5) : /true or false/.test(fmt) ? R() < 0.5 : /attributed or not-established/.test(fmt) ? R.pick(['attributed', 'not-established']) : 'x';
      return { text: FINAL('answer', a) };
    }
    if (!q) return { text: FINAL('unknown', null) };
    if (policy === 'reader') {
      // stands in for a model that has the whole log in its prompt (control P3): reads the dump lines
      const lines = first.split('\nLOG:\n')[1]?.split('\n').filter(Boolean).map((l) => JSON.parse(l)) || [];
      const t = readLog(q, lines);
      return { text: t.status === 'UNKNOWN_BY_DATA' ? FINAL('unknown', null, t.cite) : FINAL('answer', t.status === 'HELD' ? t.survivors : t.answer, t.cite) };
    }

    const r = results[results.length - 1];
    const step = results.length;
    const empty = (x) => !x || x.__cut || x.error || ((x.total === 0 || x.total === undefined) && !(x.shown && x.shown.length) && x.status !== 'no-ground');
    const nothing = () => (onEmptyEff === 'guess' ? FINAL('answer', guessOf()) : FINAL('unknown', null));
    const ground = policy !== 'copy';           // copy ignores ground/status
    const lane = (e) => FINAL('answer', e.by, [e.id]);

    switch (q.family) {
      case 'S-FIRST':
        if (step === 0) return { text: TOOL('ask', { addr: q.addr, order: 'oldest' }) };
        if (empty(r)) return { text: nothing() };
        return { text: lane(nonRetract(r.shown)[0]) };
      case 'S-LAST': case 'S-LAST-ASOF':
        if (step === 0) return { text: TOOL('ask', q.cut ? { addr: q.addr, cut: q.cut } : { addr: q.addr }) };
        if (empty(r)) return { text: nothing() };
        return { text: lane(r.value && r.value.id ? r.value : latestOf(r.shown)) };
      case 'S-LANES': {
        if (step === 0) return { text: TOOL('ask', { addr: q.addr, order: 'oldest' }) };
        if (empty(r)) return { text: nothing() };
        if (step === 1 && results[0].total > results[0].shown.length) return { text: TOOL('ask', { addr: q.addr }) };
        const lanes = new Set(results.flatMap((x) => nonRetract(x.shown).map((e) => e.by)));
        return { text: FINAL('answer', lanes.size, nonRetract(results[0].shown).slice(0, 1).map((e) => e.id)) };
      }
      case 'S-HELD': {
        if (step === 0) return { text: TOOL('ask', { addr: q.addr }) };
        if (empty(r)) return { text: nothing() };
        const cite = nonRetract(results[0].shown).slice(-1).map((e) => e.id);
        if (typeof results[0].survivors === 'number') return { text: FINAL('answer', results[0].survivors, (results[0].held || []).map((e) => e.id)) };
        if (policy !== 'diligent') return { text: FINAL('answer', 1, cite) };   // takes the collapsed value at face value
        if (step === 1 && results[0].total > results[0].shown.length) return { text: TOOL('ask', { addr: q.addr, order: 'oldest' }) };
        const all = new Map(results.flatMap((x) => nonRetract(x.shown)).map((e) => [e.id, e]));
        const refd = new Set([...all.values()].flatMap((e) => e.of));
        const heads = [...all.values()].filter((e) => !refd.has(e.id.slice(0, 12)));
        return { text: FINAL('answer', heads.length, heads.map((e) => e.id)) };
      }
      case 'S-CREATOR': {
        if (step === 0) return { text: TOOL('ask', { addr: q.addr }) };
        if (empty(r)) return { text: nothing() };
        if (ground && r.ground && !r.ground.fields.includes('created_by')) return { text: FINAL('unknown', null, nonRetract(r.shown).slice(-1).map((e) => e.id)) };
        if (step === 1) return { text: TOOL('ask', { addr: q.addr, order: 'oldest' }) };
        return { text: lane(nonRetract(results[1].shown)[0]) };   // reads the first writer as the creator
      }
      case 'S-GIZMO':
        if (step === 0) return { text: TOOL('ask', { addr: q.addr }) };
        if (ground && r && r.status === 'no-ground') return { text: FINAL('unknown', null, (r.diagnosis?.ids || []).slice(0, 1)) };
        if (empty(r)) return { text: nothing() };
        return { text: r.value && r.value.id ? lane(r.value) : (nonRetract(r.shown).length ? lane(latestOf(r.shown)) : nothing()) };
      case 'S-INFLIGHT': {
        const from = minus(q.t, 150);
        if (step === 0) return { text: TOOL('range', { kind: 'permit-granted', from, to: q.t }) };
        if (step === 1) return { text: TOOL('range', { kind: 'permit-released', from, to: q.t }) };
        const [g, rel] = results;
        const released = new Set((rel.shown || []).map((e) => e.of[0]));
        const grants = (g.shown || []).filter((e) => e.at <= q.t);
        const active = grants.filter((e) => !released.has(e.id.slice(0, 12)) && q.t < e.body.expires);
        if (!g.coverage || !rel.coverage) return { text: nothing() };   // no sign that the scan covered anything: cannot tell none from blind
        const cite = active.length ? [active[0].id] : grants.slice(-1).map((e) => e.id);
        return { text: FINAL('answer', active.length > 0, cite) };
      }
      case 'S-SAY':
        if (step === 0) return { text: TOOL('ask', { addr: q.addr, kind: 'stmt' }) };
        if (empty(r)) return { text: nothing() };
        return { text: FINAL('answer', nonRetract(r.shown)[0].body.text, [nonRetract(r.shown)[0].id]) };
      case 'S-BASIS': case 'S-BASIS-ASOF': {
        if (step === 0) return { text: TOOL('ask', q.cut ? { addr: q.addr, kind: 'verdict', cut: q.cut } : { addr: q.addr, kind: 'verdict' }) };
        if (empty(r)) return { text: nothing() };
        const e = r.value && r.value.id ? r.value : latestOf(r.shown);
        return { text: FINAL('answer', e.body.status, [e.id]) };
      }
      default: return { text: FINAL('unknown', null) };
    }
  }
  return { describe, complete };
}
