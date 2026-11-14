# MAP: Janus's reasoning, step by step, by mathematics and order of difference

Written 2026-11-14 by the "three mathematics" subagent. **Every assignment below is a NOMINATION by this subagent**, read off the code and the log; none is earned from data by a declared procedure, and none is canon. Canon read: khora `native/docs/THE-THREE-MATHEMATICS.md` (§I, III, VII, VIII) and `THE-27-CELLS.md` (worktree `.wilson-wt/khora`). Domain = mathematics (Existence = arithmetic, Structure = geometry, Interpretation = calculus). Grain = order of difference (Ground = the reference, 0; Figure = a difference from its ground, n; Pattern = the difference a figure makes to the next ground, 1).

**Ruling applied (the project owner, 2026-11-14, relayed by the coordinator): "let janus handle geometry, penelope handles calculus".** The last column says who owns the step under that ruling: **J** = geometry, stays with Janus; **P** = calculus, belongs to Penelope (a handoff, not a change: no code was touched); **A** = arithmetic, not assigned by the ruling; **-** = fits no single cell.

## A caution on words before the table
The code's own "GFP" (khora `native/kernel/gfp-claim.js`, `reasoning-lint.js` L668-681) names the parts of ONE CLAIM: Ground = holon scope, Figure = participants by role, Pattern = relation. That is a different use of the same three words from the cube's grain (order of difference of an ACT). This map uses the cube's sense only. Cells classify moves, never content (THE-27-CELLS §1).

## Which code is Janus's reasoning
- janus `native/organs/reasoning-core.js`, `reasoning-record.js`, `reasoning-lint.js` and `talk-reason.js` are 4-line SHIMS that re-export khora's organ of the same name (khora is the one home). Only `reasoning-spiral.js` (173 lines) and its test live in janus.
- The two janus copies agree: `.finder-wt/janus` (e3d8e5d) and `eo-frontier/janus` (b1cc37f) are byte-identical for all five files. The khora homes they resolve to (`.finder-wt/khora` c567de2, `eo-frontier/khora`, `khora` d3ce14a) are byte-identical for the four organs. No difference to report.
- **The real log was not written by the spiral.** `~/.khora/documents/eoreader7-reasoning:1.jsonl` is written by khora `cli/reasoning-ledger.mjs::appendReasoningLedger` (L152) called from `cli/reason.mjs` (L493). 4,861 of its 4,864 claims come from `native/organs/eot-janus.js` (grounds `/p<id>`, referent ids `b1`, `b2`, ...); the other 3 are a `spiral-test` session that only CITES `claude-code-spiral.mjs`. No propose / assess / withdraw / reopen event of the spiral appears in the log. So spiral steps below have code evidence only; reason.mjs steps have code and log evidence.

## The steps (50)

| # | step, file:line | domain | grain | operator (nominated) | owner |
|---|---|---|---|---|---|
| S1 | `appendReasoning` stamps `seq = log.length` (reasoning-spiral.js L49) | arithmetic | Figure | INS, one more event | A |
| S2 | `addr()` witness must be `ref#from-to`, to > from (spiral L9-15) | geometry | Figure | SEG, a segment with two ends | J |
| S3 | low gate `missing_relation`: subject, verb, object all present (spiral L97) | geometry | Figure | CON, an edge needs its ends | J |
| S4 | low gate `self_premise` (spiral L99) | geometry | Pattern | CON, a loop of length one | J |
| S5 | low gate `no_ground_or_named_giver` (spiral L101) | arithmetic | Ground | NUL, something rather than nothing | A |
| S6 | `forWhom` required (spiral L98) | calculus | Ground | DEF, a declared perceiver | P |
| S7 | `status` cyclic (spiral L65) | geometry | Pattern | CON, the premise network closes | J |
| S8 | `status` suspended: a premise not supported suspends descendants (spiral L72-74) | geometry | Pattern | CON, propagation along edges | J |
| S9 | `status` stale: premise epoch changed since assessment (spiral L75-76, L137) | calculus | Pattern | REC, the difference a revision made to the next ground | P |
| S10 | `withdraw` / `reopen`: clears assessment, epoch += 1 (spiral L109-114) | calculus | Figure | REC, re-zero one claim | P |
| S11 | `assess`: verdict supported / refuted / unresolved by a named instrument (spiral L117-141) | calculus | Figure | EVA | P |
| S12 | deduction needs a named license (spiral L128-129) | calculus | Ground | DEF, the bound a giver declares | P |
| S13 | `licensed` axiom: given, not witnessed (spiral L82-83) | calculus | Figure | DEF, a bound not yet cleared | P |
| S14 | `byStanding` counts (spiral L143-144) | arithmetic | Pattern | count by class (a number is a Kind) | A |
| S15 | `openings`: each unsettled claim named with its question (spiral L146-150) | arithmetic | Figure | NUL, a named hole | A |
| S16 | `reasoningRound`: propose, low gate, assess, reproject (spiral L156-172) | - | - | a chain | - |
| S17 | `finiteDomain`: values as a list, never a bare count (reasoning-core.js L79) | geometry | Ground | SEG, the extent and its units | J |
| S18 | constraint scoped to its `vars`; `checkableAt` (core L93, L142-150) | geometry | Figure | CON, incidence of a rule with its variables | J |
| S19 | prune: a failed rule cuts the whole subtree (core L171-177) | geometry | Figure | SEG | J |
| S20 | the constraint test `c.test(current) === false` (core L169) | - | - | - | - |
| S21 | a solution = a complete consistent assignment (core L157-161) | geometry | Figure | SYN, a whole from parts | J |
| S22 | `limit`: stop after N solutions (core L131, L165) | calculus | Ground | DEF, a budget | P |
| S23 | schema door: not a GFP claim is refused (reasoning-lint.js L722-726) | arithmetic | Figure | NUL, does it clear the door | A |
| S24 | identity claims merged by union-find inside a ground (lint L735-748) | - | - | - | - |
| S25 | claims grouped by relation (lint L756-762) | geometry | Ground | SEG, the field cut into relation classes | J |
| S26 | two claims meet only where grounds overlap; else `apart` (lint L771) | geometry | Ground | CON, co-presence in the field | J |
| S27 | lex specialis: the deeper ground overrides a default (lint L772-783) | geometry | Pattern | CON, containment in the holon tree | J |
| S28 | `polarity_contradiction`: P and not-P at one key (lint L786-789) | geometry | Figure | SEG, a cut meets its link | J |
| S29 | `standing_contradiction`: two values in a role a giver declared one-valued (lint L791-798) | - | - | - | - |
| S30 | `unjudged`: several-valued with no declaration, never convicted (lint L796) | arithmetic | Ground | NUL, a typed void | A |
| S31 | `circular`: DFS for a cycle in a declared-acyclic relation, per scope (lint L803-835) | geometry | Pattern | CON | J |
| S32 | holon roll-up: each holon counts its own and its descendants' findings (lint L839-847) | geometry | Pattern | SYN | J |
| S33 | `falsifyGfp`: plant the narrowest counterexample, check lint catches it (lint L915) | arithmetic | Ground | NUL, a deliberately broken null | A |
| S34 | `lintLedger` precedence: validity window, regime, specificity, force, recency, entrenchment (lint L24-27, L248) | calculus | Ground | DEF, a ladder of grounds | P |
| S35 | `lintInferences`: license, verify, refute (lint L451) | calculus | Figure | EVA | P |
| S36 | run line, the address every claim reads back through (reasoning-ledger.mjs L166-174) | - | - | - | - |
| S37 | claim line, witness unique per line (reasoning-ledger.mjs L193-225) | arithmetic | Figure | INS | A |
| S38 | `supersedes: null` written on every line (reasoning-ledger.mjs L172, L221, L247) | arithmetic | Pattern | INS successor chain, ABSENT | A |
| S39 | `fingerprintOf`: a digest of a claim's shape, role names not values (khora claim-deriver.js L219-231) | - | - | - | - |
| S40 | `citeGround`: does the claim's ground address a real chunk (reason.mjs L126) | geometry | Figure | CON, a claim incident with an address | J |
| S41 | read-time fold: re-sightings folded into one note (claude-code-context.mjs L265-300) | geometry | Figure | SYN | J |
| S42 | a denial is the kernel's cut; both sides = contested (claude-code-context.mjs L82-89, L326-336) | geometry | Figure | SEG | J |
| S43 | `GROUNDED_VERDICTS`: only cited / event runs corroborate (claude-code-context.mjs L150) | calculus | Ground | DEF, a floor | P |
| S44 | `standingOf`: 2+ distinct sources = corroborated (khora kernel/notes.js L182-187) | calculus | Pattern | EVA, standing across witnesses (THE-27-CELLS names EVA·Pattern so) | P |
| S45 | seed match by containment (claude-code-context.mjs L219) | geometry | Ground | CON | J |
| S46 | referent ids: one id per being, `b1`, `b2` (eot-janus.js L18-19) | arithmetic | Figure | INS | A |
| S47 | one ground per pair, `/p<id>` (eot-janus.js L22) | geometry | Ground | SEG | J |
| S48 | derived `most:` and `state:` claims (eot-janus.js L24-26) | geometry | Figure | SYN | J |
| S49 | declared one-maker, state value sets, superlatives (eot-janus.js L8-11, L30) | calculus | Ground | DEF | P |
| S50 | a contradiction counts only between a claim side and a source side (eot-janus.js L33) | calculus | Figure | EVA | P |

### Tally (nominations)
| | Ground | Figure | Pattern | total |
|---|---|---|---|---|
| arithmetic (A) | 3 | 5 | 2 | 10 |
| geometry (J) | 5 | 10 | 6 | 21 |
| calculus (P) | 6 | 5 | 2 | 13 |
| no single cell | | | | 6 |

So, nominally, 21 of 50 steps are already geometry and stay with Janus; 13 are calculus that the ruling hands to Penelope; 10 are arithmetic, which the ruling leaves unassigned. Calculus in Janus today is mostly Ground-grain DEF (6 of 13): declared bounds, floors, licences, budgets and ladders. Janus's headline verdicts (`assess`, the run's `ok` and `errors`, corroborated standing) are calculus.

## The log's record kinds (5,043 lines; counts from `out/survey.json` and `out/explore.json`)
| record or field | count | nomination | owner |
|---|---|---|---|
| `reasoning-run` line | 179 | no single cell (S36): an INS·Figure act that serves as the Ground of its claims, carrying an EVA verdict in its text (`ok=false` 121, `ok=true` 58; 220 errors in all) | - |
| `reasoning-claim` line | 4,864 | arithmetic·Figure, INS (S37) | A |
| polarity `-` on a claim | 163 lines, 37 distinct negative units | geometry·Figure, SEG (S28/S42) | J |
| verdict `unaddressed` / `cited` | 4,861 / 3 | the geometry floor (S40) NOT earned on 4,861; the 3 cited are the spiral-test lines | J |
| `fingerprint` | 4,864 (all) | Existence·Pattern by subject (a Kind), operator undecided (S39) | - |
| `supersedes` | null on 5,043 | INS·Pattern absent (S38) | A |
| `reasoning-note` | 0 | the folded-notes layer never ran (every run says 0 notes) | - |
| spiral events (propose, assess, withdraw, reopen) | 0 | the spiral's calculus (S9-S13) leaves no trace here | P |

## Steps that fit no single cell, and why
- **S16 `reasoningRound`.** A chain, not a move: INS (propose), then the geometry gate, then EVA (assess). Worth noting: the order is arithmetic, then geometry, then calculus, the canon's crossing rule (§VII), read off the code.
- **S20 the constraint test.** A rule is a declared bound (DEF, calculus), testing it is EVA, but WHEN it can be tested is fixed by its geometric scope (`vars`). Three mathematics in one call.
- **S24 identity by union-find inside a ground.** Geometry (containment decides where an alias reaches) builds arithmetic's unit (which two names count as one). This is §VI's depth move (address containment fixing referent identity).
- **S29 `standing_contradiction`.** An arithmetic count (two values) against a calculus bound (a giver's "one-valued" DEF) over a geometric key (the figure with the role left out). Under the ruling it splits: Janus can find the incidence, Penelope owns the bound and the verdict.
- **S36 the run line.** Its act is a birth (INS·Figure), its role for the claims is their Ground, and its text carries a verdict (EVA). Three grains and two mathematics on one line.
- **S39 `fingerprintOf`.** It names a Kind (Existence·Pattern) but does not make one (no INS) and is not a trail (no SIG in the canon's sense: it is written, lasting and carries a value). No operator fits without stretching.

## What this map does not establish
The assignments are one reader's nominations against prose definitions; no shuffle or label-permutation test was run on them (the canon's "95.7% survived shuffling" warning applies: cells classify moves, and I classified moves by reading code). The tally depends on how steps were cut (50 is my cut). Talk-reason.js, corroboration.js and the remaining janus organs were not mapped.
