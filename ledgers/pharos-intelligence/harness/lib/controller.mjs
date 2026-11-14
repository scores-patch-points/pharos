// controller.mjs: runs ONE question for ONE arm against an engine adapter and a model adapter.
// Everything the model sees passes through here, is counted here, and is bounded here (PREREG section 6).
//
// The model never receives: the truth, the stratum, the truth_status, the sealed file path, or an uncapped tool result.
import { sha256, redact, envSecrets } from './util.mjs';

export const CONSTANTS = {
  CAP_CHARS: 2000,      // per tool result (value of mine, PREREG 6)
  MAX_TURNS: 8,         // tool turns before a final answer is forced (mine)
  REPROMPTS: 1,         // one re-prompt per malformed reply
  FULL_FIT: 0.8,        // F arm infeasible above this share of context
  CTX_CHARS_PER_TOKEN: 3,
  TOKEN_EST_CHARS: 3.5, // token estimate when the adapter reports no usage (flagged as an estimate)
};

export const SYSTEM_PROMPT = [
  'You answer one question about a log of recorded events by asking a read tool. You never see the whole log.',
  'Reply with exactly ONE JSON object per turn, nothing else:',
  '  {"tool": "<name>", "args": {...}}   to call a tool, or',
  '  {"final": {"status": "answer" | "unknown", "answer": <value>, "survivors": <integer, optional>, "cite": ["<entry id prefix, at least 6 characters>", ...]}}',
  'Say status "unknown" when the log does not determine the answer. Cite the entry ids your answer rests on.',
].join('\n');

export const FULL_SYSTEM_PROMPT = [
  'You answer one question about a log of recorded events. The whole log is given below as JSON lines.',
  'Reply with exactly ONE JSON object: {"final": {"status": "answer" | "unknown", "answer": <value>, "survivors": <integer, optional>, "cite": ["<entry id prefix, at least 6 characters>", ...]}}',
  'Say status "unknown" when the log does not determine the answer. Cite the entry ids your answer rests on.',
].join('\n');

function toolBlock(tools) {
  return tools.map((t) => `- ${t.name} ${JSON.stringify(t.args)}: ${t.doc}`).join('\n');
}

export function parseReply(text) {
  const s = String(text ?? '').trim();
  const start = s.indexOf('{');
  if (start < 0) return null;
  for (let end = s.length; end > start; end--) {
    if (s[end - 1] !== '}') continue;
    try { const o = JSON.parse(s.slice(start, end)); if (o && typeof o === 'object') return o; } catch { /* shorten */ }
  }
  return null;
}

// walk a result and replace entries already shown in this question by a pointer line (the seen ledger)
function dedupe(node, seen, counter) {
  if (Array.isArray(node)) return node.map((x) => dedupe(x, seen, counter));
  if (node && typeof node === 'object') {
    if (typeof node.id === 'string' && node.id.length >= 12 && typeof node.kind === 'string') {
      if (seen.has(node.id)) { counter.n++; return { id: node.id.slice(0, 12), seen: true }; }
      seen.add(node.id);
    }
    const o = {};
    for (const [k, v] of Object.entries(node)) o[k] = dedupe(v, seen, counter);
    return o;
  }
  return node;
}

export function capResult(str, cap = CONSTANTS.CAP_CHARS) {
  if (str.length <= cap) return { text: str, cut: false };
  return { text: str.slice(0, cap) + '...[cut: result exceeded the cap]', cut: true };
}

// One place that turns an engine call into the text the model sees; the audit replay uses the same function.
export function renderToolResult(engine, knownName, askedName, args, seen, ctr) {
  let resText;
  if (!knownName) resText = JSON.stringify({ error: `no tool named ${askedName} in this session` });
  else {
    let r;
    try { r = engine.call(knownName, args); } catch (e) { r = { ok: false, error: String(e.message || e) }; }
    resText = JSON.stringify(r.ok ? dedupe(r.result, seen, ctr) : { error: r.error });
  }
  return capResult(resText);
}

export async function runQuestion({ q, arm, model, engine }) {
  const secrets = envSecrets();
  const info = model.describe();
  const rec = {
    qid: q.qid, arm: arm.name, model: info.name, tier: q.tier, family: q.family, cluster: q.cluster,
    feasible: true, final: null, format_errors: 0, format_failure: false, turn_limit: false,
    model_calls: 0, model_errors: 0, tool_calls: 0, chars_in: 0, chars_unique: 0, chars_out: 0, tokens_in: 0, tokens_out: 0, tokens_estimated: false,
    truncations: 0, dedup: 0, engine: null, trace: [],
  };
  const before = engine ? engine.stats() : null;
  const sys = arm.kind === 'full' ? FULL_SYSTEM_PROMPT : SYSTEM_PROMPT;
  let tools = [];
  if (arm.kind === 'pointer') tools = engine.tools();
  const head = [`QUESTION: ${q.text}`, `ANSWER FORMAT: ${q.answer_format}`];
  if (arm.kind === 'pointer') head.push('TOOLS:', toolBlock(tools));
  if (arm.kind === 'full') {
    const dump = engine.dump();
    const prompt = head.join('\n') + '\nLOG:\n' + dump;
    const ctxChars = info.ctx_tokens * CONSTANTS.CTX_CHARS_PER_TOKEN;
    if (sys.length + prompt.length > CONSTANTS.FULL_FIT * ctxChars) {
      rec.feasible = false; rec.infeasible_chars = sys.length + prompt.length; rec.engine = { bytes_read: 0, entries_parsed: 0, files_opened: 0, calls: 0 };
      return rec;
    }
    head.length = 0; head.push(prompt);
  }
  const messages = [{ role: 'system', content: sys }, { role: 'user', content: head.join('\n') }];
  rec.chars_unique += messages.reduce((a, m) => a + m.content.length, 0);
  const seen = new Set();
  const ctr = { n: 0 };
  let reprompts = 0, forced = false;

  const callModel = async () => {
    const chars = messages.reduce((a, m) => a + m.content.length, 0);
    rec.chars_in += chars;                          // sum over calls: what the model must actually read
    const r = await model.complete({ system: sys, messages: messages.map((m) => ({ ...m })), max_out: 400, seed: 20261113 });
    rec.model_calls++;
    if (r.error) { rec.model_errors++; rec.last_model_error = redact(r.error, secrets).slice(0, 200); }
    rec.chars_out += (r.text || '').length;
    if (r.usage && Number.isFinite(r.usage.in_tokens)) { rec.tokens_in += r.usage.in_tokens; rec.tokens_out += r.usage.out_tokens || 0; }
    else { rec.tokens_estimated = true; rec.tokens_in += Math.ceil(chars / CONSTANTS.TOKEN_EST_CHARS); rec.tokens_out += Math.ceil((r.text || '').length / CONSTANTS.TOKEN_EST_CHARS); }
    return r.text || '';
  };

  for (;;) {
    const text = await callModel();
    const obj = parseReply(text);
    const step = { out: redact(text, secrets).slice(0, 600) };
    if (!obj || (!obj.tool && !obj.final)) {
      rec.format_errors++;
      rec.trace.push({ ...step, format_error: true });
      if (reprompts >= CONSTANTS.REPROMPTS) { rec.format_failure = true; rec.final = { status: 'unknown', answer: null, cite: [] }; break; }
      reprompts++;
      messages.push({ role: 'assistant', content: text }, { role: 'user', content: 'Your reply was not one JSON object with "tool" or "final". Reply again.' });
      rec.chars_unique += messages[messages.length - 1].content.length;
      continue;
    }
    if (obj.final) { rec.final = obj.final; rec.trace.push({ ...step, final: true }); break; }
    // a tool call
    if (arm.kind !== 'pointer') { rec.format_errors++; rec.final = { status: 'unknown', answer: null, cite: [] }; rec.format_failure = true; break; }
    if (rec.tool_calls >= CONSTANTS.MAX_TURNS) {
      if (forced) { rec.turn_limit = true; rec.final = { status: 'unknown', answer: null, cite: [] }; rec.trace.push({ ...step, turn_limit: true }); break; }
      forced = true;
      messages.push({ role: 'assistant', content: text }, { role: 'user', content: 'No more tool calls are allowed. Give your final answer now.' });
      rec.chars_unique += messages[messages.length - 1].content.length;
      continue;
    }
    rec.tool_calls++;
    const known = tools.find((t) => t.name === obj.tool);
    const { text: shown, cut } = renderToolResult(engine, known ? obj.tool : null, obj.tool, obj.args || {}, seen, ctr);
    if (cut) rec.truncations++;
    rec.dedup = ctr.n;
    rec.trace.push({ ...step, tool: obj.tool, args: obj.args || {}, result_sha: sha256(shown), result_chars: shown.length, cut });
    messages.push({ role: 'assistant', content: text }, { role: 'user', content: 'RESULT: ' + shown });
    rec.chars_unique += shown.length;
  }
  if (engine) {
    const after = engine.stats();
    rec.engine = Object.fromEntries(Object.keys(after).map((k) => [k, after[k] - (before[k] || 0)]));
  }
  return rec;
}

// closed book: the model gets the question text only, no engine, no tools
export async function runClosedBook({ q, arm, model }) {
  const sys = 'Answer from the question alone; no log is available. Reply with exactly ONE JSON object: {"final": {"status": "answer" | "unknown", "answer": <value>, "cite": []}}';
  const rec = { qid: q.qid, arm: arm.name, model: model.describe().name, tier: q.tier, family: q.family, cluster: q.cluster, feasible: true,
    final: null, format_errors: 0, format_failure: false, turn_limit: false, model_calls: 1, tool_calls: 0, chars_in: 0, chars_unique: 0, chars_out: 0,
    tokens_in: 0, tokens_out: 0, tokens_estimated: true, truncations: 0, dedup: 0, engine: { bytes_read: 0, entries_parsed: 0, files_opened: 0, calls: 0 }, trace: [] };
  const messages = [{ role: 'system', content: sys }, { role: 'user', content: `QUESTION: ${q.text}\nANSWER FORMAT: ${q.answer_format}` }];
  const chars = messages.reduce((a, m) => a + m.content.length, 0);
  rec.chars_in = chars; rec.chars_unique = chars;
  const r = await model.complete({ system: sys, messages, max_out: 400, seed: 20261113 });
  rec.chars_out = (r.text || '').length;
  rec.tokens_in = Math.ceil(chars / CONSTANTS.TOKEN_EST_CHARS); rec.tokens_out = Math.ceil(rec.chars_out / CONSTANTS.TOKEN_EST_CHARS);
  const obj = parseReply(r.text);
  if (obj && obj.final) rec.final = obj.final; else { rec.format_errors = 1; rec.format_failure = true; rec.final = { status: 'unknown', answer: null, cite: [] }; }
  rec.trace.push({ out: redact(r.text || '', envSecrets()).slice(0, 600), final: true });
  return rec;
}
