#!/usr/bin/env node
// bin/eoql.mjs: the CLI (SPEC 7.3 and SPEC-A1 3). It only parses arguments; every command prints ONE JSON document on stdout
// (`--pretty` indents) and exits 0; errors print {"error":{...}} on stderr and exit 1 (usage errors exit 2).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const E = await import(pathToFileURL(path.join(HERE, '..', 'src', 'index.mjs')).href);

const BOOL = new Set(['write', 'pretty', 'legacy-gaps', 'accept-loss', 'derived', 'skip-present', 'run', 'strict', 'addr-hash', 'of-heads', 'help']);
const REPEAT = new Set(['param']);

function usage(msg) { const e = new E.EoqlError('E_USAGE', msg); e.usage = true; return e; }
function parseArgs(argv) {
  const pos = []; const flags = {}; const params = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-') { pos.push('-'); continue; }
    if (a === '-f') { if (i + 1 >= argv.length) throw usage('-f needs a file'); flags.f = argv[++i]; continue; }
    if (a.startsWith('--')) {
      let k = a.slice(2); let v = null;
      const eq = k.indexOf('=');
      if (eq >= 0) { v = k.slice(eq + 1); k = k.slice(0, eq); }
      if (BOOL.has(k)) { flags[k] = v === null ? true : v !== 'false'; continue; }
      if (v === null) { if (i + 1 >= argv.length) throw usage(`--${k} needs a value`); v = argv[++i]; }
      if (REPEAT.has(k)) { params.push(v); continue; }
      flags[k] = v; continue;
    }
    pos.push(a);
  }
  return { pos, flags, params };
}
const parseJson = (s, what) => { try { return JSON.parse(s); } catch (e) { throw usage(`${what} is not JSON`); } };
function paramsOf(flags, list) {
  const out = flags['params-json'] ? parseJson(flags['params-json'], '--params-json') : {};
  for (const p of list) { const i = p.indexOf('='); if (i <= 0) throw usage('--param needs name=value'); const k = p.slice(0, i); const raw = p.slice(i + 1); let v; try { v = JSON.parse(raw); } catch (e) { v = raw; } out[k] = v; }
  return out;
}
function readStdin() { try { return fs.readFileSync(0, 'utf8'); } catch (e) { return ''; } }
function textArg(pos, flags, idx) {
  if (flags.f !== undefined) return fs.readFileSync(flags.f, 'utf8');
  const t = pos[idx];
  if (t === undefined) throw usage('a query is needed (inline, -f FILE, or -)');
  if (t === '-') return readStdin();
  return t;
}
const out = (o, pretty) => { process.stdout.write((pretty ? JSON.stringify(o, null, 2) : JSON.stringify(o)) + '\n'); };

function optsFor(flags, params) {
  const o = { params: paramsOf(flags, params) };
  if (flags.frame) o.frame = parseJson(flags.frame, '--frame');
  if (flags.budget) o.budget = parseJson(flags.budget, '--budget');
  if (flags.return) o.return = flags.return;
  if (flags.explain) o.explain = flags.explain;
  if (flags['legacy-gaps']) o.legacyGaps = true;
  return o;
}
function openFor(uri, flags, forceWrite) {
  const write = !!(forceWrite || flags.write);
  if (write && !flags.writer) throw new E.EoqlError('E_READONLY', '--write needs --writer');
  return E.open(uri, write ? { mode: 'write', writer: flags.writer } : { mode: 'read' });
}
const isStoreUri = (s) => /^(lib|jsonl|lazy|blocks|sqlite|sqlrel):/.test(s);

async function main(argv) {
  if (!argv.length || argv[0] === '--help' || argv[0] === 'help') { out({ commands: ['run', 'explain', 'export', 'import', 'serve', 'dump', 'view', 'sql', 'parse', 'compile'], version: E.VERSION }, true); return; }
  const cmd = argv[0];
  const { pos, flags, params } = parseArgs(argv.slice(1));
  const pretty = !!flags.pretty;
  switch (cmd) {
    case 'run': {
      if (pos.length < 1) throw usage('run <source> <query>');
      const text = textArg(pos, flags, 1);
      const h = openFor(pos[0], flags);
      try { out(E.run(h, text, { ...optsFor(flags, params), write: !!flags.write }), pretty); } finally { E.close(h); }
      return;
    }
    case 'explain': {
      if (pos.length < 1) throw usage('explain <source> <query>');
      const text = textArg(pos, flags, 1);
      const h = E.open(pos[0], { mode: 'read' });
      try { out(E.plan(h, text, optsFor(flags, params)), pretty); } finally { E.close(h); }
      return;
    }
    case 'export': {
      if (pos.length < 1 || !flags.to) throw usage('export <source> --to <fmt[:profile]:path>');
      const opts = { scope: flags.scope, acceptLoss: !!flags['accept-loss'], derived: !!flags.derived, splitLimit: flags['split-limit'] ? Number(flags['split-limit']) : undefined };
      if (isStoreUri(pos[0])) { const h = E.open(pos[0], { mode: 'read' }); try { out(E.exportTo(h, flags.to, opts), pretty); } finally { E.close(h); } } else out(E.convert({ from: pos[0], to: flags.to, ...opts }), pretty);
      return;
    }
    case 'import': {
      if (pos.length < 1 || !flags.into) throw usage('import <fmt[:profile]:path> --into <source> --write --writer W');
      if (!flags.write) throw new E.EoqlError('E_READONLY', 'import needs --write --writer');
      const h = openFor(flags.into, flags, true);
      try {
        const o = { kind: flags.kind, addrCol: flags['addr-col'], addrTemplate: flags['addr-template'], addrHash: !!flags['addr-hash'], types: flags.types ? parseJson(flags.types, '--types') : undefined, basis: flags.basis ? parseJson(flags.basis, '--basis') : undefined, skipPresent: !!flags['skip-present'], receiptKind: flags['receipt-kind'], acceptLoss: !!flags['accept-loss'], table: flags.table };
        out(E.importFrom(pos[0], h, o), pretty);
      } finally { E.close(h); }
      return;
    }
    case 'serve': {
      if (pos.length < 1) throw usage('serve <source>');
      const h = E.open(pos[0], { mode: 'read' });
      const s = await E.serve(h, { port: flags.port ? Number(flags.port) : 0, budget: flags.budget ? parseJson(flags.budget, '--budget') : undefined });
      process.stdout.write(JSON.stringify({ listening: `127.0.0.1:${s.port}` }) + '\n');
      const stop = async () => { await s.close(); process.exit(0); };
      process.on('SIGINT', stop); process.on('SIGTERM', stop);
      await new Promise(() => {});
      return;
    }
    case 'dump': {
      if (pos.length < 1) throw usage('dump <source>');
      const h = E.open(pos[0], { mode: 'read' });
      try {
        const o = { mode: flags.mode || 'verbatim', scope: flags.scope };
        if (flags.out) {
          const info = E.dumpInfo(h, o);
          if (fs.existsSync(flags.out)) throw new E.EoqlError('E_EXPORT', `output exists (a dump never overwrites): ${flags.out}`);
          fs.mkdirSync(path.dirname(path.resolve(flags.out)), { recursive: true });
          fs.writeFileSync(flags.out, info.text, { flag: 'wx' });
          out({ out: flags.out, entries: info.entries, ids_sha256: info.ids_sha256, mode: info.mode }, pretty);
        } else process.stdout.write(E.dump(h, o));
      } finally { E.close(h); }
      return;
    }
    case 'view': {
      const sub = pos[0];
      if (!sub || pos.length < 2) throw usage('view define|list|show|run|retract <source> ...');
      const uri = pos[1];
      if (sub === 'define') {
        if (pos.length < 3) throw usage('view define <source> <name> <query>');
        const text = textArg(pos, flags, 3);
        const h = openFor(uri, flags, true);
        try { out(E.views.define(h, pos[2], text, { params: flags.params ? String(flags.params).split(',').filter(Boolean) : undefined, of: flags['of-heads'] ? 'heads' : undefined }), pretty); } finally { E.close(h); }
      } else if (sub === 'retract') {
        if (pos.length < 3) throw usage('view retract <source> <name>');
        if (!flags.write) throw new E.EoqlError('E_READONLY', 'view retract needs --write --writer');
        const h = openFor(uri, flags, true);
        try { out(E.views.retract(h, pos[2]), pretty); } finally { E.close(h); }
      } else if (sub === 'list') {
        const h = E.open(uri, { mode: 'read' }); try { out(E.views.list(h, { asof: flags.asof }), pretty); } finally { E.close(h); }
      } else if (sub === 'show') {
        if (pos.length < 3) throw usage('view show <source> <name>');
        const h = E.open(uri, { mode: 'read' }); try { out(E.views.get(h, pos[2], { asof: flags.asof }), pretty); } finally { E.close(h); }
      } else if (sub === 'run') {
        if (pos.length < 3) throw usage('view run <source> <name>');
        const h = E.open(uri, { mode: 'read' });
        try {
          const v = E.views.get(h, pos[2], { asof: flags.asof });
          const text = v.params.length ? `${pos[2]}(${v.params.map((p) => `${p}: :${p}`).join('; ')})` : pos[2];
          out(E.run(h, text, { ...optsFor(flags, params) }), pretty);
        } finally { E.close(h); }
      } else throw usage(`unknown view command ${sub}`);
      return;
    }
    case 'sql': {
      if (pos.length < 1) throw usage('sql <source> <sql>');
      const text = textArg(pos, flags, 1);
      const h = openFor(pos[0], flags);
      try {
        const tr = E.parseSql(text, { catalog: h });
        if (flags.run && tr.ok) {
          const prm = paramsOf(flags, params);
          const env = E.run(h, tr.eoql, { params: Object.fromEntries((tr.params || []).map((p) => [p, prm[p] === undefined ? null : prm[p]])), write: !!flags.write });
          out({ ...tr, result: env }, pretty);
        } else out(tr, pretty);
      } finally { E.close(h); }
      return;
    }
    case 'parse': {
      const from = flags.from || 'eoql';
      if (!['sql', 'eoql', 'v1ast'].includes(from)) throw usage('--from must be sql, eoql or v1ast');
      const text = textArg(pos, flags, 0);
      let catalog; if (flags.catalog) catalog = E.open(flags.catalog, { mode: 'read' });
      try {
        if (from === 'sql') out(E.parseSql(text, { catalog, strict: !!flags.strict }), pretty);
        else if (from === 'v1ast') { if (!E.fromV1) throw new E.EoqlError('E_USAGE', 'v1ast input is not built'); out(E.fromV1(parseJson(text, 'v1 AST'), { catalog, strict: !!flags.strict }), pretty); } else {
          const ast = E.parse(text); const p = E.print(ast);
          out({ v: 'eoql-parse/1', ok: true, from: 'eoql', eoql: p, expr_hash: E.hash(ast), ast: JSON.parse(JSON.stringify(ast.statements.length === 1 && ast.statements[0].t === 'read' ? ast.statements[0].expr : ast)) }, pretty);
        }
      } finally { if (catalog) E.close(catalog); }
      return;
    }
    case 'compile': {
      const text = textArg(pos, flags, 0);
      if (!flags.to) throw usage('compile needs --to sqlite|postgres|mysql|sqlserver|oracle');
      const t = String(flags.to).toLowerCase();
      if (!['sqlite', 'postgres', 'postgresql', 'mysql', 'sqlserver', 'oracle', 'mongodb', 'pandas'].includes(t)) throw usage(`--to ${flags.to} is not a dialect`);
      let catalog; if (flags.catalog) catalog = E.open(flags.catalog, { mode: 'read' });
      try { out(E.compile(text, { to: flags.to, catalog, strict: !!flags.strict }), pretty); } finally { if (catalog) E.close(catalog); }
      return;
    }
    default: throw usage(`unknown command ${cmd}`);
  }
}

main(process.argv.slice(2)).then(() => { if (!process.exitCode) process.exit(0); }, (e) => {
  const err = e instanceof E.EoqlError ? e : new E.EoqlError('E_INTERNAL', String(e && e.message ? e.message : e));
  process.stderr.write(JSON.stringify({ error: err.toJSON() }) + '\n');
  process.exit(e && e.usage ? 2 : 1);
});
