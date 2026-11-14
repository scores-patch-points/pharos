# Findings: Janus's reasoning through the three mathematics (2026-11-14)

Written by the main EOQL session from the subagent's final report, because the subagent's harness does not let subagents write report files. The numbers below were checked against `out/settle.json`. The reasoning log's hash is unchanged (`out/log.sha256.before` equals `out/log.sha256.after`).

Pre-registration: `PREREG.md`, stamped 2026-11-14T22:32:13Z, sha256 9a0ae7f8. `src/settle.py` was written after the stamp and was not hashed before the run; this is disclosed.

## The test

- **Prediction:** each ground's reading settles more in the real run order than in a shuffled order, i.e. identity is reached in the limit.
- **Measure:** T, the share of a ground's last runs that make no difference.
- **Bar:** p < 0.05, and at least half of grounds end settled.
- **Null:** 1,000 shuffles of the run order.
- **Harness self-check:** passed.

## Result: FAIL

- **Unit level** (79 grounds varied): T 0.070 against a null mean of 0.135 (null p95 0.226), p 0.914. Grounds ending settled: 0.18, against 0.53 under the null. Early-to-late change: +0.26, against −0.06 under the null. The real order is *less* settled than chance, with more change late.
- **Fingerprint (kind) level** (62 grounds): T 0.159 against 0.167, p 0.537. Also fail.
- The rule to stop when one more run makes no difference has nothing to stand on in this log.

## Exploratory, not pre-registered

- On the 49 grounds read 18 times, the number of grounds changing at each step runs 31, 31, 31, 26 (seven times), 29, 29, 36, 36, 36, 36.
- 554 of 791 changes return to an earlier reading. The runs alternate between a few setups rather than refining.
- The runs with the most changes are all ok=false, 2026-10-21 between 02:24 and 03:29Z.
- The kind level moves fewer grounds than the unit level (62 against 79), so the unit decides.

## Note on the project owner's ruling ("let janus handle geometry, penelope handles calculus")

This is a calculus test, so under the ruling it is Penelope's computation run on Janus's log. The failure means Penelope's ladder should be built from declared resolutions, not from run order. Janus's part comes first: split the runs into their arms (the alternating setups), and keep the claim-side and source-side ids, which the log drops today. Fingerprint against unit is a two-rung ladder, which gives one step, not a limit.

## Not checked

- Truth: the log has no labels.
- Whether the arms are different setups, randomness, or code edits between runs.
- The other janus organs, such as corroboration.js and talk-reason.js.
- Any shuffle test of the cell assignments in MAP.md, which are nominations.
- Representativeness: nearly all claims come from 2 sessions. The reasoning spiral never wrote this log; khora's `cli/reason.mjs` did, mostly fed by `eot-janus.js`.
