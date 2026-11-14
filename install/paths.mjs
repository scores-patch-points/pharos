// Tokens ($HOME $TARGET $STATE $KHORA_DIR) and the declared-touches matcher.
import path from 'node:path';

const TOKEN = /^\$(HOME|TARGET|STATE|KHORA_DIR)(?=\/|$)/;

export function resolveToken(p, roots) {
  const m = TOKEN.exec(p);
  if (!m) return null;
  const base = roots[m[1]];
  if (!base) return null;
  return { token: m[1], root: base, abs: path.join(base, p.slice(m[0].length)) };
}

function toRegex(abs) {
  let re = '';
  for (let i = 0; i < abs.length; i++) {
    if (abs.startsWith('/**', i) && i + 3 === abs.length) { re += '(?:/.*)?'; break; }
    if (abs.startsWith('**', i)) { re += '.*'; i++; continue; }
    const c = abs[i];
    re += c === '*' ? '[^/]*' : c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

// patterns: tokenised strings. Returns [{token, root, abs, re}] (patterns whose token is unset are dropped).
export function compilePatterns(patterns, roots) {
  const out = [];
  for (const p of patterns) {
    const r = resolveToken(p, roots);
    if (r) out.push({ ...r, pattern: p, re: toRegex(r.abs) });
  }
  return out;
}

export const matchDeclared = (compiled, abs) => compiled.find((c) => c.re.test(abs)) || null;
