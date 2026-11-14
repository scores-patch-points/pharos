// arms.mjs: arm names and feature flags (PREREG section 5). Data only.

export const FACTORIAL = ['P000', 'P100', 'P010', 'P001', 'P110', 'P101', 'P011', 'P111']; // order of digits: G H T

export function parseArm(name) {
  const m = /^P([01])([01])([01])$/.exec(name);
  if (m) return { name, kind: 'pointer', features: { G: +m[1], H: +m[2], T: +m[3] } };
  if (name === 'F') return { name, kind: 'full', features: { G: 0, H: 0, T: 0 } };
  if (name === 'CB') return { name, kind: 'closed-book', features: { G: 0, H: 0, T: 0 } };
  const x = /^X-([GHTV])$/.exec(name);
  // poisoned arms: G, H, T corrupt the field of the full arm (base P111); V corrupts the collapsed value of the bare arm (base P000)
  if (x) return { name, kind: 'pointer', features: x[1] === 'V' ? { G: 0, H: 0, T: 0 } : { G: 1, H: 1, T: 1 }, poison: x[1], base: x[1] === 'V' ? 'P000' : 'P111' };
  throw new Error('unknown arm ' + name);
}

// ladders (PREREG section 5, stage B): each step adds one capability; the engine adapter reads `level`.
export const LADDERS = {
  G: ['G0 none', 'G1 kinds and fields only', 'G2 + collapse rule and window', 'G3 + explicit no-ground/ruled-out/incomplete statuses'],
  H: ['H0 collapsed value', 'H1 held set without count', 'H2 held set with count', 'H3 + retraction marks and conflict episodes'],
  T: ['T0 none', 'T1 hints unverified', 'T2 hints verified by rehash', 'T3 + reinforcement counts', 'T4 + DMD evaporation (A8)'],
};

// the four settings of the other two features, for the main-effect contrast (A1 item 3)
export function others(f) {
  const rest = ['G', 'H', 'T'].filter((x) => x !== f);
  const out = [];
  for (const a of [0, 1]) for (const b of [0, 1]) out.push({ [rest[0]]: a, [rest[1]]: b });
  return out;
}
export function armName({ G, H, T }) { return `P${G}${H}${T}`; }
