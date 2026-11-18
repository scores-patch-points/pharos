# pharos

The one shared log. Every other repo knows only this: it can **weave** an entry, **watch** for entries, and **fold** what is there. No repo knows any other repo. The hub is nothing (the Void); pharos does not steer anyone.

**Name.** φᾶρος (*phâros*, later φάρος): the large woven cloth, cloak, cover, and above all the cloth for the dead, which is the one Penelope weaves and unweaves in the *Odyssey*. Entries are woven into it. Unweaving is allowed only as a typed retraction entry, never an erase. The Alexandrian lighthouse (Φάρος, the island Menelaus is becalmed off in the *Odyssey*) is most likely a different word, so it is not the etymology; it is a deliberate pun, and we use it. One name, two roles: the **cloth** is the record (what is woven, append-only), and the **light** is the watching (every worker sees the same light and knows nothing of the other ships). `weave` is the cloth; `watch` is the light. Etymology of φᾶρος is uncertain (Linear B *pa-we-a* is the probable Mycenaean plural); line references are to be checked in LSJ before quoting.

Rules of the design (user decisions, 2026-11-12):

1. **No wrong door.** Any repo or surface can open a pharos. An isolated instance gets its own. Two pharos merge by union.
2. **No repeated code.** This repo is the only implementation of the protocol. Other repos carry a pinned pointer to it plus a `holon.json` declaration, never a copy of its logic.
3. **Zero dependencies.** Node built-ins only. A few hundred lines. Nothing here may import another repo.
4. **Ignorant.** A repo that uses pharos does not import, call, or name a sibling repo. What it reads from the log it reads by cell and kind, never by author. `by` is provenance, never dispatch.
5. **Earned, never typed.** `seen` and `at` are computed by `weave`, never accepted from the caller. Kinds are declared as entries, not hard-coded. The 27 cells are data (`cells.json`), not code.

## The entry (a weft)

```
{ v:1, cell, kind, addr, body, of, basis, seen, by, at, id }
```

| field | meaning |
|---|---|
| `cell` | one of the 27 ids in `cells.json`, e.g. `INS·Figure`. The operator and grain of what this entry does. |
| `kind` | what sort of mark. Declared by a `kind` entry (see below) in the same pharos. |
| `addr` | what the entry is about, as an address string (content hash or path-like). |
| `body` | the payload (JSON value). |
| `of` | ids of earlier entries this one read or answers (may be empty). |
| `basis` | the priors and instrument versions the writer stood on (JSON object, may be empty). |
| `seen` | the causal frontier at write time: ids of the current maximal entries this writer could perceive. Computed by `weave`. |
| `by` | who wrote it (provenance). Never used to decide who acts. |
| `at` | write time, ISO. Computed. Informational only: order is causal, not clock. |
| `id` | `sha256` of the canonical JSON of the entry without `id`. Content-addressed, so a duplicate is the same entry. |

Unweaving is a **retraction entry** (kind `retract`, `of` the retracted id), never an erase. The log is append-only.

## Storage

JSONL, one file per writer under `$PHAROS` (default `~/.pharos/<name>/`): `<writer>.jsonl`. One writer never writes another's file, so merge is a grow-only set union (no locking, no conflicts). A reader reads every `*.jsonl` and dedups by `id`.

**Binary storage (PHB1).** A writer may instead store `<writer>.phb`; the default stays JSONL (`open(name, {format: 'phb'})` or `$PHAROS_FORMAT`). A directory may hold both kinds and is read as one union, deduped by `id`. The entry is still *defined* by its canonical JSON and its id is still the sha256 of that, so binary is storage only: `convertFile` turns a JSONL file into a PHB file and back and reproduces every valid line byte for byte, and `exportJsonl` is the JSONL fold of a pharos.

```
file    := "PHB1" writer(varint length + utf8) record*
record  := kind(1) length(varint) payload(length) chain(8) size(4, big-endian: the whole record's byte length)
chain   := sha256(prevChain || kind || payload)[0:8]        genesis = sha256("PHB1\0" || writer)[0:8]
kinds   := 0x01 ENTRY  0x02 BLOB (raw bytes, addressed by sha256)  0x10 RESYNC
```

Each record is checked against its predecessor, so a torn tail loses only that record and one flipped byte cuts reading off at exactly that record (nothing after it in that file is read until a RESYNC; nothing is invented); a stored id that does not match its content is reported, never read. After damage a writer appends `MARKER` + a RESYNC record, so appends continue past the damage and never over it. `size` lets a reader walk a file backward (`phbBackward`) and check one record against the 8 bytes before it. `putBlob`/`getBlob` store a payload once by its hash; `merge` copies the entries and the blobs the target lacks. Measured (`ledgers/pharos-binary/RESULTS-S1.md`): 56.7% of the JSONL bytes on a 20,000-entry log, identical views, a full cold load about 35% slower (hash chain and JavaScript decoding), accepted. Because the library's bytes changed, every `pharos.json` pointer pinned to the previous `lib/pharos.mjs` hash must be re-pinned (`install` writes the new hash).

**Heads at one address, and reading backward (optional).** `heads(h, addr, cell)` is the reference: the live entries at that (addr, cell) that no other live entry there descends from, retractions applied as `fold` applies them, computed from the full view. `askHeads(h, addr, cell)` gives the same answer reading each PHB file BACKWARD, newest first across files (an ordering hint from `at`; correctness never depends on a clock), and stops only on proof: exactly one head candidate, and in every file not yet read to its start the oldest record read is *chained* and a provable ancestor of that head. A chained ENTRY record (payload version byte 2, which `weave` writes) attests that the entry descends from every earlier entry record of its file; `merge` and conversions write version 1 (unchained), and the reader never stops inside an unchained stretch. The reader trusts the attestation; a reader that does not should use `heads`. JSONL files are read whole; damage met on the way falls back to the full view and says so; an address with no entry reads everything (absence cannot be proved earlier). Measured (`ledgers/pharos-binary/RESULTS-S2.md`): identical answers on 1,100 questions over a 3,207-entry log with forks, merges and retractions, hot addresses reading a median 4.76% of the bytes, cold addresses 44%.

## Order and fold

Order is causal: entry A precedes B if `A.id` is in the transitive `seen` or `of` of B. Concurrent entries are ordered by cell `rank`, then `id` (deterministic). `fold(view)` returns the entries in that order with retractions applied and **reports** concurrent entries that disagree on the same `addr` and cell as conflicts. It never resolves them silently.

## API (`lib/pharos.mjs`)

- `open(name?, {dir, writer})` returns a handle.
- `weave(h, {cell, kind, addr, body, of?, basis?})` computes `seen`, `at`, `id`, validates `cell` against `cells.json` and `kind` against declared kinds, appends, returns the entry.
- `ground(h)` the Void: the declared kinds, holons and frame, plus the frontier. What a worker reads first.
- `watch(h, {cell?, kind?, since?}, fn)` calls `fn(entry)` for entries not yet seen by this watcher (poll on a file-change event, no daemon).
- `fold(h, filter?)` causal order, retractions applied, conflicts reported.
- `merge(hA, hB)` union of two pharos into the first.
- `frame(h)` the declared frame: name, writer, epoch.
- `status(h)` counts, frontier, writers, conflicts.
- `install(dir)` writes the door into a repo: `pharos.json` pointer (pinned to a content hash of this repo's `lib/pharos.mjs`) and a `holon.json` stub. `undo` removes exactly what `install` wrote and nothing else.

## Declarations are entries

- `kind` entry: `body = {name, cell, schema?}`. A kind is only valid once declared.
- `holon` entry: `body = {name, ground: [kinds read], figure: [kinds sensed], pattern: [kinds written], out: [kinds handed on]}`. The holon contract: a loop rebuilds its ground from the log, senses, writes its pattern, and that pattern is the next loop's ground.
- `frame` entry (first entry of a pharos): name, epoch, and an explicit `assumed` list for any cross-frame identity claimed on a merge. Assumed, never silent.

## The ignorance lint (`tools/ignorance.mjs`)

For a repo: list every `import`/`require`/path/URL/CLI call that reaches a sibling repo (a name from a roster supplied by the caller, never hard-coded here). Report in log-only mode by default; `--enforce` fails. A repo is ignorant when its only reach out is `pharos`.

## Not in this repo

No reading, no embeddings, no perceiver logic, no editing tools. Those are holons that live elsewhere and talk through here.

## Chatter (the debugging trail; not data)

`lib/chatter.mjs`. Where a repo says "I had an issue" (a read refused for want of priors, a prior that did not load, a door entered the wrong way, a guard that would have fired) so the next session, or the owner, can see what went wrong. It is **not** the log: no `id`, no `seen`, no `cell`, no causal order, never folded, merged or retracted, and nothing reads it to decide anything.

- `chatter({ level, where, what, detail? }, opts?)` is best effort: it never throws and never blocks the caller. `where` names the writer's own repo or file as provenance only; chatter never dispatches on it.
- Bounded: a line is at most 8 KB (an over-long `detail` is cut and marked `cut`); a file rotates at 1 MB and keeps one generation; one writer writes one file (`<writer>.log`), so there is no locking.
- Lives in `$PHAROS_CHATTER`, else `<pharos dir>/chatter/`. CLI: `pharos chatter [--tail N] [--level L] [--where W] [--what X] [--since ISO]`, `pharos chatter-write --where W --what X [--level L] [--detail JSON]`.
- A repo that fails loudly (an exception, an exit code) should also leave one chatter line, so the failure is findable later; chatter is never a substitute for failing.

## The gate (a repo works only if it flows through pharos)

`lib/gate.mjs`, `rules/rules.json`, and the verbs `pharos gate`, `pharos ack`, `pharos rules`. The rules are held here, once, as data; a repo carries only its `holon.json` (a pointer: its door, what it needs, the hash of the rules it acknowledged).

`gate(dir)` reads `dir/holon.json` and reports, never throws on a bad repo:

| rule | what is checked |
|---|---|
| ONE-DOOR | `holon.json` declares `door` ("path/to/file.mjs#exportName"); the file exists and exports it |
| PRIMED | every entry of `needs` (`{ name, env?, paths, contains, how? }`) resolves to an existing path holding the files it says; a missing one is named with every place looked |
| RULES-CURRENT | `holon.json` `rules` equals the current hash of `rules/rules.json`; otherwise the repo is stale until `pharos ack --target DIR` is run on purpose |
| SAY-WHEN-REFUSED | a refused gate leaves one chatter line (what: `gate_refused`, detail: the failed rules) |

A repo calls the gate at its door and **refuses** when it fails (khora: `native/the-fold/pharos-gate.mjs`, called by `readToWeft` and `reading.js::readDocument`). Changing a rule changes the hash, so every acknowledging repo is stale until it re-acknowledges: no repo keeps its own copy of the rules. A repo finds pharos by `PHAROS_HOME`, else a `pharos` checkout beside it, and refuses, naming the clone command, when it finds none. `pharos gate` exits 0 when the repo may work and 1 when it may not.
