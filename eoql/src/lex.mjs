// lex.mjs: the tokenizer (SPEC 2.1). Total: returns tokens or throws EoqlError with a position.
import { EoqlError } from './errors.mjs';

export const LIMITS = Object.freeze({ chars: 65536, tokens: 20000, depth: 64, steps: 400000 });
export const GLYPH_VERB = { '∅': 'NUL', '○': 'SIG', '●': 'INS', '｜': 'SEG', '⋈': 'CON', '⤫': 'CON', '△': 'SYN', '⊢': 'DEF', '⊨': 'EVA', '◉': 'REC', '⊛': 'REC' };
const isIdStart = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const isDigit = (c) => c >= 48 && c <= 57;
const isIdChar = (c) => isIdStart(c) || isDigit(c);
const SYMS3 = [];
const SYMS2 = ['<=', '>=', '<>', '!=', '==', '||'];
const SYM1 = '=<>+-*/%()[]{},;:.$';

// token: { k: 'id'|'qid'|'str'|'num'|'idref'|'label'|'glyph'|'sym'|'eof', v, pos, end, real? }
export function lex(text) {
  if (typeof text !== 'string') throw new EoqlError('E_PARSE', 'script must be a string', { pos: 0 });
  if (text.length > LIMITS.chars) throw new EoqlError('E_LIMIT', `script longer than ${LIMITS.chars} characters`, { pos: LIMITS.chars, detail: { limit: 'chars' } });
  const out = [];
  let i = 0;
  const n = text.length;
  const push = (k, v, pos, end, extra) => {
    if (out.length >= LIMITS.tokens) throw new EoqlError('E_LIMIT', `more than ${LIMITS.tokens} tokens`, { pos, detail: { limit: 'tokens' } });
    out.push({ k, v, pos, end, ...extra });
  };
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13 || c === 0xa0 || c === 0xfeff) { i++; continue; }
    if (c === 45 && text.charCodeAt(i + 1) === 45) { while (i < n && text[i] !== '\n') i++; continue; }
    if (c === 47 && text.charCodeAt(i + 1) === 42) {
      const e = text.indexOf('*/', i + 2);
      if (e < 0) throw new EoqlError('E_PARSE', 'unterminated comment', { pos: i });
      i = e + 2; continue;
    }
    const start = i;
    if (c === 34 || c === 39) { // string
      const q = text[i]; i++;
      let s = '';
      for (;;) {
        if (i >= n) throw new EoqlError('E_PARSE', 'unterminated string', { pos: start });
        const ch = text[i];
        if (ch === q) { if (text[i + 1] === q) { s += q; i += 2; continue; } i++; break; }
        if (ch === '\\') {
          const e = text[i + 1];
          if (e === undefined) throw new EoqlError('E_PARSE', 'unterminated string', { pos: start });
          if (e === 'u') {
            const hex = text.slice(i + 2, i + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new EoqlError('E_PARSE', 'bad \\u escape', { pos: i });
            s += String.fromCharCode(parseInt(hex, 16)); i += 6; continue;
          }
          const map = { '"': '"', "'": "'", '\\': '\\', n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '/': '/' };
          if (!(e in map)) throw new EoqlError('E_PARSE', `bad escape \\${e}`, { pos: i });
          s += map[e]; i += 2; continue;
        }
        s += ch; i++;
      }
      push('str', s, start, i); continue;
    }
    if (c === 96) { // backtick identifier
      i++; let s = '';
      for (;;) {
        if (i >= n) throw new EoqlError('E_PARSE', 'unterminated quoted identifier', { pos: start });
        if (text[i] === '`') { if (text[i + 1] === '`') { s += '`'; i += 2; continue; } i++; break; }
        s += text[i++];
      }
      if (!s) throw new EoqlError('E_PARSE', 'empty quoted identifier', { pos: start });
      push('qid', s, start, i); continue;
    }
    if (isDigit(c)) {
      let j = i; while (j < n && isDigit(text.charCodeAt(j))) j++;
      let real = false;
      if (text[j] === '.' && isDigit(text.charCodeAt(j + 1))) { real = true; j++; while (j < n && isDigit(text.charCodeAt(j))) j++; }
      if ((text[j] === 'e' || text[j] === 'E')) {
        let k = j + 1; if (text[k] === '+' || text[k] === '-') k++;
        if (isDigit(text.charCodeAt(k))) { real = true; while (k < n && isDigit(text.charCodeAt(k))) k++; j = k; }
      }
      const v = Number(text.slice(i, j));
      if (!Number.isFinite(v)) throw new EoqlError('E_PARSE', 'number out of range', { pos: i });
      push('num', v, i, j, { real }); i = j; continue;
    }
    if (isIdStart(c)) {
      let j = i + 1; while (j < n && isIdChar(text.charCodeAt(j))) j++;
      let word = text.slice(i, j);
      if (word === 'live' && text.startsWith('-heads', j) && !isIdChar(text.charCodeAt(j + 6))) { word = 'live-heads'; j += 6; }
      push('id', word, i, j); i = j; continue;
    }
    if (c === 35) { // #idref
      let j = i + 1; while (j < n && /[0-9a-f]/.test(text[j])) j++;
      const len = j - i - 1;
      if (len < 8 || len > 64 || (j < n && isIdChar(text.charCodeAt(j)))) throw new EoqlError('E_PARSE', 'bad idref: # needs 8 to 64 lowercase hex digits', { pos: i });
      push('idref', text.slice(i + 1, j), i, j); i = j; continue;
    }
    if (c === 64) { // @label
      if (!isIdStart(text.charCodeAt(i + 1))) throw new EoqlError('E_PARSE', 'bad label: @ needs a name', { pos: i });
      let j = i + 2; while (j < n && isIdChar(text.charCodeAt(j))) j++;
      push('label', text.slice(i + 1, j), i, j); i = j; continue;
    }
    const ch = text[i];
    if (GLYPH_VERB[ch] !== undefined) { push('glyph', ch, i, i + 1); i++; continue; }
    const two = text.slice(i, i + 2);
    if (SYMS2.includes(two)) { push('sym', two, i, i + 2); i += 2; continue; }
    if (SYM1.includes(ch)) { push('sym', ch, i, i + 1); i++; continue; }
    throw new EoqlError('E_PARSE', `unexpected character ${JSON.stringify(ch)}`, { pos: i });
  }
  push('eof', null, n, n);
  return out;
}
export { SYMS3 };
