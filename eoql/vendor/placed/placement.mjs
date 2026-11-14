// placement.mjs: pure placement functions. No I/O, no kind names, no reading of the log.
// A placement is a function of (entry, the schema body in force for the entry's kind). The schema body is
// passed in as data; nothing in this file knows which kinds exist or what any of them are for.
import crypto from 'node:crypto';

// Structural constants of the address layout (the spec fixes them: the first byte of sha256(addr) is
// 2 hex chars; a split goes one more byte deeper). The SPLIT LIMIT is not here: it is read from PLACEMENT.json.
export const FIRST_WIDTH = 2;
export const WIDTH_STEP = 2;
export const MAX_WIDTH = 64; // a sha256 in hex

export const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

// hex of sha256(addr): the only thing the default placement looks at.
export const addrHash = (addr) => sha256hex(addr);

// 'ab', 'abcd', 'abcdef', ... : the chain of shard names an address can live in, shallow to deep.
export const addrShardName = (hash, depth) => hash.slice(0, depth);

// A short stable tag naming a kind inside a file name. Collisions only ever cost extra bytes read:
// every line is checked against the kind it is asked for.
export const kindTag = (kind) => sha256hex('kind\u0000' + kind).slice(0, 8);

// ---- placement vocabulary ---------------------------------------------------------------------------------
export const UNITS = ['year', 'month', 'day', 'hour', 'minute', 'second'];
const UNIT_LEN = { year: 4, month: 7, day: 10, hour: 13, minute: 16, second: 19 };
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/;

// bucket of an ISO `at` for a unit, as a compact fixed-width string that sorts chronologically.
// 2026-11-12T17:09:46.850Z, hour -> 20261112T17 ; an `at` that is not ISO goes to the bucket 'x'.
export function bucketOf(at, unit) {
  if (typeof at !== 'string' || !ISO.test(at) || !(unit in UNIT_LEN)) return 'x';
  return at.slice(0, UNIT_LEN[unit]).replace(/[-:]/g, '');
}

// Parse a schema's `read` object into a placement spec, or null when it names nothing this vocabulary has.
//   { placement: 'address' }                      -> { type: 'address' }
//   { placement: 'writer', unit?: 'day' }         -> { type: 'writer', unit|null }
//   { placement: 'time:hour' }                    -> { type: 'time', unit: 'hour' }
export function parsePlacement(read) {
  if (read === null || typeof read !== 'object' || Array.isArray(read)) return null;
  const p = read.placement;
  if (p === undefined) return { type: 'address' };
  if (typeof p !== 'string') return null;
  if (p === 'address') return { type: 'address' };
  if (p === 'writer') {
    if (read.unit === undefined || read.unit === null) return { type: 'writer', unit: null };
    return typeof read.unit === 'string' && read.unit in UNIT_LEN ? { type: 'writer', unit: read.unit } : null;
  }
  if (p.startsWith('time:')) {
    const unit = p.slice(5);
    return unit in UNIT_LEN ? { type: 'time', unit } : null;
  }
  return null;
}

export const DEFAULT_PLACEMENT = Object.freeze({ type: 'address' });

// File name (inside the writer's directory) for the NON-address placements. Address placement is chosen
// by probing sizes against the split limit, so it lives in the writer (placed.mjs), not here.
export function fixedShardName(spec, kind, at) {
  const tag = kindTag(kind);
  if (spec.type === 'writer') return spec.unit ? `w_${tag}.${bucketOf(at, spec.unit)}.jsonl` : `w_${tag}.jsonl`;
  if (spec.type === 'time') return `t_${tag}.${bucketOf(at, spec.unit)}.jsonl`;
  throw new Error(`fixedShardName: ${spec.type} is not a fixed placement`);
}

// Classify a file name found in a writer directory.
//   address shard  <hex>.jsonl            -> { type:'address', depth }
//   writer shard   w_<tag>[.<bucket>].jsonl -> { type:'writer', tag, bucket|null }
//   time shard     t_<tag>.<bucket>.jsonl -> { type:'time', tag, bucket }
//   anything else ending .jsonl           -> { type:'other' }
export function classifyShard(name) {
  if (!name.endsWith('.jsonl')) return null;
  const stem = name.slice(0, -6);
  if (/^[0-9a-f]+$/.test(stem) && stem.length >= FIRST_WIDTH && stem.length <= MAX_WIDTH && stem.length % WIDTH_STEP === 0) {
    return { type: 'address', depth: stem.length, prefix: stem };
  }
  let m = /^w_([0-9a-f]{8})(?:\.([0-9A-Za-z]+))?$/.exec(stem);
  if (m) return { type: 'writer', tag: m[1], bucket: m[2] ?? null };
  m = /^t_([0-9a-f]{8})\.([0-9A-Za-z]+)$/.exec(stem);
  if (m) return { type: 'time', tag: m[1], bucket: m[2] };
  return { type: 'other' };
}

// Position key of an entry: (at, id) compared as strings. Total, local to the entry, independent of arrival order.
export const cmpKey = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
