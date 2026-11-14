// dates.mjs: the date and time functions of EOQL (date, time, datetime, strftime, julianday, unixepoch), written to agree with
// SQLite's documented behaviour for the input forms, modifiers and strftime specifiers listed below (the builder's tests compare
// every one of them with SQLite on generated inputs). Pure functions of their arguments: no clock, no time zone, no locale.
// NOT implemented (the SQL translator names them as gaps): 'now', 'localtime', 'utc', fractional months/years, %J, timediff.
//
// internal time: integer milliseconds since 1970-01-01T00:00:00Z (SQLite keeps Julian-day milliseconds; the two differ by a
// constant), valid for years 0000..9999.
const MS_DAY = 86400000;
const JD_EPOCH_MS = 210866760000000; // Julian day 0 to 1970-01-01, in milliseconds
const minDate = new Date(0); minDate.setUTCFullYear(0, 0, 1); minDate.setUTCHours(0, 0, 0, 0);
const maxDate = new Date(0); maxDate.setUTCFullYear(9999, 11, 31); maxDate.setUTCHours(23, 59, 59, 999);
const MIN = -JD_EPOCH_MS, MAX = maxDate.getTime(); // SQLite accepts Julian day 0 (year -4713) up to 9999-12-31 23:59:59.999
void minDate;
const inRange = (ms) => Number.isFinite(ms) && ms >= MIN && ms <= MAX;
function utc(Y, Mo, D, H, Mi, S, ms) { // Mo is 1-based; years 0..99 are years, not 19xx
  const d = new Date(0); d.setUTCFullYear(Y, Mo - 1, D); d.setUTCHours(H, Mi, S, ms); return d.getTime();
}
const fields = (ms) => { const d = new Date(ms); return { Y: d.getUTCFullYear(), Mo: d.getUTCMonth() + 1, D: d.getUTCDate(), H: d.getUTCHours(), Mi: d.getUTCMinutes(), S: d.getUTCSeconds(), ms: d.getUTCMilliseconds() }; };
const p2 = (n) => String(n).padStart(2, '0');
const p4 = (n) => (n < 0 ? '-' + String(-n).padStart(4, '0') : String(n).padStart(4, '0'));

const RE_DATE = /^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d)(?::(\d\d)(?:\.(\d+))?)?)?\s*(Z|[+-]\d\d:\d\d)?\s*$/i;
const RE_TIME = /^(\d\d):(\d\d)(?::(\d\d)(?:\.(\d+))?)?\s*(Z|[+-]\d\d:\d\d)?\s*$/i;
const RE_NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
function fracMs(f) { return f ? Math.trunc(Number('0.' + f) * 1000 + 0.5) : 0; }
function tzMs(z) { if (!z || /^z$/i.test(z)) return 0; const m = /^([+-])(\d\d):(\d\d)$/.exec(z); if (!m) return null; const h = +m[2], mi = +m[3]; if (h > 14 || mi > 59) return null; return (m[1] === '-' ? -1 : 1) * (h * 60 + mi) * 60000; }
function parseValue(v, mods) {
  const first = mods.length ? mods[0].toLowerCase() : '';
  let numeric = null;
  if (typeof v === 'number' || typeof v === 'bigint') numeric = Number(v);
  else if (typeof v === 'string' && RE_NUM.test(v.trim())) numeric = Number(v);
  if (numeric !== null) {
    if (!Number.isFinite(numeric)) return null;
    let unix = false;
    if (first === 'unixepoch') unix = true; else if (first === 'auto') unix = !(numeric >= 0 && numeric < 5373484.5);
    const t = unix ? Math.trunc(numeric * 1000) : Math.trunc(numeric * MS_DAY + 0.5) - JD_EPOCH_MS;
    return inRange(t) ? t : null;
  }
  if (typeof v !== 'string') return null;
  const s = v; // leading blanks are not accepted by SQLite; trailing blanks are
  let m = RE_DATE.exec(s);
  if (m) {
    const [, Y, Mo, D, H = '00', Mi = '00', S = '00', F = '', Z] = m;
    if (+Mo < 1 || +Mo > 12 || +D < 1 || +D > 31 || +H > 24 || (+H === 24 && (+Mi || +S)) || +Mi > 59 || +S > 59) return null;
    const z = tzMs(Z); if (z === null) return null;
    const t = utc(+Y, +Mo, +D, +H, +Mi, +S, 0) + fracMs(F) - z;
    return inRange(t) ? t : null;
  }
  m = RE_TIME.exec(s);
  if (m) {
    const [, H, Mi, S = '00', F = '', Z] = m;
    if (+H > 24 || (+H === 24 && (+Mi || +S)) || +Mi > 59 || +S > 59) return null;
    const z = tzMs(Z); if (z === null) return null;
    return utc(2000, 1, 1, +H, +Mi, +S, 0) + fracMs(F) - z;
  }
  return null;
}
const MODNUM = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*(day|hour|minute|second|month|year)s?$/i;
export const SUPPORTED_MODS = (s) => typeof s === 'string' && (MODNUM.test(s.trim()) || /^(start of (month|year|day)|weekday [0-6](\.0*)?|unixepoch|auto|julianday|subsec|subsecond|ceiling|floor)$/i.test(s.trim()));
function applyMod(t, mod, idx, subsec, numeric) {
  const s = mod.trim().toLowerCase();
  let m = MODNUM.exec(s);
  if (m) {
    const x = Number(m[1]); const unit = m[2];
    const rr = x < 0 ? -0.5 : 0.5;
    const step = (per) => t + Math.trunc(x * per + rr);
    if (unit === 'day') return step(MS_DAY);
    if (unit === 'hour') return step(3600000);
    if (unit === 'minute') return step(60000);
    if (unit === 'second') return step(1000);
    const f = fields(t); const y = Math.trunc(x);
    let r;
    if (unit === 'month') { r = utc(f.Y, f.Mo + y, f.D, f.H, f.Mi, f.S, f.ms); if (y !== x) r += Math.trunc((x - y) * 30.0 * MS_DAY + rr); } else { r = utc(f.Y + y, f.Mo, f.D, f.H, f.Mi, f.S, f.ms); if (y !== x) r += Math.trunc((x - y) * 365.0 * MS_DAY + rr); }
    return r;
  }
  if (s === 'start of month') { const f = fields(t); return utc(f.Y, f.Mo, 1, 0, 0, 0, 0); }
  if (s === 'start of year') { const f = fields(t); return utc(f.Y, 1, 1, 0, 0, 0, 0); }
  if (s === 'start of day') { const f = fields(t); return utc(f.Y, f.Mo, f.D, 0, 0, 0, 0); }
  m = /^weekday ([0-6])(?:\.0*)?$/.exec(s);
  if (m) {
    const n = +m[1];
    let Z = Math.floor((t + JD_EPOCH_MS + 129600000) / MS_DAY) % 7; if (Z > n) Z -= 7;
    return t + (n - Z) * MS_DAY;
  }
  if (s === 'unixepoch') return idx === 0 && numeric ? t : null; // only meaningful on a number
  if (s === 'auto') return idx === 0 ? t : null;
  if (s === 'julianday') return idx === 0 && numeric ? t : null;
  if (s === 'subsec' || s === 'subsecond') { subsec.on = true; return t; }
  if (s === 'ceiling' || s === 'floor') return t;
  return undefined; // localtime, utc, unknown
}
// -> {t, subsec} or null (NULL result) ; undefined mods are NULL as well
function resolve(v, mods) {
  if (v === null || v === undefined) return null;
  for (const m of mods) if (m === null || m === undefined || typeof m !== 'string') return null;
  let t = parseValue(v, mods);
  if (t === null) return null;
  const subsec = { on: false };
  for (let i = 0; i < mods.length; i++) {
    t = applyMod(t, mods[i], i, subsec, typeof v === 'number' || typeof v === 'bigint' || (typeof v === 'string' && RE_NUM.test(v.trim())));
    if (t === null || t === undefined || !inRange(t)) return null;
  }
  return { t, subsec: subsec.on };
}
const wday = (t) => Math.floor((t + JD_EPOCH_MS + 129600000) / MS_DAY) % 7; // 0 = Sunday
function yday(t) { const f = fields(t); return Math.floor((utc(f.Y, f.Mo, f.D, 0, 0, 0, 0) - utc(f.Y, 1, 1, 0, 0, 0, 0)) / MS_DAY) + 1; }
function isoWeek(t) { // -> {year, week}
  const f = fields(t); const d = utc(f.Y, f.Mo, f.D, 0, 0, 0, 0);
  const wd = (new Date(d).getUTCDay() + 6) % 7; // Monday = 0
  const thursday = d + (3 - wd) * MS_DAY; const ty = new Date(thursday).getUTCFullYear();
  const jan1 = utc(ty, 1, 1, 0, 0, 0, 0);
  return { year: ty, week: Math.floor((thursday - jan1) / MS_DAY / 7) + 1 };
}
export const STRFTIME_SPECS = 'dHeIjkmMpPRsSTuwWUVfFgGYl%';
const y4 = (n) => (n < 0 ? '-' + String(-n).padStart(3, '0') : String(n).padStart(4, '0')); // strftime's %04d
function spec(c, t, subsec) {
  const f = fields(t);
  switch (c) {
    case 'd': return p2(f.D);
    case 'e': return String(f.D).padStart(2, ' ');
    case 'f': return `${p2(f.S)}.${String(f.ms).padStart(3, '0')}`;
    case 'F': return `${y4(f.Y)}-${p2(f.Mo)}-${p2(f.D)}`;
    case 'H': return p2(f.H);
    case 'I': return p2(f.H % 12 === 0 ? 12 : f.H % 12);
    case 'j': return String(yday(t)).padStart(3, '0');
    case 'k': return String(f.H).padStart(2, ' ');
    case 'l': return String(f.H % 12 === 0 ? 12 : f.H % 12).padStart(2, ' ');
    case 'm': return p2(f.Mo);
    case 'M': return p2(f.Mi);
    case 'p': return f.H >= 12 ? 'PM' : 'AM';
    case 'P': return f.H >= 12 ? 'pm' : 'am';
    case 'R': return `${p2(f.H)}:${p2(f.Mi)}`;
    case 's': return subsec ? (t / 1000).toFixed(3) : String(Math.floor(t / 1000));
    case 'S': return p2(f.S);
    case 'T': return `${p2(f.H)}:${p2(f.Mi)}:${p2(f.S)}`;
    case 'u': { const w = wday(t); return String(w === 0 ? 7 : w); }
    case 'w': return String(wday(t));
    case 'U': return p2(Math.floor((yday(t) - 1 + 7 - wday(t)) / 7));
    case 'W': return p2(Math.floor((yday(t) - 1 + 7 - ((wday(t) + 6) % 7)) / 7));
    case 'V': return p2(isoWeek(t).week);
    case 'G': return y4(isoWeek(t).year);
    case 'g': return p2(isoWeek(t).year % 100);
    case 'Y': return y4(f.Y);
    case '%': return '%';
    default: return null;
  }
}
const ok = (x) => x !== null && x !== undefined;
export const D = {
  date(v, ...mods) { const r = resolve(v, mods); if (!r) return null; const f = fields(r.t); return `${p4(f.Y)}-${p2(f.Mo)}-${p2(f.D)}`; },
  time(v, ...mods) { const r = resolve(v, mods); if (!r) return null; const f = fields(r.t); return `${p2(f.H)}:${p2(f.Mi)}:${p2(f.S)}${r.subsec ? '.' + String(f.ms).padStart(3, '0') : ''}`; },
  datetime(v, ...mods) { const r = resolve(v, mods); if (!r) return null; const f = fields(r.t); return `${p4(f.Y)}-${p2(f.Mo)}-${p2(f.D)} ${p2(f.H)}:${p2(f.Mi)}:${p2(f.S)}${r.subsec ? '.' + String(f.ms).padStart(3, '0') : ''}`; },
  julianday(v, ...mods) { const r = resolve(v, mods); if (!r) return null; return (r.t + JD_EPOCH_MS) / MS_DAY; },
  unixepoch(v, ...mods) { const r = resolve(v, mods); if (!r) return null; return r.subsec ? r.t / 1000 : Math.floor(r.t / 1000); },
  strftime(fmt, v, ...mods) {
    if (!ok(fmt) || typeof fmt !== 'string') return null;
    const r = resolve(v, mods); if (!r) return null;
    let out = '';
    for (let i = 0; i < fmt.length; i++) {
      if (fmt[i] !== '%') { out += fmt[i]; continue; }
      i++; if (i >= fmt.length) return null;
      const s = spec(fmt[i], r.t, r.subsec); if (s === null) return null;
      out += s;
    }
    return out;
  },
};
