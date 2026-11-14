// formats/eot.mjs: the EOT text notation, profile `entries` (lossless for default fields) and profile `view` (SPEC 6.3).
import { canonical, entryId } from '../util.mjs';
import { EoqlError } from '../errors.mjs';
import { invalidReason } from '../jsonl.mjs';
import { CELL_OP, CELL_GRAIN } from '../vendor.mjs';

const bare = (s) => (typeof s === 'string' && /^[^\s"]+$/.test(s) ? s : JSON.stringify(s));

export function eotBlock(e, file) {
  const lines = [];
  lines.push(`#${e.id}  ${e.cell}  ${bare(e.kind)}  ${JSON.stringify(e.addr)}`);
  lines.push(`  by ${bare(e.by)}  at ${bare(e.at)}  v ${e.v}  @${bare(file === undefined || file === null ? e.by : file)}`);
  lines.push(e.of.length ? `  of ${e.of.join(' ')}` : '  of');
  lines.push(e.seen.length ? `  seen ${e.seen.join(' ')}` : '  seen');
  lines.push(`  basis ${canonical(e.basis)}`);
  lines.push(`  body ${canonical(e.body)}`);
  return lines.join('\n');
}
export const eotEntries = (items) => items.map((it) => eotBlock(it.e, it.file)).join('\n\n') + (items.length ? '\n' : '');

// tokens: bare words or JSON strings
function tokens(line, pos0, what) {
  const out = []; let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === ' ') { i++; continue; }
    if (c === '"') {
      let j = i + 1;
      for (;;) { if (j >= line.length) throw new EoqlError('E_IMPORT', `unterminated string in EOT ${what}`, { pos: pos0 }); if (line[j] === '\\') { j += 2; continue; } if (line[j] === '"') break; j++; }
      let v; try { v = JSON.parse(line.slice(i, j + 1)); } catch (e) { throw new EoqlError('E_IMPORT', `bad string in EOT ${what}`, { pos: pos0 }); }
      out.push({ s: v, str: true }); i = j + 1; continue;
    }
    let j = i; while (j < line.length && line[j] !== ' ') j++;
    out.push({ s: line.slice(i, j), str: false }); i = j;
  }
  return out;
}

// -> [{e, file, text}]
export function eotParse(text) {
  const blocks = []; let cur = null;
  const lines = text.split('\n');
  for (let n = 0; n < lines.length; n++) {
    const ln = lines[n].replace(/\r$/, '');
    if (!ln.trim()) { cur = null; continue; }
    if (ln[0] === '#') { cur = { head: ln, n: n + 1, rest: [] }; blocks.push(cur); continue; }
    if (!cur) throw new EoqlError('E_IMPORT', `EOT line ${n + 1} is outside a block`);
    cur.rest.push({ ln, n: n + 1 });
  }
  const out = [];
  for (const b of blocks) {
    const m = /^#([0-9a-f]{64})  (\S+)  (.+)$/.exec(b.head);
    if (!m) throw new EoqlError('E_IMPORT', `EOT block header at line ${b.n} is malformed`);
    const hid = m[1], cell = m[2];
    const toks = tokens(m[3], b.n, 'header');
    if (toks.length !== 2) throw new EoqlError('E_IMPORT', `EOT header at line ${b.n} needs a kind and a JSON address`);
    const kind = toks[0].s; let addr;
    try { addr = JSON.parse(toks[1].s === undefined ? '' : (toks[1].str ? JSON.stringify(toks[1].s) : toks[1].s)); } catch (e) { throw new EoqlError('E_IMPORT', `EOT address at line ${b.n} is not a JSON string`); }
    if (typeof addr !== 'string') throw new EoqlError('E_IMPORT', `EOT address at line ${b.n} is not a string`);
    let by, at, v, file, of = [], seen = [], basis, body; let haveBasis = false, haveBody = false;
    for (const r of b.rest) {
      const t = r.ln.replace(/^ {1,2}/, '');
      if (t.startsWith('by ')) {
        const fm = /\s@(?:("(?:[^"\\]|\\.)*")|(\S*))\s*$/.exec(t);
        let core = t;
        if (fm) { file = fm[1] !== undefined ? JSON.parse(fm[1]) : fm[2]; core = t.slice(0, fm.index); }
        const tk = tokens(core, r.n, 'line');
        const get = (w) => { const k = tk.findIndex((x) => !x.str && x.s === w); return k >= 0 ? tk[k + 1] : undefined; };
        by = tk[1] && tk[1].s; const ai = tk.findIndex((x, k) => k >= 2 && !x.str && x.s === 'at'); at = ai >= 0 && tk[ai + 1] ? tk[ai + 1].s : undefined;
        const vv = get('v'); v = vv ? Number(vv.s) : NaN;
      } else if (t === 'of' || t.startsWith('of ')) of = t.slice(2).trim() ? t.slice(2).trim().split(/\s+/) : [];
      else if (t === 'seen' || t.startsWith('seen ')) seen = t.slice(4).trim() ? t.slice(4).trim().split(/\s+/) : [];
      else if (t.startsWith('basis ')) { try { basis = JSON.parse(t.slice(6)); haveBasis = true; } catch (e) { throw new EoqlError('E_IMPORT', `EOT basis at line ${r.n} is not JSON`); } }
      else if (t.startsWith('body ')) { try { body = JSON.parse(t.slice(5)); haveBody = true; } catch (e) { throw new EoqlError('E_IMPORT', `EOT body at line ${r.n} is not JSON`); } }
      else throw new EoqlError('E_IMPORT', `EOT line ${r.n} is not recognised`);
    }
    if (!haveBasis || !haveBody || by === undefined || at === undefined) throw new EoqlError('E_IMPORT', `EOT block at line ${b.n} is incomplete`);
    const e = { v, cell, kind, addr, body, of, basis, seen, by, at };
    const id = entryId(e);
    if (id !== hid) throw new EoqlError('E_ID_MISMATCH', `EOT block at line ${b.n}: header id does not match the content`, { detail: { header: hid, computed: id } });
    e.id = id;
    const why = invalidReason(e);
    if (why) throw new EoqlError('E_IMPORT', `EOT block at line ${b.n} is not a valid entry: ${why}`);
    out.push({ e, file: file === undefined || file === '' ? by : file, text: canonical(e) });
  }
  return out;
}

// profile `view`: a result as an indented tree, one node per row with its _held and cell (lossy, no decoder)
export function eotView(env) {
  const lines = [];
  const cols = env.columns.map((c) => c.name);
  env.rows.forEach((r, i) => {
    const m = env.row_meta[i] || {};
    const cell = r._cell || null;
    const op = cell ? `${CELL_OP.get(cell) || '?'}·${CELL_GRAIN.get(cell) || '?'}` : '·';
    lines.push(`${op} held=${m.held === undefined ? '' : m.held}${m.determined === false ? ' open' : ''}`);
    for (const c of cols) lines.push(`  ${c}: ${canonical(r[c] === undefined ? null : r[c])}`);
    lines.push('');
  });
  return lines.join('\n');
}
