#!/usr/bin/env node
// pharos ui: a read-only viewer for a pharos log. Zero dependencies, Node built-ins only.
//   node ui/serve.mjs --dir <log dir> [--port 7411] [--name N]
// It never weaves, never opens a frame, never writes. It reads through lib/pharos.mjs (fold) so what
// you see is what `pharos fold` would say. Binds to 127.0.0.1 only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../lib/pharos.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : a), []));
const dir = path.resolve(args.dir || process.env.PHAROS || path.join(process.env.HOME || '.', '.pharos', args.name || 'default'));
const port = Number(args.port || 7411);
if (!fs.existsSync(dir)) { console.error(`no such log dir: ${dir}`); process.exit(2); }

const h = P.open(args.name || 'default', { dir, writer: 'ui-readonly', frame: false });
const cells = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'cells.json'), 'utf8'));

// Cache the fold until a *.jsonl file changes.
let cache = null;
const stamp = () => fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => { const s = fs.statSync(path.join(dir, f)); return f + s.size + ':' + s.mtimeMs; }).join('|');
function snapshot() {
  const st = stamp();
  if (cache && cache.st === st) return cache;
  const f = P.fold(h);
  const byId = new Map(f.entries.map((e, i) => [e.id, { e, i }]));
  const refd = new Map(); // id -> ids that cite it in `of`
  for (const e of f.entries) for (const o of e.of || []) { if (!refd.has(o)) refd.set(o, []); refd.get(o).push(e.id); }
  const facet = (k) => { const m = new Map(); for (const e of f.entries) m.set(e[k], (m.get(e[k]) || 0) + 1); return [...m].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n); };
  const retractedIds = new Set((f.retractions || []).map((r) => r.of || r.id).flat().filter(Boolean));
  cache = { st, f, byId, refd, facets: { cell: facet('cell'), kind: facet('kind'), by: facet('by') }, status: P.status(h), retractedIds };
  return cache;
}

const preview = (b) => { let s; try { s = typeof b === 'string' ? b : JSON.stringify(b); } catch { s = String(b); } return s.length > 220 ? s.slice(0, 220) + '…' : s; };
const row = (e) => ({ id: e.id, cell: e.cell, kind: e.kind, addr: e.addr, by: e.by, at: e.at, preview: preview(e.body), nof: (e.of || []).length });
const json = (res, code, v) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(v)); };

function filtered(q) {
  const { f } = snapshot();
  const text = (q.get('q') || '').toLowerCase();
  const from = q.get('from'), to = q.get('to');
  let list = f.entries.filter((e) =>
    (!q.get('cell') || e.cell === q.get('cell')) && (!q.get('kind') || e.kind === q.get('kind')) && (!q.get('by') || e.by === q.get('by')) &&
    (!q.get('addr') || e.addr.startsWith(q.get('addr'))) && (!from || e.at >= from) && (!to || e.at <= to) &&
    (!text || e.addr.toLowerCase().includes(text) || e.id.startsWith(text) || JSON.stringify(e.body).toLowerCase().includes(text)));
  if (q.get('order') === 'recent') list = list.slice().sort((a, b) => (a.at < b.at ? 1 : -1));
  return list;
}

// Opt-in write path: --sync-dir <dir> lets the page project the current filter into a SQLite file inside that dir.
// The log itself is never touched. A random token (printed at start, injected into the page) guards the POST.
const syncDir = args['sync-dir'] ? path.resolve(args['sync-dir']) : null;
const token = (await import('node:crypto')).randomBytes(16).toString('hex');
async function syncSqlite(file, list) {
  let DatabaseSync; try { ({ DatabaseSync } = await import('node:sqlite')); } catch { throw new Error('node:sqlite needs Node 22.5 or later'); }
  if (!/^[A-Za-z0-9._-]+\.(db|sqlite|sqlite3)$/.test(file)) throw new Error('file must be a plain name ending in .db, .sqlite or .sqlite3');
  fs.mkdirSync(syncDir, { recursive: true });
  const db = new DatabaseSync(path.join(syncDir, file));
  db.exec(`CREATE TABLE IF NOT EXISTS pharos_entries(id TEXT PRIMARY KEY, cell TEXT, kind TEXT, addr TEXT, by TEXT, at TEXT, "of" TEXT, basis TEXT, body TEXT);
    CREATE INDEX IF NOT EXISTS pe_kind ON pharos_entries(kind); CREATE INDEX IF NOT EXISTS pe_addr ON pharos_entries(addr);`);
  const ins = db.prepare('INSERT OR IGNORE INTO pharos_entries VALUES(?,?,?,?,?,?,?,?,?)');
  let added = 0; db.exec('BEGIN');
  try { for (const e of list) added += Number(ins.run(e.id, e.cell, e.kind, e.addr, e.by, e.at, JSON.stringify(e.of || []), JSON.stringify(e.basis || {}), JSON.stringify(e.body)).changes); db.exec('COMMIT'); }
  catch (err) { db.exec('ROLLBACK'); throw err; }
  const total = db.prepare('SELECT count(*) n FROM pharos_entries').get().n; db.close();
  return { file: path.join(syncDir, file), sent: list.length, added, alreadyThere: list.length - added, totalInDb: total };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname, q = url.searchParams;
    if (req.method === 'POST' && p === '/api/sync/sqlite') {
      if (!syncDir) return json(res, 403, { error: 'start with --sync-dir <dir> to enable sync' });
      if (req.headers['x-pharos-token'] !== token || (req.headers.host || '').split(':')[0] !== '127.0.0.1') return json(res, 403, { error: 'bad token' });
      return json(res, 200, await syncSqlite(q.get('file') || 'pharos.db', filtered(q)));
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'read-only' });
    if (p === '/' || p === '/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(HERE, 'index.html'), 'utf8').replace('__SYNC__', JSON.stringify(syncDir ? { dir: syncDir, token } : null))); }
    if (p === '/api/overview') {
      const s = snapshot();
      return json(res, 200, { dir, status: s.status, frame: P.frame(h), facets: s.facets, cells, conflicts: s.f.conflicts.length, corrupt: s.f.corrupt.length, stamp: s.st.length + ':' + s.status.entries });
    }
    if (p === '/api/entries') {
      const list = filtered(q); const off = Number(q.get('offset') || 0), lim = Math.min(Number(q.get('limit') || 100), 500);
      return json(res, 200, { total: list.length, offset: off, rows: list.slice(off, off + lim).map(row) });
    }
    if (p === '/api/entry') {
      const s = snapshot(); const hit = s.byId.get(q.get('id'));
      if (!hit) return json(res, 404, { error: 'unknown id' });
      const e = hit.e; const lite = (id) => { const x = s.byId.get(id); return x ? row(x.e) : { id, missing: true }; };
      return json(res, 200, { entry: e, of: (e.of || []).map(lite), citedBy: (s.refd.get(e.id) || []).slice(0, 50).map(lite), seen: (e.seen || []).map(lite),
        sameAddr: s.f.entries.filter((x) => x.addr === e.addr && x.id !== e.id).slice(0, 50).map(row) });
    }
    if (p === '/api/conflicts') { const s = snapshot(); return json(res, 200, s.f.conflicts.slice(0, 500)); }
    if (p === '/api/retractions') { const s = snapshot(); return json(res, 200, s.f.retractions.slice(0, 500)); }
    if (p === '/api/timeline') { // entries per day per cell-operator, for the histogram
      const list = filtered(q); const m = new Map();
      for (const e of list) { const d = (e.at || '').slice(0, 10); m.set(d, (m.get(d) || 0) + 1); }
      return json(res, 200, [...m].sort().map(([day, n]) => ({ day, n })));
    }
    if (p === '/api/export.jsonl') { // the filtered view, one entry per line: the hand-off point for a codec
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'content-disposition': 'attachment; filename="pharos-view.jsonl"' });
      return res.end(filtered(q).map((e) => P.canonical(e)).join('\n') + '\n');
    }
    json(res, 404, { error: 'no route' });
  } catch (err) { json(res, 500, { error: String(err.message || err) }); }
});
server.listen(port, '127.0.0.1', () => console.log(`pharos ui: http://127.0.0.1:${port}  (reading ${dir}, ${syncDir ? 'sync to ' + syncDir : 'read-only'})`));
