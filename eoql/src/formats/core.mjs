// formats/core.mjs: decoded form of a store, inventories and the MEASURED loss manifest (SPEC 6.1, 6.2).
// A Decoded is what a decoder read: per file, the lines in order (entry lines keep their original text; lines that are
// not entries are kept verbatim). The manifest is a diff of two inventories (decode(input), decode(output)), never a
// declaration by an encoder (mutant M7).
import { sha256, canonical, idsDigest, isObj } from '../util.mjs';
import { DEFAULT_FIELDS } from '../jsonl.mjs';
import { EoqlError, VERSION } from '../errors.mjs';

export const FORMATS = ['jsonl', 'blocks', 'lazy', 'sqlite', 'sqldump', 'csv', 'json', 'eot', 'eoql'];
export const PROFILES = {
  jsonl: ['entries'], blocks: ['entries'], lazy: ['entries'], sqlite: ['entries'], sqldump: ['entries', 'derived'],
  csv: ['entries', 'rows'], json: ['entries', 'rows', 'result'], eot: ['entries', 'view'], eoql: ['verbatim', 'semantic'],
};
export const DEFAULT_PROFILE = { jsonl: 'entries', blocks: 'entries', lazy: 'entries', sqlite: 'entries', sqldump: 'entries', csv: 'entries', json: 'entries', eot: 'entries', eoql: 'verbatim' };
export const LOSSY_PROFILES = new Set(['csv:rows', 'json:rows', 'json:result', 'eot:view', 'sqldump:derived', 'eoql:semantic']);
export const ATTRS = ['ids', 'fields', 'extra', 'file', 'order', 'dups', 'invalid', 'text'];

// retention per format (default profile), SPEC 6.2: Y retained, N not retained, R refuses
const Y = 'Y', N = 'N', R = 'R';
const row = (...a) => Object.fromEntries(ATTRS.map((k, i) => [k, a[i]]));
export const RETENTION = {
  jsonl: row(Y, Y, Y, Y, Y, Y, Y, Y),
  blocks: row(Y, Y, Y, Y, Y, N, Y, Y),
  lazy: row(Y, Y, Y, Y, N, Y, Y, Y),
  sqlite: row(Y, Y, R, Y, N, N, N, N),
  sqldump: row(Y, Y, R, Y, N, N, N, N),
  csv: row(Y, Y, R, Y, N, N, N, N),
  json: row(Y, Y, Y, N, N, N, N, N),
  eot: row(Y, Y, R, Y, N, N, N, N),
  eoql: row(Y, Y, Y, N, N, N, N, N),
};
export const lossyKey = (fmt, profile) => `${fmt}:${profile}`;
export const isLossyProfile = (fmt, profile) => LOSSY_PROFILES.has(lossyKey(fmt, profile));

// "fmt[:profile]:location"
export function parseSpec(spec) {
  if (typeof spec !== 'string' || !spec) throw new EoqlError('E_USAGE', 'a format spec is "fmt[:profile]:location"');
  const i = spec.indexOf(':');
  if (i <= 0) throw new EoqlError('E_USAGE', `format spec needs a format and a location: ${spec}`, { detail: { formats: FORMATS } });
  let fmt = spec.slice(0, i); let rest = spec.slice(i + 1);
  if (fmt === 'lib') fmt = 'jsonl';
  if (!FORMATS.includes(fmt)) throw new EoqlError('E_USAGE', `unknown format ${fmt}`, { detail: { formats: FORMATS } });
  let profile = DEFAULT_PROFILE[fmt];
  const j = rest.indexOf(':');
  if (j > 0 && PROFILES[fmt].includes(rest.slice(0, j))) { profile = rest.slice(0, j); rest = rest.slice(j + 1); }
  if (!rest) throw new EoqlError('E_USAGE', `format spec has no location: ${spec}`);
  return { fmt, profile, location: rest };
}

export function mkDecoded(format, profile) {
  return { format, profile, files: new Map(), foreign: null, notes: [], evidence: [], _canonSeen: null };
}
export function addLine(dec, file, line) {
  let a = dec.files.get(file); if (!a) dec.files.set(file, a = []); a.push(line);
}
export const entryLine = (e, text, extra = {}) => { let canon = false; try { canon = canonical(e) === text; } catch (err) { canon = false; } return { type: 'entry', e, text, canon, ...extra }; };
export const invalidLine = (text, reason) => ({ type: 'invalid', text, reason });
export const sortedFiles = (dec) => [...dec.files.keys()].sort();

// distinct entries (first occurrence, files in sorted order): [{e, file, text}]
export function distinctItems(dec) {
  const seen = new Set(); const out = [];
  for (const f of sortedFiles(dec)) for (const l of dec.files.get(f)) if (l.type === 'entry' && !seen.has(l.e.id)) { seen.add(l.e.id); out.push({ e: l.e, file: f, text: l.text }); }
  return out;
}
export const extraKeys = (e) => Object.keys(e).filter((k) => !DEFAULT_FIELDS.has(k));
const defaultFieldsText = (e) => { const o = {}; for (const k of DEFAULT_FIELDS) if (k in e) o[k] = e[k]; return canonical(o); };

export function inventory(dec) {
  const ids = new Map(); // id -> {file, text, canon, extra}
  const seq = new Map(); // file -> [ids in line order, all valid lines]
  const invalidTexts = [];
  let dup = 0, noncanon = 0, extras = 0;
  const dupIds = new Set(); const noncanonIds = new Set();
  const files = {};
  for (const f of sortedFiles(dec)) {
    const arr = []; seq.set(f, arr); let cnt = 0;
    for (const l of dec.files.get(f)) {
      if (l.type === 'invalid') { invalidTexts.push(l.text); continue; }
      cnt++; arr.push(l.e.id);
      if (ids.has(l.e.id)) { dup++; dupIds.add(l.e.id); continue; }
      ids.set(l.e.id, { file: f, text: l.text, canon: l.canon, extra: extraKeys(l.e).length > 0, fields: defaultFieldsText(l.e) });
      if (!l.canon) { noncanon++; noncanonIds.add(l.e.id); }
      if (extraKeys(l.e).length) extras++;
    }
    if (cnt) files[f] = cnt;
  }
  const idList = [...ids.keys()].sort();
  const orderParts = []; for (const f of sortedFiles(dec)) orderParts.push(f + '\n' + seq.get(f).join('\n'));
  const attr = idList.map((i) => i + '\t' + ids.get(i).file).join('\n');
  const inv = {
    entries: idList.length, ids_sha256: idsDigest(idList), files, dup_lines: dup, invalid_lines: invalidTexts.length,
    noncanonical_lines: noncanon, extra_field_entries: extras, line_order_sha256: sha256(orderParts.join('\n\n')), file_attribution_sha256: sha256(attr),
  };
  Object.defineProperty(inv, '_d', { value: { ids, seq, invalidTexts, dupIds, noncanonIds, idList }, enumerable: false });
  return inv;
}
export function emptyInventory() {
  const inv = { entries: 0, ids_sha256: idsDigest([]), files: {}, dup_lines: 0, invalid_lines: 0, noncanonical_lines: 0, extra_field_entries: 0, line_order_sha256: sha256(''), file_attribution_sha256: sha256('') };
  Object.defineProperty(inv, '_d', { value: { ids: new Map(), seq: new Map(), invalidTexts: [], dupIds: new Set(), noncanonIds: new Set(), idList: [] }, enumerable: false });
  return inv;
}

const cap = (a) => a.slice(0, 1000);
// the measured manifest: what is in `a` (input inventory) and not in `b` (output inventory)
export function measureLosses(a, b) {
  const A = a._d, B = b._d; const losses = [];
  const push = (attribute, count, ids, detail) => { if (count > 0) losses.push({ attribute, count, ids: cap(ids), ids_digest: idsDigest(ids), detail }); };
  const missing = A.idList.filter((i) => !B.ids.has(i));
  push('ids', missing.length, missing, 'entry ids present in the input and absent from the output');
  const both = A.idList.filter((i) => B.ids.has(i));
  const fieldsDiff = both.filter((i) => A.ids.get(i).fields !== B.ids.get(i).fields);
  push('fields', fieldsDiff.length, fieldsDiff, 'entries whose default fields differ');
  const extraLost = A.idList.filter((i) => A.ids.get(i).extra && !(B.ids.has(i) && B.ids.get(i).extra));
  push('extra', extraLost.length, extraLost, 'extra (non-default) fields not retained');
  const fileDiff = both.filter((i) => A.ids.get(i).file !== B.ids.get(i).file);
  push('file', fileDiff.length, fileDiff, 'entries whose writer file attribution differs');
  const orderLost = [];
  // order is measured on the global (file, line) sequence of distinct entries
  const seqA = []; const sa = new Set(); for (const [, ids] of A.seq) for (const i of ids) if (!sa.has(i)) { sa.add(i); seqA.push(i); }
  const seqB = []; const sb = new Set(); for (const [, ids] of B.seq) for (const i of ids) if (!sb.has(i)) { sb.add(i); seqB.push(i); }
  const keepB = seqB.filter((i) => sa.has(i));
  // per-file relative order (a store with different file grouping is compared within the input's file groups)
  const posB = new Map(keepB.map((i, k) => [i, k]));
  for (const [, ids] of A.seq) {
    const f = []; const s = new Set(); for (const i of ids) if (posB.has(i) && !s.has(i)) { s.add(i); f.push(i); }
    for (let k = 1; k < f.length; k++) if (posB.get(f[k]) < posB.get(f[k - 1])) { orderLost.push(f[k]); }
  }
  push('order', orderLost.length, orderLost, 'entries that follow, in the output, an entry that came after them in the same input file');
  const dupLost = [...A.dupIds].filter((i) => !B.dupIds.has(i));
  push('dups', Math.max(0, a.dup_lines - b.dup_lines), dupLost, 'duplicate lines (same id twice) not retained');
  // invalid lines: multiset difference by text
  const cnt = new Map(); for (const t of B.invalidTexts) cnt.set(t, (cnt.get(t) || 0) + 1);
  let invLost = 0; const invTexts = [];
  for (const t of A.invalidTexts) { const c = cnt.get(t) || 0; if (c > 0) cnt.set(t, c - 1); else { invLost++; invTexts.push(sha256(t)); } }
  push('invalid', invLost, invTexts, 'lines that are not entries, not retained verbatim (ids are text hashes)');
  const textDiff = both.filter((i) => A.ids.get(i).text !== B.ids.get(i).text);
  push('text', textDiff.length, textDiff, 'non-canonical line text not retained verbatim');
  return losses;
}

export function declaredPossible(fromFmt, fromProfile, toFmt, toProfile) {
  if (isLossyProfile(toFmt, toProfile) || isLossyProfile(fromFmt, fromProfile)) return [...ATTRS];
  const A = RETENTION[fromFmt], B = RETENTION[toFmt];
  return ATTRS.filter((k) => A[k] === Y && B[k] === N);
}

export function mkManifest({ from, to, profileIn, profileOut, invIn, invOut, losses, refused, rejected, declared, entriesOutOverride }) {
  const idsPreserved = invIn.ids_sha256 === invOut.ids_sha256;
  return {
    v: VERSION.manifest, from, to, profile_in: profileIn, profile_out: profileOut,
    entries_in: invIn.entries, entries_out: entriesOutOverride !== undefined ? entriesOutOverride : invOut.entries, ids_preserved: idsPreserved,
    ids_sha256_in: invIn.ids_sha256, ids_sha256_out: invOut.ids_sha256, lossless_ids: idsPreserved,
    lossless_bytes: losses.length === 0 && refused.length === 0 && idsPreserved,
    losses, refused: refused || [], rejected: rejected || [], declared_possible: declared,
  };
}

export const safeFileName = (s) => { let t = String(s).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_'); if (!t) t = '_'; if (t.length > 120) t = t.slice(0, 111) + '_' + sha256(String(s)).slice(0, 8); return t; };
// lanes: which target file each source writer file lands in. Names that collide after `nameFn`, or that differ only in case
// (a case-insensitive filesystem would merge them silently), are MERGED into the first name's lane and reported
// (note `file-merged`); the file attribution that this loses is then measured by the manifest and needs acceptLoss.
export function laneMap(files, nameFn) {
  const map = new Map(); const byKey = new Map(); const notes = [];
  for (const f of files) {
    const n = nameFn(f); const key = n.toLowerCase();
    let lane = byKey.get(key);
    if (lane === undefined) { lane = n; byKey.set(key, n); if (n !== f) notes.push({ code: 'file-renamed', detail: `${f} -> ${n}` }); } else notes.push({ code: 'file-merged', detail: `${f} -> ${lane} (collides with another writer file after renaming or differs only in case)` });
    map.set(f, lane);
  }
  return { map, notes };
}
export const isEntryObj = (x) => isObj(x);

// decoders record what is wrong with a store as evidence; an id that no longer matches its content is TAMPERING and is
// never silently re-hashed: convert and import refuse it (E_ID_MISMATCH) unless acceptLoss, and then name it in the manifest.
export const ID_MISMATCH_REASONS = new Set(['sqlite-id-mismatch', 'sqldump-id-mismatch', 'blocks-id-mismatch']);
export function tamperedIds(dec) { return (dec.evidence || []).filter((x) => ID_MISMATCH_REASONS.has(x.reason)); }
export function refuseTampered(dec, opts) {
  const t = tamperedIds(dec);
  if (t.length && !(opts && opts.acceptLoss)) throw new EoqlError('E_ID_MISMATCH', 'the input holds entries whose stored id does not match their content (tampered or corrupt); nothing was written; pass acceptLoss to re-hash them and name them in the manifest', { detail: { evidence: t } });
}
export function applyEvidence(manifest, dec) {
  const ev = dec.evidence || [];
  if (!ev.length) return manifest;
  manifest.evidence = ev;
  const t = tamperedIds(dec);
  if (t.length) { manifest.tampered = t.flatMap((x) => x.ids || [x.where]).sort(); manifest.lossless_ids = false; manifest.lossless_bytes = false; }
  return manifest;
}
