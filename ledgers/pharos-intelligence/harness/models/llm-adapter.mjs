// llm-adapter.mjs: SKELETON of a model adapter for a local Ollama or llama-server style HTTP endpoint. UNTESTED.
// No generative model is installed on this machine (ENV-FOUND.json), so nothing here has ever produced a reply.
// It exists so the contract is written down; it must be tested against a real local model before any run is trusted.
//
// Contract (PREREG section 7):
//   describe() -> { name, digest, ctx_tokens, params, class: 'local' | 'frontier' }
//   complete({ system, messages, max_out, seed }) -> { text, usage?: { in_tokens, out_tokens } }
// Rules: temperature 0; the seed is passed where the runtime supports one; every sampling parameter set here is recorded in describe().
// SECRETS: this file reads no key. A frontier adapter, if one is ever added, must read its key from an environment variable by NAME,
// never print or store it, and never put request headers in a trace (the controller redacts, but the adapter must not hand it secrets).

export function makeOllamaAdapter({ endpoint = 'http://localhost:11434', model, ctx_tokens, digest = 'unknown', think = false, format = 'json', fetchImpl = globalThis.fetch } = {}) {
  if (!model) throw new Error('model name required (no default: none is installed)');
  if (!ctx_tokens) throw new Error('ctx_tokens required (record the context the model was loaded with)');
  // think: false is REQUIRED for Qwen3-style models: with thinking on, the whole output budget goes to the hidden `thinking` field and `content` is empty (found on the first smoke test, 2026-11-13).
  // format: 'json' (constrained decoding) is also required: on 2026-11-13 qwen3:4b with think:false and with /no_think still wrote 300 tokens of inline reasoning instead of the JSON object; with format 'json' it answered in 19 tokens.
  const options = { temperature: 0, num_ctx: ctx_tokens, think, format };
  return {
    describe: () => ({ name: model, digest, ctx_tokens, params: options, class: 'local' }),
    async complete({ system, messages, max_out = 400, seed = 20261113 }) {
      const { think: thinkFlag, format: fmt, ...samp } = options;
      const body = { model, stream: false, think: thinkFlag, format: fmt, options: { ...samp, seed, num_predict: max_out }, messages: [{ role: 'system', content: system }, ...messages.filter((m) => m.role !== 'system')] };
      const r = await fetchImpl(endpoint + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) return { text: '', error: 'model endpoint returned ' + r.status + ': ' + (await r.text()).slice(0, 200) };   // a model failure is a counted result (M8), not a crash
      const j = await r.json();
      return { text: j.message?.content ?? '', usage: Number.isFinite(j.prompt_eval_count) ? { in_tokens: j.prompt_eval_count, out_tokens: j.eval_count } : undefined };
    },
  };
}
