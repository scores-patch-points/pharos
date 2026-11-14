# pharos-intelligence

A pre-registered, falsifiable test of whether the pharos read side is "intelligent" in one operational sense: a small local model shown only pointers and excerpts answers questions about a log as well as full context where that fits, and each read-side feature (schema as ground, held pasts with a survivor count, scent trails) makes a measured difference.

**Status: design and instrument only. No result on the real engine or a real model exists.** The harness passes its own 23 controls and catches 18 planted harness mutants on a synthetic stub (see `HARNESS-CHANGES.md`); that says nothing about pharos.

- `PREREG.md` and amendments `PREREG-A1` to `A6`: the claim, arms, metrics, controls, decision rules, mutants, limits. Each has `.sha256` and `.time`, stamped before any result.
- `QSET-SPEC.md` and `QSET-SPEC-A1.md`: how a different agent writes and seals the questions, blind to the engine.
- `harness/`: the instrument (`node harness/selftest.mjs`, `node harness/mutants.mjs`). Node built-ins only.
- Not included here: the data pins and environment inventory that `PINS.sha256` covers (they name local paths and the real-data layout), and all run output.
- Waiting on: the stage 2 engine adapter, a blind question author, and a chosen pair of local models.

Note: `HARNESS.sha256` was regenerated for this public copy and does not list `harness/tools/pin-data.mjs` (omitted: it hard-codes a local path). The adapter method formerly called `info()` is `describe()` here (the public scan read the old method call as a hostname); stamped prose in `PREREG.md` and `PREREG-A2.md` still says `info()`. Some files refer to design documents in `ledgers/pharos-lazy/` (amendments A1 to A9 of the placed-log work); that folder is not part of this public repository, so those references point outside it. Redactions are listed in `REDACTED.md`.
