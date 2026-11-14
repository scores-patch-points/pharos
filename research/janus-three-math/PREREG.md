# Pre-registration: does Janus's reasoning log settle in the limit? (stamped before the test is computed)

Written 2026-11-14 by the "three mathematics" subagent. Read-only on the log. Nothing in janus, khora, the-fold, penelope or pharos is changed.

## What I have already seen (disclosed, so the reader can judge the contamination)
- The marginal survey in `out/survey.json` (script `src/survey.py`): 5,043 lines = 179 `reasoning-run` + 4,864 `reasoning-claim`; 5 sessions; 114 grounds; `supersedes` is null on every line; citation verdict `cited` 3, `unaddressed` 4,861; polarity `+` 4,701, `-` 163; source `hand-authored` on all claims; 121 of 179 runs say `ok=false`. Runs per ground: 49 grounds have 18 runs, 23 have 9, 24 have 8, one ground (`/p`) has 105; the rest are small.
- The code that wrote the claims: khora `native/organs/eot-janus.js` (ground `/p<id>`, referent ids `b1`, `b2` per pair) through `cli/reason.mjs` and `cli/reasoning-ledger.mjs`.
- I have NOT computed any per-ground sequence, any set difference between runs, or anything else this test reads.

## The prediction (from EXTRAPOLATE.md, calculus at Pattern grain)
The canon's reading (THE-THREE-MATHEMATICS.md §III, and the project owner's ruling of 2026-11-14) says an integral is identity reached in the limit: the accumulation stops when one more refinement makes no difference under a declared resolution. Janus's log re-reads the same grounds (`/pN`) many times as its machinery changed. If its reasoning behaves as a limit, the reading of each ground should SETTLE: late runs should restate the ground as the run before did, and the settling should be a property of the real order of runs, not of counting alone. If the log is instead a set of exchangeable re-readings (flip-flops, configurations alternating, nondeterminism), real time order should look no more settled than a shuffled order.

## Declared resolution (the DEF; nothing else is tuned)
- A claim's unit at ground g: the tuple (polarity, rel, sorted role name=value pairs), from the line's own fields. Polarity null reads as "+" (the fold's own rule in `cli/claude-code-context.mjs`).
- The reading of g at run r: the SET of units of the claim lines of run r whose `ground` is g. A run belongs to the claim lines that follow its `reasoning-run` line, up to the next run line (the writer's own order, `cli/reasoning-ledger.mjs`).
- Runs are ordered by their position in the file (append-only, so file order is time order).
- For ground g with runs r_1..r_m (only the runs that touched g), the difference sequence is d_k = |S_k symmetric-difference S_{k-1}|, k = 2..m. A difference of 0 units makes no difference; 1 unit or more does (the tolerance is "less than one unit", the DEF of the EVA, as in ledgers/eoql-27-demo).
- Secondary resolution, reported but not the bar: the same with the unit coarsened to the engine's own `fingerprint` (a shape digest, kind level). The "unit decides" check: the two resolutions may disagree, and that is reported, not chosen between.

## Statistic, bar and null
- Informative ground: m >= 3 and at least one d_k > 0.
- Per informative ground, z_g = (length of the terminal run of zeros in d) / (m - 1).
- **T = mean of z_g over informative grounds.** Secondary: F = share of informative grounds whose last d is 0; and the early-late contrast, share of nonzero d in the second half minus the first half (negative = settling).
- **Null: run-label permutation.** 1,000 draws, seeded (seed 20261114, a fixed LCG in the script). Each draw permutes the order of all 179 runs at once (one permutation applied to every ground, so a run's claims stay together and runs that touched several grounds stay one event); d, z and T are recomputed. p = (1 + number of draws with T_null >= T_obs) / 1001.
- **PASS:** p < 0.05 AND F >= 0.5. The log's readings settle in real order more than in shuffled order, and most informative grounds end converged.
- **PARTIAL:** p < 0.05 and F < 0.5 (settling, not converged).
- **FAIL:** p >= 0.05. Then the calculus extrapolation "a claim's standing as a limit over refinements" has no support on this log: its re-readings are exchangeable, and a stopping rule over them would be a stopping rule over noise.
- **UNDERPOWERED:** fewer than 10 informative grounds. Reported as such; no pass or fail is claimed.

## Harness check before the log (must hold or the run is void)
On synthetic sequences built in the script: (a) a ground that changes for 5 runs then repeats for 10 must give z = 10/14; (b) 40 grounds that converge must PASS against their own permutation null; (c) 40 grounds that alternate between two readings (A B A B ...) must not PASS. If any of these fails, the statistic is broken and the log is not read.

## What it would show / not show
A PASS would show that the real log has the directional settling that makes "identity in the limit" a meaningful thing for Janus to compute over re-readings. It would NOT show that the settled readings are right (there are no truth labels in the log), that settling is due to reasoning rather than to the code being frozen late in the session, or anything about logs other than this one. Only 2 real sessions carry nearly all claims, so the result is about those two sessions. One author, no blind replication.
