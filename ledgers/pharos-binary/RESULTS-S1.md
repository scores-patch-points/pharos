# RESULTS S1 (PREREG-S1.md, stamped 2026-11-17T05:29:03Z, sha256 9a3a30b9…)

**Verdict: B5 FAILED; everything else held.** Per the decision rule, S2 waits for the user's decision.

| hypothesis | result |
|---|---|
| B1 identity | every odd value round-trips with its id; 20,000-entry log: JSONL -> PHB -> JSONL byte-identical; entries/fold/status identical (after S1-A1, below) — HOLDS |
| B2 union and merge | mixed .jsonl/.phb directories fold identically; merge across formats commutative and idempotent — HOLDS |
| B3 integrity | torn tail at every byte of the last record: earlier records read, tear reported, appends resume after a RESYNC; one flipped byte in record k: only records before k read, nothing invented; forged id: reported, never read — HOLDS |
| B4 size | PHB 4,245,927 bytes vs JSONL 7,495,578: 56.7% (bar <= 60%) — HOLDS |
| B5 speed (cold load, median of 5) | first run PHB 742 ms vs JSONL 482 ms; after S1-A1 PHB 347 ms vs JSONL 256 ms (1.36x) — **FAILS** |
| B6 existing suite | `jsonl`: 46/46 (34 old + 12 new). `phb`: 43/46; the 3 failures are 3 of the 6 named JSONL-byte tests (two writers, corrupt JSONL line, CLI file name), each with a PHB equivalent that passes — HOLDS |
| B7 blobs | round trip, stored once, merged, damage detected — HOLDS |
| B8 backward framing | backward walk == forward walk reversed, including after a resync — HOLDS |
| mutants | M1 no chain check: caught by B3b; M2 no id check: caught by B3c; M3 size off by one: caught by B8 |

## Post-result changes, disclosed
- **Test fix (B2, before any verdict was drawn):** the merge test compared two targets' full id sets, which can never
  match (each target has its own frame and kinds); it now compares what was merged in. A test design error.
- **S1-A1 (after the first scale run):** (1) the decoder emits keys in canonical (sorted) order. The first run's
  "views differ" was key ORDER only: every entry, retraction, conflict and the frontier were identical; unit tests
  (order-insensitive) had passed. (2) a faster decoder (strings and hex read straight from the buffer). Speed improved
  from 742 to 347 ms but still misses the bar.

## What B5's failure means
A FULL cold load is about 35% slower in PHB: JSONL is parsed by the engine's native JSON parser, while PHB decodes in
JavaScript and verifies a sha256 hash chain on every record, which JSONL cannot do at all. The binary format was chosen
for integrity, size and seekability; its read-speed benefit is meant to come from S2 and S3, which read a fraction of
the log, not from full scans.

## Decision recorded 2026-11-17T05:41:15Z
The user accepted B5's failure (full cold loads about 35% slower in PHB, the price of a verified hash chain and
JavaScript decoding) and directed S2 and S3 to proceed. The default format stays `jsonl`.
