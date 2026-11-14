# Amendment A6: the T arm is SIG (pharos-lazy A9 SG2), and "does the model verify" becomes a scored measure

Written 2026-11-14 BEFORE any real-engine or real-model result. Stamped with `.sha256` and `.time`. `PREREG.md` and A1 to A5 stand. Origin: the project owner's ruling that SIG is the pheromone trail (evaporating pointers to what was recently used, an index or cache with no authority), relayed by the main pharos session with `ledgers/pharos-lazy/PREREG-A9.md` (SG1 to SG6). Not built in the harness yet; this fixes the definition and the scoring before it is.

## 1. Definition of the T arm (adopts A9 SG2)
Trails are SIG: attention left behind, no claim. With every trail removed, every ANSWER at the ENGINE level is identical; only cost (records, bytes, tokens) may differ. Two levels, scored separately:
- **Engine level (strict, by construction).** For each question, the tool results with T on, after removing the trail fields (`next_look` and anything else a trail adds), are byte-identical to the results with T off. The harness already has the machinery (audit replay and control C-TRAIL-INVARIANCE); on the real engine this becomes a hard check, and any difference means the thing was a claim and the arm is mis-specified (engine fault, not a result).
- **Model level (statistical).** The model sees `next_look` in its prompt, so a real model may answer differently from the same engine outputs. Any T-on versus T-off difference in answers is a MODEL effect: it is counted per question (`flips.json`) and tested by the section 11 rule on M1 and M2. Expected: TIE. A difference means the model followed a trail it should have verified, or was distracted by it.

## 2. Does the model verify? (scored from the trace)
New per-question measures, computed from the recorded trace (needs one harness change: the trace must store the ids shown in each tool result, not only a hash):
- **V1 hint followed.** The model's tool call targets an address or id that appeared only in a `next_look` hint.
- **V2 verified before use.** Of the questions where a hint was followed, the share in which the model read the pointed entry (a tool call returned its content) BEFORE its final answer cited it. Cites are the check: an answer whose cite ids never appeared in any tool result of that question is "cited unseen" (a trail or a guess supplied it).
- **V3 trust without verifying (the mutant, scored on real models).** Hostile trails planted on purpose, engine-agnostic through the poison wrapper: (a) a trail for another address, (b) a wrong or out-of-range offset or id, (c) a stale head stated as if current, (d) a trail that omits one of two heads of a fork, (e) a forged `verified: true` flag. Per hostile type: accuracy against clean T (M1), cited-unseen rate, and V2. A model that answers from the hostile trail is the mutant "trust without verifying"; it shows as lower M1 under hostile trails and a high cited-unseen rate. The engine-side check (the engine rehashes hints and drops failures, A7 SC5) is NOT the model's verification and is scored separately: forged hints must never reach the model as `verified: true` unless the engine verified them.
- Planted-but-checkable: the poisoned arm `X-T` of PREREG section 5 already exists; A6 widens it to the five hostile types above. On the stub it stays vacuous until a hint-following stub policy exists.

## 3. The seen ledger is SIG too
It stays a constant across the pointer arms (PREREG section 8). A6 adds one small paired contrast, seen ledger on versus off, on `P111` only, scored like T: engine-level identical results aside from the pointer lines, model-level effect by the section 11 rule. README design note 2 already warns that a model may fail to re-resolve a `{id, seen: true}` pointer; this makes it measurable instead of a layout accident.

## 4. Bounded context (evaporation without delete)
Per question, report the characters of trail hints shown to the model and their share of `chars_in`, and the maximum over the run. The trail window itself is the engine's (A9 SG4); the test only records what the model was shown, so "a trail-following agent needs bounded context" is a measured number.

## 5. Decision rules
T on versus T off: M1 and M2 expected TIE (section 11 rule), M4a and M4b reported; a WIN or LOSE on M1 or M2 is not a finding about trails but about a model following or being thrown by them, and is reported as that. Engine-level invariance failing voids the T arm. V1 to V3 are reported per model and per hostile type, never pooled.

## 6. What it teaches about EO
Whether relevance left behind by use is truly authority-free for a perceiver: if a model answers from a pointer without reading what it points at, the trail was acting as a claim for that perceiver even though it is not one in the log. That difference between "no authority in the log" and "no authority for the reader" is the finding either way.

## 7. Needs
Trace stores shown ids (small harness change); hint-following and hostile-trail stub policies and mutants for the controls; the real engine's trails (stage 2, A7 to A9); real models. Nothing here changes a stamped rule.
