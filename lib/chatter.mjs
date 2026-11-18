// chatter — the pharos's debugging trail. NOT DATA.
//
// The log (lib/pharos.mjs) holds entries: content-addressed, causal, folded, retractable. Chatter holds none of that. It is where a repo says "I had an issue" (a read refused for want of priors, a prior
// that did not load, a door that was entered the wrong way, a guard that would have fired) so that the next session, or you, can see what went wrong without it ever being mistaken for a record.
//
//   chatter({ level, where, what, detail? }, opts?)  → { ok } — best effort: it NEVER throws and never blocks the caller (a debugging trail that can break the thing it watches is worse than none)
//   readChatter({ tail?, since?, level?, where?, what?, dir? }) → lines, newest last
//   chatterDir(opts?)                                  → where it lives
//
// Rules (design, 2026-11-18):
//   1. Not data. No id, no `seen`, no causal order, no cell, never folded, never merged, never retracted. Nothing reads chatter to decide anything; it is for people and for sessions debugging.
//   2. Ignorant. `where` names the writer's own repo or file as provenance only. Chatter never dispatches on it (same rule as `by`).
//   3. Bounded. One line is at most 8 KB (detail is cut, marked `cut`); one file rotates at 1 MB and keeps one generation; one writer, one file, so no locking.
//   4. Zero dependencies. Node built-ins only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const LEVELS = Object.freeze(['debug', 'info', 'warn', 'error']);
const MAX_LINE = 8 * 1024, MAX_FILE = 1024 * 1024;
const safe = (s, n = 200) => String(s ?? '').replace(/[\r\n]+/g, ' ').slice(0, n);

export function chatterDir(opts = {}) {
  if (opts.dir) return path.resolve(opts.dir);
  if (process.env.PHAROS_CHATTER) return path.resolve(process.env.PHAROS_CHATTER);
  return path.join(path.resolve(process.env.PHAROS || path.join(os.homedir(), '.pharos', opts.name || 'default')), 'chatter');
}

export function chatter(line, opts = {}) {
  try {
    const level = LEVELS.includes(line?.level) ? line.level : 'info';
    const writer = safe(opts.writer || process.env.PHAROS_WRITER || `${os.hostname().split('.')[0]}-${process.pid}`, 80).replace(/[^A-Za-z0-9._-]/g, '_') || 'writer';
    let rec = { at: new Date().toISOString(), level, where: safe(line?.where, 120), what: safe(line?.what, 120), writer, pid: process.pid };
    let detail; try { detail = line?.detail === undefined ? undefined : JSON.stringify(line.detail); } catch { detail = JSON.stringify(String(line.detail)); }
    let text = JSON.stringify(rec);
    if (detail !== undefined) {
      const room = MAX_LINE - text.length - 40;
      if (detail.length > room) { rec.detail = detail.slice(0, Math.max(0, room)); rec.cut = true; } else rec.detail = JSON.parse(detail);
      text = JSON.stringify(rec);
    }
    const dir = chatterDir(opts); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${writer}.log`);
    try { if (fs.statSync(file).size > MAX_FILE) fs.renameSync(file, file + '.1'); } catch { /* no file yet */ }
    fs.appendFileSync(file, text + '\n');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: safe(err?.message) };
  }
}

export function readChatter(opts = {}) {
  const dir = chatterDir(opts); let out = [];
  let files = []; try { files = fs.readdirSync(dir).filter((f) => /\.log(\.1)?$/.test(f)); } catch { return []; }
  for (const f of files) {
    let txt = ''; try { txt = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    for (const l of txt.split('\n')) { if (!l) continue; try { out.push(JSON.parse(l)); } catch { /* a torn line is skipped, never repaired */ } }
  }
  if (opts.level) { const min = LEVELS.indexOf(opts.level); out = out.filter((r) => LEVELS.indexOf(r.level) >= min); }
  if (opts.where) out = out.filter((r) => r.where === opts.where);
  if (opts.what) out = out.filter((r) => r.what === opts.what);
  if (opts.since) out = out.filter((r) => r.at >= opts.since);
  out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return opts.tail ? out.slice(-Number(opts.tail)) : out;
}
