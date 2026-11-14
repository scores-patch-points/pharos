// globs.mjs: the `*` and `?` address globs of SEG (SPEC 2.4).
export function wildcardGlob(pat) {
  if (!/[*?]/.test(pat)) return (s) => s === pat;
  const p = [...pat]; 
  return (str) => {
    const s = [...str];
    let si = 0, pi = 0, star = -1, mark = 0;
    while (si < s.length) {
      if (pi < p.length && p[pi] === '*') { star = pi++; mark = si; } else if (pi < p.length && (p[pi] === '?' || p[pi] === s[si])) { si++; pi++; } else if (star >= 0) { pi = star + 1; si = ++mark; } else return false;
    }
    while (pi < p.length && p[pi] === '*') pi++;
    return pi === p.length;
  };
}
