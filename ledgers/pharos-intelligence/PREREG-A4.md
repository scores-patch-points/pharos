# Amendment A4: the erase test (`DEF x VOID`), a frontier by place, not one number

Written 2026-11-14 BEFORE any erase design is built and before any result. Stamped with `.sha256` and `.time`. `PREREG.md` and A1 to A3 stand. Origin: the project owner's ruling (relayed by the text-finder session, `local_ebda598a`) that an erase must exist: `DEF x VOID` physically removes the payload, leaves a tombstone, ripples down the dependency chain ("the only way GDPR is possible"). Raised by the intelligence-test session: writer files must stay an unchanged prefix and readers hold byte cursors, so a line cannot be rewritten; the text-finder session proposed encrypting every body at write under a key held outside the writer files, destroyed at void. This test is design-agnostic: it takes whatever erase is built (key destruction, per-entry salt, stripped tombstone) and measures it. Nothing here is built or run.

## Claims tested (each can fail)
- **E1 no recoverable body.** After a void of entry x, the planted body of x is found in no reachable place, by byte search.
- **E2 no confirmable body.** The body cannot be CONFIRMED from what remains: recomputing the id from the tombstone plus a guess does not match for any guess in a candidate list that contains the true body. (A guessable id is a leak even when no byte survives.)
- **E3 ripple.** Every entry whose `of` reaches x is voided or marked as depending on an erased entry; entries derived from x with NO `of` are not found by any ripple and are reported as leaks (planted on purpose as a control: expected to leak).
- **E4 a third answer.** `ask` on x returns "erased", distinct from "not recorded" (never existed or never written) and from empty. The five absences the finder keeps apart (erased, not recorded, asked and no answer, nobody to ask, not asked because the answer could not change) are not all testable here; only erased versus not recorded is.
- **E5 storage invariants hold.** No existing shard byte changes (prefix hash of every file before and after, as pharos-lazy W13), no inode change, reader cursors still valid, no writer wrote another writer's file.

## Method
- A seeded generator plants unique bodies: 128-bit random strings (hex), generated at test time from the seed, so a hit is unambiguous. Planted: (a) bodies on entries that will be voided; (b) derived entries with `of` to them; (c) derived entries WITHOUT `of` that copy the string (the leak control); (d) entries whose `addr`, `by` or `basis` hold a planted string (the requirement from the text-finder session that addresses are never the content: expected to fail E1 for any design that cannot blank those fields afterwards); (e) bodies that are short and guessable (a name, yes or no) for E2, with a candidate list of 1,000 guesses that contains the true body.
- Candidate-guess check (E2): for each remaining field of the tombstone and each guess, recompute the id by the library's rule and compare; success of any guess on a voided entry is a leak.
- Byte search: the planted string, its JSON-escaped form, lower and upper case, base64 and hex of it; over every place below. Search is by the harness, not by the system under test.
- The test runs on a COPY (a scratch frame), never on the real Premiere or Ellison logs; real entries are never voided by this test.

## Places (reported one by one; the result is the table)
log shards (all writers), the tombstone entry itself, merged replicas and a second placed copy, retired segments, indexes and page tables, T-log and T-mem trails, harness trace and records files, the seen ledger and the prompts and tool results sent to a model (adapter log), sealed question files and answer commitments, rendered documents derived from the log (a LEDGER.md-style rendering), SQL and other projections, a backup snapshot (restic-style copy), scale-ladder shards. Places the ripple cannot reach by design are listed as NOT REACHED, with the reason, and are NOT counted as passing.

## Controls and mutants
- Positive: on a log with no erase, the search finds the planted string in every place that holds it (the searcher has recall); on a log where the void only retracts (`NUL`), E1 and E2 FAIL.
- Null: an unplanted random string gives zero hits in every place.
- Mutants the test must catch: M-E1 the void rewrites the line in place (E5 fails); M-E2 the void deletes the body but leaves a recomputable id and the tombstone's full fields (E2 fails); M-E3 the void drops the key but a replica merged later restores the line (E1 fails on the replica); M-E4 the searcher looks only at the log files (the controls fail because planted copies elsewhere are missed); M-E5 ripple follows `seen` instead of `of` (E3 over-voids: counted entries voided that do not depend on x); M-E6 `ask` returns the same answer for erased and not recorded (E4 fails).

## Decision rule (neutral)
No pass/fail number. Per place: HIT, NO HIT, or NOT REACHED; per claim E1 to E5: HOLDS, FAILS, or NOT TESTABLE. "Erase is complete" is REFUTED if any reachable place holds the body or confirms it (E1 or E2 fails); it is SUPPORTED for the reachable places only if all hold, and the NOT REACHED list is reported beside it as the frontier.

## What it would teach about EO
What a perceiver can know about what it cannot know: erased is a kind of absence, not a kind of nothing; whether DEF to VOID leaves a trace that says so without carrying the content. Whether an address can ever be the content (it cannot, if erase is real).

## Limits
Planted strings only: real personal data has paraphrases, derivatives and screenshots no search can find. One machine, one language. Encryption design, key custody and legal sufficiency (GDPR) are not tested here; this measures technical recoverability. A past copy made before the design exists (backups, model training, mirrors outside the repository) cannot be reached.

## Needs
An erase design built by the storage owner (not this session); a question family `XQ-ERASED` for the model-facing test (written and sealed by the question author, a different agent, after a design exists) on a scratch log; the erase-capable `ask` of E4.
