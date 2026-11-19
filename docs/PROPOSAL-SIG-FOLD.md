# PROPOSAL (draft, not adopted): every read is a fold, and a fold may carry a derived shortcut

Status: a draft for the owner. Nothing here is built in pharos. Written 2026-11-19 from a session in penelope. Not committed.
Sources read: `lib/pharos.mjs` (`heads`, `askHeads`, `phbBackward`), `eoql/SIG-ANSWER.md`, EODB `facade/sig.mjs` and `facade/marks.mjs` (github.com/clovenbradshaw-ctrl/eodb), penelope `experiments/zero-overlap/referent/compare/foresight.mjs`.

## 1. The point
Pharos already knows how to be folded: getting anything out of it is a fold over the entries (`view`, `fold`, `frame`, `ground`, `heads`). So the speed-up is not a feature added beside the log by a surface. It belongs to the fold itself. EODB's SIG then stops being EODB's and becomes what pharos does when it is read.

Pharos already contains one complete instance of the pattern:
- the REFERENCE: `heads(h, addr, cell)`, which folds the full view;
- the SHORTCUT: `askHeads`, which reads backward and stops only on proof;
- the FALLBACK: any damage met on the way returns the reference answer (`fallback: why`);
- the check: its tests compare the two.

EODB's `Sig` is the same pattern with a persistent derived state. Penelope's foresight scorer is the same pattern over a stream that is not log entries yet (mentions). Three repos have grown the same thing three times. This proposal names the one shape.

## 2. The shape: a registered fold
A fold is declared once, with:
1. `name`, and `reads`: the kinds / cells / `of` links it depends on (its synapse: which entries can matter).
2. `reference(entries, params) -> answer`: the plain fold. Always correct, always available.
3. optional `shortcut(state, params) -> answer`, where `state` is DERIVED from the log and can be deleted.
4. optional `advance(state, newBytes) -> state`: the tail scanner step. Reads only what was appended since `state.position`.
5. `same(a, b)`: when two answers count as equal (exact, or a tolerance such as 1e-9 for sums).

Pharos provides, for every registered fold, once:
- POSITION: a hash of the writer files' names and sizes, as EODB's `position()`. State and cached answers carry the position they are complete to, and are valid only at that exact position. Any append is a miss, never a stale hit.
- TAIL ADVANCE: the file offset and a checked-bytes hash per writer file. If a file shrank or its checked bytes changed, the state is discarded and rebuilt from the log.
- LOCATION: id to (file, offset, length), so a walk along `of` / `seen` hops straight to entries (the wormhole). This already half exists as the PHB record framing and `phbBackward`.
- MEMO: answer cached by (fold, params, position).
- PROBE AND PROMOTION: every PROBE_EVERY-th use, run both paths, compare with `same`, and record the cost of each. A shortcut is used only after it was identical on every probe and cheaper on the later third of them (held out from the earlier two thirds that nominated it). One mismatch demotes it for that fold, and the demotion is an entry, not a silent flag. Probe rate is set from the measured cost ratio (a reference that costs 100 shortcuts is probed rarely), never fixed by habit.
- THE LAW: deleting every derived state, memo and mark changes no answer. A test runs each registered fold both ways.

## 3. Where state lives
Derived state is stored beside the log, not in it: `<log>.sig/`, as EODB does. Marks (what was probed, what was demoted) are real entries at the SIG cells (`SIG·Ground` complete-to-position claim, `SIG·Figure` pointers, `SIG·Pattern` the trail), in a separate store, so they never enlarge the log or change a fold. Per `SIG-ANSWER.md`: a trail is a pointer never an answer; reader-deposited wrong trails spread (L7), so a pointer is verified by re-reading the entry it points at before it is used.

## 4. What changes in each repo
- pharos: a `lib/sig.mjs` (position, advance, location map, memo, probe, registry) and tests; `askHeads` becomes the first registered fold with `heads` as its reference. No change to entries or ids.
- EODB: `facade/sig.mjs` shrinks to a surface over pharos's layer; its kinds (idsOfKind, ancestors) become registered folds. This needs the owner's decision, because it edits another repo.
- khora, janus: read through the registry instead of keeping their own scans.
- penelope: `foresight.mjs` registers its fold (occurrence lists and prefix sums as derived state, `effect` replay as the reference) and drops its private memo, probe and demotion. Until the layer exists, the private copy stays and is marked as a stand-in.

## 5. What the penelope session measured that argues for this
- A merge scored by replay costs about 11 ms, by a full scan about 0.11 ms, by the skip form about 0.03 ms (one real article, 1,171 events). The shortcuts are exact against the reference to 1e-9.
- The slow part was elsewhere (candidate pairs and the probe itself). A probe that replays at 100 times the shortcut cost must be rate-limited by measured cost, so the probe schedule has to be derived from costs, not copied from EODB's "every 5th".
- This is evidence about one fold. It is not a claim about pharos reads in general.

## 6. Falsifiers (written before building)
- F1: with every derived state deleted, any registered fold returns a different answer than with it: the layer is wrong.
- F2: a probe finds a mismatch that the held-out promotion rule had already promoted: the promotion rule is too weak.
- F3: the layer's own bookkeeping (position hash, tail scan, probe) costs more than the reference on a log of the size we run (10^4 entries): not worth it at our scale. Reported with the log size.
- F4: appending to the log without invalidating a memo returns a stale answer: position keying is broken.

## 7. Open choices for the owner
1. Is the fold registry in pharos itself, or in a small package pharos and the other repos both import? (Proposal: pharos, since the fold is pharos's.)
2. Do demotions and probes go on the log as entries, or in the separate marks store? (Proposal: marks store, off by default, as EODB.)
3. Is a fold over a non-log stream (penelope's mention stream) registered in the same registry, or does it first become entries? (Proposal: the stream first becomes entries at a read, which is the one door, and the fold registers over those.)
4. Who edits EODB's facade: this session, or the EODB owner's session? Nothing is touched without the owner's yes.
