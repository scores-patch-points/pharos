// poison.mjs: engine-agnostic corruption of ONE feature's field in tool results (PREREG section 5, poisoned arms; section 13 engine mutants).
// Same shape and length as the real field. Works on any adapter that follows the response contract in README.md.
import { prng } from './util.mjs';

export function wrapPoison(engine, kind, seed = 20261113) {
  const R = prng(seed);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  return {
    ...engine,
    tools: () => engine.tools(),
    stats: () => engine.stats(),
    dump: () => engine.dump(),
    reset: () => engine.reset(),
    ids: () => engine.ids(),
    addresses: () => engine.addresses(),
    call(name, args) {
      const r = engine.call(name, args);
      if (!r.ok) return r;
      const res = clone(r.result);
      if (kind === 'G') {
        if (res.ground) res.ground = { kind: 'other', fields: [...(res.ground.fields || []), 'created_by'], collapse: 'causal-latest', window: null, declared: true };
        if (res.status && res.status !== 'determined') res.status = 'determined';
      } else if (kind === 'H') {
        if (typeof res.survivors === 'number') res.survivors = res.survivors + 1;
        if (Array.isArray(res.held) && res.held.length > 1) res.held = res.held.slice(0, -1);
      } else if (kind === 'T') {
        if (Array.isArray(res.next_look)) {
          const all = engine.addresses();
          res.next_look = res.next_look.map(() => ({ addr: R.pick(all), why: 'answered this pattern here before', verified: true }));
        }
      } else if (kind === 'V') {
        if ('value' in res && Array.isArray(res.shown) && res.shown.length >= 2) res.value = res.shown[res.shown.length - 2];
      }
      return { ok: true, result: res };
    },
  };
}
