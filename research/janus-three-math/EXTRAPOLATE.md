# EXTRAPOLATE: what each mathematics would let Janus's reasoning compute that it does not today

Written 2026-11-14 by the "three mathematics" subagent. Every proposal is a NOMINATION, built only from its level's operators and grounded in a record pattern counted in the real log (`~/.khora/documents/eoreader7-reasoning:1.jsonl`, read-only; counts from `out/survey.json` and `out/explore.json`, the latter written AFTER the stamped test and not pre-registered). Nothing here was built.

**Ruling applied (the project owner, 2026-11-14): "let janus handle geometry, penelope handles calculus".** So Janus's own extrapolations are geometric (section 1). The calculus ones are listed as HANDOFFS to Penelope (section 3), in the shape of her first judge (`.wilson-wt/penelope/organs/equivalence.mjs`, branch equivalence-judge, uncommitted; `experiments/equivalence/RESULT.md`): DEF is a ladder of declared grounds, EVA is a verdict per rung with its first difference and its limit, REC is a re-judgement issued `of` the earlier one. Arithmetic was not assigned by the ruling; it is section 2.

## 1. Geometry: Janus's own (SEG cut, CON incidence, SYN construction)

**G1. Cut incidence across runs, not only within one.** (CON·Figure over SEG·Figure.)
- Log pattern: 163 denial lines make 37 distinct negative units; 23 of them have a positive twin (same ground, relation and roles) somewhere in the log, and a denial meets its own link inside the same run 80 times.
- Today: `lintGfp` sees a cut meet its link only among one run's claims (`polarity_contradiction`, reasoning-lint.js L786-789). The read-time fold sees it across runs but scores only grounded witnesses, and 4,861 of 4,864 lines are `unaddressed`.
- Janus could build the incidence of every cut with every link at its ground across the whole log (which runs asserted, which denied, and whether they share a run), with no judgement of which side is right. That is the "contested" set as a geometric object, before any calculus touches it.

**G2. The shape of each reading's support graph.** (CON·Pattern, Network; SEG·Ground.)
- Log pattern: there are 1,585 (run, ground) readings. 1,226 are one connected component over the referent ids, 312 have two, 41 have three and 6 have none. Nodes per reading: median 3, max 10. Highest degree: median 2, max 6.
- Janus could report each reading's components, degrees and cycles as its geometric signature. A reading in 2 or more pieces (353, 22 percent) has claims at one ground that never touch. If the two pieces are eot-janus's claim side and source side (not checkable here: the log drops the `c`/`s` ids, eot-janus.js L22), then no contradiction between them can even be expressed, and a `standing_contradiction` count of 0 there is a geometric fact, not evidence of agreement. Testable once the side ids are kept.

**G3. Cut the run sequence into arms by reading identity.** (SEG of the run line; SYN of runs that read alike.)
- Log pattern: across the 49 grounds read 18 times, 791 changes of reading occur between consecutive runs; **554 return to a reading the ground already had** and 237 go to a new one. The stamped test (FINDINGS.md) found the real order no more settled than a shuffle.
- So the log is a set of interleaved arms or configurations, not a refinement sequence. Janus could partition runs into classes that read every shared ground identically, which is pure geometry (equality of readings, then a cut), and would say which runs are one configuration repeated. Every later count or limit needs that partition first.

**G4. The holon tree is flat, so lex specialis has nothing to do here.** (CON·Pattern, containment.)
- Log pattern: 113 of 114 grounds sit at depth 1 (`/p<id>`, `/p`); the remaining one is a file path at depth 5. 153,607 claim pairs inside the same run sit on sibling grounds and are never compared (`apart`, reasoning-lint.js L771), which is correct by design.
- The depth machinery (`overridden_in_scope`, `refuted_in_scope`, roll-up) never fires on this log. The extrapolation is a negative one: Janus's geometry is under-used until grounds nest (pair inside corpus inside run). A nested ground is the cheapest change that would exercise it.

**G5. Construction of a whole from a reading.** (SYN·Figure.)
- Log pattern: `reasoning-core.js` builds a complete consistent assignment (L157-161), but no CSP output reaches the log. eot-janus already constructs derived `most:` and `state:` claims (eot-janus.js L24-26; `state:volcano-status` alone is 282 lines).
- Janus could construct each ground's reading as one SYN record (the set of units, its components, its cuts) and key the run's claims to it, so later readers fold wholes instead of re-assembling lines.

## 2. Arithmetic: unassigned by the ruling (NUL zero, SIG mark, INS successor)

**A1. The successor chain of a claim's restatements.** (INS·Pattern.)
- Log pattern: `supersedes` is null on all 5,043 lines (the writer hard-codes it, reasoning-ledger.mjs L172, L221, L247). Yet of 716 distinct units (ground, polarity, relation, roles), 571 recur in 2 or more runs, 55 in all 18 runs of their ground, and 97 recur inside one run.
- Each restatement could name the line it restates, so that "stated N times" is a chain with a denominator rather than a recount.

**A2. Count instruments, not lines.** (INS with NUL.)
- Log pattern: every claim is `hand-authored` through one harness (eot-janus via reason.mjs). Ignoring the grounding floor, the 571 recurring units would read as "corroborated" under `standingOf` (khora kernel/notes.js L187: 2 or more sources), although they are one instrument re-run. §II's wall applies: arithmetic presupposes the unit, and here the unit of a source is a run, not an independent reader.

**A3. Denominators on the run verdict.** (NUL, INS.)
- Log pattern: 121 of 179 runs say `ok=false`, with 220 errors in all (median 1, max 7). The run line carries no per-ground count, so "errors per ground read" cannot be formed. Writing the number of grounds and units next to `errors` gives the verdict its denominator.

## 3. Calculus: HANDOFFS to Penelope (DEF bound, EVA comparison, REC re-zero)

**P1. Standing as a limit, in her ladder shape: rungs are declared resolutions, not run order.**
- Log pattern: the stamped test FAILED. Over run order, readings flip-flop and do not settle (FINDINGS.md). But the declared resolution changes the answer: 79 grounds change at the unit resolution and only 62 at the fingerprint (kind) resolution.
- Handoff: DEF = the ladder [fingerprint (kind, loose), unit (strict)], declared and bylined. EVA = for each ground, "same up to fingerprint, changing at unit", with the rung where the first difference appears. That is the same shape as her first run's "same at casual, undecided at strict" (20 of 56 pairs). A limit over two rungs is not a limit, as her RESULT.md says; more rungs (role names, then rel, then values) would be the next declaration.

**P2. Corroboration as EVA per rung of a grounding ladder.**
- Log pattern: `GROUNDED_VERDICTS` (claude-code-context.mjs L150) admits only `cited` or `event`. Only 3 lines are cited, and they are one unit (the spiral-test import claim) stated in 3 runs by 3 sessions. So at that rung 1 unit recurs, against 571 at the rung "any restatement".
- Handoff: DEF = [any restatement, a grounded run, an independent instrument]. EVA = the standing at each rung (571, 1, and at most 1 on this log; the third rung was not checked), never one bare "corroborated". This replaces a single floor with a reported range.

**P3. Staleness and withdrawal as REC.**
- Code pattern only: the spiral's `stale` (premise epoch changed, reasoning-spiral.js L75-76, L137) and `withdraw` / `reopen` (L109-114) are re-zeroings. The log holds none of these events: the spiral did not write it.
- Handoff: Penelope's REC already has this form (a re-judgement issued `of` the earlier one, saying what held and what changed). The spiral's epoch map is the "of" link she needs.

**P4. Rate of change of a ground's reading.**
- Log pattern: per 18-run ground, the number of grounds changing at each step runs 31, 31, 31, 26 (x7), 29, 29, 36, 36, 36, 36. That is no decline, and more change at the end.
- Handoff: the derivative d_k = |S_k symmetric-difference S_(k-1)| is computable today. Whether it means anything needs G3's arm partition first: a rate across interleaved arms measures the interleaving, not the reasoning.

**P5. The verdicts Janus emits now are calculus.**
- MAP.md S11, S29, S43, S44 and S50: `assess`, the bound in `standing_contradiction`, the grounding floor, corroborated standing, and eot-janus's claim-against-source verdict.
- Handoff, per the ruling: Janus supplies the incidence (which values meet at which figure, which cuts meet which links), and Penelope holds the declared bound and issues the verdict per rung.

## The three that seem most informative
1. **G3, arms before limits.** 554 of 791 changes return to an earlier reading. Any calculus over this log first needs the geometric partition of runs.
2. **P2, corroboration as a range.** 571 units recur and only 1 of them recurs grounded. A single floor hides that the answer is "571 at rung 1, 1 at rung 2".
3. **G2, component count as a precondition for contradiction.** 353 of 1,585 readings are in pieces that never touch. That is checkable as soon as the claim and source side ids reach the log.
