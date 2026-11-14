# Question-set specification: a different agent writes and seals the questions, blind to the engine

Written 2026-11-13, stamped with `.sha256` and `.time`, together with `PREREG.md` (which this serves: sections 2 to 4 and 10 of it). The agent who builds the harness (me) writes this spec and NOT the questions. The agent who writes the questions is called the AUTHOR below. The AUTHOR is a fresh session, not the one that wrote `PREREG.md`, not any session that builds or tests the engine, and not a model that will be a test model.

## 1. Blindness rules (what the AUTHOR may and may not touch)
**May read:** `PREREG.md`, this file, `DATA-PIN.json`, `ENV-MODELS.json` (once it exists), the pinned data itself (the Premiere replay and raw sources, the Ellison pharos and its build inputs, all listed in `DATA-PIN.json`), `harness/README.md` section "question and truth files" only, and, read-only, `sidecar window` and `sidecar holo verify` for re-checking an Ellison text (CLAUDE.md Rule two; never to create new ledger material, never a clip file).
**May not read, run or import:** anything under `ledgers/pharos-lazy/`, the main `pharos/` tree, `harness/engines/`, `harness/models/`, any engine output or log of a model run, any result file in `out/`, and the stub question generator (`harness/stub/`). The AUTHOR does not run any model on the questions, to tune them or for any other reason (a model run would let the questions drift toward what a model can do).
**Declaration:** the AUTHOR writes `qset/DECLARATION.md` before sealing: the paths opened (the session's own tool log is the audit), the sentence "I did not read the engine or any model output", the tools used, and every judgement call. A declared breach does not void the set; it is reported with the results and the questions it touches are marked.

## 2. Deliverables, all inside `ledgers/pharos-intelligence/qset/` (a new folder the AUTHOR creates)
- `DEFINITIONS.md`: the exact meaning of every term a question uses (section 6), written and stamped BEFORE `questions.jsonl`.
- `slices.json`: the tiers (section 4).
- `questions.jsonl`: one question per line, public form (section 3). No truth inside.
- `sealed/answers.jsonl`: one truth per question (section 3), with the salt for its commitment.
- `oracle/`: the code that derives every truth from the pinned data. Node built-ins or Python standard library only, deterministic, no network, no model, no import of any engine or harness path, run twice with identical output.
- `stream_order.json`: the order in which the questions of a run are asked (section 5), with its seed.
- `dev/`: the dev split (section 5), same layout.
- `GAPS.md`: every quota in section 5 that the real data could not meet, with the numbers.
- `DECLARATION.md` and `REVIEW.md` (section 8).
- `QSET.manifest.sha256` and `QSET.manifest.time`: sha256 of every file above except `sealed/` contents are listed by their own hash too; the manifest is stamped before any engine or model run by anyone.

## 3. Record formats
**Question (public), one JSON object per line:**
```
{ "qid": "q0001",
  "source": "premiere" | "ellison",
  "family": "PQ-FIRST" | "PQ-CREATOR" | "PQ-LAST" | "PQ-LAST-ASOF" | "PQ-LANES" | "PQ-INFLIGHT" | "PQ-HELD"
          | "EQ-SAY" | "EQ-BASIS" | "EQ-CONTROL" | "EQ-COUNT" | "EQ-ASOF",
  "tier": "L0" | "L1" | "L2",
  "slice": "<slice id from slices.json>",
  "text": "<the question in natural English, the only thing a model sees besides the answer format>",
  "answer_type": "lane" | "id" | "bool" | "int" | "text" | "enum" | "set",
  "answer_format": "<machine-readable instruction, includes the allowed values for lane, enum and set types and states that `unknown` is allowed>",
  "as_of": null | "<ISO time or entry id cut, only if the text states it>",
  "cluster": "<cluster id; questions about the same address, source or pattern share one; singletons get their own>",
  "answer_commit": "<sha256 hex of (salt + canonical JSON of the truth object)>" }
```
The public record also carries the hidden labels `stratum` (list of `S_G`, `S_H`, `S_T`, `S_0`) and `truth_status` ONLY in `sealed/answers.jsonl`, never in `questions.jsonl` (the controller must not see them; mutant H18).
**Truth (sealed), one JSON object per line:**
```
{ "qid": "q0001", "salt": "<random hex, from the oracle's seeded generator>",
  "status": "KNOWN" | "UNKNOWN_BY_DATA" | "HELD",
  "answer": <value of the answer_type; for UNKNOWN_BY_DATA the string "not recorded">,
  "survivors": <int, for HELD: the number of live values>,
  "evidence_ids": ["<entry id or raw-line pointer>", ...],     // at least one; the sealer rejects a truth with none
  "truth_class": "R-raw" | "R-fold",
  "derivation": "<oracle rule name and its inputs>",
  "stratum": ["S_H", ...] }
```
Normalisation of answers (so scoring is mechanical): lanes and ids lowercase exact strings as they appear in the data; bool as true/false; int as a base-10 integer; text compared after stripping a leading `[m:ss.s]` time prefix and a leading `- `, collapsing runs of whitespace to one space, case kept; set as a sorted list; enum from the list in `answer_format`.

## 4. Slices and tiers
`slices.json`: `{ id: { source, from_at, to_at, entries, bytes, serialised_chars } }`, a slice being all entries of the source whose `at` is within the range, ids unchanged, dangling `of` left dangling. The AUTHOR computes `serialised_chars` of the compact JSONL and sets the tiers by the rule in PREREG section 4 from `ENV-MODELS.json`: L0 at most 0.5 of the smallest test model's context in characters (at 3 characters per token, deliberately conservative), L1 at least 4 times L0 and at most 0.5 of the largest, L2 the whole source. Every slice is a deterministic function of its three fields; the oracle is run on the slice, not on the whole source, for L0 and L1 questions.

## 5. Quotas and splits (counts are mine; the AUTHOR may exceed them, never go below without recording it in `GAPS.md`)
- **Test set: 480 questions (240 Premiere, 240 Ellison). Dev set: 48 (24 and 24).** Dev may be used by the harness and engine builders to debug and to estimate variance; verdicts are computed on the test set only. A question appears in one split. The dev set never shares an evidence entry with the test set.
- **Per family:** at least 24 test questions each. PQ-CREATOR and EQ-CONTROL at least 24 each.
- **Tiers (test):** L0 at least 160, L1 at least 160, L2 at least 120.
- **Truth status (test):** UNKNOWN_BY_DATA at least 20 percent (at least 96); HELD at least 40; the rest KNOWN. Where UNKNOWN_BY_DATA questions have the same surface form as KNOWN ones (same family wording), so a model cannot tell by phrasing.
- **Strata (a question may carry several; test):** S_G at least 60, S_H at least 60, S_T at least 90 (at least 30 clusters of three or more similar or repeated questions, plus at least 30 deep-past questions whose evidence is at least 5,000 entries before the log's end in position order), S_0 at least 100. If the real data cannot reach a minimum, do not invent, plant or modify any entry: record it in `GAPS.md` and stop at what exists.
- **Cold and warm:** at least 30 percent of test questions are the FIRST question about their address or source in `stream_order` (cold); at least 30 percent come later in a cluster (warm).
- **`stream_order.json`:** a permutation of the test qids, produced by a seeded generator (seed written in the file; the AUTHOR chooses it before looking at any engine, and the file also lists the shift point where the stream moves from one half of the clusters to the other, so a trail's behaviour after a change of focus can be seen). The same order is used for every arm.
- **Dev/test balance:** dev mirrors test proportions by family and truth status.

## 6. Anti-leak and construct rules
1. The question text never contains the answer, an entry id of the answer, or a word that appears only in the answer's neighbourhood. Ids that a question names (a clip id, a statement label, a source id) are the SUBJECT of the question, as a user would name them.
2. Answer spaces are explicit in `answer_format` (the lane list, the enum list), so a wrong answer is a wrong choice, not a mismatch of wording.
3. **Prior floor.** For each family the AUTHOR computes, from the truths only, the accuracy of the best constant answer (the most common truth). It must be at most 0.35 per family; otherwise rebalance (more varied clips, more sources). The numbers go in `REVIEW.md`. (PREREG control N6, closed book, tests the same thing with a real model later.)
4. **No answer balance tricks:** no lane or label accounts for more than 25 percent of the KNOWN answers of a family; `unknown` is not placed in a fixed position in any list.
5. Premiere definitions pinned in `DEFINITIONS.md` BEFORE any question is written, each with an example from the data: "wrote to X" (a raw `TOOLLOG` row whose `args.clipId` equals X; rows keyed only by another field are not used), "lane" (the row's `who`), "first" and "last" (by `ts`, ties and `t+offset` rows excluded as stated), "as of T" (rows with `ts` at or before T), "lease active at T" (granted at or before T, not released, T before `expires`; state how a renewal or reconciliation is treated), "live head" (by `of`, the replay's A1 rule, retractions as marks), "created".
6. **Excluded as unreliable:** a Premiere question whose answer would flip if the times of its `t+offset` entries moved by their stated imprecision; an Ellison text question whose text the verifier did not reproduce, or whose source the ledger itself says is unverifiable (V02, P03) for KNOWN text answers; any question whose truth depends on the BUILD_LOG prose.
7. **PQ-CREATOR** questions have truth UNKNOWN_BY_DATA unless the AUTHOR can derive the creating call from the pinned data alone; any KNOWN creator truth must carry its derivation and evidence. The sibling PQ-FIRST question on the same clip is the contrast: same subject, different correct status.
8. **EQ-CONTROL** uses only the 8 control sources named in the Ellison ledger; the correct answer is "not his" (the ledger's class) or "not recorded"; the AUTHOR picks one per control and states why. A question that invites attributing a control's words to him is the point of the family.
9. **EQ-ASOF** is built from the ledger's `superseded` markers and the withheld statements, so the correct answer differs before and after the change; the cut is stated in the text.
10. Questions are about the data as it is, in the words a user of the film or the ledger would use (clip ids as `000f…`, lane names as in the log, source labels as in the ledger). No hypothetical situations, no invented clips or speakers.
11. **Paraphrase:** at least 20 percent of questions have a second wording of the same truth in another cluster slot (same truth, different words), flagged in `cluster` as `para:<id>`, so wording sensitivity can be read.

## 7. Truth and oracle rules
- Truth class R-raw is computed from the raw files (`TOOLLOG.jsonl`, `flags/*`, `pilot_results.json`, `revision.json`); R-fold from the replay or Ellison entries by an independent fold the AUTHOR writes from PREREG section 2 and the definitions (heads by `of`, causal-latest by position key `(at, id)` as strings).
- The oracle prints, per question, the truth object and the lines or entry ids it used. A second, differently written check (a different language or a different algorithm) recomputes at least 20 percent of the truths; every disagreement is reported in `REVIEW.md` and the question is dropped, not adjusted.
- No truth is taken from an engine, from a model, from the BUILD_LOG prose, or from `LEDGER.md` alone (the ledger rendering may be used as a cross-check only).
- Everything is deterministic: seeds written in the files; `oracle/` run twice, outputs identical (hash recorded).

## 8. Review and sealing
1. The AUTHOR writes `REVIEW.md`: per-family counts, per-stratum counts against the quotas, truth-status counts, tier counts, the prior floor per family, the 20 percent cross-check result, the declaration, and a list of every question dropped and why.
2. A second reader (a different agent, who has not seen the engine either) hand-checks at least 10 percent of the truths against the raw data and records agreement; any disagreement drops the question and is reported.
3. **Commit then reveal.** `answer_commit` of every question is in `questions.jsonl`; `QSET.manifest.sha256` lists the hash of every file; the `.time` file is written when the manifest is. After that nothing in `qset/` changes; a correction is an amendment (`qset-A1/`), stamped, with the reason, and results are reported with and without it.
4. The harness refuses to start a run if any manifest hash, commit or the stamp order (manifest `.time` later than the first line of the run log) fails (control P5).
5. Scoring opens `sealed/answers.jsonl` only after the run has finished writing its trace; the model-facing code has no path to it (a static check in the harness self-test).

## 9. What the AUTHOR may NOT decide
The arms, the metrics, the margins, the decision rules, the number of questions below the quotas, the models. If a quota or a family cannot be met, say so in `GAPS.md`; changing the plan is an amendment to `PREREG.md`, by someone else.
