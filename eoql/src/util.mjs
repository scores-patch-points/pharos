// util.mjs: canonical JSON (identical to the frozen library's), hashing, small helpers.
import crypto from 'node:crypto';
import { EoqlError } from './errors.mjs';

export function canonical(v) {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'string': return JSON.stringify(v);
    case 'boolean': return v ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(v)) throw new EoqlError('E_TYPE', 'non-finite number');
      return JSON.stringify(v);
    case 'object': {
      if (Array.isArray(v)) {
        let s = '[';
        for (let i = 0; i < v.length; i++) { if (!(i in v)) throw new EoqlError('E_TYPE', 'sparse array'); s += (i ? ',' : '') + canonical(v[i]); }
        return s + ']';
      }
      if (typeof v.toJSON === 'function') return canonical(v.toJSON());
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw new EoqlError('E_TYPE', 'only plain objects are JSON');
      const ks = Object.keys(v).sort();
      let s = '{';
      for (let i = 0; i < ks.length; i++) {
        const k = ks[i];
        if (v[k] === undefined) throw new EoqlError('E_TYPE', `undefined value at key ${k}`);
        s += (i ? ',' : '') + JSON.stringify(k) + ':' + canonical(v[k]);
      }
      return s + '}';
    }
    default: throw new EoqlError('E_TYPE', `value of type ${typeof v} is not JSON`);
  }
}
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export function entryId(entry) { const { id, ...rest } = entry; return sha256(canonical(rest)); } // eslint-disable-line no-unused-vars
export const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
export const isStrArr = (x) => Array.isArray(x) && x.every((s) => typeof s === 'string');
export const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const idsDigest = (ids) => sha256([...ids].sort().join('\n'));
export function bcmp(a, b) { // byte-wise UTF-8 comparison
  if (a === b) return 0;
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
export const hasNonAscii = (s) => /[^\x00-\x7f]/.test(s);
// text compare: UTF-8 bytewise; for ASCII-only, plain code unit compare is identical and cheaper
export function tcmp(a, b) { if (a === b) return 0; if (!hasNonAscii(a) && !hasNonAscii(b)) return a < b ? -1 : 1; return bcmp(a, b); }
export function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; }
export const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
