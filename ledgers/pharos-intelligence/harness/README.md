# harness: running the pharos-intelligence test (skeleton, stub only)

Everything here is the INSTRUMENT. It has run only against a synthetic stub engine and scripted stub models. No result on the real pharos or on a real model exists. See `../PREREG.md` (with `../PREREG-A1.md`) and `../QSET-SPEC.md` (with `../QSET-SPEC-A1.md`).

```
node harness/selftest.mjs [--out out/selftest] [--B 10000] [--quick]   # all controls on the stub; exit 0 only if every control passes
node harness/mutants.mjs                                               # 18 harness mutants, each must make the quick self-test fail
node harness/run.mjs --qset <sealed dir> --engine <module> --model <module> ...   # the real entry point (refuses without a seal and a controls report)
node harness/tools/pin-data.mjs                                        # re-hash the real data sources into ../DATA-PIN.json (read-only on the data)
```
Node built-ins only, no network, no model, no package install. Randomness comes only from `lib/util.mjs` `prng` (seeded).

## Layout
| Path | What |
|---|---|
| `lib/controller.mjs` | Runs one question for one arm: builds the prompt, loops tool turns, caps and counts every result, keeps the seen ledger, one re-prompt, turn limit. The only code that talks to the model. |
| `lib/runner.mjs` | Runs an arm over the stream, scores, audit replay (M6), the paired contrasts and the main effect (A1 item 3). |
| `lib/stats.mjs` | Cluster-resampled paired bootstrap, two-group bootstrap, the WIN / TIE / LOSE / INCONCLUSIVE rule. |
| `lib/verdicts.mjs` | D1 to D6 of PREREG section 11 as amended. |
| `lib/score.mjs`, `lib/arms.mjs`, `lib/poison.mjs`, `lib/seal.mjs`, `lib/study.mjs`, `lib/util.mjs` | Scoring, arm flags and ladders, planted corruption of one feature's field, seal verification and commit-reveal, one-call study driver, hashing/PRNG/redaction. |
| `engines/stub-engine.mjs` | STUB read engine with the G / H / T response shapes. |
| `engines/pharos-lazy-adapter.skeleton.mjs` | Where stage 1 and stage 2 pieces plug in. Throws. Not imported. |
| `models/stub-model.mjs` | Scripted policies (lazy, diligent, copy, random, unknown, closed book, reader). Not language models. |
| `models/llm-adapter.mjs` | Ollama-style HTTP adapter skeleton. UNTESTED: no generative model is installed. |
| `stub/` | Synthetic log generator, stub question generator and sealer, the stub oracle (imports nothing from engines or models), shared world. |
| `selftest.mjs`, `mutants.mjs`, `run.mjs`, `tools/pin-data.mjs` | Entry points. |

## Engine adapter contract (what stage 2 must implement)
`makeEngine(sliceId, features) -> engine`, `features = {G, H, T}` each 0 or 1. The engine for a slice holds its own trail state; `reset()` clears it.
```
engine.tools()          -> [{name, args, doc}]   ask, lane, range, read, plus schema only when G
engine.call(name, args) -> {ok: true, result: <object>} | {ok: false, error}
engine.stats()          -> {bytes_read, entries_parsed, files_opened, calls}   cumulative; the controller takes deltas
engine.dump()           -> compact JSONL of the whole slice (full-context arm)
engine.ids()            -> Set of every entry id in the slice (citation resolution)
engine.addresses()      -> list of addresses (used only by the poison wrapper)
engine.reset()
```
**Response contract** (field names the model and the poison wrapper rely on):
- `ask` result: `addr`, `total`, `shown: [entry excerpts {id, kind, by, at, of (12-char prefixes), body}]` (bounded), `more` pointer or null.
  - H off: `value` = the collapsed causal-latest entry, no `held`, no `survivors`.
  - H on: `held` = every live head, `survivors` = their count (0 means ground and data disagree), `retracted` marks; `value` only if `rule: "causal-latest"` was asked.
  - G on: `ground {kind, fields, collapse, window, declared}` and `status` in `determined | held | no-ground | ruled-out | incomplete`; an undeclared kind returns no figures, `status: "no-ground"` and a `diagnosis` with the entry ids.
  - T on: `next_look [{addr, why, verified: true}]` (hints that the engine rehashed; never an answer) and cheaper repeat reads (visible only in `stats`).
- `lane` and `range` results: `total`, `shown`, `coverage {scanned}` (a scan that covered nothing must be distinguishable from a blind one).
- Every result must fit the harness cap (`CONSTANTS.CAP_CHARS`, 2000): page by bytes, not by count.
- Feature flags change response SHAPE, never the correctness of what is held. Removing every trail must change no answer (control C-TRAIL-INVARIANCE).

## Model adapter contract
`describe() -> {name, digest, ctx_tokens, params, class}`; `complete({system, messages, max_out, seed}) -> {text, usage?}`. Temperature 0. The adapter never sees truths, strata or sealed paths.

## What the self-test shows, and what it does not
It runs 23 controls (seal, accounting, leak, static scans, null controls N1 to N6, positive controls P1 to P7, controller, trail invariance, dedupe, audit replay, flip accounting) and exercises the verdict machinery on a stub whose effects are planted (G and H matter for a lazy policy, T is cost-only, H does not matter for a diligent policy). The stub's "SUPPORTED" overall verdict is machinery output; it says nothing about the pharos.
It does NOT show: that the real engine, any real model or the real questions behave like the stub; that N6 (closed book with a real model) or P1 and P3 hold on real families (they need scripted policies for the sealed families, QSET-SPEC-A1); that the T poison test is meaningful (vacuous on the stub: no stub policy follows hints).

## Design notes found while building (kept so the next builder does not rediscover them)
1. **The cap can break a result.** The first stub runs had `P110` and `P111` differ on two questions: with G, H and T all on, a page plus `ground`, `held` and `next_look` went over 2000 characters, the harness cut it, the JSON no longer parsed and the policy said unknown. Fixed in the stub by a smaller page. The real adapter must page by bytes; truncations are counted (M8) and a feature that pushes results over the cap would otherwise show up as a false LOSE.
2. **De-duplication inside a result.** The seen ledger also replaces a repeated entry within ONE result (for example `value` equal to the last of `shown`) by `{id, seen: true}`. The stub policies look such pointers up again. A real small model may not; if that costs accuracy it appears as a LOSE for H that is really a layout problem. Candidate for an ablation (the constant set in PREREG section 8).
3. **Strata and cold or warm.** `S_0` (feature-irrelevant) must be the FIRST question of its cluster in stream order, or T shows cost wins in `S_0` and D5 wrongly downgrades it. The first stub labelling got this wrong and D5 flagged it; the stub now labels cold and warm from the stream order. The real author's spec already says cold and warm are defined by `stream_order.json`.
4. **Poisoned arms.** `X-G`, `X-H`, `X-T` corrupt the field of `P111` and are compared with `P111`; `X-V` (stale collapsed value) corrupts `P000` and is compared with `P000`, since `value` is absent from the H-on arms. PREREG section 5 does not say which base; this is the choice made here.
5. **`chars_in` sums the whole prompt of every call** (history re-sent each turn is what the model must read, and what billing counts); `chars_unique` (each piece of content once) is stored beside it. The accounting control requires `chars_in >= chars_unique`.
6. **Bootstrap speed.** Proportions and mean differences resample per-cluster aggregates (O(clusters)); cost ratios resample questions and sort (about 2.5 s per 10,000 draws at 300 questions).

`run.mjs` also writes `flips.json` (which questions change outcome between arms: the perspective-dependence readout of PREREG section 14). Not implemented: stage B ladders (`LADDERS` is data; the engine must expose levels), the frontier arm `FX`, scripted policies for the real families. See `../HARNESS-CHANGES.md`.

## Blocked on stage 2 (PREREG section 16)
(a) the engine adapter with the response contract above; (b) schema entries for both logs derived mechanically and logged (`GROUND-DERIVATION.md`); (c) the ground-first backward fold and the statuses (A4, A5, A6); (d) trails and DMD evaporation with `next_look` (A7, A8); (e) a slice loader; (f) excerpt caps by bytes and `read N of M`. Outside the engine: the model choice (none installed), the sealed question set, scripted `EX`/`SC`/reader policies for the sealed families (from `params`), `ENV-MODELS.json`.
