// core.mjs: entry format (UNCHANGED from the frozen library), validation, and the protocol's own names.
// Canonical JSON and `id = sha256(canonical entry without id)` are copied exactly from baseline/pharos.mjs.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export class PlacedError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'PlacedError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

// The protocol's own kind names (a closed set, as in the frozen library). They are NOT placement logic:
// placement.mjs never sees them. The two exempt kinds are always placed by address, because schemas and
// retractions have to be findable before anything can say how to read.
export const SCHEMA_KIND = 'schema';
export const SCHEMA_ADDR = 'schema:';
export const RETRACT_KIND = 'retract';
export const BOOT = { frame: 'NUL·Ground', kind: 'DEF·Figure', holon: 'DEF·Pattern', retract: 'NUL·Figure' };
export const isExemptKind = (k) => k === SCHEMA_KIND || k === RETRACT_KIND;

// ---- cells ------------------------------------------------------------------------------------------------
function loadCells() {
  for (const p of [path.join(HERE, 'cells.json'), path.join(HERE, '..', 'baseline', 'cells.json')]) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (err) { /* try next */ }
  }
  throw new PlacedError('NO_CELLS', 'cells.json not found beside src/ or in baseline/');
}
export const CELLS = loadCells();
export const RANK = new Map(CELLS.cells.map((c) => [c.id, c.rank]));

// ---- canonical JSON and ids (identical to the frozen library) ---------------------------------------------
export function canonical(v) {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'string': return JSON.stringify(v);
    case 'boolean': return v ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(v)) throw new PlacedError('BAD_JSON', 'non-finite number in entry');
      return JSON.stringify(v);
    case 'object': {
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) if (!(i in v)) throw new PlacedError('BAD_JSON', `sparse array hole at ${i}`);
        return '[' + v.map(canonical).join(',') + ']';
      }
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw new PlacedError('BAD_JSON', 'only plain objects are JSON (no Date, Map, Set, class instances)');
      return '{' + Object.keys(v).sort().map((k) => {
        if (v[k] === undefined) throw new PlacedError('BAD_JSON', `undefined value at key ${k}`);
        return JSON.stringify(k) + ':' + canonical(v[k]);
      }).join(',') + '}';
    }
    default:
      throw new PlacedError('BAD_JSON', `value of type ${typeof v} is not JSON`);
  }
}

export function entryId(entry) {
  const { id, ...rest } = entry; // eslint-disable-line no-unused-vars
  return crypto.createHash('sha256').update(canonical(rest)).digest('hex');
}

export const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
export const isStrArr = (x) => Array.isArray(x) && x.every((s) => typeof s === 'string');

// Same checks as the frozen reader's `invalid` (returns the reason, or null when the entry is well formed).
export function invalid(e) {
  try {
    if (!isObj(e)) return 'not an object';
    if (e.v !== 1) return 'bad version';
    for (const k of ['cell', 'kind', 'addr', 'by', 'at', 'id']) if (typeof e[k] !== 'string') return `bad ${k}`;
    if (!RANK.has(e.cell)) return 'unknown cell';
    if (!isStrArr(e.of) || !isStrArr(e.seen)) return 'bad of/seen';
    if (!isObj(e.basis) || !('body' in e)) return 'bad basis/body';
    if (entryId(e) !== e.id) return 'id does not match content';
  } catch (err) {
    return 'bad json value';
  }
  return null;
}

// Canonical lines start `{"addr":"<json string>",` (keys are sorted and `addr` sorts first). Reading that
// prefix lets a region skip every line of another address without parsing it. Returns the decoded address,
// or null when the line is not in that shape (the caller then parses it).
export function quickAddr(line) {
  if (!line.startsWith('{"addr":"')) return null;
  let i = 9;
  for (;;) {
    const q = line.indexOf('"', i);
    if (q < 0) return null;
    let bs = 0;
    for (let j = q - 1; j >= 9 && line.charCodeAt(j) === 92; j--) bs++;
    if (bs % 2 === 0) {
      const raw = line.slice(8, q + 1);
      if (line.charCodeAt(q + 1) !== 44) return null; // expect `,` after the address
      if (raw.indexOf('\\') < 0) return raw.slice(1, -1);
      try { return JSON.parse(raw); } catch (err) { return null; }
    }
    i = q + 1;
  }
}

// The entry id of a canonical line without parsing it: the top-level `"id"` is the last `","id":"` before
// kind/of/seen/v, none of which can contain an unescaped quote pair of that shape. Falls back to null.
export function quickId(line) {
  const k = line.lastIndexOf('","id":"');
  if (k < 0) return null;
  const id = line.slice(k + 8, k + 72);
  if (line.charCodeAt(k + 72) !== 34 || !/^[0-9a-f]{64}$/.test(id)) return null;
  return id;
}
