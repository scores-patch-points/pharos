# Changes and findings after PREREG.md was stamped (2026-11-13)

`PREREG.md`, `QSET-SPEC.md` and their amendments were stamped before any harness code ran. This file lists everything that changed or was found afterwards, so nothing is silently different from what was stamped. No real-engine result exists; every item below concerns the instrument.

## Amendments written (each stamped before the first harness run)
- `PREREG-A1.md`: M4 split into characters shown (M4a) and engine bytes (M4b); D3 reads "any of M1, M2, M4a, M4b"; the add and drop contrasts defined; D1 on the feasible questions of F; noise floor per metric; bootstrap B = 10,000.
- `QSET-SPEC-A1.md` (stamped 06:46 UTC, before the first self-test result): optional `params` field for scripted control policies, never shown to a model.

## Implementation choices PREREG did not fix (made here, listed so they can be challenged)
1. `chars_in` = sum over calls of the whole prompt; `chars_unique` stored beside it.
2. Poison base arms: `X-G`, `X-H`, `X-T` against `P111`; `X-V` against `P000`.
3. D3's poison clause uses `X-f` versus `P111` on M1 only; `X-V` is reported in control P4, not in `featureVerdicts`.
4. D5 specificity metrics: M1 and M2 for G and H; M1 and M4b for T. Needs at least 20 questions in a stratum or reports "too few".
5. D2 (scale) is an unpaired two-group cluster bootstrap on accuracy (the tiers hold different questions).
6. D4 caught-wrong comparison is an unpaired two-group bootstrap over wrong answers only; if either arm has no wrong answers it reports "n/a" and rests on M6.
7. The seen ledger de-duplicates inside one result as well as across calls (design note 2 in `harness/README.md`).
8. Page size, cap, turn limit and re-prompt count are the stated values of mine; `CONSTANTS` in `lib/controller.mjs` is the one place they live.

## Found by running the instrument (stub), fixed in the instrument, not in any rule
- Two forks-never-unresolved errors in the stub generator (forks were resolved by the writes that followed, so no live-head stratum existed): fixed; the self-test control P2 had flagged a planted H effect of zero.
- A planted H effect of 6.6 points returned INCONCLUSIVE, correctly, because its interval straddled the 0.05 MEI; the stub's H share was raised to about 11 points so P2 can show a clean WIN. The rule was not changed.
- The cap truncated a G+H+T page and broke the JSON (README design note 1).
- The first stub `S_0` stratum contained warm questions, so T showed cost wins in `S_0` and D5 downgraded it; the stub labelling now uses the stream order.
- The scripted in-flight policy treated an empty window as unknown, so the expert ceiling P1 was 0.95; an empty scan with `coverage` is now an answer, a result without coverage is not.
- Harness mutants H7 and H17 were caught by different controls than predicted (H7 by N2 and N3, not P2; H17 by C-DEDUPE only, C-AUDIT does not see it because the audit replay builds its own seen set). Listed in `out/mutants.txt`.

## Not implemented in the harness (so not tested)
- Stage B ladders (`LADDERS` is data only; the engine must expose levels) and the sub-feature ablations of PREREG section 5.
- The frontier reference arm `FX` (no adapter, no key; none will be read).
- Scripted `EX`, `SC` and reader policies for the REAL question families (they wait for sealed questions and `params`).
- Control N6 and P1 and P3 on real families; the real-engine controls runner that writes the `controls-report` that `run.mjs` requires.
- Test-retest on a real, non-deterministic model (the stub's floor is 0; control N3 only shows that the machinery raises the floor when noise exists).

## First contact with a real local model (qwen3:4b via Ollama, 2026-11-13; three STUB questions; no claim about the pharos)
- Default thinking mode: whole budget in a hidden field, empty reply. `think: false` and `/no_think` still gave about 300 tokens of inline reasoning and no JSON. Plain `format: "json"` gave a valid object in 19 tokens in a direct test but later aborted with "token repeat limit reached" (HTTP 500) inside the harness. A JSON-schema `format` gave valid objects with no format errors and no model errors over 30 calls. Fixed in `models/llm-adapter.mjs`: `think: false` and a `format` option (pass the schema); recorded as protocol constants in `PREREG-A2.md`.
- The adapter used to throw on HTTP errors, which crashed the run. It now returns `{text: '', error}` and `lib/controller.mjs` counts `model_errors` (a model failure is a result, M8). The quick self-test still passes 23/23 after this change.
- With the schema format the model made 8 tool calls (`range` with an invented kind and dates, empty result each time) and then answered `unknown`, on all three questions. 0 of 3 correct; a first impression, not a result. `PREREG-A3.md` fixes how prompt and tool wording may be tuned (dev split only, then frozen and hashed).
- Each model call took 5 to 25 seconds while another session was downloading qwen3:8b and the GPU was shared; timing is not a measurement.
- qwen3:8b was not installed when this was written; `ENV-MODELS.json` records it as pending.

## Public copy (2026-11-14): scanner cleanup
- The model adapter method `info()` was renamed `describe()` across `harness/` (11 findings: the public-scan tool reads the old method call as a hostname because of the `.info` domain suffix). Behaviour is unchanged. The stamped prose in `PREREG.md` section 7 and `PREREG-A2.md` still says `info()`; read that as `describe()`. Quick self-test after the rename: 23/23 controls; harness mutants re-run (see the PR).
- `HARNESS.sha256` was regenerated for the public copy and no longer lists `harness/tools/pin-data.mjs` (omitted: it hard-codes a local path). Three prose files carry a redaction recorded in `REDACTED.md`, so their stamps refer to the private originals.
