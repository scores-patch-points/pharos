# Pre-registration: is the pharos read side "intelligent"? A falsifiable test with a small model, pointers and excerpts only

Written 2026-11-13 BEFORE any code in `harness/` was run and before any question exists. Stamped with `.sha256` and `.time`. Nothing in this folder claims a result on the real engine. The harness is run only against a stub engine and a stub model (section 12), to show that its own controls work.

Companion, stamped separately: `QSET-SPEC.md` (how a DIFFERENT agent writes and seals the questions, blind to the engine).
Pins written before stamping: `DATA-PIN.json` (hashes of the real data this test may draw from) and `ENV-FOUND.json` (what is installed on this machine).

## 0. Where this comes from, and the corrections it already carries
The user's direction: the pharos should grow into an intelligent database installed through any door; "intelligent" is currently only a claim; the vision is a substrate where a small, possibly local model does complex work and most of the bookkeeping is auditable and unconscious to the model (memory notes: `feedback_no_full_content_stigmergic_local`, `project_vision_small_model_substrate`, `plan-cheapest-editing-model`). The same notes say what was NOT shown: "no small model has run on the substrate". This test is the stamped version of that sentence. Rules honoured: real problem first (questions come from two real logs, no invented story), decision rules and mutants fixed before results, earned never typed (every bar of mine is marked as mine and carries a noise-floor rule), the model never reads a whole log.

Two facts found while preparing, both of which change the wording of the task:
1. **The Premiere replay is not at `ledgers/pharos-premiere/`.** It is at `phasepost-labels/pharos-premiere/out/pharos-premiere` (21 files, 10,244 entries, 10,361,143 bytes), with its raw sources in `phasepost-labels/pharos-premiere/data`. Pinned in `DATA-PIN.json`.
2. **No small generative local model is installed** (section 7 and `ENV-FOUND.json`). Ollama 0.40.16 holds `qwen3-embedding:4b` and `nomic-embed-text`, both embedding models; llama.cpp binaries are present with no weights; no mlx, torch or transformers. So the model-facing part is a model-agnostic adapter, a scripted stub, and a decision for the user.

## 1. The claim, and what "intelligent" means here (operational, not general)
**Claim C.** A SMALL LOCAL model that is shown only pointers and bounded excerpts of a pharos (never the whole log; state lives in the environment; the model asks) answers questions about the log as well as the same kind of model given the full relevant content in context, where that is possible at all, and each read-side feature makes a measurable difference (DMD, difference that makes a difference) to accuracy, to confident-wrong answers, or to cost.

"Intelligent" is used in exactly this sense and no other: **answer quality per unit of content shown to the model, with errors turned into "unknown" or "held" where the log does not determine the answer.** It is not a claim about reasoning, understanding or generality. If the test supports C it supports that operational reading.

The three read-side features under test (named as in `ledgers/pharos-lazy/PREREG-A2`, `A4` to `A8`):
- **G, schema as ground.** The schema entries for the kinds a question touches, resolved as of the question's position, come first and bound the read: which kinds, fields and slots can exist, the collapse rule, and an explicit status when the log cannot ground the question (`no-ground`, `ruled-out`, `incomplete`) instead of an empty answer presented as determined.
- **H, held pasts with a survivor count.** The answer is returned as the held set (the superposition: every live head, retractions as marks) with `survivors = k` (1 determined, more than 1 held, 0 ground and data disagree), collapsed only if the question names a collapse rule. Without H the read returns the single causal-latest value and no count.
- **T, scent trails.** Verified hints, deposited as a by-product of earlier successful reads, that order where the engine looks first and surface as `next_look` pointers. Trails never supply an answer (A7: no authority); with every trail removed no answer may change, only cost.

Decomposition of C into four testable parts:
- **C1 parity.** Full read side (G+H+T, pointers and excerpts) versus full context, same model, on logs small enough for full context to fit.
- **C2 scale.** The pointer arms do not degrade as the log grows to sizes where full context cannot run (full context is RIGHT-CENSORED there: recorded as infeasible, never truncated).
- **C3 feature DMD.** For each of G, H, T: its effect on accuracy, confident-wrong rate and cost, measured both by adding it to the bare arm and by removing it from the full arm.
- **C4 audit.** The substrate's bookkeeping is auditable: answers carry cites that resolve; a recorded tool trace replays against the engine with no model; wrong answers are caught by the audit more often than not (section 9, M5 and M6). This is the second half of the vision sentence ("auditable and unconscious").

## 2. Data and ground truth: what is known, and how
Two real sources, pinned by hash in `DATA-PIN.json` before this stamp. No planted forks, no invented stories in the verdict set. Synthetic logs appear only in the harness self-test (section 12) and are labelled STUB.

### 2.1 Premiere replay (the Oracle film's Premiere coordination)
10,244 entries, 21 writer files, 3,363 addresses, 17 lane names; entries carry `of` (8,949 with a non-empty `of`) and `seen`. It was built mechanically from 6,568 raw write calls (`TOOLLOG.jsonl`, `EDITLOG.jsonl`, identical in tool, time and args, 0 differences, all `ok`) plus 3,613 permit flag files (raised 1,227, granted 1,132, denied 95, released 1,087, reconciled 72).
Two classes of truth, kept apart:
- **R-raw** (independent of the pharos conversion): computed from the raw `TOOLLOG.jsonl` and `flags/*` by an oracle the question author writes. Known for: the first and last lane (`who`) to write a call whose `args.clipId` is X, by `ts`; the set of lanes that wrote to X (258 of 1,864 clip ids have two or more lanes, per the earlier T4 result, a number to be recomputed by the oracle, not trusted); the leases active at a time T (granted at or before T, not released, before expiry; the author states the exact rule in the question and pins it).
- **R-fold** (independent of the engine under test): computed from the replay entries by an independent from-scratch fold the author writes (heads by `of`, A1 item 4'). Known for: how many live heads an address holds as of a cut, whether a value is retracted, causal-latest by position key.
- **Known to be NOT in the data (UNKNOWN_BY_DATA).** The response of a call, therefore the id of the clip a call CREATED, is not logged (earlier T5 result: 0 before-states in any source, created ids not recoverable from args). So "who created clip X" has the correct answer "not recorded" for almost every X; what the log supports is "which lane FIRST WROTE to X". The set includes both questions and scores a model that answers the second as if it were the first as WRONG, and one that says "not recorded" as right. The prose `BUILD_LOG.md` is NOT a truth source here (hand-written, partly reconstructed after the fact); it is pinned only as context.
- Known weaknesses of this truth, stated: 124 entries have `t_source = t+offset` (a reconstructed time) and 63 have none; a question whose answer would flip if those times moved by their stated imprecision is excluded by the author (rule in the spec). There are 0 cross-lane ties on a clip's last write in the replay, so "last writer" is well-defined for every clip-address entry.

### 2.2 Ellison statements ledger
764 entries in three writers (scout 37, extractor 474, verifier 253), 883,220 bytes: 202 extracted statements, 153 attributed (133 plain, 20 with caveat), 49 not established, 117 excluded runs, 8 negative-control sources where his name occurs but he is not the speaker; built from `out/pilot_results.json` and `revision.json` (gate decisions: V02-02, P04 S01, P04 S05, P03-04 withheld; V02-03 override).
- **R-raw:** the extractor's text and the verifier's `text_reproduced`, `ref_reproduced`, `attribution_check` fields in `pilot_results.json`, and the gate/caveat decisions in `revision.json`. "What did he say" is KNOWN only for statements whose text the verifier reproduced from the source (`sidecar window`, read-only; the ledger itself says reproduction is unverifiable for V02 and P03, so those are excluded as KNOWN-text).
- **What this tests and what it does not.** It tests whether the read side lets a small model REPORT the ledger faithfully: exact words, the attribution status and its stated basis (a cue before the run = T2 leading; a cue only after = withheld; no basis = not established), and above all that it does not turn "not established" or "not his" into an attribution. It does NOT test whether Ellison really said a line: that rests on the ledger's own gate, which is a ruling by its authors. CLAUDE.md Rule two stands: any new extraction or quote still goes through sidecar (`sidecar window`, `sidecar holo verify`); the question author may use those read-only to re-check a text, never to produce new ledger material.

### 2.3 What the truth files must contain
Each question's truth: `{status: KNOWN | UNKNOWN_BY_DATA | HELD, answer, evidence_ids[], derivation, as_of?}` with `derivation` naming the oracle rule and its inputs (R-raw or R-fold, file, line or entry id). A truth with no evidence ids is rejected by the sealer.

## 3. Question families (types drawn from the real problems)
Per `QSET-SPEC.md` the author writes the actual questions; this section fixes the families and answer types only.

| Family | Source | Ask | Answer type | Truth |
|---|---|---|---|---|
| PQ-FIRST | Premiere | which lane first wrote to clip X | lane | R-raw |
| PQ-CREATOR | Premiere | which lane created clip X | lane or "not recorded" | UNKNOWN_BY_DATA mostly |
| PQ-LAST | Premiere | which lane wrote last to clip X | lane | R-raw |
| PQ-LAST-ASOF | Premiere | same, as of time T | lane | R-raw |
| PQ-LANES | Premiere | how many lanes wrote to X; did lane L write to X | int, bool | R-raw |
| PQ-INFLIGHT | Premiere | was any lease active at T; which lanes held one | bool, lane set | R-raw (flags) |
| PQ-HELD | Premiere | how many live values does address A hold as of T; is any value retracted | int, bool | R-fold |
| EQ-SAY | Ellison | what did he say in source S between t0 and t1 | text | R-raw, KNOWN only if verified |
| EQ-BASIS | Ellison | is statement L attributed to him, on what basis and tier | enum + cue | R-raw (gate) |
| EQ-CONTROL | Ellison | did he say the quoted line in control source C | "not his" or "not recorded" | R-raw (controls) |
| EQ-COUNT | Ellison | how many statements are attributed in source S | int | R-raw |
| EQ-ASOF | Ellison | was L attributed before patch 1 / revision 1 | enum | R-fold (superseded markers) |

Strata, required by the spec and used for specificity (section 11, rule D5): **S_G** questions that need the ground (undeclared kind, declared-absent slot, an answer that changes across a schema or declaration change, or UNKNOWN_BY_DATA); **S_H** questions with two or more live heads, a retraction, or zero survivors; **S_T** clusters of three or more similar or repeated questions and deep-past questions; **S_0** feature-irrelevant questions (a single live head, a declared kind, a first-seen address) where no feature should matter. If real data cannot supply a stratum at its minimum size the gap is REPORTED and that feature's claim is "not testable on this data"; no case is planted to fill it.

## 4. Tiers (log size), and why a full-context baseline cannot always exist
The whole Premiere replay is 10,361,143 bytes (about 3 million tokens at 3.5 characters per token, an estimate); the Ellison log 883,220 bytes (about 250 thousand tokens). A small local model's context is a few tens of thousands of tokens. So:
- **L0** a slice whose compact serialisation is at most 0.5 of the smallest test model's context (rule, not a number: the author reads `ENV-MODELS.json`, written by the user or orchestrator once the models are chosen, then sets the slices before sealing). Full context is feasible.
- **L1** at least 4 times L0, within 0.5 of the largest context among the test models (and within the frontier context if a frontier reference arm exists).
- **L2** the whole source. Full context is infeasible for the small models; for a frontier model only the Ellison log might fit.
A slice is `{source, from_at, to_at}` over all entries, ids unchanged; `of` ids outside the slice stay dangling and the oracle is run on the slice. Each question belongs to one tier; truth is computed on that tier's log.

## 5. Arms
Notation: G, H, T each on or off. Everything not named is held CONSTANT across all pointer arms (section 8).

**Pointer arms (full 2x2x2 factorial, same model, same questions, same tier logs):**
`P000` bare (no ground, collapsed single value, no trails), `P100` G, `P010` H, `P001` T, `P110` G+H, `P101` G+T, `P011` H+T, `P111` full read side.
- With H off, `ask` returns `value` (causal-latest) and no `held`, no `survivors`. With G off the tool `schema` is absent, no `ground` block or `status` appears, and an undeclared kind returns an empty result. With T off no `next_look` appears and the engine keeps no trails.

**Baselines and references:**
- `F` full context, the same model, one turn, no tools: the engine adapter's `dump()` of the tier log in compact JSONL. Run on L0 and (if it fits) L1. If the prompt exceeds 0.8 of the model's context the run is recorded `INFEASIBLE`, never truncated.
- `FX` full context, frontier reference model (optional; needs an adapter and a key supplied by the user through an environment variable by NAME; no code in this folder reads, stores or prints a key). Reported beside, never pooled with, the small-model arms.
- `CB` closed book: the model gets only the question text, no engine, no log. It estimates what priors and question wording alone give (control N6).
- `SC` the scripted copy policy (non-LLM): issues the canonical calls and copies the fields. It measures how much of the score is the engine and the tool shape, not the model (a ceiling reference, section 10).
- `EX` the scripted expert policy that uses each feature correctly when present: the positive control.

**Ablations at every level (stage B, run for any feature whose stage A verdict is WIN or LOSE on any metric, and always for the full arm):**
- G ladder: G0 none; G1 kinds and fields only; G2 + collapse rule and window; G3 + explicit `no-ground`/`ruled-out`/`incomplete` statuses.
- H ladder: H0 collapsed value; H1 held set without count; H2 held set with count; H3 + retraction marks and conflict episodes.
- T ladder: T0 none; T1 `next_look` hints, unverified; T2 hints verified by rehash before display; T3 + reinforcement counts; T4 + DMD evaporation (A8); the fixed-E variants of A7 as comparators.
- Within-feature DMD: each ladder step is compared with the step below it by the section 11 rule.

**Poisoned arms (planted corruption of ONE feature by a wrapper around the engine adapter, same shape and length as the real field; they are engine-agnostic mutants):** `X-G` ground of a different kind; `X-H` survivor count off by one and one held value dropped; `X-T` `next_look` pointing at random valid addresses; `X-V` the single `value` replaced by the previous head (stale). A feature earns credit only if its poisoned form does NOT keep the benefit: if poisoning changes nothing, the model is not using that feature, and the feature's apparent DMD is attributed elsewhere (extra length, layout).

## 6. What the model sees and does (protocol, fixed now)
- Per question the controller sends a fixed system prompt (hashed in the manifest), the tier-agnostic question text, the answer format, and the arm's tool list: `ask`, `lane`, `range`, `read`, plus `schema` when G is on. One JSON object per model turn: `{"tool": name, "args": {...}}` or `{"final": {"status": "answer"|"unknown", "answer": ..., "survivors": n?, "cite": [id prefixes]}}`.
- Every tool result is bounded by `CAP_CHARS = 2000` (a value of mine, named in one place) and by the engine's own page size; a result cut by the cap carries `truncated: {shown, total}` and a `more` pointer; the harness counts every truncation. The model is never sent an entry id's content twice (a per-run seen ledger returns a pointer line instead, as in sidecar `serve.mjs`).
- At most 8 tool turns (a value of mine); after that the controller asks for a final answer once. One malformed output gets one re-prompt (counted as a format error); a second ends the question as `unknown` with `format_failure = true`.
- Temperature 0, fixed seed where the runtime supports one; the adapter records the model digest, the runtime version and every sampling parameter it set.
- Trails persist across the questions of one run in the pre-registered stream order (`stream_order` in the sealed question file) and are reset between runs; nothing persists across runs or arms.

## 7. Models and adapters
**Found:** no small generative model is installed (section 0, `ENV-FOUND.json`). **Designed for:** an adapter interface `complete({system, messages, max_out, seed}) -> {text, usage?}` and `info() -> {name, digest, ctx_tokens, params, class}`. `models/stub-model.mjs` (scripted, deterministic) is the only model run in this folder. `models/llm-adapter.mjs` is a skeleton for an Ollama or llama-server HTTP endpoint on localhost and is UNTESTED (nothing to test it against).
**Pre-registered selection rule, to be satisfied by the user's choice before any real run, recorded in `ENV-MODELS.json` before the questions are sealed:** at least two generative models of different size classes (roughly 1 to 4 billion and roughly 7 to 9 billion parameters), runnable on this machine (24 GiB), local, with license and digest recorded; plus the verdict is always reported per model and never pooled. Naming the models is the user's call (decision D1 in the report). An option that needs no new family: a generative variant of the Qwen3 family already present as the 4B embedding model; that is a download and is NOT done here.
Tokens are taken from the adapter's `usage` when it reports them; otherwise characters divided by 3.5 are reported and flagged as an estimate.

## 8. Constants across pointer arms (not under test; any of them could be an ablation later)
Question text and answer format; system prompt; tool names and argument shapes; `CAP_CHARS`; page size; max turns; seen-ledger de-duplication; temperature and seed; question and trail-stream order; slice logs; the engine's collapse rule where a question names none (causal-latest by position key). The full-context arm differs by construction (one turn, whole slice) and is reported as a different kind of arm.

## 9. Metrics (every run, every arm, every model, per question)
- **M1 accuracy.** Correct = `status: answer` with the truth answer (normalised exact match; for `text`: strip the time prefix, collapse whitespace, case kept; word F1 reported beside), OR `status: unknown` when truth is UNKNOWN_BY_DATA, OR the right survivor count when truth is HELD.
- **M2 confident-wrong rate.** `status: answer` with an answer that is not the truth (including any answer to an UNKNOWN_BY_DATA question).
- **M3 abstain-on-known rate.** `unknown` when truth is KNOWN. (Not wrong, not credited.)
- The 3 x 3 table (truth KNOWN, UNKNOWN_BY_DATA, HELD against right, wrong, unknown) is stored per arm: "wrong versus unknown" is the point of H and G.
- **M4 cost.** Characters shown to the model (all turns, tool results included), model calls, tool calls, characters generated, tokens (reported or estimated), and from the engine `bytes_read`, `entries_parsed`, `files_opened` deltas per question.
- **M5 silent-wrong rate.** Wrong answers whose cites all resolve to real entry ids AND intersect the truth's evidence ids (the audit would not flag them) over all wrong answers. Caught-wrong = a wrong answer whose cites fail either check.
- **M6 audit replay.** The recorded tool-call trace, replayed against a fresh engine with no model, reproduces every tool output byte for byte (trail state excepted, reported separately). Fraction of runs.
- **M7 supported accuracy.** Correct AND cited evidence intersects the truth's evidence ids (a correct guess with no support is reported as unsupported).
- **M8 format failures, truncations, turn-limit hits, infeasible runs**, reported, never hidden.

## 10. Controls (run on the stub now; run again on the real engine BEFORE any arm verdict is read, and a control failure voids the dependent verdicts)
Null:
- **N1 constant-unknown.** Always `unknown`: accuracy equals the share of UNKNOWN_BY_DATA questions exactly, wrong rate 0.
- **N2 random answerer** (seeded): accuracy within its own interval of chance; no feature shows an accuracy DMD (all within the noise band).
- **N3 identical-arm replay** (same arm twice): the paired difference interval contains 0. Its half-width is the TEST-RETEST noise floor used in section 11.
- **N4 blind engine** (every tool returns empty): the honest policy scores unknown everywhere (wrong 0); the guessing policy shows wrong greater than 0, proving the table separates wrong from unknown.
- **N5 shuffled log** (entries' addresses permuted): the expert policy's accuracy falls to the closed-book level; answers come from the log.
- **N6 closed book** `CB`: every arm must beat it by more than the noise floor, else the questions leak priors or wording and the set is rejected.
Positive:
- **P1 expert ceiling.** `EX` on P111 scores at least 0.99 (stub and real). Below that, the question set or the engine is defective, not the model.
- **P2 planted-effect recovery (stub).** A stub log where each feature is built to matter by a known amount: the estimator recovers each planted effect within its interval, and a feature planted at zero is reported TIE.
- **P3 full-context ceiling.** The scripted reader given `dump()` answers all L0 questions; proves the dump holds the information.
- **P4 poison sensitivity.** Each poisoned arm scores below its clean arm for the policy that trusts that field.
- **P5 seal tamper.** Changing one byte of a sealed question or answer file makes the run refuse to start.
- **P6 determinism.** Two runs with the same seeds produce byte-identical result files (stub).
- **P7 secret redaction.** A fake token string planted in an environment variable and in a prompt never appears in any trace or result file.

## 11. Decision rules (neutral; fixed now)
For any contrast `a` versus `b` (an arm pair, or a ladder step) and metric m, per model and per tier: `d = m(a) - m(b)` over the same questions, pairs by question, 95 percent interval from a cluster bootstrap (resample question clusters, B = 10,000, seed 20261113 then +1 per metric in the order M1, M2, M4). Questions in one similarity cluster are not independent, hence the cluster resample.
- **MEI (minimum effect of interest), mine, stated as mine:** accuracy and confident-wrong rate 0.05 absolute; cost 10 percent relative (ratio of paired medians). Effective MEI = the larger of that and the half-width of the N3 test-retest interval for that metric. Sensitivity at 0.02 and 0.10 is reported, not decisive.
- **WIN:** the whole interval is beyond +MEI in the good direction (higher accuracy, lower wrong rate, lower cost). **LOSE:** the whole interval is beyond MEI in the bad direction. **TIE:** the whole interval lies inside [-MEI, +MEI]. **INCONCLUSIVE:** anything else (reported as such; it is not a win and not a tie; it means more questions were needed).
- Rules by claim part (each stated per model, never pooled):
  - **D1 parity (C1).** `P111` versus `F` on accuracy at L0 (and L1 where F runs): WIN or TIE on M1 supports "as well as"; LOSE refutes it. Cost is reported separately: characters shown, calls.
  - **D2 scale (C2).** `P111` accuracy at L2 versus at L0 on questions of the same families: TIE or WIN supports "does not degrade"; LOSE refutes it. `F` at L2 is recorded INFEASIBLE with the prompt size.
  - **D3 feature DMD (C3), per feature f in {G, H, T}.** Two contrasts: add (`P` with f on versus the bare arm with all others as in the factorial main effect, averaged over the other two features) and drop (`P111` versus `P111` minus f). The claim holds for f on a model if at least one of M1, M2, M4 is WIN in BOTH contrasts, none of M1 and M2 is LOSE in either, and the poisoned arm `X-f` is not a WIN against the clean arm. If both contrasts are TIE on all metrics the claim for f is REFUTED for that model on this data (the feature made no difference that makes a difference). A WIN on cost with a LOSE on M1 or M2 is not a win.
  - **D4 audit (C4).** Supported if M6 is at least 0.99 and the caught-wrong share of wrong answers in `P111` is WIN against `P000`. Otherwise reported as it falls.
  - **D5 specificity.** Each feature's effect must localise: a WIN in its own stratum (S_G, S_H, S_T) and TIE in S_0. A WIN in S_0 means the effect is extra length or layout, not the feature, and the feature's claim is downgraded to INCONCLUSIVE.
  - **D6 overall verdict on C.** SUPPORTED for a model only if D1 is WIN or TIE, D2 is TIE or WIN, D3 holds for all three features, D4 holds, and D5 does not downgrade any, and all controls of section 10 passed. PARTLY SUPPORTED lists exactly which parts hold. REFUTED if D1 or D2 is LOSE. NOT TESTABLE is reported where a stratum, a tier or a model is missing. Two models both required; a result on one is reported as that model's.
- Expectations (mine, NOT hypotheses, and no verdict depends on them): T is mostly a cost effect on the engine side; G matters mostly through the `unknown` answers; H matters mostly where forks or retractions exist; the full-context arm degrades with slice size; the scripted copy policy scores close to the model on many families, which would mean the engine carries most of the intelligence. Each can be wrong.

## 12. What is built now, and what its self-test must show
`harness/` runs end to end against `engines/stub-engine.mjs` (a deterministic synthetic log, STUB) and `models/stub-model.mjs` (scripted policies). It is a skeleton for the real run, not a result. Its self-test (`harness/selftest.mjs`) must show: every control N1 to N5 and P1 to P7 passes on the stub (N6 and the real question families wait for the real set), the planted effects are recovered, and every harness mutant below is caught. The stub questions are generated by the harness for its own test, are labelled STUB, are not the real question set, and are never mixed with it.

## 13. Mutants the tests must catch
Harness mutants (run now by `harness/mutants.mjs`; each must be caught by at least one control, test or check; survivors are listed):
H1 scorer counts `unknown` as correct for every truth status; H2 scorer ignores UNKNOWN_BY_DATA (abstain on it counts as wrong); H3 the truth is placed in the model prompt; H4 arm flags are ignored (all arms identical); H5 only the first call's characters are counted; H6 the full-context arm silently truncates instead of reporting INFEASIBLE; H7 the paired bootstrap pairs by position after a shuffle (unpaired); H8 the verdict rule has its direction reversed; H9 an unseeded random source is used (non-reproducible); H10 the seal check is skipped; H11 a trail is allowed to supply the answer (engine returns a stored answer); H12 the survivor count is dropped but the held set kept under H on; H13 the oracle imports or reads the engine (circular truth); H14 the model-reply cache key omits the arm; H15 tool results are not counted in characters shown; H16 the secret redactor is a no-op; H17 the seen-ledger de-duplication is off for one arm only; H18 the controller lets the model see `stratum` or `family` labels.
Engine-level sensitivity mutants (the poisoned arms of section 5, to be run on the real engine in stage 2): lying survivor count, dropped head, stale value, wrong-kind ground, forged trail, a trail that supplies an answer, ground resolved by the latest schema for a past cut. Each must move the relevant verdict toward LOSE; one that does not shows the model or the harness does not use that feature.

## 14. What it would teach about EO (stated now)
- **Ground before figure.** The holon note says you cannot sense without a ground. G tests whether giving a perceiver its ground first changes what it can do: expected to show up as `unknown` becoming an earned answer (no-ground, ruled-out) rather than a confident wrong one. If G makes no difference, the ground is bookkeeping the model did not need, and that is the finding.
- **Hold, do not collapse.** H is the wave fold's commitment in a reader: collapse only at projection, and the count of survivors as the readout. If exposing the superposition to the perceiver lowers confident-wrong answers where the log is under-determined, "held" is doing real work; if the model ignores the count (poisoned count changes nothing) it is not.
- **Relevance earned by traversal.** T carries no label, only use. If trails lower cost with no change in any answer, relevance can be earned without typing it; if answer quality moves with trails, they behave as trusted checkpoints, the line the user ruled out.
- **Perspective-dependence.** Arms are perceivers with different grounds over one log. Beside accuracy, the test stores which questions FLIP between arms (same question, different perceiver, different answer), the measure the perceiver-relative-roles note prefers to agreement with any label.
- **Audit as unconsciousness.** M5 and M6 test whether the record, not the model's self-report, is what makes errors visible.

## 15. Limits (what a pass would NOT show)
- Two logs from one user's work, one machine, one language (English), JSON entries. Not other data, binary records, concurrent writers, or other users.
- "Intelligent" only in the operational sense of section 1; no claim about reasoning or general ability. Truth for Ellison is the ledger's ruling, not what he said.
- The effect of a feature depends on whether the real data has the strata that need it; a missing stratum makes that claim NOT TESTABLE, not false.
- The MEI, the cap, the turn limit, the page size and the 0.5 tier rule are mine, tuned by nobody; the sensitivity analysis and the test-retest floor limit but do not remove that.
- The scripted copy policy may show the engine, not the model, carries the answers; that would qualify C ("the substrate is intelligent") rather than support it for the model.
- Results hold for the models chosen and their quantisation; a larger or smaller model may differ. Trails are tested only for answer quality here; their cost DMD is the sibling prereg A8.
- The question author and the engine builder are different agents but share this repository and the same user; blindness is by instruction and by file access rules, auditable in the author's declaration, not enforced by the machine.
- Nothing is run on the real engine here; the stub tests the instrument, not the claim.

## 16. Stage dependencies (what this waits for)
- **Stage 1 (placed log, in `ledgers/pharos-lazy`, not touched here):** gives `ask` with `held` and `rule`, `lane`, `range`, `scan`, `plan`, `stats` (bytes, entries parsed): enough for the `P010` and `P000` arms and for cost accounting.
- **Stage 2:** (a) an adapter over that engine implementing section 6 and the contract in `harness/README.md`, with feature flags that change response shape; (b) schema entries (the ground) for the kinds of both logs, DERIVED MECHANICALLY from the data and logged before any run (no typed thresholds; recorded in a stamped `GROUND-DERIVATION.md` by the stage-2 builder); (c) ground-first backward fold and the status values (A4, A5, A6 R-count); (d) trails and DMD evaporation (A7, A8) with a `next_look` surface and a verified-hint check; (e) a slice loader that builds a placed log from `{source, from_at, to_at}`; (f) excerpt caps and `read N of M`.
- **Outside the engine:** the user's choice of models (D1), the sealed question set by a different agent (QSET-SPEC), `ENV-MODELS.json`, the compute budget (estimate, not measured: about 480 test questions x 8 pointer arms x 2 models x about 3.5 calls, roughly 27,000 model calls plus full-context and ablation runs, hours to days on this machine).

## 17. Order of events (so the stamps mean something)
1. This file and `QSET-SPEC.md` are stamped. 2. The harness self-test runs on the stub; its output goes to `out/` and is a harness result only. 3. A different agent writes and seals the questions and the oracle (`qset/`), with stamps. 4. The user fixes the models; `ENV-MODELS.json` is written. 5. Stage 2 delivers the adapter, schema derivation and features. 6. Controls N1 to N6 and P1 to P7 run on the real engine; any failure stops the run. 7. Stage A (`P000`, `P111`, `F`, `CB`, `SC`, `EX`) then stage B (the other arms, ladders, poisons). 8. Verdicts are computed by the harness from the rules above; any change to a rule after step 1 is an amendment file (`PREREG-A1.md` and so on), stamped, never an edit of this file.
