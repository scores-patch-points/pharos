# RESULTS S2 (PREREG-S2.md, stamped 2026-11-17T05:41:36Z, sha256 5a858394…; every change made before the run is in PREREG-S2.md.notes)

Run: lib/pharos.mjs b9ad4197…, run-s2.mjs b31c3b6c…, test/binary.test.mjs c1732a35… (seed 20261125, 3,000 steps, 3,207 entries, 4 PHB writer
files, 1,100 questions of which 218 hot, 100 over absent addresses).

| hypothesis | result |
|---|---|
| S2-1 askHeads == heads from the full view | 0 mismatches of 1,100 — HOLDS |
| S2-2 no false "absent" | 0 — HOLDS |
| S2-3 hot addresses (head in the last 10% of the log): median share of bytes touched < 5% | **4.76%** — HOLDS, narrowly (cold addresses: median 44.4%; absent addresses: 100%, since absence cannot be proved without reading everything) |
| S2-4 every chained bit written by weave is true | 3,087 true, 0 false; 120 unchained (merged) records, all carrying 0 — HOLDS |
| mutants | M1 stop at the first single head: caught by the world (1 wrong) and by the targeted tests. M3 ignore retractions: caught by the world (60 wrong) and by the tests. **M2 trust every record as chained: NOT caught by the generated world (0 wrong); caught by the targeted test.** |

Early stops: 962 of 1,100 questions (all 218 hot). Fallbacks to the full view: 0.

## What the caveats are
- **S2-3 passes by a hair.** The bar is hard for this definition of "hot": a head in the last 10% of the log has, at the median, 5% of the entries NEWER
  than it, and every one of them must be read. The 300-step smoke runs gave 7%. A different seed or log size could fail it.
- **M2 needs a targeted test.** With newest-first reading, merged records are read in time order, which here matches causal order, so no generated
  world can make "trusting an unchained record" produce a wrong answer. The preregistration named the generated world as the power check; that did not
  reach M2, so the deterministic test "S2 an unchained record proves nothing" (a rival head hidden below an unchained record) is the check, and it fails
  under M2. Reported as it is.
- **The reader trusts the chained attestation.** A version-2 record asserts it descends from EVERY earlier entry record of its file (true by
  construction for weave, verified here 3,087 of 3,087). The reader does not re-derive it, so a writer that lies could make an early stop wrong. A reader
  that does not trust a writer should use `heads` (the full view) or read that file whole. The PREREG text said "a reader re-checks the bit": that part is
  NOT implemented.
- **Design changes between the first (killed) run and this one**, each made after a smoke run and before this run, all in PREREG-S2.md.notes: the reader
  was made incremental (the first version was quadratic: 66 CPU-minutes without finishing); a bug found by the smoke test (stale candidates) was fixed;
  reading became newest-first across files; forks became two concurrent writers.
- Cold addresses are not faster than a full read at the median (44%). That is what Stage 3 (an index kept as a trail of what reading found) is for.
