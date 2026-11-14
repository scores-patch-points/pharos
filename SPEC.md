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
