// util.mjs: hashing, canonical JSON, a seeded PRNG, secret redaction. Node built-ins only.
import crypto from 'node:crypto';

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

// mulberry32: a small seeded PRNG. The ONLY source of randomness in this harness (mutant H9 replaces it).
export function prng(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.int = (n) => Math.floor(f() * n);
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.shuffle = (arr) => {
    const o = arr.slice();
    for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
    return o;
  };
  return f;
}

// Redaction: anything that looks like a secret is replaced before it reaches a trace or a result file.
// Patterns are deliberately broad (bearer tokens, sk-style keys, long hex/base64 after key=, env values named *KEY/*TOKEN/*SECRET).
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\b(?:api[_-]?key|token|secret|authorization)\s*[:=]\s*["']?[A-Za-z0-9._~+\/=-]{8,}/gi,
  /\bBearer\s+[A-Za-z0-9._~+\/=-]{8,}/g,
];
export function redact(text, extraSecrets = []) {
  let s = String(text);
  for (const p of SECRET_PATTERNS) s = s.replace(p, '[REDACTED]');
  for (const x of extraSecrets) if (x && x.length >= 6) s = s.split(x).join('[REDACTED]');
  return s;
}
// Values of environment variables whose NAME says secret. Used only to scrub; never printed or logged.
export function envSecrets(env = process.env) {
  return Object.entries(env).filter(([k, v]) => /(KEY|TOKEN|SECRET|PASSWORD)/i.test(k) && v && v.length >= 6).map(([, v]) => v);
}

export const median = (xs) => {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
