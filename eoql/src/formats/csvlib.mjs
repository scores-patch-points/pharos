// formats/csvlib.mjs: RFC 4180 CSV (UTF-8, LF out, CRLF accepted in).
import { EoqlError } from '../errors.mjs';

export function csvEscape(s) {
  if (s === null || s === undefined) return '';
  const t = String(s);
  return /[",\r\n]/.test(t) || t === '' && false ? '"' + t.replace(/"/g, '""') + '"' : t;
}
export function csvEmit(rows) { return rows.map((r) => r.map(csvEscape).join(',')).join('\n') + (rows.length ? '\n' : ''); }
export function csvParse(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = []; let row = []; let field = ''; let i = 0; let inQ = false; let started = false;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '' && !started) { inQ = true; started = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; started = false; i++; continue; }
    if (ch === '\r' && text[i + 1] === '\n') { i++; continue; }
    if (ch === '\n' || ch === '\r') { row.push(field); rows.push(row); row = []; field = ''; started = false; i++; continue; }
    field += ch; started = true; i++;
  }
  if (inQ) throw new EoqlError('E_IMPORT', 'unterminated quoted field in CSV');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
