# PREREG S2: fold backward from the newest entry, stop only on proof

Written before any S2 code exists. Stamped first. Builds on S1 (RESULTS-S1.md; B5 failed and the user accepted it).
Prior art and bars: the essay's A4 (fold backward, stop early), A6 (every shortcut errs toward reading more: a false
"no" must be 0). The pharos-lazy ledger these come from was not found anywhere reachable, so its numbers are not
reused; its stated bar is.

## The question
`heads(addr, cell)`: the live entries at (addr, cell) that no other live entry at the same (addr, cell) descends from,
retractions applied exactly as `fold` applies them (a retraction can itself be retracted). The reference answer is
computed from the full view.

## The mechanism
1. **A chained bit.** A PHB ENTRY record whose payload version byte is 2 says: "this entry descends from the previous
   ENTRY record in this same file". `weave` sets it only after CHECKING it in the view it already holds; `merge`,
   `convertFile` and anything else leave it 0, unless `convertFile` checks it against the full view of the source.
   S1 records (version 1) are unchained. A reader re-checks the bit for every record it reads (prev id must be in the
   record's ancestry within what was read; if it cannot be shown, the bit is treated as 0).
2. **`askHeads(h, addr, cell)`**: read every writer file BACKWARD, one record at a time, round-robin. Stop only when,
   in EVERY file, the oldest record read so far is a proven ancestor-or-equal of some live head candidate at
   (addr, cell), AND every record before it in that file is chained. Then every unread entry is an ancestor of a live
   head: it is superseded, it cannot retract a head (a retraction comes after its target), and it cannot be a rival
   head. JSONL files, and any file with an unchained stretch, are read to the start. Returns the heads, the records and
   bytes touched, and whether it stopped early.

## Experiment (seed 20261125)
A log built by REAL weaves (so chains are earned): 4 writers interleaved, ~3,000 entries, addresses drawn hot and cold,
concurrent forks (two writers updating one address unaware of each other), retractions, a retraction of a retraction,
and one MERGED file (verbatim copies, unchained). 1,000 questions over existing (addr, cell) pairs plus 100 over
absent ones. HOT = the address's newest entry lies in the last 10% of the log.

## Hypotheses
- **S2-1 same answers.** askHeads == heads from the full view on all 1,100 questions. One mismatch falsifies.
- **S2-2 no false "absent".** For every question whose full answer is non-empty, askHeads is non-empty (a subset of
  S2-1, named because the essay names it).
- **S2-3 it reads little where it should.** On HOT questions the median share of the log's bytes touched is < 5%.
  (Cold questions are reported, not barred.)
- **S2-4 the bit is honest.** Every chained bit written by weave in the experiment is true when checked against the full
  view; merged and converted-without-check records carry 0.
- **Mutants, each must fail:** M1 stop at the first entry found at (addr, cell) -> S2-1 on forks. M2 trust every record
  as chained -> S2-1 on the merged file. M3 ignore retractions -> S2-1 on retracted heads.

## Decision rule
All hold and all mutants are caught: S2 is done and S3 may begin. Otherwise report and stop.
