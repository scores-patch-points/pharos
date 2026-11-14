# Learnings that should shape a query-and-update language over the fold

Written 2026-11-14 by the learnings collector for the design round of `PREREG-A4.md`. This is a design input. It builds nothing and measures nothing new. Every number below was read from a file named next to it; nothing was re-run.

Tags: **Result** (measured, with where), **Prior art** (from memory or from a cited note, not checked here), **Proposal** (stated, not tested), **Open** (unresolved). Where a line says "DECLARED" it is a reading the project chose, not a finding. No learning below says that EOQL works. Cells are earned, never typed: no operator is assigned a meaning here as a finding.

Path shorthand (all under `<workdir>/`): `eoql/` = `ledgers/pharos-eoql/`, `lazy/` = `ledgers/pharos-lazy/`, `note` = `eoql/prior/one-log-many-projections.txt` (the user's design note "One Log, Many Projections", 2026-11-14), `mem/` = `~/.claude/projects/-Users-<user>-Documents-claude-code/memory/`. The first attempt means SPEC.md, SPEC-A1.md, SPEC-A2.md and the partial run in `eoql/test/out/`. PREREG-A2 of `eoql/` says only a finished full run counts, so every first-attempt number is a partial-run number.

Each entry has: a one-line claim with its tag, the file it comes from, and the language consequence (a constraint, a feature, or a thing to refuse).

---

## A. The ground

**1. A ground is bylined events that settle six decisions every database makes silently.** [Proposal; the note records it as "a design discussion" not checked against EO///DB code. Prior art: Datomic, XTDB, FoundationDB layers, as listed in the note.]
From: `note` section "What a ground has to settle". The user's words: "The problem is unstated grounds, not data." The six, each with its consequence:
- (a) Identity criteria (what counts as the same entity, what evidence merges two records; fixes the starting heads). Consequence, refuse: no key-equality assumption and no inline merge in a statement; a merge is a ground event that cites evidence.
- (b) Dependency relations (which edges the backward walk follows; fixes the cone). Consequence, constraint: the edge relation is named by the ground; the evaluator has no default edge set (see 20).
- (c) Time regime (causal order, valid time or system time; what "now" means). Consequence, constraint: "latest", "as of" and "now" take their meaning from the ground; no clock default (see 19).
- (d) Absence semantics (unknown, not applicable, retracted). Consequence, constraint: the kernel has no NULL; each absence kind is a declared value, so missing, unknown and retracted never share a representation.
- (e) Sufficiency (how much of the cone the question needs; fixes the stop rule). Consequence, feature: the stop test is read from the ground (see 14 to 17).
- (f) Baseline (what difference is worth reporting, so a null is declared and not assumed). Consequence, constraint: a statement that reports a difference names a baseline from the ground, never a built-in epsilon.

**2. Perspective is a selection: a reader folds under the ground a named author published at a named version, and adopting it is itself an event.** [Proposal]
From: `note` section "What follows from grounds being events". The note says the regress of "which ground?" ends at the reader, and that every result can state "which cone, under which ground, by whom."
Consequence, constraint: every statement runs under an adopted ground; the result envelope carries cone, ground (event id, byline) and baseline. Consequence, refuse: a result with no named ground.

**3. Competing grounds coexist, and the difference between two answers over the same cone is a finding.** [Proposal]
From: `note` (same section).
Consequence, feature: a comparison form that folds one cone under two grounds and returns both answers plus the difference. Consequence, refuse: silently picking one ground when two are adopted.

**4. Ground evolution is ordinary history: a revised ground supersedes or extends an earlier one, old folds stay valid under the old ground, and the ground in force is the one as of the cut being read.** [Proposal for the principle (`note`, `lazy/PREREG-A5.md`). Result: in the lazy store a mid-log schema entry left earlier shard bytes unchanged and entries before and after were both found, but reading cost is the sum over the whole schema history and the post-change cost bound failed; the test was ruled a pass on A2's text only (`lazy/RULINGS-STAGE1.md`, W13).]
From: `note`; `lazy/PREREG-A5.md` (ground first, as of the log position; mutant Z1 is "use the latest schema for a past cut"); `lazy/API.md` section 2; `eoql/SPEC.md` 2.5 F2.
Consequence, constraint: the ground is resolved as of the question's cut; reading a past cut with today's ground must be said in the statement and is reported. Consequence, constraint: a cache or memo key is head set plus ground event id. Consequence, refuse: editing a ground in place.

**5. A ground cannot be read off the data; the first ground is a received object with a named author, and the cost of a new domain is authoring and ratifying it.** [Proposal; the note also says earlier attempts "collapsed to the material's own vocabulary", which is recorded there without a source. Open: what a read with no adopted ground returns.]
From: `note` (Limits); `lazy/PREREG-A5.md` G6 (a kind with no schema returns "no ground", not an empty determined answer); `eoql/PREREG-A3.md` A3-3 (no declared fold gives `both`, marked `default-both`).
Consequence, refuse: any construct that infers a ground from the log's own vocabulary. Consequence, Open: refuse an ungrounded read outright, or return the safe default `both` marked as ungrounded; the two earlier documents chose differently, and the design must pick one and say so.

**6. A byline attributes but does not validate; a ground carries testable claims, and adoption counts measure popularity, not correctness.** [Proposal; Open: signing strength and endorsement discovery.]
From: `note` (Limits). The note says a wrong ground "quietly shapes every fold that adopts it" and that Matrix events are signed by the homeserver, not the person.
Consequence, feature: a ground declaration includes a predicted structure that can be checked against the log under a declared null (the note's test on ground falsification, see 40h). Consequence, refuse: trust by byline alone, and ranking grounds by adoption count.

**7. How we want to read is declared by a schema, and a schema is an addressable event; two schemas are two windows and neither wins on write.** [Proposal for the principle. Result: in the lazy store W12 and W13 are pass-under-ruling and W11 writer-stream and time-window reads fail because the caller had to type `prior:'none'` (5.7 times and 46.7 times the bound), ruled a real defect (`lazy/RULINGS-STAGE1.md`).]
From: user, quoted in `lazy/PREREG-A2.md`: "well not necessarily, it all depends on how we WANT to read something, which is defined by its schema, which is an addressable event". Also `lazy/API.md` section 2; the EO wiki on schema independence ("A field rename is a REC on the Meant-Graph, not a rewrite of the log", `~/Documents/_archive/2026-08-15/eoreader4.2/docs/eo-wiki.md` near line 17852, Prior art, the wiki states itself not peer-reviewed).
Consequence, feature: the way to read (fold, window, placement) is data in the log, versioned, resolved as of the cut. Consequence, refuse: any config file, flag or caller argument that says how to read (mutant L15 of `lazy/PREREG-A2.md`); a schema change is a new entry, never a rewrite. Consequence, constraint: a reader must not need to type what the write path can compute.

**8. Superposition is one fold among many, and the schema chooses the fold.** [Proposal]
From: user, quoted in `eoql/PREREG-A3.md`: "super position is just one way of folding things and depends more on things like schema." A3-1 to A3-6 propose the kernel ships one fold, `both`, and a starter set (`causal-latest`, `lww-clock`, `first`, `union`, `sum`, `count`, `max`, `min`, `ranked-by-author`, `per-field`, `perceiver`, `append`) is declared by a named author.
Consequence, constraint: the only built-in fold is the held set; every other fold is a declared entry that the answer cites, with `values_discarded` reported. Consequence, refuse: inline fold bodies in a query, and a fallback to a similar built-in when a fold is undeclared. Consequence, Open: whether each starter fold (sum, count, max, min) can be declared without the kernel interpreting a special keyword; PREREG-A3 states that a case where it cannot counts against the small kernel.

---

## B. Contradiction, the kernel, the operators

**9. A conflict rule is an ordinary event that depends on the events it adjudicates, so it scopes itself by dependency order, and rules that can only look back can be stratified by construction.** [Proposal; the termination claim "needs testing against retraction-style rules".]
From: `note` section "Contradiction, the default of both, and the kernel". Prior art named there: Datomic schema as datoms, RDF Schema as triples, Datalog rules as facts, Matrix power levels.
Consequence, constraint: a rule event may cite only earlier events; forward references are a typed error. Consequence, refuse: a precedence mechanism between rules; the stops are the reader's adoption event and the default.

**10. The default for an unresolved contradiction is to surface both sides, and the answer says how many pasts survive and on what grade.** [Proposal for the default and the lattice (is, is-not, both, neither). Result: in the partial first attempt the held-set and collapse-is-declared checks pass (84 of 84 in `eoql/test/out/planted.json`; 121 of 122 in `eoql/test/out/e_explain.json`).]
From: `note`; `lazy/PREREG-A6.md` R-count (1 is determined, more than 1 is held, 0 means ground and data disagree and is a finding) and R-grade (`entailed` only from `of` links or a superseding entry, a value inferred from a later state with several possible pasts is `held` and never promoted); `lazy/API.md` section 5 (conflict episodes: began, ended or open, participants, differ); `eoql/SPEC.md` 1.3 and 1.6.
Consequence, constraint: no construct errors on contradiction; every answer carries survivor count and grade; zero survivors is reported with the offending entry ids, never as an empty determined answer. Consequence, refuse: collapse inside the fold, or a collapse the answer does not state (mutants M2 of `eoql/PREREG.md` and W7 of `lazy/PREREG-A6.md`).

**11. The evaluator cannot be an event, so a kernel stays outside the log, and its size is the thing to watch: anything that creeps in is a ground in disguise.** [Proposal for the warning. Open: whether the "both" default is in the kernel. Result: the first attempt's kernel count was 9 verbs, 8 frame arguments, 5 primitives and 3 closed vocabularies (`eoql/test/out/t_report.json`, T.a, and `eoql/SPEC.md` 2.6), and the older frozen fold already hardcodes a tie-break by cell rank then id and a special case for kind `retract` (`eoql/SPEC-A2.md` 4.3).]
From: `note` ("The kernel ... its size is the thing to watch"; "makes a ground special again without anyone noticing"; "the kernel is exactly the nine operators plus dependency order, or ... the 'both' default must also live there" is stated as an open question); `eoql/PREREG-A3.md`; `eoql/SPEC.md` 2.6 and 9.2 (budget numbers and the 1 MiB body limit are "untuned" defaults).
Consequence, constraint: the design prints a complete inventory of everything the evaluator hardcodes and justifies each item as not a ground in disguise (criterion C-2). Candidates already seen that need that test: the collapse list, `anc`, `ordering`, rank tie-break, the `retract` special case, grain defaults, budget and size limits, scalar and aggregate function lists. Consequence, Open: whether safety limits (parser depth, budget) are kernel or ground.

**12. The seed of EOQL is a nesting grammar `OP(arg)` read in the order scope, filter, group, aggregate, frame; the verb-to-operator reading is DECLARED, and v1 uses a different operator set.** [Result for what the seed code does; Prior art for v1.]
From: `EOQL_TRANSLATION_STANDARDS.md` 1.1 and 1.2 (holodeck `eoqlParse` binds only SEG, EVA, REC, SYN, DEF and the connectives, CON, NUL, SIG, INS return "could not bind operator"; `eoTrace` is descriptive and never writes; "cells classify MOVES, never content"); `eoql/PREREG-A1.md` (v1 uses NUL, DES, INS, SEG, CON, ALT, SYN, SUP, REC; canon uses SIG, DEF, EVA in place of DES, ALT, SUP).
Consequence, constraint: composition by nesting is the seed syntax; the number of extra primitives needed beyond the nine is a finding to print (C5), not hidden. Consequence, refuse: content, claims or prose inside a verb's parentheses; operands are references, fields and values.

---

## C. Folding backward, stopping, and failing safe

**13. The wave fold reads backward from the heads along dependency order, so read cost tracks the question's cone and the cone is the explanation; it does not help whole-corpus questions.** [Prior art for the family (goal-directed evaluation, newest-first LSM reads, backward slicing, magic sets, as stated in the note, unchecked). Result: in the partial first attempt, address-scoped questions on a 10^6-entry placed log passed the 2 percent bar on 40 of 40 (worst 25 entries), and whole-log scans read 100 percent of the 10,361,143 source bytes, equal to the SQLite scans (8 of 8 checks).]
From: `note` section "The wave fold"; `eoql/test/out/r_cost.json` (46 of 280 checks failed, mostly budget enforcement and a plan label that said `scan` for region access); `eoql/test/out/p3_scans.json`; the EO wiki (the Horizon is a query, not a data structure).
Consequence, feature: demand-driven evaluation from heads; the result's explain is the cone it read, with counts of entries and bytes. Consequence, constraint: a statement can say whether it is selective or whole-corpus, and cost is reported honestly either way; a budget breach is a typed error, never a truncated answer.

**14. A branch stops when what remains makes no difference to the answer under the ground's baseline, and the question's shape sets the test.** [Proposal]
From: `note` section "The stopping rule". It gives a two-tier test: a structural prune (the event touches no slot in the question's declared shape) and a value-level check (it restates what is already there). A second byline repeating a value changes nothing for "what is the value" and everything for "is it corroborated".
Consequence, feature: a statement declares its shape (value, count, standing, source count), because the shape picks the stop test. Consequence, refuse: "first hit wins" as a default stop (test 40d).

**15. Sufficiency is measured against the accumulated answer at the head, not against the previous step, because a consequential change split into many sub-baseline edits passes every step-wise test.** [Proposal; the note says the same lesson came from earlier max-versus-mean and cumulative-versus-trailing-window bugs in the induction work, which was not re-read here.]
From: `note` (stopping rule, "Compare against the accumulated answer, not the previous step").
Consequence, constraint: the language defines sufficiency as cumulative effect on the answer. Consequence, refuse: a per-step threshold as the stop primitive (test 40b).

**16. Each branch stops only after reaching a declared sufficient root; a quiet stretch can mean convergence or starvation.** [Proposal]
From: `note` (stopping rule, "Stop per branch, not globally"); `lazy/PREREG-A6.md` A6-1 (at least 300 deep-past questions where a sound stop rule must not stop early).
Consequence, constraint: the ground can declare what counts as a sufficient root and the evaluator stops a branch at nothing else (test 40c).

**17. The stop is recorded as an event with its frontier, ground and baseline, so an answer is a revisable claim and a stricter reader can resume from the frontier.** [Proposal; Open: whether the current design records it.]
From: `note` ("This document recommends it; whether the current design does it is an open question").
Consequence, feature: the frontier of a fold can be written, contradicted by an ordinary later assertion, and resumed under a stricter ground; memoized by head set and ground id. Consequence, refuse: a stop that cannot be revised, and a stored answer that is not marked as a revisable claim.

**18. Failure must cost only reading: a shortcut may waste reads and may never answer wrong, and silence is never "nothing happened".** [Proposal for the rule (`lazy/PREREG-A6.md` R-oneside, S4, A6-2b gaps). Result: in the lazy store `ask(addr)` without a kind returned 0 values for 20 of 50 addresses that span a placement change, ruled a real defect (`lazy/RULINGS-STAGE1.md`, W13.addr-span). Result: in the partial first attempt one check fails, a count of 0 on a torn source came back `determined: true` (`eoql/test/out/e_explain.json`).]
From: those files; `ESSAY-THE-PHAROS-AT-THE-CENTER.md` proposal 3 (Prior art: Bloom, 1970, from the essay); `eoql/SPEC.md` 1.6 (incompleteness is evidence-based only; a truncated file with no surviving reference is undetectable, listed as Open question 2).
Consequence, constraint: "I could not tell" and "incomplete over range" are first-class results; a negative result carries completeness evidence for the whole source; the false answer allowed is "maybe", never "no". Consequence, Open: a way for the ground to declare a range complete (needs a declared kind).

**19. Order is dependency (causal), not clock, and late arrival and concurrent heads make "latest" non-unique.** [Result: in the partial first attempt the planted clock-skew checks pass, latest follows `of` links and a clock stand-in is flagged and marks inversions undetermined (`eoql/test/out/planted.json`, 84 of 84). Result: the lazy store's position key (at, id) agreed with causal order on the replay (0 inversions in 8,949 `of` references) but is not guaranteed for hand-set times (`lazy/API.md` section 4). Prior art: XTDB bitemporal and Matrix state resolution, as named in the note. Open: head choice when the graph has several.]
From: `note` (what the wave fold does not fix: late arrival, concurrent heads); `pharos/SPEC.md` ("order is causal, not clock", `at` informational, concurrent entries ordered by cell rank then id); `eoql/SPEC.md` 1.7.
Consequence, constraint: time regime is a ground decision (1c); with several heads the default answer is both; a late event can change which head answers a question about an entity, so memo keys include the head set (tests 40e and 40f). Consequence, refuse: ordering by `at`, and any tie-break the ground did not declare.

**20. The dependency relation decides what "held" means: on the Premiere replay the same log has 1,336 held addresses under `of` links alone and 0 conflicts under the frozen rule (`of` plus `seen`), and 4,758 of 8,949 `of` references cross addresses.** [Result]
From: `lazy/API.md` sections 6 and 8; `eoql/SPEC.md` 1.7 and 9.2 question 3 (the first attempt defaulted `anc: slot` and flagged it).
Consequence, constraint: the edge relation is decision 1b, declared in the ground, and every held count states which relation produced it. Consequence, refuse: a built-in default edge set (the first attempt's `anc: slot` was one).

**21. A window is not one thing: filtering a writer's values and limiting what a perceiver could know give different answers, and which differ depends on the dependency relation.** [Result: in the first attempt's `eoql/test/out/t_report.json` (T.b) 556 of 3,690 address-writer pairs (15.07 percent, 21 writers) differ under the `of` plus `seen` relation and 0 differ under `of` within a slot; the earlier figure of 52 of 247 addresses could not be reproduced. The lazy session ruled the question undecided by spec (`lazy/RULINGS-STAGE1.md`, W8e).]
From: those files; `ESSAY-THE-PHAROS-AT-THE-CENTER.md` proposal 9.
Consequence, constraint: two named projections, "values by these writers" and "what a perceiver who sees only these writers could know", neither called "the" window. Consequence, feature: the share of slots on which two projections differ is a reportable result of the language.

---

## D. Positions, acts, perceivers, sameness

**22. EOQL must hold all 27 positions (nine operators by Ground, Figure, Pattern), and each must be distinguished by something other than its typed label.** [Proposal for the requirement, the user's. Result: real logs use 11 of 27 cells (Ellison 6, Premiere replay 10), no Pattern-grain entry and no SIG entry.]
From: user, `mem/project_eoql_27_cells.md`: "EOQL needs to be able to hold all 27 positions"; `eoql/PREREG-A2.md` A-1 to A-4 (writer-typed labels are unchecked; the first attempt chose a pass-through literal marked `cell_basis: declared-by-writer`).
Consequence, constraint: all 27 cell ids are writable, readable, filterable and groupable as data. Consequence, Open: the memory note says a cell kept only as a typed label is "27 strings", while A2 chose pass-through; the design must say what, beyond the label, distinguishes a position. Consequence, refuse: inferring a cell from a kind name, and silently defaulting an unknown cell.

**23. A position defined by layer membership of the writer's label is label-sensitive, not role-sensitive: in the pharos protocol `kind` is DEF·Figure, `holon` is DEF·Pattern, `frame` is NUL·Ground, so a Ground-layer read of a log that uses only protocol kinds sees only the frame.** [Result (read from `eoql/SPEC-A2.md` 3.2, finding F-A2-1); the claim that 24 of 27 read forms reduce to pre-A2 expressions is DECLARED (SPEC-A2 3.4, 4.4), not tested.]
From: `eoql/SPEC-A2.md` 3.2, 3.4, 4.3 and 4.4; `pharos/SPEC.md` (declarations are entries).
Consequence, constraint: a position must change behaviour through what a construct does, not through which string an entry carries; a test of position sensitivity has to include a case where the label is held and the role changes. Consequence, refuse: counting "relabel changes the answer" as evidence that a position matters when the label only moves the entry between layers.

**24. An operator exists only between frames: no operation exists in a single frame, and NUL is a non-transformation, not necessarily an absence.** [Proposal for the principle, the user's. Result: the frame-diff labeller recovered CON only; it got INS 5 of 9, SIG 4 of 5, DEF 3 of 6, CON 17 of 26 and did not beat "first INS else CON" (30 against 35 of 69; 60 against 98 of 146 with a second rater).]
From: user direction 2026-11-13 and findings in `mem/project_acts_are_frame_diffs.md`; also "propositions are the smallest unit of meaning" and "all meaning requires a ground figure pattern" there.
Consequence, constraint: a construct that reports or checks an operator names the two frames it compares (before and after a fold step, or two perceiver states); an unchanged frame is reported as no transformation, never as a gap or absence (this also bears on 1d). Consequence, Open: how a writer's declared cell is checked against a frame difference when only CON has been recovered.

**25. A role is what a unit does to a perceiver, computed online against the record so far plus the perceiver's priors, and it is perspective-dependent: a blind re-read of the same excerpt changed 124 of 146 labels (85 percent).** [Result]
From: `mem/project_perceiver_relative_roles.md`, `mem/project_acts_are_frame_diffs.md` (perspective test).
Consequence, constraint: any construct that returns a role or cell takes a perceiver (record prefix plus priors) and reports it; two perceivers may disagree and both answers are returned. Consequence, refuse: an objective, perceiver-free label. Judgement by perspective-dependence, not by agreement with model labels.

**26. Same versus Other is a fold under a declared ground for a named reader, the default is Other, sameness is earned, and the verdict has three values (Same, Other, Gap).** [Proposal for the form. Result: mechanical arms found 4 to 10 percent of paraphrases on hold-out 1 and 0 to 3 of 48 on hold-out 2, with false accepts near 1 percent only after earning; a probe over 200 pairs said Same on 4, three of them pairs labelled as contradictions (`mem/project_same_other_status.md`).]
From: `mem/fold-earned-never-typed.md` (user: "We should assume everything is other, it earns sameness"; "sameness always has a for whom"); `SAME-OTHER-MAP.md` sections 1 and 5 (user: "sameness isn't if its identical, its if it is within a difference that makes a difference from the perspective from which we are asking"; every path that reached a verdict still ends in a match of written words); `mem/project_same_other_status.md` (user: "we are doing it wrong if we are not pointing to the nameless"); `note` (Same/Other must take a declared ground).
Consequence, constraint: a sameness construct takes a ground and a perceiver and returns Same, Other or Gap; with no ground it refuses. Consequence, refuse: a default of Same, an equality that searches for differences, and any claim that a surface judges meaning when its engines match words.

**27. One test, the difference that makes a difference, appears in three places and should be one declared notion: sameness (signal against noise), the stop rule, and trail evaporation.** [Proposal]
From: `mem/fold-earned-never-typed.md` (signal is SIG, noise is NUL, user's vocabulary); `note` (stop rule: SIG without INS); `lazy/PREREG-A8.md` (evaporation "based in DMDs", the user's phrase: "evaporation based in DMDs").
Consequence, feature: the baseline of decision 1f is the one place a threshold lives; the three jobs read it. Consequence, refuse: three independently typed epsilons. Consequence, Open: whether one baseline can serve all three, or the shared name hides three different measurements.

---

## E. Agents, small models, trails

**28. Agents ask and do not read: a question goes in, and pointers with bounded excerpts come back, marked "read N of M", and what an agent already received is not sent again.** [Proposal for the interface. Result: the one real small-model contact (`qwen3:4b`, three stub questions) scored 0 of 3; after fixes it made 8 tool calls with an invented kind and dates, got empty results, and answered unknown, never asking for the clip the question named (`ESSAY-THE-PHAROS-AT-THE-CENTER.md` section 7).]
From: user, `mem/feedback_no_full_content_stigmergic_local.md`: "we ideally want the ai models to not need to have the full content at any point, we are working stigmergically, and moving towards being able to do this with a local model", and the hard rule that a model is never allowed to read all of a thing; `ESSAY-THE-PHAROS-AT-THE-CENTER.md` proposal 10; `eoql/SPEC.md` 2.5 F8 (`return: pointers`).
Consequence, feature: pointers are the default result form for an agent caller; excerpts are bounded and counted; a per-caller seen ledger suppresses repeats. Consequence, constraint: the statement surface offers closed questions and short selections that a door can build. Consequence, refuse: a "select everything" form for agents, and an empty result that cannot be told from "not found" or "not asked".

**29. The vision is bookkeeping in the environment, auditable and unconscious to a small model, measured by how many characters the model must see per step.** [Proposal. Open: no small model has run on the substrate; the stigmergic-build experiment was ambiguous.]
From: user, `mem/project_vision_small_model_substrate.md`: "what we now finally have is the substrate where we can have a small, potentially local model do complex things, where much of what it's doing is both auditable and unconscious to the model"; `mem/feedback_no_full_content_stigmergic_local.md`.
Consequence, constraint: ground resolution, as-of cuts, held counts, citation and cost accounting are done by the evaluator and returned as marks, not left to the model to remember. Consequence, Open: blind spots (reads outside the gateway, addressless writes) make "unconscious" risky; the design says which bookkeeping the language owns.

**30. A scent trail is a verified hint with no authority: it only orders where to look, is checked against the content id on every use, is reinforced by use, and evaporates when it stops saving reads.** [Proposal; stamped, not built.]
From: `lazy/PREREG-A7.md` (verify every hint; removing every trail changes no answer, only cost), `lazy/PREREG-A8.md` (net difference per trail by shadow reads, window found by widening, no typed half-life); `ESSAY-THE-PHAROS-AT-THE-CENTER.md` section 6 (trails can harden into trusted checkpoints; Goodhart on the savings measure; the sample rule is guessable).
Consequence, constraint: no language construct may return an answer that depends on a trail; trails shape the plan only, and the result states whether any hint was used. Consequence, refuse: a trail that carries a conclusion, and absolute local addresses as identifiers.

---

## F. Storage, views, flow, writes

**31. A stored view is the expression as an addressable event, never its result, and the stored state a log may hold is only a memoized fold under a stable ground, keyed by head set and ground id.** [Proposal for the design. Result: the lazy store's no-index rule held only after the test author added a no-index-file scan, because a mutant that wrote an index on weave first escaped (`ESSAY-THE-PHAROS-AT-THE-CENTER.md` section 1, citing `test/EXPECTED-CHANGES.md`). Prior art: a relational table is a memoized fold under a stable ground, per the note.]
From: `eoql/PREREG.md` C3; `eoql/SPEC.md` 4.5; `note` ("Stable grounds can compile to layouts"; test on compiled layouts); `lazy/API.md` section 1.
Consequence, constraint: a view's body is expression text; a compiled layout is derived, disposable and never read back as truth. Consequence, refuse: any stored answer, summary, index or checkpoint inside the log.

**32. Data flows any way: formats and stores are projections of the same entries, identity is the hash of the canonical entry whatever the encoding, lossless pairs return identical ids, and lossy pairs name exactly what they lose.** [Proposal for the form. Result: in the partial first attempt 976 of 1,124 flow checks passed; the largest failures were the blocks layout (`jsonl>blocks` lost ids on 20 of 20 seeds in one check), which PREREG-A2 says did not decode a real pharos-blocks store, so they may be stale (`eoql/test/out/f1_flow.json`).]
From: user, quoted in `eoql/PREREG.md`: "make sure data can flow any way"; `lazy/PREREG-A3.md` (an encoding is a representation, id stays sha256 of canonical JSON, torn tails and bit flips handled per encoding); `ledgers/pharos-sqlite/docs/DESIGN.md` (SQLite is a disposable projection, regenerable byte for byte on both real logs, entries with fields outside the eleven protocol fields refused as `E_LOSSY`); `ledgers/pharos-blocks/README.md`.
Consequence, constraint: a conversion is a fold with a loss manifest computed as the difference of two measurements, never a declaration. Consequence, feature: moving between data models is the same log under another ground (see 40), so a flow statement names the target ground. Consequence, refuse: silent drops, and a foreign import with no `basis` naming importer and input hash.

**33. Writes are appends: a retraction is a mark and never removes a value, deletion is untouched by the wave fold, and erasure needs a typed hole that folds report instead of failing or guessing.** [Result: in the partial first attempt, write identity matched `weave` ids on 25 of 25 scripts (`eoql/test/out/f2_write.json`, 196 of 198 checks) and 4,000 fuzzed write statements produced 0 append-only violations (`eoql/test/out/s_safety.json`). Prior art: Matrix redaction keeps the skeleton and strips content (note). Open: the hole form.]
From: `note` (deletion untouched; test on erasure); `pharos/SPEC.md` (unweaving is a typed retraction entry); `ESSAY-THE-PHAROS-AT-THE-CENTER.md` section 6 (retraction cannot unwrite poison); EO wiki (no-deleting follows from append-only identity).
Consequence, refuse: UPDATE and DELETE. Consequence, Open: an erasure entry that blanks content and keeps the skeleton, and the result form that reports a typed hole in a cone (test 40k).

**34. Reading writes nothing: a projection is computed and no entry results, yet audit and trails want a trace of the read, and the two have to be kept apart.** [Prior art: the EO wiki says "reading is not writing", there are emissions and projections "and nothing in between". Result: 0 writes in 8,000 fuzzed read-mode executions (`eoql/test/out/s_safety.json`). Open: where read traces are written.]
From: the EO wiki near line 17852 (the wave fold from three commitments: the log is primary, a held value can carry two or more values without resolution on write, collapse happens at read and never at emit); `lazy/PREREG-A7.md` (a trail is deposited as a by-product of a read); `ESSAY-THE-PHAROS-AT-THE-CENTER.md` proposal 9 (reading leaves a trace through a gateway outside the language).
Consequence, constraint: the evaluator is read-only by default and a write is a separate, explicit form. Consequence, Open: whether read traces are written by a gateway outside the language (keeps the wiki's rule) or by a language construct (keeps the audit story); the design chooses and states the cost. DECLARED, not a finding: the wiki reads DEF, EVA and REC as axiom, satisfaction and frame change and says UPDATE conflates all three; if kept, a change of value has no single verb.

---

## G. What the first attempt got wrong, and what to measure instead

**35. The first attempt took SQL containment as a design constraint, and that was the designer's choice, not something learned.** [Result: in the partial run 191 of 228 SQL-core queries came back identical (83.77 percent, 0 wrong without a named gap, 16 errored, 1 translator crash; `eoql/test/out/p1_sqlcore.json`); an earlier partial run recorded 206 of 228 and v1 conformance 27 of 31 strict (`eoql/PREREG-A2.md`). Neither is a finished run.]
From: `eoql/PREREG.md` C4 and P1, `eoql/PREREG-A4.md` ("SQL-core containment (P1, V2) and v1 conformance (V1) stop being PASS BARS"); `eoql/SPEC.md` 2.7 and 9.2 question 13 (adopting SQLite's value rules wholesale makes P1 a definition and EOQL "inherits SQLite's oddities").
Consequence, refuse: SQL's three-valued logic, NULL as the only absence, and its value coercions as kernel semantics. Consequence, feature: SQL is a projection (relational ground: identity is a key, time is overwrite, absence is NULL) whose reproduction of the pharos-sqlite tables is a test, not a syntax requirement.

**36. The closed collapse vocabulary and the other typed lists were grounds in disguise.** [Result (read from the spec): F3 took a closed list `all history none drop-retracted latest effective-latest`, so `latest` and `effective-latest` were built-in "newest wins" rules, and every fold the spec knew was a way of collapsing a held set (`eoql/PREREG-A3.md`). The spec also fixed three closed vocabularies for scalar, aggregate and window functions, a table of grain defaults (Ground `effective-latest`, Figure `none`, Pattern `drop-retracted`, DECLARED), and defaults for ancestry and ordering.]
From: `eoql/SPEC.md` 2.5, 2.6, 2.7; `eoql/SPEC-A2.md` 3.2; `eoql/PREREG-A3.md`.
Consequence, refuse: any vocabulary of folds, windows, defaults or functions that the evaluator interprets as a keyword. Consequence, constraint: if a vocabulary is needed it is a starter set of declared entries by a named author, and the count of cases that could not be so declared is reported (see 8 and 11).

**37. The one-statement measure did not separate EOQL from SQL when SQL queried a projection that already stored the fold.** [Result (a reviewer's finding recorded in `eoql/PREREG-A2.md`): the SQL arm queried the pharos-sqlite tables (position, heads, conflicts, causal latest), and 106 of 107 SQL answers were one recursive statement. The stored P2 scored an older answer file: EOQL 59 of 107 against SQL 105, which says nothing about the finished language.]
From: `eoql/PREREG-A2.md` Part B; `eoql/test/out/p23_answers.json`.
Consequence, refuse: statement count as the measure of power. Consequence, feature: measure what must be re-implemented in each query (the fold, the ground, the stop) and what a change of ground costs the asker; compare against SQL over a plain entries table that carries no stored fold, and say how a stored fold in the projection counts.

**38. EOQL v1 enforced no frame, and the first attempt's frames were still defaults rather than declarations.** [Result for v1 (project memory, not re-run): bare count passes and IN-list and UPDATE compile wrongly (`mem/project_eoql_27_cells.md`); and by reading, v1's parser dropped trailing tokens, dropped NOT on LIKE and BETWEEN, and compiled INSERT, UPDATE and DELETE as reads (`eoql/SPEC-A1.md` 2.5, V1-a to V1-h, "read from source, not run").]
From: those files; `eoql/SPEC.md` 2.5 (eight frame arguments, each with a default).
Consequence, constraint: a statement with no declared or inherited frame (ground, perceiver, cut, baseline) is refused or returned marked as framed by default; the parser is total and never translates a prefix; every refusal is typed with a position. Consequence, Open: whether "refused" or "marked" is the right behaviour for a missing frame.

**39. Real problems with real data come first, and the real logs are thin and partly artifact.** [Result: the Premiere replay (10,244 entries) is one total causal chain on which the frozen rule finds 0 conflicts, so its 1,336 held addresses may come from the head rule; only 99 planted forks are known disagreements (`ESSAY-THE-PHAROS-AT-THE-CENTER.md` proposal 2). The Ellison log has 764 entries from three writers, and its verifier returned 45 failures against 202 extracted statements, with roles assigned by a pipeline, so it is not evidence of coordination through the log (same essay, section 6).]
From: `eoql/PREREG-A4.md` item 8 (Premiere lanes: created, by whom, in flight; Ellison statements with basis; held values; perceiver windows; the intelligence-test questions); `mem/MEMORY.md` entries "Real problem first" and "Route requests to the pipeline" (not re-read).
Consequence, constraint: every worked example names a real log excerpt (read-only copy), says what in it is real and what is planted, and states the result. Consequence, refuse: invented demo stories and held counts presented as disagreements when they may be artifacts of the dependency relation (see 20).

**40. The twelve open tests of the One Log note are the language's acceptance questions, and each already implies a feature or a refusal.** [Open: none of the twelve has been run. The note says "The design is argued here, not measured."]
From: `note` section "Open problems and tests to run". Each test with the consequence it implies:
- (a) Head finding: show how starting heads are located and what the reverse index costs. Consequence, Open: the language needs a head-finding form; an index is derived and disposable (31).
- (b) Stop-rule soundness: seeded consequential changes split into many small edits must not stop the fold early. Consequence, constraint: cumulative sufficiency (15).
- (c) Starvation versus convergence: an important ancestor behind a long chain of trivial refinements must still be reached. Consequence, constraint: per-branch declared roots (16).
- (d) Corroboration queries: no stop at the first hit when the shape asks for standing or source count. Consequence, feature: declared question shape (14).
- (e) Late arrival: a backfilled event shows which memoized folds stay valid. Consequence, constraint: memo keys by head set and ground id (19).
- (f) Concurrent heads: define head choice and what the default "both" returns. Consequence, Open: head choice is a ground decision (19, 1a).
- (g) Rules that look back: retraction-style rule events must keep evaluation terminating and stratified. Consequence, constraint: rule events cite only earlier events (9).
- (h) Ground falsification: check a published ground's predicted structure under a declared null. Consequence, feature: grounds carry predictions (6).
- (i) Compiled layouts: compare a stable-ground fold with a conventional table over the same data. Consequence, feature: a compile form is derived state under a stable ground (31); relational is one declared ground and should reproduce the pharos-sqlite tables (criterion C-5).
- (j) Whole-corpus queries: measure the fold against a columnar engine on an aggregate. Consequence, constraint: the language says when a question is whole-corpus (13).
- (k) Erasure: typed holes that folds report and do not fail or guess. Consequence, Open: the hole form (33).
- (l) Kernel size: list everything hardcoded and check none is a ground in disguise. Consequence, constraint: the printed inventory of criterion C-2 (11).
Consequence for the many-models claim (criterion C-5): relational, document, graph, key-value, time-series, event-log and CRDT families are each to be declared as a ground over decisions 1a to 1f concretely enough to test; the note states that no existing system is also a first-rate graph, vector, columnar and full-text store at once, so the design must not promise native-engine speed.

---

## Count and constraint ranking

Forty learnings are listed (A: 1 to 8, B: 9 to 12, C: 13 to 21, D: 22 to 27, E: 28 to 30, F: 31 to 34, G: 35 to 40).

The five that constrain the language most, in the collector's order:

1. Learning 1 with 2: the six decisions (identity, dependency, time, absence, sufficiency, baseline) are read from an adopted, bylined ground, so the evaluator may hold none of them.
2. Learning 11 with 36: the kernel is small and printed, and every hardcoded item (collapse list, ancestry default, tie-break, defaults, function lists) must pass the ground-in-disguise test.
3. Learning 10 with 18: the default is both, with a survivor count and a grade, and every failure may cost only reading; "I could not tell" is an answer.
4. Learnings 14 to 17: stopping is judged against the accumulated answer, by the question's shape, per branch, and recorded as a revisable event.
5. Learning 28 with 29: agents ask and receive pointers and bounded excerpts, and the evaluator carries the bookkeeping.

Not ranked but worth a decision: learning 22 against 23 (all 27 positions held, but distinguished by more than the typed label), and learning 34 (reading writes nothing, while audit wants a trace).
