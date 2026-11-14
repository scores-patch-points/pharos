// serve.mjs: the read-only HTTP server on 127.0.0.1 (SPEC 7.4). No route appends anything; a WRITE is E_READONLY (403).
import http from 'node:http';
import { EoqlError, wrap } from './errors.mjs';

const STATUS = (e) => {
  const c = e.code;
  if (c === 'E_READONLY') return 403;
  if (c === 'E_LIMIT') return 413;
  if (c === 'E_BUDGET') return 422;
  if (/^(E_PARSE|E_BIND_|E_UNKNOWN_|E_BAD_|E_FRAME|E_TYPE|E_PARAM|E_ARITY|E_RANGE|E_AMBIGUOUS_REF|E_CYCLE|E_LABEL|E_USAGE)/.test(c)) return 400;
  return 500;
};
export function serveHandle(E, h0, opts = {}) {
  const host = opts.host === undefined ? '127.0.0.1' : opts.host;
  if (host !== '127.0.0.1') throw new EoqlError('E_USAGE', 'the server binds 127.0.0.1 only');
  // the handle the server uses is always a read handle
  let h = h0;
  if (h0.mode !== 'read') h = h0.uri && !h0.uri.startsWith('mem:') && !h0.uri.startsWith('world:') ? E.open(h0.uri, { mode: 'read' }) : h0;
  const MAX_BODY = 1024 * 1024;
  let port = 0;
  const server = http.createServer((req, res) => {
    const send = (code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b), 'Cache-Control': 'no-store' }); res.end(b); };
    const fail = (e) => { const err = wrap(e); send(STATUS(err), { error: err.toJSON() }); };
    try {
      const hh = String(req.headers.host || '');
      if (!(hh === `127.0.0.1:${port}` || hh === `localhost:${port}`)) return send(403, { error: { code: 'E_FORBIDDEN_HOST', message: 'the Host header must be 127.0.0.1:<port> or localhost:<port>' } });
      const url = (req.url || '').split('?')[0];
      if (req.method === 'GET') {
        if (url === '/health') return send(200, { ok: true });
        if (url === '/views') return send(200, E.views.list(h));
        if (url === '/formats') return send(200, E.formats());
        return send(404, { error: { code: 'E_NOT_FOUND', message: `no route ${url}` } });
      }
      if (req.method !== 'POST' || (url !== '/run' && url !== '/explain')) return send(url === '/run' || url === '/explain' ? 405 : 404, { error: { code: 'E_NOT_FOUND', message: `no route ${req.method} ${url}` } });
      const chunks = []; let size = 0; let over = false;
      req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { over = true; return; } chunks.push(c); });
      req.on('end', () => {
        try {
          if (over) return send(413, { error: { code: 'E_LIMIT', message: 'request body over 1 MiB', detail: { limit: 'body' } } });
          let body;
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { throw new EoqlError('E_PARSE', 'the request body is not JSON'); }
          if (!body || typeof body.query !== 'string') throw new EoqlError('E_USAGE', 'the body needs { query: "..." }');
          const script = E.parse(body.query);
          if (script.statements.some((s) => s.t === 'write')) throw new EoqlError('E_READONLY', 'this server has no write path');
          const budget = { ...(opts.budget || {}), ...(body.budget || {}) };
          for (const [k, v] of Object.entries(opts.budget || {})) if (typeof body.budget?.[k] === 'number') budget[k] = Math.min(v, body.budget[k]);
          const ro = { params: body.params, frame: body.frame, budget, return: body.return, write: false };
          if (url === '/explain') return send(200, E.plan(h, script, ro));
          const out = E.run(h, script, ro);
          const nrows = (o) => (o.rows ? o.rows.length : 0);
          const total = out.statements ? out.statements.reduce((n, o) => n + nrows(o), 0) : nrows(out);
          if (total > 200000) throw new EoqlError('E_BUDGET', `result over 200000 rows (${total})`, { detail: { counter: 'result_rows', limit: 200000, spent: total } });
          return send(200, out);
        } catch (e) { fail(e); }
      });
      req.on('error', fail);
    } catch (e) { fail(e); }
  });
  return new Promise((resolve, reject) => {
    server.once('error', (e) => reject(wrap(e)));
    server.listen(opts.port || 0, '127.0.0.1', () => {
      port = server.address().port;
      resolve({ port, close: () => new Promise((r) => { server.close(() => r()); if (server.closeAllConnections) server.closeAllConnections(); }) });
    });
  });
}
