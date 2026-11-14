# Amendment A4: EOQL is invented from what we have learned, not from SQL or from v1

Written 2026-11-14 after the user said "we are needing to invent what EOQL is based on what we are learning" and chose to resume the work. Stamped with `.sha256` and `.time`. PREREG.md and A1-A3 stand as records. This amendment changes what the next stage is and what counts as a bar.

## What changes
- **SQL-core containment (P1, V2) and v1 conformance (V1) stop being PASS BARS.** They were my design constraint ("contain the relational core"), not a result of anything learned. They stay as reported comparisons. The better question they point at replaces them: SQL, and every other database family, is a PROJECTION of the one log under a declared ground (the user's design note, "One Log, Many Projections", 2026-11-14, text pinned in `prior/one-log-many-projections.txt`). A relational ground (identity = key, time = overwrite, absence = NULL) is one ground among others; whether EOQL can declare it and reproduce the relational projection is a test, not a requirement on the syntax.
- **The build on SPEC.md, SPEC-A1/A2 is parked.** The spec was shaped by SQL containment and by a closed collapse vocabulary; building further on it is wasted work until the design below is chosen. Its findings (partial run) feed the design; nothing is deleted.
- **No new power claim, no new bar, until a design is chosen.** The words rule of PREREG (no "vastly") stands.

## What EOQL is to be derived from (the learnings, with where each lives)
1. A ground is bylined events and settles six things: identity criteria, dependency relations, time regime, absence semantics, sufficiency (the stop rule), baseline. Conflict rules are asserted events; the default for contradiction is both; the kernel stays small (nine operators, dependency order, the both default) and anything creeping into it is a ground in disguise. (`prior/one-log-many-projections.txt`)
2. The wave fold: backward from heads along dependency order, stop where what remains makes no difference to the answer, per branch, against the accumulated answer, with the stop recorded as a revisable event. (same note; pharos-lazy A4-A8)
3. Superposition is one fold among many; the schema (ground) chooses the fold. (PREREG-A3)
4. All 27 positions (9 operators x Ground/Figure/Pattern), cells earned never typed, labels writer-typed and unchecked, real logs use 11 of 27. (PREREG-A2; project memory)
5. Agents ask and receive pointers and excerpts, never read the log; scent trails are verified hints that evaporate by DMD; errors may only cost reading, never answer wrong. (pharos-lazy A6-A8; ESSAY-THE-PHAROS-AT-THE-CENTER)
6. Operators read a query in order scope, filter, group, aggregate, frame (holodeck `eoTrace`), and acts are frame differences (project memory); the seed grammar `OP(arg)` with nesting exists in holodeck and EOedge.
7. Same vs Other is a fold under a declared ground and must refuse without one (project memory; SAME-OTHER-MAP.md, read-only).
8. Real problems with real data: Premiere lanes (what was created, by whom, in flight), Ellison statements with basis, held values, perceiver windows, the intelligence-test questions.
9. What the first attempt taught: the one-statement measure did not separate EOQL from SQL when SQL queried a projection that already stored the fold; v1 validated nothing about a frame; closed vocabularies hide grounds.

## The design round (no build)
Three independent designers (premises: ground-first; frames and the 27 positions; asking by pointers with stop rules), one synthesizer, two hostile critics, one writer. Output `EOQL-DESIGN.md`, judged by criteria fixed now:
- **C-1 Learnings coverage.** Every one of the twelve tests in the One Log note, every learning above and every A1-A8 amendment of pharos-lazy maps to a language construct or is named out of scope with a reason.
- **C-2 Smallness.** A complete inventory of everything the evaluator must hardcode (the kernel), each item justified as not a ground in disguise; the count is printed.
- **C-3 Not renamed SQL.** For each construct the nearest construct in SQL, a graph or document language or Datalog, and a critic's call: rename, refinement or new. The share with no counterpart is printed. A design whose constructs are mostly renames fails this criterion honestly.
- **C-4 Real problems.** At least 12 worked examples in the language from the real problems above, each walked by hand against a real log excerpt (read-only copies), with the result.
- **C-5 Many models, one log.** Relational, document, graph, key-value, time-series, event-log and CRDT families each declared as a ground concretely enough to test; the relational one specified so that it should reproduce the pharos-sqlite tables.
- **C-6 What it would teach about EO** with an outcome that would count against it.
- **C-7 Decisions for the user**, listed, each with the designers' recommendation and what the other choice costs.
After the design the user chooses; then a new pre-registration (build and tests) is written before any build, with fresh blind authors.

## Limits
A design document is not a result. Nothing here shows EOQL works; the design is judged on coverage, smallness, novelty and worked examples, and its tests come next.
