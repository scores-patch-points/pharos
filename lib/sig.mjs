// sig: every read is a fold; a fold may carry a DERIVED shortcut. See docs/PROPOSAL-SIG-FOLD.md. Node built-ins only.
// Everything here is derived and deletable: the reference fold is always the answer of record, a shortcut is used only after it
// has been identical to the reference on held-in probes and cheaper, and one mismatch demotes it. PHAROS_NO_SIG=1 removes every
// shortcut and memo: the law is that this changes no answer.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { heads, askHeads } from './pharos.mjs';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const logFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl') || f.endsWith('.phb')).sort() : []);
/** POSITION: a hash of the writer files' names and sizes. Anything derived is valid only at the exact position it was computed at. */
export const position = (dir) => sha(logFiles(dir).map((f) => `${f}:${fs.statSync(path.join(dir, f)).size}`).join('\n'));

export const PROBE_FIRST = 6, PROBE_SHARE = 0.05, MARGIN = 0.7;
const off = () => !!process.env.PHAROS_NO_SIG;
const now = () => performance.now();

/** A fold: `reference(source, params)` always correct; optional `shortcut(source, params)` derived; `same(a, b)` says when two answers are equal;
 *  `position(source)` keys the memo (default: the log's position, for a source that is a pharos handle). */
export class Fold {
  constructor({ name, reference, shortcut = null, same = (a, b) => JSON.stringify(a) === JSON.stringify(b), position: pos = (h) => position(h.dir), onMark = null }) {
    Object.assign(this, { name, reference, shortcut, same, pos, onMark });
    this.memo = new Map();
    this.stats = { calls: 0, memoHits: 0, probes: 0, mismatches: 0, shortcutUsed: 0, refMs: 0, refN: 0, shortMs: 0, shortN: 0, probeMs: 0, demoted: false, promoted: false };
  }
  mark(m) { this.onMark?.({ fold: this.name, ...m }); }
  run(source, params = {}) {
    const S = this.stats; S.calls++;
    const timeRef = () => { const t = now(), v = this.reference(source, params); S.refMs += now() - t; S.refN++; return v; };
    if (off()) return timeRef();
    const key = `${this.pos(source)}|${JSON.stringify(params)}`;           // a memo holds for the reference too: valid only at this exact position
    if (this.memo.has(key)) { S.memoHits++; return this.memo.get(key); }
    const store = (v) => { this.memo.set(key, v); return v; };
    if (!this.shortcut || S.demoted) return store(timeRef());
    const timeShort = () => { const t = now(), v = this.shortcut(source, params); S.shortMs += now() - t; S.shortN++; return v; };
    // not yet promoted: run both, return the REFERENCE, and learn from the pair
    if (!S.promoted) {
      const r = timeRef(), s = timeShort(); S.probes++;
      if (!this.same(s, r)) { S.mismatches++; S.demoted = true; this.mark({ event: 'demoted', why: 'shortcut differed from the reference', probes: S.probes }); return r; }
      if (S.probes >= PROBE_FIRST) {
        const cheaper = S.shortMs / S.shortN < MARGIN * (S.refMs / S.refN);
        if (cheaper) { S.promoted = true; this.mark({ event: 'promoted', probes: S.probes, shortcutMs: S.shortMs / S.shortN, referenceMs: S.refMs / S.refN }); }
        else { S.demoted = true; this.mark({ event: 'demoted', why: 'not cheaper than the reference', probes: S.probes }); }
      }
      return store(r);
    }
    const s = timeShort(); S.shortcutUsed++;
    // promoted: keep probing, but only so much that the probes cost at most PROBE_SHARE of the fold's time (a reference 100x the shortcut is probed rarely)
    if (S.probeMs <= PROBE_SHARE * (S.shortMs + S.probeMs)) {
      const t = now(), r = this.reference(source, params); S.probeMs += now() - t; S.probes++;
      if (!this.same(s, r)) { S.mismatches++; S.demoted = true; this.mark({ event: 'demoted', why: 'shortcut differed from the reference after promotion', probes: S.probes }); return r; }
    }
    return store(s);
  }
}

/** TAIL: reads only the bytes appended to the JSONL writer files since the last advance; rebuilds (calls `reset`) if a file shrank or its checked bytes changed.
 *  (PHB files carry a position, so a memo works, but their tail is read by phbRecords from an offset: not done here.) */
export class Tail {
  constructor(dir, { onLine, reset }) { Object.assign(this, { dir, onLine, reset }); this.files = new Map(); }
  advance() {
    let scanned = 0;
    for (const f of logFiles(this.dir).filter((x) => x.endsWith('.jsonl'))) {
      const abs = path.join(this.dir, f), size = fs.statSync(abs).size, st = this.files.get(f) ?? { off: 0, tail: '' };
      this.files.set(f, st); if (size === st.off) continue;
      const fd = fs.openSync(abs, 'r');
      try {
        if (size < st.off) { fs.closeSync(fd); return this.rebuild(); }
        if (st.off > 0) { const n = Math.min(32, st.off), chk = Buffer.alloc(n); fs.readSync(fd, chk, 0, n, st.off - n); if (sha(chk) !== st.tail) { fs.closeSync(fd); return this.rebuild(); } }
        const buf = Buffer.alloc(size - st.off); fs.readSync(fd, buf, 0, buf.length, st.off); scanned += buf.length;
        const last = buf.lastIndexOf(10); if (last < 0) continue;                       // only a torn partial line so far
        let start = 0; while (start <= last) { const nl = buf.indexOf(10, start); if (nl > start) this.onLine(buf.subarray(start, nl).toString('utf8'), f, st.off + start, nl - start); start = nl + 1; }
        const newOff = st.off + last + 1, n = Math.min(32, newOff), chk = Buffer.alloc(n); fs.readSync(fd, chk, 0, n, newOff - n); st.off = newOff; st.tail = sha(chk);
      } finally { try { fs.closeSync(fd); } catch { /* closed */ } }
    }
    return { scanned };
  }
  rebuild() { this.files = new Map(); this.reset(); this.rebuilds = (this.rebuilds ?? 0) + 1; return this.advance(); }
}

// the registry: a fold is declared once and read by name from any repo
const REGISTRY = new Map();
export const registerFold = (spec) => { const f = spec instanceof Fold ? spec : new Fold(spec); REGISTRY.set(f.name, f); return f; };
export const getFold = (name) => { const f = REGISTRY.get(name); if (!f) throw new Error(`no fold named ${name} (typed gap: register it with registerFold)`); return f; };
export const runFold = (name, source, params) => getFold(name).run(source, params);
export const foldStatus = () => Object.fromEntries([...REGISTRY].map(([k, f]) => [k, { ...f.stats }]));

// the first registered fold: heads at an address, reference = the full view, shortcut = askHeads (the backward reader that stops on proof)
registerFold({ name: 'heads', reference: (h, { addr, cell }) => heads(h, addr, cell), shortcut: (h, { addr, cell }) => askHeads(h, addr, cell).heads, same: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
